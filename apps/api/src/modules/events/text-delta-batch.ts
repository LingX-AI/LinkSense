import type { RunnerTextDeltaEvent } from "@linksense/shared";

import { Prisma, type ConversationEvent } from "../../generated/prisma/client.js";
import { methodEventPayload } from "./method-event-payload.js";
import { nextConversationEventSequence } from "./sequence.js";

export type TextDeltaDelivery = { deliveryId: string; event: RunnerTextDeltaEvent };
type PendingEvent = Omit<ConversationEvent, "createdAt" | "payloadJson"> & { payloadJson: Prisma.JsonObject };

/** Only text events reach this repository; it performs no lifecycle mutations. */
export async function persistTextDeltaBatch(
  transaction: Prisma.TransactionClient,
  conversationId: string,
  turnId: string,
  entries: readonly TextDeltaDelivery[],
): Promise<ConversationEvent[]> {
  // Acquire the existing conversation-wide sequence lock before checking ids.
  // Concurrent HTTP retries then observe the first writer's committed records.
  let sequenceNo = await nextConversationEventSequence(transaction, conversationId);
  const unique = new Map<string, TextDeltaDelivery>();
  for (const entry of entries) {
    // PostgreSQL UUID identity is case-insensitive and returned in lowercase.
    const deliveryId = entry.deliveryId.toLowerCase();
    if (!unique.has(deliveryId)) unique.set(deliveryId, { ...entry, deliveryId });
  }
  const existing = await transaction.conversationEvent.findMany({
    where: { id: { in: [...unique.keys()] } },
  });
  const rows = new Map(existing.map(row => [row.id, row]));
  for (const entry of unique.values()) {
    const row = rows.get(entry.deliveryId);
    if (row && (row.conversationId !== conversationId || row.turnId !== turnId || row.eventType !== entry.event.method)) {
      throw new Error("runner event delivery id collision");
    }
  }
  const data: PendingEvent[] = [];
  for (const { deliveryId, event } of unique.values()) {
    if (rows.has(deliveryId)) continue;
    data.push({
      id: deliveryId, conversationId, turnId, sequenceNo,
      eventType: event.method,
      visibility: event.visibility,
      payloadJson: methodEventPayload(event.method, event.params) as Prisma.JsonObject,
      sseEventId: `${conversationId}:${sequenceNo}`,
    });
    sequenceNo += 1n;
  }
  if (data.length > 0) {
    // Bind one JSON parameter instead of translating every row through Prisma.
    // Keep the same transaction/constraints and return only database metadata.
    const encoded = JSON.stringify(data.map(row => ({
      id: row.id,
      sequence_no: row.sequenceNo.toString(),
      event_type: row.eventType,
      visibility: row.visibility,
      payload_json: row.payloadJson,
      sse_event_id: row.sseEventId,
    })));
    const created = await transaction.$queryRaw<Array<Pick<ConversationEvent, "id" | "createdAt">>>(Prisma.sql`
      INSERT INTO conversation_events
        (id, conversation_id, turn_id, sequence_no, event_type, visibility, payload_json, sse_event_id)
      SELECT x.id, ${conversationId}::uuid, ${turnId}::uuid,
        x.sequence_no, x.event_type, x.visibility, x.payload_json, x.sse_event_id
      FROM jsonb_to_recordset(${encoded}::jsonb)
      AS x(id uuid, sequence_no bigint, event_type text, visibility text, payload_json jsonb, sse_event_id text)
      RETURNING id, created_at AS "createdAt"
    `);
    const metadata = new Map(created.map(row => [row.id, row]));
    for (const row of data) {
      const stored = metadata.get(row.id);
      if (!stored) throw new Error("runner event batch did not persist every entry");
      rows.set(row.id, { ...row, createdAt: stored.createdAt });
    }
  }
  // INSERT RETURNING does not promise input order. Keep the original ids/order.
  return entries.map(entry => {
    const row = rows.get(entry.deliveryId.toLowerCase());
    if (!row) throw new Error("runner event batch did not persist every entry");
    return row;
  });
}
