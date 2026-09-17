import { describe, expect, it } from "vitest";
import {
  maintenanceStateSchema,
  updateMaintenanceSettingsSchema,
} from "../src/settings.js";

const status = {
  maintenance_id: "01900000-0000-7000-8000-000000000001",
  active: true,
  enabled: true,
  reason: null,
  start_at: "2026-09-17T12:00:00.000Z",
  end_at: "2026-09-17T13:00:00.000Z",
};

describe("maintenance period contract", () => {
  it("requires a valid identifier for active maintenance", () => {
    expect(maintenanceStateSchema.parse(status)).toEqual(status);
    for (const maintenance_id of [null, undefined, "broken"]) {
      expect(
        maintenanceStateSchema.safeParse({ ...status, maintenance_id }).success,
      ).toBe(false);
    }
  });
  it("allows an unconfigured installation with no maintenance period", () => {
    expect(
      maintenanceStateSchema.safeParse({
        ...status,
        active: false,
        enabled: false,
        maintenance_id: null,
        start_at: null,
        end_at: null,
      }).success,
    ).toBe(true);
  });
  it("does not allow clients to assign maintenance period ids", () => {
    const input = {
      enabled: true,
      reason: status.reason,
      start_at: status.start_at,
      end_at: status.end_at,
    };
    expect(updateMaintenanceSettingsSchema.safeParse(input).success).toBe(true);
    expect(
      updateMaintenanceSettingsSchema.safeParse({
        ...input,
        maintenance_id: status.maintenance_id,
      }).success,
    ).toBe(false);
  });
});
