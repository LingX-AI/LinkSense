import { z } from "zod";

import { type ConversationEvent, type Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { KnowledgeCitationProjection } from "./knowledge-citations.js";
import { createProjectedAssistantMessage } from "./knowledge-message-projection.js";
import { nextConversationEventSequence } from "./sequence.js";

export type InterruptedMessageCompletionEvent = {
  event: ConversationEvent;
  payload: Record<string, unknown>;
};

type InterruptedAssistantOutput =
  | { existingCompletion: InterruptedMessageCompletionEvent }
  | { existingCompletion: null; itemId: string; projection: KnowledgeCitationProjection | null };

export async function loadInterruptedAssistantOutputs(
  db: Pick<PrismaClient, "conversationEvent">,
  conversationId: string,
  projectionTurnId: string,
  codexTurnId: string,
  project: (text: string) => Promise<KnowledgeCitationProjection>,
): Promise<InterruptedAssistantOutput[]> {
  const events = await db.conversationEvent.findMany({
    where: {
      conversationId,
      turnId: projectionTurnId,
      eventType: { in: ["item/agentMessage/delta", "item/completed", "conversation.message.completed"] },
    },
    orderBy: [{ sequenceNo: "asc" }, { id: "asc" }],
  });
  return Promise.all(collectInterruptedAssistantOutputs(events, codexTurnId).map(async output => {
    if (output.existingCompletion) return { existingCompletion: output.existingCompletion };
    const projection = await project(output.text);
    return {
      existingCompletion: null,
      itemId: output.itemId,
      projection: projection.contentText.trim().length > 0 ? projection : null,
    };
  }));
}

export async function persistInterruptedAssistantOutputs(
  tx: Prisma.TransactionClient,
  conversationId: string,
  turnId: string,
  outputs: InterruptedAssistantOutput[],
  now: Date,
): Promise<InterruptedMessageCompletionEvent[]> {
  const events: InterruptedMessageCompletionEvent[] = [];
  for (const output of outputs) {
    if (output.existingCompletion) {
      events.push(output.existingCompletion);
      continue;
    }
    if (!output.projection) continue;
    const message = await createProjectedAssistantMessage(tx, {
      conversationId, turnId, projection: output.projection, now,
    });
    const sequenceNo = await nextConversationEventSequence(tx, conversationId);
    const payload = { schema_version: 1, message_id: message.id, role: "assistant", item_id: output.itemId };
    const event = await tx.conversationEvent.create({
      data: {
        conversationId, turnId, sequenceNo, eventType: "conversation.message.completed",
        visibility: "user_visible", payloadJson: payload, sseEventId: `${conversationId}:${sequenceNo}`,
      },
    });
    events.push({ event, payload });
  }
  return events;
}

const MAX_INTERRUPTED_ASSISTANT_TEXT_CHARACTERS = 10_000_000;
const eventPayloadSchema = z.looseObject({
  source: z.string().optional(),
  method: z.string().optional(),
  params: z.looseObject({
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    delta: z.string().optional(),
    item: z.looseObject({ type: z.string(), id: z.string() }).optional(),
  }).optional(),
});
const completionSchema = z.looseObject({
  item_id: z.string().min(1), message_id: z.uuid(), role: z.literal("assistant"),
});

function collectInterruptedAssistantOutputs(
  events: ConversationEvent[],
  codexTurnId: string,
): Array<{ itemId: string; text: string; existingCompletion: InterruptedMessageCompletionEvent | null }> {
  const completedNativeItemIds = new Set<string>();
  const existingCompletionsByItemId = new Map<string, InterruptedMessageCompletionEvent>();
  const textByItemId = new Map<string, string>();
  for (const event of events) {
    if (event.eventType === "conversation.message.completed") {
      const payload = completionSchema.safeParse(event.payloadJson);
      if (payload.success) existingCompletionsByItemId.set(payload.data.item_id, { event, payload: payload.data });
      continue;
    }
    const parsed = eventPayloadSchema.safeParse(event.payloadJson);
    if (!parsed.success) continue;
    const { source, method, params } = parsed.data;
    if (source !== "codex_app_server" || method !== event.eventType || params?.turnId !== codexTurnId) continue;
    if (event.eventType === "item/completed") {
      if (params.item?.type === "agentMessage" && params.item.id) completedNativeItemIds.add(params.item.id);
      continue;
    }
    if (event.eventType !== "item/agentMessage/delta" || event.visibility === "internal_sanitized") continue;
    const { itemId, delta } = params;
    if (!itemId || !delta) continue;
    const current = textByItemId.get(itemId) ?? "";
    if (current.length >= MAX_INTERRUPTED_ASSISTANT_TEXT_CHARACTERS) continue;
    textByItemId.set(itemId, (current + delta).slice(0, MAX_INTERRUPTED_ASSISTANT_TEXT_CHARACTERS));
  }
  return [...textByItemId]
    .filter(([itemId, text]) => !completedNativeItemIds.has(itemId) && text.trim().length > 0)
    .map(([itemId, text]) => ({ itemId, text, existingCompletion: existingCompletionsByItemId.get(itemId) ?? null }));
}
