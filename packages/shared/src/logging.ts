import pino, { type Logger, type LoggerOptions } from "pino";

export type LoggerConfiguration = {
  service: string;
  name?: string;
  level?: string;
  pretty?: boolean;
};

/**
 * Structured JSON is the production log format. Development keeps the same
 * fields but renders them through pino-pretty so local terminals stay readable.
 */
export function createLoggerOptions({
  service,
  name,
  level = process.env.LOG_LEVEL ?? "info",
  pretty = process.env.NODE_ENV === "development",
}: LoggerConfiguration): LoggerOptions {
  return {
    level,
    ...(name ? { name } : {}),
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      bindings: (bindings) => ({
        ...bindings,
        service,
        ...(process.env.NODE_ENV ? { env: process.env.NODE_ENV } : {}),
      }),
    },
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: process.stdout.isTTY === true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  };
}

export function createLogger(configuration: LoggerConfiguration): Logger {
  return pino(createLoggerOptions(configuration));
}

export function sanitizeRequestForLog(request: unknown) {
  const value = asRecord(request);
  const headers = asRecord(value.headers);
  const socket = asRecord(value.socket);
  const raw = asRecord(value.raw);
  const rawHeaders = asRecord(raw.headers);
  const rawSocket = asRecord(raw.socket);
  const host =
    stringValue(value.host) ??
    stringValue(headers.host) ??
    stringValue(rawHeaders.host);
  const requestId = stringValue(value.id);
  const remoteAddress =
    stringValue(value.ip) ??
    stringValue(value.remoteAddress) ??
    stringValue(socket.remoteAddress) ??
    stringValue(rawSocket.remoteAddress);
  const remotePort =
    numberValue(value.remotePort) ??
    numberValue(socket.remotePort) ??
    numberValue(rawSocket.remotePort);
  return {
    method: stringValue(value.method) ?? "UNKNOWN",
    url: requestPathname(stringValue(value.url) ?? "/")
      .replace(/^\/html-preview\/[^/]+/u, "/html-preview/[redacted]")
      .replace(/^\/web\/_protected\/.*$/u, "/web/_protected/[redacted]"),
    ...(host ? { host } : {}),
    ...(requestId ? { requestId } : {}),
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(remotePort !== undefined ? { remotePort } : {}),
  };
}

function requestPathname(value: string): string {
  try {
    return new URL(value, "http://linksense.invalid").pathname;
  } catch {
    return value.split(/[?#]/u, 1)[0] || "/";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
