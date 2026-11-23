import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { RedisDesktopDeviceCoordinator } from "../desktop-devices/coordinator.js";
import { isCurrentDeviceCredential } from "../desktop-devices/repository.js";
import type { DesktopRunAuthorizationPhase, DesktopRunScope } from "./run-leases.js";

type BoundDeviceCredential = { revokedAt: Date | null; deviceEpoch: Date; ownerEpoch: Date; ownerStatus: string };
type DesktopConversationBinding = Pick<DesktopRunScope, "ownerId" | "deviceId" | "conversationId" | "runtimeGeneration">;
export type DesktopProjectionFence = {
  scope: DesktopConversationBinding & Pick<DesktopRunScope, "turnId">;
  check: () => Promise<void>;
  questions?: boolean;
  approvals?: boolean;
};

// Covers a Stop for a turn that still has only a start intent.
export async function lockDesktopArtifactPublication(tx: Prisma.TransactionClient, turnId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`desktop-artifact:${turnId.toLowerCase()}`}, 0))`;
}

type LockedDesktopConversationRow = BoundDeviceCredential & { codexThreadId: string | null };

/**
 * Shared exact row lock and binding predicates for one bound conversation.
 * Callers decide separately whether a live credential is required.
 */
async function lockDesktopConversationRow(
  tx: Prisma.TransactionClient,
  { ownerId, deviceId, conversationId, runtimeGeneration }: DesktopConversationBinding,
): Promise<LockedDesktopConversationRow | undefined> {
  const [row] = await tx.$queryRaw<LockedDesktopConversationRow[]>`
    SELECT d.revoked_at AS "revokedAt", d.auth_valid_after AS "deviceEpoch",
      u.auth_valid_after AS "ownerEpoch", u.status AS "ownerStatus", c.codex_thread_id AS "codexThreadId"
    FROM conversations c
    JOIN desktop_devices d ON d.id = c.desktop_device_id AND d.owner_id = c.owner_id
    JOIN users u ON u.id = c.owner_id
    WHERE c.id = ${conversationId}::uuid AND c.owner_id = ${ownerId}::uuid
      AND c.archive_status = 'active' AND c.execution_target = 'local'
      AND c.runtime_generation = ${runtimeGeneration}::uuid AND d.id = ${deviceId}::uuid AND d.platform = 'darwin'
    FOR NO KEY UPDATE OF c FOR SHARE OF d, u`;
  return row;
}

/** Hold the same device and account credential fence until the projection commits. */
export async function lockDesktopConversation(
  tx: Prisma.TransactionClient,
  binding: DesktopConversationBinding,
): Promise<{ codexThreadId: string | null; ownerEpoch: Date }> {
  const row = await lockDesktopConversationRow(tx, binding);
  if (!currentCredential(row)) throw new AppError("FORBIDDEN");
  return row;
}

/**
 * Cleanup-only lock for retiring one already-bound selection generation.
 *
 * A real device revocation retires the credential row before the socket close
 * releases selection metadata, so the live credential check above would refuse
 * the exact scope that must be cleaned and leave stale Redis state until
 * expiry. This entry point keeps the same row locks and owner/device/
 * conversation/runtime-generation/platform/execution/archive predicates, and
 * still throws FORBIDDEN when the binding is missing or has been rebound. It
 * intentionally skips only the live credential check because it must never
 * authorize an operation: its sole caller is selection retirement, which may
 * remove precisely scoped metadata and end that retired session.
 */
export async function lockDesktopConversationForRetirement(
  tx: Prisma.TransactionClient,
  binding: DesktopConversationBinding,
): Promise<void> {
  if (await lockDesktopConversationRow(tx, binding) === undefined) throw new AppError("FORBIDDEN");
}

export async function isDesktopRunActive(
  prisma: Pick<PrismaClient, "$queryRaw">,
  coordinator: Pick<RedisDesktopDeviceCoordinator, "isCurrentConnection">,
  scope: DesktopRunScope,
  phase: DesktopRunAuthorizationPhase,
): Promise<boolean> {
  const [result] = await prisma.$queryRaw<BoundDeviceCredential[]>`
    SELECT d.revoked_at AS "revokedAt", d.auth_valid_after AS "deviceEpoch",
      u.auth_valid_after AS "ownerEpoch", u.status AS "ownerStatus"
      FROM conversations c
      JOIN desktop_devices d ON d.id = c.desktop_device_id AND d.owner_id = c.owner_id
      JOIN users u ON u.id = c.owner_id
      WHERE c.id = ${scope.conversationId}::uuid AND c.owner_id = ${scope.ownerId}::uuid
        AND c.execution_target = 'local' AND c.archive_status = 'active'
        AND c.runtime_generation = ${scope.runtimeGeneration}::uuid
        AND d.id = ${scope.deviceId}::uuid AND d.platform = 'darwin'
        AND (
          (${phase !== "artifact"} AND EXISTS (
            SELECT 1 FROM conversation_turn_start_intents i
            WHERE i.projection_turn_id = ${scope.turnId}::uuid AND i.conversation_id = c.id
              AND i.owner_id = c.owner_id AND i.runtime_generation = c.runtime_generation
              AND (i.runner_status = 'prepared'
                OR (${phase === "use" || phase === "settle"} AND i.runner_status = 'runner_succeeded')
                OR (${phase === "settle"} AND i.runner_status = 'slot_pending'))
          ))
          OR (${phase === "use" || phase === "settle" || phase === "artifact"} AND EXISTS (
            SELECT 1 FROM conversation_turns t
            WHERE t.id = ${scope.turnId}::uuid AND t.conversation_id = c.id AND t.submitted_by = u.id
              AND t.codex_thread_id = c.codex_thread_id
              AND ((${phase === "use" || phase === "artifact"} AND t.status = 'running' AND t.interrupt_requested_at IS NULL AND t.completed_at IS NULL)
                OR (${phase === "settle"} AND t.status IN ('running', 'completed', 'failed', 'interrupted')))
          ))
        )`;
  return currentCredential(result) && await coordinator.isCurrentConnection(scope.deviceId, scope.connectionId);
}

function currentCredential<T extends BoundDeviceCredential>(row: T | undefined): row is T {
  return row !== undefined && isCurrentDeviceCredential(
    { revokedAt: row.revokedAt, authValidAfter: row.deviceEpoch },
    { status: row.ownerStatus, authValidAfter: row.ownerEpoch },
  );
}
