import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import Fastify from "fastify";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  desktopConversationReferenceReadOperation,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopToolProtocolVersion,
  desktopToolRequestSchema,
  desktopToolResultSchema,
  readConversationReferenceResultSchema,
  type DesktopExecutionAck,
  type DesktopExecutionCallback,
  type DesktopNegotiatedOperation,
  type DesktopToolRequest,
  type ReadConversationReferenceInput,
  type ReadConversationReferenceResult,
} from "@linksense/shared";
import { DesktopDeviceTransport } from "../src/adapters/desktop-device-transport.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { RedisDesktopDeviceCoordinator, type DesktopExecutionBinding } from "../src/modules/desktop-devices/coordinator.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";
import { registerDesktopDeviceRoutes } from "../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import type { DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
import { MemoryDesktopDeviceRepository } from "./desktop-devices.fixture.js";
import { createRedisFixture } from "./fixtures/redis.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const task = "10000000-0000-4000-8000-000000000010";
const source = "10000000-0000-4000-8000-000000000011";
const sourceMessage = "10000000-0000-4000-8000-000000000012";
const turn = "10000000-0000-4000-8000-000000000013";
const generation = "10000000-0000-4000-8000-000000000014";
const headers = { authorization: "Bearer user" };
const registration = { name: "Work laptop", platform: "darwin", arch: "arm64", app_version: "0.1.0" };
const encryption = { masterKey: randomBytes(32).toString("base64"), keyId: "test" };
let redis: Awaited<ReturnType<typeof createRedisFixture>>;
const applications: ReturnType<typeof Fastify>[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => { redis = await createRedisFixture(); });
beforeEach(async () => { await redis.client.flushdb(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(applications.splice(0).map(app => app.close()));
  vi.restoreAllMocks();
});
afterAll(async () => { await redis.close(); });

type ReadReference = (scope: DesktopRunScope, input: ReadConversationReferenceInput, signal: AbortSignal) => Promise<ReadConversationReferenceResult>;

function readResult(title = "Research", text = "Source-only answer"): ReadConversationReferenceResult {
  return readConversationReferenceResultSchema.parse({
    conversation_id: source, title,
    messages: [{ id: sourceMessage, role: "assistant", text }],
    next_cursor: null, next_offset: 0,
  });
}

function readRequest(body: Record<string, unknown> = {}): DesktopToolRequest {
  return desktopToolRequestSchema.parse({
    type: "tool.request", id: randomUUID(), conversation_id: task, runtime_generation: generation,
    turn_id: turn, expires_at: new Date(Date.now() + 2_000).toISOString(),
    run_token: `lsdr_${"a".repeat(43)}`, operation: desktopConversationReferenceReadOperation,
    body: { conversation_id: source, ...body },
  });
}

function nextFrame(socket: WebSocket): Promise<unknown> {
  return once(socket, "message", { signal: AbortSignal.timeout(2_000) })
    .then(([data]) => JSON.parse(String(data)));
}

async function fixture(read: ReadReference, claim = true) {
  const repository = new MemoryDesktopDeviceRepository();
  for (const id of [owner, other]) repository.owners.set(id, { status: "active", authValidAfter: new Date(0) });
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const service = new DesktopDeviceService(repository, coordinator);
  const app = Fastify();
  const audit = vi.fn(async (entry: unknown) => { void entry; });
  const leases = {
    verifyRunBinding: vi.fn(async () => {}),
    claimToolRequest: vi.fn(async () => claim),
  };
  const transport = new DesktopDeviceTransport(redis.client, async () => true, app.log, encryption,
    async (
      binding: DesktopExecutionBinding & { ownerId: string; toolOperations: readonly DesktopNegotiatedOperation[] },
      frame: DesktopExecutionCallback,
      signal: AbortSignal,
    ): Promise<DesktopExecutionAck> => {
      if (frame.type !== "tool.request") throw new AppError("FORBIDDEN");
      const scope: DesktopRunScope = {
        ownerId: binding.ownerId, deviceId: binding.deviceId, connectionId: binding.connectionId,
        conversationId: frame.conversation_id, turnId: frame.turn_id, runtimeGeneration: frame.runtime_generation,
      };
      return executeDesktopTool({
        leases: leases as never,
        audit: { write: audit } as never,
        webSearchSettings: { search: async () => { throw new AppError("RUNNER_UNAVAILABLE"); } } as never,
        knowledgeSearch: null,
        checkPublication: async () => {},
        readConversationReference: read,
      }, scope, frame, signal);
    });
  applications.push(app);
  app.decorate("authenticate", async request => {
    if (!["Bearer user", "Bearer other"].includes(request.headers.authorization ?? "")) throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: request.headers.authorization === "Bearer other" ? other : owner,
      name: "User", email: "user@example.test", role: "user", status: "active",
      preferredLocale: null, avatarObjectKey: null, authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await registerDesktopDeviceRoutes(app, {
    service, redis: redis.client, rateLimitHmacSecret: "test-only-desktop-rate-limit-secret", execution: transport,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, audit, read, repository, service, coordinator, leases };
}

async function paired(app: ReturnType<typeof Fastify>) {
  const pairing = await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} });
  expect(pairing.statusCode).toBe(200);
  const response = await app.inject({
    method: "POST", url: "/api/v1/desktop/devices/pair",
    payload: { ...registration, code: pairing.json().data.code },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as { token: string; owner_id: string; device: { id: string } };
}

async function connect(app: ReturnType<typeof Fastify>, token: string, operations: string) {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("fixture server is not listening");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/desktop/devices/socket`, {
    headers: {
      [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(desktopExecutionProtocolVersion),
      [DESKTOP_TOOL_PROTOCOL_HEADER]: String(desktopToolProtocolVersion),
      [DESKTOP_TOOL_OPERATIONS_HEADER]: operations,
    },
  });
  sockets.push(socket);
  await once(socket, "open");
  const response = nextFrame(socket);
  socket.send(JSON.stringify({ type: "hello", token, protocol_version: 1 }));
  const ready = desktopExecutionDeviceReadySchema.parse(await response);
  return { socket, ready };
}

describe("desktop conversation reference tool", () => {
  it("reads through the authenticated device socket with the server-bound owner and turn", async () => {
    const read = vi.fn<ReadReference>(async () => readResult("Secret title", "Secret source text"));
    const { app, audit } = await fixture(read);
    const { token } = await paired(app);
    const { socket, ready } = await connect(app, token, `web.search,${desktopConversationReferenceReadOperation}`);
    expect(ready.tool_operations).toContain(desktopConversationReferenceReadOperation);

    const request = readRequest();
    socket.send(JSON.stringify(request));
    const reply = desktopToolResultSchema.parse(await nextFrame(socket));
    expect(reply).toMatchObject({
      ok: true, operation: desktopConversationReferenceReadOperation, data: readResult("Secret title", "Secret source text"),
    });
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[0]).toMatchObject({ ownerId: owner, conversationId: task, turnId: turn });
    expect(read.mock.calls[0]?.[1]).toEqual({ conversation_id: source, cursor: "0", offset: 0 });

    const auditCall = audit.mock.calls[0]?.[0] as { result: string; targetType: string; metadata: Record<string, unknown> };
    expect(auditCall).toMatchObject({
      result: "success", targetType: "conversation_reference",
      metadata: { operation: desktopConversationReferenceReadOperation, conversation_id: task, turn_id: turn },
    });
    expect(JSON.stringify(auditCall)).not.toContain("Secret title");
    expect(JSON.stringify(auditCall)).not.toContain("Secret source text");
  });

  it.each([
    ["FORBIDDEN", "FORBIDDEN"],
    ["CONVERSATION_NOT_FOUND", "CONVERSATION_NOT_FOUND"],
  ] as const)("returns the bounded %s denial without source text", async (errorCode, expected) => {
    const read = vi.fn<ReadReference>(async () => { throw new AppError(errorCode); });
    const { app, audit } = await fixture(read);
    const { token } = await paired(app);
    const { socket } = await connect(app, token, desktopConversationReferenceReadOperation);
    socket.send(JSON.stringify(readRequest()));
    const reply = desktopToolResultSchema.parse(await nextFrame(socket));
    expect(reply).toMatchObject({ ok: false, operation: desktopConversationReferenceReadOperation, error_code: expected });
    expect(JSON.stringify(reply)).not.toContain("Secret");
    const auditCall = audit.mock.calls[0]?.[0] as { result: string; metadata: Record<string, unknown> };
    expect(auditCall).toMatchObject({ result: "failed", metadata: { reason_code: expected } });
  });

  it("does not deliver a canceled reference read and never retries it", async () => {
    let entered = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.fn<ReadReference>(async (_scope, _input, signal) => {
      entered();
      await new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return readResult();
    });
    const { app } = await fixture(read);
    const { token } = await paired(app);
    const { socket } = await connect(app, token, desktopConversationReferenceReadOperation);
    const request = readRequest();
    socket.send(JSON.stringify(request));
    await started;
    socket.send(JSON.stringify({
      type: "tool.cancel", id: request.id, operation: request.operation,
      conversation_id: task, runtime_generation: generation, turn_id: turn,
    }));
    await expect(once(socket, "message", { signal: AbortSignal.timeout(200) })).rejects.toThrow();
    expect(read).toHaveBeenCalledOnce();
  });

  it("rejects a model-supplied identity or path before the reader runs", async () => {
    const read = vi.fn<ReadReference>(async () => readResult());
    const { app } = await fixture(read);
    const { token } = await paired(app);
    const { socket } = await connect(app, token, desktopConversationReferenceReadOperation);
    const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
    socket.send(JSON.stringify({
      ...readRequest(), body: { conversation_id: source, owner_id: owner },
    }));
    expect((await closed)[0]).toBe(4400);
    expect(read).not.toHaveBeenCalled();
  });

  it("turns a settled duplicate claim into a bounded read failure, never mutation uncertainty", async () => {
    const read = vi.fn<ReadReference>(async () => readResult());
    const { app, audit, leases } = await fixture(read, false);
    const { token } = await paired(app);
    const { socket } = await connect(app, token, desktopConversationReferenceReadOperation);
    socket.send(JSON.stringify(readRequest()));
    const reply = desktopToolResultSchema.parse(await nextFrame(socket));
    expect(reply).toMatchObject({ ok: false, operation: desktopConversationReferenceReadOperation, error_code: "RUNNER_UNAVAILABLE" });
    expect(reply.ok ? undefined : reply.error_code).not.toBe("RUNNER_OPERATION_UNCERTAIN");
    expect(read).not.toHaveBeenCalled();
    expect(leases.claimToolRequest).toHaveBeenCalledOnce();
    expect(audit).not.toHaveBeenCalled();
    expect(JSON.stringify(reply)).not.toContain("Secret");
  });

  it("drops an identical in-flight read id without replaying or double-delivering it", async () => {
    let open!: () => void;
    const read = vi.fn<ReadReference>(async () => {
      await new Promise<void>(resolve => { open = resolve; });
      return readResult();
    });
    const { app } = await fixture(read);
    const { token } = await paired(app);
    const { socket } = await connect(app, token, desktopConversationReferenceReadOperation);
    const request = readRequest();
    socket.send(JSON.stringify(request));
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    socket.send(JSON.stringify(request));
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(read).toHaveBeenCalledOnce();
    open();
    const reply = desktopToolResultSchema.parse(await nextFrame(socket));
    expect(reply).toMatchObject({ ok: true, id: request.id, operation: desktopConversationReferenceReadOperation });
    await expect(once(socket, "message", { signal: AbortSignal.timeout(100) })).rejects.toThrow();
    expect(read).toHaveBeenCalledOnce();
  });

  it("keeps an older Mac usable but closes it if it requests the unnegotiated read", async () => {
    const read = vi.fn<ReadReference>(async () => readResult());
    const { app } = await fixture(read);
    const { token } = await paired(app);
    const { socket, ready } = await connect(app, token, `web.search,${desktopConversationReferenceReadOperation}.unknown`);
    expect(ready.tool_operations).toEqual(["web.search"]);
    const pong = nextFrame(socket);
    socket.send(JSON.stringify({ type: "ping" }));
    await expect(pong).resolves.toEqual({ type: "pong" });
    const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
    socket.send(JSON.stringify(readRequest()));
    expect((await closed)[0]).toBe(4400);
    expect(read).not.toHaveBeenCalled();
  });
});
