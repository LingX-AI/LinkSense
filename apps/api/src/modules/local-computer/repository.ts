import {
  localComputerGrantLimit,
  localComputerGrantSchema,
  type auditActionCodes,
  type LocalComputerGrant,
  type LocalComputerPermissionInput,
  type LocalComputerStatus,
} from "@linksense/shared";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuthUser } from "../../plugins/authentication.js";
import { lockDesktopConversation } from "../desktop-credentials/run-authority.js";

export type LocalComputerActor = Pick<AuthUser, "id" | "authValidAfter">;
type ConversationScope = { ownerId: string; conversationId: string };
type DeviceScope = ConversationScope & { deviceId: string };
type LocalComputerBinding = { device: DeviceScope; runtimeGeneration: string };
type SessionKey = DeviceScope & { id: string };
type SessionGrantKey = DeviceScope & { sessionId: string; id: string };

export async function withLocalComputerScope<T>(
  prisma: PrismaClient,
  actor: LocalComputerActor,
  conversationId: string,
  run: (tx: Prisma.TransactionClient, binding: LocalComputerBinding) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async tx => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId: actor.id, executionTarget: "local", archiveStatus: "active" },
      select: { desktopDeviceId: true, runtimeGeneration: true },
    });
    if (!conversation?.desktopDeviceId) throw new AppError("FORBIDDEN");
    const device = { ownerId: actor.id, conversationId, deviceId: conversation.desktopDeviceId };
    const { runtimeGeneration } = conversation;
    const { ownerEpoch } = await lockDesktopConversation(tx, { ...device, runtimeGeneration });
    if (ownerEpoch.getTime() !== actor.authValidAfter.getTime()) throw new AppError("AUTH_SESSION_EXPIRED");
    return run(tx, { device, runtimeGeneration });
  });
}

export async function activeLocalComputerSession(
  tx: Prisma.TransactionClient, { device, runtimeGeneration }: LocalComputerBinding, now: Date,
): Promise<{ id: string; expiresAt: Date } | null> {
  const session = await tx.localComputerSession.findFirst({
    where: { ...device, runtimeGeneration, status: "active", grantScope: "session", endedAt: null, expiresAt: { gt: now } },
    select: { id: true, expiresAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return session?.expiresAt ? { id: session.id, expiresAt: session.expiresAt } : null;
}

export async function readLocalComputerStatus(
  tx: Prisma.TransactionClient, binding: LocalComputerBinding, now: Date,
): Promise<LocalComputerStatus> {
  const { device } = binding;
  const session = await activeLocalComputerSession(tx, binding, now);
  if (!session) return { device_id: device.deviceId, session: null, grants: [] };
  const entries = await tx.computerPermissionGrant.findMany({
    where: {
      ...device, sessionId: session.id, scope: "session", revokedAt: null,
      expiresAt: { gt: now, lte: session.expiresAt },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: localComputerGrantLimit,
  });
  const grants: LocalComputerGrant[] = [];
  for (const row of entries) {
    const grant = localComputerGrantSchema.safeParse({
      id: row.id, capability: row.capability, scope: row.scope, target: row.targetJson,
      expires_at: row.expiresAt?.toISOString(),
    });
    if (grant.success) grants.push(grant.data);
  }
  return { device_id: device.deviceId, session: { id: session.id, expires_at: session.expiresAt.toISOString() }, grants };
}

export async function insertLocalComputerSession(
  tx: Prisma.TransactionClient, binding: LocalComputerBinding, id: string, createdAt: Date, expiresAt: Date,
): Promise<boolean> {
  const { count } = await tx.localComputerSession.createMany({
    data: [{
      ...binding.device, runtimeGeneration: binding.runtimeGeneration, id,
      status: "active", grantScope: "session", createdAt, expiresAt,
    }],
    skipDuplicates: true,
  });
  return count === 1;
}

export async function localComputerSessionExists(tx: Prisma.TransactionClient, key: SessionKey): Promise<boolean> {
  return !!await tx.localComputerSession.findFirst({ where: key, select: { id: true } });
}

export async function insertLocalComputerGrant(
  tx: Prisma.TransactionClient, key: SessionGrantKey,
  input: Extract<LocalComputerPermissionInput, { action: "grant" }>, createdAt: Date, expiresAt: Date,
): Promise<boolean> {
  const { count } = await tx.computerPermissionGrant.createMany({
    data: [{ ...key, scope: "session", capability: input.capability, targetJson: input.target, createdAt, expiresAt }],
    skipDuplicates: true,
  });
  return count === 1;
}

export async function revokeLocalComputerGrant(
  tx: Prisma.TransactionClient, key: SessionGrantKey, now: Date,
): Promise<"revoked" | "already_revoked" | "missing"> {
  const where = { ...key, scope: "session" };
  const { count } = await tx.computerPermissionGrant.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: now },
  });
  if (count) return "revoked";
  return await tx.computerPermissionGrant.findFirst({ where, select: { id: true } }) ? "already_revoked" : "missing";
}

/** The caller holds the conversation lock. */
export async function endLocalComputerSessions(
  tx: Prisma.TransactionClient, { id, ...scope }: ConversationScope & { deviceId?: string; id?: string }, now: Date,
): Promise<string[]> {
  const ended = await tx.localComputerSession.updateManyAndReturn({
    where: { ...scope, ...(id ? { id } : {}), endedAt: null },
    data: { status: "ended", endedAt: now },
    select: { id: true },
  });
  const ids = ended.map(row => row.id);
  if (ids.length) await tx.computerPermissionGrant.updateMany({
    where: { ...scope, sessionId: { in: ids }, revokedAt: null },
    data: { revokedAt: now },
  });
  return ids;
}

type AuditAction = Extract<(typeof auditActionCodes)[number], `computer_session_${string}` | `computer_permission_${string}`>;
export async function auditLocalComputerChange(
  tx: Prisma.TransactionClient, actorId: string, action: AuditAction, targetId: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId, action, targetId,
      targetType: action.startsWith("computer_session_") ? "local_computer_session" : "computer_permission_grant",
      result: "success", metadataJson: {},
    },
  });
}
