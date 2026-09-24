import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  connectionProviderSchema,
  connectionInputSchema,
  connectionResultSchema,
  MICROSOFT_CONNECTION_BODY_LIMIT,
} from "@linksense/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import { randomToken } from "../../lib/crypto.js";
import { assertCookieRequestOrigin } from "../auth/routes.js";
import type { ConnectionService } from "./service.js";

const paramsSchema = z.strictObject({ provider: connectionProviderSchema });
const parametersSchema = z.record(z.string().max(128), z.string().max(16_384));
type Options = {
  service: Pick<ConnectionService, "list" | "start" | "complete" | "disconnect">;
  publicBaseUrl: string;
};

export const connectionRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const secure = new URL(options.publicBaseUrl).protocol === "https:";
  const cookieOptions = {
    path: "/api/v1/connectors",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: 600,
  };
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
  });
  app.get("/api/v1/connections", { preHandler: app.authenticate }, async (request) =>
    ok({ items: await options.service.list(actorId(request)) }, request),
  );
  app.post(
    "/api/v1/connections/:provider/authorize",
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertCookieRequestOrigin(request);
      const { provider } = paramsSchema.parse(request.params);
      const browser = randomToken();
      const authorizationUrl = await options.service.start(actorId(request), provider, browser);
      reply.setCookie(`linksense_connection_${provider}`, browser, cookieOptions);
      return ok({ authorization_url: authorizationUrl }, request);
    },
  );
  app.delete(
    "/api/v1/connections/:provider",
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertCookieRequestOrigin(request);
      const { provider } = paramsSchema.parse(request.params);
      await options.service.disconnect(actorId(request), provider);
      return reply.code(204).send();
    },
  );
  app.get("/api/v1/connectors/:provider/callback", async (request, reply) => {
    const { provider } = paramsSchema.parse(request.params);
    let result = "success";
    try {
      await options.service.complete(
        provider,
        parametersSchema.parse(request.query),
        request.cookies[`linksense_connection_${provider}`] ?? "",
      );
    } catch {
      // Provider exceptions contain codes, tokens and response bodies. Never log
      // them or include provider-supplied error text in the redirect.
      result = "failed";
      request.log.warn({ event: "connection_authorization_failed", provider });
    }
    reply.clearCookie(`linksense_connection_${provider}`, cookieOptions);
    return reply.redirect(
      new URL(
        `/capabilities?section=connector&scope=personal&connection_result=${result}`,
        options.publicBaseUrl,
      ).toString(),
    );
  });
};

export const internalConnectionRoutes: FastifyPluginAsync<{
  service: Pick<ConnectionService, "execute">;
  sharedSecret: string;
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const secret = Buffer.from(options.sharedSecret);
    if (token.length !== secret.length || !timingSafeEqual(token, secret))
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    // Service-mode runtimes belong to the publisher, not their external caller.
    if (request.headers["x-linksense-service-session"])
      return reply.code(403).send({ error_code: "FORBIDDEN" });
  });
  app.post("/connections/execute", { bodyLimit: MICROSOFT_CONNECTION_BODY_LIMIT }, async (request, reply) => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const body = z
      .strictObject({
        conversationId: z.uuid(),
        turnId: z.uuid(),
        input: connectionInputSchema,
      })
      .parse(request.body);
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once("close", abort);
    try {
      return connectionResultSchema.parse(
        await options.service.execute(
          ownerId,
          body.conversationId,
          body.turnId,
          body.input,
          controller.signal,
        ),
      );
    } finally {
      reply.raw.off("close", abort);
    }
  });
};

function actorId(request: FastifyRequest): string {
  if (!request.authUser || request.authUser.status !== "active")
    throw new AppError("AUTH_REQUIRED");
  return request.authUser.id;
}
