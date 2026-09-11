import { promises as dns } from "node:dns"
import type { LookupAddress } from "node:dns"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP, type LookupFunction } from "node:net"

import type { ErrorCode } from "@linksense/shared"
import ipaddr from "ipaddr.js"

import { AppError } from "./errors.js"

export type HttpProtocol = "http:" | "https:"

export type DownloadedHttpResource = {
  bytes: Buffer
  contentType: string
  finalUrl: URL
}

export type SafeHttpFetchOptions = {
  byteLimit: number
  redirectCount: number
  requestTimeoutMs: number
  accept: string
  userAgent: string
  errorCode: ErrorCode
  headers?: HeadersInit
  signal?: AbortSignal
  responseErrorCode?: (status: number) => ErrorCode | undefined
  allowedProtocols?: readonly HttpProtocol[]
  allowLocalDevelopmentUrls?: boolean
  allowBenchmarkProxyAddresses?: boolean
  fetcher?: typeof fetch
  lookup?: typeof dns.lookup
}

const DEFAULT_ALLOWED_PROTOCOLS: readonly HttpProtocol[] = [
  "http:",
  "https:",
]

/**
 * Downloads a public HTTP resource without allowing the destination hostname
 * to be re-resolved after validation. Every redirect is validated separately.
 */
export async function fetchPublicHttpResource(
  url: URL,
  options: SafeHttpFetchOptions,
): Promise<DownloadedHttpResource> {
  const lookup = options.lookup ?? dns.lookup
  const allowedProtocols = options.allowedProtocols ?? DEFAULT_ALLOWED_PROTOCOLS
  let current = new URL(url)

  for (let redirects = 0; redirects <= options.redirectCount; redirects += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)
    timeout.unref()
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal
    const headers = new Headers(options.headers)
    headers.set("accept", options.accept)
    headers.set("accept-encoding", "identity")
    headers.set("user-agent", options.userAgent)
    let response: Response | undefined

    try {
      const addresses = await resolvePublicHttpAddresses(
        current,
        lookup,
        allowedProtocols,
        options.errorCode,
        options.allowBenchmarkProxyAddresses ?? false,
        options.allowLocalDevelopmentUrls ?? false,
        signal,
      )
      response =
        options.fetcher === undefined
          ? await pinnedHttpFetch({
              url: current,
              addresses,
              signal,
              byteLimit: options.byteLimit,
              headers,
              errorCode: options.errorCode,
            })
          : await options.fetcher(current, {
              method: "GET",
              redirect: "manual",
              signal,
              headers,
            })

      if (isRedirectStatus(response.status)) {
        if (redirects === options.redirectCount) {
          throw new AppError(options.errorCode)
        }
        const location = response.headers.get("location")
        if (!location) throw new AppError(options.errorCode)
        current = new URL(location, current)
        continue
      }

      const responseErrorCode = options.responseErrorCode?.(response.status)
      if (responseErrorCode !== undefined) {
        throw new AppError(responseErrorCode)
      }
      if (!response.ok || response.body === null) {
        throw new AppError(options.errorCode)
      }

      const declaredLength = Number(response.headers.get("content-length"))
      if (Number.isFinite(declaredLength) && declaredLength > options.byteLimit) {
        await response.body.cancel()
        throw new AppError(options.errorCode)
      }

      return {
        bytes: await readResponseWithLimit(
          response.body,
          options.byteLimit,
          options.errorCode,
        ),
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: current,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(options.errorCode)
    } finally {
      clearTimeout(timeout)
      // Redirects and rejected responses are not consumed. Release their body
      // as well, including when an injected fetch transport is used.
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => undefined)
      }
    }
  }

  throw new AppError(options.errorCode)
}

export async function assertPublicHttpUrl(
  url: URL,
  lookup: typeof dns.lookup = dns.lookup,
): Promise<void> {
  await resolvePublicHttpAddresses(
    url,
    lookup,
    DEFAULT_ALLOWED_PROTOCOLS,
    "IMPORT_FAILED",
    false,
    false,
  )
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  let parsed = ipaddr.parse(address)
  if (parsed.kind() === "ipv6") {
    const parsedV6 = parsed as ipaddr.IPv6
    if (parsedV6.isIPv4MappedAddress()) parsed = parsedV6.toIPv4Address()
  }
  return parsed.range() === "unicast"
}

export function isBenchmarkProxyAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  let parsed = ipaddr.parse(address)
  if (parsed.kind() === "ipv6") {
    const parsedV6 = parsed as ipaddr.IPv6
    if (!parsedV6.isIPv4MappedAddress()) return false
    parsed = parsedV6.toIPv4Address()
  }
  return (
    parsed.kind() === "ipv4" &&
    (parsed as ipaddr.IPv4).match(
      ipaddr.parse("198.18.0.0") as ipaddr.IPv4,
      15,
    )
  )
}

async function resolvePublicHttpAddresses(
  url: URL,
  lookup: typeof dns.lookup,
  allowedProtocols: readonly HttpProtocol[],
  errorCode: ErrorCode,
  allowBenchmarkProxyAddresses: boolean,
  allowLocalDevelopmentUrls: boolean,
  signal?: AbortSignal,
): Promise<LookupAddress[]> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, "")
  const isLocalDevelopmentTarget =
    allowLocalDevelopmentUrls && isExplicitLocalDevelopmentHostname(hostname)
  const isAllowedProtocol = allowedProtocols.includes(
    url.protocol as HttpProtocol,
  )
  if (
    !isAllowedProtocol &&
    !(url.protocol === "http:" && isLocalDevelopmentTarget)
  ) {
    throw new AppError(errorCode)
  }
  if (url.username !== "" || url.password !== "") {
    throw new AppError(errorCode)
  }
  if (
    !isLocalDevelopmentTarget &&
    ((url.protocol === "http:" && url.port !== "" && url.port !== "80") ||
      (url.protocol === "https:" && url.port !== "" && url.port !== "443"))
  ) {
    throw new AppError(errorCode)
  }

  const allowProxyResolution =
    allowBenchmarkProxyAddresses && isIP(hostname) === 0
  let addresses: LookupAddress[]
  try {
    addresses = await waitForLookup(
      lookup(hostname, { all: true, verbatim: true }),
      signal,
      errorCode,
    )
  } catch {
    throw new AppError(errorCode)
  }

  if (
    addresses.length === 0 ||
    (isLocalDevelopmentTarget
      ? addresses.some(({ address }) => !isLoopbackAddress(address))
      : addresses.some(
          ({ address }) =>
            !isPublicAddress(address) &&
            !(allowProxyResolution && isBenchmarkProxyAddress(address)),
        ))
  ) {
    throw new AppError(errorCode)
  }
  return addresses
}

function isExplicitLocalDevelopmentHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

function isLoopbackAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  let parsed = ipaddr.parse(address)
  if (parsed.kind() === "ipv6") {
    const parsedV6 = parsed as ipaddr.IPv6
    if (parsedV6.isIPv4MappedAddress()) parsed = parsedV6.toIPv4Address()
  }
  return parsed.range() === "loopback"
}

async function waitForLookup<T>(
  lookupPromise: Promise<T>,
  signal: AbortSignal | undefined,
  errorCode: ErrorCode,
): Promise<T> {
  if (!signal) return lookupPromise
  if (signal.aborted) throw new AppError(errorCode)
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(new AppError(errorCode))
    }
    signal.addEventListener("abort", abort, { once: true })
    void lookupPromise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

async function readResponseWithLimit(
  body: ReadableStream<Uint8Array>,
  byteLimit: number,
  errorCode: ErrorCode,
): Promise<Buffer> {
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > byteLimit) {
        await reader.cancel()
        throw new AppError(errorCode)
      }
      chunks.push(Buffer.from(result.value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

function pinnedHttpFetch({
  url,
  addresses,
  signal,
  byteLimit,
  headers,
  errorCode,
}: {
  url: URL
  addresses: LookupAddress[]
  signal: AbortSignal
  byteLimit: number
  headers: Headers
  errorCode: ErrorCode
}): Promise<Response> {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses)
      return
    }
    const requestedFamily =
      typeof options.family === "number" && options.family !== 0
        ? options.family
        : undefined
    const selected =
      addresses.find(
        (address) =>
          requestedFamily === undefined || address.family === requestedFamily,
      ) ?? addresses[0]
    if (selected === undefined) {
      callback(new Error("No validated DNS address is available."), "", 0)
      return
    }
    callback(null, selected.address, selected.family)
  }

  const request = url.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: "GET",
        // A global keep-alive agent can reuse a socket that was resolved before
        // this request. Disable pooling so every request uses this request's
        // validated, pinned DNS lookup result.
        agent: false,
        lookup,
        signal,
        headers: Object.fromEntries(headers.entries()),
      },
      (incoming) => {
        // Attach before validation or early destruction. A stream error is not
        // caught by the Promise executor or the caller's surrounding try/catch.
        incoming.once("error", reject)
        void readPinnedHttpResponse(incoming, byteLimit, errorCode).then(resolve, reject)
      },
    )
    outgoing.once("error", reject)
    outgoing.end()
  })
}

async function readPinnedHttpResponse(
  incoming: IncomingMessage,
  byteLimit: number,
  errorCode: ErrorCode,
): Promise<Response> {
  try {
    const status = incoming.statusCode ?? 500
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(name, value)
      else if (Array.isArray(value)) headers.set(name, value.join(", "))
    }
    // Fetch forbids a body (even an empty Buffer) for these final statuses.
    if (isRedirectStatus(status) || status === 204 || status === 205 || status === 304) {
      return new Response(null, { status, headers })
    }

    const declaredLength = Number(headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
      throw new AppError(errorCode)
    }

    const chunks: Buffer[] = []
    let size = 0
    // Node's async iterator propagates stream errors and premature closure as
    // rejections. Parsing and Response construction stay in this async scope.
    for await (const chunk of incoming) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += bytes.length
      if (size > byteLimit) throw new AppError(errorCode)
      chunks.push(bytes)
    }
    return new Response(Buffer.concat(chunks, size), { status, headers })
  } finally {
    incoming.destroy()
  }
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status)
}
