import { buildIdSchema, CLIENT_BUILD_HEADER, SERVER_BUILD_HEADER } from "@linksense/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";

export function registerClientBuildGuard(app: FastifyInstance, buildId: string | null): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/")) return;
    if (buildId !== null) {
      reply.header(SERVER_BUILD_HEADER, buildId);
      // Streaming routes write directly to the socket after hijacking the reply.
      reply.raw.setHeader(SERVER_BUILD_HEADER, buildId);
    }
    const clientBuild = request.headers[CLIENT_BUILD_HEADER];
    // External clients, callbacks, probes and browser resource navigations do
    // not participate in the first-party web build handshake.
    if (buildId === null || clientBuild === undefined || request.method === "OPTIONS") return;
    const parsed = buildIdSchema.safeParse(clientBuild);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR");
    if (parsed.data !== buildId) throw new AppError("CLIENT_UPDATE_REQUIRED");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/v1/") && !reply.hasHeader("cache-control")) {
      reply.header("cache-control", "private, no-store");
    }
    return payload;
  });
}
