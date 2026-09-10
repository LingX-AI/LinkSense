import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { pipeline } from "node:stream/promises"

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
    let incomingResponse: IncomingMessage | undefined
    let settled = false
    let hijacked = false
    const finish = (error?: UserMcpProxyRequestError) => {
      if (settled) return
      settled = true
      request.raw.off("aborted", fail)
      reply.raw.off("close", onDownstreamClose)
      reply.raw.off("error", fail)
      if (error) {
        incomingResponse?.destroy()
        outgoing.destroy()
        if (hijacked) reply.raw.destroy()
        reject(error)
      } else {
        resolve()
      }
    }
    const fail = () => finish(new UserMcpProxyRequestError("UPSTREAM_UNAVAILABLE"))
    const onDownstreamClose = () => {
      if (!reply.raw.writableFinished) fail()
    }
    const outgoing = transport(
      url,
      {
        method: request.method,
        headers,
        agent: false,
      },
      (incoming) => {
        incomingResponse = incoming
        // Error handlers must exist before header validation or early teardown.
        incoming.once("error", fail)
        incoming.once("aborted", fail)
        if (settled) {
          incoming.destroy()
          return
        }
        try {
          const statusCode = incoming.statusCode ?? 502
          if (statusCode >= 300 && statusCode < 400) {
            finish(new UserMcpProxyRequestError("DESTINATION_FORBIDDEN"))
            return
          }
          const responseHeaders: Record<string, string> = {}
          for (const name of RESPONSE_HEADER_ALLOWLIST) {
            const value = incoming.headers[name]
            if (typeof value === "string") responseHeaders[name] = value
            else if (Array.isArray(value)) responseHeaders[name] = value.join(", ")
          }
          reply.hijack()
          hijacked = true
          reply.raw.writeHead(statusCode, responseHeaders)
          // pipeline propagates both upstream and downstream stream failures;
          // plain pipe only handles backpressure, not error containment.
          void pipeline(incoming, reply.raw).then(() => finish(), fail)
        } catch {
          fail()
        }
      }
    )
    outgoing.once("error", fail)
    outgoing.setTimeout(requestTimeoutMs, fail)
    request.raw.once("aborted", fail)
    reply.raw.once("error", fail)
    reply.raw.once("close", onDownstreamClose)
    if (body) outgoing.write(body)
    outgoing.end()
  }).catch((error: unknown) => {
    if (error instanceof UserMcpProxyRequestError) throw error
    throw new UserMcpProxyRequestError("UPSTREAM_UNAVAILABLE")
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
