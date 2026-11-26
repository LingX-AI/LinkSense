import { describe, expect, it } from "vitest";
import { conversationCreateInputSchema } from "./conversations.js";
import {
  desktopRuntimeControlInputSchema, desktopRuntimeControlOutputSchema,
} from "./desktop-execution.js";
import { conversationExecutionSelectionSchema } from "./desktop-protocol.js";

const device = "10000000-0000-4000-8000-000000000009";

describe("conversation execution selections", () => {
  it("defaults pre-desktop requests to cloud and retains the same refinement in create requests", () => {
    expect(conversationExecutionSelectionSchema.parse({})).toEqual({ execution_target: "cloud", desktop_device_id: null });
    expect(conversationCreateInputSchema.parse({})).toEqual({
      collaboration_mode: "default", execution_target: "cloud", desktop_device_id: null,
      desktop_tools_enabled: false,
    });
    expect(conversationCreateInputSchema.parse({ execution_target: "local", desktop_device_id: device }))
      .toMatchObject({ execution_target: "local", desktop_device_id: device });
  });

  it.each([
    { execution_target: "local" }, { execution_target: "cloud", desktop_device_id: device },
    { execution_target: "local", desktop_device_id: null }, { execution_target: "hybrid" },
  ])("rejects an inconsistent or unknown target: %j", input => {
    expect(conversationExecutionSelectionSchema.safeParse(input).success).toBe(false);
    expect(conversationCreateInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("desktop workspace control", () => {
  const owner = "10000000-0000-4000-8000-000000000001";
  const request = "10000000-0000-4000-8000-000000000002";

  it("accepts only scoped usage and cleanup requests", () => {
    expect(desktopRuntimeControlInputSchema.parse({ type: "workspace.usage", request_id: request, owner_id: owner }))
      .toEqual({ type: "workspace.usage", request_id: request, owner_id: owner });
    expect(desktopRuntimeControlInputSchema.parse({ type: "workspace.cleanup", request_id: request, owner_id: owner }))
      .toMatchObject({ type: "workspace.cleanup" });
    // Cancellation is bound to one request id and names no account.
    expect(desktopRuntimeControlInputSchema.parse({ type: "workspace.cancel", request_id: request }))
      .toEqual({ type: "workspace.cancel", request_id: request });
    for (const input of [
      { type: "workspace.usage", request_id: request },
      { type: "workspace.cleanup", request_id: request, owner_id: "not-a-uuid" },
      { type: "workspace.cleanup", request_id: request, owner_id: owner, path: "/tmp" },
      { type: "workspace.cancel", request_id: request, owner_id: owner },
      { type: "workspace.cancel" },
      { type: "workspace.delete", request_id: request, owner_id: owner },
    ]) expect(desktopRuntimeControlInputSchema.safeParse(input).success).toBe(false);
  });

  it("round-trips aggregate results and rejects paths or unknown fields", () => {
    const usage = {
      type: "workspace.usage.result", request_id: request, ok: true,
      usage: { bytes: 1, files: 2, sessions: 3, retention_days: 14, budget_bytes: 10 * 1024 * 1024 * 1024 },
    } as const;
    expect(desktopRuntimeControlOutputSchema.parse(usage)).toEqual(usage);
    expect(desktopRuntimeControlOutputSchema.parse({
      type: "workspace.cleanup.result", request_id: request, ok: true,
      cleanup: { status: "busy", deleted_sessions: 0, freed_bytes: 0, retained_bytes: 0 },
    })).toMatchObject({ ok: true, cleanup: { status: "busy" } });
    for (const output of [
      { ...usage, usage: { ...usage.usage, path: "/tmp/workspace" } },
      { ...usage, usage: { ...usage.usage, bytes: -1 } },
      { type: "workspace.usage.result", request_id: request, ok: false, error_code: "DESKTOP_WORKSPACE_CLEANUP_FAILED" },
      { type: "workspace.cleanup.result", request_id: request, ok: false, error_code: "FORBIDDEN" },
    ]) expect(desktopRuntimeControlOutputSchema.safeParse(output).success).toBe(false);
  });

  it("accepts only request-id-bound update admission controls without an account", () => {
    for (const type of ["update.acquire", "update.release"] as const) {
      expect(desktopRuntimeControlInputSchema.parse({ type, request_id: request })).toEqual({ type, request_id: request });
      expect(desktopRuntimeControlInputSchema.safeParse({ type, request_id: request, owner_id: owner }).success).toBe(false);
      expect(desktopRuntimeControlInputSchema.safeParse({ type }).success).toBe(false);
    }
  });

  it("round-trips update admission results and rejects ambiguous errors", () => {
    expect(desktopRuntimeControlOutputSchema.parse({
      type: "update.acquire.result", request_id: request, ok: true,
    })).toEqual({ type: "update.acquire.result", request_id: request, ok: true });
    for (const error_code of ["DESKTOP_UPDATE_BUSY", "DESKTOP_RUNTIME_UNAVAILABLE"] as const) {
      expect(desktopRuntimeControlOutputSchema.parse({
        type: "update.acquire.result", request_id: request, ok: false, error_code,
      })).toEqual({ type: "update.acquire.result", request_id: request, ok: false, error_code });
    }
    for (const output of [
      { type: "update.acquire.result", request_id: request, ok: true, error_code: "DESKTOP_UPDATE_BUSY" },
      { type: "update.acquire.result", request_id: request, ok: false, error_code: "FORBIDDEN" },
      { type: "update.acquire.result", request_id: request, ok: false },
      { type: "update.release.result", request_id: request, ok: true },
      { type: "update.acquire.result", request_id: request, ok: true, path: "/Applications" },
    ]) expect(desktopRuntimeControlOutputSchema.safeParse(output).success).toBe(false);
  });
});
