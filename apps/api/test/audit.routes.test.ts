import { EventEmitter } from "node:events"

import Fastify, { type FastifyRequest } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Locale } from "@linksense/shared"

import { auditRoutes, auditRouteTesting } from "../src/modules/audit/routes.js"
import {
  AuditService,
  sanitizeAuditMetadata,
} from "../src/modules/audit/service.js"
import type { AppServices } from "../src/services.js"

const ADMIN_ID = "10000000-0000-4000-8000-000000000001"
const OWNER_ID = "10000000-0000-4000-8000-000000000002"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const SECOND_CONVERSATION_ID = "20000000-0000-4000-8000-000000000002"
const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("administrator audit privacy contracts", () => {
  it("preserves nullable targets in the permanent audit log response", async () => {
    const fixture = await auditFixture()
    const createdAt = new Date("2026-07-11T08:00:00.000Z")
    fixture.prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: "audit-without-target",
        actorId: null,
        action: "audit_exported",
        targetType: null,
        targetId: null,
        result: "success",
        metadataJson: {},
        ipAddress: null,
        userAgent: null,
        createdAt,
      },
    ])
    fixture.prisma.user.findMany.mockResolvedValueOnce([])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.items).toEqual([
      expect.objectContaining({
        id: "audit-without-target",
        target_type: null,
        target_id: null,
      }),
    ])
  })

  it("projects only safe conversation metadata and never reads, searches, or returns titles", async () => {
    const fixture = await auditFixture()
    const createdAt = new Date("2026-07-11T08:00:00.000Z")
    fixture.prisma.conversation.findMany.mockResolvedValueOnce([
      conversationRow({
        id: CONVERSATION_ID,
        createdAt,
        title: "SECRET USER PROMPT USED AS TITLE",
      }),
      conversationRow({
        id: SECOND_CONVERSATION_ID,
        createdAt,
        title: "ANOTHER SECRET TITLE",
      }),
    ])
    fixture.prisma.user.findMany.mockResolvedValueOnce([
      { id: OWNER_ID, name: "Owner", email: "owner@example.test" },
    ])
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([
      {
        conversationId: CONVERSATION_ID,
        sequenceNo: 1,
        status: "failed",
        startedAt: new Date("2026-07-11T08:00:00.000Z"),
        completedAt: new Date("2026-07-11T08:00:01.000Z"),
        interruptedAt: null,
        errorCode: "CODEX_TURN_FAILED",
        errorMessage: "SECRET INTERNAL ERROR BODY",
      },
    ])
    fixture.prisma.conversationFile.findMany.mockResolvedValueOnce([
      {
        conversationId: CONVERSATION_ID,
        kind: "artifact",
        sizeBytes: 42n,
        minioObjectKey: "secret/object/key",
      },
    ])
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([
      {
        conversationId: CONVERSATION_ID,
        payloadJson: {
          capability_type: "plugin",
          name: "Safe Plugin",
          tool_output: "SECRET TOOL OUTPUT",
        },
      },
    ])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/conversations?limit=1",
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain("SECRET")
    expect(response.body).not.toContain("secret/object/key")
    expect(response.json().data.items[0]).toEqual(
      expect.objectContaining({
        conversation_id: CONVERSATION_ID,
        owner_name: "Owner",
        updated_at: createdAt.toISOString(),
        execution_status: "failed",
        plugin_names: ["Safe Plugin"],
        error_type: "codex_turn",
        error_code: "CODEX_TURN_FAILED",
        runner_status: "available",
      }),
    )
    expect(response.json().data.items[0]).not.toHaveProperty("title")
    expect(response.json().data.next_cursor).toBe(
      `${createdAt.toISOString()}|${CONVERSATION_ID}`,
    )

    const conversationQuery = fixture.prisma.conversation.findMany.mock
      .calls[0]?.[0] as {
      select: Record<string, unknown>
    }
    expect(conversationQuery.select).not.toHaveProperty("title")
    expect(JSON.stringify(conversationQuery)).not.toContain("title")
    const turnQuery = fixture.prisma.conversationTurn.findMany.mock
      .calls[0]?.[0] as {
      select: Record<string, unknown>
    }
    expect(turnQuery.select).not.toHaveProperty("errorMessage")
  })

  it("searches only the documented safe conversation metadata and uses a stable tie-break cursor", async () => {
    const fixture = await auditFixture()
    fixture.prisma.user.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversation.findMany.mockResolvedValueOnce([])
    fixture.prisma.user.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([])
    fixture.prisma.pendingRequest.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationFile.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([])

    const cursor = `2026-07-11T08:00:00.000Z|${CONVERSATION_ID}`
    const response = await fixture.app.inject({
      method: "GET",
      url: `/admin/audit/conversations?search=private-title-only&cursor=${encodeURIComponent(cursor)}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.items).toEqual([])
    const allQueries = JSON.stringify(
      fixture.prisma.conversation.findMany.mock.calls,
    )
    expect(allQueries).not.toContain("title")
    expect(allQueries).toContain("createdAt")
    expect(allQueries).toContain(CONVERSATION_ID)
    expect(allQueries).toContain('"lt":"2026-07-11T08:00:00.000Z"')
  })

  it("groups retained artifacts without exposing object keys and paginates whole conversations", async () => {
    const fixture = await auditFixture()
    const deletedAt = new Date("2026-07-10T00:00:00.000Z")
    fixture.prisma.user.findMany
      .mockResolvedValueOnce([{ id: OWNER_ID }])
      .mockResolvedValueOnce([
        { id: OWNER_ID, name: "Owner Member", email: "owner@example.test" },
      ])
    fixture.prisma.retainedArtifact.findMany
      .mockResolvedValueOnce([
        {
          conversationId: CONVERSATION_ID,
          ownerId: OWNER_ID,
          conversationDeletedAt: deletedAt,
        },
        {
          conversationId: SECOND_CONVERSATION_ID,
          ownerId: OWNER_ID,
          conversationDeletedAt: deletedAt,
        },
      ])
      .mockResolvedValueOnce([
        retainedRow({
          conversationId: CONVERSATION_ID,
          sizeBytes: 10n,
          minioObjectKey: ["conversations", "private", "first"].join("/"),
        }),
        retainedRow({
          conversationId: CONVERSATION_ID,
          sizeBytes: 20n,
          minioObjectKey: ["conversations", "private", "second"].join("/"),
        }),
      ])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/retained-artifacts?search=Owner%20Member&limit=1&date_from=2026-07-01",
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain("conversations/private")
    expect(response.json().data.items).toEqual([
      expect.objectContaining({
        conversation_id: CONVERSATION_ID,
        owner_name: "Owner Member",
        artifact_count: 2,
        total_size_bytes: 30,
        checksum_present: true,
      }),
    ])
    expect(response.json().data.next_cursor).toBe(
      `${deletedAt.toISOString()}|${CONVERSATION_ID}`,
    )
    const groupQuery = fixture.prisma.retainedArtifact.findMany.mock
      .calls[0]?.[0] as {
      distinct: string[]
      take: number
      select: Record<string, unknown>
    }
    expect(groupQuery).toMatchObject({
      distinct: ["conversationId"],
      take: 2,
    })
    expect(groupQuery.select).not.toHaveProperty("minioObjectKey")
    const detailQuery = fixture.prisma.retainedArtifact.findMany.mock
      .calls[1]?.[0] as {
      select: Record<string, unknown>
    }
    expect(detailQuery.select).not.toHaveProperty("minioObjectKey")
  })

  it.each(["audit_logs", "conversations", "retained_artifacts"] as const)(
    "exports the %s view with only its allowed columns and records the export",
    async (view) => {
      const fixture = await auditFixture("en-US", "MOSS")
      seedExportView(fixture, view)

      const response = await fixture.app.inject({
        method: "GET",
        url: `/admin/audit/export.csv?view=${view}`,
        headers: { "user-agent": "audit-export-test" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers["content-type"]).toContain("text/csv")
      expect(response.headers["content-disposition"]).toContain(
        view === "conversations"
          ? 'filename="MOSS-tasks.csv"'
          : `filename="MOSS-${view}.csv"`,
      )
      if (view === "conversations") {
        expect(response.body).toContain('"Task ID"')
        expect(response.body).not.toContain('"Conversation ID"')
      }
      if (view === "retained_artifacts") {
        expect(response.body).toContain('"Task ID"')
        expect(response.body).toContain('"Task Deleted At"')
        expect(response.body).not.toContain('"Conversation ID"')
        expect(response.body).not.toContain('"Conversation Deleted At"')
      }
      if (view === "audit_logs") {
        expect(response.body).toContain('"Actor ID","Actor Name","Actor Email"')
        expect(response.body).toContain(`"${ADMIN_ID}","Admin","admin@example.test"`)
        expect(fixture.prisma.user.findMany).toHaveBeenCalledWith({
          where: { id: { in: [ADMIN_ID] } },
          select: { id: true, name: true, email: true },
        })
        expect(response.body).toContain('"Action Code"')
        expect(response.body).toContain('"Artifact download link issued"')
        expect(response.body).toContain('"artifact_download_link_issued"')
        expect(response.body).toContain('"Task file"')
        expect(response.body).toContain('"conversation_file"')
        expect(response.body).toContain('"Success","success"')
      } else {
        expect(response.body).toContain('"Owner ID","Owner Name","Owner Email"')
        expect(response.body).toContain(`"${OWNER_ID}","Owner","owner@example.test"`)
      }
      expect(response.body).not.toContain("PRIVATE TITLE")
      expect(response.body).not.toContain("SECRET CONTENT")
      expect(response.body).not.toContain("secret/object/key")
      expect(response.body).not.toContain("https://signed.example")
      expect(fixture.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ADMIN_ID,
          action: "audit_exported",
          metadata: expect.objectContaining({ format: "csv", view }),
        }),
      )
    },
  )

  it.each([
    ["zh-CN", "创建时间", "任务 ID", "任务删除时间"],
    ["en-US", "Created At", "Task ID", "Task Deleted At"],
    ["es-ES", "Fecha de creación", "ID de tarea", "Fecha de eliminación de la tarea"],
    ["pt-BR", "Data de criação", "ID da tarefa", "Data de exclusão da tarefa"],
    ["fr-FR", "Date de création", "ID de la tâche", "Date de suppression de la tâche"],
    ["ja-JP", "作成日時", "タスク ID", "タスク削除日時"],
  ] as const)("localizes all CSV export views in %s while preserving stable data codes", async (locale, createdAt, taskId, deletedAt) => {
    for (const view of ["audit_logs", "conversations", "retained_artifacts"] as const) {
      const fixture = await auditFixture(locale)
      seedExportView(fixture, view)
      const response = await fixture.app.inject({
        url: `/admin/audit/export.csv?view=${view}`,
        headers: { "accept-language": "de-DE" },
      })
      expect(response.statusCode).toBe(200)
      const header = response.body.split("\n")[0]
      expect(header).toContain(`"${view === "audit_logs" ? createdAt : taskId}"`)
      expect(header).not.toContain("audit.export.")
      if (view === "audit_logs") {
        expect(response.body).toContain('"artifact_download_link_issued"')
        expect(response.body).toContain('"conversation_file"')
        expect(response.body).toContain('"success"')
      } else {
        expect(response.body).toContain(`"${CONVERSATION_ID}"`)
        if (view === "retained_artifacts") expect(header).toContain(`"${deletedAt}"`)
        else expect(response.body).toContain('"failed"')
      }
    }
  })

  it("uses Chinese task terminology in audit CSV headers", async () => {
    const auditLogFixture = await auditFixture("zh-CN")
    seedExportView(auditLogFixture, "audit_logs")
    const auditLogResponse = await auditLogFixture.app.inject({
      method: "GET",
      url: "/admin/audit/export.csv?view=audit_logs",
    })

    expect(auditLogResponse.statusCode).toBe(200)
    expect(auditLogResponse.body).toContain('"操作人 ID","操作人名称","操作人邮箱"')
    expect(auditLogResponse.body).toContain('"Admin","admin@example.test"')
    expect(auditLogResponse.body).toContain('"动作代码"')
    expect(auditLogResponse.body).toContain('"已签发产物下载链接"')
    expect(auditLogResponse.body).toContain('"任务文件"')
    expect(auditLogResponse.body).toContain('"成功","success"')

    const conversationFixture = await auditFixture("zh-CN")
    seedExportView(conversationFixture, "conversations")
    const conversationResponse = await conversationFixture.app.inject({
      method: "GET",
      url: "/admin/audit/export.csv?view=conversations",
    })

    expect(conversationResponse.statusCode).toBe(200)
    expect(conversationResponse.headers["content-disposition"]).toContain(
      'filename="LinkSense-tasks.csv"',
    )
    expect(conversationResponse.body).toContain('"任务 ID"')
    expect(conversationResponse.body).not.toContain('"对话 ID"')

    const retainedFixture = await auditFixture("zh-CN")
    seedExportView(retainedFixture, "retained_artifacts")
    const retainedResponse = await retainedFixture.app.inject({
      method: "GET",
      url: "/admin/audit/export.csv?view=retained_artifacts",
    })

    expect(retainedResponse.statusCode).toBe(200)
    expect(retainedResponse.body).toContain('"任务 ID"')
    expect(retainedResponse.body).toContain('"任务删除时间"')
    expect(retainedResponse.body).not.toContain('"对话 ID"')
    expect(retainedResponse.body).not.toContain('"对话删除时间"')
  })

  it.each(["audit_logs", "conversations", "retained_artifacts"] as const)("neutralizes formulas in %s user names and emails without mutating source data", async (view) => {
    const fixture = await auditFixture()
    seedExportView(fixture, view)
    const dangerousName = '=HYPERLINK("https://attacker.example","open")'
    const dangerousEmail = "+cmd@example.test"
    fixture.prisma.user.findMany.mockReset().mockResolvedValueOnce([
      { id: view === "audit_logs" ? ADMIN_ID : OWNER_ID, name: dangerousName, email: dangerousEmail },
    ])

    const response = await fixture.app.inject({
      method: "GET",
      url: `/admin/audit/export.csv?view=${view}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(`"'${dangerousName.replaceAll('"', '""')}"`)
    expect(response.body).toContain(`"'${dangerousEmail}"`)
    expect(response.body).not.toContain(
      `,"${dangerousName.replaceAll('"', '""')}"`,
    )
    expect(dangerousName).toBe('=HYPERLINK("https://attacker.example","open")')
    expect(dangerousEmail).toBe("+cmd@example.test")
  })

  it.each([null, ADMIN_ID])("exports blank actor details when actor %s has no user record", async (actorId) => {
    const fixture = await auditFixture()
    fixture.prisma.auditLog.findMany.mockResolvedValueOnce([{
      id: "audit-missing-actor",
      actorId,
      action: "audit_exported",
      targetType: null,
      targetId: null,
      result: "success",
      metadataJson: {},
      ipAddress: null,
      userAgent: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
    }])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/export.csv?view=audit_logs",
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(`"2026-07-11T00:00:00.000Z","${actorId ?? ""}","","","Audit logs exported"`)
  })

  it("continues error-code filtering past the first database scan page", async () => {
    const fixture = await auditFixture()
    const firstPage = Array.from(
      { length: auditRouteTesting.filterPageSize },
      (_, index) => ({
        id: `turn-${String(index).padStart(4, "0")}`,
        conversationId: CONVERSATION_ID,
      }),
    )
    fixture.prisma.conversationTurn.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        { id: "turn-late", conversationId: SECOND_CONVERSATION_ID },
      ])
      .mockResolvedValueOnce([])
    fixture.prisma.conversation.findMany.mockResolvedValueOnce([
      conversationRow({ id: SECOND_CONVERSATION_ID }),
    ])
    fixture.prisma.user.findMany.mockResolvedValueOnce([
      { id: OWNER_ID, name: "Owner", email: "owner@example.test" },
    ])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/conversations?error_code=CODEX_LATE_PAGE",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.items[0].conversation_id).toBe(
      SECOND_CONVERSATION_ID,
    )
    const firstScan = fixture.prisma.conversationTurn.findMany.mock
      .calls[0]?.[0] as {
      select: Record<string, unknown>
      take: number
    }
    const secondScan = fixture.prisma.conversationTurn.findMany.mock
      .calls[1]?.[0] as {
      cursor: { id: string }
      skip: number
    }
    expect(firstScan).toMatchObject({
      select: { id: true, conversationId: true },
      take: auditRouteTesting.filterPageSize,
    })
    expect(firstScan.select).not.toHaveProperty("errorMessage")
    expect(secondScan).toMatchObject({
      cursor: { id: firstPage.at(-1)!.id },
      skip: 1,
    })
  })

  it("filters capability names in PostgreSQL JSON fields without reading event payloads", async () => {
    const fixture = await auditFixture()
    const firstPage = Array.from(
      { length: auditRouteTesting.filterPageSize },
      (_, index) => ({
        id: `event-${String(index).padStart(4, "0")}`,
        conversationId: CONVERSATION_ID,
      }),
    )
    fixture.prisma.conversationEvent.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        { id: "event-late", conversationId: SECOND_CONVERSATION_ID },
      ])
      .mockResolvedValueOnce([])
    fixture.prisma.conversation.findMany.mockResolvedValueOnce([
      conversationRow({ id: SECOND_CONVERSATION_ID }),
    ])
    fixture.prisma.user.findMany.mockResolvedValueOnce([
      { id: OWNER_ID, name: "Owner", email: "owner@example.test" },
    ])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/conversations?plugin_name=Late%20Plugin",
    })

    expect(response.statusCode).toBe(200)
    const scan = fixture.prisma.conversationEvent.findMany.mock
      .calls[0]?.[0] as {
      where: unknown
      select: Record<string, unknown>
    }
    expect(scan.select).toEqual({ id: true, conversationId: true })
    expect(scan.select).not.toHaveProperty("payloadJson")
    expect(JSON.stringify(scan.where)).toContain('"path":["capability_type"]')
    expect(JSON.stringify(scan.where)).toContain('"path":["name"]')
    expect(JSON.stringify(scan.where)).toContain('"mode":"insensitive"')
    expect(response.body).not.toContain("payloadJson")
  })

  it("finds retained-artifact owners beyond the first safe user scan page", async () => {
    const fixture = await auditFixture()
    const firstPage = Array.from(
      { length: auditRouteTesting.filterPageSize },
      (_, index) => ({ id: `owner-${String(index).padStart(4, "0")}` }),
    )
    fixture.prisma.user.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: OWNER_ID }])
      .mockResolvedValueOnce([
        { id: OWNER_ID, name: "Late Owner", email: "late@example.test" },
      ])
    fixture.prisma.retainedArtifact.findMany
      .mockResolvedValueOnce([
        {
          conversationId: CONVERSATION_ID,
          ownerId: OWNER_ID,
          conversationDeletedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([retainedRow()])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/retained-artifacts?search=Late%20Owner",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.items[0]).toMatchObject({
      owner_id: OWNER_ID,
      owner_name: "Late Owner",
    })
    expect(fixture.prisma.user.findMany.mock.calls[1]?.[0]).toMatchObject({
      cursor: { id: firstPage.at(-1)!.id },
      skip: 1,
    })
  })

  it("exports every composite-cursor page instead of stopping at one fixed segment", async () => {
    const fixture = await auditFixture()
    const createdAt = new Date("2026-07-11T12:00:00.000Z")
    const firstPage = Array.from({ length: 201 }, (_, index) => ({
      id: `audit-${String(index).padStart(4, "0")}`,
      actorId: null,
      action: index === 200 ? "late-page-action" : "ordinary-action",
      targetType: "conversation",
      targetId: CONVERSATION_ID,
      result: "success",
      metadataJson: {},
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(createdAt.getTime() - index * 1_000),
    }))
    fixture.prisma.auditLog.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([firstPage.at(-1)!])

    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/audit/export.csv?view=audit_logs",
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("late-page-action")
    expect(fixture.prisma.auditLog.findMany).toHaveBeenCalledTimes(2)
    const secondQuery = fixture.prisma.auditLog.findMany.mock.calls[1]?.[0] as {
      where: unknown
    }
    expect(JSON.stringify(secondQuery.where)).toContain(firstPage[199]!.id)
    expect(JSON.stringify(secondQuery.where)).toContain(
      firstPage[199]!.createdAt.toISOString(),
    )
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ row_count: 201 }),
      }),
    )
  })
})

describe("audit CSV page streaming", () => {
  it("writes from the BOM/header through the final page without aggregating pages", async () => {
    const writable = new CsvTestWritable()
    const loadPage = vi
      .fn<
        (
          cursor?: string,
        ) => Promise<{ items: string[]; next_cursor: string | null }>
      >()
      .mockResolvedValueOnce({
        items: ["first", "second"],
        next_cursor: "page-2",
      })
      .mockResolvedValueOnce({ items: ["last"], next_cursor: null })
    const projectedPageSizes: number[] = []

    const rowCount = await auditRouteTesting.streamCsvPages({
      writable,
      signal: new AbortController().signal,
      header: ["Header"],
      loadPage,
      rowsForPage: (items) => {
        projectedPageSizes.push(items.length)
        return items.map((item) => [item])
      },
    })

    expect(rowCount).toBe(3)
    expect(loadPage.mock.calls).toEqual([[undefined], ["page-2"]])
    expect(projectedPageSizes).toEqual([2, 1])
    expect(writable.chunks[0]).toBe('\uFEFF"Header"\r\n')
    expect(writable.chunks.slice(1)).toEqual([
      '"first"\r\n',
      '"second"\r\n',
      '"last"\r\n',
    ])
  })

  it("waits for drain before continuing the current page or loading the next page", async () => {
    const writable = new CsvTestWritable(new Set([2]))
    const loadPage = vi
      .fn<
        (
          cursor?: string,
        ) => Promise<{ items: string[]; next_cursor: string | null }>
      >()
      .mockResolvedValueOnce({
        items: ["first", "second"],
        next_cursor: "page-2",
      })
      .mockResolvedValueOnce({ items: ["last"], next_cursor: null })
    const exportPromise = auditRouteTesting.streamCsvPages({
      writable,
      signal: new AbortController().signal,
      header: ["Header"],
      loadPage,
      rowsForPage: (items) => items.map((item) => [item]),
    })

    await vi.waitFor(() => expect(writable.chunks).toHaveLength(2))
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(writable.chunks.at(-1)).toBe('"first"\r\n')

    writable.emit("drain")
    await expect(exportPromise).resolves.toBe(3)
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(writable.chunks.at(-1)).toBe('"last"\r\n')
  })

  it("stops after a client closes during backpressure", async () => {
    const writable = new CsvTestWritable(new Set([2]))
    const loadPage = vi
      .fn<
        (
          cursor?: string,
        ) => Promise<{ items: string[]; next_cursor: string | null }>
      >()
      .mockResolvedValueOnce({
        items: ["first", "second"],
        next_cursor: "page-2",
      })
    const exportPromise = auditRouteTesting.streamCsvPages({
      writable,
      signal: new AbortController().signal,
      header: ["Header"],
      loadPage,
      rowsForPage: (items) => items.map((item) => [item]),
    })

    await vi.waitFor(() => expect(writable.chunks).toHaveLength(2))
    writable.destroyed = true
    writable.emit("close")

    await expect(exportPromise).rejects.toMatchObject({
      name: "CsvExportAbortedError",
    })
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(writable.chunks).toEqual(['\uFEFF"Header"\r\n', '"first"\r\n'])
  })
})

describe("AuditService metadata boundary", () => {
  it("keeps request provenance but drops secret, content, URL, object-key, and nested metadata", async () => {
    const create = vi.fn(async () => ({}))
    const service = new AuditService({ auditLog: { create } } as never)

    await service.write({
      actorId: ADMIN_ID,
      action: "conversation_pending_request_created",
      result: "failed",
      ipAddress: "192.0.2.42",
      userAgent: "Audit Browser",
      metadata: {
        conversation_id: CONVERSATION_ID,
        queue_no: 2,
        password: "secret",
        access_token: "secret",
        request_body: "SECRET CONTENT",
        download_url: "https://signed.example",
        minio_object_key: "secret/object/key",
        nested: { secret: true } as never,
      },
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        result: "failure",
        ipAddress: "192.0.2.42",
        userAgent: "Audit Browser",
        metadataJson: {
          conversation_id: CONVERSATION_ID,
          queue_no: 2,
        },
      }),
    })
    expect(
      sanitizeAuditMetadata("conversation_pending_request_created", {
        conversation_id: CONVERSATION_ID,
        queue_no: 2,
        unknown_safe_looking_key: true,
        credential_value: "secret",
        content_text: "secret",
        signedUrl: "secret",
        objectKey: "secret",
      }),
    ).toEqual({ conversation_id: CONVERSATION_ID, queue_no: 2 })
  })
})

class CsvTestWritable extends EventEmitter {
  readonly chunks: string[] = []
  destroyed = false

  constructor(private readonly backpressureWrites = new Set<number>()) {
    super()
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return !this.backpressureWrites.has(this.chunks.length)
  }
}

async function auditFixture(
  preferredLocale: Locale = "en-US",
  productName = "LinkSense",
) {
  const findMany = () =>
    vi.fn<(input?: unknown) => Promise<Array<Record<string, unknown>>>>(
      async () => [],
    )
  const prisma = {
    auditLog: { findMany: findMany() },
    user: { findMany: findMany() },
    conversation: { findMany: findMany() },
    conversationTurn: { findMany: findMany() },
    pendingRequest: { findMany: findMany() },
    conversationFile: { findMany: findMany() },
    conversationEvent: { findMany: findMany() },
    retainedArtifact: { findMany: findMany() },
  }
  const audit = { write: vi.fn(async () => undefined) }
  const runner = {
    health: vi.fn(async () => ({ status: "available" as const })),
  }
  const system = {
    getProductSettings: vi.fn(async () => ({
      organization_display_name: productName,
      default_locale: "zh-CN" as const,
    })),
  }
  const app = Fastify()
  apps.push(app)
  app.decorate("requireAdmin", async (request: FastifyRequest) => {
    request.authUser = {
      id: ADMIN_ID,
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      status: "active",
      preferredLocale,
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    }
  })
  await app.register(auditRoutes, {
    prefix: "/admin/audit",
    services: { prisma, audit, runner, system } as unknown as AppServices,
  })
  await app.ready()
  return { app, prisma, audit, runner, system }
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    ownerId: OWNER_ID,
    title: "PRIVATE TITLE",
    archiveStatus: "active",
    lastTurnStatus: "failed",
    lastRunAt: new Date("2026-07-11T08:00:00.000Z"),
    createdAt: new Date("2026-07-11T08:00:00.000Z"),
    updatedAt: new Date("2026-07-11T08:00:00.000Z"),
    ...overrides,
  }
}

function retainedRow(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: CONVERSATION_ID,
    ownerId: OWNER_ID,
    sizeBytes: 10n,
    checksumSha256: "a".repeat(64),
    minioObjectKey: "secret/object/key",
    artifactCreatedAt: new Date("2026-07-09T00:00:00.000Z"),
    conversationDeletedAt: new Date("2026-07-10T00:00:00.000Z"),
    ...overrides,
  }
}

function seedExportView(
  fixture: Awaited<ReturnType<typeof auditFixture>>,
  view: "audit_logs" | "conversations" | "retained_artifacts",
) {
  if (view === "audit_logs") {
    fixture.prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: "audit-1",
        actorId: ADMIN_ID,
        action: "artifact_download_link_issued",
        targetType: "conversation_file",
        targetId: "file-1",
        result: "success",
        metadataJson: {
          conversation_id: CONVERSATION_ID,
          download_url: "https://signed.example",
          request_body: "SECRET CONTENT",
          minio_object_key: "secret/object/key",
        },
        ipAddress: "192.0.2.1",
        userAgent: "Audit Browser",
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
      },
    ])
    fixture.prisma.user.findMany.mockResolvedValueOnce([
      { id: ADMIN_ID, name: "Admin", email: "admin@example.test" },
    ])
    return
  }
  if (view === "conversations") {
    fixture.prisma.conversation.findMany.mockResolvedValueOnce([
      conversationRow({ title: "PRIVATE TITLE" }),
    ])
    fixture.prisma.user.findMany.mockResolvedValueOnce([
      { id: OWNER_ID, name: "Owner", email: "owner@example.test" },
    ])
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([])
    fixture.prisma.pendingRequest.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationFile.findMany.mockResolvedValueOnce([])
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([])
    return
  }
  fixture.prisma.retainedArtifact.findMany
    .mockResolvedValueOnce([
      {
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
        conversationDeletedAt: new Date("2026-07-10T00:00:00.000Z"),
      },
    ])
    .mockResolvedValueOnce([retainedRow()])
  fixture.prisma.user.findMany.mockResolvedValueOnce([
    { id: OWNER_ID, name: "Owner", email: "owner@example.test" },
  ])
}
