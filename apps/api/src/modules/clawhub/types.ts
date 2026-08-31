import { z } from "zod";

export const CLAWHUB_BASE_URL = "https://clawhub.ai";
export const CLAWHUB_FILE_BYTE_LIMIT = 10 * 1024 * 1024;
export const CLAWHUB_VERSION_FILE_COUNT_LIMIT = 1_000;
export const CLAWHUB_VERSION_TOTAL_BYTE_LIMIT = 200 * 1024 * 1024;
export const CLAWHUB_VERSION_METADATA_FILE_COUNT_LIMIT = 20_000;

const upstreamIdSchema = z.string().trim().min(1).max(256);
const upstreamTimestampSchema = z.number().int().nonnegative().finite();
const nullableTextSchema = z.string().nullable();

export const clawHubStatsSchema = z
  .object({
    comments: z.number().int().nonnegative().optional(),
    downloads: z.number().int().nonnegative().optional(),
    installs: z.number().int().nonnegative().optional(),
    stars: z.number().int().nonnegative().optional(),
    versions: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const clawHubLatestVersionSchema = z
  .object({
    version: z.string().trim().min(1).max(240),
    createdAt: upstreamTimestampSchema,
    changelog: nullableTextSchema.optional(),
    license: nullableTextSchema.optional(),
  })
  .passthrough();

export const clawHubPlatformMetadataSchema = z
  .object({
    os: z.array(z.string().trim().min(1).max(120)).max(100).nullable().optional(),
    systems: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .nullable()
      .optional(),
  })
  .passthrough();

export const clawHubSkillCoreSchema = z
  .object({
    id: upstreamIdSchema.optional(),
    _id: upstreamIdSchema.optional(),
    slug: z.string().trim().min(1).max(240),
    displayName: z.string().trim().min(1).max(10_000),
    summary: nullableTextSchema,
    description: nullableTextSchema.optional(),
    icon: nullableTextSchema.optional(),
    topics: z.array(z.string().max(1_000)).max(1_000).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    stats: clawHubStatsSchema,
    createdAt: upstreamTimestampSchema,
    updatedAt: upstreamTimestampSchema,
  })
  .passthrough();

export const clawHubSkillListResponseSchema = z
  .object({
    items: z
      .array(
        clawHubSkillCoreSchema.extend({
          ownerHandle: z.string().trim().min(1).max(240).optional(),
          latestVersion: clawHubLatestVersionSchema.nullable(),
          metadata: clawHubPlatformMetadataSchema.nullable().optional(),
        }),
      )
      .max(200),
    nextCursor: z.string().min(1).max(32_768).nullable(),
  })
  .passthrough();

export const clawHubSkillPackageListResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: upstreamIdSchema.optional(),
            _id: upstreamIdSchema.optional(),
            family: z.literal("skill"),
            name: z.string().trim().min(1).max(240),
            ownerHandle: z.string().trim().min(1).max(240),
            displayName: z.string().trim().min(1).max(10_000),
            summary: nullableTextSchema,
            latestVersion: z.string().trim().min(1).max(240).nullable(),
            categories: z.array(z.string().max(1_000)).max(1_000).optional(),
            topics: z.array(z.string().max(1_000)).max(1_000).optional(),
            channel: z.string().trim().min(1).max(120),
            isOfficial: z.boolean(),
            verificationTier: z
              .enum([
                "structural",
                "source-linked",
                "provenance-verified",
                "rebuild-verified",
              ])
              .nullable()
              .optional(),
            stats: clawHubStatsSchema,
            createdAt: upstreamTimestampSchema,
            updatedAt: upstreamTimestampSchema,
          })
          .passthrough(),
      )
      .max(100),
    nextCursor: z.string().min(1).max(32_768).nullable(),
  })
  .passthrough();

export const clawHubOwnerSchema = z
  .object({
    handle: z.string().trim().min(1).max(240),
    userId: upstreamIdSchema.optional(),
    displayName: nullableTextSchema.optional(),
    image: nullableTextSchema.optional(),
  })
  .passthrough();

export const clawHubModerationSchema = z
  .object({
    isSuspicious: z.boolean().optional(),
    isMalwareBlocked: z.boolean().optional(),
    verdict: nullableTextSchema.optional(),
    reasonCodes: z.array(z.string().max(1_000)).max(1_000).optional(),
    summary: nullableTextSchema.optional(),
    engineVersion: nullableTextSchema.optional(),
    updatedAt: upstreamTimestampSchema.optional(),
  })
  .passthrough();

export const clawHubSkillDetailResponseSchema = z
  .object({
    id: upstreamIdSchema.optional(),
    _id: upstreamIdSchema.optional(),
    skillId: upstreamIdSchema.optional(),
    skill: clawHubSkillCoreSchema,
    latestVersion: clawHubLatestVersionSchema.nullable(),
    metadata: clawHubPlatformMetadataSchema.nullable(),
    owner: clawHubOwnerSchema,
    moderation: clawHubModerationSchema.nullable().optional(),
  })
  .passthrough();

export const clawHubVersionFileSchema = z
  .object({
    path: z.string().min(1).max(2_048),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/u)
      .transform((value) => value.toLowerCase()),
    contentType: z.string().trim().min(1).max(1_000).nullable(),
  })
  .passthrough();

export const clawHubVersionSecuritySchema = z
  .object({
    status: z.string().trim().min(1).max(120).optional(),
    hasWarnings: z.boolean().optional(),
    checkedAt: upstreamTimestampSchema.nullable().optional(),
    hasScanResult: z.boolean().optional(),
    sha256hash: nullableTextSchema.optional(),
  })
  .passthrough();

export const clawHubVersionDetailResponseSchema = z
  .object({
    skill: z
      .object({
        id: upstreamIdSchema.optional(),
        _id: upstreamIdSchema.optional(),
        slug: z.string().trim().min(1).max(240),
        displayName: z.string().trim().min(1).max(10_000),
      })
      .passthrough(),
    version: z
      .object({
        id: upstreamIdSchema.optional(),
        _id: upstreamIdSchema.optional(),
        version: z.string().trim().min(1).max(240),
        createdAt: upstreamTimestampSchema,
        changelog: nullableTextSchema.optional(),
        changelogSource: nullableTextSchema.optional(),
        license: nullableTextSchema.optional(),
        files: z
          .array(clawHubVersionFileSchema)
          .max(CLAWHUB_VERSION_METADATA_FILE_COUNT_LIMIT),
        security: clawHubVersionSecuritySchema.nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const clawHubAmbiguousSkillResponseSchema = z
  .object({
    code: z.literal("AMBIGUOUS_SKILL_SLUG"),
    message: z.string(),
    slug: z.string().trim().min(1).max(240),
    matches: z
      .array(
        z
          .object({
            ownerHandle: z.string().trim().min(1).max(240),
            slug: z.string().trim().min(1).max(240),
            ref: z.string().optional(),
            url: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1)
      .max(1_000),
  })
  .passthrough();

export interface ClawHubStats {
  comments: number;
  downloads: number;
  installs: number;
  stars: number;
  versions: number;
}

export interface ClawHubLatestVersion {
  version: string;
  createdAt: number;
  changelog: string | null;
  license: string | null;
}

export interface ClawHubPlatformMetadata {
  os: string[] | null;
  systems: string[] | null;
}

export interface ClawHubSkillSummary {
  upstreamSkillId: string | null;
  slug: string;
  displayName: string;
  summary: string | null;
  description: string | null;
  icon: string | null;
  topics: string[];
  tags: Record<string, string>;
  stats: ClawHubStats;
  createdAt: number;
  updatedAt: number;
  latestVersion: ClawHubLatestVersion | null;
  metadata: ClawHubPlatformMetadata | null;
}

export type ClawHubSkillListItem = ClawHubSkillSummary &
  (
    | {
        identityResolved: true;
        ownerHandle: string;
      }
    | {
        identityResolved: false;
        ownerHandle: null;
        upstreamSkillId: null;
      }
  );

export interface ClawHubSkillListPage {
  items: ClawHubSkillListItem[];
  nextCursor: string | null;
}

export interface ClawHubSkillPackage {
  upstreamSkillId: string | null;
  ownerHandle: string;
  slug: string;
  displayName: string;
  summary: string | null;
  latestVersion: string | null;
  categories: string[];
  topics: string[];
  channel: string;
  isOfficial: boolean;
  verificationTier:
    | "structural"
    | "source-linked"
    | "provenance-verified"
    | "rebuild-verified"
    | null;
  stats: ClawHubStats;
  createdAt: number;
  updatedAt: number;
  canonicalUrl: string;
}

export interface ClawHubSkillPackageListPage {
  items: ClawHubSkillPackage[];
  nextCursor: string | null;
}

export type ClawHubModeration = z.infer<typeof clawHubModerationSchema>;
export type ClawHubVersionSecurity = z.infer<
  typeof clawHubVersionSecuritySchema
>;

export interface ClawHubSkillDetail extends ClawHubSkillSummary {
  requestedSlug: string;
  owner: {
    handle: string;
    userId: string | null;
    displayName: string | null;
    image: string | null;
  };
  moderation: ClawHubModeration | null;
  canonicalUrl: string;
}

export type ClawHubVersionFile = z.infer<typeof clawHubVersionFileSchema>;

export interface ClawHubVersionDetail {
  ownerHandle: string;
  upstreamSkillId: string | null;
  skill: {
    slug: string;
    displayName: string;
  };
  version: {
    upstreamVersionId: string | null;
    version: string;
    createdAt: number;
    changelog: string | null;
    changelogSource: string | null;
    license: string | null;
    files: ClawHubVersionFile[];
    security: ClawHubVersionSecurity | null;
  };
}

export interface ClawHubDownloadedFile extends ClawHubVersionFile {
  bytes: Buffer;
  responseContentType: string;
}

export interface ClawHubDownloadedVersion {
  ownerHandle: string;
  slug: string;
  version: string;
  files: ClawHubDownloadedFile[];
}

export type ClawHubSkillListSort =
  | "updated"
  | "recommended"
  | "createdAt"
  | "downloads"
  | "stars"
  | "name"
  | "trending";

export type ClawHubSkillPackageSort =
  | "updated"
  | "recommended"
  | "trending"
  | "downloads";

export interface ClawHubListSkillsInput {
  cursor?: string;
  limit?: number;
  sort?: ClawHubSkillListSort;
  signal?: AbortSignal;
}

export interface ClawHubListSkillPackagesInput {
  cursor?: string;
  limit?: number;
  sort?: ClawHubSkillPackageSort;
  signal?: AbortSignal;
}

export interface ClawHubSkillIdentityInput {
  ownerHandle: string;
  slug: string;
  signal?: AbortSignal;
}

export interface ClawHubVersionIdentityInput extends ClawHubSkillIdentityInput {
  version: string;
}

export interface ClawHubVersionFileInput extends ClawHubVersionIdentityInput {
  path: string;
}

export interface ClawHubDownloadVersionFilesInput
  extends ClawHubVersionIdentityInput {
  files?: readonly ClawHubVersionFile[];
}

export interface ClawHubRawFileResponse {
  bytes: Buffer;
  contentType: string;
  contentSha256: string | null;
  contentSize: number | null;
}

export type ClawHubClientErrorKind =
  | "INVALID_INPUT"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "REQUEST_TIMEOUT"
  | "REQUEST_ABORTED"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_RESPONSE"
  | "INVALID_MANIFEST"
  | "INTEGRITY_MISMATCH";

export interface ClawHubClientErrorOptions {
  status?: number;
  upstreamCode?: string;
  responseBody?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class ClawHubClientError extends Error {
  readonly status: number | null;
  readonly upstreamCode: string | null;
  readonly responseBody: string | null;
  readonly retryable: boolean;

  constructor(
    readonly kind: ClawHubClientErrorKind,
    message: string,
    options: ClawHubClientErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClawHubClientError";
    this.status = options.status ?? null;
    this.upstreamCode = options.upstreamCode ?? null;
    this.responseBody = options.responseBody ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export type ClawHubAmbiguousSkillMatch = z.infer<
  typeof clawHubAmbiguousSkillResponseSchema
>["matches"][number];

export class ClawHubAmbiguousSkillError extends ClawHubClientError {
  constructor(
    readonly slug: string,
    readonly matches: ClawHubAmbiguousSkillMatch[],
    message: string,
    responseBody: string,
  ) {
    super("HTTP_ERROR", message, {
      status: 409,
      upstreamCode: "AMBIGUOUS_SKILL_SLUG",
      responseBody,
    });
    this.name = "ClawHubAmbiguousSkillError";
  }
}

export interface ClawHubClientOptions {
  requestTimeoutMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  fetcher?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}
