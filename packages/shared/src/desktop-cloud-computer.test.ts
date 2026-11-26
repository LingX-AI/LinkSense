import { describe, expect, it } from "vitest";

import {
  desktopCloudToolInvocationSchema,
  desktopCloudToolLifetimeFor,
} from "./desktop-cloud-tools.js";
import {
  localComputerActInputSchema,
  localComputerStatusResultSchema,
} from "./desktop-cloud-computer.js";

const selection = "50000000-0000-4000-8000-000000000001";

describe("cloud computer tools", () => {
  it("parses status and select invocations and gives select a human picker budget", () => {
    expect(desktopCloudToolInvocationSchema.parse({
      operation: "local_computer.status", input: {},
    })).toEqual({ operation: "local_computer.status", input: {} });
    expect(desktopCloudToolInvocationSchema.parse({
      operation: "local_computer.select", input: {},
    })).toEqual({ operation: "local_computer.select", input: {} });
    expect(desktopCloudToolLifetimeFor("local_computer.select")).toBe(120_000);
    expect(desktopCloudToolLifetimeFor("local_computer.observe")).toBe(30_000);
  });

  it("accepts only qualified refs and bounded click/type acts", () => {
    expect(localComputerActInputSchema.parse({
      selection_id: selection, action: "click",
      observation_id: "obs", ref: "@abc123:e1",
    })).toMatchObject({ action: "click", timeout_ms: 8_000 });
    for (const input of [
      { selection_id: selection, action: "click", observation_id: "obs", ref: "e1" },
      { selection_id: selection, action: "type", observation_id: "obs", ref: "@abc123:e1", text: "" },
      { selection_id: selection, action: "click", observation_id: "obs", ref: "@abc123:e1", extra: true },
      { selection_id: selection, action: "click", observation_id: "obs", ref: "@abc123:e1", timeout_ms: 1 },
    ]) expect(localComputerActInputSchema.safeParse(input).success).toBe(false);
  });

  it("parses a bounded status result", () => {
    expect(localComputerStatusResultSchema.parse({
      state: "active", available: true,
      permissions: { accessibility: "granted" },
      selection_id: selection, expires_at: "2026-11-26T10:05:00.000Z",
    })).toMatchObject({ state: "active", selection_id: selection });
    expect(localComputerStatusResultSchema.safeParse({
      state: "active", available: true,
      permissions: { accessibility: "granted" }, window_title: "Secret",
    }).success).toBe(false);
  });
});
