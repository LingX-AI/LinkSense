import { describe, expect, it, vi } from "vitest";

const ownerId = "10000000-0000-4000-8000-000000000001";
const deviceId = "10000000-0000-4000-8000-000000000002";
const connectionId = "10000000-0000-4000-8000-000000000003";
const conversationId = "10000000-0000-4000-8000-000000000004";
const turnId = "10000000-0000-4000-8000-000000000005";
const runtimeGeneration = "10000000-0000-4000-8000-000000000006";
const sessionId = "10000000-0000-4000-8000-000000000007";
const observeGrantId = "10000000-0000-4000-8000-000000000008";
const actGrantId = "10000000-0000-4000-8000-000000000009";
const codexThreadId = "10000000-0000-4000-8000-00000000000a";
const bundleId = "com.example.Fixture";
const now = new Date("2026-01-01T00:00:00.000Z");
const credentialEpoch = new Date("2025-12-01T00:00:00.000Z");
const sessionExpiresAt = new Date(now.getTime() + 5 * 60_000);
const grantExpiresAt = new Date(now.getTime() + 2 * 60_000);
const runToken = `lsdr_${"a".repeat(43)}`;

import {
  authorizeLocalComputerAction,
  verifyLocalComputerDispatch,
  type LocalComputerActionKind,
} from "../src/modules/local-computer/authorization.js";
import type { DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";

const scope: DesktopRunScope = {
  ownerId, deviceId, connectionId, conversationId, turnId, runtimeGeneration,
};

function fixture(mode: "default" | "plan") {
  const grants = [
    { id: observeGrantId, capability: "computer.observe" },
    { id: actGrantId, capability: "computer.act" },
  ];
  const tx = {
    $queryRaw: vi.fn(async () => [{
      revokedAt: null, deviceEpoch: credentialEpoch, ownerEpoch: credentialEpoch,
      ownerStatus: "active", codexThreadId,
    }]),
    applicationExternalSession: { findFirst: vi.fn(async () => null) },
    conversationTurn: { findFirst: vi.fn(async () => ({
      submittedBy: ownerId, collaborationMode: mode, codexThreadId,
      status: "running", interruptRequestedAt: null, completedAt: null,
    })) },
    conversationTurnStartIntent: { findFirst: vi.fn(async () => null) },
    localComputerSession: { findFirst: vi.fn(async () => ({ id: sessionId, expiresAt: sessionExpiresAt })) },
    computerPermissionGrant: { findMany: vi.fn(async input => {
      const capability = input.where.capability;
      return grants.filter(grant => grant.capability === capability).map(grant => ({
        ...grant, scope: "session", targetJson: { bundle_id: bundleId },
        expiresAt: grantExpiresAt,
      }));
    }) },
  };
  const prisma = {
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const authority = {
    leases: { fenceRunBinding: vi.fn(async () => {}) },
    connections: { isCurrentConnection: vi.fn(async () => true) },
  };
  return { prisma, authority, tx, setMode: (next: "default" | "plan") => {
    tx.conversationTurn.findFirst.mockResolvedValue({
      submittedBy: ownerId, collaborationMode: next, codexThreadId,
      status: "running", interruptRequestedAt: null, completedAt: null,
    });
  } };
}

describe("local computer Plan admission", () => {
  it("permits status and observe but denies wait and act in Plan at the authoritative authorization", async () => {
    const state = fixture("plan");
    const authorize = (capability: "computer.observe" | "computer.act", requestKind: LocalComputerActionKind) =>
      authorizeLocalComputerAction(state.prisma as never, state.authority, {
        scope, capability, bundleId, runToken, requestKind,
      }, () => now);

    await expect(authorize("computer.observe", "status")).resolves.toMatchObject({
      scope, sessionId, capability: "computer.observe", bundleId,
    });
    await expect(authorize("computer.observe", "observe")).resolves.toMatchObject({
      capability: "computer.observe", grantId: observeGrantId,
    });
    await expect(authorize("computer.observe", "wait")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorize("computer.act", "act")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows wait in default mode and denies the final wait publication after Plan becomes authoritative", async () => {
    const state = fixture("default");
    const permit = await authorizeLocalComputerAction(state.prisma as never, state.authority, {
      scope, capability: "computer.observe", bundleId, runToken, requestKind: "wait",
    }, () => now);
    expect(permit).toMatchObject({ grantId: observeGrantId, capability: "computer.observe" });

    await expect(verifyLocalComputerDispatch(
      state.prisma as never,
      { ...permit, requestKind: "wait" },
      () => now,
    )).resolves.toBeUndefined();

    state.setMode("plan");
    await expect(verifyLocalComputerDispatch(
      state.prisma as never,
      { ...permit, requestKind: "wait" },
      () => now,
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(verifyLocalComputerDispatch(
      state.prisma as never,
      { ...permit, requestKind: "observe" },
      () => now,
    )).resolves.toBeUndefined();
    await expect(verifyLocalComputerDispatch(
      state.prisma as never,
      { ...permit, requestKind: "status" },
      () => now,
    )).resolves.toBeUndefined();
  });
});
