import { describe, expect, it } from "vitest";

import {
  automationToolRequestSchema,
  automationToolResultSchema,
} from "../src/automation-tools.js";

const id = "10000000-0000-4000-8000-000000000001";

describe("automation tool contracts", () => {
  it("defaults creation to a separate execution task and requires a reusable request id", () => {
    const input = {
      operation: "create",
      request_id: id,
      title: "Morning brief",
      instruction: "Summarize recent updates.",
      schedule: {
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
    };
    expect(automationToolRequestSchema.parse(input).operation).toBe("create");
    expect(automationToolRequestSchema.parse(input)).toMatchObject({
      target: { mode: "new_task" },
    });
    expect(
      automationToolRequestSchema.parse({ ...input, additional: true }),
    ).toMatchObject({ additional: true });
    for (const target of [
      { mode: "current_task" },
      { mode: "existing_task", conversation_id: id },
    ]) {
      expect(
        automationToolRequestSchema.parse({ ...input, target }),
      ).toMatchObject({ target });
    }
    expect(
      automationToolRequestSchema.safeParse({ ...input, request_id: undefined })
        .success,
    ).toBe(false);
    expect(
      automationToolRequestSchema.safeParse({ ...input, owner_id: id }).success,
    ).toBe(false);
  });

  it("rejects empty changes and keeps status operations explicit", () => {
    expect(
      automationToolRequestSchema.parse({
        operation: "update",
        automation_id: id,
        changes: { title: "Changed" },
      }),
    ).toEqual({
      operation: "update",
      automation_id: id,
      changes: { title: "Changed" },
    });
    expect(
      automationToolRequestSchema.safeParse({
        operation: "update",
        automation_id: id,
        changes: {},
      }).success,
    ).toBe(false);
    expect(
      automationToolRequestSchema.safeParse({
        operation: "update",
        automation_id: id,
        changes: { status: "active" },
      }).success,
    ).toBe(false);
    for (const operation of ["get", "delete", "pause", "resume"] as const) {
      expect(
        automationToolRequestSchema.parse({ operation, automation_id: id }),
      ).toEqual({ operation, automation_id: id });
    }
    expect(
      automationToolRequestSchema.safeParse({
        operation: "run_now",
        automation_id: id,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed service results", () => {
    expect(
      automationToolResultSchema.safeParse({
        operation: "create",
        automation: { id },
      }).success,
    ).toBe(false);
    expect(
      automationToolResultSchema.parse({
        operation: "delete",
        automation_id: id,
      }),
    ).toEqual({ operation: "delete", automation_id: id });
  });
});
