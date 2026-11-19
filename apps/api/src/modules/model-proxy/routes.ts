import { DESKTOP_MODEL_PURPOSE_HEADER, desktopModelPurposeSchema, desktopModelTokenSchema } from "@linksense/shared";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";

import { hmacSha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { DesktopRunScope } from "../desktop-credentials/run-leases.js";
import { subscribeDesktopNotices, type DesktopNotice } from "../desktop-devices/notices.js";
import type { ModelProxyEndpoint } from "./request.js";
import { reserveDesktopModelSlot } from "./request-slots.js";
import { forwardDesktopModel, withinModelDeadline, type DesktopModelDependencies } from "./service.js";

const modelPath = z.strictObject({ turnId: z.uuid(), purpose: desktopModelPurposeSchema });
const requestLimit = 16 * 1024 * 1024;
const requestDeadlineMs = 180_000;

type ProxyOptions = Pick<DesktopModelDependencies, "leases" | "settings" | "creditLimits" | "privacyMasking" | "fetcher"> & {
  redis: Redis;
  rateLimitSecret: string;
  deadlineMs?: number;
};

function matchesRevocation(scope: DesktopRunScope, notice: DesktopNotice): boolean {
  if (notice.type === "run_revoked") return notice.turnId === scope.turnId;
  if (notice.deviceId !== scope.deviceId) return false;
  if (notice.type === "revoked") return true;
  return (notice.type === "replaced" ? notice.supersededConnectionId : notice.connectionId) === scope.connectionId;
}

function turnMetadata(request: FastifyRequest): string | undefined {
  const value = request.headers["x-codex-turn-metadata"];
  return typeof value === "string" ? value : undefined;
}

function authorization(request: FastifyRequest) {
  if (request.url.includes("?")) throw new AppError("VALIDATION_ERROR");
  const path = modelPath.parse(request.params);
  const bearer = request.headers.authorization;
  const token = desktopModelTokenSchema.safeParse(bearer?.startsWith("Bearer ") ? bearer.slice(7) : null);
  if (!token.success) throw new AppError("AUTH_REQUIRED");
  if (request.headers[DESKTOP_MODEL_PURPOSE_HEADER] !== path.purpose) throw new AppError("FORBIDDEN");
  return { ...path, token: token.data };
}

export const desktopModelProxyRoutes: FastifyPluginAsync<ProxyOptions> = async (app, options) => {
  // Track only this process's response handles. Redis and the run authority own authorization.
  const active = new Set<{ scope: DesktopRunScope; revoke: () => void }>();
  let subscription: Promise<() => void> | undefined;
  let closing = false;
  const revokeAll = () => {
    for (const stream of active) stream.revoke();
  };
  const watchRevocation: DesktopModelDependencies["watchRevocation"] = async (scope, revoke) => {
    if (closing) throw new AppError("RUNNER_UNAVAILABLE");
    if (!subscription) {
      const pending = subscribeDesktopNotices(options.redis, notice => {
        for (const stream of active) {
          if (matchesRevocation(stream.scope, notice)) stream.revoke();
        }
      }, () => {
        if (subscription !== pending) return;
        subscription = undefined;
        revokeAll();
      });
      subscription = pending;
    }
    const pending = subscription;
    const stream = { scope, revoke };
    active.add(stream);
    try {
      await pending;
      if (subscription !== pending || closing) throw new AppError("RUNNER_UNAVAILABLE");
      return () => { active.delete(stream); };
    } catch {
      active.delete(stream);
      if (subscription === pending) subscription = undefined;
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  };
  app.addHook("preClose", async () => {
    closing = true;
    revokeAll();
    const close = await subscription?.catch(() => undefined);
    close?.();
  });
  const requests = new WeakMap<FastifyRequest, { signal: AbortSignal; ownerId?: string }>();
  const requestState = (request: FastifyRequest) => {
    const current = requests.get(request);
    if (!current) throw new AppError("RUNNER_UNAVAILABLE");
    return current;
  };
  await app.register(rateLimit, {
    global: false,
    redis: options.redis,
    max: 90,
    timeWindow: "1 minute",
    nameSpace: "linksense:desktop-model-proxy:",
    skipOnError: false,
    keyGenerator: request => {
      const { ownerId } = requestState(request);
      if (!ownerId) throw new AppError("AUTH_REQUIRED");
      return hmacSha256(options.rateLimitSecret, "desktop-model-owner:", ownerId);
    },
  });
  const checkRateLimit = app.createRateLimit();
  for (const endpoint of ["responses", "chat/completions"] satisfies ModelProxyEndpoint[]) {
    app.post(`/:turnId/:purpose/${endpoint}`, {
      bodyLimit: requestLimit,
      onRequest: (request, reply, done) => {
        requests.set(request, { signal: requestDeadline(request, reply, options.deadlineMs ?? requestDeadlineMs) });
        reply.header("cache-control", "no-store");
        done();
      },
      preParsing: async (request, reply, payload) => {
        const state = requestState(request);
        const grant = await withinModelDeadline(
          options.leases.authorizeModel(authorization(request)),
          AbortSignal.any([state.signal, AbortSignal.timeout(2_000)]),
        );
        state.ownerId = grant.scope.ownerId;
        const limit = await withinModelDeadline(checkRateLimit(request), state.signal);
        if (!limit.isAllowed && limit.isExceeded) {
          reply.header("retry-after", limit.ttlInSeconds);
          throw new AppError("RUNNER_UNAVAILABLE", undefined, 429);
        }
        return payload;
      },
    }, async (request, reply) => {
      const result = await forwardDesktopModel({
        ...options,
        reserveSlot: turnId => reserveDesktopModelSlot(options.redis, turnId),
        watchRevocation,
        onSlotReleaseFailure: () => request.log.warn("desktop model concurrency slot will expire"),
      }, authorization(request), endpoint, request.body, requestState(request).signal, turnMetadata(request));
      if (!result.ok) return reply.code(result.status).send({
        error: {
          code: result.code,
          ...((result.code === "usage_limit_reached" || result.code === "usage_not_included") && { type: result.code }),
        },
      });
      return reply.type(result.contentType).send(result.stream);
    });
  }
};

function requestDeadline(request: FastifyRequest, reply: FastifyReply, milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    if (reply.sent || reply.raw.destroyed) return;
    if (reply.raw.headersSent) {
      reply.raw.destroy();
      return;
    }
    reply.header("connection", "close");
    void reply.send(new AppError("RUNNER_UNAVAILABLE", undefined, request.raw.complete ? 504 : 408));
  }, milliseconds);
  timer.unref();
  reply.raw.once("close", () => {
    clearTimeout(timer);
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}
