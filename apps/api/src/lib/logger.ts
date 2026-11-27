import type { Logger, LoggerOptions } from "pino";
import {
  LogController,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  createLogger as createServiceLogger,
  createLoggerOptions as createServiceLoggerOptions,
  sanitizeRequestForLog,
  type LoggerConfiguration,
} from "@linksense/shared/logging";

type ApiLoggerConfiguration = Omit<LoggerConfiguration, "service">;

export { sanitizeRequestForLog };

export function createLoggerOptions(
  configuration: ApiLoggerConfiguration = {},
): LoggerOptions {
  return createServiceLoggerOptions({ service: "api", ...configuration });
}

export function createLogger(name?: string): Logger {
  return createServiceLogger({ service: "api", ...(name ? { name } : {}) });
}

/**
 * Emit one sanitized completion line per request instead of Fastify's default
 * incoming/completed pair. Error paths keep the error attached to the request.
 */
export class ApiLogController extends LogController {
  override incomingRequest(): void {
    // The completion line already carries method, path, status, and duration.
  }

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (this.isLogDisabled(request)) return;
    const fields = {
      ...requestLogFields(request, reply),
      ...(error ? { err: error } : {}),
    };
    if (error) reply.log.error(fields, "request failed");
    else reply.log.info(fields, "request completed");
  }

  override routeNotFound(request: FastifyRequest): void {
    if (this.isLogDisabled(request)) return;
    const { method, url } = sanitizeRequestForLog(request);
    request.log.info({ method, url }, "route not found");
  }
}

function requestLogFields(request: FastifyRequest, reply: FastifyReply) {
  const { method, url, remoteAddress } = sanitizeRequestForLog(request);
  return {
    method,
    url,
    statusCode: reply.statusCode,
    responseTime_ms: Math.round(reply.elapsedTime),
    ...(remoteAddress ? { remoteAddress } : {}),
  };
}
