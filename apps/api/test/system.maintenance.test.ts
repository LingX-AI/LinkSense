import { describe, expect, it } from "vitest"

import { maintenanceStatus } from "../src/modules/system/service.js"

describe("system maintenance status", () => {
  const raw = {
    maintenance: {
      enabled: true,
      reason: "  Database upgrade  ",
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    },
  }

  it("is active only inside the configured half-open maintenance window", () => {
    expect(
      maintenanceStatus(raw, new Date("2026-08-04T12:00:00.000Z"))
    ).toEqual({
      enabled: true,
      active: true,
      reason: "Database upgrade",
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    })
    expect(
      maintenanceStatus(raw, new Date("2026-08-04T13:00:00.000Z")).active
    ).toBe(false)
  })

  it("is active inside the configured window even without a reason", () => {
    expect(
      maintenanceStatus(
        {
          maintenance: {
            enabled: true,
            reason: null,
            start_at: "2026-08-04T12:00:00.000Z",
            end_at: "2026-08-04T13:00:00.000Z",
          },
        },
        new Date("2026-08-04T12:30:00.000Z")
      )
    ).toEqual({
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
        new Date("2026-08-04T12:30:00.000Z")
      )
    ).toEqual({
      enabled: true,
      active: false,
      reason: "Upgrade",
      start_at: null,
      end_at: null,
    })
  })
})
