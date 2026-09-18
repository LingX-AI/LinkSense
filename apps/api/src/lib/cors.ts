import type { FastifyCorsOptions } from "@fastify/cors"
import { SERVER_BUILD_HEADER } from "@linksense/shared"

export function createApiCorsOptions(
  publicBaseUrl: string,
): FastifyCorsOptions {
  const allowedOrigin = new URL(publicBaseUrl).origin

  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      callback(null, origin === allowedOrigin)
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    exposedHeaders: [SERVER_BUILD_HEADER],
  }
}

export function sseCorsHeaders(
  requestOrigin: string | undefined,
  publicBaseUrl: string,
): Record<string, string> {
  if (!requestOrigin) return {}
  const allowedOrigin = new URL(publicBaseUrl).origin
  if (requestOrigin !== allowedOrigin) return {}
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": SERVER_BUILD_HEADER,
    vary: "Origin",
  }
}
