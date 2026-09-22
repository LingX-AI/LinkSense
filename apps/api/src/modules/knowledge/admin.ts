import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"

import { AppError } from "../../lib/errors.js"
import { sanitizeAuditMetadata } from "../audit/service.js"
import type { KnowledgeMaintenanceGate } from "./maintenance.js"
import {
  haveSameKnowledgeDocumentIds,
  runKnowledgeDocumentExclusiveMutation,
} from "./document-mutation.js"
import type {
  KnowledgeActor,
  KnowledgeAuditInput,
  KnowledgeBaseLifecycleStatus,
  KnowledgeProcessingScheduler,
} from "./types.js"

type DatabaseClient = PrismaClient | Prisma.TransactionClient

export type KnowledgeCleanupRetryTarget = {
  type: "outbox" | "document" | "document_version" | "object"
  id: string
}

export type KnowledgeAdminGrantMetadata = {
  id: string
  targetType: "user" | "user_group"
  targetId: string
  targetName: string
}

export type KnowledgeAdminBaseMetadataRecord = {
  id: string
  name: string
  owner: {
    id: string
    name: string
    status: "active" | "disabled"
  }
  lifecycleStatus: KnowledgeBaseLifecycleStatus
  availabilityStatus: "enabled" | "disabled"
  documentCounts: {
    total: number
    processing: number
    ready: number
    failed: number
  }
  storageUsedBytes: bigint
  storageReservedBytes: bigint
  grants: KnowledgeAdminGrantMetadata[]
  stableErrorCodes: string[]
  cleanupStatus: "pending" | "running" | "failed" | "completed"
  disabledReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeAdminStore {
  transaction<T>(work: (store: KnowledgeAdminStore) => Promise<T>): Promise<T>
  lockKnowledgeBase(id: string): Promise<void>
  listUndeletedDocumentIds(knowledgeBaseId: string): Promise<string[]>
  findKnowledgeBase(id: string): Promise<{
    id: string
    ownerId: string
    lifecycleStatus: KnowledgeBaseLifecycleStatus
    availabilityStatus: "enabled" | "disabled"
  } | null>
  listMetadata(input: {
    search?: string
    lifecycleStatus?: KnowledgeBaseLifecycleStatus
    availabilityStatus?: "enabled" | "disabled"
    cursor?: string
    limit: number
  }): Promise<{
    items: KnowledgeAdminBaseMetadataRecord[]
    nextCursor: string | null
  }>
  isActiveUser(id: string): Promise<boolean>
  findActiveGrant(input: {
    knowledgeBaseId: string
    grantId: string
  }): Promise<{
    id: string
    targetType: "user" | "user_group"
    targetId: string
  } | null>
  disableKnowledgeBase(input: {
    id: string
    actorId: string
    reason: string
    now: Date
  }): Promise<void>
  enableKnowledgeBase(input: { id: string; now: Date }): Promise<void>
  transferOwnership(input: {
    id: string
    ownerId: string
    now: Date
  }): Promise<void>
  archiveKnowledgeBase(input: {
    id: string
    actorId: string
    now: Date
  }): Promise<void>
  revokeGrant(input: {
    grantId: string
    actorId: string
    reason: string
    now: Date
  }): Promise<void>
  deleteKnowledgeBase(input: {
    id: string
    actorId: string
    reason: string
    now: Date
  }): Promise<void>
  retryCleanup(input: {
    knowledgeBaseId: string
    target: KnowledgeCleanupRetryTarget | undefined
    allowKnowledgeBaseTarget: boolean
    now: Date
  }): Promise<number>
  writeAudit(input: KnowledgeAuditInput): Promise<void>
}

export type KnowledgeAdminBaseView = {
  id: string
  name: string
  owner: {
    id: string
    name: string
    status: "active" | "disabled"
  }
  lifecycle_status: KnowledgeBaseLifecycleStatus
  availability_status: "enabled" | "disabled"
  document_counts: {
    total: number
    processing: number
    ready: number
    failed: number
  }
  storage_used_bytes: number
  storage_reserved_bytes: number
  share_count: number
  active_grants: Array<{
    id: string
    target_type: "user" | "user_group"
    target_id: string
    target_name: string
  }>
  stable_error_codes: string[]
  cleanup_status: "pending" | "running" | "failed" | "completed"
  disabled_reason: string | null
  created_at: string
  updated_at: string
}

export class KnowledgeAdminService {
  constructor(
    private readonly store: KnowledgeAdminStore,
    private readonly options: {
      now?: () => Date
      maintenanceGate?: Pick<KnowledgeMaintenanceGate, "assertAvailable">
      scheduler: KnowledgeProcessingScheduler
    },
  ) {}

  async list(
    actor: KnowledgeActor,
    input: {
      search?: string
      lifecycleStatus?: KnowledgeBaseLifecycleStatus
      availabilityStatus?: "enabled" | "disabled"
      cursor?: string
      limit: number
    },
  ): Promise<{ items: KnowledgeAdminBaseView[]; next_cursor: string | null }> {
    assertAdmin(actor)
    const result = await this.store.listMetadata(input)
    return {
      items: result.items.map(adminBaseView),
      next_cursor: result.nextCursor,
    }
  }

  async disable(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    reason: string,
  ): Promise<void> {
    await this.mutate(actor, knowledgeBaseId, reason, async (store, base, now) => {
      if (base.availabilityStatus !== "enabled") throw new AppError("CONFLICT")
      await store.disableKnowledgeBase({
        id: knowledgeBaseId,
        actorId: actor.id,
        reason,
        now,
      })
      await store.writeAudit(
        adminAudit(actor, "knowledge_base.admin_disabled", knowledgeBaseId, {
          reason,
          availability_status: "disabled",
        }),
      )
    })
  }

  async enable(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    reason: string,
  ): Promise<void> {
    await this.mutate(actor, knowledgeBaseId, reason, async (store, base, now) => {
      if (base.availabilityStatus !== "disabled") throw new AppError("CONFLICT")
      await store.enableKnowledgeBase({ id: knowledgeBaseId, now })
      await store.writeAudit(
        adminAudit(actor, "knowledge_base.admin_enabled", knowledgeBaseId, {
          reason,
          availability_status: "enabled",
        }),
      )
    })
  }

  async transferOwnership(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    newOwnerId: string,
    reason: string,
  ): Promise<void> {
    await this.mutate(actor, knowledgeBaseId, reason, async (store, base, now) => {
      if (base.ownerId === newOwnerId || !(await store.isActiveUser(newOwnerId))) {
        throw new AppError("KNOWLEDGE_BASE_GRANT_TARGET_INVALID")
      }
      await store.transferOwnership({ id: knowledgeBaseId, ownerId: newOwnerId, now })
      await store.writeAudit(
        adminAudit(actor, "knowledge_base.owner_transferred", knowledgeBaseId, {
          reason,
          previous_owner_id: base.ownerId,
          new_owner_id: newOwnerId,
        }),
      )
    })
  }

  async archive(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    reason: string,
  ): Promise<void> {
    await this.mutate(actor, knowledgeBaseId, reason, async (store, base, now) => {
      if (base.lifecycleStatus !== "active") throw new AppError("KNOWLEDGE_BASE_NOT_ACTIVE")
      await store.archiveKnowledgeBase({ id: knowledgeBaseId, actorId: actor.id, now })
      await store.writeAudit(
        adminAudit(actor, "knowledge_base.admin_archived", knowledgeBaseId, {
          reason,
          lifecycle_status: "archived",
        }),
      )
    })
  }

  async revokeGrant(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    grantId: string,
    reason: string,
  ): Promise<void> {
    await this.mutate(actor, knowledgeBaseId, reason, async (store, _base, now) => {
      const grant = await store.findActiveGrant({ knowledgeBaseId, grantId })
      if (grant === null) throw new AppError("NOT_FOUND")
      await store.revokeGrant({ grantId, actorId: actor.id, reason, now })
      await store.writeAudit(
        adminAudit(actor, "knowledge_base.admin_grant_revoked", grantId, {
          knowledge_base_id: knowledgeBaseId,
          target_type: grant.targetType,
          target_id: grant.targetId,
          reason,
        }, "knowledge_base_grant"),
      )
    })
  }

  async forceDelete(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    reason: string,
  ): Promise<void> {
    assertAdmin(actor)
    requiredReason(reason)
    await this.options.maintenanceGate?.assertAvailable()
    const documentIds = await this.store.listUndeletedDocumentIds(knowledgeBaseId)
    await runKnowledgeDocumentExclusiveMutation({
      scheduler: this.options.scheduler,
      documentIds,
      operation: async (signal, orderedDocumentIds) => {
        if (signal.aborted) throw new AppError("KNOWLEDGE_DOCUMENT_BUSY")
        const now = (this.options.now ?? (() => new Date()))()
        await this.store.transaction(async (store) => {
          await store.lockKnowledgeBase(knowledgeBaseId)
          const base = await store.findKnowledgeBase(knowledgeBaseId)
          if (base === null || base.lifecycleStatus === "deleted") {
            throw new AppError("KNOWLEDGE_BASE_NOT_FOUND")
          }
          if (base.lifecycleStatus !== "archived") {
            throw new AppError("KNOWLEDGE_BASE_ARCHIVE_REQUIRED")
          }
          const currentDocumentIds =
            await store.listUndeletedDocumentIds(knowledgeBaseId)
          if (
            signal.aborted ||
            !haveSameKnowledgeDocumentIds(
              currentDocumentIds,
              orderedDocumentIds,
            )
          ) {
            throw new AppError("KNOWLEDGE_DOCUMENT_BUSY")
          }
          await store.deleteKnowledgeBase({
            id: knowledgeBaseId,
            actorId: actor.id,
            reason,
            now,
          })
          await store.writeAudit(
            adminAudit(
              actor,
              "knowledge_base.admin_force_deleted",
              knowledgeBaseId,
              {
                reason,
                lifecycle_status: "deleted",
              },
            ),
          )
        })
        this.options.scheduler.abortActiveDocumentMutations(
          orderedDocumentIds,
        )
      },
    })
  }

  async retryCleanup(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    target: KnowledgeCleanupRetryTarget | undefined,
    reason: string,
  ): Promise<{ retried_count: number }> {
    assertAdmin(actor)
    const normalizedReason = requiredReason(reason)
    const now = (this.options.now ?? (() => new Date()))()
    const retriedCount = await this.store.transaction(async (store) => {
      await store.lockKnowledgeBase(knowledgeBaseId)
      const base = await store.findKnowledgeBase(knowledgeBaseId)
      if (base === null) {
        throw new AppError("KNOWLEDGE_BASE_NOT_FOUND")
      }
      const count = await store.retryCleanup({
        knowledgeBaseId,
        target,
        allowKnowledgeBaseTarget: base.lifecycleStatus === "deleted",
        now,
      })
      if (count === 0) {
        throw new AppError("KNOWLEDGE_CLEANUP_TARGET_NOT_RETRYABLE")
      }
      await store.writeAudit(
        adminAudit(actor, "knowledge_base.cleanup_retried", knowledgeBaseId, {
          reason: normalizedReason,
          retried_count: count,
          cleanup_target_type: target?.type ?? "knowledge_base",
          cleanup_target_id: target?.id ?? knowledgeBaseId,
        }),
      )
      return count
    })
    return { retried_count: retriedCount }
  }

  private async mutate(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    reason: string,
    operation: (
      store: KnowledgeAdminStore,
      base: NonNullable<Awaited<ReturnType<KnowledgeAdminStore["findKnowledgeBase"]>>>,
      now: Date,
    ) => Promise<void>,
  ): Promise<void> {
    assertAdmin(actor)
    requiredReason(reason)
    const now = (this.options.now ?? (() => new Date()))()
    await this.store.transaction(async (store) => {
      await store.lockKnowledgeBase(knowledgeBaseId)
      const base = await store.findKnowledgeBase(knowledgeBaseId)
      if (base === null || base.lifecycleStatus === "deleted") {
        throw new AppError("KNOWLEDGE_BASE_NOT_FOUND")
      }
      await operation(store, base, now)
    })
  }
}

export class PrismaKnowledgeAdminStore implements KnowledgeAdminStore {
  constructor(
    private readonly root: PrismaClient,
    private readonly database: DatabaseClient = root,
  ) {}

  async transaction<T>(work: (store: KnowledgeAdminStore) => Promise<T>): Promise<T> {
    if (this.database !== this.root) return work(this)
    return this.root.$transaction((transaction) =>
      work(new PrismaKnowledgeAdminStore(this.root, transaction)),
    )
  }

  async lockKnowledgeBase(id: string): Promise<void> {
    await this.database.$queryRawUnsafe(
      'SELECT "id" FROM "knowledge_bases" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    )
  }

  async listUndeletedDocumentIds(knowledgeBaseId: string): Promise<string[]> {
    const documents = await this.database.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId, status: { not: "deleted" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
    return documents.map((document) => document.id)
  }

  async findKnowledgeBase(id: string) {
    const base = await this.database.knowledgeBase.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        lifecycleStatus: true,
        availabilityStatus: true,
      },
    })
    if (base === null) return null
    return {
      id: base.id,
      ownerId: base.ownerId,
      lifecycleStatus: base.lifecycleStatus as KnowledgeBaseLifecycleStatus,
      availabilityStatus: base.availabilityStatus as "enabled" | "disabled",
    }
  }

  async listMetadata(input: {
    search?: string
    lifecycleStatus?: KnowledgeBaseLifecycleStatus
    availabilityStatus?: "enabled" | "disabled"
    cursor?: string
    limit: number
  }): Promise<{
    items: KnowledgeAdminBaseMetadataRecord[]
    nextCursor: string | null
  }> {
    const matchingOwnerIds =
      input.search === undefined || input.search.length === 0
        ? []
        : (
            await this.database.user.findMany({
              where: {
                name: { contains: input.search, mode: "insensitive" },
              },
              select: { id: true },
            })
          ).map((owner) => owner.id)
    const cursor =
      input.cursor === undefined
        ? null
        : await this.database.knowledgeBase.findUnique({
            where: { id: input.cursor },
            select: { id: true, updatedAt: true },
          })
    const bases = await this.database.knowledgeBase.findMany({
      where: {
        ...(input.lifecycleStatus === undefined
          ? {}
          : { lifecycleStatus: input.lifecycleStatus }),
        ...(input.availabilityStatus === undefined
          ? {}
          : { availabilityStatus: input.availabilityStatus }),
        ...(input.search === undefined || input.search.length === 0
          ? {}
          : {
              AND: [
                {
                  OR: [
                    {
                      name: {
                        contains: input.search,
                        mode: "insensitive",
                      },
                    },
                    { ownerId: { in: matchingOwnerIds } },
                  ],
                },
              ],
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
    })
    const visible = bases.slice(0, input.limit)
    const baseIds = visible.map((base) => base.id)
    const ownerIds = [...new Set(visible.map((base) => base.ownerId))]
    const [owners, documentCounts, documents, grants] = await Promise.all([
      this.database.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, status: true },
      }),
      this.database.knowledgeBaseDocument.groupBy({
        by: ["knowledgeBaseId", "status"],
        where: { knowledgeBaseId: { in: baseIds }, status: { not: "deleted" } },
        _count: { _all: true },
      }),
      this.database.knowledgeBaseDocument.findMany({
        where: { knowledgeBaseId: { in: baseIds }, status: { not: "deleted" } },
        select: {
          knowledgeBaseId: true,
          stableErrorCode: true,
          cleanupErrorCode: true,
        },
      }),
      this.database.knowledgeBaseGrant.findMany({
        where: { knowledgeBaseId: { in: baseIds }, status: "active" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          knowledgeBaseId: true,
          granteeType: true,
          userId: true,
          userGroupId: true,
        },
      }),
    ])
    const targetUserIds = grants.flatMap((grant) => grant.userId ? [grant.userId] : [])
    const targetGroupIds = grants.flatMap((grant) =>
      grant.userGroupId ? [grant.userGroupId] : [],
    )
    const [targetUsers, targetGroups] = await Promise.all([
      this.database.user.findMany({
        where: { id: { in: targetUserIds } },
        select: { id: true, name: true },
      }),
      this.database.userGroup.findMany({
        where: { id: { in: targetGroupIds } },
        select: { id: true, name: true },
      }),
    ])
    const ownersById = new Map(owners.map((owner) => [owner.id, owner]))
    const usersById = new Map(targetUsers.map((user) => [user.id, user.name]))
    const groupsById = new Map(targetGroups.map((group) => [group.id, group.name]))
    const countsByBase = new Map<string, Map<string, number>>()
    for (const count of documentCounts) {
      const current = countsByBase.get(count.knowledgeBaseId) ?? new Map()
      current.set(count.status, count._count._all)
      countsByBase.set(count.knowledgeBaseId, current)
    }
    const errorsByBase = new Map<string, Set<string>>()
    for (const document of documents) {
      const current = errorsByBase.get(document.knowledgeBaseId) ?? new Set()
      if (document.stableErrorCode) current.add(document.stableErrorCode)
      if (document.cleanupErrorCode) current.add(document.cleanupErrorCode)
      errorsByBase.set(document.knowledgeBaseId, current)
    }
    const grantsByBase = new Map<string, KnowledgeAdminGrantMetadata[]>()
    for (const grant of grants) {
      const targetId = grant.userId ?? grant.userGroupId
      if (targetId === null) continue
      const targetType = grant.granteeType as "user" | "user_group"
      const targetName =
        targetType === "user"
          ? usersById.get(targetId) ?? "Unknown"
          : groupsById.get(targetId) ?? "Unknown"
      const current = grantsByBase.get(grant.knowledgeBaseId) ?? []
      current.push({ id: grant.id, targetType, targetId, targetName })
      grantsByBase.set(grant.knowledgeBaseId, current)
    }
    return {
      items: visible.map((base) => {
        const owner = ownersById.get(base.ownerId)
        if (owner === undefined) throw new AppError("INTERNAL_ERROR")
        const counts = countsByBase.get(base.id) ?? new Map()
        const stableErrorCodes = errorsByBase.get(base.id) ?? new Set<string>()
        if (base.cleanupErrorCode) stableErrorCodes.add(base.cleanupErrorCode)
        const processing = counts.get("processing") ?? 0
        const ready = counts.get("ready") ?? 0
        const failed = counts.get("failed") ?? 0
        return {
          id: base.id,
          name: base.name,
          owner: {
            id: owner.id,
            name: owner.name,
            status: owner.status as "active" | "disabled",
          },
          lifecycleStatus: base.lifecycleStatus as KnowledgeBaseLifecycleStatus,
          availabilityStatus: base.availabilityStatus as "enabled" | "disabled",
          documentCounts: {
            total: processing + ready + failed,
            processing,
            ready,
            failed,
          },
          storageUsedBytes: base.storageUsedBytes,
          storageReservedBytes: base.storageReservedBytes,
          grants: grantsByBase.get(base.id) ?? [],
          stableErrorCodes: [...stableErrorCodes].sort(),
          cleanupStatus: base.cleanupStatus as KnowledgeAdminBaseMetadataRecord["cleanupStatus"],
          disabledReason: base.disabledReason,
          createdAt: base.createdAt,
          updatedAt: base.updatedAt,
        }
      }),
      nextCursor:
        bases.length > input.limit ? visible.at(-1)?.id ?? null : null,
    }
  }

  async isActiveUser(id: string): Promise<boolean> {
    return (
      (await this.database.user.findFirst({
        where: { id, status: "active" },
        select: { id: true },
      })) !== null
    )
  }

  async findActiveGrant(input: { knowledgeBaseId: string; grantId: string }) {
    const grant = await this.database.knowledgeBaseGrant.findFirst({
      where: {
        id: input.grantId,
        knowledgeBaseId: input.knowledgeBaseId,
        status: "active",
      },
      select: {
        id: true,
        granteeType: true,
        userId: true,
        userGroupId: true,
      },
    })
    if (grant === null) return null
    const targetId = grant.userId ?? grant.userGroupId
    if (targetId === null) return null
    return {
      id: grant.id,
      targetType: grant.granteeType as "user" | "user_group",
      targetId,
    }
  }

  async disableKnowledgeBase(input: {
    id: string
    actorId: string
    reason: string
    now: Date
  }): Promise<void> {
    await this.database.knowledgeBase.update({
      where: { id: input.id },
      data: {
        availabilityStatus: "disabled",
        disabledAt: input.now,
        disabledBy: input.actorId,
        disabledReason: input.reason,
        updatedAt: input.now,
      },
    })
  }

  async enableKnowledgeBase(input: { id: string; now: Date }): Promise<void> {
    await this.database.knowledgeBase.update({
      where: { id: input.id },
      data: {
        availabilityStatus: "enabled",
        disabledAt: null,
        disabledBy: null,
        disabledReason: null,
        updatedAt: input.now,
      },
    })
  }

  async transferOwnership(input: {
    id: string
    ownerId: string
    now: Date
  }): Promise<void> {
    await this.database.knowledgeBase.update({
      where: { id: input.id },
      data: { ownerId: input.ownerId, updatedAt: input.now },
    })
  }

  async archiveKnowledgeBase(input: {
    id: string
    actorId: string
    now: Date
  }): Promise<void> {
    await this.database.knowledgeBase.update({
      where: { id: input.id },
      data: {
        lifecycleStatus: "archived",
        archivedAt: input.now,
        archivedBy: input.actorId,
        updatedAt: input.now,
      },
    })
  }

  async revokeGrant(input: {
    grantId: string
    actorId: string
    reason: string
    now: Date
  }): Promise<void> {
    await this.database.knowledgeBaseGrant.update({
      where: { id: input.grantId },
      data: {
        status: "revoked",
        revokedBy: input.actorId,
        revokedAt: input.now,
        revocationReason: input.reason,
        updatedAt: input.now,
      },
    })
  }

  async deleteKnowledgeBase(input: {
    id: string
    actorId: string
    reason: string
    now: Date
  }): Promise<void> {
    const updated = await this.database.knowledgeBase.update({
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
    })
    await this.database.knowledgeBaseDocument.updateMany({
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
    })
    await this.ensureDeletionTombstones({
      id: updated.id,
      ownerId: updated.ownerId,
      deletedBy: input.actorId,
      deletedAt: input.now,
      deletionReason: input.reason,
      now: input.now,
    })
    await this.database.knowledgeBaseDocumentVersion.updateMany({
      where: { knowledgeBaseId: input.id, versionStatus: { not: "deleted" } },
      data: {
        versionStatus: "deleted",
        retryAt: null,
        updatedAt: input.now,
      },
    })
    await this.database.knowledgeBaseProcessingAttempt.updateMany({
      where: { knowledgeBaseId: input.id, status: "active" },
      data: {
        status: "discarded",
        discardedAt: input.now,
      },
    })
    await this.database.knowledgeBaseObject.updateMany({
      where: { knowledgeBaseId: input.id, lifecycleStatus: { not: "cleaned" } },
      data: {
        lifecycleStatus: "pending_cleanup",
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    })
    await this.database.knowledgeBaseCleanupOutbox.create({
      data: {
        targetType: "knowledge_base",
        knowledgeBaseId: input.id,
        status: "pending",
        requestedBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    })
  }

  async retryCleanup(input: {
    knowledgeBaseId: string
    target: KnowledgeCleanupRetryTarget | undefined
    allowKnowledgeBaseTarget: boolean
    now: Date
  }): Promise<number> {
    const failed = await this.database.knowledgeBaseCleanupOutbox.findMany({
      where: failedCleanupOutboxWhere(input),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        targetType: true,
        documentId: true,
        documentVersionId: true,
        objectId: true,
      },
    })
    if (failed.length === 0) return 0
    const baseCleanup = failed.some((entry) => entry.targetType === "knowledge_base")
    if (baseCleanup) {
      const deletedBase = await this.database.knowledgeBase.findFirst({
        where: {
          id: input.knowledgeBaseId,
          lifecycleStatus: "deleted",
        },
        select: {
          id: true,
          ownerId: true,
          deletedBy: true,
          deletedAt: true,
          deletionReason: true,
        },
      })
      if (
        deletedBase === null ||
        deletedBase.deletedBy === null ||
        deletedBase.deletedAt === null ||
        deletedBase.deletionReason === null
      ) {
        throw new AppError("KNOWLEDGE_CLEANUP_TARGET_NOT_RETRYABLE")
      }
      await this.ensureDeletionTombstones({
        id: deletedBase.id,
        ownerId: deletedBase.ownerId,
        deletedBy: deletedBase.deletedBy,
        deletedAt: deletedBase.deletedAt,
        deletionReason: deletedBase.deletionReason,
        now: input.now,
      })
    }
    const retried = await this.database.knowledgeBaseCleanupOutbox.updateMany({
      where: { id: { in: failed.map((entry) => entry.id) }, status: "failed" },
      data: {
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: input.now,
        lastErrorCode: null,
        updatedAt: input.now,
      },
    })
    if (retried.count === 0) return 0

    const documentIds = uniqueDefined(
      failed
        .filter((entry) => entry.targetType === "document")
        .map((entry) => entry.documentId),
    )
    const documentVersionIds = uniqueDefined(
      failed
        .filter((entry) => entry.targetType === "document_version")
        .map((entry) => entry.documentVersionId),
    )
    const objectIds = uniqueDefined(
      failed
        .filter((entry) => entry.targetType === "object")
        .map((entry) => entry.objectId),
    )

    if (baseCleanup) {
      await this.database.knowledgeBase.updateMany({
        where: {
          id: input.knowledgeBaseId,
          lifecycleStatus: "deleted",
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
      await this.database.knowledgeBaseDocument.updateMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          status: "deleted",
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
      await this.database.knowledgeBaseObject.updateMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
    }
    if (documentIds.length > 0) {
      await this.database.knowledgeBaseDocument.updateMany({
        where: {
          id: { in: documentIds },
          knowledgeBaseId: input.knowledgeBaseId,
          status: "deleted",
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
      await this.database.knowledgeBaseObject.updateMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          documentId: { in: documentIds },
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
    }
    if (documentVersionIds.length > 0) {
      await this.database.knowledgeBaseObject.updateMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          documentVersionId: { in: documentVersionIds },
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
    }
    if (objectIds.length > 0) {
      await this.database.knowledgeBaseObject.updateMany({
        where: {
          id: { in: objectIds },
          knowledgeBaseId: input.knowledgeBaseId,
          cleanupStatus: "failed",
        },
        data: {
          cleanupStatus: "pending",
          cleanupErrorCode: null,
          updatedAt: input.now,
        },
      })
    }
    return retried.count
  }

  private async ensureDeletionTombstones(input: {
    id: string
    ownerId: string
    deletedBy: string
    deletedAt: Date
    deletionReason: string
    now: Date
  }): Promise<void> {
    await this.database.knowledgeBaseTombstone.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        ownerId: input.ownerId,
        deletedBy: input.deletedBy,
        deletedAt: input.deletedAt,
        deletionReason: input.deletionReason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        createdAt: input.deletedAt,
        updatedAt: input.now,
      },
      update: {
        ownerId: input.ownerId,
        deletedBy: input.deletedBy,
        deletedAt: input.deletedAt,
        deletionReason: input.deletionReason,
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: input.now,
      },
    })
    await this.database.$executeRaw`
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
        COALESCE("deleted_by", ${input.deletedBy}::uuid),
        COALESCE("deleted_at", ${input.deletedAt}),
        COALESCE("deletion_reason", ${input.deletionReason}),
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
    `
  }

  async writeAudit(input: KnowledgeAuditInput): Promise<void> {
    await this.database.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        result: input.result,
        metadataJson: sanitizeAuditMetadata(input.action, input.metadata ?? {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  }
}

function assertAdmin(actor: KnowledgeActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED")
  if (actor.role !== "admin") throw new AppError("FORBIDDEN")
}

function requiredReason(value: string): string {
  const result = value.trim()
  if (result.length === 0 || result.length > 1_000) {
    throw new AppError("VALIDATION_ERROR")
  }
  return result
}

function adminAudit(
  actor: KnowledgeActor,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
  targetType = "knowledge_base",
): KnowledgeAuditInput {
  return {
    actorId: actor.id,
    action,
    targetType,
    targetId,
    result: "success",
    metadata,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  }
}

function adminBaseView(value: KnowledgeAdminBaseMetadataRecord): KnowledgeAdminBaseView {
  return {
    id: value.id,
    name: value.name,
    owner: value.owner,
    lifecycle_status: value.lifecycleStatus,
    availability_status: value.availabilityStatus,
    document_counts: value.documentCounts,
    storage_used_bytes: safeBigIntNumber(value.storageUsedBytes),
    storage_reserved_bytes: safeBigIntNumber(value.storageReservedBytes),
    share_count: value.grants.length,
    active_grants: value.grants.map((grant) => ({
      id: grant.id,
      target_type: grant.targetType,
      target_id: grant.targetId,
      target_name: grant.targetName,
    })),
    stable_error_codes: value.stableErrorCodes,
    cleanup_status: value.cleanupStatus,
    disabled_reason: value.disabledReason,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  }
}

function safeBigIntNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new AppError("INTERNAL_ERROR")
  return result
}

function failedCleanupOutboxWhere(input: {
  knowledgeBaseId: string
  target: KnowledgeCleanupRetryTarget | undefined
  allowKnowledgeBaseTarget: boolean
}): Prisma.KnowledgeBaseCleanupOutboxWhereInput {
  const targetWhere: Prisma.KnowledgeBaseCleanupOutboxWhereInput =
    input.target === undefined
      ? {
          targetType: {
            in: input.allowKnowledgeBaseTarget
              ? ["knowledge_base", "document", "document_version", "object"]
              : ["document", "document_version", "object"],
          },
        }
      : input.target.type === "outbox"
      ? {
          id: input.target.id,
          targetType: {
            in: input.allowKnowledgeBaseTarget
              ? ["knowledge_base", "document", "document_version", "object"]
              : ["document", "document_version", "object"],
          },
        }
      : input.target.type === "document"
        ? { targetType: "document", documentId: input.target.id }
        : input.target.type === "document_version"
          ? {
              targetType: "document_version",
              documentVersionId: input.target.id,
            }
          : { targetType: "object", objectId: input.target.id }
  return {
    knowledgeBaseId: input.knowledgeBaseId,
    status: "failed",
    ...targetWhere,
  }
}

function uniqueDefined(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))]
}
