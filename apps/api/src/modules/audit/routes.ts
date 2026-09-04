import type { FastifyPluginAsync } from "fastify"
import {
  auditTranslationKey,
  productFilenamePrefix,
  type AuditTranslationKind,
  type Locale,
} from "@linksense/shared"
import { z } from "zod"
import type { Prisma } from "../../generated/prisma/client.js"

import { attachmentContentDisposition } from "../../lib/content-disposition.js"
import { ok } from "../../lib/http.js"
import { translateBackend } from "../../lib/i18n.js"
import { resolveLocale } from "../../lib/locale.js"
import type { AuthenticatedRequest } from "../../plugins/authentication.js"
import type { AppServices } from "../../services.js"
import { sanitizeAuditMetadata } from "./service.js"

const cursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => parseCursor(value) !== null, "invalid_cursor")

const querySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().min(1).max(160).optional(),
  actor_id: z.string().uuid().optional(),
  result: z.enum(["success", "rejected", "failure", "failed"]).optional(),
  search: z.string().trim().min(1).max(240).optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
})

const conversationMetadataQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  owner_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(240).optional(),
  status: z
    .enum(["idle", "running", "pending", "completed", "failed", "interrupted"])
    .optional(),
  plugin_name: z.string().trim().min(1).max(240).optional(),
  skill_name: z.string().trim().min(1).max(240).optional(),
  error_type: z.literal("codex_turn").optional(),
  error_code: z.string().trim().min(1).max(120).optional(),
  runner_status: z.enum(["available", "unavailable"]).optional(),
  archive_status: z.enum(["active", "archived"]).optional(),
  created_from: z.coerce.date().optional(),
  created_to: z.coerce.date().optional(),
  last_run_from: z.coerce.date().optional(),
  last_run_to: z.coerce.date().optional(),
})

const retainedArtifactQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  conversation_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(240).optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
})

const exportViewSchema = z
  .object({
    view: z
      .enum(["audit_logs", "conversations", "retained_artifacts"])
      .default("audit_logs"),
  })
  .passthrough()

type AuditQuery = z.infer<typeof querySchema>
type ConversationMetadataQuery = z.infer<typeof conversationMetadataQuerySchema>
type RetainedArtifactQuery = z.infer<typeof retainedArtifactQuerySchema>

const EXPORT_PAGE_SIZE = 200
const FILTER_PAGE_SIZE = 250

export const auditRoutes: FastifyPluginAsync<{
  services: AppServices
}> = async (app, { services }) => {
  app.addHook("preHandler", app.requireAdmin)

  app.get("/", async (request, reply) => {
    const result = await listAuditLogs(
      services,
      querySchema.parse(request.query),
    )
    return reply.send(ok(result, request.id))
  })

  app.get("/conversations", async (request, reply) => {
    const result = await listConversationMetadata(
      services,
      conversationMetadataQuerySchema.parse(request.query),
    )
    return reply.send(ok(result, request.id))
  })

  app.get("/retained-artifacts", async (request, reply) => {
    const result = await listRetainedArtifactSummaries(
      services,
      retainedArtifactQuerySchema.parse(request.query),
    )
    return reply.send(ok(result, request.id))
  })

  app.get("/export.csv", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser
    const view = exportViewSchema.parse(request.query).view
    const locale = resolveLocale(request, actor.preferredLocale)
    const isEnglish = locale === "en-US"
    const productName = (
      await services.system.getProductSettings()
    ).organization_display_name
    let writeExport: (
      signal: AbortSignal,
      onRowCount: (rowCount: number) => void,
    ) => Promise<number>

    if (view === "conversations") {
      const query = conversationMetadataQuerySchema
        .omit({ cursor: true, limit: true })
        .extend({ view: z.literal("conversations") })
        .parse(request.query)
      const { view: _view, ...filters } = query
      void _view
      writeExport = (signal, onRowCount) =>
        streamCsvPages({
          writable: reply.raw,
          signal,
          header: conversationExportRows([], isEnglish)[0]!,
          loadPage: (cursor) =>
            listConversationMetadata(services, {
              ...filters,
              ...(cursor ? { cursor } : {}),
              limit: EXPORT_PAGE_SIZE,
            }),
          rowsForPage: (items) =>
            conversationExportRows(items, isEnglish).slice(1),
          onRowCount,
        })
    } else if (view === "retained_artifacts") {
      const query = retainedArtifactQuerySchema
        .omit({ cursor: true, limit: true })
        .extend({ view: z.literal("retained_artifacts") })
        .parse(request.query)
      const { view: _view, ...filters } = query
      void _view
      writeExport = (signal, onRowCount) =>
        streamCsvPages({
          writable: reply.raw,
          signal,
          header: retainedArtifactExportRows([], isEnglish)[0]!,
          loadPage: (cursor) =>
            listRetainedArtifactSummaries(services, {
              ...filters,
              ...(cursor ? { cursor } : {}),
              limit: EXPORT_PAGE_SIZE,
            }),
          rowsForPage: (items) =>
            retainedArtifactExportRows(items, isEnglish).slice(1),
          onRowCount,
        })
    } else {
      const query = querySchema
        .omit({ cursor: true, limit: true })
        .extend({ view: z.literal("audit_logs").optional() })
        .parse(request.query)
      const { view: _view, ...filters } = query
      void _view
      writeExport = (signal, onRowCount) =>
        streamCsvPages({
          writable: reply.raw,
          signal,
          header: auditLogExportRows([], locale)[0]!,
          loadPage: (cursor) =>
            listAuditLogs(services, {
              ...filters,
              ...(cursor ? { cursor } : {}),
              limit: EXPORT_PAGE_SIZE,
            }),
          rowsForPage: (items) => auditLogExportRows(items, locale).slice(1),
          onRowCount,
        })
    }

    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader("content-type", "text/csv; charset=utf-8")
    reply.raw.setHeader("cache-control", "no-store")
    reply.raw.setHeader("x-content-type-options", "nosniff")
    reply.raw.setHeader("referrer-policy", "no-referrer")
    reply.raw.setHeader(
      "content-disposition",
      attachmentContentDisposition(
        `${productFilenamePrefix(productName)}-${
          view === "conversations" ? "tasks" : view
        }.csv`,
      ),
    )
    const abortController = new AbortController()
    const abortFromRequest = () => abortController.abort()
    const abortFromResponse = () => {
      if (!reply.raw.writableEnded) abortController.abort()
    }
    request.raw.once("aborted", abortFromRequest)
    reply.raw.once("close", abortFromResponse)
    let rowCount = 0
    try {
      rowCount = await writeExport(abortController.signal, (count) => {
        rowCount = count
      })
      if (abortController.signal.aborted || reply.raw.destroyed) {
        throw new CsvExportAbortedError()
      }
      await services.audit.write({
        actorId: actor.id,
        action: "audit_exported",
        result: "success",
        metadata: { row_count: rowCount, format: "csv", view },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      })
      if (!reply.raw.destroyed) reply.raw.end()
    } catch (error) {
      await services.audit
        .write({
          actorId: actor.id,
          action: "audit_exported",
          result: "failed",
          metadata: { row_count: rowCount, format: "csv", view },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        })
        .catch(() => undefined)
      if (!(error instanceof CsvExportAbortedError)) {
        request.log.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "audit CSV export failed",
        )
      }
      if (!reply.raw.destroyed) reply.raw.destroy()
    } finally {
      request.raw.off("aborted", abortFromRequest)
      reply.raw.off("close", abortFromResponse)
    }
    return reply
  })
}

async function listAuditLogs(services: AppServices, query: AuditQuery) {
  const cursor = query.cursor ? parseCursor(query.cursor) : null
  const filters: Prisma.AuditLogWhereInput[] = [auditWhere(query)]
  if (cursor) filters.push(cursorWhere("createdAt", "id", cursor))
  const rows = await services.prisma.auditLog.findMany({
    where: { AND: filters },
    select: {
      id: true,
      actorId: true,
      action: true,
      targetType: true,
      targetId: true,
      result: true,
      metadataJson: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  })
  const selected = rows.slice(0, query.limit)
  const actorIds = [...new Set(selected.flatMap((row) => row.actorId ?? []))]
  const actors = await services.prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  })
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]))
  return {
    items: selected.map((row) =>
      projectAuditLog(
        row,
        row.actorId ? actorNames.get(row.actorId) : undefined,
      ),
    ),
    next_cursor:
      rows.length > query.limit && selected.length > 0
        ? encodeCursor(selected.at(-1)!.createdAt, selected.at(-1)!.id)
        : null,
  }
}

async function listConversationMetadata(
  services: AppServices,
  query: ConversationMetadataQuery,
) {
  const runnerStatus = await services.runner
    .health()
    .then((health) => health.status)
    .catch(() => "unavailable" as const)
  const idFilters: string[][] = []
  if (query.status) {
    idFilters.push(
      await conversationIdsForExecutionStatus(services, query.status),
    )
  }
  if (query.search) {
    const safeSearchIds = await conversationIdsForSafeSearch(
      services,
      query.search,
      runnerStatus,
    )
    if (safeSearchIds) idFilters.push(safeSearchIds)
  }
  if (query.plugin_name) {
    idFilters.push(
      await conversationIdsForCapability(services, "plugin", query.plugin_name),
    )
  }
  if (query.skill_name) {
    idFilters.push(
      await conversationIdsForCapability(services, "skill", query.skill_name),
    )
  }
  if (query.error_code) {
    idFilters.push(
      await conversationIdsForTurnFilter(services, {
        errorCode: { contains: query.error_code, mode: "insensitive" },
      }),
    )
  }
  if (query.error_type === "codex_turn") {
    idFilters.push(
      await conversationIdsForTurnFilter(services, {
        status: "failed",
        errorCode: { not: null },
      }),
    )
  }
  if (query.runner_status && query.runner_status !== runnerStatus) {
    idFilters.push([])
  }

  const cursor = query.cursor ? parseCursor(query.cursor) : null
  const filters: Prisma.ConversationWhereInput[] = []
  if (query.owner_id) filters.push({ ownerId: query.owner_id })
  if (query.archive_status)
    filters.push({ archiveStatus: query.archive_status })
  const createdAt = dateTimeRange(query.created_from, query.created_to)
  if (createdAt) filters.push({ createdAt })
  const lastRunAt = dateTimeRange(query.last_run_from, query.last_run_to)
  if (lastRunAt) filters.push({ lastRunAt })
  if (idFilters.length > 0) {
    filters.push({ id: { in: intersectIds(idFilters) } })
  }
  if (cursor) filters.push(cursorWhere("createdAt", "id", cursor))

  const rows = await services.prisma.conversation.findMany({
    where: filters.length > 0 ? { AND: filters } : {},
    select: {
      id: true,
      ownerId: true,
      archiveStatus: true,
      lastTurnStatus: true,
      lastRunAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  })
  const selected = rows.slice(0, query.limit)
  const ids = selected.map((row) => row.id)
  const ownerIds = [...new Set(selected.map((row) => row.ownerId))]
  const [ownerRows, turns, pending, files, capabilityEvents] =
    await Promise.all([
      services.prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true },
      }),
      services.prisma.conversationTurn.findMany({
        where: { conversationId: { in: ids } },
        select: {
          conversationId: true,
          sequenceNo: true,
          status: true,
          startedAt: true,
          completedAt: true,
          interruptedAt: true,
          errorCode: true,
        },
        orderBy: { sequenceNo: "asc" },
      }),
      services.prisma.pendingRequest.findMany({
        where: { conversationId: { in: ids } },
        select: { conversationId: true },
      }),
      services.prisma.conversationFile.findMany({
        where: { conversationId: { in: ids } },
        select: { conversationId: true, kind: true, sizeBytes: true },
      }),
      services.prisma.conversationEvent.findMany({
        where: {
          conversationId: { in: ids },
          eventType: {
            in: [
              "conversation.capability.attached",
              "conversation.capability.used",
            ],
          },
        },
        select: { conversationId: true, payloadJson: true },
      }),
    ])
  const ownerById = new Map(ownerRows.map((owner) => [owner.id, owner]))
  const now = new Date()
  const items = selected.map((conversation) => {
    const conversationTurns = turns.filter(
      (turn) => turn.conversationId === conversation.id,
    )
    const conversationFiles = files.filter(
      (file) => file.conversationId === conversation.id,
    )
    const capabilityPayloads = capabilityEvents
      .filter((event) => event.conversationId === conversation.id)
      .map((event) => asRecord(event.payloadJson))
    const names = (type: string) => [
      ...new Set(
        capabilityPayloads.flatMap((payload) =>
          payload.capability_type === type && typeof payload.name === "string"
            ? [payload.name]
            : [],
        ),
      ),
    ]
    const latestTurn = conversationTurns.at(-1)
    const running = conversationTurns.some((turn) => turn.status === "running")
    const hasPending = pending.some(
      (requestRow) => requestRow.conversationId === conversation.id,
    )
    const attachments = conversationFiles.filter(
      (file) => file.kind === "attachment",
    )
    const artifacts = conversationFiles.filter(
      (file) => file.kind === "artifact",
    )
    const owner = ownerById.get(conversation.ownerId)
    return {
      conversation_id: conversation.id,
      owner_id: conversation.ownerId,
      owner_name: owner?.name ?? null,
      owner_email: owner?.email ?? null,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
      last_run_at: conversation.lastRunAt?.toISOString() ?? null,
      execution_status: running
        ? "running"
        : hasPending
          ? "pending"
          : (conversation.lastTurnStatus ?? "idle"),
      plugin_names: names("plugin"),
      skill_names: names("skill"),
      attachment_count: attachments.length,
      attachment_size_bytes: sumFileSize(attachments),
      artifact_count: artifacts.length,
      artifact_size_bytes: sumFileSize(artifacts),
      execution_duration_ms: conversationTurns.reduce(
        (total, turn) =>
          total +
          Math.max(
            0,
            (turn.completedAt ?? turn.interruptedAt ?? now).getTime() -
              turn.startedAt.getTime(),
          ),
        0,
      ),
      error_type: latestTurn?.status === "failed" ? "codex_turn" : null,
      error_code: latestTurn?.errorCode ?? null,
      runner_status: runnerStatus,
      archive_status: conversation.archiveStatus,
    }
  })
  return {
    items,
    next_cursor:
      rows.length > query.limit && selected.length > 0
        ? encodeCursor(selected.at(-1)!.createdAt, selected.at(-1)!.id)
        : null,
  }
}

async function listRetainedArtifactSummaries(
  services: AppServices,
  query: RetainedArtifactQuery,
) {
  const filters: Prisma.RetainedArtifactWhereInput[] = []
  if (query.owner_id) filters.push({ ownerId: query.owner_id })
  if (query.conversation_id)
    filters.push({ conversationId: query.conversation_id })
  const deletedAt = dateTimeRange(query.date_from, query.date_to)
  if (deletedAt) filters.push({ conversationDeletedAt: deletedAt })
  if (query.search) {
    const ownerIds = await ownerIdsForSafeSearch(services, query.search)
    const searchFilters: Prisma.RetainedArtifactWhereInput[] = []
    if (z.string().uuid().safeParse(query.search).success) {
      searchFilters.push({ conversationId: query.search })
    }
    if (ownerIds.length > 0) {
      searchFilters.push({ ownerId: { in: ownerIds } })
    }
    const searchedDate = dayRange(query.search)
    if (searchedDate) {
      searchFilters.push({ conversationDeletedAt: searchedDate })
    }
    filters.push(
      searchFilters.length > 0
        ? { OR: searchFilters }
        : { conversationId: { in: [] } },
    )
  }
  const cursor = query.cursor ? parseCursor(query.cursor) : null
  if (cursor) {
    filters.push(cursorWhere("conversationDeletedAt", "conversationId", cursor))
  }
  const groupRows = await services.prisma.retainedArtifact.findMany({
    where: filters.length > 0 ? { AND: filters } : {},
    select: {
      conversationId: true,
      ownerId: true,
      conversationDeletedAt: true,
    },
    distinct: ["conversationId"],
    orderBy: [{ conversationDeletedAt: "desc" }, { conversationId: "desc" }],
    take: query.limit + 1,
  })
  const selectedGroups = groupRows.slice(0, query.limit)
  const conversationIds = selectedGroups.map((row) => row.conversationId)
  const rows = await services.prisma.retainedArtifact.findMany({
    where: { conversationId: { in: conversationIds } },
    select: {
      conversationId: true,
      ownerId: true,
      sizeBytes: true,
      checksumSha256: true,
      artifactCreatedAt: true,
      conversationDeletedAt: true,
    },
    orderBy: { artifactCreatedAt: "asc" },
  })
  const ownerIds = [...new Set(selectedGroups.map((row) => row.ownerId))]
  const owners = await services.prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, email: true },
  })
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]))
  const items = selectedGroups.map((group) => {
    const artifacts = rows.filter(
      (row) => row.conversationId === group.conversationId,
    )
    const owner = ownerById.get(group.ownerId)
    return {
      conversation_id: group.conversationId,
      owner_id: group.ownerId,
      owner_name: owner?.name ?? null,
      owner_email: owner?.email ?? null,
      artifact_count: artifacts.length,
      total_size_bytes: sumFileSize(artifacts),
      checksum_present: artifacts.every(
        (artifact) => artifact.checksumSha256 !== null,
      ),
      first_artifact_created_at:
        artifacts[0]?.artifactCreatedAt.toISOString() ?? null,
      last_artifact_created_at:
        artifacts.at(-1)?.artifactCreatedAt.toISOString() ?? null,
      conversation_deleted_at: group.conversationDeletedAt.toISOString(),
    }
  })
  return {
    items,
    next_cursor:
      groupRows.length > query.limit && selectedGroups.length > 0
        ? encodeCursor(
            selectedGroups.at(-1)!.conversationDeletedAt,
            selectedGroups.at(-1)!.conversationId,
          )
        : null,
  }
}

function projectAuditLog(
  row: {
    id: string
    actorId: string | null
    action: string
    targetType: string | null
    targetId: string | null
    result: string
    metadataJson: unknown
    ipAddress: string | null
    userAgent: string | null
    createdAt: Date
  },
  actorName?: string,
) {
  const metadata = sanitizeAuditMetadata(row.action, asRecord(row.metadataJson))
  return {
    id: row.id,
    actor_id: row.actorId,
    actor_name: actorName,
    action: row.action,
    target_type: row.targetType,
    target_id: row.targetId,
    result: row.result,
    metadata,
    error_code:
      typeof metadata.error_code === "string"
        ? metadata.error_code
        : typeof metadata.reason_code === "string" && row.result !== "success"
          ? metadata.reason_code
          : null,
    ip_address: row.ipAddress,
    user_agent: row.userAgent,
    created_at: row.createdAt.toISOString(),
  }
}

function auditWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
  const createdAt = dateTimeRange(query.date_from, query.date_to)
  return {
    ...(createdAt ? { createdAt } : {}),
    ...(query.action
      ? { action: { contains: query.action, mode: "insensitive" } }
      : {}),
    ...(query.actor_id ? { actorId: query.actor_id } : {}),
    ...(query.result
      ? { result: query.result === "failed" ? "failure" : query.result }
      : {}),
    ...(query.search
      ? {
          OR: [
            { action: { contains: query.search, mode: "insensitive" } },
            { targetType: { contains: query.search, mode: "insensitive" } },
            { targetId: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  }
}

async function ownerIdsForSafeSearch(
  services: AppServices,
  search: string,
): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  for (;;) {
    const rows = await services.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: FILTER_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    ids.push(...rows.map((row) => row.id))
    if (rows.length < FILTER_PAGE_SIZE) return ids
    cursor = rows.at(-1)!.id
  }
}

async function conversationIdsForTurnFilter(
  services: AppServices,
  where: Prisma.ConversationTurnWhereInput,
): Promise<string[]> {
  const ids = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const rows = await services.prisma.conversationTurn.findMany({
      where,
      select: { id: true, conversationId: true },
      orderBy: { id: "asc" },
      take: FILTER_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    rows.forEach((row) => ids.add(row.conversationId))
    if (rows.length < FILTER_PAGE_SIZE) return [...ids]
    cursor = rows.at(-1)!.id
  }
}

async function collectConversationIds(
  services: AppServices,
  where: Prisma.ConversationWhereInput,
): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  for (;;) {
    const rows = await services.prisma.conversation.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      take: FILTER_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    ids.push(...rows.map((row) => row.id))
    if (rows.length < FILTER_PAGE_SIZE) return ids
    cursor = rows.at(-1)!.id
  }
}

async function conversationIdsForCapabilitySearch(
  services: AppServices,
  search: string,
): Promise<string[]> {
  return collectConversationEventIds(services, {
    AND: [
      capabilityEventWhere(),
      {
        OR: ["name", "capability_type", "status"].map((path) => ({
          payloadJson: {
            path: [path],
            string_contains: search,
            mode: "insensitive" as const,
          },
        })),
      },
    ],
  })
}

async function collectConversationEventIds(
  services: AppServices,
  where: Prisma.ConversationEventWhereInput,
): Promise<string[]> {
  const ids = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const rows = await services.prisma.conversationEvent.findMany({
      where,
      select: { id: true, conversationId: true },
      orderBy: { id: "asc" },
      take: FILTER_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    rows.forEach((row) => ids.add(row.conversationId))
    if (rows.length < FILTER_PAGE_SIZE) return [...ids]
    cursor = rows.at(-1)!.id
  }
}

function capabilityEventWhere(): Prisma.ConversationEventWhereInput {
  return {
    eventType: {
      in: ["conversation.capability.attached", "conversation.capability.used"],
    },
  }
}

async function conversationIdsForSafeSearch(
  services: AppServices,
  search: string,
  runnerStatus: "available" | "unavailable",
): Promise<string[] | null> {
  const normalized = search.toLocaleLowerCase("en-US")
  if (normalized === runnerStatus) {
    return null
  }
  const [ownerIds, errorIds, capabilityIds] = await Promise.all([
    ownerIdsForSafeSearch(services, search),
    conversationIdsForTurnFilter(services, {
      errorCode: { contains: search, mode: "insensitive" },
    }),
    conversationIdsForCapabilitySearch(services, search),
  ])
  const ids = new Set([...errorIds, ...capabilityIds])
  if (ownerIds.length > 0) {
    const ownerConversationIds = await collectConversationIds(services, {
      ownerId: { in: ownerIds },
    })
    ownerConversationIds.forEach((id) => ids.add(id))
  }

  const safeConversationFilters: Prisma.ConversationWhereInput[] = []
  if (z.string().uuid().safeParse(search).success) {
    safeConversationFilters.push({ id: search })
  }
  const date = dayRange(search)
  if (date) {
    safeConversationFilters.push({
      OR: [{ createdAt: date }, { lastRunAt: date }],
    })
  }
  if (safeConversationFilters.length > 0) {
    const conversationIds = await collectConversationIds(services, {
      OR: safeConversationFilters,
    })
    conversationIds.forEach((id) => ids.add(id))
  }
  if (
    normalized === "idle" ||
    normalized === "running" ||
    normalized === "pending" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "interrupted"
  ) {
    const statusIds = await conversationIdsForExecutionStatus(
      services,
      normalized,
    )
    statusIds.forEach((id) => ids.add(id))
  }
  return [...ids]
}

async function conversationIdsForCapability(
  services: AppServices,
  type: "plugin" | "skill",
  name: string,
): Promise<string[]> {
  return collectConversationEventIds(services, {
    AND: [
      capabilityEventWhere(),
      { payloadJson: { path: ["capability_type"], equals: type } },
      {
        payloadJson: {
          path: ["name"],
          string_contains: name,
          mode: "insensitive",
        },
      },
    ],
  })
}

async function conversationIdsForExecutionStatus(
  services: AppServices,
  status:
    "idle" | "running" | "pending" | "completed" | "failed" | "interrupted",
): Promise<string[]> {
  const [runningRows, pendingRows] = await Promise.all([
    services.prisma.conversationTurn.findMany({
      where: { status: "running" },
      select: { conversationId: true },
      distinct: ["conversationId"],
    }),
    services.prisma.pendingRequest.findMany({
      select: { conversationId: true },
      distinct: ["conversationId"],
    }),
  ])
  const running = new Set(runningRows.map((row) => row.conversationId))
  const pending = new Set(pendingRows.map((row) => row.conversationId))
  if (status === "running") return [...running]
  if (status === "pending") {
    return [...pending].filter((conversationId) => !running.has(conversationId))
  }
  const rows = await services.prisma.conversation.findMany({
    where:
      status === "idle" ? { lastTurnStatus: null } : { lastTurnStatus: status },
    select: { id: true },
  })
  return rows
    .map((row) => row.id)
    .filter(
      (conversationId) =>
        !running.has(conversationId) && !pending.has(conversationId),
    )
}

type CsvWritable = {
  destroyed?: boolean
  write(chunk: string): boolean
  once(event: "drain" | "close", listener: () => void): unknown
  once(event: "error", listener: (error: Error) => void): unknown
  off(event: "drain" | "close", listener: () => void): unknown
  off(event: "error", listener: (error: Error) => void): unknown
}

class CsvExportAbortedError extends Error {
  constructor() {
    super("audit CSV export was interrupted")
    this.name = "CsvExportAbortedError"
  }
}

async function streamCsvPages<T>(input: {
  writable: CsvWritable
  signal: AbortSignal
  header: string[]
  loadPage: (
    cursor?: string,
  ) => Promise<{ items: T[]; next_cursor: string | null }>
  rowsForPage: (items: T[]) => string[][]
  onRowCount?: (rowCount: number) => void
}): Promise<number> {
  await writeCsvChunk(
    input.writable,
    `\uFEFF${serializeCsvRow(input.header)}\r\n`,
    input.signal,
  )
  let cursor: string | undefined
  let rowCount = 0
  for (;;) {
    if (input.signal.aborted || input.writable.destroyed) {
      throw new CsvExportAbortedError()
    }
    const page = await input.loadPage(cursor)
    const rows = input.rowsForPage(page.items)
    if (rows.length !== page.items.length) {
      throw new Error("audit export row projection count mismatch")
    }
    for (const row of rows) {
      await writeCsvChunk(
        input.writable,
        `${serializeCsvRow(row)}\r\n`,
        input.signal,
      )
      rowCount += 1
      input.onRowCount?.(rowCount)
    }
    if (!page.next_cursor) return rowCount
    if (page.next_cursor === cursor) {
      throw new Error("audit export cursor did not advance")
    }
    cursor = page.next_cursor
  }
}

function serializeCsvRow(row: string[]): string {
  return row.map((value) => csvCell(String(value))).join(",")
}

async function writeCsvChunk(
  writable: CsvWritable,
  chunk: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || writable.destroyed) {
    throw new CsvExportAbortedError()
  }
  if (writable.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const onDrain = () => finish(resolve)
    const onClose = () => finish(() => reject(new CsvExportAbortedError()))
    const onError = (error: Error) => finish(() => reject(error))
    const onAbort = () => finish(() => reject(new CsvExportAbortedError()))
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      writable.off("drain", onDrain)
      writable.off("close", onClose)
      writable.off("error", onError)
      signal.removeEventListener("abort", onAbort)
      complete()
    }
    writable.once("drain", onDrain)
    writable.once("close", onClose)
    writable.once("error", onError)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted || writable.destroyed) onAbort()
  })
}

function auditLogExportRows(
  items: Awaited<ReturnType<typeof listAuditLogs>>["items"],
  locale: Locale,
): string[][] {
  const isEnglish = locale === "en-US"
  const header = isEnglish
    ? [
        "Created At",
        "Actor ID",
        "Action",
        "Action Code",
        "Target Type",
        "Target Type Code",
        "Target ID",
        "Result",
        "Result Code",
        "Metadata",
        "Source IP",
        "User-Agent",
      ]
    : [
        "创建时间",
        "操作人 ID",
        "操作",
        "动作代码",
        "目标类型",
        "目标类型代码",
        "目标 ID",
        "结果",
        "结果代码",
        "元数据",
        "来源 IP",
        "User-Agent",
      ]
  return [
    header,
    ...items.map((item) => [
      item.created_at,
      item.actor_id ?? "",
      translateAuditExportValue("actions", item.action, locale),
      item.action,
      item.target_type
        ? translateAuditExportValue("targetTypes", item.target_type, locale)
        : "",
      item.target_type ?? "",
      item.target_id ?? "",
      translateAuditExportValue("results", item.result, locale),
      item.result,
      JSON.stringify(item.metadata),
      item.ip_address ?? "",
      item.user_agent ?? "",
    ]),
  ]
}

function translateAuditExportValue(
  kind: AuditTranslationKind,
  code: string,
  locale: Locale,
): string {
  const key = auditTranslationKey(kind, code)
  const translated = translateBackend(key, locale)
  return translated === key ? code : translated
}

function conversationExportRows(
  items: Awaited<ReturnType<typeof listConversationMetadata>>["items"],
  isEnglish: boolean,
): string[][] {
  const header = isEnglish
    ? [
        "Task ID",
        "Owner ID",
        "Owner Name",
        "Owner Email",
        "Created At",
        "Updated At",
        "Last Run At",
        "Execution Status",
        "Plugin Names",
        "Skill Names",
        "Attachment Count",
        "Attachment Size Bytes",
        "Artifact Count",
        "Artifact Size Bytes",
        "Execution Duration Ms",
        "Error Type",
        "Error Code",
        "Runner Status",
        "Archive Status",
      ]
    : [
        "任务 ID",
        "所有者 ID",
        "所有者姓名",
        "所有者邮箱",
        "创建时间",
        "更新时间",
        "最近执行时间",
        "执行状态",
        "插件名称",
        "Skill 名称",
        "附件数量",
        "附件总字节数",
        "产物数量",
        "产物总字节数",
        "执行耗时毫秒",
        "错误类型",
        "错误码",
        "Runner 状态",
        "归档状态",
      ]
  return [
    header,
    ...items.map((item) => [
      item.conversation_id,
      item.owner_id,
      item.owner_name ?? "",
      item.owner_email ?? "",
      item.created_at,
      item.updated_at,
      item.last_run_at ?? "",
      item.execution_status,
      item.plugin_names.join(";"),
      item.skill_names.join(";"),
      String(item.attachment_count),
      String(item.attachment_size_bytes),
      String(item.artifact_count),
      String(item.artifact_size_bytes),
      String(item.execution_duration_ms),
      item.error_type ?? "",
      item.error_code ?? "",
      item.runner_status,
      item.archive_status,
    ]),
  ]
}

function retainedArtifactExportRows(
  items: Awaited<ReturnType<typeof listRetainedArtifactSummaries>>["items"],
  isEnglish: boolean,
): string[][] {
  const header = isEnglish
    ? [
        "Task ID",
        "Owner ID",
        "Owner Name",
        "Owner Email",
        "Artifact Count",
        "Total Size Bytes",
        "Checksum Present",
        "First Artifact Created At",
        "Last Artifact Created At",
        "Task Deleted At",
      ]
    : [
        "任务 ID",
        "所有者 ID",
        "所有者姓名",
        "所有者邮箱",
        "产物数量",
        "总字节数",
        "校验值完整",
        "最早产物创建时间",
        "最近产物创建时间",
        "任务删除时间",
      ]
  return [
    header,
    ...items.map((item) => [
      item.conversation_id,
      item.owner_id,
      item.owner_name ?? "",
      item.owner_email ?? "",
      String(item.artifact_count),
      String(item.total_size_bytes),
      String(item.checksum_present),
      item.first_artifact_created_at ?? "",
      item.last_artifact_created_at ?? "",
      item.conversation_deleted_at,
    ]),
  ]
}

function parseCursor(
  value: string,
): { timestamp: Date; tieBreaker?: string } | null {
  const separator = value.indexOf("|")
  const timestampValue = separator >= 0 ? value.slice(0, separator) : value
  const tieBreaker = separator >= 0 ? value.slice(separator + 1) : undefined
  const timestamp = new Date(timestampValue)
  if (Number.isNaN(timestamp.getTime()) || (separator >= 0 && !tieBreaker))
    return null
  return { timestamp, ...(tieBreaker ? { tieBreaker } : {}) }
}

function encodeCursor(timestamp: Date, tieBreaker: string): string {
  return `${timestamp.toISOString()}|${tieBreaker}`
}

function cursorWhere(
  timestampField: string,
  tieBreakerField: string,
  cursor: { timestamp: Date; tieBreaker?: string },
): Record<string, unknown> {
  if (!cursor.tieBreaker) return { [timestampField]: { lt: cursor.timestamp } }
  return {
    OR: [
      { [timestampField]: { lt: cursor.timestamp } },
      {
        [timestampField]: cursor.timestamp,
        [tieBreakerField]: { lt: cursor.tieBreaker },
      },
    ],
  }
}

function dateTimeRange(from?: Date, to?: Date): Prisma.DateTimeFilter | null {
  if (!from && !to) return null
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}

function dayRange(value: string): Prisma.DateTimeFilter | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null
  const start = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { gte: start, lt: end }
}

function intersectIds(groups: string[][]): string[] {
  if (groups.length === 0) return []
  const [first = [], ...rest] = groups
  return [...new Set(first)].filter((id) =>
    rest.every((group) => group.includes(id)),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function sumFileSize(rows: Array<{ sizeBytes: bigint }>): number {
  return rows.reduce((total, row) => total + Number(row.sizeBytes), 0)
}

function csvCell(value: string): string {
  const formulaSafeValue = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value
  return `"${formulaSafeValue.replaceAll('"', '""')}"`
}

export const auditRouteTesting = {
  encodeCursor,
  filterPageSize: FILTER_PAGE_SIZE,
  parseCursor,
  streamCsvPages,
}
