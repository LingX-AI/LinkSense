import { describe, expect, it } from "vitest";
import {
  desktopComputerControlResultSchema,
  desktopComputerControlSchema,
} from "./desktop-computer-control.js";
import { supportsDesktopUserInput } from "./desktop-execution.js";

const id = "10000000-0000-4000-8000-000000000008";
const conversation = "10000000-0000-4000-8000-000000000002";
const turn = "10000000-0000-4000-8000-000000000004";
const selection = "10000000-0000-4000-8000-000000000006";
const newSelection = "10000000-0000-4000-8000-000000000007";
const session = "10000000-0000-4000-8000-000000000005";
const generation = "10000000-0000-4000-8000-000000000003";
const bundle = "com.example.Fixture";

function frame(body: unknown) {
  return { type: "computer.control", id, body };
}

describe("M1b product computer.control wire contract", () => {
  it("accepts the exact select envelope and normalizes scoped server ids but preserves the correlation id", () => {
    const uppercaseId = "10000000-0000-4000-8000-00000000000A";
    expect(desktopComputerControlSchema.parse({
      type: "computer.control", id: uppercaseId,
      body: {
        action: "select", conversation_id: conversation.toUpperCase(), turn_id: turn,
        selection_id: selection.toUpperCase(), bundle_id: bundle,
      },
    })).toEqual({
      type: "computer.control", id: uppercaseId,
      body: { action: "select", conversation_id: conversation, turn_id: turn, selection_id: selection, bundle_id: bundle },
    });
  });

  it("accepts pause, stop, and an explicit fresh resume selection", () => {
    for (const body of [
      { action: "pause", conversation_id: conversation, turn_id: turn, selection_id: selection },
      { action: "stop", conversation_id: conversation, turn_id: turn, selection_id: selection },
      {
        action: "resume", conversation_id: conversation, turn_id: turn,
        selection_id: selection, new_selection_id: newSelection,
      },
    ]) {
      expect(desktopComputerControlSchema.parse(frame(body)).body.action).toBe(body.action);
    }
    expect(() => desktopComputerControlSchema.parse(frame({
      action: "resume", conversation_id: conversation, turn_id: turn,
      selection_id: selection, new_selection_id: selection,
    }))).toThrow();
  });

  it("rejects owner, connection, runtime, token, window, process, title, and path fields", () => {
    const base = { action: "select", conversation_id: conversation, turn_id: turn, selection_id: selection, bundle_id: bundle };
    for (const extra of [
      { owner_id: conversation }, { connection_id: conversation }, { runtime_generation: generation },
      { run_token: `lsdr_${"a".repeat(43)}` }, { internal_token: "secret" },
      { window_id: 1 }, { pid: 42 }, { title: "Window" }, { path: "/tmp/file" },
      { session_id: session }, { holder_id: newSelection }, { selection: {} },
    ]) {
      expect(desktopComputerControlSchema.safeParse({ ...frame(base), body: { ...base, ...extra } }).success).toBe(false);
    }
    for (const body of [
      { action: "select", conversation_id: conversation, turn_id: turn, selection_id: selection },
      { action: "select", conversation_id: conversation, turn_id: turn, selection_id: selection, bundle_id: "not a bundle" },
      { action: "pause", conversation_id: conversation, turn_id: turn },
      { action: "resume", conversation_id: conversation, turn_id: turn, selection_id: selection },
      { action: "resume", conversation_id: conversation, turn_id: turn, selection_id: selection, new_selection_id: "not-a-uuid" },
      { action: "explode", conversation_id: conversation, turn_id: turn, selection_id: selection },
    ]) {
      expect(desktopComputerControlSchema.safeParse(frame(body)).success).toBe(false);
    }
  });

  it("round-trips the exact success and bounded failure results", () => {
    expect(desktopComputerControlResultSchema.parse({
      type: "computer.control.result", id, ok: true,
      data: {
        state: "active", session_id: session, selection_id: selection,
        runtime_generation: generation, expires_at: "2026-11-21T12:05:00.000Z",
      },
    })).toMatchObject({ ok: true, data: { state: "active" } });
    expect(desktopComputerControlResultSchema.parse({
      type: "computer.control.result", id, ok: false, error_code: "COMPUTER_ACCESS_DENIED",
    })).toMatchObject({ ok: false });
    for (const result of [
      { type: "computer.control.result", id, ok: false, error_code: "NOT_A_CODE" },
      { type: "computer.control.result", id, ok: true, data: { state: "pausing" } },
      {
        type: "computer.control.result", id, ok: true,
        data: {
          state: "active", session_id: session, selection_id: selection,
          runtime_generation: generation, expires_at: "2026-11-21T12:05:00.000Z", owner_id: conversation,
        },
      },
    ]) {
      expect(desktopComputerControlResultSchema.safeParse(result).success).toBe(false);
    }
  });

  it("enables native question answers for a computer-only negotiation without changing other behavior", () => {
    const answer = { answers: [] } as never;
    expect(supportsDesktopUserInput(["computer.execute"], answer)).toBe(true);
    expect(supportsDesktopUserInput(["browser.execute"], answer)).toBe(true);
    expect(supportsDesktopUserInput(["web.search"], answer)).toBe(false);
    expect(supportsDesktopUserInput(["computer.execute"], { method: "item/commandExecution/requestApproval" } as never))
      .toBe(false);
    expect(supportsDesktopUserInput(["approval.respond"], { method: "item/commandExecution/requestApproval" } as never))
      .toBe(true);
  });
});
