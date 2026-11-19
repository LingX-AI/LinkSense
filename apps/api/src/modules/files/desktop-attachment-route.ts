import { addAbortSignal, type Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import {
  DESKTOP_ATTACHMENT_GRANT_HEADER, desktopAttachmentDownloadPath,
  desktopAttachmentParamsSchema, desktopAttachmentTransferLifetimeMs, desktopRunTokenSchema,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import { parseDesktopAttachmentGrant, type DesktopAttachments } from "./desktop-attachments.js";

export function registerDesktopAttachmentRoute(
  app: FastifyInstance,
  attachments: Pick<DesktopAttachments, "read">,
  leases: Pick<DesktopRunLeases, "authorizeToolResult" | "verifyRunBinding">,
  reserveSlot: () => Promise<() => Promise<void>>,
  checkCommand: (scope: DesktopRunScope, commandId: string) => Promise<void>,
): void {
  app.get(`${desktopAttachmentDownloadPath}/:turnId/:fileId`, {
    exposeHeadRoute: false, handlerTimeout: desktopAttachmentTransferLifetimeMs,
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    if (request.url.includes("?") || request.headers.range !== undefined) throw new AppError("VALIDATION_ERROR");
    const { turnId, fileId } = desktopAttachmentParamsSchema.parse(request.params);
    const bearer = request.headers.authorization;
    const token = desktopRunTokenSchema.safeParse(bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined);
    if (!token.success) throw new AppError("AUTH_REQUIRED");
    const grant = parseDesktopAttachmentGrant(request.headers[DESKTOP_ATTACHMENT_GRANT_HEADER]);

    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(Math.max(0, grant.expiresAt - Date.now()))]);
    const scope = await leases.authorizeToolResult(turnId, token.data);
    const checkRun = async () => {
      await leases.verifyRunBinding(scope, token.data, "use");
      await checkCommand(scope, grant.commandId);
    };
    if (reply.raw.destroyed) throw new AppError("RUNNER_UNAVAILABLE");
    let monitoring = false;
    let releaseSlot: (() => Promise<void>) | undefined;
    let handlerDone = false;
    let responseDone = false;
    let streamDone = true;
    let stream: Readable | undefined;
    const monitor = setInterval(() => {
      if (monitoring || signal.aborted) return;
      monitoring = true;
      void checkRun().catch(() => controller.abort()).finally(() => { monitoring = false; });
    }, 1_000);
    monitor.unref();
    const abortResponse = () => { if (stream && !reply.raw.writableFinished) reply.raw.destroy(); };
    const finished = () => {
      responseDone = true;
      controller.abort();
      release();
    };
    reply.raw.once("finish", finished);
    reply.raw.once("close", finished);
    signal.addEventListener("abort", abortResponse, { once: true });
    try {
      await checkRun();
      signal.throwIfAborted();
      releaseSlot = await reserveSlot();
      signal.throwIfAborted();
      const file = await attachments.read(scope, fileId, grant, signal, checkRun);
      stream = file.stream;
      streamDone = false;
      stream.on("error", () => {
        if (reply.raw.headersSent && !reply.raw.writableFinished) reply.raw.destroy();
      });
      stream.once("close", () => {
        void file.close().catch(() => request.log.warn("desktop attachment file close failed")).finally(() => {
          streamDone = true;
          release();
        });
      });
      if (signal.aborted) {
        stream.destroy();
        signal.throwIfAborted();
      }
      addAbortSignal(signal, stream);
      return reply.header("x-content-type-options", "nosniff").header("content-length", file.byteLength)
        .type("application/octet-stream").send(stream);
    } catch (error) {
      const canceled = signal.aborted;
      controller.abort();
      if (canceled && !(error instanceof AppError)) throw new AppError("RUNNER_UNAVAILABLE");
      throw error;
    } finally {
      handlerDone = true;
      release();
    }

    function release() {
      // A disconnected response can still have an outstanding file read.
      if (!handlerDone || !streamDone || (stream && !responseDone && !signal.aborted)) return;
      clearInterval(monitor);
      signal.removeEventListener("abort", abortResponse);
      reply.raw.off("finish", finished);
      reply.raw.off("close", finished);
      const releaseCurrent = releaseSlot;
      releaseSlot = undefined;
      void releaseCurrent?.().catch(() => request.log.warn("desktop attachment download slot will expire"));
    }
  });
}
