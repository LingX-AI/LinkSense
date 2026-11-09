import { describe, expect, it } from "vitest";
import {
  automationMonitoringSettingsSchema,
  readAutomationMonitoring,
} from "../src/automation-monitoring.js";
import { automationUpdateInputSchema } from "../src/automations.js";
import { automationToolRequestSchema } from "../src/automation-tools.js";

describe("automation monitoring compatibility", () => {
  it("keeps older plans unlimited and reuses their task", () => {
    expect(readAutomationMonitoring(null)).toEqual({
      stop_condition: null,
      max_runs: null,
      context_mode: "reuse_task",
      automatic_run_count: 0,
      stop_reason: null,
      stop_requested_run_id: null,
      last_run_conversation_id: null,
    });
    expect(readAutomationMonitoring(undefined)).toEqual(
      readAutomationMonitoring(null),
    );
  });
  it("accepts bounded rules and rejects invalid limits or unknown modes", () => {
    expect(
      automationMonitoringSettingsSchema.parse({
        stop_condition: "  Checklist complete  ",
        max_runs: 10,
        context_mode: "fresh_task",
      }).stop_condition,
    ).toBe("Checklist complete");
    for (const input of [
      { max_runs: 0 },
      { max_runs: 1.5 },
      { max_runs: 10_001 },
      { stop_condition: " " },
      { stop_condition: "x".repeat(501) },
      { context_mode: "new_task" },
    ]) {
      expect(automationMonitoringSettingsSchema.safeParse(input).success).toBe(
        false,
      );
      expect(automationUpdateInputSchema.safeParse({ monitoring: input }).success).toBe(false);
      expect(automationToolRequestSchema.safeParse({
        operation: "update",
        automation_id: "10000000-0000-4000-8000-000000000001",
        changes: { monitoring: input },
      }).success).toBe(false);
    }
  });
  it.each([
    { max_runs: 5 },
    { stop_condition: "Checklist complete" },
    { context_mode: "fresh_task" },
    { stop_condition: null },
    { max_runs: null },
    {},
  ])("preserves only the supplied monitoring update fields: %j", (monitoring) => {
    expect(automationUpdateInputSchema.parse({ monitoring })).toEqual({
      monitoring,
    });
    expect(
      automationToolRequestSchema.parse({
        operation: "update",
        automation_id: "10000000-0000-4000-8000-000000000001",
        changes: { monitoring },
      }),
    ).toEqual({
      operation: "update",
      automation_id: "10000000-0000-4000-8000-000000000001",
      changes: { monitoring },
    });
  });
});
