import { createHash } from "node:crypto"
import type { promises as dns } from "node:dns"

import type { LinkSenseRedis } from "../../adapters/redis.js"
import {
  fetchPublicHttpResource,
  type DownloadedHttpResource,
} from "../../lib/safe-http-fetch.js"
import {
  detectSafeSiteIcon,
  type SafeSiteIconMimeType,
} from "../../lib/safe-raster-image.js"

const SITE_ICON_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const SITE_ICON_MAX_BYTES = 128 * 1024
const SITE_ICON_REQUEST_TIMEOUT_MS = 1_500
const SITE_ICON_BATCH_SIZE = 4
const SITE_ICON_ACCEPT =
  "image/x-icon, image/vnd.microsoft.icon, image/png, image/jpeg, image/gif, image/webp"
const SITE_ICON_PATHS = [
  "/favicon.ico",
  "/favicon.png",
  "/favicon.webp",
  "/favicon.jpg",
  "/favicon.jpeg",
  "/favicon.gif",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon-48x48.png",
  "/favicon-96x96.png",
  "/favicon-180x180.png",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
  "/icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/logo192.png",
  "/logo512.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/apple-touch-icon-180x180.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/mstile-150x150.png",
  "/assets/favicon.ico",
  "/assets/favicon.png",
  "/images/favicon.ico",
  "/images/favicon.png",
  "/img/favicon.ico",
  "/img/favicon.png",
  "/static/favicon.png",
  "/icons/favicon.png",
] as const

type SiteIconCacheMetadata = {
  mimeType: SafeSiteIconMimeType
  sizeBytes: number
  dataBase64: string
}

export type SiteIcon = {
  data: Buffer
  mimeType: SafeSiteIconMimeType
  sizeBytes: number
}

export type SiteIconServiceOptions = {
  fetcher?: typeof fetch
  lookup?: typeof dns.lookup
  allowBenchmarkProxyAddresses?: boolean
}

export class SiteIconService {
  readonly #fetcher: typeof fetch | undefined
  readonly #lookup: typeof dns.lookup | undefined
  readonly #allowBenchmarkProxyAddresses: boolean

  constructor(
    private readonly cache: Pick<
      LinkSenseRedis,
      "getSiteIconCache" | "setSiteIconCache"
    >,
    options: SiteIconServiceOptions = {},
  ) {
    this.#fetcher = options.fetcher
    this.#lookup = options.lookup
    this.#allowBenchmarkProxyAddresses =
      options.allowBenchmarkProxyAddresses ?? false
  }

  async get(originInput: string): Promise<SiteIcon | null> {
    const origin = normalizeHttpsOrigin(originInput)
    if (!origin) return null

    const cacheKey = cacheKeyForOrigin(origin.origin)
    const cached = await this.#readCached(cacheKey)
    if (cached) return cached

    const downloaded = await this.#download(origin).catch(() => null)
    if (!downloaded) return null

    const mimeType = detectSafeSiteIcon(downloaded.bytes)
    if (!mimeType) return null

    const icon: SiteIcon = {
      data: downloaded.bytes,
      mimeType,
      sizeBytes: downloaded.bytes.byteLength,
    }
    await this.#writeCached(cacheKey, icon).catch(() => undefined)
    return icon
  }

  async #download(origin: URL): Promise<DownloadedHttpResource | null> {
    for (const path of SITE_ICON_PATHS.slice(0, 2)) {
      const downloaded = await this.#fetch(
        new URL(path, origin),
        SITE_ICON_ACCEPT,
        SITE_ICON_MAX_BYTES,
      )
      if (downloaded && detectSafeSiteIcon(downloaded.bytes)) {
        return downloaded
      }
    }

    for (
      let start = 2;
      start < SITE_ICON_PATHS.length;
      start += SITE_ICON_BATCH_SIZE
    ) {
      const downloaded = await Promise.all(
        SITE_ICON_PATHS.slice(start, start + SITE_ICON_BATCH_SIZE).map((path) =>
          this.#fetch(new URL(path, origin), SITE_ICON_ACCEPT, SITE_ICON_MAX_BYTES),
        ),
      )
      const icon = downloaded.find(
        (candidate) => candidate && detectSafeSiteIcon(candidate.bytes),
      )
      if (icon) {
        return icon
      }
    }
    return null
  }

  async #fetch(
    url: URL,
    accept: string,
    byteLimit: number,
  ): Promise<DownloadedHttpResource | null> {
    return fetchPublicHttpResource(url, {
      byteLimit,
      redirectCount: 3,
      requestTimeoutMs: SITE_ICON_REQUEST_TIMEOUT_MS,
      accept,
      userAgent: "LinkSense-Site-Icon/1.0",
      errorCode: "NOT_FOUND",
      allowedProtocols: ["https:"],
      allowBenchmarkProxyAddresses: this.#allowBenchmarkProxyAddresses,
      ...(this.#fetcher === undefined ? {} : { fetcher: this.#fetcher }),
      ...(this.#lookup === undefined ? {} : { lookup: this.#lookup }),
    }).catch(() => null)
  }

  async #readCached(
    cacheKey: string,
  ): Promise<SiteIcon | null> {
    try {
      const value = await this.cache.getSiteIconCache(cacheKey)
      if (!value) return null
      const metadata = parseCacheMetadata(value)
      if (!metadata) return null
      const iconBytes = decodeBase64(metadata.dataBase64)
      if (!iconBytes) return null
      if (iconBytes.byteLength !== metadata.sizeBytes) return null
      if (detectSafeSiteIcon(iconBytes) !== metadata.mimeType) return null
      return {
        data: iconBytes,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
      }
    } catch {
      return null
    }
  }

  async #writeCached(
    cacheKey: string,
    icon: SiteIcon,
  ): Promise<void> {
    const metadata: SiteIconCacheMetadata = {
      mimeType: icon.mimeType,
      sizeBytes: icon.sizeBytes,
      dataBase64: icon.data.toString("base64"),
    }
    await this.cache.setSiteIconCache(
      cacheKey,
      Buffer.from(JSON.stringify(metadata), "utf8"),
      SITE_ICON_CACHE_TTL_SECONDS,
    )
  }
}

function normalizeHttpsOrigin(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.origin === "null"
    ) {
      return null
    }
    return new URL(url.origin)
  } catch {
    return null
  }
}

function cacheKeyForOrigin(origin: string): string {
  return createHash("sha256").update(origin).digest("hex")
}

function parseCacheMetadata(value: Buffer): SiteIconCacheMetadata | null {
  try {
    const parsed: unknown = JSON.parse(value.toString("utf8"))
    if (!isRecord(parsed)) return null
    const { mimeType, sizeBytes, dataBase64 } = parsed
    if (
      !isSiteIconMimeType(mimeType) ||
      !isSafePositiveInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > SITE_ICON_MAX_BYTES ||
      typeof dataBase64 !== "string" ||
      dataBase64.length === 0 ||
      dataBase64.length > Math.ceil(SITE_ICON_MAX_BYTES / 3) * 4
    ) {
      return null
    }
    return { mimeType, sizeBytes, dataBase64 }
  } catch {
    return null
  }
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isSiteIconMimeType(value: unknown): value is SafeSiteIconMimeType {
  return (
    value === "image/gif" ||
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp" ||
    value === "image/x-icon"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodeBase64(value: string): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return null
  }
  const decoded = Buffer.from(value, "base64")
  return decoded.byteLength <= SITE_ICON_MAX_BYTES && decoded.toString("base64") === value
    ? decoded
    : null
}
