import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import Fastify from "fastify";
import {
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  desktopBrowserScreenshotPath,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopProtocolVersion,
  desktopToolLifetimeFor,
  desktopToolProtocolVersion,
  desktopToolRequestSchema,
  desktopToolResultSchema,
  type BrowserUseRequest,
} from "@linksense/shared";
import { WebSocket } from "ws";
import { DesktopDeviceTransport } from "../../src/adapters/desktop-device-transport.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { AppError } from "../../src/lib/errors.js";
import { sendAppError } from "../../src/lib/http.js";
import { registerBrowserUseRoutes } from "../../src/modules/browser-use/routes.js";
import { BrowserUseService } from "../../src/modules/browser-use/service.js";
import { RedisBrowserStore } from "../../src/modules/browser-use/store.js";
import { DesktopRunLeases } from "../../src/modules/desktop-credentials/run-leases.js";
import { DesktopBrowserUse, registerDesktopBrowserScreenshotRoute } from "../../src/modules/desktop-devices/browser-use.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { registerDesktopDeviceRoutes } from "../../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { executeDesktopTool } from "../../src/modules/desktop-devices/tool-requests.js";
import { MemoryDesktopDeviceRepository } from "../desktop-devices.fixture.js";
import { createRedisFixture } from "./redis.js";

export async function createBrowserExtensionFixture(owner: string, date: Date) {
  const api = Fastify();
  api.decorate("authenticate", async request => {
    request.authUser = {
      id: owner, name: "Browser fixture", email: "owner@example.test", role: "user",
      status: "active", authValidAfter: date, preferredLocale: null, avatarObjectKey: null,
    };
  });
  api.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  api.get("/settings/general", async (_request, reply) =>
    reply
      .type("text/html")
      .send(
        "<!doctype html><html><body>LinkSense connection fixture</body></html>",
      ),
  );
  api.get("/conversations/new", async (_request, reply) => reply.type("text/html").send("<!doctype html><html><body>LinkSense task fixture</body></html>"));
  api.get("/conversations/:id", async (_request, reply) => reply.type("text/html").send("<!doctype html><html><body>LinkSense task fixture</body></html>"));
  api.get("/web/fixture-site", async (_request, reply) => reply.type("text/html").send("<!doctype html><html><title>Published fixture site</title><h1>Published fixture site</h1></html>"));
  const prisma = {
    user: {
      findUnique: async () => ({
        id: owner,
        status: "active",
        authValidAfter: date,
      }),
    },
    applicationExternalSession: { findFirst: async () => null },
    conversationTurn: { findFirst: async () => ({ collaborationMode: "default" }) },
    conversationTurnStartIntent: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const redis = await createRedisFixture();
  api.addHook("onClose", async () => redis.close());
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const store = new RedisBrowserStore(redis.client);
  const fixtureTurns = new Set<string>();
  const leases = new DesktopRunLeases(redis.client, async scope =>
    scope.ownerId === owner && fixtureTurns.has(scope.turnId) &&
    coordinator.isCurrentConnection(scope.deviceId, scope.connectionId));
  const encryption = { credentialMasterKey: randomBytes(32).toString("base64"), credentialKeyId: "fixture" };
  const service = new BrowserUseService(store, "http://127.0.0.1/api/v1/browser-use", {
    ...encryption, isActiveRun: scope => leases.isActiveToolScope(scope),
  });
  const browserUse = new DesktopBrowserUse(prisma, service, store, encryption);
  const repository = new MemoryDesktopDeviceRepository();
  repository.owners.set(owner, { status: "active", authValidAfter: date });
  const deviceService = new DesktopDeviceService(repository, coordinator);
  const execution = new DesktopDeviceTransport(
    redis.client, async () => false, api.log,
    { masterKey: randomBytes(32).toString("base64"), keyId: "fixture" },
    ({ ownerId, deviceId, connectionId }, frame, signal) => {
      if (frame.type !== "tool.request" || frame.operation !== "browser.execute") throw new AppError("FORBIDDEN");
      return executeDesktopTool({
        leases, browserUse, audit: { write: async () => {} }, knowledgeSearch: null,
        webSearchSettings: { search: async () => { throw new AppError("FORBIDDEN"); } },
        checkPublication: async () => { throw new AppError("FORBIDDEN"); },
      }, {
        ownerId, deviceId, connectionId,
        conversationId: frame.conversation_id, runtimeGeneration: frame.runtime_generation, turnId: frame.turn_id,
      }, frame, signal);
    },
  );
  await registerBrowserUseRoutes(api, {
    redis: redis.client,
    rateLimitHmacSecret: "test-browser-use-rate-limit-secret",
    service,
    prisma,
    sharedSecret: "test-runner",
    socketPath: "/api/v1/browser-use/socket",
    intent: { detect: async () => false },
  });
  await registerDesktopDeviceRoutes(api, {
    service: deviceService, redis: redis.client, execution, browserTools: true,
    rateLimitHmacSecret: "test-desktop-device-rate-limit-secret",
  });
  registerDesktopBrowserScreenshotRoute(api, browserUse, leases);
  const transports = new Set<Duplex>();
  api.server.on("upgrade", (request, socket) => {
    if (!["/api/v1/browser-use/socket", "/api/v1/local-browser/socket"].includes(request.url?.split("?")[0] ?? "")) return;
    transports.add(socket);
    socket.once("close", () => transports.delete(socket));
  });
  const address = await api.listen({ host: "127.0.0.1", port: 0 });
  const connectDesktop = async (conversationId: string) => {
    const pairing = await deviceService.pairing(owner, date);
    const { device, token } = await deviceService.pair({
      code: pairing.code, name: "Mac fixture", platform: "darwin", arch: "arm64", app_version: "0.1.0",
    });
    const endpoint = new URL("/api/v1/desktop/devices/socket", address);
    endpoint.protocol = "ws:";
    const socket = new WebSocket(endpoint, { headers: {
      [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(desktopExecutionProtocolVersion),
      [DESKTOP_TOOL_PROTOCOL_HEADER]: String(desktopToolProtocolVersion),
      [DESKTOP_TOOL_OPERATIONS_HEADER]: "browser.execute",
    } });
    const turnId = randomUUID();
    const runtimeGeneration = randomUUID();
    const exchange = async (frame: unknown, timeoutMs: number): Promise<unknown> => {
      const message = once(socket, "message", { signal: AbortSignal.timeout(timeoutMs) });
      socket.send(JSON.stringify(frame));
      const [raw] = await message;
      return JSON.parse(String(raw));
    };
    try {
      await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
      const ready = desktopExecutionDeviceReadySchema.parse(await exchange({
        type: "hello", token, protocol_version: desktopProtocolVersion,
      }, 5_000));
      assert.deepEqual(ready.tool_operations, ["browser.execute"]);
      assert.equal(ready.device_id, device.id);
      fixtureTurns.add(turnId);
      socket.once("close", () => fixtureTurns.delete(turnId));
      const credentials = await leases.issue({ deviceId: device.id, connectionId: ready.connection_id }, {
        ownerId: owner, conversationId, projectionTurnId: turnId, expectedRuntimeGeneration: runtimeGeneration,
        model: "fixture",
        modelProvider: { revision: 0, baseUrl: address, protocolMode: "native_responses", apiKey: "fixture" },
      });
      return {
        async execute(body: BrowserUseRequest) {
          const lifetime = desktopToolLifetimeFor("browser.execute");
          const id = randomUUID();
          const result = desktopToolResultSchema.parse(await exchange(desktopToolRequestSchema.parse({
            type: "tool.request", operation: "browser.execute", id, body,
            conversation_id: conversationId, turn_id: turnId, runtime_generation: runtimeGeneration,
            run_token: credentials.run_token, expires_at: new Date(Date.now() + lifetime).toISOString(),
          }), lifetime + 1_000));
          assert.equal(result.id, id);
          if (!result.ok) throw new Error(result.error_code);
          assert(result.operation === "browser.execute");
          return result.data;
        },
        readScreenshot(screenshotId: string) {
          return fetch(new URL(`${desktopBrowserScreenshotPath}/${turnId}/${screenshotId}`, address), {
            headers: { authorization: `Bearer ${credentials.run_token}` },
            signal: AbortSignal.timeout(5_000),
            redirect: "error",
          });
        },
      };
    } catch (error) {
      socket.terminate();
      throw error;
    }
  };
  return { api, service, address, connectDesktop, dropBrowserTransport: () => { for (const socket of transports) socket.destroy(); } };
}
