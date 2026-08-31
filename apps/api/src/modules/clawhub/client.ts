import { createHash } from "node:crypto";

import pLimit from "p-limit";
import { z } from "zod";

import {
  CLAWHUB_BASE_URL,
  CLAWHUB_FILE_BYTE_LIMIT,
  CLAWHUB_VERSION_FILE_COUNT_LIMIT,
  CLAWHUB_VERSION_TOTAL_BYTE_LIMIT,
  ClawHubAmbiguousSkillError,
  ClawHubClientError,
  clawHubAmbiguousSkillResponseSchema,
  clawHubLatestVersionSchema,
  clawHubPlatformMetadataSchema,
  clawHubSkillCoreSchema,
  clawHubSkillDetailResponseSchema,
  clawHubSkillListResponseSchema,
  clawHubSkillPackageListResponseSchema,
  clawHubStatsSchema,
  clawHubVersionDetailResponseSchema,
  clawHubVersionFileSchema,
  type ClawHubClientOptions,
  type ClawHubDownloadVersionFilesInput,
  type ClawHubDownloadedFile,
  type ClawHubDownloadedVersion,
  type ClawHubLatestVersion,
  type ClawHubListSkillPackagesInput,
  type ClawHubListSkillsInput,
  type ClawHubPlatformMetadata,
  type ClawHubRawFileResponse,
  type ClawHubSkillDetail,
  type ClawHubSkillIdentityInput,
  type ClawHubSkillListItem,
  type ClawHubSkillListPage,
  type ClawHubSkillPackage,
  type ClawHubSkillPackageListPage,
  type ClawHubSkillSummary,
  type ClawHubStats,
  type ClawHubVersionDetail,
  type ClawHubVersionFile,
  type ClawHubVersionFileInput,
  type ClawHubVersionIdentityInput,
} from "./types.js";

const JSON_RESPONSE_BYTE_LIMIT = 16 * 1024 * 1024;
const ERROR_RESPONSE_BYTE_LIMIT = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
const VERSION_FILE_DOWNLOAD_CONCURRENCY = 4;
const USER_AGENT = "LinkSense-ClawHub-Client/1.0";

const cursorSchema = z.string().min(1).max(32_768);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) => !/[\\/?#]/u.test(value) && !hasAsciiControlCharacters(value),
  );
const ownerHandleSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@+/u, "").toLowerCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) =>
          !/[\\/?#]/u.test(value) && !hasAsciiControlCharacters(value),
      ),
  );
const versionSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) => !/[\\/?#]/u.test(value) && !hasAsciiControlCharacters(value),
  );
const listSkillsInputSchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(200),
  sort: z
    .enum([
      "updated",
      "recommended",
      "createdAt",
      "downloads",
      "stars",
      "name",
      "trending",
    ])
    .default("name"),
  signal: z.custom<AbortSignal>().optional(),
});
const listSkillPackagesInputSchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(100),
  sort: z
    .enum(["updated", "recommended", "trending", "downloads"])
    .default("updated"),
  signal: z.custom<AbortSignal>().optional(),
});
const skillIdentityInputSchema = z.object({
  ownerHandle: ownerHandleSchema,
  slug: slugSchema,
  signal: z.custom<AbortSignal>().optional(),
});
const versionIdentityInputSchema = skillIdentityInputSchema.extend({
  version: versionSchema,
});
const versionFileInputSchema = versionIdentityInputSchema.extend({
  path: z.string().min(1).max(2_048),
});

type RawSkillListResponse = z.infer<typeof clawHubSkillListResponseSchema>;
type RawSkillDetailResponse = z.infer<typeof clawHubSkillDetailResponseSchema>;
type RawVersionDetailResponse = z.infer<
  typeof clawHubVersionDetailResponseSchema
>;

type RequestResult = {
  bytes: Buffer;
  headers: Headers;
};

export class ClawHubClient {
  readonly #requestTimeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxRetryDelayMs: number;
  readonly #fetcher: typeof fetch;
  readonly #sleep: (delayMs: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: ClawHubClientOptions = {}) {
    this.#requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      1,
      120_000,
      "requestTimeoutMs",
    );
    this.#maxAttempts = boundedInteger(
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      1,
      5,
      "maxAttempts",
    );
    this.#maxRetryDelayMs = boundedInteger(
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      1,
      5 * 60_000,
      "maxRetryDelayMs",
    );
    this.#fetcher = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? sleep;
    this.#random = options.random ?? Math.random;
  }

  /**
   * This legacy catalog has no publisher identity today. Consumers must not
   * use unresolved items as installable identities; full sync uses
   * listSkillPackages instead.
   */
  async listSkills(
    input: ClawHubListSkillsInput = {},
  ): Promise<ClawHubSkillListPage> {
    const parsed = parseInput(listSkillsInputSchema, input);
    const url = clawHubUrl("/api/v1/skills");
    url.searchParams.set("limit", String(parsed.limit));
    url.searchParams.set("sort", parsed.sort);
    if (parsed.cursor !== undefined) {
      url.searchParams.set("cursor", parsed.cursor);
    }
    const response = await this.#requestJson(
      url,
      clawHubSkillListResponseSchema,
      parsed.signal,
    );
    return {
      items: response.items.map(normalizeSkillListItem),
      nextCursor: response.nextCursor,
    };
  }

  /** Returns publisher-qualified skill identities for complete catalog sync. */
  async listSkillPackages(
    input: ClawHubListSkillPackagesInput = {},
  ): Promise<ClawHubSkillPackageListPage> {
    const parsed = parseInput(listSkillPackagesInputSchema, input);
    const url = clawHubUrl("/api/v1/packages");
    url.searchParams.set("family", "skill");
    url.searchParams.set("limit", String(parsed.limit));
    url.searchParams.set("sort", parsed.sort);
    if (parsed.cursor !== undefined) {
      url.searchParams.set("cursor", parsed.cursor);
    }
    const response = await this.#requestJson(
      url,
      clawHubSkillPackageListResponseSchema,
      parsed.signal,
    );
    return {
      items: response.items.map(normalizeSkillPackage),
      nextCursor: response.nextCursor,
    };
  }

  async getSkillDetail(
    input: ClawHubSkillIdentityInput,
  ): Promise<ClawHubSkillDetail> {
    const parsed = parseInput(skillIdentityInputSchema, input);
    const url = skillDetailUrl(parsed.slug);
    url.searchParams.set("ownerHandle", parsed.ownerHandle);
    const response = await this.#requestJson(
      url,
      clawHubSkillDetailResponseSchema,
      parsed.signal,
    );
    return normalizeSkillDetail(response, parsed.slug, parsed.ownerHandle);
  }

  /**
   * Resolves a legacy unqualified slug. A 409 ambiguity response is expanded
   * into one owner-qualified detail request per match instead of failing the
   * complete catalog crawl.
   */
  async getSkillDetailsForSlug(
    slug: string,
    signal?: AbortSignal,
  ): Promise<ClawHubSkillDetail[]> {
    const parsedSlug = parseInput(slugSchema, slug);
    try {
      return [await this.#getUnqualifiedSkillDetail(parsedSlug, signal)];
    } catch (error) {
      if (!(error instanceof ClawHubAmbiguousSkillError)) throw error;
      const identities = deduplicateAmbiguousMatches(error.matches);
      const limit = pLimit(4);
      return Promise.all(
        identities.map((identity) =>
          limit(() =>
            this.getSkillDetail({
              ownerHandle: identity.ownerHandle,
              slug: identity.slug,
              ...(signal === undefined ? {} : { signal }),
            }),
          ),
        ),
      );
    }
  }

  async getVersionDetail(
    input: ClawHubVersionIdentityInput,
  ): Promise<ClawHubVersionDetail> {
    const parsed = parseInput(versionIdentityInputSchema, input);
    const url = clawHubUrl(
      `/api/v1/skills/${encodeURIComponent(parsed.slug)}/versions/${encodeURIComponent(parsed.version)}`,
    );
    url.searchParams.set("ownerHandle", parsed.ownerHandle);
    const response = await this.#requestJson(
      url,
      clawHubVersionDetailResponseSchema,
      parsed.signal,
    );
    return normalizeVersionDetail(response, parsed.ownerHandle, parsed.version);
  }

  async getVersionFile(
    input: ClawHubVersionFileInput,
  ): Promise<ClawHubRawFileResponse> {
    const parsed = parseInput(versionFileInputSchema, input);
    assertSafeRelativeFilePath(parsed.path);
    const url = clawHubUrl(
      `/api/v1/skills/${encodeURIComponent(parsed.slug)}/file`,
    );
    url.searchParams.set("ownerHandle", parsed.ownerHandle);
    url.searchParams.set("version", parsed.version);
    url.searchParams.set("path", parsed.path);
    const response = await this.#request(
      url,
      CLAWHUB_FILE_BYTE_LIMIT,
      "application/octet-stream, text/*;q=0.9, */*;q=0.8",
      parsed.signal,
    );
    const contentSha256 = optionalSha256Header(
      response.headers.get("x-content-sha256"),
    );
    const contentSize = optionalSizeHeader(
      response.headers.get("x-content-size"),
    );
    if (contentSize !== null && contentSize !== response.bytes.byteLength) {
      throw new ClawHubClientError(
        "INTEGRITY_MISMATCH",
        `ClawHub file size header did not match ${parsed.path}`,
      );
    }
    if (
      contentSha256 !== null &&
      sha256(response.bytes) !== contentSha256
    ) {
      throw new ClawHubClientError(
        "INTEGRITY_MISMATCH",
        `ClawHub file checksum header did not match ${parsed.path}`,
      );
    }
    return {
      bytes: response.bytes,
      contentType: response.headers.get("content-type") ?? "",
      contentSha256,
      contentSize,
    };
  }

  async downloadVersionFiles(
    input: ClawHubDownloadVersionFilesInput,
  ): Promise<ClawHubDownloadedVersion> {
    const identity = parseInput(versionIdentityInputSchema, input);
    const files =
      input.files === undefined
        ? (
            await this.getVersionDetail({
              ownerHandle: identity.ownerHandle,
              slug: identity.slug,
              version: identity.version,
              ...(identity.signal === undefined
                ? {}
                : { signal: identity.signal }),
            })
          ).version.files
        : parseManifestFiles(input.files);
    validateManifest(files);

    const controller = new AbortController();
    const abortFromCaller = (): void =>
      controller.abort(identity.signal?.reason);
    identity.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (identity.signal?.aborted) abortFromCaller();

    const downloaded = new Array<ClawHubDownloadedFile>(files.length);
    let nextFileIndex = 0;
    let failed = false;
    let firstError: unknown;
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      firstError = error;
      controller.abort(error);
    };
    const worker = async (): Promise<void> => {
      try {
        while (!failed && !controller.signal.aborted) {
          const fileIndex = nextFileIndex;
          if (fileIndex >= files.length) return;
          nextFileIndex += 1;
          const file = files[fileIndex];
          if (file === undefined) return;

          try {
            const response = await this.getVersionFile({
              ownerHandle: identity.ownerHandle,
              slug: identity.slug,
              version: identity.version,
              path: file.path,
              signal: controller.signal,
            });
            const actualSha256 = sha256(response.bytes);
            if (
              response.bytes.byteLength !== file.size ||
              actualSha256 !== file.sha256
            ) {
              throw new ClawHubClientError(
                "INTEGRITY_MISMATCH",
                `ClawHub file did not match the exact version manifest: ${file.path}`,
              );
            }
            downloaded[fileIndex] = {
              ...file,
              bytes: response.bytes,
              responseContentType: response.contentType,
            };
          } catch (error) {
            fail(error);
            return;
          }
        }
      } catch (error) {
        fail(error);
      }
    };

    try {
      await Promise.allSettled(
        Array.from(
          {
            length: Math.min(
              VERSION_FILE_DOWNLOAD_CONCURRENCY,
              files.length,
            ),
          },
          worker,
        ),
      );
    } finally {
      identity.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (failed) throw firstError;
    if (identity.signal?.aborted) {
      throw new ClawHubClientError(
        "REQUEST_ABORTED",
        "ClawHub request was aborted",
      );
    }
    return {
      ownerHandle: identity.ownerHandle,
      slug: identity.slug,
      version: identity.version,
      files: downloaded,
    };
  }

  async #getUnqualifiedSkillDetail(
    slug: string,
    signal?: AbortSignal,
  ): Promise<ClawHubSkillDetail> {
    const response = await this.#requestJson(
      skillDetailUrl(slug),
      clawHubSkillDetailResponseSchema,
      signal,
    );
    return normalizeSkillDetail(response, slug);
  }

  async #requestJson<T>(
    url: URL,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.#request(
      url,
      JSON_RESPONSE_BYTE_LIMIT,
      "application/json",
      signal,
    );
    let value: unknown;
    try {
      value = JSON.parse(response.bytes.toString("utf8"));
    } catch (error) {
      throw new ClawHubClientError(
        "INVALID_RESPONSE",
        "ClawHub returned malformed JSON",
        { cause: error },
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ClawHubClientError(
        "INVALID_RESPONSE",
        "ClawHub response did not match the documented contract",
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  async #request(
    url: URL,
    byteLimit: number,
    accept: string,
    signal?: AbortSignal,
  ): Promise<RequestResult> {
    assertClawHubUrl(url);
    for (let attempt = 0; attempt < this.#maxAttempts; attempt += 1) {
      if (signal?.aborted) {
        throw new ClawHubClientError(
          "REQUEST_ABORTED",
          "ClawHub request was aborted",
        );
      }
      let response: Response;
      let timedOut = false;
      const controller = new AbortController();
      const abortFromCaller = (): void => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.#requestTimeoutMs);
      timeout.unref();
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      };
      try {
        response = await this.#fetcher(url, {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            accept,
            "user-agent": USER_AGENT,
          },
        });
      } catch (error) {
        cleanup();
        const requestError = classifyTransportError(
          error,
          signal,
          timedOut,
          "ClawHub request failed",
        );
        if (!requestError.retryable || attempt + 1 >= this.#maxAttempts) {
          throw requestError;
        }
        await this.#waitForRetry(exponentialRetryDelay(attempt), signal);
        continue;
      }

      if (!response.ok) {
        let responseBody: string;
        try {
          responseBody = await readErrorBody(response);
          if (timedOut || signal?.aborted) {
            throw classifyTransportError(
              new Error("Response body read was aborted"),
              signal,
              timedOut,
              "ClawHub error response stream failed",
            );
          }
        } catch (error) {
          cleanup();
          const requestError =
            error instanceof ClawHubClientError
              ? error
              : classifyTransportError(
                  error,
                  signal,
                  timedOut,
                  "ClawHub error response stream failed",
                );
          if (!requestError.retryable || attempt + 1 >= this.#maxAttempts) {
            throw requestError;
          }
          await this.#waitForRetry(exponentialRetryDelay(attempt), signal);
          continue;
        }
        cleanup();
        const ambiguous = parseAmbiguousSkillError(
          response.status,
          responseBody,
        );
        if (ambiguous !== null) throw ambiguous;
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt + 1 < this.#maxAttempts) {
          const delay =
            response.status === 429
              ? rateLimitRetryDelay(response.headers, attempt)
              : exponentialRetryDelay(attempt);
          await this.#waitForRetry(delay, signal);
          continue;
        }
        const upstreamCode = parseUpstreamErrorCode(responseBody);
        throw new ClawHubClientError(
          "HTTP_ERROR",
          responseBody || `ClawHub returned HTTP ${response.status}`,
          {
            status: response.status,
            responseBody,
            retryable,
            ...(upstreamCode === undefined ? {} : { upstreamCode }),
          },
        );
      }

      try {
        const bytes = await readResponseBytes(response, byteLimit);
        if (timedOut || signal?.aborted) {
          throw classifyTransportError(
            new Error("Response body read was aborted"),
            signal,
            timedOut,
            "ClawHub response stream failed",
          );
        }
        cleanup();
        return {
          bytes,
          headers: response.headers,
        };
      } catch (error) {
        cleanup();
        const requestError =
          error instanceof ClawHubClientError
            ? error
            : classifyTransportError(
                error,
                signal,
                timedOut,
                "ClawHub response stream failed",
              );
        if (!requestError.retryable || attempt + 1 >= this.#maxAttempts) {
          throw requestError;
        }
        await this.#waitForRetry(exponentialRetryDelay(attempt), signal);
      }
    }
    throw new ClawHubClientError(
      "NETWORK_ERROR",
      "ClawHub request exhausted its retry budget",
      { retryable: true },
    );
  }

  async #waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
    const positiveDelay = Math.max(0, delayMs);
    const jitter = Math.floor(positiveDelay * 0.1 * clampRandom(this.#random()));
    await this.#sleep(Math.min(positiveDelay + jitter, this.#maxRetryDelayMs));
    if (signal?.aborted) {
      throw new ClawHubClientError(
        "REQUEST_ABORTED",
        "ClawHub request was aborted",
      );
    }
  }
}

function normalizeSkillListItem(
  raw: RawSkillListResponse["items"][number],
): ClawHubSkillListItem {
  const base = normalizeSkillSummary(raw, raw.latestVersion, raw.metadata ?? null);
  if (raw.ownerHandle === undefined) {
    return {
      ...base,
      upstreamSkillId: null,
      identityResolved: false,
      ownerHandle: null,
    };
  }
  return {
    ...base,
    identityResolved: true,
    ownerHandle: normalizeOwnerHandle(raw.ownerHandle),
  };
}

function normalizeSkillPackage(
  raw: z.infer<typeof clawHubSkillPackageListResponseSchema>["items"][number],
): ClawHubSkillPackage {
  const ownerHandle = normalizeOwnerHandle(raw.ownerHandle);
  return {
    upstreamSkillId: normalizeUpstreamId(raw.id ?? raw._id ?? null),
    ownerHandle,
    slug: raw.name,
    displayName: raw.displayName,
    summary: raw.summary,
    latestVersion: raw.latestVersion,
    categories: [...(raw.categories ?? [])],
    topics: [...(raw.topics ?? [])],
    channel: raw.channel,
    isOfficial: raw.isOfficial,
    verificationTier: raw.verificationTier ?? null,
    stats: normalizeStats(raw.stats),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    canonicalUrl: canonicalSkillUrl(ownerHandle, raw.name),
  };
}

function normalizeSkillDetail(
  raw: RawSkillDetailResponse,
  requestedSlug: string,
  expectedOwnerHandle?: string,
): ClawHubSkillDetail {
  const ownerHandle = normalizeOwnerHandle(raw.owner.handle);
  if (
    expectedOwnerHandle !== undefined &&
    ownerHandle !== normalizeOwnerHandle(expectedOwnerHandle)
  ) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub resolved a skill to an unexpected publisher",
    );
  }
  const summary = normalizeSkillSummary(
    {
      ...raw.skill,
      id: raw.skill.id ?? raw.id ?? raw.skillId,
      _id: raw.skill._id ?? raw._id,
    },
    raw.latestVersion,
    raw.metadata,
  );
  return {
    ...summary,
    requestedSlug,
    owner: {
      handle: ownerHandle,
      userId: raw.owner.userId ?? null,
      displayName: raw.owner.displayName ?? null,
      image: raw.owner.image ?? null,
    },
    moderation: raw.moderation ?? null,
    canonicalUrl: canonicalSkillUrl(ownerHandle, raw.skill.slug),
  };
}

function normalizeSkillSummary(
  raw: z.infer<typeof clawHubSkillCoreSchema>,
  latestVersion: z.infer<typeof clawHubLatestVersionSchema> | null,
  metadata: z.infer<typeof clawHubPlatformMetadataSchema> | null,
): ClawHubSkillSummary {
  return {
    upstreamSkillId: normalizeUpstreamId(raw.id ?? raw._id ?? null),
    slug: raw.slug,
    displayName: raw.displayName,
    summary: raw.summary,
    description: raw.description ?? null,
    icon: raw.icon ?? null,
    topics: [...(raw.topics ?? [])],
    tags: { ...(raw.tags ?? {}) },
    stats: normalizeStats(raw.stats),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    latestVersion: normalizeLatestVersion(latestVersion),
    metadata: normalizePlatformMetadata(metadata),
  };
}

function normalizeVersionDetail(
  raw: RawVersionDetailResponse,
  ownerHandle: string,
  expectedVersion: string,
): ClawHubVersionDetail {
  if (raw.version.version !== expectedVersion) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub resolved an unexpected skill version",
    );
  }
  return {
    ownerHandle,
    upstreamSkillId: normalizeUpstreamId(raw.skill.id ?? raw.skill._id ?? null),
    skill: {
      slug: raw.skill.slug,
      displayName: raw.skill.displayName,
    },
    version: {
      upstreamVersionId: normalizeUpstreamId(
        raw.version.id ?? raw.version._id ?? null,
      ),
      version: raw.version.version,
      createdAt: raw.version.createdAt,
      changelog: raw.version.changelog ?? null,
      changelogSource: raw.version.changelogSource ?? null,
      license: raw.version.license ?? null,
      files: raw.version.files,
      security: raw.version.security ?? null,
    },
  };
}

function normalizeStats(
  stats: z.infer<typeof clawHubStatsSchema>,
): ClawHubStats {
  return {
    comments: stats.comments ?? 0,
    downloads: stats.downloads ?? 0,
    installs: stats.installs ?? 0,
    stars: stats.stars ?? 0,
    versions: stats.versions ?? 0,
  };
}

function normalizeLatestVersion(
  value: z.infer<typeof clawHubLatestVersionSchema> | null,
): ClawHubLatestVersion | null {
  return value === null
    ? null
    : {
        version: value.version,
        createdAt: value.createdAt,
        changelog: value.changelog ?? null,
        license: value.license ?? null,
      };
}

function normalizePlatformMetadata(
  value: z.infer<typeof clawHubPlatformMetadataSchema> | null,
): ClawHubPlatformMetadata | null {
  return value === null
    ? null
    : {
        os: value.os ?? null,
        systems: value.systems ?? null,
      };
}

function normalizeOwnerHandle(value: string): string {
  return value.trim().replace(/^@+/u, "").toLowerCase();
}

function normalizeUpstreamId(value: string | null): string | null {
  if (value === null) return null;
  return value.startsWith("clawhub:") ? value.slice("clawhub:".length) : value;
}

function canonicalSkillUrl(ownerHandle: string, slug: string): string {
  return `${CLAWHUB_BASE_URL}/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(slug)}`;
}

function clawHubUrl(pathname: string): URL {
  return new URL(pathname, CLAWHUB_BASE_URL);
}

function skillDetailUrl(slug: string): URL {
  return clawHubUrl(`/api/v1/skills/${encodeURIComponent(slug)}`);
}

function assertClawHubUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.origin !== CLAWHUB_BASE_URL ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new ClawHubClientError(
      "INVALID_INPUT",
      "ClawHub requests must use the fixed public HTTPS origin",
    );
  }
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ClawHubClientError("INVALID_INPUT", "Invalid ClawHub input", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function parseManifestFiles(
  files: readonly ClawHubVersionFile[],
): ClawHubVersionFile[] {
  const parsed = z
    .array(clawHubVersionFileSchema)
    .max(CLAWHUB_VERSION_FILE_COUNT_LIMIT)
    .safeParse(files);
  if (!parsed.success) {
    throw new ClawHubClientError(
      "INVALID_MANIFEST",
      "ClawHub version file manifest is invalid",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function validateManifest(files: readonly ClawHubVersionFile[]): void {
  if (files.length > CLAWHUB_VERSION_FILE_COUNT_LIMIT) {
    throw new ClawHubClientError(
      "INVALID_MANIFEST",
      "ClawHub version file manifest contains too many files",
    );
  }
  const normalizedPaths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    assertSafeRelativeFilePath(file.path, "INVALID_MANIFEST");
    const collisionKey = file.path.normalize("NFC").toLowerCase();
    if (normalizedPaths.has(collisionKey)) {
      throw new ClawHubClientError(
        "INVALID_MANIFEST",
        `ClawHub version file manifest contains a duplicate path: ${file.path}`,
      );
    }
    normalizedPaths.add(collisionKey);
    if (file.size > CLAWHUB_FILE_BYTE_LIMIT) {
      throw new ClawHubClientError(
        "INVALID_MANIFEST",
        `ClawHub version file exceeds the public file limit: ${file.path}`,
      );
    }
    totalBytes += file.size;
    if (totalBytes > CLAWHUB_VERSION_TOTAL_BYTE_LIMIT) {
      throw new ClawHubClientError(
        "INVALID_MANIFEST",
        "ClawHub version file manifest exceeds the total byte limit",
      );
    }
  }
}

function assertSafeRelativeFilePath(
  path: string,
  kind: "INVALID_INPUT" | "INVALID_MANIFEST" = "INVALID_INPUT",
): void {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    hasAsciiControlCharacters(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    /^[a-zA-Z]:/u.test(path)
  ) {
    throw new ClawHubClientError(kind, `Unsafe ClawHub file path: ${path}`);
  }
}

function deduplicateAmbiguousMatches(
  matches: ClawHubAmbiguousSkillError["matches"],
): Array<{ ownerHandle: string; slug: string }> {
  const seen = new Set<string>();
  const identities: Array<{ ownerHandle: string; slug: string }> = [];
  for (const match of matches) {
    const ownerHandle = normalizeOwnerHandle(match.ownerHandle);
    const key = `${ownerHandle}\u0000${match.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({ ownerHandle, slug: match.slug });
  }
  return identities;
}

function parseAmbiguousSkillError(
  status: number,
  responseBody: string,
): ClawHubAmbiguousSkillError | null {
  if (status !== 409) return null;
  let value: unknown;
  try {
    value = JSON.parse(responseBody);
  } catch {
    return null;
  }
  const parsed = clawHubAmbiguousSkillResponseSchema.safeParse(value);
  return parsed.success
    ? new ClawHubAmbiguousSkillError(
        parsed.data.slug,
        parsed.data.matches,
        parsed.data.message,
        responseBody,
      )
    : null;
}

function parseUpstreamErrorCode(responseBody: string): string | undefined {
  try {
    const value: unknown = JSON.parse(responseBody);
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string"
    ) {
      return value.code;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function classifyTransportError(
  cause: unknown,
  signal: AbortSignal | undefined,
  timedOut: boolean,
  networkMessage: string,
): ClawHubClientError {
  if (signal?.aborted) {
    return new ClawHubClientError(
      "REQUEST_ABORTED",
      "ClawHub request was aborted",
      { cause },
    );
  }
  if (timedOut) {
    return new ClawHubClientError(
      "REQUEST_TIMEOUT",
      "ClawHub request timed out",
      { cause, retryable: true },
    );
  }
  return new ClawHubClientError("NETWORK_ERROR", networkMessage, {
    cause,
    retryable: true,
  });
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await readResponseBytes(response, ERROR_RESPONSE_BYTE_LIMIT)).toString(
      "utf8",
    );
  } catch (error) {
    if (
      error instanceof ClawHubClientError &&
      error.kind === "RESPONSE_TOO_LARGE"
    ) {
      return "ClawHub error response exceeded the configured limit";
    }
    throw error;
  }
}

async function readResponseBytes(
  response: Response,
  byteLimit: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ClawHubClientError(
      "RESPONSE_TOO_LARGE",
      "ClawHub response exceeded the configured byte limit",
    );
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > byteLimit) {
        await reader.cancel();
        throw new ClawHubClientError(
          "RESPONSE_TOO_LARGE",
          "ClawHub response exceeded the configured byte limit",
        );
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function optionalSha256Header(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub returned an invalid content checksum header",
    );
  }
  return normalized;
}

function optionalSizeHeader(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/u.test(value.trim())) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub returned an invalid content size header",
    );
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub returned an invalid content size header",
    );
  }
  return size;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rateLimitRetryDelay(headers: Headers, attempt: number): number {
  return (
    parseDelaySeconds(headers.get("retry-after")) ??
    parseDelaySeconds(headers.get("ratelimit-reset")) ??
    parseAbsoluteReset(headers.get("x-ratelimit-reset")) ??
    exponentialRetryDelay(attempt)
  );
}

function parseDelaySeconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function parseAbsoluteReset(value: string | null): number | null {
  if (value === null) return null;
  const epochSeconds = Number(value);
  return Number.isFinite(epochSeconds) && epochSeconds >= 0
    ? Math.max(0, Math.ceil(epochSeconds * 1_000 - Date.now()))
    : null;
}

function exponentialRetryDelay(attempt: number): number {
  return 250 * 2 ** attempt;
}

function clampRandom(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ClawHubClientError(
      "INVALID_INPUT",
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function hasAsciiControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}
