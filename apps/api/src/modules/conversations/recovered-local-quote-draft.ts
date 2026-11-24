import { conversationReferenceDisplaySchema } from "@linksense/shared";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";

import type { Prisma } from "../../generated/prisma/client.js";
import { nextConversationEventSequence } from "../events/sequence.js";

/**
 * Server-authoritative provenance for a draft recovered from a validated
 * conversation_reference display sidecar. Internal only: client and shared
 * event contracts do not know this kind.
 */
export const RECOVERED_LOCAL_QUOTE_DRAFT_EVENT_TYPE =
  "conversation.pending_request.recovered_local_quote";

/**
 * Deterministic closure id shared by the pre-admission Stop event and the
 * recovered-local-quote marker. Mac admission checks this id under the
 * conversation lock, so a settled key can never start another intent.
 */
export function desktopStartStopEventId(turnId: string): string {
  return uuidv5("desktop-start-stop", turnId);
}

/** Public block codes under which such a draft can remain blocked. */
const candidateBlockCodes = new Set([
  "desktop_device_revoked",
  "deployment_stopped",
]);

export function recoveredLocalQuoteCandidateIds(
  rows: readonly { id: string; status: string; blockCode: string | null }[],
): string[] {
  return rows
    .filter(
      (row) =>
        row.status === "blocked_preflight" &&
        row.blockCode !== null &&
        candidateBlockCodes.has(row.blockCode),
    )
    .map((row) => row.id);
}

/** The exact request the user typed, or null for any other display shape. */
export function recoveredLocalQuoteRequest(
  messageDisplayJson: unknown,
): string | null {
  const parsed =
    conversationReferenceDisplaySchema.safeParse(messageDisplayJson);
  return parsed.success ? parsed.data.request : null;
}

export async function recordRecoveredLocalQuoteDraft(
  tx: Prisma.TransactionClient,
  conversationId: string,
  projectionTurnId: string,
): Promise<void> {
  const sequenceNo = await nextConversationEventSequence(tx, conversationId);
  await tx.conversationEvent.create({
    data: {
      // Both settlement writers create the pending draft with the projection
      // turn id, so the marker doubles as the pre-admission Stop closure for
      // that turn and remains after the draft is restored or cancelled.
      id: desktopStartStopEventId(projectionTurnId),
      conversationId,
      turnId: null,
      sequenceNo,
      eventType: RECOVERED_LOCAL_QUOTE_DRAFT_EVENT_TYPE,
      visibility: "internal_sanitized",
      payloadJson: { schema_version: 1, pending_request_id: projectionTurnId },
      sseEventId: `${conversationId}:${sequenceNo}`,
    },
  });
}

type EventReader = Pick<Prisma.TransactionClient, "conversationEvent">;

/** One query for every candidate pending id; no per-row marker lookup. */
export async function recoveredLocalQuoteDraftIds(
  db: EventReader,
  conversationId: string,
  pendingIds: readonly string[],
): Promise<Set<string>> {
  if (pendingIds.length === 0) return new Set();
  const rows = await db.conversationEvent.findMany({
    where: {
      conversationId,
      eventType: RECOVERED_LOCAL_QUOTE_DRAFT_EVENT_TYPE,
      visibility: "internal_sanitized",
      OR: pendingIds.map((pendingRequestId) => ({
        payloadJson: {
          path: ["pending_request_id"],
          equals: pendingRequestId,
        },
      })),
    },
    select: { payloadJson: true },
  });
  const candidates = new Set(pendingIds);
  const matched = new Set<string>();
  for (const row of rows) {
    const parsed = z
      .object({ pending_request_id: z.uuid() })
      .safeParse(row.payloadJson);
    if (parsed.success && candidates.has(parsed.data.pending_request_id)) {
      matched.add(parsed.data.pending_request_id);
    }
  }
  return matched;
}
