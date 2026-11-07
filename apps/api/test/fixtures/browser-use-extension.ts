import Fastify from "fastify";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { registerBrowserUseRoutes } from "../../src/modules/browser-use/routes.js";
import { BrowserUseService } from "../../src/modules/browser-use/service.js";
import { MemoryBrowserStore } from "../browser-use-store.js";
import type { Duplex } from "node:stream";
import { createRedisFixture } from "./redis.js";

export async function createBrowserExtensionFixture(owner: string, date: Date) {
  const api = Fastify();
  api.decorate("authenticate", async () => {});
  api.get("/settings/general", async (_request, reply) =>
    reply
      .type("text/html")
      .send(
        "<!doctype html><html><body>LinkSense connection fixture</body></html>",
      ),
  );
  api.get("/conversations/new", async (_request, reply) => reply.type("text/html").send("<!doctype html><html><body>LinkSense task fixture</body></html>"));
  api.get("/conversations/:id", async (_request, reply) => reply.type("text/html").send("<!doctype html><html><body>LinkSense task fixture</body></html>"));
  const service = new BrowserUseService(
    new MemoryBrowserStore(),
    "http://127.0.0.1/api/v1/browser-use",
  );
  const prisma = {
    user: {
      findUnique: async () => ({
        id: owner,
        status: "active",
        authValidAfter: date,
      }),
    },
  };
  const redis = await createRedisFixture();
  api.addHook("onClose", async () => redis.close());
  await registerBrowserUseRoutes(api, {
    redis: redis.client,
    rateLimitHmacSecret: "test-browser-use-rate-limit-secret",
    service,
    prisma: prisma as unknown as PrismaClient,
    sharedSecret: "test-runner",
    socketPath: "/api/v1/browser-use/socket",
    intent: { detect: async () => false },
  });
  const transports = new Set<Duplex>();
  api.server.on("upgrade", (_request, socket) => {
    transports.add(socket);
    socket.once("close", () => transports.delete(socket));
  });
  const address = await api.listen({ host: "127.0.0.1", port: 0 });
  return { api, service, address, dropBrowserTransport: () => { for (const socket of transports) socket.destroy(); } };
}
