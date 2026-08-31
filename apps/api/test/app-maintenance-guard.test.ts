import { describe, expect, it } from "vitest"

import {
  isMaintenanceExemptPath,
  shouldBlockForMaintenance,
} from "../src/app.js"

const activeMaintenance = {
  enabled: true,
  active: true,
  reason: "Database upgrade",
  start_at: "2026-08-04T12:00:00.000Z",
  end_at: "2026-08-04T13:00:00.000Z",
} as const

describe("maintenance request guard", () => {
  it("keeps bootstrap, authentication, external embed, current-user, and administrator paths available", () => {
    expect(isMaintenanceExemptPath("/api/v1/system/bootstrap")).toBe(true)
    expect(isMaintenanceExemptPath("/api/v1/auth/login")).toBe(true)
    expect(isMaintenanceExemptPath("/api/v1/embed/frame/lsa_embed_app_id")).toBe(
      true
    )
    expect(isMaintenanceExemptPath("/api/v1/me?include=profile")).toBe(true)
    expect(isMaintenanceExemptPath("/api/v1/admin/product-settings")).toBe(true)
    expect(isMaintenanceExemptPath("/api/v1/conversations")).toBe(false)
  })

  it("blocks regular users but allows administrators during active maintenance", () => {
    expect(shouldBlockForMaintenance(activeMaintenance, "user")).toBe(true)
    expect(shouldBlockForMaintenance(activeMaintenance, "admin")).toBe(false)
    expect(
      shouldBlockForMaintenance({ ...activeMaintenance, active: false }, "user")
    ).toBe(false)
  })
})
