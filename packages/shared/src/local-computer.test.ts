import { describe, expect, it } from "vitest";
import { localComputerPermissionInputSchema, localComputerStatusSchema } from "./local-computer.js";

const firstId = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";
const grant = {
  action: "grant", session_id: firstId, grant_id: secondId,
  capability: "computer.observe", target: { bundle_id: "com.example.Fixture" },
};

describe("Mac session authorization contracts", () => {
  it("only permits a named application and an enumerated capability", () => {
    expect(localComputerPermissionInputSchema.parse(grant)).toEqual(grant);
    for (const target of ["*", "/Applications", "file://test", "com.example.\u0000App"]) {
      expect(localComputerPermissionInputSchema.safeParse({ ...grant, target: { bundle_id: target } }).success).toBe(false);
    }
    expect(localComputerPermissionInputSchema.safeParse({ ...grant, capability: "shell" }).success).toBe(false);
  });

  it("does not accept client-selected scope, expiry or fields from another decision", () => {
    for (const extra of [{ scope: "always" }, { expires_at: "2026-11-20T00:00:00Z" }]) {
      expect(localComputerPermissionInputSchema.safeParse({ ...grant, ...extra }).success).toBe(false);
    }
    expect(localComputerPermissionInputSchema.safeParse({ ...grant, action: "revoke" }).success).toBe(false);
  });

  it("normalizes UUIDs before comparing them with stored session and grant IDs", () => {
    const id = "abc12345-0000-4000-8000-000000000001";
    const input = { ...grant, session_id: id.toUpperCase(), grant_id: id.toUpperCase() };
    expect(localComputerPermissionInputSchema.parse(input)).toEqual({
      ...grant, session_id: id, grant_id: id,
    });
  });

  it("accepts the inactive response but rejects a missing device binding", () => {
    const inactive = { device_id: firstId, session: null, grants: [] };
    expect(localComputerStatusSchema.parse(inactive)).toEqual(inactive);
    expect(localComputerStatusSchema.safeParse({ ...inactive, device_id: null }).success).toBe(false);
  });
});
