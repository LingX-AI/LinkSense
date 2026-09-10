import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { sanitizeAuditMetadata } from "../audit/service.js";
import { assertManagedKnowledgeObjectKey } from "../knowledge-processing/object-store.js";

import { normalizeKnowledgeEntryName } from "./directory-path.js";
import { resolveOriginalSource } from "./original-source.js";
import type {
  CancelKnowledgeProcessingResult,
  DeleteKnowledgeDocumentResult,
  KnowledgeAccessSource,
  KnowledgeAuditInput,
  KnowledgeBaseApplicationUsageRecord,
  KnowledgeBaseAccessRecord,
  KnowledgeBaseEntryRecord,
  KnowledgeBaseEntryWithDocument,
  KnowledgeBaseGrantRecord,
  KnowledgeBaseGrantViewRecord,
  KnowledgeBaseRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentSearchabilityCriteria,
  KnowledgeDocumentVersionRecord,
  KnowledgeDocumentWithProcessing,
  KnowledgeGroupMemberAccessSummary,
  KnowledgeProcessingRequestOperation,
  KnowledgeShareTargetRecord,
  KnowledgeStore,
  PrepareKnowledgeProcessingResult,
  RegisterDocumentUploadInput,
  RegisterDocumentUploadResult,
  RenameKnowledgeDocumentResult,
} from "./types.js";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
const UPLOAD_RESERVATION_LEASE_MS = 10_000;
const UPLOAD_RESERVATION_RETENTION_MS = 24 * 60 * 60_000;

function knowledgeBaseRecord(
  value: Prisma.KnowledgeBaseModel,
): KnowledgeBaseRecord {
  return {
    ...value,
    sourceType: value.sourceType as KnowledgeBaseRecord["sourceType"],
    lifecycleStatus:
      value.lifecycleStatus as KnowledgeBaseRecord["lifecycleStatus"],
    availabilityStatus:
      value.availabilityStatus as KnowledgeBaseRecord["availabilityStatus"],
    cleanupStatus: value.cleanupStatus as KnowledgeBaseRecord["cleanupStatus"],
  };
}

function grantRecord(
  value: Prisma.KnowledgeBaseGrantModel,
): KnowledgeBaseGrantRecord {
  return {
    ...value,
    granteeType: value.granteeType as KnowledgeBaseGrantRecord["granteeType"],
    permission: value.permission as "use",
    status: value.status as KnowledgeBaseGrantRecord["status"],
  };
}

function documentRecord(
  value: Prisma.KnowledgeBaseDocumentModel,
): KnowledgeDocumentRecord {
  return {
    ...value,
    status: value.status as KnowledgeDocumentRecord["status"],
    cleanupStatus:
      value.cleanupStatus as KnowledgeDocumentRecord["cleanupStatus"],
  };
}

function entryRecord(
  value: Prisma.KnowledgeBaseEntryModel,
): KnowledgeBaseEntryRecord {
  return {
    ...value,
    entryType: value.entryType as KnowledgeBaseEntryRecord["entryType"],
  };
}

function versionRecord(
  value: Prisma.KnowledgeBaseDocumentVersionModel,
): KnowledgeDocumentVersionRecord {
  return {
    ...value,
    versionStatus:
      value.versionStatus as KnowledgeDocumentVersionRecord["versionStatus"],
    operationType:
      value.operationType as KnowledgeDocumentVersionRecord["operationType"],
    processingStage:
      value.processingStage as KnowledgeDocumentVersionRecord["processingStage"],
    failedStage:
      value.failedStage as KnowledgeDocumentVersionRecord["failedStage"],
    stableErrorParamsJson: value.stableErrorParamsJson as Record<
      string,
      unknown
    > | null,
    processingConfigJson: value.processingConfigJson as Record<string, unknown>,
  };
}

function failedCandidateVersion(
  value: Prisma.KnowledgeBaseDocumentVersionModel | undefined,
): KnowledgeDocumentVersionRecord | null {
  if (
    value === undefined ||
    value.processingStage !== "failed" ||
    value.stableErrorCode === null ||
    (value.versionStatus !== "failed" &&
      !(
        value.versionStatus === "ready" &&
        value.operationType === "rebuild_index"
      ))
  ) {
    return null;
  }
  return versionRecord(value);
}

export class PrismaKnowledgeStore implements KnowledgeStore {
  readonly #root: PrismaClient;
  readonly #database: DatabaseClient;

  constructor(root: PrismaClient, transaction?: Prisma.TransactionClient) {
    this.#root = root;
    this.#database = transaction ?? root;
  }

  async transaction<T>(
    work: (store: KnowledgeStore) => Promise<T>,
  ): Promise<T> {
    if (this.#database !== this.#root) return work(this);
    return this.#root.$transaction((transaction) =>
      work(new PrismaKnowledgeStore(this.#root, transaction)),
    );
  }

  async lockKnowledgeBase(id: string): Promise<void> {
    await this.#database.$queryRawUnsafe(
      'SELECT "id" FROM "knowledge_bases" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    );
  }

  async listUndeletedDocumentIds(knowledgeBaseId: string): Promise<string[]> {
    const documents = await this.#database.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId, status: { not: "deleted" } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return documents.map((document) => document.id);
  }

  async hasProcessingDocuments(knowledgeBaseId: string): Promise<boolean> {
    const document = await this.#database.knowledgeBaseDocument.findFirst({
      where: { knowledgeBaseId, status: "processing" },
      select: { id: true },
    });
    return document !== null;
  }

  async listKnowledgeBaseApplicationUsages(
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseApplicationUsageRecord[]> {
    const bindings = await this.#database.applicationKnowledgeBase.findMany({
      where: { knowledgeBaseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { applicationId: true },
    });
    const applicationIds = [
      ...new Set(bindings.map((binding) => binding.applicationId)),
    ];
    if (applicationIds.length === 0) return [];

    const applications = await this.#database.application.findMany({
      where: {
        id: { in: applicationIds },
        status: { in: ["active", "disabled"] },
        deletedAt: null,
      },
      select: { id: true, name: true, status: true },
    });
    const applicationsById = new Map(
      applications.map((application) => [application.id, application]),
    );

    return applicationIds.flatMap((applicationId) => {
      const application = applicationsById.get(applicationId);
      if (
        application === undefined ||
        (application.status !== "active" && application.status !== "disabled")
      ) {
        return [];
      }
      return [
        {
          id: application.id,
          name: application.name,
          status: application.status === "active" ? "active" : "disabled",
        },
      ];
    });
  }

  async #lockDocument(id: string): Promise<void> {
    await this.#database.$queryRawUnsafe(
      'SELECT "id" FROM "knowledge_base_documents" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    );
  }

  async findKnowledgeBase(id: string): Promise<KnowledgeBaseRecord | null> {
    const value = await this.#database.knowledgeBase.findUnique({
      where: { id },
    });
    return value === null ? null : knowledgeBaseRecord(value);
  }

  async findKnowledgeBaseAccess(
    id: string,
    actorId: string,
    searchability: KnowledgeDocumentSearchabilityCriteria = {},
  ): Promise<KnowledgeBaseAccessRecord | null> {
    const base = await this.#database.knowledgeBase.findUnique({
      where: { id },
    });
    if (base === null || base.lifecycleStatus === "deleted") return null;
    const groupIds = await this.listActiveGroupIds(actorId);
    const grants = await this.#database.knowledgeBaseGrant.findMany({
      where: {
        knowledgeBaseId: id,
        status: "active",
        OR: [
          { granteeType: "user", userId: actorId },
          ...(groupIds.length === 0
            ? []
            : [{ granteeType: "user_group", userGroupId: { in: groupIds } }]),
        ],
      },
    });
    const sourceGroupIds = grants.flatMap((grant) =>
      grant.userGroupId === null ? [] : [grant.userGroupId],
    );
    const [owner, sourceGroups, documentCount, searchableDocumentCount] =
      await Promise.all([
        this.#database.user.findUnique({
          where: { id: base.ownerId },
          select: { id: true, name: true },
        }),
        this.#database.userGroup.findMany({
          where: { id: { in: sourceGroupIds } },
          select: { id: true, name: true },
        }),
        this.#database.knowledgeBaseDocument.count({
          where: { knowledgeBaseId: id, status: { not: "deleted" } },
        }),
        this.#database.knowledgeBaseDocument.count({
          where: searchableDocumentWhere(
            { knowledgeBaseId: id },
            searchability,
          ),
        }),
      ]);
    if (owner === null) throw new AppError("INTERNAL_ERROR");
    const groupNameById = new Map(
      sourceGroups.map((group) => [group.id, group.name]),
    );
    const accessSources = accessSourcesFor(
      base.ownerId,
      actorId,
      grants,
      groupNameById,
    );
    if (accessSources.length === 0) return null;
    return {
      knowledgeBase: knowledgeBaseRecord(base),
      owner,
      accessSources,
      documentCount,
      searchableDocumentCount,
    };
  }

  async listAccessibleKnowledgeBases(input: {
    actorId: string;
    scope: "all" | "mine" | "shared";
    lifecycleStatus: "active" | "archived";
    search?: string;
    cursor?: string;
    limit: number;
    searchability?: KnowledgeDocumentSearchabilityCriteria;
  }): Promise<{
    items: KnowledgeBaseAccessRecord[];
    nextCursor: string | null;
  }> {
    const groupIds = await this.listActiveGroupIds(input.actorId);
    const actorGrants = await this.#database.knowledgeBaseGrant.findMany({
      where: {
        status: "active",
        OR: [
          { granteeType: "user", userId: input.actorId },
          ...(groupIds.length === 0
            ? []
            : [{ granteeType: "user_group", userGroupId: { in: groupIds } }]),
        ],
      },
    });
    const grantedIds = [
      ...new Set(actorGrants.map((grant) => grant.knowledgeBaseId)),
    ];
    const visibility: Prisma.KnowledgeBaseWhereInput =
      input.scope === "mine"
        ? { ownerId: input.actorId }
        : input.scope === "shared"
          ? {
              ownerId: { not: input.actorId },
              id: { in: grantedIds },
              availabilityStatus: "enabled",
            }
          : {
              OR: [
                { ownerId: input.actorId },
                {
                  id: { in: grantedIds },
                  availabilityStatus: "enabled",
                },
              ],
            };
    const cursor =
      input.cursor === undefined
        ? null
        : await this.#database.knowledgeBase.findUnique({
            where: { id: input.cursor },
            select: { id: true, updatedAt: true },
          });
    const where: Prisma.KnowledgeBaseWhereInput = {
      lifecycleStatus: input.lifecycleStatus,
      AND: [
        visibility,
        ...(input.search === undefined || input.search.length === 0
          ? []
          : [
              {
                name: { contains: input.search, mode: "insensitive" as const },
              },
            ]),
        ...(cursor === null
          ? []
          : [
              {
                OR: [
                  { updatedAt: { lt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                ],
              },
            ]),
      ],
    };
    const bases = await this.#database.knowledgeBase.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    const visible = bases.slice(0, input.limit);
    const baseIds = visible.map((base) => base.id);
    const ownerIds = [...new Set(visible.map((base) => base.ownerId))];
    const sourceGroupIds = [
      ...new Set(
        actorGrants.flatMap((grant) =>
          grant.userGroupId === null ? [] : [grant.userGroupId],
        ),
      ),
    ];
    const [owners, sourceGroups, allCounts, searchableCounts] =
      await Promise.all([
        this.#database.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        }),
        this.#database.userGroup.findMany({
          where: { id: { in: sourceGroupIds } },
          select: { id: true, name: true },
        }),
        this.#database.knowledgeBaseDocument.groupBy({
          by: ["knowledgeBaseId"],
          where: {
            knowledgeBaseId: { in: baseIds },
            status: { not: "deleted" },
          },
          _count: { _all: true },
        }),
        this.#database.knowledgeBaseDocument.groupBy({
          by: ["knowledgeBaseId"],
          where: searchableDocumentWhere(
            { knowledgeBaseId: { in: baseIds } },
            input.searchability,
          ),
          _count: { _all: true },
        }),
      ]);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    const groupNameById = new Map(
      sourceGroups.map((group) => [group.id, group.name]),
    );
    const allCountByBase = new Map(
      allCounts.map((count) => [count.knowledgeBaseId, count._count._all]),
    );
    const searchableCountByBase = new Map(
      searchableCounts.map((count) => [
        count.knowledgeBaseId,
        count._count._all,
      ]),
    );
    const grantsByBase = new Map<string, Prisma.KnowledgeBaseGrantModel[]>();
    for (const grant of actorGrants) {
      const current = grantsByBase.get(grant.knowledgeBaseId) ?? [];
      current.push(grant);
      grantsByBase.set(grant.knowledgeBaseId, current);
    }
    return {
      items: visible.map((base) => {
        const owner = ownerById.get(base.ownerId);
        if (owner === undefined) throw new AppError("INTERNAL_ERROR");
        return {
          knowledgeBase: knowledgeBaseRecord(base),
          owner,
          accessSources: accessSourcesFor(
            base.ownerId,
            input.actorId,
            grantsByBase.get(base.id) ?? [],
            groupNameById,
          ),
          documentCount: allCountByBase.get(base.id) ?? 0,
          searchableDocumentCount: searchableCountByBase.get(base.id) ?? 0,
        };
      }),
      nextCursor:
        bases.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async createKnowledgeBase(input: {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    sourceType: KnowledgeBaseRecord["sourceType"];
    now: Date;
  }): Promise<KnowledgeBaseRecord> {
    return knowledgeBaseRecord(
      await this.#database.knowledgeBase.create({
        data: {
          id: input.id,
          ownerId: input.ownerId,
          name: input.name,
          description: input.description,
          sourceType: input.sourceType,
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
          cleanupStatus: "completed",
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
    );
  }

  async updateKnowledgeBase(
    id: string,
    input: { name?: string; description?: string | null; now: Date },
  ): Promise<KnowledgeBaseRecord> {
    return knowledgeBaseRecord(
      await this.#database.knowledgeBase.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          updatedAt: input.now,
        },
      }),
    );
  }

  async archiveKnowledgeBase(input: {
    id: string;
    actorId: string;
    now: Date;
  }): Promise<KnowledgeBaseRecord> {
    return knowledgeBaseRecord(
      await this.#database.knowledgeBase.update({
        where: { id: input.id },
        data: {
          lifecycleStatus: "archived",
          archivedAt: input.now,
          archivedBy: input.actorId,
          updatedAt: input.now,
        },
      }),
    );
  }

  async restoreKnowledgeBase(input: {
    id: string;
    now: Date;
  }): Promise<KnowledgeBaseRecord> {
    return knowledgeBaseRecord(
      await this.#database.knowledgeBase.update({
        where: { id: input.id },
        data: {
          lifecycleStatus: "active",
          archivedAt: null,
          archivedBy: null,
          updatedAt: input.now,
        },
      }),
    );
  }

  async deleteKnowledgeBase(input: {
    id: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<KnowledgeBaseRecord> {
    const updated = await this.#database.knowledgeBase.update({
      where: { id: input.id },
      data: {
        lifecycleStatus: "deleted",
        deletedAt: input.now,
        deletedBy: input.actorId,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseTombstone.upsert({
      where: { id: updated.id },
      create: {
        id: updated.id,
        ownerId: updated.ownerId,
        deletedBy: input.actorId,
        deletedAt: input.now,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
      update: {
        ownerId: updated.ownerId,
        deletedBy: input.actorId,
        deletedAt: input.now,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseDocument.updateMany({
      where: { knowledgeBaseId: input.id, status: { not: "deleted" } },
      data: {
        status: "deleted",
        deletedAt: input.now,
        deletedBy: input.actorId,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        activeProcessingVersionId: null,
        updatedAt: input.now,
      },
    });
    await this.#database.$executeRaw`
      INSERT INTO "knowledge_base_document_tombstones" (
        "id",
        "knowledge_base_id",
        "deleted_by",
        "deleted_at",
        "deletion_reason",
        "cleanup_status",
        "cleanup_error_code",
        "created_at",
        "updated_at"
      )
      SELECT
        "id",
        "knowledge_base_id",
        "deleted_by",
        "deleted_at",
        "deletion_reason",
        'pending',
        NULL,
        "created_at",
        ${input.now}
      FROM "knowledge_base_documents"
      WHERE "knowledge_base_id" = ${input.id}::uuid
        AND "status" = 'deleted'
      ON CONFLICT ("id") DO UPDATE SET
        "knowledge_base_id" = EXCLUDED."knowledge_base_id",
        "deleted_by" = EXCLUDED."deleted_by",
        "deleted_at" = EXCLUDED."deleted_at",
        "deletion_reason" = EXCLUDED."deletion_reason",
        "cleanup_status" = 'pending',
        "cleanup_error_code" = NULL,
        "updated_at" = EXCLUDED."updated_at"
    `;
    await this.#database.knowledgeBaseDocumentVersion.updateMany({
      where: { knowledgeBaseId: input.id, versionStatus: { not: "deleted" } },
      data: {
        versionStatus: "deleted",
        retryAt: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseProcessingAttempt.updateMany({
      where: { knowledgeBaseId: input.id, status: "active" },
      data: {
        status: "discarded",
        discardedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseObject.updateMany({
      where: { knowledgeBaseId: input.id, lifecycleStatus: { not: "cleaned" } },
      data: {
        lifecycleStatus: "pending_cleanup",
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseCleanupOutbox.create({
      data: {
        targetType: "knowledge_base",
        knowledgeBaseId: input.id,
        status: "pending",
        requestedBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return knowledgeBaseRecord(updated);
  }

  async listActiveGroupIds(userId: string): Promise<string[]> {
    const memberships = await this.#database.userGroupMember.findMany({
      where: { userId, status: "active" },
      select: { userGroupId: true },
    });
    return memberships.map((membership) => membership.userGroupId);
  }

  async isActiveUser(id: string): Promise<boolean> {
    return (
      (await this.#database.user.findFirst({
        where: { id, status: "active" },
        select: { id: true },
      })) !== null
    );
  }

  async groupExists(id: string): Promise<boolean> {
    const rows = await this.#database.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "user_groups" WHERE "id" = $1::uuid FOR KEY SHARE',
      id,
    );
    return rows.length > 0;
  }

  async listGrants(input: {
    knowledgeBaseId: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: KnowledgeBaseGrantViewRecord[];
    nextCursor: string | null;
  }> {
    const cursor =
      input.cursor === undefined
        ? null
        : await this.#database.knowledgeBaseGrant.findFirst({
            where: {
              id: input.cursor,
              knowledgeBaseId: input.knowledgeBaseId,
            },
            select: { id: true, createdAt: true },
          });
    if (input.cursor !== undefined && cursor === null) {
      throw new AppError("VALIDATION_ERROR");
    }
    const grants = await this.#database.knowledgeBaseGrant.findMany({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    });
    const visible = grants.slice(0, input.limit);
    return {
      items: await this.#grantViews(visible),
      nextCursor:
        grants.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async #grantViews(
    grants: Prisma.KnowledgeBaseGrantModel[],
  ): Promise<KnowledgeBaseGrantViewRecord[]> {
    const userIds = grants.flatMap((grant) =>
      grant.userId === null ? [] : [grant.userId],
    );
    const groupIds = grants.flatMap((grant) =>
      grant.userGroupId === null ? [] : [grant.userGroupId],
    );
    const [users, groups] = await Promise.all([
      this.#database.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.#database.userGroup.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true },
      }),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    return grants.map((grant) => {
      if (grant.granteeType === "user") {
        const target =
          grant.userId === null ? undefined : usersById.get(grant.userId);
        return {
          ...grantRecord(grant),
          targetName: target?.name ?? "Unknown",
          targetEmail: target?.email ?? null,
        };
      }
      const target =
        grant.userGroupId === null
          ? undefined
          : groupsById.get(grant.userGroupId);
      return {
        ...grantRecord(grant),
        targetName: target?.name ?? "Unknown",
        targetEmail: null,
      };
    });
  }

  async findGrant(id: string): Promise<KnowledgeBaseGrantRecord | null> {
    const value = await this.#database.knowledgeBaseGrant.findUnique({
      where: { id },
    });
    return value === null ? null : grantRecord(value);
  }

  async findGrantView(
    id: string,
  ): Promise<KnowledgeBaseGrantViewRecord | null> {
    const value = await this.#database.knowledgeBaseGrant.findUnique({
      where: { id },
    });
    if (value === null) return null;
    return (await this.#grantViews([value]))[0] ?? null;
  }

  async findActiveGrantForTarget(input: {
    knowledgeBaseId: string;
    targetType: "user" | "user_group";
    targetId: string;
  }): Promise<KnowledgeBaseGrantRecord | null> {
    const value = await this.#database.knowledgeBaseGrant.findFirst({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        status: "active",
        granteeType: input.targetType,
        ...(input.targetType === "user"
          ? { userId: input.targetId }
          : { userGroupId: input.targetId }),
      },
    });
    return value === null ? null : grantRecord(value);
  }

  async createGrant(input: {
    id: string;
    knowledgeBaseId: string;
    targetType: "user" | "user_group";
    targetId: string;
    actorId: string;
    now: Date;
  }): Promise<KnowledgeBaseGrantRecord> {
    return grantRecord(
      await this.#database.knowledgeBaseGrant.create({
        data: {
          id: input.id,
          knowledgeBaseId: input.knowledgeBaseId,
          granteeType: input.targetType,
          userId: input.targetType === "user" ? input.targetId : null,
          userGroupId:
            input.targetType === "user_group" ? input.targetId : null,
          permission: "use",
          status: "active",
          grantedBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
    );
  }

  async revokeGrant(input: {
    id: string;
    actorId: string;
    reason: string | null;
    now: Date;
  }): Promise<KnowledgeBaseGrantRecord> {
    return grantRecord(
      await this.#database.knowledgeBaseGrant.update({
        where: { id: input.id },
        data: {
          status: "revoked",
          revokedBy: input.actorId,
          revokedAt: input.now,
          revocationReason: input.reason,
          updatedAt: input.now,
        },
      }),
    );
  }

  async summarizeGroupMemberRemainingAccess(input: {
    knowledgeBaseId: string;
    ownerId: string;
    groupId: string;
  }): Promise<KnowledgeGroupMemberAccessSummary> {
    const memberships = await this.#database.userGroupMember.findMany({
      where: { userGroupId: input.groupId, status: "active" },
      select: { userId: true },
    });
    const memberIds = [...new Set(memberships.map((member) => member.userId))];
    if (memberIds.length === 0) {
      return { memberAccess: "none", sourceTypes: [] };
    }
    const activeUsers = await this.#database.user.findMany({
      where: { id: { in: memberIds }, status: "active" },
      select: { id: true },
    });
    const activeMemberIds = activeUsers.map((user) => user.id);
    if (activeMemberIds.length === 0) {
      return { memberAccess: "none", sourceTypes: [] };
    }
    const [directGrants, groupGrants] = await Promise.all([
      this.#database.knowledgeBaseGrant.findMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          status: "active",
          granteeType: "user",
          userId: { in: activeMemberIds },
        },
        select: { userId: true },
      }),
      this.#database.knowledgeBaseGrant.findMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          status: "active",
          granteeType: "user_group",
        },
        select: { userGroupId: true },
      }),
    ]);
    const otherGroupIds = groupGrants.flatMap((grant) =>
      grant.userGroupId === null ? [] : [grant.userGroupId],
    );
    const otherGroupMemberships =
      otherGroupIds.length === 0
        ? []
        : await this.#database.userGroupMember.findMany({
            where: {
              userId: { in: activeMemberIds },
              userGroupId: { in: otherGroupIds },
              status: "active",
            },
            select: { userId: true },
          });
    const retainedMemberIds = new Set<string>();
    const sourceTypes: KnowledgeGroupMemberAccessSummary["sourceTypes"] = [];
    if (activeMemberIds.includes(input.ownerId)) {
      retainedMemberIds.add(input.ownerId);
      sourceTypes.push("owner");
    }
    for (const grant of directGrants) {
      if (grant.userId !== null) retainedMemberIds.add(grant.userId);
    }
    if (directGrants.length > 0) sourceTypes.push("direct");
    for (const membership of otherGroupMemberships) {
      retainedMemberIds.add(membership.userId);
    }
    if (otherGroupMemberships.length > 0) sourceTypes.push("user_group");
    return {
      memberAccess:
        retainedMemberIds.size === 0
          ? "none"
          : retainedMemberIds.size === activeMemberIds.length
            ? "all"
            : "some",
      sourceTypes,
    };
  }

  async searchShareTargets(input: {
    type: "user" | "group";
    search: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: KnowledgeShareTargetRecord[];
    nextCursor: string | null;
  }> {
    if (input.type === "user") {
      const rows = await this.#database.user.findMany({
        where: {
          status: "active",
          ...(input.search.length === 0
            ? {}
            : {
                OR: [
                  { name: { contains: input.search, mode: "insensitive" } },
                  { email: { contains: input.search, mode: "insensitive" } },
                ],
              }),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        ...(input.cursor === undefined
          ? {}
          : { cursor: { id: input.cursor }, skip: 1 }),
        take: input.limit + 1,
        select: { id: true, name: true, email: true },
      });
      const visible = rows.slice(0, input.limit);
      return {
        items: visible.map((row) => ({
          id: row.id,
          type: "user",
          name: row.name,
          email: row.email,
        })),
        nextCursor:
          rows.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
      };
    }
    const rows = await this.#database.userGroup.findMany({
      where: {
        ...(input.search.length === 0
          ? {}
          : { name: { contains: input.search, mode: "insensitive" } }),
        ...(input.cursor === undefined ? {} : { id: { gt: input.cursor } }),
      },
      orderBy: { id: "asc" },
      take: input.limit + 1,
      select: { id: true, name: true },
    });
    const visible = rows.slice(0, input.limit);
    return {
      items: visible.map((row) => ({
        id: row.id,
        type: "group",
        name: row.name,
        email: null,
      })),
      nextCursor:
        rows.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async listDocuments(input: {
    knowledgeBaseId: string;
    includeOwnerOnlyStates: boolean;
    search?: string;
    status?: Exclude<KnowledgeDocumentRecord["status"], "deleted">;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: KnowledgeDocumentWithProcessing[];
    nextCursor: string | null;
  }> {
    const cursor =
      input.cursor === undefined
        ? null
        : await this.#database.knowledgeBaseDocument.findUnique({
            where: { id: input.cursor },
            select: { id: true, updatedAt: true },
          });
    const documents = await this.#database.knowledgeBaseDocument.findMany({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        status:
          input.status !== undefined
            ? input.status
            : input.includeOwnerOnlyStates
              ? { not: "deleted" }
              : "ready",
        ...(input.search === undefined || input.search.length === 0
          ? {}
          : {
              displayName: { contains: input.search, mode: "insensitive" },
            }),
        ...(cursor === null
          ? {}
          : {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    const visible = documents.slice(0, input.limit);
    const versionIds = [
      ...new Set(
        visible.flatMap((document) => [
          ...(document.activeProcessingVersionId === null
            ? []
            : [document.activeProcessingVersionId]),
          ...(document.candidateVersionId === null
            ? []
            : [document.candidateVersionId]),
        ]),
      ),
    ];
    const versions = await this.#database.knowledgeBaseDocumentVersion.findMany(
      {
        where: { id: { in: versionIds } },
      },
    );
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );
    return {
      items: visible.map((document) => ({
        document: documentRecord(document),
        processingVersion:
          document.activeProcessingVersionId === null
            ? null
            : versionById.get(document.activeProcessingVersionId) === undefined
              ? null
              : versionRecord(
                  versionById.get(
                    document.activeProcessingVersionId,
                  ) as Prisma.KnowledgeBaseDocumentVersionModel,
                ),
        failedCandidateVersion:
          document.candidateVersionId === null ||
          document.activeProcessingVersionId === document.candidateVersionId
            ? null
            : failedCandidateVersion(
                versionById.get(document.candidateVersionId),
              ),
      })),
      nextCursor:
        documents.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async listDirectoryEntries(input: {
    knowledgeBaseId: string;
    parentEntryId: string | null;
    includeOwnerOnlyStates: boolean;
    cursor?: string;
    limit: number;
  }): Promise<{
    breadcrumbs: KnowledgeBaseEntryRecord[];
    items: KnowledgeBaseEntryWithDocument[];
    nextCursor: string | null;
  }> {
    const breadcrumbs = await this.#directoryBreadcrumbs(
      input.knowledgeBaseId,
      input.parentEntryId,
    );
    const cursor =
      input.cursor === undefined
        ? null
        : await this.#database.knowledgeBaseEntry.findFirst({
            where: {
              id: input.cursor,
              knowledgeBaseId: input.knowledgeBaseId,
              parentEntryId: input.parentEntryId,
            },
          });
    const rows = await this.#database.knowledgeBaseEntry.findMany({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        parentEntryId: input.parentEntryId,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { entryType: { lt: cursor.entryType } },
                {
                  entryType: cursor.entryType,
                  normalizedName: { gt: cursor.normalizedName },
                },
                {
                  entryType: cursor.entryType,
                  normalizedName: cursor.normalizedName,
                  id: { gt: cursor.id },
                },
              ],
            }),
      },
      orderBy: [
        { entryType: "desc" },
        { normalizedName: "asc" },
        { id: "asc" },
      ],
      take: input.limit + 1,
    });
    const visibleRows = rows.slice(0, input.limit);
    const items = await this.#hydrateDirectoryEntries({
      knowledgeBaseId: input.knowledgeBaseId,
      includeOwnerOnlyStates: input.includeOwnerOnlyStates,
      rows: visibleRows,
    });
    return {
      breadcrumbs,
      items,
      nextCursor:
        rows.length > input.limit ? (visibleRows.at(-1)?.id ?? null) : null,
    };
  }

  async listFlatDirectoryEntries(input: {
    knowledgeBaseId: string;
    includeOwnerOnlyStates: boolean;
    cursor?: string;
    limit: number;
  }): Promise<{
    breadcrumbs: KnowledgeBaseEntryRecord[];
    items: KnowledgeBaseEntryWithDocument[];
    nextCursor: string | null;
  }> {
    const cursor =
      input.cursor === undefined
        ? null
        : await this.#database.knowledgeBaseEntry.findFirst({
            where: {
              id: input.cursor,
              knowledgeBaseId: input.knowledgeBaseId,
            },
          });
    if (input.cursor !== undefined && cursor === null) {
      throw new AppError("VALIDATION_ERROR");
    }
    const rows = await this.#database.knowledgeBaseEntry.findMany({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { entryType: { lt: cursor.entryType } },
                {
                  entryType: cursor.entryType,
                  normalizedName: { gt: cursor.normalizedName },
                },
                {
                  entryType: cursor.entryType,
                  normalizedName: cursor.normalizedName,
                  id: { gt: cursor.id },
                },
              ],
            }),
      },
      orderBy: [
        { entryType: "desc" },
        { normalizedName: "asc" },
        { id: "asc" },
      ],
      take: input.limit + 1,
    });
    const visibleRows = rows.slice(0, input.limit);
    const hydrated = await this.#hydrateDirectoryEntries({
      knowledgeBaseId: input.knowledgeBaseId,
      includeOwnerOnlyStates: input.includeOwnerOnlyStates,
      rows: visibleRows,
    });
    const paths = await this.#directoryEntryPaths(
      input.knowledgeBaseId,
      hydrated.map(({ entry }) => entry),
    );
    return {
      breadcrumbs: [],
      items: hydrated.map((item) => ({
        ...item,
        path: paths.get(item.entry.id) ?? [item.entry.name],
      })),
      nextCursor:
        rows.length > input.limit ? (visibleRows.at(-1)?.id ?? null) : null,
    };
  }

  async findDocumentIdAtPath(input: {
    knowledgeBaseId: string;
    parentEntryId: string | null;
    segments: string[];
  }): Promise<string | null> {
    if (input.segments.length === 0) throw new AppError("VALIDATION_ERROR");
    let parentEntryId = input.parentEntryId;
    if (parentEntryId !== null) {
      const parent = await this.#database.knowledgeBaseEntry.findFirst({
        where: {
          id: parentEntryId,
          knowledgeBaseId: input.knowledgeBaseId,
          entryType: "folder",
        },
      });
      if (parent === null) throw new AppError("NOT_FOUND");
    }
    for (const [index, name] of input.segments.entries()) {
      const entry = await this.#findSiblingEntry(
        input.knowledgeBaseId,
        parentEntryId,
        normalizeKnowledgeEntryName(name),
      );
      if (entry === null) return null;
      const isLeaf = index === input.segments.length - 1;
      if (!isLeaf) {
        if (entry.entryType !== "folder") throw new AppError("CONFLICT");
        parentEntryId = entry.id;
        continue;
      }
      if (entry.entryType !== "document" || entry.documentId === null) {
        throw new AppError("CONFLICT");
      }
      return entry.documentId;
    }
    return null;
  }

  async #hydrateDirectoryEntries(input: {
    knowledgeBaseId: string;
    includeOwnerOnlyStates: boolean;
    rows: Prisma.KnowledgeBaseEntryModel[];
  }): Promise<KnowledgeBaseEntryWithDocument[]> {
    const documentIds = input.rows.flatMap((row) =>
      row.documentId === null ? [] : [row.documentId],
    );
    const documents = await this.#database.knowledgeBaseDocument.findMany({
      where: {
        id: { in: documentIds },
        knowledgeBaseId: input.knowledgeBaseId,
        status: input.includeOwnerOnlyStates ? { not: "deleted" } : "ready",
      },
    });
    const versionIds = [
      ...new Set(
        documents.flatMap((document) => [
          ...(document.activeProcessingVersionId === null
            ? []
            : [document.activeProcessingVersionId]),
          ...(document.candidateVersionId === null
            ? []
            : [document.candidateVersionId]),
        ]),
      ),
    ];
    const versions = await this.#database.knowledgeBaseDocumentVersion.findMany(
      {
        where: { id: { in: versionIds } },
      },
    );
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );
    const documentById = new Map(
      documents.map((document) => {
        const active =
          document.activeProcessingVersionId === null
            ? undefined
            : versionById.get(document.activeProcessingVersionId);
        const candidate =
          document.candidateVersionId === null ||
          document.candidateVersionId === document.activeProcessingVersionId
            ? undefined
            : versionById.get(document.candidateVersionId);
        return [
          document.id,
          {
            document: documentRecord(document),
            processingVersion:
              active === undefined ? null : versionRecord(active),
            failedCandidateVersion: failedCandidateVersion(candidate),
          },
        ] as const;
      }),
    );
    const items: KnowledgeBaseEntryWithDocument[] = [];
    for (const entry of input.rows) {
      if (entry.documentId === null) {
        items.push({ entry: entryRecord(entry), document: null });
        continue;
      }
      const document = documentById.get(entry.documentId);
      if (document !== undefined) {
        items.push({ entry: entryRecord(entry), document });
      }
    }
    return items;
  }

  async #directoryEntryPaths(
    knowledgeBaseId: string,
    entries: KnowledgeBaseEntryRecord[],
  ): Promise<Map<string, string[]>> {
    const folders = new Map<string, KnowledgeBaseEntryRecord>();
    let pending = new Set(
      entries.flatMap((entry) =>
        entry.parentEntryId === null ? [] : [entry.parentEntryId],
      ),
    );
    for (let depth = 0; pending.size > 0; depth += 1) {
      if (depth >= 64) throw new AppError("INTERNAL_ERROR");
      const requestedIds = [...pending];
      const rows = await this.#database.knowledgeBaseEntry.findMany({
        where: {
          id: { in: requestedIds },
          knowledgeBaseId,
          entryType: "folder",
        },
      });
      if (rows.length !== requestedIds.length) {
        throw new AppError("INTERNAL_ERROR");
      }
      pending = new Set<string>();
      for (const row of rows) {
        const folder = entryRecord(row);
        folders.set(folder.id, folder);
        if (
          folder.parentEntryId !== null &&
          !folders.has(folder.parentEntryId)
        ) {
          pending.add(folder.parentEntryId);
        }
      }
    }

    const paths = new Map<string, string[]>();
    for (const entry of entries) {
      const segments = [entry.name];
      const visited = new Set([entry.id]);
      let parentEntryId = entry.parentEntryId;
      while (parentEntryId !== null) {
        if (visited.has(parentEntryId)) throw new AppError("INTERNAL_ERROR");
        visited.add(parentEntryId);
        const folder = folders.get(parentEntryId);
        if (folder === undefined) throw new AppError("INTERNAL_ERROR");
        segments.unshift(folder.name);
        parentEntryId = folder.parentEntryId;
      }
      paths.set(entry.id, segments);
    }
    return paths;
  }

  async #directoryBreadcrumbs(
    knowledgeBaseId: string,
    parentEntryId: string | null,
  ): Promise<KnowledgeBaseEntryRecord[]> {
    if (parentEntryId === null) return [];
    const result: KnowledgeBaseEntryRecord[] = [];
    const visited = new Set<string>();
    let entryId: string | null = parentEntryId;
    while (entryId !== null) {
      if (visited.has(entryId) || result.length >= 64) {
        throw new AppError("INTERNAL_ERROR");
      }
      visited.add(entryId);
      const entry: Prisma.KnowledgeBaseEntryModel | null =
        await this.#database.knowledgeBaseEntry.findFirst({
          where: { id: entryId, knowledgeBaseId, entryType: "folder" },
        });
      if (entry === null) throw new AppError("NOT_FOUND");
      result.push(entryRecord(entry));
      entryId = entry.parentEntryId;
    }
    return result.reverse();
  }

  async findDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentWithProcessing | null> {
    const document = await this.#database.knowledgeBaseDocument.findFirst({
      where: { id: documentId, knowledgeBaseId, status: { not: "deleted" } },
    });
    if (document === null) return null;
    const versionIds = [
      ...new Set(
        [
          document.activeProcessingVersionId,
          document.candidateVersionId,
        ].filter((id): id is string => id !== null),
      ),
    ];
    const versions = await this.#database.knowledgeBaseDocumentVersion.findMany(
      {
        where: { id: { in: versionIds } },
      },
    );
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );
    const processingVersion =
      document.activeProcessingVersionId === null
        ? undefined
        : versionById.get(document.activeProcessingVersionId);
    const candidateVersion =
      document.candidateVersionId === null ||
      document.activeProcessingVersionId === document.candidateVersionId
        ? undefined
        : versionById.get(document.candidateVersionId);
    return {
      document: documentRecord(document),
      processingVersion:
        processingVersion === undefined
          ? null
          : versionRecord(processingVersion),
      failedCandidateVersion: failedCandidateVersion(candidateVersion),
    };
  }

  async findDocumentVersion(
    id: string,
  ): Promise<KnowledgeDocumentVersionRecord | null> {
    const value = await this.#database.knowledgeBaseDocumentVersion.findUnique({
      where: { id },
    });
    return value === null ? null : versionRecord(value);
  }

  async renameDocument(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    displayName: string;
    normalizedDisplayName: string;
    directoryTarget?: {
      parentEntryId: string | null;
      segments: string[];
      sourceItemId?: string;
    };
    now: Date;
  }): Promise<RenameKnowledgeDocumentResult> {
    await this.lockKnowledgeBase(input.knowledgeBaseId);
    await this.#lockDocument(input.documentId);
    const document = await this.#database.knowledgeBaseDocument.findFirst({
      where: {
        id: input.documentId,
        knowledgeBaseId: input.knowledgeBaseId,
        status: { not: "deleted" },
      },
    });
    if (document === null) return { status: "not_found" };
    const currentEntry = await this.#documentEntry(
      input.knowledgeBaseId,
      document,
      input.actorId,
      input.now,
    );
    const previousParentEntryId = currentEntry.parentEntryId;
    const parentEntryId =
      input.directoryTarget === undefined
        ? currentEntry.parentEntryId
        : await this.#resolveDirectoryParent({
            knowledgeBaseId: input.knowledgeBaseId,
            parentEntryId: input.directoryTarget.parentEntryId,
            segments: input.directoryTarget.segments,
            actorId: input.actorId,
            now: input.now,
          });
    const displayName =
      input.directoryTarget?.segments.at(-1) ?? input.displayName;
    const normalizedDisplayName = normalizeKnowledgeEntryName(displayName);
    const conflict = await this.#findSiblingEntry(
      input.knowledgeBaseId,
      parentEntryId,
      normalizedDisplayName,
    );
    if (conflict !== null && conflict.id !== currentEntry.id) {
      if (conflict.documentId === null) throw new AppError("CONFLICT");
      return {
        status: "name_conflict",
        existingDocumentId: conflict.documentId,
      };
    }
    const nextSourceItemId =
      input.directoryTarget === undefined
        ? currentEntry.sourceItemId
        : (input.directoryTarget.sourceItemId ?? null);
    const documentChanged =
      document.displayName !== displayName ||
      document.normalizedDisplayName !== normalizedDisplayName;
    const entryChanged =
      currentEntry.parentEntryId !== parentEntryId ||
      currentEntry.name !== displayName ||
      currentEntry.normalizedName !== normalizedDisplayName ||
      currentEntry.sourceItemId !== nextSourceItemId;
    const updated = documentChanged
      ? await this.#database.knowledgeBaseDocument.update({
          where: { id: document.id },
          data: {
            displayName,
            normalizedDisplayName,
            updatedAt: input.now,
          },
        })
      : document;
    if (entryChanged) {
      await this.#database.knowledgeBaseEntry.update({
        where: { id: currentEntry.id },
        data: {
          parentEntryId,
          name: displayName,
          normalizedName: normalizedDisplayName,
          sourceItemId: nextSourceItemId,
          updatedAt: input.now,
        },
      });
    }
    if (previousParentEntryId !== parentEntryId) {
      await this.#pruneEmptyFolderAncestors(previousParentEntryId);
    }
    const processingVersion =
      updated.activeProcessingVersionId === null
        ? null
        : await this.#database.knowledgeBaseDocumentVersion.findUnique({
            where: { id: updated.activeProcessingVersionId },
          });
    const candidateVersion =
      updated.candidateVersionId === null ||
      updated.candidateVersionId === updated.activeProcessingVersionId
        ? null
        : await this.#database.knowledgeBaseDocumentVersion.findUnique({
            where: { id: updated.candidateVersionId },
          });
    return {
      status: "renamed",
      value: {
        document: documentRecord(updated),
        processingVersion:
          processingVersion === null ? null : versionRecord(processingVersion),
        failedCandidateVersion: failedCandidateVersion(
          candidateVersion ?? undefined,
        ),
      },
    };
  }

  async listRebuildableDocumentPage(input: {
    knowledgeBaseId: string;
    afterDocumentId: string | null;
    limit: number;
  }): Promise<{ documentIds: string[]; nextCursor: string | null }> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    const rows = await this.#database.knowledgeBaseDocument.findMany({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        status: { not: "deleted" },
        ...(input.afterDocumentId === null
          ? {}
          : { id: { gt: input.afterDocumentId } }),
      },
      orderBy: { id: "asc" },
      select: { id: true },
      take: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    return {
      documentIds: page.map((row) => row.id),
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async reserveStorage(input: {
    reservationId: string;
    reservationLeaseToken: string;
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    actorId: string;
    sizeBytes: bigint;
    objectKeys: readonly string[];
    storageQuotaBytes: bigint;
    now: Date;
  }) {
    assertReservationObjectKeys(
      input.knowledgeBaseId,
      input.documentId,
      input.documentVersionId,
      input.objectKeys,
    );
    await this.lockKnowledgeBase(input.knowledgeBaseId);
    const base = await this.#database.knowledgeBase.findUnique({
      where: { id: input.knowledgeBaseId },
    });
    if (
      base === null ||
      base.ownerId !== input.actorId ||
      base.lifecycleStatus !== "active" ||
      base.availabilityStatus !== "enabled"
    ) {
      throw new AppError("KNOWLEDGE_BASE_NOT_ACTIVE");
    }
    const existingDocument =
      await this.#database.knowledgeBaseDocument.findUnique({
        where: { id: input.documentId },
        select: { knowledgeBaseId: true, status: true },
      });
    if (
      existingDocument !== null &&
      (existingDocument.knowledgeBaseId !== input.knowledgeBaseId ||
        existingDocument.status === "deleted")
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    }
    if (
      input.sizeBytes < 0n ||
      base.storageUsedBytes + base.storageReservedBytes + input.sizeBytes >
        input.storageQuotaBytes
    ) {
      return { status: "quota_exceeded" as const };
    }
    await this.#database.knowledgeBaseStorageReservation.create({
      data: {
        id: input.reservationId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        sizeBytes: input.sizeBytes,
        objectKeysJson: [...input.objectKeys] as Prisma.InputJsonValue,
        leaseToken: input.reservationLeaseToken,
        leaseExpiresAt: new Date(
          input.now.getTime() + UPLOAD_RESERVATION_LEASE_MS,
        ),
        expiresAt: new Date(
          input.now.getTime() + UPLOAD_RESERVATION_RETENTION_MS,
        ),
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    if (input.sizeBytes > 0n) {
      await this.#database.knowledgeBase.update({
        where: { id: input.knowledgeBaseId },
        data: {
          storageReservedBytes: { increment: input.sizeBytes },
          updatedAt: input.now,
        },
      });
    }
    return { status: "reserved" as const };
  }

  async heartbeatStorageReservation(input: {
    reservationId: string;
    reservationLeaseToken: string;
    knowledgeBaseId: string;
    now: Date;
  }): Promise<void> {
    await this.lockKnowledgeBase(input.knowledgeBaseId);
    const refreshed =
      await this.#database.knowledgeBaseStorageReservation.updateMany({
        where: {
          id: input.reservationId,
          knowledgeBaseId: input.knowledgeBaseId,
          leaseToken: input.reservationLeaseToken,
          cleanupStartedAt: null,
          leaseExpiresAt: { gt: input.now },
        },
        data: {
          leaseExpiresAt: new Date(
            input.now.getTime() + UPLOAD_RESERVATION_LEASE_MS,
          ),
          updatedAt: input.now,
        },
      });
    if (refreshed.count !== 1) {
      throw new AppError("KNOWLEDGE_DOCUMENT_PROCESSING_CONFLICT");
    }
  }

  async releaseStorageReservation(input: {
    reservationId: string;
    reservationLeaseToken: string;
    knowledgeBaseId: string;
    sizeBytes: bigint;
    now: Date;
  }): Promise<void> {
    await this.lockKnowledgeBase(input.knowledgeBaseId);
    const reservation =
      await this.#database.knowledgeBaseStorageReservation.findUnique({
        where: { id: input.reservationId },
      });
    if (reservation === null) return;
    if (
      reservation.knowledgeBaseId !== input.knowledgeBaseId ||
      reservation.sizeBytes !== input.sizeBytes ||
      reservation.leaseToken !== input.reservationLeaseToken ||
      reservation.cleanupStartedAt !== null ||
      reservation.leaseExpiresAt <= input.now
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    if (input.sizeBytes > 0n) {
      const released = await this.#database.knowledgeBase.updateMany({
        where: {
          id: input.knowledgeBaseId,
          storageReservedBytes: { gte: input.sizeBytes },
        },
        data: {
          storageReservedBytes: { decrement: input.sizeBytes },
          updatedAt: input.now,
        },
      });
      if (released.count !== 1) throw new AppError("INTERNAL_ERROR");
    }
    await this.#database.knowledgeBaseStorageReservation.delete({
      where: { id: input.reservationId },
    });
  }

  async #findSiblingEntry(
    knowledgeBaseId: string,
    parentEntryId: string | null,
    normalizedName: string,
  ) {
    return this.#database.knowledgeBaseEntry.findFirst({
      where: { knowledgeBaseId, parentEntryId, normalizedName },
    });
  }

  async #resolveDirectoryParent(input: {
    knowledgeBaseId: string;
    parentEntryId: string | null;
    segments: string[];
    actorId: string;
    now: Date;
  }): Promise<string | null> {
    if (input.segments.length === 0) throw new AppError("VALIDATION_ERROR");
    let parentEntryId = input.parentEntryId;
    if (parentEntryId !== null) {
      const parent = await this.#database.knowledgeBaseEntry.findFirst({
        where: {
          id: parentEntryId,
          knowledgeBaseId: input.knowledgeBaseId,
          entryType: "folder",
        },
      });
      if (parent === null) throw new AppError("NOT_FOUND");
    }
    for (const name of input.segments.slice(0, -1)) {
      const normalizedName = normalizeKnowledgeEntryName(name);
      const existing = await this.#findSiblingEntry(
        input.knowledgeBaseId,
        parentEntryId,
        normalizedName,
      );
      if (existing !== null) {
        if (existing.entryType !== "folder") throw new AppError("CONFLICT");
        parentEntryId = existing.id;
        continue;
      }
      const created = await this.#database.knowledgeBaseEntry.create({
        data: {
          knowledgeBaseId: input.knowledgeBaseId,
          parentEntryId,
          entryType: "folder",
          name,
          normalizedName,
          createdBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      parentEntryId = created.id;
    }
    return parentEntryId;
  }

  async #documentEntry(
    knowledgeBaseId: string,
    document: Prisma.KnowledgeBaseDocumentModel,
    actorId: string,
    now: Date,
  ) {
    const existing = await this.#database.knowledgeBaseEntry.findFirst({
      where: { knowledgeBaseId, documentId: document.id },
    });
    if (existing !== null) return existing;
    return this.#database.knowledgeBaseEntry.create({
      data: {
        knowledgeBaseId,
        parentEntryId: null,
        entryType: "document",
        name: document.displayName,
        normalizedName: document.normalizedDisplayName,
        documentId: document.id,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async #allocateEntryName(
    knowledgeBaseId: string,
    parentEntryId: string | null,
    desired: string,
  ): Promise<string> {
    const existing = await this.#database.knowledgeBaseEntry.findMany({
      where: { knowledgeBaseId, parentEntryId },
      select: { normalizedName: true },
    });
    const names = new Set(existing.map((row) => row.normalizedName));
    const dot = desired.lastIndexOf(".");
    const stem = dot > 0 ? desired.slice(0, dot) : desired;
    const extension = dot > 0 ? desired.slice(dot) : "";
    for (let suffix = 2; suffix < 1_000_000; suffix += 1) {
      const candidate = `${stem} (${suffix})${extension}`;
      if (!names.has(normalizeKnowledgeEntryName(candidate))) return candidate;
    }
    throw new AppError("CONFLICT");
  }

  async #pruneEmptyFolderAncestors(entryId: string | null): Promise<void> {
    let currentId = entryId;
    const visited = new Set<string>();
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const current = await this.#database.knowledgeBaseEntry.findFirst({
        where: { id: currentId, entryType: "folder" },
      });
      if (current === null) return;
      const childCount = await this.#database.knowledgeBaseEntry.count({
        where: { parentEntryId: current.id },
      });
      if (childCount > 0) return;
      await this.#database.knowledgeBaseEntry.delete({
        where: { id: current.id },
      });
      currentId = current.parentEntryId;
    }
  }

  async registerDocumentUpload(
    input: RegisterDocumentUploadInput,
  ): Promise<RegisterDocumentUploadResult> {
    await this.lockKnowledgeBase(input.knowledgeBaseId);
    const base = await this.#database.knowledgeBase.findUnique({
      where: { id: input.knowledgeBaseId },
    });
    if (
      base === null ||
      base.ownerId !== input.actorId ||
      base.lifecycleStatus !== "active" ||
      base.availabilityStatus !== "enabled"
    ) {
      throw new AppError("KNOWLEDGE_BASE_NOT_ACTIVE");
    }
    const reservation =
      await this.#database.knowledgeBaseStorageReservation.findUnique({
        where: { id: input.storageReservationId },
      });
    if (
      reservation === null ||
      reservation.knowledgeBaseId !== input.knowledgeBaseId ||
      reservation.documentId !== input.documentId ||
      reservation.documentVersionId !== input.versionId ||
      reservation.sizeBytes !== input.ingestion.original.sizeBytes ||
      reservation.leaseToken !== input.storageReservationLeaseToken ||
      reservation.cleanupStartedAt !== null ||
      reservation.leaseExpiresAt <= input.now ||
      !reservationHasExactObjectKeys(reservation.objectKeysJson, [
        input.ingestion.original.objectKey,
      ]) ||
      base.storageReservedBytes < input.ingestion.original.sizeBytes ||
      base.storageUsedBytes + base.storageReservedBytes >
        input.storageQuotaBytes
    ) {
      return { status: "quota_exceeded" };
    }
    const parentEntryId = await this.#resolveDirectoryParent({
      knowledgeBaseId: input.knowledgeBaseId,
      parentEntryId: input.entry.parentEntryId,
      segments: input.entry.segments,
      actorId: input.actorId,
      now: input.now,
    });
    const rejectUpload = async (
      result: RegisterDocumentUploadResult,
    ): Promise<RegisterDocumentUploadResult> => {
      await this.#pruneEmptyFolderAncestors(parentEntryId);
      return result;
    };
    const desiredDisplayName = input.entry.segments.at(-1);
    if (desiredDisplayName === undefined)
      throw new AppError("VALIDATION_ERROR");
    const desiredNormalizedName =
      normalizeKnowledgeEntryName(desiredDisplayName);
    const pathEntry = await this.#findSiblingEntry(
      input.knowledgeBaseId,
      parentEntryId,
      desiredNormalizedName,
    );
    if (pathEntry?.entryType === "folder") throw new AppError("CONFLICT");
    const sourceEntry =
      input.entry.sourceItemId === undefined
        ? null
        : await this.#database.knowledgeBaseEntry.findFirst({
            where: {
              knowledgeBaseId: input.knowledgeBaseId,
              sourceItemId: input.entry.sourceItemId,
            },
          });
    if (
      sourceEntry !== null &&
      pathEntry !== null &&
      sourceEntry.id !== pathEntry.id
    ) {
      if (pathEntry.documentId === null) throw new AppError("CONFLICT");
      return rejectUpload({
        status: "name_conflict",
        existingDocumentId: pathEntry.documentId,
        displayName: pathEntry.name,
      });
    }
    const currentPathDocumentId = pathEntry?.documentId ?? null;
    if (
      input.conflictResolution === "replace_path" &&
      currentPathDocumentId !== input.pathDocumentIdBeforeUpload
    ) {
      return rejectUpload({ status: "processing_conflict" });
    }
    const targetId =
      input.conflictResolution === "replace"
        ? input.replaceDocumentId
        : input.conflictResolution === "replace_path"
          ? currentPathDocumentId
          : null;
    if (targetId !== null && targetId !== input.documentId) {
      return rejectUpload({ status: "processing_conflict" });
    }
    const duplicateTargetId = targetId ?? pathEntry?.documentId ?? null;
    if (duplicateTargetId !== null) {
      const duplicateDocument =
        await this.#database.knowledgeBaseDocument.findFirst({
          where: {
            id: duplicateTargetId,
            knowledgeBaseId: input.knowledgeBaseId,
            status: { not: "deleted" },
          },
        });
      if (duplicateDocument !== null) {
        if (
          duplicateDocument.originalSha256 ===
          input.ingestion.original.checksumSha256
        ) {
          return rejectUpload({
            status: "duplicate",
            existingDocumentId: duplicateDocument.id,
          });
        }
        const processingDuplicate =
          await this.#database.knowledgeBaseDocumentVersion.findFirst({
            where: {
              documentId: duplicateDocument.id,
              originalSha256: input.ingestion.original.checksumSha256,
              versionStatus: "processing",
            },
            select: { id: true },
          });
        if (processingDuplicate !== null) {
          return rejectUpload({
            status: "duplicate",
            existingDocumentId: duplicateDocument.id,
          });
        }
      }
    }
    if (pathEntry !== null && input.conflictResolution === undefined) {
      if (pathEntry.documentId === null) throw new AppError("CONFLICT");
      return rejectUpload({
        status: "name_conflict",
        existingDocumentId: pathEntry.documentId,
        displayName: pathEntry.name,
      });
    }

    if (targetId !== null) {
      await this.#lockDocument(targetId);
      const target = await this.#database.knowledgeBaseDocument.findFirst({
        where: {
          id: targetId,
          knowledgeBaseId: input.knowledgeBaseId,
          status: { not: "deleted" },
        },
      });
      if (target === null) {
        return rejectUpload({ status: "replace_target_not_found" });
      }
      if (target.activeProcessingVersionId !== null) {
        return rejectUpload({ status: "processing_conflict" });
      }
      const targetEntry = await this.#documentEntry(
        input.knowledgeBaseId,
        target,
        input.actorId,
        input.now,
      );
      if (pathEntry !== null && pathEntry.id !== targetEntry.id) {
        if (pathEntry.documentId === null) throw new AppError("CONFLICT");
        return rejectUpload({
          status: "name_conflict",
          existingDocumentId: pathEntry.documentId,
          displayName: pathEntry.name,
        });
      }
      const aggregate =
        await this.#database.knowledgeBaseDocumentVersion.aggregate({
          where: { documentId: target.id },
          _max: { versionNumber: true },
        });
      const version = await this.#database.knowledgeBaseDocumentVersion.create({
        data: versionCreateData({
          input,
          documentId: target.id,
          versionNumber: (aggregate._max.versionNumber ?? 0) + 1,
          operation: "replace",
          sourceVersionId: null,
        }),
      });
      await this.#database.knowledgeBaseObject.create({
        data: originalObjectCreateData(input, target.id),
      });
      const document = await this.#database.knowledgeBaseDocument.update({
        where: { id: target.id },
        data: {
          displayName: desiredDisplayName,
          normalizedDisplayName: desiredNormalizedName,
          candidateVersionId: version.id,
          activeProcessingVersionId: version.id,
          stableErrorCode: null,
          updatedAt: input.now,
        },
      });
      await this.#database.knowledgeBaseEntry.update({
        where: { id: targetEntry.id },
        data: {
          parentEntryId,
          name: desiredDisplayName,
          normalizedName: desiredNormalizedName,
          sourceItemId: input.entry.sourceItemId ?? targetEntry.sourceItemId,
          updatedAt: input.now,
        },
      });
      if (targetEntry.parentEntryId !== parentEntryId) {
        await this.#pruneEmptyFolderAncestors(targetEntry.parentEntryId);
      }
      await this.#database.knowledgeBase.update({
        where: { id: input.knowledgeBaseId },
        data: {
          storageUsedBytes: { increment: input.ingestion.original.sizeBytes },
          storageReservedBytes: {
            decrement: input.ingestion.original.sizeBytes,
          },
          updatedAt: input.now,
        },
      });
      await this.#database.knowledgeBaseStorageReservation.delete({
        where: { id: input.storageReservationId },
      });
      return {
        status: "registered",
        value: {
          document: documentRecord(document),
          processingVersion: versionRecord(version),
        },
      };
    }

    const displayName =
      pathEntry === null
        ? desiredDisplayName
        : await this.#allocateEntryName(
            input.knowledgeBaseId,
            parentEntryId,
            desiredDisplayName,
          );
    const normalizedDisplayName = normalizeKnowledgeEntryName(displayName);
    const document = await this.#database.knowledgeBaseDocument.create({
      data: {
        id: input.documentId,
        knowledgeBaseId: input.knowledgeBaseId,
        displayName,
        normalizedDisplayName,
        canonicalExtension: input.ingestion.canonicalExtension,
        mimeType: input.ingestion.canonicalMimeType,
        sizeBytes: input.ingestion.original.sizeBytes,
        originalSha256: input.ingestion.original.checksumSha256,
        status: "processing",
        candidateVersionId: input.versionId,
        activeProcessingVersionId: input.versionId,
        cleanupStatus: "completed",
        createdBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    const version = await this.#database.knowledgeBaseDocumentVersion.create({
      data: versionCreateData({
        input,
        documentId: document.id,
        versionNumber: 1,
        operation: "upload",
        sourceVersionId: null,
      }),
    });
    await this.#database.knowledgeBaseObject.create({
      data: originalObjectCreateData(input, document.id),
    });
    await this.#database.knowledgeBaseEntry.create({
      data: {
        knowledgeBaseId: input.knowledgeBaseId,
        parentEntryId,
        entryType: "document",
        name: displayName,
        normalizedName: normalizedDisplayName,
        documentId: document.id,
        sourceItemId: input.entry.sourceItemId ?? null,
        createdBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBase.update({
      where: { id: input.knowledgeBaseId },
      data: {
        storageUsedBytes: { increment: input.ingestion.original.sizeBytes },
        storageReservedBytes: {
          decrement: input.ingestion.original.sizeBytes,
        },
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseStorageReservation.delete({
      where: { id: input.storageReservationId },
    });
    return {
      status: "registered",
      value: {
        document: documentRecord(document),
        processingVersion: versionRecord(version),
      },
    };
  }

  async markProcessingEnqueueFailed(input: {
    knowledgeBaseId: string;
    documentId: string;
    versionId: string;
    processingGeneration: string;
    stableErrorCode: string;
    now: Date;
  }): Promise<void> {
    const [document, version] = await Promise.all([
      this.#database.knowledgeBaseDocument.findUnique({
        where: { id: input.documentId },
      }),
      this.#database.knowledgeBaseDocumentVersion.findFirst({
        where: {
          id: input.versionId,
          knowledgeBaseId: input.knowledgeBaseId,
          documentId: input.documentId,
          processingGeneration: input.processingGeneration,
        },
      }),
    ]);
    if (
      document === null ||
      version === null ||
      document.activeProcessingVersionId !== version.id
    ) {
      return;
    }
    const rebuildOfCurrent =
      document.currentVersionId === version.id &&
      version.operationType === "rebuild_index";
    const destructiveRebuildFailure =
      rebuildOfCurrent && document.status === "processing";
    await this.#database.knowledgeBaseDocumentVersion.updateMany({
      where: {
        id: input.versionId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        processingGeneration: input.processingGeneration,
        ...(rebuildOfCurrent
          ? { versionStatus: "ready", operationType: "rebuild_index" }
          : { versionStatus: "processing" }),
      },
      data: {
        versionStatus: rebuildOfCurrent ? "ready" : "failed",
        processingStage: "failed",
        stableErrorCode: input.stableErrorCode,
        retryAt: null,
        processingRevision: { increment: 1 },
        completedAt: input.now,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseDocument.update({
      where: { id: document.id },
      data: {
        status:
          document.currentVersionId === null || destructiveRebuildFailure
            ? "failed"
            : "ready",
        activeProcessingVersionId: null,
        candidateVersionId: rebuildOfCurrent
          ? version.id
          : document.candidateVersionId,
        stableErrorCode:
          document.currentVersionId === null || destructiveRebuildFailure
            ? input.stableErrorCode
            : null,
        updatedAt: input.now,
      },
    });
  }

  async prepareProcessing(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    operation: KnowledgeProcessingRequestOperation;
    newVersionId: string;
    processingGeneration: string;
    now: Date;
  }): Promise<PrepareKnowledgeProcessingResult> {
    await this.#lockDocument(input.documentId);
    const document = await this.#database.knowledgeBaseDocument.findFirst({
      where: {
        id: input.documentId,
        knowledgeBaseId: input.knowledgeBaseId,
        status: { not: "deleted" },
      },
    });
    if (document === null) return { status: "not_found" };
    if (document.activeProcessingVersionId !== null) {
      return { status: "processing_conflict" };
    }
    if (
      input.operation === "retry" ||
      input.operation === "retry_failed_or_rebuild_index"
    ) {
      const retryId = document.candidateVersionId;
      const candidate =
        retryId === null
          ? null
          : await this.#database.knowledgeBaseDocumentVersion.findUnique({
              where: { id: retryId },
            });
      const retriesFailedRebuild =
        candidate !== null &&
        candidate.id === document.currentVersionId &&
        candidate.versionStatus === "ready" &&
        candidate.operationType === "rebuild_index" &&
        candidate.processingStage === "failed";
      const canRetryCandidate =
        candidate !== null &&
        (candidate.versionStatus === "failed" || retriesFailedRebuild);
      if (!canRetryCandidate && input.operation === "retry") {
        return { status: "invalid_state" };
      }
      if (canRetryCandidate) {
        const version =
          await this.#database.knowledgeBaseDocumentVersion.update({
            where: { id: candidate.id },
            data: retriesFailedRebuild
              ? {
                  operationType: "rebuild_index",
                  processingGeneration: input.processingGeneration,
                  versionStatus: "ready",
                  processingStage: "embedding",
                  progressPercent: 70,
                  processingRevision: { increment: 1 },
                  stageAttemptCount: 0,
                  stableErrorCode: null,
                  stableErrorParamsJson: Prisma.DbNull,
                  retryAt: null,
                  cancelRequestedAt: null,
                  cancelRequestedBy: null,
                  cancelReason: null,
                  completedAt: null,
                  updatedAt: input.now,
                }
              : {
                  operationType: "retry",
                  processingGeneration: input.processingGeneration,
                  versionStatus: "processing",
                  processingStage: "queued",
                  progressPercent: Math.min(candidate.progressPercent, 97),
                  processingRevision: { increment: 1 },
                  stageAttemptCount: 0,
                  stableErrorCode: null,
                  stableErrorParamsJson: Prisma.DbNull,
                  retryAt: null,
                  cancelRequestedAt: null,
                  cancelRequestedBy: null,
                  cancelReason: null,
                  completedAt: null,
                  updatedAt: input.now,
                },
          });
        const updatedDocument =
          await this.#database.knowledgeBaseDocument.update({
            where: { id: document.id },
            data: {
              status:
                retriesFailedRebuild && document.status === "failed"
                  ? "processing"
                  : document.currentVersionId === null
                    ? "processing"
                    : "ready",
              activeProcessingVersionId: version.id,
              stableErrorCode: null,
              updatedAt: input.now,
            },
          });
        return {
          status: "prepared",
          value: {
            document: documentRecord(updatedDocument),
            processingVersion: versionRecord(version),
          },
        };
      }
    }

    const currentVersionId = document.currentVersionId;
    const current =
      currentVersionId === null
        ? null
        : await this.#database.knowledgeBaseDocumentVersion.findUnique({
            where: { id: currentVersionId },
          });
    if (current !== null && current.versionStatus !== "ready") {
      return { status: "invalid_state" };
    }
    if (
      input.operation === "rebuild_index" ||
      input.operation === "retry_failed_or_rebuild_index"
    ) {
      if (current === null) return { status: "invalid_state" };
      const version = await this.#database.knowledgeBaseDocumentVersion.update({
        where: { id: current.id },
        data: {
          operationType: "rebuild_index",
          processingGeneration: input.processingGeneration,
          processingStage: "embedding",
          progressPercent: 70,
          processingRevision: { increment: 1 },
          stageAttemptCount: 0,
          stableErrorCode: null,
          stableErrorParamsJson: Prisma.DbNull,
          retryAt: null,
          cancelRequestedAt: null,
          cancelRequestedBy: null,
          cancelReason: null,
          completedAt: null,
          updatedAt: input.now,
        },
      });
      const updatedDocument = await this.#database.knowledgeBaseDocument.update(
        {
          where: { id: document.id },
          data: {
            ...(document.status === "failed" ? { status: "processing" } : {}),
            activeProcessingVersionId: current.id,
            candidateVersionId: current.id,
            stableErrorCode: null,
            updatedAt: input.now,
          },
        },
      );
      return {
        status: "prepared",
        value: {
          document: documentRecord(updatedDocument),
          processingVersion: versionRecord(version),
        },
      };
    }
    const failedCandidate =
      current === null &&
      input.operation === "reprocess" &&
      document.candidateVersionId !== null
        ? await this.#database.knowledgeBaseDocumentVersion.findUnique({
            where: { id: document.candidateVersionId },
          })
        : null;
    const reprocessSource =
      current ??
      (failedCandidate !== null &&
      failedCandidate.knowledgeBaseId === input.knowledgeBaseId &&
      failedCandidate.documentId === input.documentId &&
      failedCandidate.versionStatus === "failed"
        ? failedCandidate
        : null);
    if (reprocessSource === null) return { status: "invalid_state" };
    const aggregate =
      await this.#database.knowledgeBaseDocumentVersion.aggregate({
        where: { documentId: document.id },
        _max: { versionNumber: true },
      });
    const originalSource = await resolveOriginalSource(this.#database, {
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: document.id,
      startVersion: reprocessSource,
    });
    if (originalSource === null) return { status: "invalid_state" };
    const version = await this.#database.knowledgeBaseDocumentVersion.create({
      data: {
        id: input.newVersionId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: document.id,
        sourceVersionId: originalSource.sourceVersionId,
        versionNumber: (aggregate._max.versionNumber ?? 0) + 1,
        versionStatus: "processing",
        operationType: "reprocess",
        processingGeneration: input.processingGeneration,
        processingStage: "queued",
        progressPercent: 15,
        processingRevision: 1,
        originalFilename: reprocessSource.originalFilename,
        canonicalExtension: reprocessSource.canonicalExtension,
        mimeType: reprocessSource.mimeType,
        sizeBytes: reprocessSource.sizeBytes,
        originalSha256: reprocessSource.originalSha256,
        processingConfigJson:
          reprocessSource.processingConfigJson as Prisma.InputJsonValue,
        createdBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    const updatedDocument = await this.#database.knowledgeBaseDocument.update({
      where: { id: document.id },
      data: {
        ...(current === null ? { status: "processing" } : {}),
        candidateVersionId: version.id,
        activeProcessingVersionId: version.id,
        stableErrorCode: null,
        updatedAt: input.now,
      },
    });
    return {
      status: "prepared",
      value: {
        document: documentRecord(updatedDocument),
        processingVersion: versionRecord(version),
      },
    };
  }

  async cancelProcessing(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<CancelKnowledgeProcessingResult> {
    await this.#lockDocument(input.documentId);
    const document = await this.#database.knowledgeBaseDocument.findFirst({
      where: {
        id: input.documentId,
        knowledgeBaseId: input.knowledgeBaseId,
        status: { not: "deleted" },
      },
    });
    if (document === null) return { status: "not_found" };
    if (document.activeProcessingVersionId === null) {
      return { status: "not_cancellable" };
    }
    const version =
      await this.#database.knowledgeBaseDocumentVersion.findUnique({
        where: { id: document.activeProcessingVersionId },
      });
    const cancellableStages = new Set([
      "queued",
      "parsing",
      "chunking",
      "parenting",
      "embedding",
      "indexing",
    ]);
    if (
      version === null ||
      !cancellableStages.has(version.processingStage) ||
      version.progressPercent >= 98
    ) {
      return { status: "not_cancellable" };
    }
    const rebuildOfCurrent =
      version.operationType === "rebuild_index" &&
      document.currentVersionId === version.id;
    const destructiveRebuildCancellation =
      rebuildOfCurrent && document.status === "processing";
    const updatedVersion =
      await this.#database.knowledgeBaseDocumentVersion.update({
        where: { id: version.id },
        data: rebuildOfCurrent
          ? {
              versionStatus: "ready",
              processingStage: "failed",
              processingRevision: { increment: 1 },
              stableErrorCode: "KNOWLEDGE_PROCESSING_CANCELLED",
              cancelRequestedAt: input.now,
              cancelRequestedBy: input.actorId,
              cancelReason: input.reason,
              retryAt: null,
              completedAt: input.now,
              updatedAt: input.now,
            }
          : {
              versionStatus: "failed",
              processingStage: "failed",
              processingRevision: { increment: 1 },
              stableErrorCode: "KNOWLEDGE_PROCESSING_CANCELLED",
              cancelRequestedAt: input.now,
              cancelRequestedBy: input.actorId,
              cancelReason: input.reason,
              retryAt: null,
              completedAt: input.now,
              updatedAt: input.now,
            },
      });
    await this.#database.knowledgeBaseProcessingAttempt.updateMany({
      where: {
        documentVersionId: version.id,
        processingGeneration: version.processingGeneration,
        status: "active",
      },
      data: {
        status: "discarded",
        discardedAt: input.now,
      },
    });
    const updatedDocument = await this.#database.knowledgeBaseDocument.update({
      where: { id: document.id },
      data: {
        status:
          document.currentVersionId === null || destructiveRebuildCancellation
            ? "failed"
            : "ready",
        activeProcessingVersionId: null,
        ...(rebuildOfCurrent ? { candidateVersionId: version.id } : {}),
        stableErrorCode:
          document.currentVersionId === null || destructiveRebuildCancellation
            ? "KNOWLEDGE_PROCESSING_CANCELLED"
            : null,
        updatedAt: input.now,
      },
    });
    return {
      status: "cancelled",
      value: {
        document: documentRecord(updatedDocument),
        processingVersion: null,
        failedCandidateVersion: versionRecord(updatedVersion),
      },
    };
  }

  async deleteDocument(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<DeleteKnowledgeDocumentResult> {
    await this.#lockDocument(input.documentId);
    const document = await this.#database.knowledgeBaseDocument.findFirst({
      where: {
        id: input.documentId,
        knowledgeBaseId: input.knowledgeBaseId,
        status: { not: "deleted" },
      },
    });
    if (document === null) return { status: "not_found" };
    const directoryEntry = await this.#database.knowledgeBaseEntry.findFirst({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: document.id,
      },
    });
    const deletedDocument = await this.#database.knowledgeBaseDocument.update({
      where: { id: document.id },
      data: {
        status: "deleted",
        deletedAt: input.now,
        deletedBy: input.actorId,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        activeProcessingVersionId: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseDocumentTombstone.upsert({
      where: { id: deletedDocument.id },
      create: {
        id: deletedDocument.id,
        knowledgeBaseId: deletedDocument.knowledgeBaseId,
        deletedBy: input.actorId,
        deletedAt: input.now,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
      update: {
        knowledgeBaseId: deletedDocument.knowledgeBaseId,
        deletedBy: input.actorId,
        deletedAt: input.now,
        deletionReason: input.reason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseDocumentVersion.updateMany({
      where: { documentId: document.id, versionStatus: { not: "deleted" } },
      data: {
        versionStatus: "deleted",
        retryAt: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseProcessingAttempt.updateMany({
      where: { documentId: document.id, status: "active" },
      data: {
        status: "discarded",
        discardedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseObject.updateMany({
      where: { documentId: document.id, lifecycleStatus: { not: "cleaned" } },
      data: {
        lifecycleStatus: "pending_cleanup",
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    });
    await this.#database.knowledgeBaseCleanupOutbox.create({
      data: {
        targetType: "document",
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: document.id,
        status: "pending",
        requestedBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    if (directoryEntry !== null) {
      await this.#database.knowledgeBaseEntry.delete({
        where: { id: directoryEntry.id },
      });
      await this.#pruneEmptyFolderAncestors(directoryEntry.parentEntryId);
    }
    return { status: "deleted" };
  }

  async resolveUsableKnowledgeBaseIds(
    actorId: string,
    requestedIds?: string[],
  ): Promise<string[]> {
    if (requestedIds?.length === 0) return [];
    const groupIds = await this.listActiveGroupIds(actorId);
    const grants = await this.#database.knowledgeBaseGrant.findMany({
      where: {
        ...(requestedIds === undefined
          ? {}
          : { knowledgeBaseId: { in: requestedIds } }),
        status: "active",
        OR: [
          { granteeType: "user", userId: actorId },
          ...(groupIds.length === 0
            ? []
            : [{ granteeType: "user_group", userGroupId: { in: groupIds } }]),
        ],
      },
      select: { knowledgeBaseId: true },
    });
    const granted = new Set(grants.map((grant) => grant.knowledgeBaseId));
    const bases = await this.#database.knowledgeBase.findMany({
      where: {
        ...(requestedIds === undefined
          ? { OR: [{ ownerId: actorId }, { id: { in: [...granted] } }] }
          : { id: { in: requestedIds } }),
        lifecycleStatus: "active",
        availabilityStatus: "enabled",
      },
      orderBy: { id: "asc" },
      select: { id: true, ownerId: true },
    });
    const usable = new Set(
      bases
        .filter((base) => base.ownerId === actorId || granted.has(base.id))
        .map((base) => base.id),
    );
    return (requestedIds ?? bases.map((base) => base.id)).filter((id) =>
      usable.has(id),
    );
  }

  async persistTurnKnowledgeBaseSnapshot(input: {
    turnId: string;
    knowledgeBaseIds: string[];
    now: Date;
  }): Promise<void> {
    const turn = await this.#database.conversationTurn.findUnique({
      where: { id: input.turnId },
      select: { id: true },
    });
    if (turn === null) throw new AppError("CONVERSATION_NOT_FOUND");
    const existing =
      await this.#database.conversationTurnKnowledgeBase.findMany({
        where: { turnId: input.turnId },
        orderBy: { selectionOrder: "asc" },
        select: { knowledgeBaseId: true },
      });
    if (existing.length > 0) {
      const existingIds = existing.map((row) => row.knowledgeBaseId);
      if (
        JSON.stringify(existingIds) !== JSON.stringify(input.knowledgeBaseIds)
      ) {
        throw new AppError("CONFLICT");
      }
      return;
    }
    await this.#database.conversationTurn.update({
      where: { id: input.turnId },
      data: {
        knowledgeBaseIdsJson: input.knowledgeBaseIds as Prisma.InputJsonValue,
        updatedAt: input.now,
      },
    });
    if (input.knowledgeBaseIds.length > 0) {
      await this.#database.conversationTurnKnowledgeBase.createMany({
        data: input.knowledgeBaseIds.map((knowledgeBaseId, selectionOrder) => ({
          turnId: input.turnId,
          knowledgeBaseId,
          selectionOrder,
          createdAt: input.now,
        })),
      });
    }
  }

  async getTurnKnowledgeBaseIds(input: {
    turnId?: string;
    codexTurnId?: string;
  }): Promise<string[]> {
    if (input.turnId === undefined && input.codexTurnId === undefined)
      return [];
    const turnWhere: Prisma.ConversationTurnWhereInput =
      input.turnId !== undefined
        ? { id: input.turnId }
        : { codexTurnId: input.codexTurnId as string };
    const turn = await this.#database.conversationTurn.findFirst({
      where: turnWhere,
      select: { id: true },
    });
    if (turn === null) {
      if (input.turnId === undefined) return [];
      const startIntent =
        await this.#database.conversationTurnStartIntent.findUnique({
          where: { projectionTurnId: input.turnId },
          select: { knowledgeBaseIdsJson: true },
        });
      return startIntent === null
        ? []
        : stringArray(startIntent.knowledgeBaseIdsJson);
    }
    const rows = await this.#database.conversationTurnKnowledgeBase.findMany({
      where: { turnId: turn.id },
      orderBy: { selectionOrder: "asc" },
      select: { knowledgeBaseId: true },
    });
    return rows.map((row) => row.knowledgeBaseId);
  }

  async writeAudit(input: KnowledgeAuditInput): Promise<void> {
    await this.#database.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        result: input.result,
        metadataJson:
          input.metadata === undefined
            ? Prisma.DbNull
            : sanitizeAuditMetadata(input.action, input.metadata),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }
}

function searchableDocumentWhere(
  scope: Pick<Prisma.KnowledgeBaseDocumentWhereInput, "knowledgeBaseId">,
  criteria: KnowledgeDocumentSearchabilityCriteria = {},
): Prisma.KnowledgeBaseDocumentWhereInput {
  return {
    ...scope,
    status: "ready",
    currentVersionId: { not: null },
    ...(criteria.currentEmbeddingProfileHash === undefined
      ? {}
      : { embeddingProfileHash: criteria.currentEmbeddingProfileHash }),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function assertReservationObjectKeys(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId: string,
  objectKeys: readonly string[],
): void {
  if (
    objectKeys.length === 0 ||
    new Set(objectKeys).size !== objectKeys.length
  ) {
    throw new AppError("INTERNAL_ERROR");
  }
  for (const objectKey of objectKeys) {
    try {
      assertManagedKnowledgeObjectKey(objectKey);
    } catch {
      throw new AppError("INTERNAL_ERROR");
    }
    if (
      !objectKey.startsWith(
        `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${documentVersionId}/`,
      )
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
  }
}

function reservationHasExactObjectKeys(
  value: unknown,
  expectedObjectKeys: readonly string[],
): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== expectedObjectKeys.length ||
    value.some((item) => typeof item !== "string")
  ) {
    return false;
  }
  const actual = [...value].sort();
  const expected = [...expectedObjectKeys].sort();
  return actual.every((objectKey, index) => objectKey === expected[index]);
}

function accessSourcesFor(
  ownerId: string,
  actorId: string,
  grants: Array<
    Pick<Prisma.KnowledgeBaseGrantModel, "id" | "granteeType" | "userGroupId">
  >,
  groupNameById: ReadonlyMap<string, string> = new Map(),
): KnowledgeAccessSource[] {
  const result: KnowledgeAccessSource[] = [];
  if (ownerId === actorId) result.push({ type: "owner" });
  for (const grant of grants) {
    if (grant.granteeType === "user") {
      result.push({ type: "direct_share", grantId: grant.id });
      continue;
    }
    const groupId = grant.userGroupId;
    const groupName = groupId === null ? undefined : groupNameById.get(groupId);
    if (groupId !== null && groupName !== undefined) {
      result.push({
        type: "user_group",
        grantId: grant.id,
        groupId,
        groupName,
      });
    }
  }
  return result;
}

function versionCreateData(options: {
  input: RegisterDocumentUploadInput;
  documentId: string;
  versionNumber: number;
  operation: "upload" | "replace";
  sourceVersionId: string | null;
}): Prisma.KnowledgeBaseDocumentVersionCreateInput {
  return {
    id: options.input.versionId,
    knowledgeBaseId: options.input.knowledgeBaseId,
    documentId: options.documentId,
    sourceVersionId: options.sourceVersionId,
    versionNumber: options.versionNumber,
    versionStatus: "processing",
    operationType: options.operation,
    processingGeneration: options.input.processingGeneration,
    processingStage: "queued",
    progressPercent: 15,
    processingRevision: 1,
    originalFilename: options.input.ingestion.originalFilename,
    canonicalExtension: options.input.ingestion.canonicalExtension,
    mimeType: options.input.ingestion.canonicalMimeType,
    sizeBytes: options.input.ingestion.original.sizeBytes,
    originalSha256: options.input.ingestion.original.checksumSha256,
    processingConfigJson: {
      ocr_enabled: options.input.ocrEnabled,
    } as Prisma.InputJsonValue,
    createdBy: options.input.actorId,
    createdAt: options.input.now,
    updatedAt: options.input.now,
  };
}

function originalObjectCreateData(
  input: RegisterDocumentUploadInput,
  documentId: string,
): Prisma.KnowledgeBaseObjectCreateInput {
  return {
    id: input.ingestion.original.id,
    knowledgeBaseId: input.knowledgeBaseId,
    documentId,
    documentVersionId: input.versionId,
    processingGeneration: input.processingGeneration,
    objectType: "original",
    objectKey: input.ingestion.original.objectKey,
    assetReferenceId: null,
    mimeType: input.ingestion.original.mimeType,
    sizeBytes: input.ingestion.original.sizeBytes,
    checksumSha256: input.ingestion.original.checksumSha256,
    lifecycleStatus: "active",
    cleanupStatus: "completed",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createPrismaKnowledgeStore(
  client: PrismaClient,
): KnowledgeStore {
  return new PrismaKnowledgeStore(client);
}
