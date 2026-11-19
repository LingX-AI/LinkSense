import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import {
  desktopArtifactMaxBytes,
  desktopArtifactPath,
  type DesktopArtifactReceipt,
} from "@linksense/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { expect, it, vi } from "vitest";

import type { Prisma } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import type { DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
import { registerDesktopArtifactRoutes, type DesktopArtifactRouteOptions } from "../src/modules/files/desktop-artifact-routes.js";

type Upload = (
  scope: DesktopRunScope,
  artifactId: string,
  contentLength: number,
  stream: Readable,
  signal: AbortSignal,
  check: () => Promise<void>,
) => Promise<void>;
type Confirm = (
  scope: DesktopRunScope,
  artifactId: string,
  signal: AbortSignal,
  check: () => Promise<void>,
  fence: (tx: Prisma.TransactionClient) => Promise<void>,
) => Promise<DesktopArtifactReceipt>;

const token = `lsdr_${"a".repeat(43)}`;
const bearer = `Bearer ${token}`;
const octetStream = "application/octet-stream";

async function fixture(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const scope: DesktopRunScope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  const artifactId = randomUUID();
  const receipt: DesktopArtifactReceipt = {
    success: true, artifact_id: artifactId, file_id: randomUUID(),
    display_name: "report.pdf", download_card_event_id: randomUUID(),
  };
  const order: string[] = [];
  const upload = vi.fn<Upload>(async () => {});
  const confirm = vi.fn<Confirm>(async () => receipt);
  const authorizeToolResult = vi.fn<DesktopArtifactRouteOptions["leases"]["authorizeToolResult"]>(async () => scope);
  const verifyRunBinding = vi.fn<DesktopArtifactRouteOptions["leases"]["verifyRunBinding"]>(async () => {
    order.push("verify");
  });
  const fenceRunBinding = vi.fn<DesktopArtifactRouteOptions["leases"]["fenceRunBinding"]>(async () => { order.push("fence"); });
  const checkPublication = vi.fn<DesktopArtifactRouteOptions["checkPublication"]>(async () => {
    order.push("publish");
  });
  const app: FastifyInstance = Fastify();
  onTestFinished(() => app.close());
  app.setErrorHandler((error, request, reply) => {
    if ((error as { code?: unknown }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return reply.code(415).send();
    return sendAppError(reply, request, error);
  });
  // Registered on the parent scope: these must keep their own body parsers.
  app.post("/probe/json", async request => ({ value: (request.body as { value: string }).value }));
  app.post("/probe/binary", async request => ({ streamed: request.body instanceof Readable }));
  await app.register(registerDesktopArtifactRoutes, {
    artifacts: { upload, confirm },
    leases: { authorizeToolResult, verifyRunBinding, fenceRunBinding },
    checkPublication,
  });
  return {
    app, scope, artifactId, receipt, order, upload, confirm,
    authorizeToolResult, verifyRunBinding, fenceRunBinding, checkPublication,
    uploadUrl: `${desktopArtifactPath}/${scope.turnId}/${artifactId}/upload`,
    confirmUrl: `${desktopArtifactPath}/${scope.turnId}/${artifactId}/confirm`,
  };
}

it("rejects missing, malformed and unauthorized run credentials before any artifact work", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const headers = { "content-type": octetStream, "content-length": "4" };
  for (const authorization of [undefined, `Bearer lsdm_${"b".repeat(43)}`, "Basic abc", "Bearer lsdr_short"]) {
    const result = await f.app.inject({
      method: "PUT", url: f.uploadUrl,
      headers: { ...headers, ...(authorization === undefined ? {} : { authorization }) },
      payload: "data",
    });
    expect(result.statusCode).toBe(401);
  }
  expect(f.authorizeToolResult).not.toHaveBeenCalled();
  expect(f.upload).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();

  f.authorizeToolResult.mockRejectedValueOnce(new AppError("AUTH_REQUIRED"));
  expect((await f.app.inject({
    method: "PUT", url: f.uploadUrl, headers: { ...headers, authorization: bearer }, payload: "data",
  })).statusCode).toBe(401);
  expect(f.upload).not.toHaveBeenCalled();

  f.verifyRunBinding.mockRejectedValueOnce(new AppError("FORBIDDEN"));
  expect((await f.app.inject({
    method: "PUT", url: f.uploadUrl, headers: { ...headers, authorization: bearer }, payload: "data",
  })).statusCode).toBe(403);
  expect(f.upload).not.toHaveBeenCalled();

  expect((await f.app.inject({
    method: "PUT", url: `${f.uploadUrl}?owner_id=${randomUUID()}`,
    headers: { ...headers, authorization: bearer }, payload: "data",
  })).statusCode).toBe(400);
  expect((await f.app.inject({
    method: "POST", url: `${f.confirmUrl}?scope=out-of-band`, headers: { authorization: bearer },
  })).statusCode).toBe(400);
  expect((await f.app.inject({
    method: "PUT", url: `${desktopArtifactPath}/not-a-uuid/${f.artifactId}/upload`,
    headers: { ...headers, authorization: bearer }, payload: "data",
  })).statusCode).toBe(400);
  // Only the two authorized attempts reached the lease.
  expect(f.authorizeToolResult).toHaveBeenCalledTimes(2);
});

it("requires an uncompressed, trailer-free octet stream with an exact positive content length", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const cases: { headers: Record<string, string>; payload?: string }[] = [
    { headers: { "content-type": "text/plain", "content-length": "4" }, payload: "data" },
    { headers: { "content-type": octetStream } },
    { headers: { "content-type": octetStream, "content-length": "0" } },
    { headers: { "content-type": octetStream, "content-length": "007" } },
    { headers: { "content-type": octetStream, "content-length": "9007199254740992" } },
    { headers: { "content-type": octetStream, "content-length": "4", "content-encoding": "gzip" }, payload: "data" },
    { headers: { "content-type": octetStream, "content-length": "4", trailer: "x-checksum" }, payload: "data" },
    { headers: { "content-type": octetStream, "transfer-encoding": "chunked" } },
  ];
  for (const testCase of cases) {
    const result = await f.app.inject({
      method: "PUT", url: f.uploadUrl,
      headers: { authorization: bearer, ...testCase.headers },
      ...(testCase.payload === undefined ? {} : { payload: testCase.payload }),
    });
    expect(result.statusCode, JSON.stringify(testCase.headers)).toBe(400);
  }
  const oversized = await f.app.inject({
    method: "PUT", url: f.uploadUrl,
    headers: {
      authorization: bearer, "content-type": octetStream,
      "content-length": String(desktopArtifactMaxBytes + 1),
    },
  });
  expect(oversized.statusCode).toBe(413);
  expect(f.upload).not.toHaveBeenCalled();
});

it("streams the declared upload to the lease-derived scope and answers 204 without a body", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const chunks: Buffer[] = [];
  let checks = 0;
  f.upload.mockImplementationOnce(async (scope, artifactId, contentLength, stream, signal, check) => {
    expect(scope).toBe(f.scope);
    expect(artifactId).toBe(f.artifactId);
    expect(contentLength).toBe(5);
    expect(signal.aborted).toBe(false);
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    await check();
    checks += 1;
  });
  const result = await f.app.inject({
    method: "PUT", url: f.uploadUrl,
    headers: {
      authorization: bearer, "content-type": octetStream, "content-length": "5",
      "x-owner-id": randomUUID(), "x-device-id": randomUUID(),
    },
    payload: Buffer.from("hello"),
  });
  expect(result.statusCode).toBe(204);
  expect(result.rawPayload.byteLength).toBe(0);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(Buffer.concat(chunks).toString()).toBe("hello");
  expect(checks).toBe(1);
  expect(f.verifyRunBinding).toHaveBeenCalledTimes(2);
  for (const call of f.verifyRunBinding.mock.calls) expect(call[2]).toBe("use");
  expect(f.verifyRunBinding).toHaveBeenCalledWith(f.scope, token, "use");
  expect(f.confirm).not.toHaveBeenCalled();
});

it("hands the first bytes to the service before the client finishes sending the body", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const first = Buffer.alloc(64 * 1024, 1);
  const rest = Buffer.alloc(192 * 1024, 2);
  const total = first.byteLength + rest.byteLength;
  let firstReceived!: () => void;
  const sawFirstBytes = new Promise<void>(resolve => { firstReceived = resolve; });
  let received = 0;
  f.upload.mockImplementationOnce(async (_scope, _artifactId, contentLength, stream, signal, check) => {
    expect(contentLength).toBe(total);
    expect(signal.aborted).toBe(false);
    for await (const chunk of stream) {
      received += (chunk as Buffer).byteLength;
      if (received >= first.byteLength) firstReceived();
    }
    await check();
  });
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const request = httpRequest(`${origin}${f.uploadUrl}`, {
    method: "PUT",
    headers: {
      authorization: bearer, "content-type": octetStream, "content-length": String(total), connection: "close",
    },
    signal: AbortSignal.timeout(10_000),
  });
  onTestFinished(() => { request.destroy(); });
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    request.once("response", resolve);
    request.once("error", reject);
  });
  request.write(first);
  // A buffering parser would not invoke the route until the request ends.
  const settled = await Promise.race([
    sawFirstBytes.then(() => "streamed" as const),
    new Promise<"buffered">(resolve => {
      const timer = setTimeout(() => resolve("buffered"), 2_000);
      timer.unref();
    }),
  ]);
  expect(settled).toBe("streamed");
  expect(request.writableEnded).toBe(false);
  request.end(rest);
  const incoming = await response;
  await new Promise<void>(resolve => {
    incoming.once("end", resolve);
    incoming.resume();
  });
  expect(incoming.statusCode).toBe(204);
  expect(received).toBe(total);
});

it("aborts an in-flight upload when the response side disconnects before the body completes", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  let observed: AbortSignal | undefined;
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  f.upload.mockImplementationOnce(async (_scope, _artifactId, _contentLength, stream, signal) => {
    stream.on("error", () => {});
    observed = signal;
    started();
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("upload canceled")), { once: true });
    });
  });
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const request = httpRequest(`${origin}${f.uploadUrl}`, {
    method: "PUT",
    headers: { authorization: bearer, "content-type": octetStream, "content-length": "4096" },
  });
  request.on("error", () => {});
  onTestFinished(() => { request.destroy(); });
  request.write(Buffer.alloc(1024));
  await startedPromise;
  expect(observed?.aborted).toBe(false);
  request.destroy();
  await vi.waitFor(() => expect(observed?.aborted).toBe(true));
});

it("confirms through the publication fence and returns only the strict shared receipt", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const tx = {} as Prisma.TransactionClient;
  f.confirm.mockImplementationOnce(async (scope, artifactId, signal, check, fence) => {
    expect(scope).toBe(f.scope);
    expect(artifactId).toBe(f.artifactId);
    expect(signal.aborted).toBe(false);
    await check();
    await fence(tx);
    expect(signal.aborted).toBe(false);
    return f.receipt;
  });
  const result = await f.app.inject({ method: "POST", url: f.confirmUrl, headers: { authorization: bearer } });
  expect(result.statusCode).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.json()).toEqual(f.receipt);
  expect(f.order).toEqual(["verify", "verify", "publish", "fence"]);
  expect(f.checkPublication).toHaveBeenCalledWith(tx, f.scope);
  expect(f.fenceRunBinding).toHaveBeenCalledWith(f.scope, token);
  for (const call of f.verifyRunBinding.mock.calls) expect(call[2]).toBe("use");
  expect(f.upload).not.toHaveBeenCalled();
});

it("returns no receipt when the publication fence denies confirmation", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const tx = {} as Prisma.TransactionClient;
  f.checkPublication.mockRejectedValueOnce(new AppError("FORBIDDEN"));
  f.confirm.mockImplementationOnce(async (_scope, _artifactId, _signal, _check, fence) => {
    await fence(tx);
    throw new Error("unreachable");
  });
  const result = await f.app.inject({ method: "POST", url: f.confirmUrl, headers: { authorization: bearer } });
  expect(result.statusCode).toBe(403);
  expect(result.json()).toMatchObject({ success: false, error_code: "FORBIDDEN" });
  expect(f.fenceRunBinding).not.toHaveBeenCalled();
});

it("rejects a confirmation body and refuses a receipt that violates the strict shared schema", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  expect((await f.app.inject({
    method: "POST", url: f.confirmUrl,
    headers: { authorization: bearer, "content-type": "application/json", "content-length": "2" },
    payload: "{}",
  })).statusCode).toBe(400);
  expect(f.confirm).not.toHaveBeenCalled();

  f.confirm.mockResolvedValueOnce({ ...f.receipt, extra: "not allowed" } as DesktopArtifactReceipt);
  const malformed = await f.app.inject({ method: "POST", url: f.confirmUrl, headers: { authorization: bearer } });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.body).not.toContain("not allowed");
});

it("keeps the parent application's body parsers untouched", async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  const json = await f.app.inject({ method: "POST", url: "/probe/json", payload: { value: "kept" } });
  expect(json.statusCode).toBe(200);
  expect(json.json()).toEqual({ value: "kept" });
  const binary = await f.app.inject({
    method: "POST", url: "/probe/binary",
    headers: { "content-type": octetStream }, payload: Buffer.from("unparsed"),
  });
  expect(binary.statusCode).toBe(415);
});
