import {
  desktopRunTokenSchema,
  localComputerGrantLimit,
  localComputerGrantSchema,
  uuidSchema,
} from "@linksense/shared";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { DesktopDeviceCoordinator } from "../desktop-devices/coordinator.js";
import { lockDesktopConversation } from "../desktop-credentials/run-authority.js";
import { desktopRunScopeSchema, type DesktopRunLeases, type DesktopRunScope } from "../desktop-credentials/run-leases.js";
import { activeLocalComputerSession } from "./repository.js";

export type LocalComputerActionCapability = "computer.observe" | "computer.act";

export type LocalComputerActionAuthorization = {
  /** Canonical parsed run scope; occupancy derives its device key and holder binding from this. */
  scope: DesktopRunScope;
  sessionId: string;
  grantId: string;
  capability: LocalComputerActionCapability;
  bundleId: string;
  expiresAt: Date;
};

type Binding = {
  scope: DesktopRunScope;
  capability: LocalComputerActionCapability;
  bundleId: string;
};
type Authority = {
  leases: Pick<DesktopRunLeases, "fenceRunBinding">;
  connections: Pick<DesktopDeviceCoordinator, "isCurrentConnection">;
};
type GrantBinding = Pick<DesktopRunScope, "ownerId" | "deviceId" | "conversationId"> & {
  sessionId: string;
  /** Set by the dispatch recheck to require the original grant, not a newer one. */
  grantId?: string;
};

/**
 * Internal dispatch-time authorization for a local `computer.observe`/`computer.act` action.
 *
 * The caller supplies only the canonical scope, capability, bundle, and run bearer. Lease and
 * connection authority are read from the existing `DesktopRunLeases` and device coordinator, so a
 * stale closure cannot authorize a different run. The database fence is the same conversation/
 * device/account/generation lock used by the session and grant APIs. Expiry is read after that lock,
 * and the final lease/connection checks run while the lock is still held; both read Redis only, so
 * this path does not need a second database transaction or connection.
 *
 * This is a bounded authorization decision, not a lock across Mac input. The permit can expire while
 * the remaining reads and fences are awaited, so the returned expiry is rechecked after the final
 * awaited check. Dispatch must still enforce expiry and cancellation before each native input.
 *
 * A pre-lock `verifyRunBinding(scope, token, "use")` is intentionally not repeated: the locked read
 * below already checks the same device, account, generation, turn/start-intent, and thread liveness.
 *
 * Grants are application-scoped (`bundle_id`) only. This decision deliberately makes no claim
 * about a window, process, or UI element; the native layer pins the trusted window when it acts.
 *
 * The returned permit carries the parsed canonical run scope. Downstream holders such as GUI
 * occupancy derive their key and binding from that scope instead of accepting a second one.
 */
export async function authorizeLocalComputerAction(
  prisma: PrismaClient,
  authority: Authority,
  input: { scope: DesktopRunScope; capability: LocalComputerActionCapability; bundleId: string; runToken: string },
  now: () => Date = () => new Date(),
): Promise<LocalComputerActionAuthorization> {
  const scope = desktopRunScopeSchema.safeParse(input.scope);
  const target = localComputerGrantSchema.shape.target.safeParse({ bundle_id: input.bundleId });
  if (!scope.success || !target.success ||
      (input.capability !== "computer.observe" && input.capability !== "computer.act")) {
    throw new AppError("FORBIDDEN");
  }
  if (!desktopRunTokenSchema.safeParse(input.runToken).success) throw new AppError("AUTH_REQUIRED");
  const binding: Binding = { scope: scope.data, capability: input.capability, bundleId: target.data.bundle_id };
  const { ownerId, deviceId, conversationId, runtimeGeneration, turnId, connectionId } = binding.scope;
  return prisma.$transaction(async tx => {
    const { codexThreadId } = await lockDesktopConversation(tx, {
      ownerId, deviceId, conversationId, runtimeGeneration,
    });
    // Stop and revocation both take this conversation lock, so the expiry read is ordered against
    // them. Time can still cross the permit expiry during the reads and fences below; the final
    // check rejects that rather than claiming validity through commit.
    const at = now();
    if (await tx.applicationExternalSession.findFirst({ where: { conversationId }, select: { id: true } })) {
      throw new AppError("FORBIDDEN");
    }
    const collaborationMode = await readCollaborationMode(tx, {
      ownerId, conversationId, runtimeGeneration, turnId, codexThreadId,
    });
    // Plan turns are read-only: observe may proceed, act may not.
    if (binding.capability === "computer.act" && collaborationMode !== "default") throw new AppError("FORBIDDEN");
    const session = await activeLocalComputerSession(tx, {
      device: { ownerId, conversationId, deviceId }, runtimeGeneration,
    }, at);
    if (!session) throw new AppError("FORBIDDEN");
    const grant = await readGrant(tx, { ownerId, deviceId, conversationId, sessionId: session.id },
      binding.capability, binding.bundleId, at, session.expiresAt);
    // The run bearer must still fence this exact scope, and the device connection must still be the
    // one bound to the scope, while the database authority is locked. Both read Redis only.
    await authority.leases.fenceRunBinding(binding.scope, input.runToken);
    if (!await authority.connections.isCurrentConnection(deviceId, connectionId)) throw new AppError("FORBIDDEN");
    const expiresAt = new Date(Math.min(session.expiresAt.getTime(), grant.expiresAt.getTime()));
    // The permit can expire while the database reads and both Redis fences above are awaited. This
    // decision is bounded to the returned instant; dispatch must still enforce expiry and
    // cancellation before each native input.
    if (expiresAt.getTime() <= now().getTime()) throw new AppError("FORBIDDEN");
    return {
      scope: binding.scope,
      sessionId: session.id,
      grantId: grant.id,
      capability: binding.capability,
      bundleId: binding.bundleId,
      expiresAt,
    };
  });
}

export type LocalComputerDispatchAdmission = {
  scope: DesktopRunScope;
  sessionId: string;
  grantId: string;
  capability: LocalComputerActionCapability;
  bundleId: string;
  expiresAt: Date;
};

/**
 * Send-side recheck for one already queued computer command.
 *
 * The initial `authorizeLocalComputerAction` decision can be overtaken while
 * the command waits in encrypted Redis. This reuses the same conversation lock,
 * session/grant tables, capability, and application scope in real PostgreSQL,
 * and it requires the original session and grant IDs rather than the latest
 * active grant. A revoked/expired/stopped session, a revoked/expired original
 * grant, or a replacement grant therefore denies dispatch. It is a revocation
 * check, not a second permission plane: the run bearer and route authorization
 * remain the entry gate, and the existing transport/device checks still run.
 */
export async function verifyLocalComputerDispatch(
  prisma: PrismaClient,
  input: LocalComputerDispatchAdmission,
  now: () => Date = () => new Date(),
  finalize?: () => boolean | Promise<boolean>,
): Promise<void> {
  const scope = desktopRunScopeSchema.safeParse(input.scope);
  const target = localComputerGrantSchema.shape.target.safeParse({ bundle_id: input.bundleId });
  const sessionId = uuidSchema.safeParse(input.sessionId);
  const grantId = uuidSchema.safeParse(input.grantId);
  if (!scope.success || !target.success || !sessionId.success || !grantId.success ||
      (input.capability !== "computer.observe" && input.capability !== "computer.act") ||
      !(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime())) {
    throw new AppError("FORBIDDEN");
  }
  const { ownerId, deviceId, conversationId, runtimeGeneration, turnId } = scope.data;
  return prisma.$transaction(async tx => {
    const { codexThreadId } = await lockDesktopConversation(tx, {
      ownerId, deviceId, conversationId, runtimeGeneration,
    });
    const at = now();
    if (input.expiresAt.getTime() <= at.getTime()) throw new AppError("FORBIDDEN");
    if (await tx.applicationExternalSession.findFirst({ where: { conversationId }, select: { id: true } })) {
      throw new AppError("FORBIDDEN");
    }
    const collaborationMode = await readCollaborationMode(tx, {
      ownerId, conversationId, runtimeGeneration, turnId, codexThreadId,
    });
    // Plan turns stay read-only, matching the initial authorization decision.
    if (input.capability === "computer.act" && collaborationMode !== "default") throw new AppError("FORBIDDEN");
    const session = await tx.localComputerSession.findFirst({
      where: {
        id: sessionId.data, ownerId, deviceId, conversationId, runtimeGeneration,
        status: "active", grantScope: "session", endedAt: null, expiresAt: { gt: at },
      },
      select: { id: true, expiresAt: true },
    });
    if (!session?.expiresAt) throw new AppError("FORBIDDEN");
    await readGrant(tx, {
      ownerId, deviceId, conversationId, sessionId: session.id, grantId: grantId.data,
    }, input.capability, target.data.bundle_id, at, session.expiresAt);
    // The final selection/holder/run-binding/mayDispatch checks and the single
    // synchronous socket send run under the same conversation lock. A public
    // stop or revoke that needs this lock therefore cannot commit before the
    // send is invoked, and this transaction never waits for the native reply.
    if (finalize && !await finalize()) throw new AppError("FORBIDDEN");
  });
}

async function readCollaborationMode(
  tx: Prisma.TransactionClient,
  binding: Pick<DesktopRunScope, "ownerId" | "conversationId" | "runtimeGeneration" | "turnId"> & {
    codexThreadId: string | null;
  },
): Promise<"default" | "plan"> {
  // A materialized turn is authoritative: never fall back to a start intent when the turn exists but
  // is stopped, interrupted, foreign, or bound to another Codex thread.
  const turn = await tx.conversationTurn.findFirst({
    where: { id: binding.turnId, conversationId: binding.conversationId },
    select: {
      submittedBy: true, collaborationMode: true, codexThreadId: true,
      status: true, interruptRequestedAt: true, completedAt: true,
    },
  });
  if (turn) {
    if (turn.submittedBy !== binding.ownerId || turn.status !== "running" ||
        turn.interruptRequestedAt !== null || turn.completedAt !== null ||
        !binding.codexThreadId || turn.codexThreadId !== binding.codexThreadId) {
      throw new AppError("FORBIDDEN");
    }
    return parseCollaborationMode(turn.collaborationMode);
  }
  const start = await tx.conversationTurnStartIntent.findFirst({
    where: {
      projectionTurnId: binding.turnId, ownerId: binding.ownerId, conversationId: binding.conversationId,
      runtimeGeneration: binding.runtimeGeneration, runnerStatus: { in: ["prepared", "runner_succeeded"] },
    },
    select: { collaborationMode: true },
  });
  if (!start) throw new AppError("FORBIDDEN");
  return parseCollaborationMode(start.collaborationMode);
}

function parseCollaborationMode(value: string): "default" | "plan" {
  if (value === "default" || value === "plan") return value;
  throw new AppError("FORBIDDEN");
}

async function readGrant(
  tx: Prisma.TransactionClient, binding: GrantBinding,
  capability: LocalComputerActionCapability, bundleId: string, at: Date, sessionExpiresAt: Date,
): Promise<{ id: string; expiresAt: Date }> {
  const rows = await tx.computerPermissionGrant.findMany({
    where: {
      ownerId: binding.ownerId, deviceId: binding.deviceId, conversationId: binding.conversationId,
      sessionId: binding.sessionId, scope: "session", capability, revokedAt: null,
      ...(binding.grantId === undefined ? {} : { id: binding.grantId }),
      expiresAt: { gt: at, lte: sessionExpiresAt },
      targetJson: { path: ["bundle_id"], equals: bundleId },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: localComputerGrantLimit,
    select: { id: true, capability: true, scope: true, targetJson: true, expiresAt: true },
  });
  for (const row of rows) {
    if (!row.expiresAt) continue;
    const grant = localComputerGrantSchema.safeParse({
      id: row.id, capability: row.capability, scope: row.scope,
      target: row.targetJson, expires_at: row.expiresAt.toISOString(),
    });
    if (grant.success && grant.data.capability === capability && grant.data.target.bundle_id === bundleId) {
      return { id: grant.data.id, expiresAt: row.expiresAt };
    }
  }
  throw new AppError("FORBIDDEN");
}
