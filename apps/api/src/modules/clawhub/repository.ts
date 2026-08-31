import type {
  ClawHubInstallBlockReason,
  ClawHubSecurityStatus,
  ClawHubSkillCatalogSort,
} from "@linksense/shared";
import { clawHubSkillCatalogSortSchema } from "@linksense/shared";
import { z } from "zod";

import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export type ClawHubSyncTrigger = "startup" | "scheduled";

export interface ClawHubSkillSyncRecord {
  ownerHandle: string;
  slug: string;
  displayName: string;
  summary: string | null;
  topics: string[];
  tags: Record<string, string>;
  downloadCount: number;
  installCount: number;
  starCount: number;
  commentCount: number;
  versionCount: number;
  latestVersion: string | null;
  latestVersionCreatedAt: Date | null;
  latestVersionChangelog: string | null;
  latestVersionLicense: string | null;
  ownerDisplayName: string | null;
  ownerImageUrl: string | null;
  metadata: Record<string, unknown> | null;
  sourceMetadata: Record<string, unknown>;
  moderationVerdict: string | null;
  moderationReasonCodes: string[];
  moderationSummary: string | null;
  moderationEngineVersion: string | null;
  moderationUpdatedAt: Date | null;
  isSuspicious: boolean;
  isMalwareBlocked: boolean;
  securityStatus: ClawHubSecurityStatus;
  securityHasWarnings: boolean;
  securityCheckedAt: Date | null;
  fileCount: number;
  totalFileBytes: number;
  installBlockReason: ClawHubInstallBlockReason | null;
  canonicalUrl: string | null;
  searchText: string;
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
}

export interface ClawHubSkillRecord extends ClawHubSkillSyncRecord {
  id: string;
  available: boolean;
  unavailableAt: Date | null;
  lastSeenSyncRunId: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClawHubInstallationRecord {
  id: string;
  userId: string;
  clawHubSkillId: string;
  capabilityId: string;
  installedVersion: string;
  sourceSecurityStatus: ClawHubSecurityStatus;
  sourceSecurityHasWarnings: boolean;
  contentSha256: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClawHubCatalogRecord {
  skill: ClawHubSkillRecord;
  installation: ClawHubInstallationRecord | null;
}

export interface ClawHubCatalogPage {
  items: ClawHubCatalogRecord[];
  nextCursor: string | null;
  totalCount: number;
}

export interface ClawHubSyncRunRecord {
  id: string;
  status: "running" | "succeeded" | "failed";
  trigger: ClawHubSyncTrigger;
  listedCount: number;
  detailCount: number;
  unavailableCount: number;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ClawHubStore {
  recoverInterruptedRuns(finishedAt: Date): Promise<number>;
  createSyncRun(
    trigger: ClawHubSyncTrigger,
    startedAt: Date,
  ): Promise<ClawHubSyncRunRecord>;
  stageSkill(
    runId: string,
    seenAt: Date,
    input: ClawHubSkillSyncRecord,
  ): Promise<void>;
  publishSyncRun(input: {
    runId: string;
    listedCount: number;
    detailCount: number;
    finishedAt: Date;
  }): Promise<number>;
  failSyncRun(input: {
    runId: string;
    listedCount: number;
    detailCount: number;
    errorCode: string;
    finishedAt: Date;
  }): Promise<void>;
  listCatalog(input: {
    userId: string;
    search?: string;
    sort: ClawHubSkillCatalogSort;
    cursor?: string;
    limit: number;
  }): Promise<ClawHubCatalogPage>;
  findCatalogSkill(
    userId: string,
    skillId: string,
  ): Promise<ClawHubCatalogRecord | null>;
}

export interface PrismaClawHubStoreOptions {
  transactionTimeoutMs?: number;
}

export class PrismaClawHubStore implements ClawHubStore {
  readonly #transactionOptions: { maxWait: number; timeout: number };

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaClawHubStoreOptions = {},
  ) {
    const timeout = options.transactionTimeoutMs ?? 300_000;
    if (!Number.isInteger(timeout) || timeout < 10_000 || timeout > 1_800_000) {
      throw new Error("clawhub_sync_transaction_timeout_invalid");
    }
    this.#transactionOptions = {
      maxWait: Math.min(30_000, timeout),
      timeout,
    };
  }

  async recoverInterruptedRuns(finishedAt: Date): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const runningRuns = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "clawhub_sync_runs"
          WHERE "status" = 'running'
          FOR UPDATE
        `,
      );
      if (runningRuns.length === 0) return 0;
      const runIds = runningRuns.map((run) => run.id);
      for (const runId of runIds) {
        await deleteStagingRun(transaction, runId);
      }
      const result = await transaction.clawHubSyncRun.updateMany({
        where: { id: { in: runIds }, status: "running" },
        data: {
          status: "failed",
          errorCode: "interrupted",
          finishedAt,
        },
      });
      return result.count;
    }, this.#transactionOptions);
  }

  async createSyncRun(
    trigger: ClawHubSyncTrigger,
    startedAt: Date,
  ): Promise<ClawHubSyncRunRecord> {
    return syncRunRecord(
      await this.prisma.clawHubSyncRun.create({
        data: {
          status: "running",
          trigger,
          startedAt,
          finishedAt: null,
          errorCode: null,
        },
      }),
    );
  }

  async stageSkill(
    runId: string,
    seenAt: Date,
    input: ClawHubSkillSyncRecord,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const runningRuns = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "clawhub_sync_runs"
          WHERE "id" = ${runId}::uuid AND "status" = 'running'
          FOR SHARE
        `,
      );
      if (runningRuns.length !== 1) {
        throw new Error("clawhub_sync_run_not_running");
      }
      const data = skillWriteData(input);
      await transaction.clawHubSkillSyncStaging.upsert({
        where: {
          runId_ownerHandle_slug: {
            runId,
            ownerHandle: input.ownerHandle,
            slug: input.slug,
          },
        },
        create: { ...data, runId, seenAt, stagedAt: seenAt },
        update: { ...data, seenAt, stagedAt: seenAt },
      });
      const visibleData = {
        ...data,
        available: true,
        unavailableAt: null,
        lastSeenSyncRunId: runId,
        lastSeenAt: seenAt,
      };
      await transaction.clawHubSkill.upsert({
        where: {
          ownerHandle_slug: {
            ownerHandle: input.ownerHandle,
            slug: input.slug,
          },
        },
        create: visibleData,
        update: visibleData,
      });
    });
  }

  async publishSyncRun(input: {
    runId: string;
    listedCount: number;
    detailCount: number;
    finishedAt: Date;
  }): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const lockedRuns = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "clawhub_sync_runs"
          WHERE "id" = ${input.runId}::uuid AND "status" = 'running'
          FOR UPDATE
        `,
      );
      if (lockedRuns.length !== 1) {
        throw new Error("clawhub_sync_run_not_running");
      }
      const stagedCount = await transaction.clawHubSkillSyncStaging.count({
        where: { runId: input.runId },
      });
      if (stagedCount !== input.detailCount) {
        throw new Error("clawhub_sync_staging_count_mismatch");
      }
      if (input.listedCount === 0 && input.detailCount === 0) {
        const existingCatalogCount = await transaction.clawHubSkill.count();
        if (existingCatalogCount > 0) {
          throw new Error("clawhub_sync_empty_snapshot");
        }
      }
      const unavailable = await transaction.clawHubSkill.updateMany({
        where: {
          available: true,
          lastSeenSyncRunId: { not: input.runId },
        },
        data: { available: false, unavailableAt: input.finishedAt },
      });
      const completed = await transaction.clawHubSyncRun.updateMany({
        where: { id: input.runId, status: "running" },
        data: {
          status: "succeeded",
          listedCount: input.listedCount,
          detailCount: input.detailCount,
          unavailableCount: unavailable.count,
          errorCode: null,
          finishedAt: input.finishedAt,
        },
      });
      if (completed.count !== 1) {
        throw new Error("clawhub_sync_run_not_running");
      }
      const clearedCount = await deleteStagingRun(transaction, input.runId);
      if (clearedCount !== stagedCount) {
        throw new Error("clawhub_sync_staging_cleanup_count_mismatch");
      }
      return unavailable.count;
    }, this.#transactionOptions);
  }

  async failSyncRun(input: {
    runId: string;
    listedCount: number;
    detailCount: number;
    errorCode: string;
    finishedAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const lockedRuns = await transaction.$queryRaw<
        Array<{ id: string; status: string }>
      >(Prisma.sql`
        SELECT "id", "status"
        FROM "clawhub_sync_runs"
        WHERE "id" = ${input.runId}::uuid
        FOR UPDATE
      `);
      const lockedRun = lockedRuns[0];
      if (lockedRun?.status === "running") {
        const failed = await transaction.clawHubSyncRun.updateMany({
          where: { id: input.runId, status: "running" },
          data: {
            status: "failed",
            listedCount: input.listedCount,
            detailCount: input.detailCount,
            errorCode: input.errorCode.slice(0, 120),
            finishedAt: input.finishedAt,
          },
        });
        if (failed.count !== 1) {
          throw new Error("clawhub_sync_run_not_running");
        }
      }
      await deleteStagingRun(transaction, input.runId);
    }, this.#transactionOptions);
  }

  async listCatalog(input: {
    userId: string;
    search?: string;
    sort: ClawHubSkillCatalogSort;
    cursor?: string;
    limit: number;
  }): Promise<ClawHubCatalogPage> {
    const cursor = input.cursor ? parseCatalogCursor(input.cursor) : null;
    if (input.cursor && (cursor === null || cursor.sort !== input.sort)) {
      throw new AppError("VALIDATION_ERROR");
    }

    const sortField = catalogSortField(input.sort);
    const baseWhere = {
      available: true,
      ...(input.search
        ? {
            searchText: {
              contains: input.search,
              mode: "insensitive" as const,
            },
          }
        : {}),
    } satisfies Prisma.ClawHubSkillWhereInput;
    const where = {
      ...baseWhere,
      ...(cursor
        ? { AND: [catalogCursorWhere(sortField, cursor)] }
        : {}),
    } satisfies Prisma.ClawHubSkillWhereInput;

    const [rows, totalCount] = await Promise.all([
      this.prisma.clawHubSkill.findMany({
        where,
        orderBy: [
          { [sortField]: "desc" },
          { slug: "asc" },
          { ownerHandle: "asc" },
          { id: "asc" },
        ],
        take: input.limit + 1,
      }),
      this.prisma.clawHubSkill.count({ where: baseWhere }),
    ]);
    const hasMore = rows.length > input.limit;
    const visibleRows = rows.slice(0, input.limit);
    const installations =
      visibleRows.length === 0
        ? []
        : await this.prisma.clawHubSkillInstallation.findMany({
            where: {
              userId: input.userId,
              clawHubSkillId: { in: visibleRows.map((row) => row.id) },
            },
          });
    const installationBySkillId = new Map(
      installations.map((installation) => [
        installation.clawHubSkillId,
        installationRecord(installation),
      ]),
    );
    const last = visibleRows.at(-1);
    return {
      totalCount,
      items: visibleRows.map((row) => ({
        skill: skillRecord(row),
        installation: installationBySkillId.get(row.id) ?? null,
      })),
      nextCursor:
        hasMore && last
          ? createCatalogCursor({
              sort: input.sort,
              value: last[sortField],
              slug: last.slug,
              ownerHandle: last.ownerHandle,
              id: last.id,
            })
          : null,
    };
  }

  async findCatalogSkill(
    userId: string,
    skillId: string,
  ): Promise<ClawHubCatalogRecord | null> {
    const skill = await this.prisma.clawHubSkill.findUnique({
      where: { id: skillId },
    });
    if (!skill) return null;
    const installation =
      await this.prisma.clawHubSkillInstallation.findUnique({
        where: {
          userId_clawHubSkillId: { userId, clawHubSkillId: skillId },
        },
      });
    return {
      skill: skillRecord(skill),
      installation:
        installation === null ? null : installationRecord(installation),
    };
  }
}

function deleteStagingRun(
  transaction: Pick<PrismaClient, "$executeRaw">,
  runId: string,
): Promise<number> {
  return transaction.$executeRaw(Prisma.sql`
    DELETE FROM "clawhub_skill_sync_staging"
    WHERE "run_id" = ${runId}::uuid
  `);
}

function skillWriteData(input: ClawHubSkillSyncRecord) {
  return {
    ownerHandle: input.ownerHandle,
    slug: input.slug,
    displayName: input.displayName,
    summary: input.summary,
    topicsJson: input.topics as Prisma.InputJsonValue,
    tagsJson: input.tags as Prisma.InputJsonValue,
    downloadCount: input.downloadCount,
    installCount: input.installCount,
    starCount: input.starCount,
    commentCount: input.commentCount,
    versionCount: input.versionCount,
    latestVersion: input.latestVersion,
    latestVersionCreatedAt: input.latestVersionCreatedAt,
    latestVersionChangelog: input.latestVersionChangelog,
    latestVersionLicense: input.latestVersionLicense,
    ownerDisplayName: input.ownerDisplayName,
    ownerImageUrl: input.ownerImageUrl,
    metadataJson:
      input.metadata === null
        ? Prisma.DbNull
        : (input.metadata as Prisma.InputJsonValue),
    sourceMetadataJson: input.sourceMetadata as Prisma.InputJsonValue,
    moderationVerdict: input.moderationVerdict,
    moderationReasonCodesJson:
      input.moderationReasonCodes as Prisma.InputJsonValue,
    moderationSummary: input.moderationSummary,
    moderationEngineVersion: input.moderationEngineVersion,
    moderationUpdatedAt: input.moderationUpdatedAt,
    isSuspicious: input.isSuspicious,
    isMalwareBlocked: input.isMalwareBlocked,
    securityStatus: input.securityStatus,
    securityHasWarnings: input.securityHasWarnings,
    securityCheckedAt: input.securityCheckedAt,
    fileCount: input.fileCount,
    totalFileBytes: BigInt(input.totalFileBytes),
    installBlockReason: input.installBlockReason,
    canonicalUrl: input.canonicalUrl,
    searchText: input.searchText,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
  };
}

function skillRecord(value: {
  id: string;
  ownerHandle: string;
  slug: string;
  displayName: string;
  summary: string | null;
  topicsJson: unknown;
  tagsJson: unknown;
  downloadCount: number;
  installCount: number;
  starCount: number;
  commentCount: number;
  versionCount: number;
  latestVersion: string | null;
  latestVersionCreatedAt: Date | null;
  latestVersionChangelog: string | null;
  latestVersionLicense: string | null;
  ownerDisplayName: string | null;
  ownerImageUrl: string | null;
  metadataJson: unknown;
  sourceMetadataJson: unknown;
  moderationVerdict: string | null;
  moderationReasonCodesJson: unknown;
  moderationSummary: string | null;
  moderationEngineVersion: string | null;
  moderationUpdatedAt: Date | null;
  isSuspicious: boolean;
  isMalwareBlocked: boolean;
  securityStatus: string;
  securityHasWarnings: boolean;
  securityCheckedAt: Date | null;
  fileCount: number;
  totalFileBytes: bigint;
  installBlockReason: string | null;
  canonicalUrl: string | null;
  searchText: string;
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
  available: boolean;
  unavailableAt: Date | null;
  lastSeenSyncRunId: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ClawHubSkillRecord {
  if (value.totalFileBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("clawhub_total_file_bytes_out_of_range");
  }
  return {
    id: value.id,
    ownerHandle: value.ownerHandle,
    slug: value.slug,
    displayName: value.displayName,
    summary: value.summary,
    topics: value.topicsJson as string[],
    tags: value.tagsJson as Record<string, string>,
    downloadCount: value.downloadCount,
    installCount: value.installCount,
    starCount: value.starCount,
    commentCount: value.commentCount,
    versionCount: value.versionCount,
    latestVersion: value.latestVersion,
    latestVersionCreatedAt: value.latestVersionCreatedAt,
    latestVersionChangelog: value.latestVersionChangelog,
    latestVersionLicense: value.latestVersionLicense,
    ownerDisplayName: value.ownerDisplayName,
    ownerImageUrl: value.ownerImageUrl,
    metadata: value.metadataJson as Record<string, unknown> | null,
    sourceMetadata: value.sourceMetadataJson as Record<string, unknown>,
    moderationVerdict: value.moderationVerdict,
    moderationReasonCodes: value.moderationReasonCodesJson as string[],
    moderationSummary: value.moderationSummary,
    moderationEngineVersion: value.moderationEngineVersion,
    moderationUpdatedAt: value.moderationUpdatedAt,
    isSuspicious: value.isSuspicious,
    isMalwareBlocked: value.isMalwareBlocked,
    securityStatus: value.securityStatus as ClawHubSecurityStatus,
    securityHasWarnings: value.securityHasWarnings,
    securityCheckedAt: value.securityCheckedAt,
    fileCount: value.fileCount,
    totalFileBytes: Number(value.totalFileBytes),
    installBlockReason:
      value.installBlockReason as ClawHubInstallBlockReason | null,
    canonicalUrl: value.canonicalUrl,
    searchText: value.searchText,
    sourceCreatedAt: value.sourceCreatedAt,
    sourceUpdatedAt: value.sourceUpdatedAt,
    available: value.available,
    unavailableAt: value.unavailableAt,
    lastSeenSyncRunId: value.lastSeenSyncRunId,
    lastSeenAt: value.lastSeenAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function installationRecord(value: {
  id: string;
  userId: string;
  clawHubSkillId: string;
  capabilityId: string;
  installedVersion: string;
  sourceSecurityStatus: string;
  sourceSecurityHasWarnings: boolean;
  contentSha256: string;
  createdAt: Date;
  updatedAt: Date;
}): ClawHubInstallationRecord {
  return {
    ...value,
    sourceSecurityStatus:
      value.sourceSecurityStatus as ClawHubSecurityStatus,
  };
}

function syncRunRecord(value: {
  id: string;
  status: string;
  trigger: string;
  listedCount: number;
  detailCount: number;
  unavailableCount: number;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): ClawHubSyncRunRecord {
  return {
    ...value,
    status: value.status as ClawHubSyncRunRecord["status"],
    trigger: value.trigger as ClawHubSyncTrigger,
  };
}

const catalogCursorSchema = z.strictObject({
  sort: clawHubSkillCatalogSortSchema,
  value: z.number().int().nonnegative().safe(),
  slug: z.string().trim().min(1).max(240),
  ownerHandle: z.string().trim().min(1).max(240),
  id: z.uuid(),
});

type CatalogCursor = z.infer<typeof catalogCursorSchema>;

function createCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseCatalogCursor(value: string): CatalogCursor | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    const parsed = catalogCursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type CatalogSortField = "downloadCount" | "starCount";

function catalogSortField(sort: ClawHubSkillCatalogSort): CatalogSortField {
  return sort === "stars" ? "starCount" : "downloadCount";
}

function catalogCursorWhere(
  sortField: CatalogSortField,
  cursor: CatalogCursor,
): Prisma.ClawHubSkillWhereInput {
  return {
    OR: [
      { [sortField]: { lt: cursor.value } },
      {
        [sortField]: cursor.value,
        slug: { gt: cursor.slug },
      },
      {
        [sortField]: cursor.value,
        slug: cursor.slug,
        ownerHandle: { gt: cursor.ownerHandle },
      },
      {
        [sortField]: cursor.value,
        slug: cursor.slug,
        ownerHandle: cursor.ownerHandle,
        id: { gt: cursor.id },
      },
    ],
  };
}
