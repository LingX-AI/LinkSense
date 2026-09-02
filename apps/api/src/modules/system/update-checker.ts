import {
  systemReleaseSchema,
  type SystemRelease,
  type SystemUpdateCheckErrorCode,
  type SystemUpdateStatus,
} from "@linksense/shared"
import semver from "semver"
import { z } from "zod"

import type { LinkSenseRedis } from "../../adapters/redis.js"

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/LingX-AI/linksense/releases/latest"
const GITHUB_API_VERSION = "2022-11-28"
const GITHUB_RESPONSE_MAX_BYTES = 1_000_000
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
const FAILED_CHECK_RETRY_INTERVAL_MS = 5 * 60 * 1_000
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const REQUEST_TIMEOUT_MS = 5_000

const githubReleaseSchema = z
  .object({
    tag_name: z.string(),
    name: z.string().nullable(),
    body: z.string().nullable(),
    draft: z.literal(false),
    prerelease: z.literal(false),
    published_at: z.iso.datetime(),
    html_url: z.url(),
  })
  .passthrough()

const cachedUpdateCheckSchema = z.strictObject({
  etag: z.string().max(500).nullable(),
  release: systemReleaseSchema.nullable(),
  checked_at: z.iso.datetime(),
  next_check_at: z.iso.datetime(),
  error_code: z
    .enum([
      "GITHUB_UNAVAILABLE",
      "GITHUB_RATE_LIMITED",
      "GITHUB_RESPONSE_INVALID",
    ])
    .nullable(),
})

type CachedUpdateCheck = z.infer<typeof cachedUpdateCheckSchema>
type UpdateCheckCache = Pick<
  LinkSenseRedis,
  "getSystemUpdateCache" | "setSystemUpdateCache"
>

export class SystemUpdateChecker {
  #inFlight: Promise<SystemUpdateStatus> | null = null

  constructor(
    private readonly currentVersion: string,
    private readonly cache: UpdateCheckCache,
    private readonly options: {
      fetch?: typeof fetch
      now?: () => Date
      automaticCheckIntervalMs?: number
      failedCheckRetryIntervalMs?: number
      requestTimeoutMs?: number
    } = {},
  ) {}

  async getStatus(forceRefresh = false): Promise<SystemUpdateStatus> {
    const now = this.#now()
    const cached = await this.#readCache()
    if (
      !forceRefresh &&
      cached &&
      Date.parse(cached.next_check_at) > now.getTime()
    ) {
      return this.#projectCache(cached)
    }
    if (this.#inFlight) return this.#inFlight
    const check = this.#check(cached, now).finally(() => {
      if (this.#inFlight === check) this.#inFlight = null
    })
    this.#inFlight = check
    return check
  }

  async #check(
    cached: CachedUpdateCheck | null,
    checkedAt: Date,
  ): Promise<SystemUpdateStatus> {
    try {
      const response = await (this.options.fetch ?? fetch)(
        GITHUB_LATEST_RELEASE_URL,
        {
          method: "GET",
          redirect: "error",
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "LinkSense-update-checker",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          },
          signal: AbortSignal.timeout(
            this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
          ),
        },
      )

      if (response.status === 304) {
        if (!cached?.release) throw new InvalidGitHubReleaseError()
        return await this.#storeSuccess(
          cached.release,
          cached.etag,
          checkedAt,
        )
      }
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0")
      ) {
        throw new GitHubReleaseError("GITHUB_RATE_LIMITED")
      }
      if (!response.ok) throw new GitHubReleaseError("GITHUB_UNAVAILABLE")

      const contentLength = Number(response.headers.get("content-length"))
      if (
        Number.isFinite(contentLength) &&
        contentLength > GITHUB_RESPONSE_MAX_BYTES
      ) {
        throw new InvalidGitHubReleaseError()
      }
      const body = await response.text()
      if (Buffer.byteLength(body, "utf8") > GITHUB_RESPONSE_MAX_BYTES) {
        throw new InvalidGitHubReleaseError()
      }
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        throw new InvalidGitHubReleaseError()
      }
      const parsed = githubReleaseSchema.safeParse(json)
      if (!parsed.success) throw new InvalidGitHubReleaseError()
      const release = systemReleaseSchema.safeParse({
        version: parsed.data.tag_name,
        name: parsed.data.name?.trim() || parsed.data.tag_name,
        published_at: parsed.data.published_at,
        url: parsed.data.html_url,
        release_notes: parsed.data.body?.trim() || null,
      })
      if (!release.success) throw new InvalidGitHubReleaseError()
      return await this.#storeSuccess(
        release.data,
        response.headers.get("etag"),
        checkedAt,
      )
    } catch (error) {
      const errorCode =
        error instanceof GitHubReleaseError
          ? error.code
          : "GITHUB_UNAVAILABLE"
      const failure: CachedUpdateCheck = {
        etag: cached?.etag ?? null,
        release: cached?.release ?? null,
        checked_at: checkedAt.toISOString(),
        next_check_at: new Date(
          checkedAt.getTime() +
            (this.options.failedCheckRetryIntervalMs ??
              FAILED_CHECK_RETRY_INTERVAL_MS),
        ).toISOString(),
        error_code: errorCode,
      }
      await this.#writeCache(failure)
      return this.#projectCache(failure)
    }
  }

  async #storeSuccess(
    release: SystemRelease,
    etag: string | null,
    checkedAt: Date,
  ): Promise<SystemUpdateStatus> {
    const success: CachedUpdateCheck = {
      etag,
      release,
      checked_at: checkedAt.toISOString(),
      next_check_at: new Date(
        checkedAt.getTime() +
          (this.options.automaticCheckIntervalMs ??
            AUTOMATIC_CHECK_INTERVAL_MS),
      ).toISOString(),
      error_code: null,
    }
    await this.#writeCache(success)
    return this.#projectCache(success)
  }

  #projectCache(cached: CachedUpdateCheck): SystemUpdateStatus {
    if (cached.error_code || !cached.release) {
      return {
        status: "check_failed",
        current_version: this.currentVersion,
        latest_release: null,
        checked_at: cached.checked_at,
        error_code: cached.error_code ?? "GITHUB_RESPONSE_INVALID",
      }
    }
    return {
      status: semver.gt(cached.release.version, this.currentVersion)
        ? "update_available"
        : "up_to_date",
      current_version: this.currentVersion,
      latest_release: cached.release,
      checked_at: cached.checked_at,
      error_code: null,
    }
  }

  async #readCache(): Promise<CachedUpdateCheck | null> {
    try {
      const raw = await this.cache.getSystemUpdateCache()
      if (!raw) return null
      const parsed = cachedUpdateCheckSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async #writeCache(value: CachedUpdateCheck): Promise<void> {
    try {
      await this.cache.setSystemUpdateCache(
        JSON.stringify(value),
        CACHE_TTL_SECONDS,
      )
    } catch {
      // Update checks remain best-effort when the shared cache is unavailable.
    }
  }

  #now(): Date {
    return this.options.now?.() ?? new Date()
  }
}

class GitHubReleaseError extends Error {
  constructor(readonly code: SystemUpdateCheckErrorCode) {
    super(code)
    this.name = "GitHubReleaseError"
  }
}

class InvalidGitHubReleaseError extends GitHubReleaseError {
  constructor() {
    super("GITHUB_RESPONSE_INVALID")
  }
}
