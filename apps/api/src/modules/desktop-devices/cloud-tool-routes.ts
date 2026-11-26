import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import {
  DesktopCloudToolError,
  desktopCloudToolExecuteBodySchema,
  type DesktopCloudToolGateway,
} from "./cloud-tools.js";

/**
 * Internal entry point for the cloud runner. Authentication is the shared
 * runner secret plus the owner header; the task, turn, and per-task local-tool
 * flag are rechecked here against PostgreSQL before anything reaches a Mac.
 */
export const internalDesktopCloudToolRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  sharedSecret: string;
  cloudTools: DesktopCloudToolGateway;
  audit: Pick<AuditService, "write">;
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(options.sharedSecret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
  });
  app.post("/local-tools/execute", async (request, reply) => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const body = desktopCloudToolExecuteBodySchema.parse(request.body);
    const actor = await options.prisma.user.findFirst({
      where: { id: ownerId, status: "active" }, select: { id: true },
    });
    if (!actor) throw new AppError("FORBIDDEN");
    const conversation = await options.prisma.conversation.findFirst({
      where: {
        id: body.conversationId, ownerId, archiveStatus: "active",
        executionTarget: "cloud", desktopToolsEnabled: true,
      },
      select: { id: true },
    });
    const turn = conversation
      ? await options.prisma.conversationTurn.findFirst({
          where: { id: body.turnId, conversationId: body.conversationId, status: "running" },
          select: { id: true },
        })
      : null;
    if (!conversation || !turn) throw new AppError("FORBIDDEN");
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", abort);
    if (reply.raw.destroyed) abort();
    try {
      const { deviceId, data } = await options.cloudTools.execute(
        ownerId, body.operation, body.input, controller.signal,
      );
      await options.audit.write({
        actorId: ownerId,
        action: "desktop_tool_requested",
        targetType: "desktop_device",
        targetId: deviceId,
        result: "success",
        metadata: {
          operation: body.operation,
          conversation_id: body.conversationId,
          turn_id: body.turnId,
          device_id: deviceId,
        },
      }).catch(() => undefined);
      return data;
    } catch (error) {
      if (error instanceof DesktopCloudToolError) {
        await options.audit.write({
          actorId: ownerId,
          action: "desktop_tool_requested",
          targetType: "desktop_device",
          targetId: null,
          result: "failed",
          metadata: {
            operation: body.operation,
            conversation_id: body.conversationId,
            turn_id: body.turnId,
            reason_code: error.code,
          },
        }).catch(() => undefined);
        if (error.code === "FORBIDDEN") throw new AppError("FORBIDDEN");
        if (error.code === "CANCELLED") throw new AppError("RUNNER_OPERATION_UNCERTAIN");
        throw new AppError("RUNNER_UNAVAILABLE");
      }
      throw error;
    } finally {
      reply.raw.off("close", abort);
    }
  });
};
