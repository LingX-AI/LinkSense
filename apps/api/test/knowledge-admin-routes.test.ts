import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

import { knowledgeAdminRoutes } from "../src/modules/knowledge/admin-routes.js"
import type { KnowledgeAdminService } from "../src/modules/knowledge/admin.js"
import { knowledgeMaintenanceRoutes } from "../src/modules/knowledge/maintenance-routes.js"
import type { KnowledgeMaintenanceService } from "../src/modules/knowledge/maintenance.js"

const ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin" as const,
  status: "active" as const,
}
const BASE_ID = "00000000-0000-4000-8000-000000000002"
const OWNER_ID = "00000000-0000-4000-8000-000000000003"
const TASK_ID = "00000000-0000-4000-8000-000000000004"
const CLEANUP_TARGET_ID = "00000000-0000-4000-8000-000000000005"
const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("knowledge administrator routes", () => {
  it("forwards only governance filters and stable pagination", async () => {
    const list = vi.fn(async () => ({ items: [], next_cursor: null }))
    const app = await adminApp({ list })

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/knowledge-bases?lifecycle_status=archived&availability_status=disabled&limit=25",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [], next_cursor: null },
    })
    expect(list).toHaveBeenCalledWith(ADMIN, {
      lifecycleStatus: "archived",
      availabilityStatus: "disabled",
      limit: 25,
    })
  })

  it("requires a reason and keeps archive and force-delete as separate commands", async () => {
    const archive = vi.fn(async () => undefined)
    const forceDelete = vi.fn(async () => undefined)
    const app = await adminApp({ archive, forceDelete })

    const invalid = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/knowledge-bases/${BASE_ID}`,
      payload: {},
    })
    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/admin/knowledge-bases/${BASE_ID}/archive`,
      payload: { reason: "policy" },
    })
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/knowledge-bases/${BASE_ID}`,
      payload: { reason: "policy" },
    })

    expect(invalid.statusCode).toBe(400)
    expect(archived.statusCode).toBe(204)
    expect(deleted.statusCode).toBe(204)
    expect(archive).toHaveBeenCalledWith(ADMIN, BASE_ID, "policy")
    expect(forceDelete).toHaveBeenCalledWith(ADMIN, BASE_ID, "policy")
  })

  it("forwards transfer ownership with a mandatory governance reason", async () => {
    const transferOwnership = vi.fn(async () => undefined)
    const app = await adminApp({ transferOwnership })

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/knowledge-bases/${BASE_ID}/transfer-owner`,
      payload: { owner_id: OWNER_ID, reason: "owner disabled" },
    })

    expect(response.statusCode).toBe(204)
    expect(transferOwnership).toHaveBeenCalledWith(
      ADMIN,
      BASE_ID,
      OWNER_ID,
      "owner disabled",
    )
  })

  it.each(["outbox", "document", "document_version", "object"] as const)(
    "forwards a target-scoped %s cleanup retry",
    async (targetType) => {
      const retryCleanup = vi.fn(async () => ({ retried_count: 1 }))
      const app = await adminApp({ retryCleanup })

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/knowledge-bases/${BASE_ID}/cleanup/retry`,
        payload: {
          target_type: targetType,
          target_id: CLEANUP_TARGET_ID,
          reason: "manual recovery",
        },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        success: true,
        data: { retried_count: 1 },
      })
      expect(retryCleanup).toHaveBeenCalledWith(
        ADMIN,
        BASE_ID,
        { type: targetType, id: CLEANUP_TARGET_ID },
        "manual recovery",
      )
    },
  )

  it("forwards a whole-base cleanup retry without exposing internal target ids", async () => {
    const retryCleanup = vi.fn(async () => ({ retried_count: 1 }))
    const app = await adminApp({ retryCleanup })

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/knowledge-bases/${BASE_ID}/cleanup/retry`,
      payload: { reason: "manual recovery" },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      success: true,
      data: { retried_count: 1 },
    })
    expect(retryCleanup).toHaveBeenCalledWith(
      ADMIN,
      BASE_ID,
      undefined,
      "manual recovery",
    )
  })

  it("rejects an incomplete cleanup target", async () => {
    const retryCleanup = vi.fn(async () => ({ retried_count: 1 }))
    const app = await adminApp({ retryCleanup })

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/knowledge-bases/${BASE_ID}/cleanup/retry`,
      payload: {
        target_type: "outbox",
        reason: "manual recovery",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(retryCleanup).not.toHaveBeenCalled()
  })
})

describe("knowledge maintenance routes", () => {
  it("returns null when no deployment rebuild has been requested", async () => {
    const getLatest = vi.fn(async () => null)
    const app = await maintenanceApp({ getLatest })

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/knowledge-maintenance/rebuild-all",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ success: true, data: null })
  })

  it("requires explicit confirmation before creating a rebuild task", async () => {
    const requestRebuild = vi.fn(async () => ({
      id: TASK_ID,
      status: "pending" as const,
      current_stage: null,
      total_count: 1,
      succeeded_count: 0,
      failed_count: 0,
      stable_error_code: null,
      created_at: "2026-07-22T00:00:00.000Z",
      started_at: null,
      completed_at: null,
    }))
    const app = await maintenanceApp({ requestRebuild })

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/admin/knowledge-maintenance/rebuild-all",
      payload: { reason: "dimension change", confirmed: false },
    })
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/admin/knowledge-maintenance/rebuild-all",
      payload: { reason: "dimension change", confirmed: true },
    })

    expect(rejected.statusCode).toBe(400)
    expect(accepted.statusCode).toBe(202)
    expect(requestRebuild).toHaveBeenCalledWith(ADMIN, {
      reason: "dimension change",
      confirmed: true,
    })
  })
})

async function adminApp(overrides: Partial<KnowledgeAdminService>) {
  const app = Fastify()
  apps.push(app)
  app.setErrorHandler((error, _request, reply) => {
    void reply
      .code(error instanceof Error && error.name === "ZodError" ? 400 : 500)
      .send()
  })
  await app.register(knowledgeAdminRoutes, {
    service: overrides as KnowledgeAdminService,
    resolveActor: () => ADMIN,
    prefix: "/api/v1/admin/knowledge-bases",
  })
  await app.ready()
  return app
}

async function maintenanceApp(overrides: Partial<KnowledgeMaintenanceService>) {
  const app = Fastify()
  apps.push(app)
  app.setErrorHandler((error, _request, reply) => {
    void reply
      .code(error instanceof Error && error.name === "ZodError" ? 400 : 500)
      .send()
  })
  await app.register(knowledgeMaintenanceRoutes, {
    service: overrides as KnowledgeMaintenanceService,
    resolveActor: () => ADMIN,
    prefix: "/api/v1/admin/knowledge-maintenance",
  })
  await app.ready()
  return app
}
