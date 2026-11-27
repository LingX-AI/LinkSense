import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  browserUseFailure,
  browserUseResultSchema,
  desktopCloudToolInvocationSchema,
  localBrowserExecuteOperation,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import {
  DesktopCloudToolError,
  desktopCloudToolExecuteBodySchema,
  type DesktopCloudToolGateway,
} from "./cloud-tools.js";
import type { BrowserUseService } from "../browser-use/service.js";

/**
 * Internal entry point for the cloud runner. Authentication is the shared
 * runner secret plus the owner header; the account, conversation, running turn
 * and online Mac are rechecked here before anything reaches a Mac. The Mac
 * enforces the conversation's folder grant.
 */
export const internalDesktopCloudToolRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  sharedSecret: string;
  cloudTools: DesktopCloudToolGateway;
  browser: Pick<BrowserUseService, "execute">;
  audit: Pick<AuditService, "write">;
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(options.sharedSecret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
  });
  app.post("/local-tools/execute", { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const body = desktopCloudToolExecuteBodySchema.parse(request.body);
    const invocation = desktopCloudToolInvocationSchema.parse({
      operation: body.operation,
      input: body.input,
    });
    const actor = await options.prisma.user.findFirst({
      where: { id: ownerId, status: "active" }, select: { id: true },
    });
    if (!actor) throw new AppError("FORBIDDEN");
    const conversation = await options.prisma.conversation.findFirst({
      where: {
        id: body.conversationId, ownerId, archiveStatus: "active",
        executionTarget: "cloud",
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

    const startedAt = Date.now();
    if (invocation.operation === localBrowserExecuteOperation) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
      reply.raw.once("close", abort);
      if (reply.raw.destroyed) abort();
      try {
        const result = invocation.input.action === "open_site"
          ? browserUseFailure("BROWSER_USE_ACCESS_DENIED")
          : browserUseResultSchema.parse(await options.browser.execute(
              ownerId, body.conversationId, invocation.input, controller.signal,
            ));
        await options.audit.write({
          actorId: ownerId,
          action: "desktop_tool_requested",
          targetType: "desktop_device",
          targetId: null,
          result: result.ok ? "success" : "failed",
          metadata: {
            operation: invocation.operation,
            conversation_id: body.conversationId,
            turn_id: body.turnId,
            browser_action: invocation.input.action,
            duration_ms: Date.now() - startedAt,
            ...(result.ok ? {} : { reason_code: result.code }),
          },
        }).catch(() => undefined);
        return result;
      } finally {
        reply.raw.off("close", abort);
      }
    }

    const relativePath = "path" in invocation.input ? invocation.input.path ?? null : null;
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", abort);
    if (reply.raw.destroyed) abort();
    const auditMetadata = {
      operation: invocation.operation,
      conversation_id: body.conversationId,
      turn_id: body.turnId,
      ...(relativePath ? { path: relativePath } : {}),
    };
    try {
      const { deviceId, data } = await options.cloudTools.execute(
        ownerId,
        body.conversationId,
        invocation,
        controller.signal,
      );
      await options.audit.write({
        actorId: ownerId,
        action: "desktop_tool_requested",
        targetType: "desktop_device",
        targetId: deviceId,
        result: "success",
        metadata: {
          ...auditMetadata,
          device_id: deviceId,
          duration_ms: Date.now() - startedAt,
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
            ...auditMetadata,
            duration_ms: Date.now() - startedAt,
            reason_code: error.code,
          },
        }).catch(() => undefined);
        if (error.code === "FORBIDDEN") throw new AppError("FORBIDDEN");
        if (error.code === "CANCELLED") throw new AppError("RUNNER_OPERATION_UNCERTAIN");
        if (error.code.startsWith("DESKTOP_FILE_")) {
          return reply.code(409).send({ error_code: error.code });
        }
        throw new AppError("RUNNER_UNAVAILABLE");
      }
      throw error;
    } finally {
      reply.raw.off("close", abort);
    }
  });
};
