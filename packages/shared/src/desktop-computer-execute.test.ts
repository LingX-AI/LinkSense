import { describe, expect, it } from "vitest";
import {
  computerExecuteInputSchema,
  computerExecuteResultSchema,
  desktopComputerExecuteLifetimeMs,
  desktopComputerQuiesceLifetimeMs,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopExecutionResultSchema,
  desktopModelSwitchOperation,
  desktopNegotiatedOperationSchema,
  desktopToolLifetimeFor,
  desktopToolOperationSchema,
  desktopToolProtocolVersion,
  desktopToolRequestOperationSchema,
  desktopToolRequestSchema,
  desktopToolResultSchema,
  supportsDesktopComputerWait,
} from "./desktop-execution.js";

const owner = "10000000-0000-4000-8000-000000000001";
const conversation = "10000000-0000-4000-8000-000000000002";
const generation = "10000000-0000-4000-8000-000000000003";
const turn = "10000000-0000-4000-8000-000000000004";
const session = "10000000-0000-4000-8000-000000000005";
const selection = "10000000-0000-4000-8000-000000000006";
const holder = "10000000-0000-4000-8000-000000000007";
const requestId = "10000000-0000-4000-8000-000000000008";
const runToken = `lsdr_${"a".repeat(43)}`;
const expiresAt = new Date(Date.now() + 10_000).toISOString();
const observation = {
  observation_id: "obs-1",
  tree_quality: "good" as const,
  truncated: false,
  nodes: [{ ref: "e1", role: "button", name: "Continue" }],
};

function isStatusRequest(value: unknown): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "status";
}

function command(request: unknown, overrides: Record<string, unknown> = {}) {
  return {
    type: "command", id: requestId, owner_id: owner, conversation_id: conversation,
    runtime_generation: generation, turn_id: turn, expires_at: expiresAt,
    operation: "computer.execute",
    body: {
      session_id: session, selection_id: selection,
      holder_id: isStatusRequest(request) ? null : holder, request,
    },
    ...overrides,
  };
}

function toolRequest(body: unknown) {
  return {
    type: "tool.request", id: requestId, conversation_id: conversation, runtime_generation: generation,
    turn_id: turn, expires_at: expiresAt, run_token: runToken,
    operation: "computer.execute", body,
  };
}

describe("M1b computer.execute wire contract", () => {
  it("adds one negotiated string without changing the closed legacy operation sets", () => {
    expect(desktopNegotiatedOperationSchema.options).toContain("computer.execute");
    expect(desktopNegotiatedOperationSchema.options).toContain("computer.wait");
    expect(desktopToolOperationSchema.options).not.toContain("computer.execute");
    expect(desktopToolOperationSchema.options).not.toContain("computer.wait");
    // The wait marker is negotiation-only: it is neither a tool request nor a
    // command operation, so it can never become an independent operation.
    expect(desktopToolRequestOperationSchema.options).not.toContain("computer.wait");
    expect(desktopNegotiatedOperationSchema.options.filter(operation =>
      operation !== "computer.execute" && operation !== "computer.wait" && operation !== desktopModelSwitchOperation))
      .toEqual([...desktopToolOperationSchema.options, "approval.respond"]);
    expect(supportsDesktopComputerWait(["computer.execute"])).toBe(false);
    expect(supportsDesktopComputerWait(["computer.wait"])).toBe(false);
    expect(supportsDesktopComputerWait(["computer.execute", "computer.wait"])).toBe(true);
    expect(desktopToolLifetimeFor("computer.execute")).toBe(desktopComputerExecuteLifetimeMs);
    expect(desktopComputerQuiesceLifetimeMs).toBeLessThan(desktopComputerExecuteLifetimeMs);
  });

  it.each([
    { kind: "status" },
    { kind: "observe" },
    { kind: "act", native_call_id: "call-1", input: { action: "click", observation_id: "obs-1", ref: "e1" } },
    { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1" } },
  ])("accepts only the strict tool request kind %j", body => {
    expect(computerExecuteInputSchema.parse(body)).toMatchObject({ kind: body.kind });
    expect(desktopToolRequestSchema.parse(toolRequest(body))).toMatchObject({ operation: "computer.execute" });
  });

  it("rejects quiesce, scope, selectors, and holder fields on the tool request", () => {
    for (const body of [
      { kind: "quiesce" },
      { kind: "observe", bundle_id: "com.example.Other" },
      { kind: "status", selection_id: selection },
      { kind: "act", native_call_id: "call-1", input: { action: "click", observation_id: "obs-1", ref: "e1" }, holder_id: holder },
      { kind: "act", input: { action: "click", observation_id: "obs-1", ref: "e1" } },
      { kind: "act", native_call_id: "call-1", input: { action: "click", observation_id: "obs-1", ref: "e1", pid: 1 } },
      { kind: "wait" },
      { kind: "wait", native_call_id: "call-1", input: { observation_id: "obs-1", ref: "@obs-1:e1" } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "e1" } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@e1" } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", predicate: "visible" } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", app: "Finder" } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: null } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 99 } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 20_001 } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 8_000.5 } },
    ]) {
      expect(computerExecuteInputSchema.safeParse(body).success).toBe(false);
      expect(desktopToolRequestSchema.safeParse(toolRequest(body)).success).toBe(false);
    }
  });

  it("binds every command request to server IDs and allows quiesce only on the command path", () => {
    for (const request of [
      { kind: "status" }, { kind: "observe" },
      { kind: "act", native_call_id: "call-1", input: { action: "click", observation_id: "obs-1", ref: "e1" } },
      { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1" } },
      { kind: "quiesce" },
    ]) {
      expect(desktopExecutionCommandSchema.parse(command(request))).toMatchObject({
        operation: "computer.execute",
        body: {
          session_id: session, selection_id: selection,
          holder_id: request.kind === "status" ? null : holder, request: { kind: request.kind },
        },
      });
    }
    for (const body of [
      { session_id: session, selection_id: selection, request: { kind: "status" } },
      // Only read-only status may omit the observe-bound holder.
      { session_id: session, selection_id: selection, holder_id: holder, request: { kind: "status" } },
      { session_id: session, selection_id: selection, holder_id: null, request: { kind: "observe" } },
      { session_id: session, selection_id: selection, holder_id: null, request: { kind: "act", native_call_id: "call-1", input: { action: "click", observation_id: "obs-1", ref: "e1" } } },
      { session_id: session, selection_id: selection, holder_id: null, request: { kind: "quiesce" } },
      { session_id: session, selection_id: selection, holder_id: holder, request: { kind: "status" }, selection: {} },
      { session_id: "not-a-uuid", selection_id: selection, holder_id: holder, request: { kind: "observe" } },
      { session_id: session, selection_id: selection, holder_id: holder, request: { kind: "act", native_call_id: "call-1" } },
    ]) {
      expect(desktopExecutionCommandSchema.safeParse(command(undefined, { body })).success).toBe(false);
    }
  });

  it("keeps the UTF-8 text cap for non-ASCII input through the command channel", () => {
    const atLimit = "👋".repeat(2_048);
    const act = (text: string) => ({
      kind: "act", native_call_id: "call-1",
      input: { action: "type", observation_id: "obs-1", ref: "e1", text },
    });
    expect(desktopToolRequestSchema.safeParse(toolRequest(act(atLimit))).success).toBe(true);
    expect(desktopExecutionCommandSchema.safeParse(command(act(atLimit))).success).toBe(true);
    expect(desktopToolRequestSchema.safeParse(toolRequest(act(`${atLimit}👋`))).success).toBe(false);
    expect(desktopExecutionCommandSchema.safeParse(command(act(`${atLimit}👋`))).success).toBe(false);
  });

  it("round-trips the same strict typed result under command.result and tool.result", () => {
    const results = [
      { kind: "status", result: { available: true, permissions: { accessibility: "granted" }, active_grant: true } },
      { kind: "observe", result: observation },
      { kind: "act", result: { ok: true, effect: "done", waited_ms: 4 } },
      { kind: "wait", result: { result: "met", waited_ms: 12 } },
      { kind: "wait", result: { result: "timed_out", waited_ms: 8_000 } },
      { kind: "quiesce", result: { quiesced: true } },
      { kind: "failure", error: "COMPUTER_STALE_OBSERVATION" },
      { kind: "failure", error: "DEVICE_BUSY" },
      { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
    ] as const;
    for (const result of results) {
      expect(computerExecuteResultSchema.parse(result)).toEqual(result);
      expect(desktopExecutionResultSchema.parse({
        type: "command.result", id: requestId, operation: "computer.execute", ok: true, result,
      })).toMatchObject({ result });
      expect(desktopToolResultSchema.parse({
        type: "tool.result", id: requestId, operation: "computer.execute", ok: true, data: result,
      })).toMatchObject({ data: result });
    }
    for (const result of [
      { kind: "quiesce", result: { quiesced: false } },
      { kind: "status", result: { available: true, permissions: { accessibility: "granted" }, active_grant: true, holder_id: holder } },
      { kind: "failure", error: "NOT_A_CODE" },
      { kind: "act", result: { ok: true, waited_ms: 1 } },
      { kind: "wait", result: { result: "met", waited_ms: 20_001 } },
      { kind: "wait", result: { result: "met", waited_ms: -1 } },
      { kind: "wait", result: { result: "unknown", waited_ms: 1 } },
      { kind: "wait", result: { result: "met", waited_ms: 1, effect: "done" } },
    ]) {
      expect(computerExecuteResultSchema.safeParse(result).success).toBe(false);
      expect(desktopExecutionResultSchema.safeParse({
        type: "command.result", id: requestId, operation: "computer.execute", ok: true, result,
      }).success).toBe(false);
    }
  });

  it("defaults and bounds the read-only wait and accepts old and new ready frames", () => {
    expect(computerExecuteInputSchema.parse({
      kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1" },
    })).toEqual({
      kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 8_000 },
    });
    for (const timeout_ms of [100, 20_000]) {
      expect(computerExecuteInputSchema.safeParse({
        kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms },
      }).success).toBe(true);
    }
    const ready = {
      type: "ready", device_id: owner, connection_id: conversation,
      protocol_version: 1, heartbeat_interval_ms: 15_000,
      execution_protocol_version: desktopExecutionProtocolVersion,
    };
    // An old Mac/API ready frame (no tool negotiation) stays valid, and the
    // additive marker is optional.
    expect(desktopExecutionDeviceReadySchema.safeParse(ready).success).toBe(true);
    expect(desktopExecutionDeviceReadySchema.safeParse({
      ...ready, tool_protocol_version: desktopToolProtocolVersion,
      tool_operations: ["web.search", "computer.execute"],
    }).success).toBe(true);
    expect(desktopExecutionDeviceReadySchema.safeParse({
      ...ready, tool_protocol_version: desktopToolProtocolVersion,
      tool_operations: ["web.search", "computer.execute", "computer.wait"],
    }).success).toBe(true);
  });

  it("keeps legacy commands, results, and failures parsing exactly as before", () => {
    expect(desktopExecutionCommandSchema.parse({
      type: "command", id: requestId, owner_id: owner, conversation_id: conversation,
      runtime_generation: generation, turn_id: turn, operation: "turn.inspect", expires_at: expiresAt,
    })).toMatchObject({ operation: "turn.inspect" });
    expect(desktopExecutionResultSchema.parse({
      type: "command.result", id: requestId, operation: "turn.inspect", ok: true, result: null,
    })).toMatchObject({ operation: "turn.inspect", result: null });
    expect(desktopExecutionResultSchema.parse({
      type: "command.result", id: requestId, operation: "turn.interrupt", ok: false, error_code: "FORBIDDEN",
    })).toMatchObject({ ok: false, error_code: "FORBIDDEN" });
    expect(desktopToolRequestSchema.parse({
      type: "tool.request", id: requestId, conversation_id: conversation, runtime_generation: generation,
      turn_id: turn, expires_at: expiresAt, run_token: runToken,
      operation: "web.search", body: { query: "fixture" },
    })).toMatchObject({ operation: "web.search" });
  });
});
