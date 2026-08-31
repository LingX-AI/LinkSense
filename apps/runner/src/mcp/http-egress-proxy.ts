import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import type { FastifyReply, FastifyRequest } from "fastify"

export type UserMcpProxyTarget = {
  url: string
  startupTimeoutMs: number
  toolTimeoutMs: number
  auth:
    | { type: "none" }
    | { type: "bearer"; value: string }
    | { type: "api_key"; headerName: string; value: string }
  requestHeaders?: ReadonlyArray<{ name: string; value: string }>
}

export class UserMcpProxyRequestError extends Error {
  constructor(readonly code: "DESTINATION_FORBIDDEN" | "UPSTREAM_UNAVAILABLE") {
    super(code)
    this.name = "UserMcpProxyRequestError"
  }
}

const REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
] as const

const RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "retry-after",
] as const

const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u
const RESERVED_INJECTED_HEADERS = new Set([
  ...REQUEST_HEADER_ALLOWLIST,
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export async function proxyUserMcpHttpRequest(
  target: UserMcpProxyTarget,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const url = validateTargetUrl(target.url)
  const headers: Record<string, string> = {}
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = request.headers[name]
    if (typeof value === "string") headers[name] = value
    else if (Array.isArray(value)) headers[name] = value.join(", ")
  }
  if (target.auth.type === "bearer") {
    headers.authorization = `Bearer ${target.auth.value}`
  } else if (target.auth.type === "api_key") {
    headers[target.auth.headerName] = target.auth.value
  }
  const primaryAuthHeader =
    target.auth.type === "bearer"
      ? "authorization"
      : target.auth.type === "api_key"
        ? target.auth.headerName.toLowerCase()
        : null
  const injectedNames = new Set<string>()
  for (const header of target.requestHeaders ?? []) {
    const normalizedName = header.name.toLowerCase()
    if (
      !HTTP_HEADER_NAME_PATTERN.test(header.name) ||
      header.value.length === 0 ||
      /[\r\n]/u.test(header.value) ||
      RESERVED_INJECTED_HEADERS.has(normalizedName) ||
      normalizedName === primaryAuthHeader ||
      injectedNames.has(normalizedName)
    ) {
      throw new UserMcpProxyRequestError("DESTINATION_FORBIDDEN")
    }
    injectedNames.add(normalizedName)
    headers[header.name] = header.value
  }

  const body = serializeRequestBody(request.body)
  const requestTimeoutMs = isInitializeRequest(request.body)
    ? target.startupTimeoutMs
    : target.toolTimeoutMs
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest
  await new Promise<void>((resolve, reject) => {
    const outgoing = transport(
      url,
      {
        method: request.method,
        headers,
        agent: false,
      },
      (incoming) => {
        const statusCode = incoming.statusCode ?? 502
        if (statusCode >= 300 && statusCode < 400) {
          incoming.destroy()
          reject(new UserMcpProxyRequestError("DESTINATION_FORBIDDEN"))
          return
        }
        const responseHeaders: Record<string, string> = {}
        for (const name of RESPONSE_HEADER_ALLOWLIST) {
          const value = incoming.headers[name]
          if (typeof value === "string") responseHeaders[name] = value
          else if (Array.isArray(value)) responseHeaders[name] = value.join(", ")
        }
        reply.hijack()
        reply.raw.writeHead(statusCode, responseHeaders)
        incoming.pipe(reply.raw)
        incoming.once("end", resolve)
        incoming.once("aborted", () =>
          reject(new UserMcpProxyRequestError("UPSTREAM_UNAVAILABLE"))
        )
        incoming.once("error", () =>
          reject(new UserMcpProxyRequestError("UPSTREAM_UNAVAILABLE"))
        )
      }
    )
    outgoing.once("error", () =>
      reject(new UserMcpProxyRequestError("UPSTREAM_UNAVAILABLE"))
    )
    outgoing.setTimeout(requestTimeoutMs, () => {
      outgoing.destroy(new UserMcpProxyRequestError("UPSTREAM_UNAVAILABLE"))
    })
    const abort = () => outgoing.destroy()
    request.raw.once("aborted", abort)
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) abort()
    })
    if (body) outgoing.write(body)
    outgoing.end()
  })
}

function isInitializeRequest(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "method" in value &&
    value.method === "initialize"
  )
}

function validateTargetUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UserMcpProxyRequestError("DESTINATION_FORBIDDEN")
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new UserMcpProxyRequestError("DESTINATION_FORBIDDEN")
  }
  return url
}

function serializeRequestBody(value: unknown): Buffer | undefined {
  if (value === undefined || value === null) return undefined
  if (Buffer.isBuffer(value)) return value
  if (typeof value === "string") return Buffer.from(value)
  return Buffer.from(JSON.stringify(value))
}
