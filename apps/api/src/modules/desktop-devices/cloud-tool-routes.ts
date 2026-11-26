import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  desktopCloudToolInvocationSchema,
  localFilesRootsOperation,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import {
  DesktopCloudToolError,
  desktopCloudToolExecuteBodySchema,
  type DesktopCloudToolGateway,
} from "./cloud-tools.js";
import type { DesktopFileRootService } from "./file-roots.js";

const writeFileOperations = new Set([
  "local_files.write",
  "local_files.create",
  "local_files.delete",
]);

/**
 * Internal entry point for the cloud runner. Authentication is the shared
 * runner secret plus the owner header; the task, turn, per-task local-tool
 * flag, and file-root grant are rechecked here before anything reaches a Mac.
 */
export const internalDesktopCloudToolRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  sharedSecret: string;
  cloudTools: DesktopCloudToolGateway;
  fileRoots: Pick<DesktopFileRootService, "list" | "resolve">;
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

    if (invocation.operation === localFilesRootsOperation) {
      const startedAt = Date.now();
      const roots = await options.fileRoots.list(ownerId);
      await options.audit.write({
        actorId: ownerId,
        action: "desktop_tool_requested",
        targetType: "desktop_device",
        targetId: null,
        result: "success",
        metadata: {
          operation: invocation.operation,
          conversation_id: body.conversationId,
          turn_id: body.turnId,
          duration_ms: Date.now() - startedAt,
        },
      }).catch(() => undefined);
      return { roots };
    }

    const startedAt = Date.now();
    const rootId = "root_id" in invocation.input ? invocation.input.root_id : null;
    const relativePath = "path" in invocation.input ? invocation.input.path ?? null : null;
    const auditDenied = async (reasonCode: string, rootAlias?: string) => {
      await options.audit.write({
        actorId: ownerId,
        action: "desktop_tool_requested",
        targetType: "desktop_device",
        targetId: null,
        result: "failed",
        metadata: {
          operation: invocation.operation,
          conversation_id: body.conversationId,
          turn_id: body.turnId,
          ...(rootAlias ? { root_alias: rootAlias } : {}),
          ...(relativePath ? { path: relativePath } : {}),
          duration_ms: Date.now() - startedAt,
          reason_code: reasonCode,
        },
      }).catch(() => undefined);
    };
    let root: Awaited<ReturnType<DesktopFileRootService["resolve"]>> | null = null;
    if (rootId !== null) {
      try {
        root = await options.fileRoots.resolve(ownerId, rootId);
      } catch (error) {
        if (error instanceof AppError && error.code === "DESKTOP_FILE_ROOT_NOT_FOUND") {
          await auditDenied("DESKTOP_FILE_ACCESS_DENIED");
          return reply.code(409).send({ error_code: "DESKTOP_FILE_ACCESS_DENIED" });
        }
        throw error;
      }
    }
    if (root && writeFileOperations.has(invocation.operation) && root.mode !== "write") {
      await auditDenied("DESKTOP_FILE_ACCESS_DENIED", root.name);
      throw new AppError("FORBIDDEN");
    }
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", abort);
    if (reply.raw.destroyed) abort();
    const auditMetadata = {
      operation: invocation.operation,
      conversation_id: body.conversationId,
      turn_id: body.turnId,
      ...(root ? { root_alias: root.name } : {}),
      ...(relativePath ? { path: relativePath } : {}),
    };
    try {
      const { deviceId, data } = await options.cloudTools.execute(
        ownerId,
        invocation,
        controller.signal,
        root ? { deviceId: root.deviceId } : {},
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
          targetId: root?.deviceId ?? null,
          result: "failed",
          metadata: {
            ...auditMetadata,
            ...(root ? { device_id: root.deviceId } : {}),
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
