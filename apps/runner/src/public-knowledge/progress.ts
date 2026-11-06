import { createHash } from "node:crypto";
import { z } from "zod";
import {
  publicKnowledgeRunnerProgressSchema,
  limitPublicKnowledgeOutput,
} from "@linksense/shared";
import { mapCodexNotification } from "../codex/event-mapper.js";

export type PublicKnowledgeProgress = z.infer<
  typeof publicKnowledgeRunnerProgressSchema
>;

/** Reuse the native mapper, then narrow/redact the anonymous display boundary. */
export function projectPublicKnowledgeProgress(
  raw: unknown,
  context: {
    conversationId: string;
    operationId: string;
    workspace: string;
    codexHome: string;
  },
): PublicKnowledgeProgress[] {
  const parsed = z
    .object({ method: z.string(), params: z.record(z.string(), z.unknown()) })
    .safeParse(raw);
  if (!parsed.success) return [];
  const itemId = (id: string) =>
    `public-${createHash("sha256").update(`${context.conversationId}:${context.operationId}:${id}`).digest("hex")}`;
  return mapCodexNotification(parsed.data, context).flatMap((event) => {
    let notification: unknown;
    if (event.method === "turn/started" || event.method === "turn/completed") {
      notification = {
        ...event,
        params: {
          threadId: context.conversationId,
          turn: { ...event.params.turn, id: context.operationId, error: null },
        },
      };
    } else if (
      event.method === "item/started" ||
      event.method === "item/completed"
    ) {
      const item = event.params.item;
      notification = {
        ...event,
        params: {
          ...event.params,
          threadId: context.conversationId,
          turnId: context.operationId,
          item: {
            ...item,
            id: itemId(item.id),
            ...(item.type === "reasoning" ? { content: undefined } : {}),
            ...(item.type === "agentMessage"
              ? { text: limitPublicKnowledgeOutput(item.text) }
              : {}),
          },
        },
      };
    } else if (
      event.method === "item/agentMessage/delta" ||
      event.method === "item/reasoning/summaryTextDelta" ||
      event.method === "item/reasoning/summaryPartAdded"
    ) {
      notification = {
        ...event,
        params: {
          ...event.params,
          threadId: context.conversationId,
          turnId: context.operationId,
          itemId: itemId(event.params.itemId),
          ...(event.method === "item/agentMessage/delta"
            ? { delta: limitPublicKnowledgeOutput(event.params.delta) }
            : {}),
        },
      };
    } else return [];
    const result = publicKnowledgeRunnerProgressSchema.safeParse({
      method: "linksense/publicKnowledge/progress",
      visibility: event.visibility,
      params: {
        threadId: context.conversationId,
        turnId: context.operationId,
        notification,
      },
    });
    return result.success ? [result.data] : [];
  });
}
