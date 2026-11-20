import { Readable } from "node:stream";

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  desktopArtifactMaxBytes,
  desktopArtifactPath,
  desktopArtifactPathDigestHeader,
  desktopArtifactPathDigestSchema,
  desktopArtifactReceiptSchema,
  desktopArtifactUploadLifetimeMs,
  desktopRunTokenSchema,
} from "@linksense/shared";
import { z } from "zod";

import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { DesktopArtifacts } from "./desktop-artifacts.js";

const artifactParamsSchema = z.strictObject({
  turnId: z.uuid(),
  artifactId: z.uuid(),
});
// The abort signal owns the upload lifetime; this only bounds a service that ignores it.
const handlerTimeoutGraceMs = 5_000;

export type DesktopArtifactRouteOptions = {
  artifacts: Pick<DesktopArtifacts, "upload" | "confirm">;
  leases: Pick<DesktopRunLeases, "authorizeToolResult" | "verifyRunBinding" | "fenceRunBinding">;
  checkPublication(tx: Prisma.TransactionClient, scope: DesktopRunScope): Promise<void>;
};

type AuthorizedArtifact = {
  scope: DesktopRunScope;
  token: string;
  artifactId: string;
};
type AuthorizedConfirmation = AuthorizedArtifact & { desktopSourcePathDigest: string | undefined };
type AuthorizedUpload = AuthorizedArtifact & { contentLength: number };
type RequestLifetime = { signal: AbortSignal; dispose: () => void };

export const registerDesktopArtifactRoutes: FastifyPluginAsync<DesktopArtifactRouteOptions> = async (app, options) => {
  // Keep the raw-body parser inside this plugin so no other route changes how bodies arrive.
  await app.register(async (scoped) => {
    scoped.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
      // Hand the untouched request stream to the route; nothing here may buffer an upload.
      done(null, payload);
    });
    scoped.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });

    const uploads = new WeakMap<FastifyRequest, AuthorizedUpload>();
    const confirmations = new WeakMap<FastifyRequest, AuthorizedConfirmation>();

    const authorize = async (request: FastifyRequest): Promise<AuthorizedArtifact> => {
      if (request.url.includes("?")) throw new AppError("VALIDATION_ERROR");
      const { turnId, artifactId } = artifactParamsSchema.parse(request.params);
      const header = request.headers.authorization;
      const token = desktopRunTokenSchema.safeParse(
        typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined,
      );
      if (!token.success) throw new AppError("AUTH_REQUIRED");
      // The scope comes only from the run lease, never from path, query or headers.
      const scope = await options.leases.authorizeToolResult(turnId, token.data);
      await options.leases.verifyRunBinding(scope, token.data, "use");
      return { scope, token: token.data, artifactId };
    };

    scoped.put(`${desktopArtifactPath}/:turnId/:artifactId/upload`, {
      exposeHeadRoute: false,
      bodyLimit: desktopArtifactMaxBytes,
      handlerTimeout: desktopArtifactUploadLifetimeMs + handlerTimeoutGraceMs,
      onRequest: async (request) => {
        const authorized = await authorize(request);
        uploads.set(request, { ...authorized, contentLength: uploadContentLength(request) });
      },
    }, async (request, reply) => {
      const authorized = uploads.get(request);
      const stream = request.body;
      if (!authorized || !(stream instanceof Readable)) throw new AppError("VALIDATION_ERROR");
      const lifetime = requestLifetime(reply, desktopArtifactUploadLifetimeMs);
      try {
        await options.artifacts.upload(
          authorized.scope,
          authorized.artifactId,
          authorized.contentLength,
          stream,
          lifetime.signal,
          async () => {
            await options.leases.verifyRunBinding(authorized.scope, authorized.token, "use");
            lifetime.signal.throwIfAborted();
          },
        );
        if (lifetime.signal.aborted) throw abortedRequest(request);
        return reply.code(204).send();
      } catch (error) {
        rethrowCancellation(request, reply, lifetime.signal, error);
      } finally {
        lifetime.dispose();
      }
    });

    scoped.post(`${desktopArtifactPath}/:turnId/:artifactId/confirm`, {
      exposeHeadRoute: false,
      handlerTimeout: desktopArtifactUploadLifetimeMs + handlerTimeoutGraceMs,
      onRequest: async (request) => {
        const authorized = await authorize(request);
        assertNoRequestBody(request);
        confirmations.set(request, {
          ...authorized,
          desktopSourcePathDigest: confirmationPathDigest(request),
        });
      },
    }, async (request, reply) => {
      const authorized = confirmations.get(request);
      if (!authorized) throw new AppError("VALIDATION_ERROR");
      const lifetime = requestLifetime(reply, desktopArtifactUploadLifetimeMs);
      try {
        const receipt = await options.artifacts.confirm(
          authorized.scope,
          authorized.artifactId,
          lifetime.signal,
          async () => {
            await options.leases.verifyRunBinding(authorized.scope, authorized.token, "use");
            lifetime.signal.throwIfAborted();
          },
          async (tx) => {
            await options.checkPublication(tx, authorized.scope);
            await options.leases.fenceRunBinding(authorized.scope, authorized.token);
            lifetime.signal.throwIfAborted();
          },
          authorized.desktopSourcePathDigest,
        );
        if (lifetime.signal.aborted) throw abortedRequest(request);
        const parsed = desktopArtifactReceiptSchema.parse(receipt);
        if (parsed.artifact_id.toLowerCase() !== authorized.artifactId.toLowerCase()) {
          throw new AppError("INTERNAL_ERROR");
        }
        return reply.code(200).send(parsed);
      } catch (error) {
        rethrowCancellation(request, reply, lifetime.signal, error);
      } finally {
        lifetime.dispose();
      }
    });
  });
};

function uploadContentLength(request: FastifyRequest): number {
  const headers = request.headers;
  // No compression and no trailers: the declared length must be the counted length.
  if (headers["content-encoding"] !== undefined || headers.trailer !== undefined ||
      headers["transfer-encoding"] !== undefined) throw new AppError("VALIDATION_ERROR");
  const contentType = headers["content-type"];
  if (typeof contentType !== "string" || contentType.toLowerCase() !== "application/octet-stream") {
    throw new AppError("VALIDATION_ERROR");
  }
  const raw = headers["content-length"];
  if (raw === undefined || !/^[1-9]\d*$/u.test(raw)) throw new AppError("VALIDATION_ERROR");
  const contentLength = Number(raw);
  if (!Number.isSafeInteger(contentLength)) throw new AppError("VALIDATION_ERROR");
  if (contentLength > desktopArtifactMaxBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
  return contentLength;
}

function assertNoRequestBody(request: FastifyRequest): void {
  if (request.headers["transfer-encoding"] !== undefined) throw new AppError("VALIDATION_ERROR");
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined && contentLength !== "0") throw new AppError("VALIDATION_ERROR");
}

/**
 * Optional on the wire: older workers omit it and older APIs ignore it. The
 * digest is validated only after the run binding in `authorize`, and the path
 * itself never leaves the device.
 */
function confirmationPathDigest(request: FastifyRequest): string | undefined {
  const raw = request.headers[desktopArtifactPathDigestHeader];
  if (raw === undefined) return undefined;
  const parsed = desktopArtifactPathDigestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR");
  return parsed.data;
}

function requestLifetime(reply: FastifyReply, milliseconds: number): RequestLifetime {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  timer.unref();
  const disconnect = () => {
    // In this Fastify version request.signal also aborts after a completed POST read, so a
    // client disconnect is only distinguishable on the response side.
    if (!reply.raw.writableFinished) controller.abort();
  };
  reply.raw.once("close", disconnect);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      reply.raw.off("close", disconnect);
    },
  };
}

function abortedRequest(request: FastifyRequest): AppError {
  return new AppError("RUNNER_UNAVAILABLE", undefined, request.raw.complete ? 504 : 408);
}

function rethrowCancellation(request: FastifyRequest, reply: FastifyReply, signal: AbortSignal, error: unknown): never {
  // An error answered before the body ends must not leave the connection reusable.
  if (!request.raw.complete && !reply.sent && !reply.raw.headersSent) reply.header("connection", "close");
  if (signal.aborted && !(error instanceof AppError)) throw abortedRequest(request);
  throw error;
}
