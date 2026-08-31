import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  weixinConnectionUpdateInputSchema,
  weixinLoginStartInputSchema,
  weixinVerificationInputSchema,
} from "@linksense/shared";

import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { WeixinService } from "./service.js";

const paramsSchema = z.strictObject({ id: z.uuid() });
const WEIXIN_CONTROL_BODY_LIMIT = 16 * 1_024;

export const weixinRoutes: FastifyPluginAsync<{
  service: Pick<
    WeixinService,
    | "deleteConnection"
    | "getLogin"
    | "list"
    | "startLogin"
    | "submitVerification"
    | "updateConnection"
  >;
}> = async (app, { service }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(ok(await service.list(user.id), request));
  });

  app.post(
    "/login-sessions",
    { bodyLimit: WEIXIN_CONTROL_BODY_LIMIT },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const login = await service.startLogin(
        user.id,
        weixinLoginStartInputSchema.parse(request.body),
      );
      return reply.code(201).send(ok(login, request));
    },
  );

  app.get("/login-sessions/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = paramsSchema.parse(request.params);
    return reply.send(ok(await service.getLogin(user.id, id), request));
  });

  app.post(
    "/login-sessions/:id/verification",
    { bodyLimit: WEIXIN_CONTROL_BODY_LIMIT },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id } = paramsSchema.parse(request.params);
      const { verify_code: verifyCode } = weixinVerificationInputSchema.parse(
        request.body,
      );
      return reply.send(
        ok(await service.submitVerification(user.id, id, verifyCode), request),
      );
    },
  );

  app.patch(
    "/:id",
    { bodyLimit: WEIXIN_CONTROL_BODY_LIMIT },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id } = paramsSchema.parse(request.params);
      return reply.send(
        ok(
          await service.updateConnection(
            user.id,
            id,
            weixinConnectionUpdateInputSchema.parse(request.body),
            auditContext(request),
          ),
          request,
        ),
      );
    },
  );

  app.delete("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = paramsSchema.parse(request.params);
    await service.deleteConnection(user.id, id, auditContext(request));
    return reply.code(204).send();
  });
};

function auditContext(request: FastifyRequest) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
