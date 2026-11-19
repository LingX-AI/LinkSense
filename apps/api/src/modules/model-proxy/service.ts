import { addAbortListener } from "node:events";
import { Readable } from "node:stream";
import {
  CONTEXT_LENGTH_EXCEEDED,
  createModelProviderFetch,
  isContextLengthExceededError,
  modelGatewayFailureCode,
  modelProviderBaseUrlSchema,
  nativeProviderFailureCode,
  omitUnsupportedModelImages,
} from "@linksense/shared";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { PrivacyMaskingSettingsService } from "../privacy-masking/service.js";
import type { ModelProviderSettingsService } from "../system/model-provider-settings.js";
import type { CreditLimitService } from "../usage/credit-limit.js";
import { projectModelProxyRequest, type ModelProxyEndpoint } from "./request.js";

const responseLimit = 32 * 1024 * 1024;
const leaseCheckMs = 2_000;
const objectSchema = z.record(z.string(), z.unknown());

type ModelAuthorization = Parameters<DesktopRunLeases["authorizeModel"]>[0];
export type DesktopModelDependencies = {
  leases: Pick<DesktopRunLeases, "authorizeModel">;
  settings: Pick<ModelProviderSettingsService, "resolveDesktopProxyProvider">;
  creditLimits: Pick<CreditLimitService, "assertCanStartTask">;
  privacyMasking: Pick<PrivacyMaskingSettingsService, "runtimeForUser">;
  reserveSlot(turnId: string): Promise<() => Promise<void>>;
  watchRevocation(scope: DesktopRunScope, revoke: () => void): Promise<() => void>;
  onSlotReleaseFailure?(): void;
  fetcher?: typeof fetch;
};
type DesktopModelResult =
  | { ok: false; status: number; code: string }
  | { ok: true; contentType: "application/json" | "text/event-stream"; stream: Readable };

export async function forwardDesktopModel(
  deps: DesktopModelDependencies,
  auth: ModelAuthorization,
  endpoint: ModelProxyEndpoint,
  input: unknown,
  clientSignal: AbortSignal,
  turnMetadata?: string,
): Promise<DesktopModelResult> {
  const projected = projectModelProxyRequest(endpoint, input, auth.purpose, turnMetadata);
  const controller = new AbortController();
  const signal = AbortSignal.any([clientSignal, controller.signal]);
  const recheck = () => withinModelDeadline(
    deps.leases.authorizeModel({ ...auth, model: projected.model }),
    AbortSignal.any([signal, AbortSignal.timeout(leaseCheckMs)]),
  );
  const lease = await recheck();
  const allowedEndpoint = lease.protocolMode === "chat_completions_bridge" ? "chat/completions" : "responses";
  if (allowedEndpoint !== endpoint) throw new AppError("FORBIDDEN");
  const ownerId = lease.scope.ownerId;
  const [provider, privacy] = await withinModelDeadline(Promise.all([
    deps.settings.resolveDesktopProxyProvider({ ...lease, purpose: auth.purpose }),
    deps.privacyMasking.runtimeForUser(ownerId),
    deps.creditLimits.assertCanStartTask(ownerId),
  ]), signal);
  // shortcut: keep protected accounts on cloud until the proxy applies and restores their masking policy.
  if (privacy) throw new AppError("FORBIDDEN");
  // Desktop Codex may replay historical screenshots and tool results. Never
  // forward image parts to a model that does not declare image input support.
  if (!provider.supportsImageInput) {
    omitUnsupportedModelImages(projected.body);
  }
  if (auth.purpose === "memory_extraction") {
    if (!lease.reasoningEffort) throw new AppError("FORBIDDEN");
    if (endpoint === "responses") projected.body.reasoning = { effort: lease.reasoningEffort };
    else projected.body.reasoning_effort = lease.reasoningEffort;
  }
  const baseUrl = modelProviderBaseUrlSchema.parse(provider.baseUrl);
  let releaseSlot: (() => Promise<void>) | undefined;
  let unsubscribe: (() => void) | undefined;
  let watching = false;
  const monitor = setInterval(() => {
    if (watching || signal.aborted) return;
    watching = true;
    void recheck().catch(() => controller.abort()).finally(() => { watching = false; });
  }, leaseCheckMs);
  monitor.unref();
  const cleanup = async () => {
    clearInterval(monitor);
    unsubscribe?.();
    controller.abort();
    try { await releaseSlot?.(); } catch { deps.onSlotReleaseFailure?.(); }
  };
  let stream: Readable | undefined;
  try {
    unsubscribe = await deps.watchRevocation(lease.scope, () => controller.abort());
    signal.throwIfAborted();
    releaseSlot = await deps.reserveSlot(lease.scope.turnId);
    await recheck();
    signal.throwIfAborted();
    const upstream = await createModelProviderFetch(baseUrl, deps.fetcher)(
      new URL(`${baseUrl}/${allowedEndpoint}`),
      {
        method: "POST",
        redirect: "manual",
        signal,
        headers: {
          accept: projected.stream ? "text/event-stream, application/json" : "application/json",
          authorization: `Bearer ${provider.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(projected.body),
      },
    );
    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.toLowerCase();
    if (!upstream.ok || !upstream.body || (contentType !== "application/json" && contentType !== "text/event-stream")) {
      return await redactProviderError(upstream, signal);
    }
    await recheck();
    signal.throwIfAborted();
    const source = contentType === "text/event-stream"
      ? sanitizedEvents(upstream.body, signal)
      : sanitizedJson(upstream.body, signal);
    stream = Readable.from(source);
    const downstream = stream;
    const subscription = addAbortListener(signal, () => downstream.destroy(new AppError("RUNNER_UNAVAILABLE")));
    stream.once("close", () => {
      subscription[Symbol.dispose]();
      void cleanup();
    });
    return { ok: true, contentType, stream };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED", undefined, signal.aborted ? 504 : 502);
  } finally {
    if (!stream) await cleanup();
  }
}

async function redactProviderError(upstream: Response, signal: AbortSignal): Promise<Extract<DesktopModelResult, { ok: false }>> {
  const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
  if (status === upstream.status && upstream.body) {
    try {
      const payload: unknown = JSON.parse(await readText(upstream.body, signal, 64 * 1024));
      const code = isContextLengthExceededError(payload, status) ? CONTEXT_LENGTH_EXCEEDED : nativeProviderFailureCode(payload);
      if (code) return { ok: false, status, code };
    } catch {
      signal.throwIfAborted();
    }
  } else {
    void upstream.body?.cancel().catch(() => undefined);
  }
  return { ok: false, status, code: modelGatewayFailureCode(status) };
}

export async function withinModelDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop: Disposable | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = addAbortListener(signal, () => reject(new AppError("RUNNER_UNAVAILABLE")));
  });
  try { return await Promise.race([work, aborted]); } finally { stop?.[Symbol.dispose](); }
}

async function* sanitizedJson(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  yield JSON.stringify(sanitizeFailure(parseProviderObject(await readText(body, signal, responseLimit))));
}

async function readText(body: ReadableStream<Uint8Array>, signal: AbortSignal, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of boundedStream(body, signal, limit)) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function* sanitizedEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const frames: EventSourceMessage[] = [];
  const parser = createParser({
    maxBufferSize: responseLimit,
    onEvent: frame => { frames.push(frame); },
    onError: error => {
      if (error.type === "max-buffer-size-exceeded") throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED");
    },
  });
  for await (const chunk of boundedStream(body, signal)) {
    parser.feed(decoder.decode(chunk, { stream: true }));
    for (const frame of frames) {
      signal.throwIfAborted();
      if (frame.data === "[DONE]") {
        yield "data: [DONE]\n\n";
        continue;
      }
      const safe = sanitizeFailure(parseProviderObject(frame.data), frame.event);
      const event = frame.event && /^[a-zA-Z0-9_.-]{1,80}$/u.test(frame.event) ? `event: ${frame.event}\n` : "";
      yield `${event}data: ${JSON.stringify(safe)}\n\n`;
    }
    frames.length = 0;
  }
}

function parseProviderObject(value: string): Record<string, unknown> {
  try {
    return objectSchema.parse(JSON.parse(value));
  } catch {
    throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED");
  }
}

function sanitizeFailure(value: Record<string, unknown>, event?: string): Record<string, unknown> {
  const type = typeof value.type === "string" ? value.type : event;
  const failed = event === "response.failed" || type === "response.failed";
  const response = objectSchema.safeParse(value.response);
  const payload = response.success ? response.data : value;
  if (!failed && event !== "error" && type !== "error" && event !== "response.error" &&
      type !== "response.error" && !value.error && !payload.error) return value;
  const code = nativeProviderFailureCode(value) ?? "model_provider_error";
  if (failed) {
    return { type: "response.failed", response: { status: "failed", error: { code } } };
  }
  return type ? { type: "error", code, error: { code } } : { error: { code } };
}

async function* boundedStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, limit = responseLimit): AsyncGenerator<Buffer> {
  const reader = body.getReader();
  const cancellation = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancellation, { once: true });
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) return;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED");
      yield Buffer.from(part.value);
    }
  } finally {
    signal.removeEventListener("abort", cancellation);
    cancellation();
    reader.releaseLock();
  }
}
