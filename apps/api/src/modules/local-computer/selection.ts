import { localComputerSessionDurationMs, type LocalComputerPermissionInput } from "@linksense/shared";
import dayjs from "dayjs";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { lockDesktopConversation } from "../desktop-credentials/run-authority.js";
import {
  auditLocalComputerChange,
  endLocalComputerSessions,
  insertLocalComputerGrant,
  insertLocalComputerSession,
} from "./repository.js";

/**
 * Locked PostgreSQL authority for the M1b product selection path.
 *
 * Every product control transition resolves the conversation's current
 * runtime generation, then locks the same conversation/device/account row used
 * by the existing local-computer session and grant APIs. The Redis selection
 * CAS is performed by the caller while this lock is held, so the exact
 * conversation generation, materialized running turn, session, and grants are
 * still current when the selection metadata changes. No owner, connection,
 * generation, window, or path is accepted from the control frame itself.
 */
export type DesktopComputerSelectionScope = {
  ownerId: string;
  deviceId: string;
  conversationId: string;
  /** When present, the resolved conversation generation must still match it. */
  runtimeGeneration?: string;
};
export type DesktopComputerLockedScope = DesktopComputerSelectionScope & {
  runtimeGeneration: string;
  codexThreadId: string | null;
};

export async function withDesktopComputerLock<T>(
  prisma: PrismaClient,
  input: DesktopComputerSelectionScope,
  run: (tx: Prisma.TransactionClient, scope: DesktopComputerLockedScope) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async tx => {
    const conversation = await tx.conversation.findFirst({
      where: {
        id: input.conversationId, ownerId: input.ownerId,
        executionTarget: "local", archiveStatus: "active",
      },
      select: { desktopDeviceId: true, runtimeGeneration: true },
    });
    if (!conversation?.desktopDeviceId || conversation.desktopDeviceId !== input.deviceId ||
        (input.runtimeGeneration !== undefined && input.runtimeGeneration !== conversation.runtimeGeneration)) {
      throw new AppError("FORBIDDEN");
    }
    const locked = await lockDesktopConversation(tx, {
      ownerId: input.ownerId, deviceId: input.deviceId,
      conversationId: input.conversationId, runtimeGeneration: conversation.runtimeGeneration,
    });
    return run(tx, {
      ownerId: input.ownerId, deviceId: input.deviceId, conversationId: input.conversationId,
      runtimeGeneration: conversation.runtimeGeneration, codexThreadId: locked.codexThreadId,
    });
  });
}

/** A product selection is valid only for the exact materialized running local turn. */
export async function requireRunningDesktopComputerTurn(
  tx: Prisma.TransactionClient,
  scope: DesktopComputerLockedScope,
  turnId: string,
): Promise<void> {
  if (await tx.applicationExternalSession.findFirst({ where: { conversationId: scope.conversationId }, select: { id: true } })) {
    throw new AppError("FORBIDDEN");
  }
  const turn = await tx.conversationTurn.findFirst({
    where: { id: turnId, conversationId: scope.conversationId, submittedBy: scope.ownerId },
    select: {
      collaborationMode: true, codexThreadId: true, status: true,
      interruptRequestedAt: true, completedAt: true,
    },
  });
  if (!turn || turn.status !== "running" || turn.interruptRequestedAt !== null || turn.completedAt !== null ||
      !scope.codexThreadId || turn.codexThreadId !== scope.codexThreadId) {
    throw new AppError("FORBIDDEN");
  }
  // Plan remains read-only: observe may be granted, but the existing action
  // authorization still refuses every act in a non-default turn.
  if (turn.collaborationMode !== "default" && turn.collaborationMode !== "plan") throw new AppError("FORBIDDEN");
}

export async function prepareDesktopComputerSelection(
  tx: Prisma.TransactionClient,
  scope: DesktopComputerLockedScope,
  input: {
    sessionId: string;
    grantIds: readonly [string, string];
    bundleId: string;
    now: Date;
    expiresAt: Date;
  },
): Promise<{ endedSessionIds: string[] }> {
  const binding = {
    device: { ownerId: scope.ownerId, conversationId: scope.conversationId, deviceId: scope.deviceId },
    runtimeGeneration: scope.runtimeGeneration,
  };
  // The later session replaces older grants for this conversation. The Redis
  // CAS also proves the replaced selection session is in this ended set.
  const endedSessionIds = await endLocalComputerSessions(tx, binding.device, input.now);
  if (!await insertLocalComputerSession(tx, binding, input.sessionId, input.now, input.expiresAt)) {
    throw new AppError("CONFLICT");
  }
  for (const [index, capability] of (["computer.observe", "computer.act"] as const).entries()) {
    const grant = {
      action: "grant" as const,
      session_id: input.sessionId,
      grant_id: input.grantIds[index]!,
      capability,
      target: { bundle_id: input.bundleId },
    } satisfies LocalComputerPermissionInput;
    if (!await insertLocalComputerGrant(
      tx,
      { ...binding.device, sessionId: input.sessionId, id: grant.grant_id },
      grant, input.now, input.expiresAt,
    )) {
      throw new AppError("CONFLICT");
    }
    await auditLocalComputerChange(tx, scope.ownerId, "computer_permission_granted", grant.grant_id);
  }
  await auditLocalComputerChange(tx, scope.ownerId, "computer_session_started", input.sessionId);
  return { endedSessionIds };
}

/** Proves the exact prepared session and, for resume, both application grants are still live. */
export async function readActiveDesktopComputerSession(
  tx: Prisma.TransactionClient,
  scope: DesktopComputerLockedScope,
  input: { sessionId: string; bundleId: string; requireGrants: boolean; now: Date },
): Promise<{ expiresAt: Date }> {
  const session = await tx.localComputerSession.findFirst({
    where: {
      id: input.sessionId, ownerId: scope.ownerId, deviceId: scope.deviceId,
      conversationId: scope.conversationId, runtimeGeneration: scope.runtimeGeneration,
      status: "active", grantScope: "session", endedAt: null, expiresAt: { gt: input.now },
    },
    select: { expiresAt: true },
  });
  if (!session?.expiresAt) throw new AppError("FORBIDDEN");
  if (!input.requireGrants) return { expiresAt: session.expiresAt };
  const grants = await tx.computerPermissionGrant.findMany({
    where: {
      ownerId: scope.ownerId, deviceId: scope.deviceId, conversationId: scope.conversationId,
      sessionId: input.sessionId, scope: "session", revokedAt: null,
      capability: { in: ["computer.observe", "computer.act"] },
      expiresAt: { gt: input.now, lte: session.expiresAt },
      targetJson: { path: ["bundle_id"], equals: input.bundleId },
    },
    select: { capability: true, expiresAt: true },
  });
  const capabilities = new Set(grants.map(grant => grant.capability));
  if (!capabilities.has("computer.observe") || !capabilities.has("computer.act")) {
    throw new AppError("FORBIDDEN");
  }
  const earliest = grants.reduce(
    (expiry, grant) => grant.expiresAt && grant.expiresAt < expiry ? grant.expiresAt : expiry,
    session.expiresAt,
  );
  return { expiresAt: earliest };
}

/** Explicit renewal: extends the exact live session and both application grants. */
export async function extendDesktopComputerSelection(
  tx: Prisma.TransactionClient,
  scope: DesktopComputerLockedScope,
  input: { sessionId: string; now: Date; expiresAt: Date },
): Promise<void> {
  const session = await tx.localComputerSession.findFirst({
    where: {
      id: input.sessionId, ownerId: scope.ownerId, deviceId: scope.deviceId,
      conversationId: scope.conversationId, runtimeGeneration: scope.runtimeGeneration,
      status: "active", grantScope: "session", endedAt: null, expiresAt: { gt: input.now },
    },
    select: { id: true },
  });
  if (!session) throw new AppError("FORBIDDEN");
  const grants = await tx.computerPermissionGrant.findMany({
    where: {
      ownerId: scope.ownerId, deviceId: scope.deviceId, conversationId: scope.conversationId,
      sessionId: input.sessionId, scope: "session", revokedAt: null,
      capability: { in: ["computer.observe", "computer.act"] },
      expiresAt: { gt: input.now },
    },
    select: { id: true, capability: true },
  });
  if (!grants.some(grant => grant.capability === "computer.observe") ||
      !grants.some(grant => grant.capability === "computer.act")) {
    throw new AppError("FORBIDDEN");
  }
  await tx.localComputerSession.update({
    where: { id: input.sessionId }, data: { expiresAt: input.expiresAt },
  });
  await tx.computerPermissionGrant.updateMany({
    where: { id: { in: grants.map(grant => grant.id) } },
    data: { expiresAt: input.expiresAt },
  });
}

/** Ends exactly the selected session and its grants; newer sessions are untouched. */
export async function endDesktopComputerSession(
  tx: Prisma.TransactionClient,
  scope: DesktopComputerLockedScope,
  input: { sessionId: string; now: Date },
): Promise<{ ended: boolean }> {
  const session = await tx.localComputerSession.findFirst({
    where: {
      id: input.sessionId, ownerId: scope.ownerId, deviceId: scope.deviceId,
      conversationId: scope.conversationId, runtimeGeneration: scope.runtimeGeneration,
    },
    select: { id: true, endedAt: true },
  });
  if (!session) throw new AppError("FORBIDDEN");
  if (session.endedAt) return { ended: false };
  const ended = await endLocalComputerSessions(tx, {
    ownerId: scope.ownerId, conversationId: scope.conversationId,
    deviceId: scope.deviceId, id: session.id,
  }, input.now);
  if (ended.length) await auditLocalComputerChange(tx, scope.ownerId, "computer_session_stopped", session.id);
  return { ended: ended.length === 1 };
}

export function desktopComputerSelectionExpiry(now: Date): Date {
  return dayjs(now).add(localComputerSessionDurationMs, "millisecond").toDate();
}
