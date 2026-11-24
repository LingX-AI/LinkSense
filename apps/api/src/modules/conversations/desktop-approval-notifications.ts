import { desktopApprovalNotificationSnapshotSchema } from "@linksense/shared";
import type { z } from "zod";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

type NotificationRow = {
  request_id: string;
  conversation_id: string;
  expires_at: Date;
};

export type DesktopApprovalNotificationFilter = Readonly<{
  conversationId?: string;
  requestId?: string;
}>;

export type DesktopApprovalNotificationSnapshot = z.infer<
  typeof desktopApprovalNotificationSnapshotSchema
>;

/**
 * The single parameterized read behind the notification read and its
 * white-box EXPLAIN. Callers must not append text to it.
 */
export function desktopApprovalNotificationsQuery(
  input: { ownerId: string; now: Date } & DesktopApprovalNotificationFilter,
): Prisma.Sql {
  const { ownerId, conversationId = null, requestId = null, now } = input;
  // The head is exactly the responder's `first` row: oldest non-expired
  // `pending`/`answering` request for the turn. Thread/turn validity, pending
  // status, and the exact-pair filter apply only after that head is chosen, so
  // a stale or answering head blocks the turn instead of exposing a newer row.
  return Prisma.sql`
    WITH running_turns AS MATERIALIZED (
      SELECT t.id, t.conversation_id, t.codex_thread_id, t.codex_turn_id, t.submitted_by
      FROM conversation_turns t
      WHERE t.submitted_by = ${ownerId}::uuid
        AND t.status = 'running'
        AND t.completed_at IS NULL
        AND t.interrupt_requested_at IS NULL
        AND (${conversationId}::uuid IS NULL OR t.conversation_id = ${conversationId}::uuid)
    ), eligible_turns AS MATERIALIZED (
      SELECT t.id AS turn_id, t.conversation_id, t.codex_thread_id, t.codex_turn_id
      FROM running_turns t
      JOIN conversations c ON c.id = t.conversation_id AND c.owner_id = t.submitted_by
      JOIN users u ON u.id = t.submitted_by
      JOIN desktop_devices d ON d.id = c.desktop_device_id AND d.owner_id = c.owner_id
      WHERE t.codex_thread_id = c.codex_thread_id
        AND c.archive_status = 'active'
        AND c.execution_target = 'local'
        AND d.platform = 'darwin'
        AND d.revoked_at IS NULL
        -- Pairing round-trips the account epoch through Prisma's millisecond
        -- JS Date, and the native responder compares getTime(), so compare at
        -- that same precision rather than exact microsecond storage values.
        AND date_trunc('milliseconds', d.auth_valid_after) =
          date_trunc('milliseconds', u.auth_valid_after)
        AND u.status = 'active'
    ), heads AS (
      SELECT DISTINCT ON (a.turn_id)
        a.id AS request_id, a.conversation_id, a.created_at, a.expires_at, a.status,
        a.codex_thread_id AS approval_thread_id, a.codex_turn_id AS approval_turn_id,
        et.codex_thread_id AS turn_thread_id, et.codex_turn_id AS turn_turn_id
      FROM conversation_desktop_approvals a
      JOIN eligible_turns et ON et.turn_id = a.turn_id AND et.conversation_id = a.conversation_id
      WHERE a.owner_id = ${ownerId}::uuid
        AND a.status IN ('pending', 'answering')
        AND a.expires_at > ${now}::timestamptz
      ORDER BY a.turn_id, a.native_request_id ASC
    )
    SELECT request_id, conversation_id, expires_at
    FROM heads
    WHERE status = 'pending'
      AND approval_thread_id = turn_thread_id
      AND approval_turn_id = turn_turn_id
      AND (${requestId}::uuid IS NULL OR request_id = ${requestId}::uuid)
    ORDER BY created_at ASC, request_id ASC
    LIMIT 100`;
}

/**
 * Point-in-time list of the native approval card that the existing responder
 * would currently accept for the owner's local Mac turns.
 *
 * This deliberately does not create delivery/audit rows, publish events,
 * consult Redis for a live device connection, or call the runner. The OS
 * notification it feeds cannot prove that the approval is still pending after
 * the response, or that the device connection is still live; a click must
 * rerun the same read with the exact conversation/request pair and the
 * existing responder still owns the decision.
 */
export async function readDesktopApprovalNotifications(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: { ownerId: string; now: Date } & DesktopApprovalNotificationFilter,
): Promise<DesktopApprovalNotificationSnapshot> {
  const rows = await prisma.$queryRaw<NotificationRow[]>(
    desktopApprovalNotificationsQuery(input),
  );
  return desktopApprovalNotificationSnapshotSchema.parse({
    items: rows.map(row => ({
      conversation_id: row.conversation_id,
      request_id: row.request_id,
      expires_at: row.expires_at.toISOString(),
    })),
  });
}
