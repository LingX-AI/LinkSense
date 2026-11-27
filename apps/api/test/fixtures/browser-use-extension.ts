import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import Fastify from "fastify";
import type { BrowserUseRequest } from "@linksense/shared";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { sendAppError } from "../../src/lib/http.js";
import { registerBrowserUseRoutes } from "../../src/modules/browser-use/routes.js";
import { BrowserUseService } from "../../src/modules/browser-use/service.js";
import { RedisBrowserStore } from "../../src/modules/browser-use/store.js";
import { createRedisFixture } from "./redis.js";

/**
 * Browser-extension fixture for the web white-box suite. It serves the pairing,
 * socket and internal execute routes without any device lane; a "task" reaches
 * the extension the same way a runner does, through the internal execute route.
 */
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
    conversation: { findFirst: async () => ({ id: randomUUID() }) },
    conversationTurn: { findFirst: async () => ({ collaborationMode: "default" }) },
    conversationTurnStartIntent: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const redis = await createRedisFixture();
  api.addHook("onClose", async () => redis.close());
  const store = new RedisBrowserStore(redis.client);
  const service = new BrowserUseService(store, "http://127.0.0.1/api/v1/browser-use");
  await registerBrowserUseRoutes(api, {
    redis: redis.client,
    rateLimitHmacSecret: "test-browser-use-rate-limit-secret",
    service,
    prisma,
    sharedSecret: "test-runner",
    socketPath: "/api/v1/browser-use/socket",
    intent: { detect: async () => false },
  });
  const transports = new Set<Duplex>();
  api.server.on("upgrade", (request, socket) => {
    if (!["/api/v1/browser-use/socket", "/api/v1/local-browser/socket"].includes(request.url?.split("?")[0] ?? "")) return;
    transports.add(socket);
    socket.once("close", () => transports.delete(socket));
  });
  const address = await api.listen({ host: "127.0.0.1", port: 0 });
  const connectTask = (conversationId: string) => {
    const turnId = randomUUID();
    return {
      async execute(body: BrowserUseRequest) {
        const response = await api.inject({
          method: "POST",
          url: "/internal/browser-use/execute",
          headers: {
            authorization: "Bearer test-runner",
            "x-linksense-owner-id": owner,
          },
          payload: { conversationId, turnId, input: body },
        });
        return { result: response.json() };
      },
    };
  };
  return {
    api,
    service,
    address,
    connectTask,
    dropBrowserTransport: () => {
      for (const socket of transports) socket.destroy();
    },
  };
}
