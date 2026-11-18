import { describe, expect, it } from "vitest";
import { desktopExecutionCommandSchema, desktopExecutionResultSchema } from "../src/desktop-execution.js";

const id = "10000000-0000-4000-8000-000000000001";
const turnId = "10000000-0000-4000-8000-000000000002";
const expiresAt = "2026-11-18T10:00:00.000Z";
const start = {
  type: "command",
  operation: "turn.start",
  id,
  owner_id: id,
  conversation_id: id,
  runtime_generation: id,
  turn_id: turnId,
  expires_at: expiresAt,
  body: {
    native_thread_id: null,
    input: "Summarize the sample.",
    reasoning_effort: "low",
    credentials: {
      turn_id: turnId,
      expires_at: expiresAt,
      run_token: `lsdr_${"a".repeat(43)}`,
      primary: { purpose: "primary", model: "sample", revision: 1, protocol_mode: "native_responses", token: `lsdm_${"b".repeat(43)}` },
    },
  },
};

describe("desktop execution wire contract", () => {
  it("uses a scoped start body and rejects internal credentials, paths and cross-turn grants", () => {
    expect(desktopExecutionCommandSchema.parse(start)).toEqual(start);
    for (const bad of [
      { ...start, path: "/internal/runner/events" },
      { ...start, headers: {} },
      { ...start, operation: "run.command" },
      { ...start, body: { ...start.body, environment: {} } },
      { ...start, body: { ...start.body, credentials: { ...start.body.credentials, turn_id: id } } },
      { ...start, body: { ...start.body, credentials: { ...start.body.credentials, primary: { ...start.body.credentials.primary, apiKey: "test-only" } } } },
    ]) expect(desktopExecutionCommandSchema.safeParse(bad).success).toBe(false);
  });

  it("distinguishes a missing operation, a confirmed start, and an unknown result without accepting raw errors", () => {
    const inspection = { type: "command.result", id, operation: "turn.inspect", ok: true, result: null };
    expect(desktopExecutionResultSchema.parse(inspection)).toEqual(inspection);
    expect(desktopExecutionResultSchema.safeParse({ ...inspection, operation: "turn.start" }).success).toBe(false);
    const unknown = { type: "command.result", id, operation: "turn.start", ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
    expect(desktopExecutionResultSchema.parse(unknown)).toEqual(unknown);
    expect(desktopExecutionResultSchema.safeParse({ ...unknown, message: "test-only diagnostics" }).success).toBe(false);
  });
});
