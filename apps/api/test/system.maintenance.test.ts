import { afterEach, describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { testConfig } from "./test-config.js"
import {
  maintenanceStatus,
  SystemService,
} from "../src/modules/system/service.js"

describe("system maintenance status", () => {
  const raw = {
    maintenance: {
      maintenance_id: "01900000-0000-7000-8000-000000000001",
      enabled: true,
      reason: "  Database upgrade  ",
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    },
  }

  it("is active only inside the configured half-open maintenance window", () => {
    expect(
      maintenanceStatus(raw, new Date("2026-08-04T12:00:00.000Z")),
    ).toEqual({
      maintenance_id: "01900000-0000-7000-8000-000000000001",
      enabled: true,
      active: true,
      reason: "Database upgrade",
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    })
    expect(
      maintenanceStatus(raw, new Date("2026-08-04T13:00:00.000Z")).active,
    ).toBe(false)
  })

  it("is active inside the configured window even without a reason", () => {
    expect(
      maintenanceStatus(
        {
          maintenance: {
            maintenance_id: "01900000-0000-7000-8000-000000000001",
            enabled: true,
            reason: null,
            start_at: "2026-08-04T12:00:00.000Z",
            end_at: "2026-08-04T13:00:00.000Z",
          },
        },
        new Date("2026-08-04T12:30:00.000Z"),
      ),
    ).toEqual({
      maintenance_id: "01900000-0000-7000-8000-000000000001",
      enabled: true,
      active: true,
      reason: null,
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    })
  })

  it("fails closed to an inactive status for incomplete persisted settings", () => {
    expect(
      maintenanceStatus(
        { maintenance: { enabled: true, reason: "Upgrade" } },
        new Date("2026-08-04T12:30:00.000Z"),
      ),
    ).toEqual({
      maintenance_id: null,
      enabled: true,
      active: false,
      reason: "Upgrade",
      start_at: null,
      end_at: null,
    })
  })
})

describe("maintenance periods", () => {
  afterEach(() => vi.useRealTimers())
  const original = {
    maintenance_id: "01900000-0000-7000-8000-000000000001",
    enabled: true,
    reason: "Upgrade",
    start_at: "2026-08-04T12:00:00.000Z",
    end_at: "2026-08-04T13:00:00.000Z",
  }
  function setup(maintenance: Record<string, unknown> | null = original) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-04T12:30:00.000Z"))
    let settingsJson = {
      system_initialized: true,
      product: { name: "Existing organization" },
      maintenance,
    }
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      systemSetting: {
        findUnique: vi.fn(async () => ({ settingsJson })),
        update: vi.fn(async (args: { data: { settingsJson: typeof settingsJson } }) => {
          settingsJson = args.data.settingsJson
          return { id: "system" }
        }),
        upsert: vi.fn(
          async (args: { update: { settingsJson: typeof settingsJson } }) => {
            settingsJson = args.update.settingsJson
            return { id: "system" }
          },
        ),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    }
    const prisma = {
      systemSetting: tx.systemSetting,
      $transaction: async (fn: (value: typeof tx) => Promise<unknown>) =>
        fn(tx),
    } as unknown as PrismaClient
    const service = new SystemService(
      prisma,
      {} as ConstructorParameters<typeof SystemService>[1],
      {} as ConstructorParameters<typeof SystemService>[2],
      {} as ConstructorParameters<typeof SystemService>[3],
      {} as ConstructorParameters<typeof SystemService>[4],
      {} as ConstructorParameters<typeof SystemService>[5],
      testConfig(),
      {} as ConstructorParameters<typeof SystemService>[7],
    )
    const input = {
      enabled: original.enabled,
      reason: original.reason,
      start_at: original.start_at,
      end_at: original.end_at,
    }
    return { service, tx, input, read: () => settingsJson }
  }
  it("persists an empty disabled configuration at the exact end time and only once", async () => {
    const { service, tx, read } = setup()
    vi.setSystemTime(new Date(original.end_at))
    const status = await service.getMaintenanceStatus()
    expect(status).toEqual({ enabled: false, active: false, reason: null, start_at: null, end_at: null })
    expect(read().maintenance).toEqual({ maintenance_id: null, enabled: false, reason: null, start_at: null, end_at: null })
    expect(read().product).toEqual({ name: "Existing organization" })
    await service.getMaintenanceStatus()
    expect(tx.systemSetting.update).toHaveBeenCalledTimes(1)
    expect(tx.auditLog.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        actorId: null, action: "maintenance_settings_expired",
        targetType: "system_settings", targetId: "00000000-0000-4000-8000-000000000001",
        result: "success",
      },
    })
  })

  it.each(["2026-08-04T11:00:00.000Z", "2026-08-04T12:59:59.999Z"])(
    "preserves a scheduled or ongoing plan at %s", async (time) => {
      const { service, tx, read } = setup()
      vi.setSystemTime(new Date(time))
      await service.getMaintenanceStatus()
      expect(read().maintenance).toEqual(original)
      expect(tx.systemSetting.update).not.toHaveBeenCalled()
    },
  )

  it("rechecks the plan under the settings lock before clearing an expired snapshot", async () => {
    const { service, tx, read } = setup()
    const expiredSnapshot = read()
    vi.setSystemTime(new Date(original.end_at))
    await service.updateMaintenanceSettings("admin", {
      enabled: true, reason: "Extended", start_at: original.start_at,
      end_at: "2026-08-04T14:00:00.000Z",
    }, {})
    tx.systemSetting.findUnique.mockResolvedValueOnce({ settingsJson: expiredSnapshot })
    expect(await service.getMaintenanceStatus()).toMatchObject({ enabled: true, active: true, reason: "Extended" })
    expect(tx.systemSetting.update).not.toHaveBeenCalled()
    expect(read().maintenance).toMatchObject({ reason: "Extended" })
  })

  it("clears an expired pre-change record without a maintenance identity", async () => {
    const { service, read } = setup({
      enabled: original.enabled, reason: original.reason,
      start_at: original.start_at, end_at: original.end_at,
    })
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"))
    await service.getMaintenanceStatus()
    expect(read().maintenance).toEqual({ maintenance_id: null, enabled: false, reason: null, start_at: null, end_at: null })
  })

  it("preserves a new future plan when another worker observed the old expired plan", async () => {
    const { service, tx, read } = setup()
    const expiredSnapshot = read()
    vi.setSystemTime(new Date(original.end_at))
    const nextPlan = await service.updateMaintenanceSettings("admin", {
      enabled: true, reason: "Next plan", start_at: "2026-08-05T12:00:00.000Z",
      end_at: "2026-08-05T13:00:00.000Z",
    }, {})
    tx.systemSetting.findUnique.mockResolvedValueOnce({ settingsJson: expiredSnapshot })
    await service.expireMaintenanceSettings()
    expect(read().maintenance).toMatchObject({ maintenance_id: nextPlan.maintenance_id, reason: "Next plan" })
    expect(tx.systemSetting.update).not.toHaveBeenCalled()
  })

  it("cleans an overdue plan during startup without a request", async () => {
    const { service, read } = setup()
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"))
    await service.prepare()
    expect(read().maintenance).toMatchObject({ enabled: false, end_at: null, reason: null })
  })

  it("returns the cleared plan and identity from bootstrap", async () => {
    const { service, read } = setup()
    vi.setSystemTime(new Date(original.end_at))
    expect(await service.bootstrap()).toMatchObject({
      maintenance_id: null,
      maintenance: { enabled: false, active: false, reason: null, start_at: null, end_at: null },
    })
    expect(read().maintenance).toMatchObject({ enabled: false, maintenance_id: null })
  })

  it("does not persist an enabled plan when saving an already elapsed window", async () => {
    const { service, read, input } = setup()
    vi.setSystemTime(new Date(original.end_at))
    expect(await service.updateMaintenanceSettings("admin", input, {})).toMatchObject({
      enabled: false, reason: null, start_at: null, end_at: null,
    })
    expect(read().maintenance).toMatchObject({ enabled: false, maintenance_id: null })
  })

  it("assigns a period to the first activation without altering other settings", async () => {
    const { service, input, read } = setup(null)
    const result = await service.updateMaintenanceSettings("admin", input, {})
    expect(result.maintenance_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.active).toBe(true)
    expect(read().product).toEqual({ name: "Existing organization" })
    expect(read().maintenance).toMatchObject({
      maintenance_id: result.maintenance_id,
    })
  })
  it("retains the period while editing details or extending active maintenance", async () => {
    const { service, input } = setup()
    const result = await service.updateMaintenanceSettings(
      "admin",
      {
        ...input,
        reason: "More time needed",
        start_at: "2026-08-04T12:15:00.000Z",
        end_at: "2026-08-04T14:00:00.000Z",
      },
      {},
    )
    expect(result.maintenance_id).toBe(original.maintenance_id)
    expect(result.active).toBe(true)
  })
  it("retains the period when editing a scheduled maintenance window", async () => {
    const { service, input } = setup()
    vi.setSystemTime(new Date("2026-08-04T11:00:00.000Z"))
    const result = await service.updateMaintenanceSettings(
      "admin",
      { ...input, start_at: "2026-08-04T12:15:00.000Z" },
      {},
    )
    expect(result.maintenance_id).toBe(original.maintenance_id)
    expect(result.active).toBe(false)
  })
  it("uses a different period after disabling and immediately re-enabling the same window", async () => {
    const { service, input } = setup()
    const disabled = await service.updateMaintenanceSettings(
      "admin",
      { ...input, enabled: false },
      {},
    )
    expect(disabled.maintenance_id).toBeNull()
    const result = await service.updateMaintenanceSettings("admin", input, {})
    expect(result.maintenance_id).not.toBe(original.maintenance_id)
    expect(result.maintenance_id).not.toBeNull()
  })
  it("uses a new period after automatic expiry even when the toggle remains enabled", async () => {
    const { service, input } = setup()
    vi.setSystemTime(new Date(original.end_at))
    const result = await service.updateMaintenanceSettings(
      "admin",
      { ...input, end_at: "2026-08-04T14:00:00.000Z" },
      {},
    )
    expect(result.maintenance_id).not.toBe(original.maintenance_id)
    expect(result.active).toBe(true)
  })
  it("uses a new period when active maintenance is ended by rescheduling it into the future", async () => {
    const { service, input } = setup()
    const result = await service.updateMaintenanceSettings(
      "admin",
      {
        ...input,
        start_at: "2026-08-04T14:00:00.000Z",
        end_at: "2026-08-04T15:00:00.000Z",
      },
      {},
    )
    expect(result.maintenance_id).not.toBe(original.maintenance_id)
    expect(result.active).toBe(false)
  })
})
