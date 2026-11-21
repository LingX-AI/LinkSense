import { addAbortListener } from "node:events";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  CONTEXT_LENGTH_EXCEEDED,
  createModelProviderFetch,
  isContextLengthExceededError,
  modelGatewayFailureCode,
  modelProviderBaseUrlSchema,
  nativeProviderFailureCode,
  omitUnsupportedModelImages,
  type ModelServiceProvider,
} from "@linksense/shared";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { PrivacyMaskingSettingsService } from "../privacy-masking/service.js";
import type { ModelProviderSettingsService } from "../system/model-provider-settings.js";
import type { CreditLimitService } from "../usage/credit-limit.js";
import type {
  DesktopProviderTokenUsage,
  DesktopProviderUsageRecorder,
} from "../usage/model-usage.js";
import { projectModelProxyRequest, type ModelProxyEndpoint } from "./request.js";
import { chatProviderUsage, responseProviderUsage } from "./usage.js";

const responseLimit = 32 * 1024 * 1024;
const leaseCheckMs = 2_000;
const objectSchema = z.record(z.string(), z.unknown());

// A configured provider enum does not prove that a custom channel URL uses that
// vendor's API. `include_usage` is injected only for the documented official
// endpoints below; arbitrary compatible bases, google_vertex, and
// openai_compatible are never injected and only record usage if the upstream
// sends it. OpenRouter always returns usage, so it needs no injection.
function isOfficialChatStreamUsageEndpoint(
  provider: ModelServiceProvider,
  url: URL,
): boolean {
  switch (provider) {
    case "openai":
      return url.hostname === "api.openai.com" &&
        url.pathname.replace(/\/+$/u, "") === "/v1";
    case "azure_openai":
      return (url.hostname.endsWith(".openai.azure.com") ||
        url.hostname.endsWith(".cognitiveservices.azure.com")) &&
        url.pathname.includes("/openai");
    case "deepseek":
      return url.hostname === "api.deepseek.com";
    case "google":
      return url.hostname === "generativelanguage.googleapis.com" &&
        url.pathname.includes("/openai");
    case "alibaba":
      return url.hostname === "dashscope.aliyuncs.com" &&
        url.pathname.includes("/compatible-mode");
    case "anthropic":
      return url.hostname === "api.anthropic.com" && url.pathname.startsWith("/v1");
    default:
      return false;
  }
}

function isOfficialOpenRouterEndpoint(
  provider: ModelServiceProvider,
  url: URL,
): boolean {
  return provider === "openrouter" && url.hostname === "openrouter.ai";
}

type ModelAuthorization = Parameters<DesktopRunLeases["authorizeModel"]>[0];
type UsageLogger = {
  warn(fields: Record<string, unknown>, message: string): void;
};
export type DesktopModelDependencies = {
  leases: Pick<DesktopRunLeases, "authorizeModel">;
  settings: Pick<ModelProviderSettingsService, "resolveDesktopProxyProvider">;
  creditLimits: Pick<CreditLimitService, "assertCanStartTask">;
  privacyMasking: Pick<PrivacyMaskingSettingsService, "runtimeForUser">;
  usage: Pick<DesktopProviderUsageRecorder, "recordDesktopProviderUsage">;
  logger?: UsageLogger;
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
  // The proxy request is the server-side unit of provider usage. Duplicate
  // terminal frames reuse this identity, so at most one record is persisted.
  const requestId = randomUUID();
  let usageRecorded = false;
  let usageAttempted = false;
  let usageExpected = true;
  const loggedUsageReasons = new Set<string>();
  const logUsage = (reasonCode: string, message: string, error?: unknown) => {
    if (loggedUsageReasons.has(reasonCode)) return;
    loggedUsageReasons.add(reasonCode);
    deps.logger?.warn({
      requestId,
      purpose: auth.purpose,
      model: lease.model,
      conversationId: lease.scope.conversationId,
      projectionTurnId: lease.scope.turnId,
      reasonCode,
      usageExpected,
      ...(error ? { errorClass: error instanceof Error ? error.name : "unknown" } : {}),
    }, message);
  };
  const captureUsage = (usage: DesktopProviderTokenUsage): Promise<void> => {
    // One bounded persistence attempt per proxy request. Duplicate terminal
    // frames cannot multiply database work or double-count usage.
    if (usageAttempted) return Promise.resolve();
    usageAttempted = true;
    return (async () => {
      try {
        const result = await deps.usage.recordDesktopProviderUsage({
          requestId,
          purpose: auth.purpose,
          ownerId,
          conversationId: lease.scope.conversationId,
          turnId: lease.scope.turnId,
          runtimeGeneration: lease.scope.runtimeGeneration,
          model: lease.model,
          tokenUsage: usage,
          pricing: provider.pricing,
        });
        if (result.recorded || result.reason_code === "USAGE_ALREADY_RECORDED") {
          usageRecorded = true;
        } else {
          logUsage(result.reason_code ?? "USAGE_NOT_RECORDED", "desktop provider usage not recorded");
        }
      } catch (error) {
        logUsage("USAGE_RECORD_FAILED", "desktop provider usage recording failed", error);
      }
    })();
  };
  const reportUsageUnavailable = (reasonCode: "PROVIDER_USAGE_MISSING" | "PROVIDER_USAGE_INVALID") => {
    if (usageRecorded) return;
    logUsage(
      reasonCode === "PROVIDER_USAGE_MISSING" && !usageExpected
        ? "PROVIDER_USAGE_NOT_REQUESTED"
        : reasonCode,
      "desktop provider usage unavailable",
    );
  };
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
  const providerUrl = new URL(baseUrl);
  const chatStreamUsageRequested = allowedEndpoint === "chat/completions" &&
    projected.stream &&
    isOfficialChatStreamUsageEndpoint(provider.provider, providerUrl);
  if (chatStreamUsageRequested && projected.body.stream_options === undefined) {
    projected.body.stream_options = { include_usage: true };
  }
  // Non-stream Chat responses carry usage in the JSON body. Streamed Chat is
  // expected to report usage when requested or when the official OpenRouter
  // endpoint always does; otherwise a missing value is reported as not
  // requested.
  usageExpected = allowedEndpoint === "responses" || !projected.stream ||
    chatStreamUsageRequested ||
    isOfficialOpenRouterEndpoint(provider.provider, providerUrl);
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
      ? sanitizedEvents(upstream.body, signal, {
          endpoint: allowedEndpoint,
          capture: captureUsage,
          unavailable: reportUsageUnavailable,
        })
      : sanitizedJson(upstream.body, signal, {
          endpoint: allowedEndpoint,
          capture: captureUsage,
          unavailable: reportUsageUnavailable,
        });
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

type UsageHooks = {
  endpoint: ModelProxyEndpoint;
  capture(usage: DesktopProviderTokenUsage): Promise<void>;
  unavailable(reason: "PROVIDER_USAGE_MISSING" | "PROVIDER_USAGE_INVALID"): void;
};

async function* sanitizedJson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  hooks: UsageHooks,
): AsyncGenerator<string> {
  const value = parseProviderObject(await readText(body, signal, responseLimit));
  const read = hooks.endpoint === "responses" ? responseProviderUsage(value) : chatProviderUsage(value);
  if (read?.status === "valid") {
    await hooks.capture(read.usage);
  } else if (!failedProviderPayload(value)) {
    hooks.unavailable(read?.status === "invalid" ? "PROVIDER_USAGE_INVALID" : "PROVIDER_USAGE_MISSING");
  }
  yield JSON.stringify(sanitizeFailure(value));
}

async function readText(body: ReadableStream<Uint8Array>, signal: AbortSignal, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of boundedStream(body, signal, limit)) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function* sanitizedEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  hooks: UsageHooks,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const frames: EventSourceMessage[] = [];
  const parser = createParser({
    maxBufferSize: responseLimit,
    onEvent: frame => { frames.push(frame); },
    onError: error => {
      if (error.type === "max-buffer-size-exceeded") throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED");
    },
  });
  let invalidUsage = false;
  let validUsage = false;
  let failed = false;
  for await (const chunk of boundedStream(body, signal)) {
    parser.feed(decoder.decode(chunk, { stream: true }));
    for (const frame of frames) {
      signal.throwIfAborted();
      if (frame.data === "[DONE]") {
        yield "data: [DONE]\n\n";
        continue;
      }
      const value = parseProviderObject(frame.data);
      if (failedProviderPayload(value)) failed = true;
      if (hooks.endpoint === "responses") {
        const read = responseProviderUsage(value);
        if (read?.status === "valid") {
          validUsage = true;
          await hooks.capture(read.usage);
        } else if (read?.status === "invalid") {
          invalidUsage = true;
        }
      } else {
        // The usage-bearing Chat chunk precedes [DONE] and is the final
        // opportunity to persist it: record before forwarding it so an
        // immediate downstream close cannot lose confirmed usage. Duplicate
        // usage chunks are idempotent through the server request id.
        const read = chatProviderUsage(value);
        if (read?.status === "valid") {
          validUsage = true;
          await hooks.capture(read.usage);
        } else if (read?.status === "invalid") {
          invalidUsage = true;
        }
      }
      const safe = sanitizeFailure(value, frame.event);
      const event = frame.event && /^[a-zA-Z0-9_.-]{1,80}$/u.test(frame.event) ? `event: ${frame.event}\n` : "";
      yield `${event}data: ${JSON.stringify(safe)}\n\n`;
    }
    frames.length = 0;
  }
  if (!failed && !validUsage) {
    hooks.unavailable(invalidUsage ? "PROVIDER_USAGE_INVALID" : "PROVIDER_USAGE_MISSING");
  }
}

function failedProviderPayload(value: Record<string, unknown>): boolean {
  return value.type === "response.failed" || value.type === "error" ||
    value.type === "response.error" || value.error !== undefined;
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
