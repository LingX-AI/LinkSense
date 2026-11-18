import type { PrismaClient } from "../../generated/prisma/client.js";
import type { RedisDesktopDeviceCoordinator } from "../desktop-devices/coordinator.js";
import { isCurrentDeviceCredential } from "../desktop-devices/repository.js";
import type { DesktopRunAuthorizationPhase, DesktopRunScope } from "./run-leases.js";

type BoundDeviceCredential = { revokedAt: Date | null; deviceEpoch: Date; ownerEpoch: Date; ownerStatus: string };

export async function isDesktopRunActive(
  prisma: PrismaClient,
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
        AND d.id = ${scope.deviceId}::uuid
        AND (
          EXISTS (
            SELECT 1 FROM conversation_turn_start_intents i
            WHERE i.projection_turn_id = ${scope.turnId}::uuid AND i.conversation_id = c.id
              AND i.owner_id = c.owner_id AND i.runtime_generation = c.runtime_generation
              AND (i.runner_status = 'prepared' OR (${phase === "use"} AND i.runner_status = 'runner_succeeded'))
          )
          OR (${phase === "use"} AND EXISTS (
            SELECT 1 FROM conversation_turns t
            WHERE t.id = ${scope.turnId}::uuid AND t.conversation_id = c.id AND t.submitted_by = u.id
              AND t.status = 'running' AND t.interrupt_requested_at IS NULL AND t.completed_at IS NULL
          ))
        )`;
  return result !== undefined && isCurrentDeviceCredential(
    { revokedAt: result.revokedAt, authValidAfter: result.deviceEpoch },
    { status: result.ownerStatus, authValidAfter: result.ownerEpoch },
  ) && await coordinator.isCurrentConnection(scope.deviceId, scope.connectionId);
}
