import { z } from "zod";
import { uuidSchema } from "@linksense/shared";

const supersededStopHookSchema = z.object({
  method: z.literal("hook/completed"),
  params: z.object({
    run: z.object({ eventName: z.literal("stop"), status: z.literal("blocked") }),
    supersededItemId: z.string(),
  }),
  local: z.object({ superseded_item_id: z.string(), superseded_message_id: uuidSchema }),
});

export function indexStopHookSupersededAssistantMessageIds(
  rows: Array<{ turnId: string | null; payloadJson: unknown }>,
  planReviewTurnIds: ReadonlySet<string>,
): Set<string> {
  const messageIds = new Set<string>();
  for (const row of rows) {
    if (!row.turnId || !planReviewTurnIds.has(row.turnId)) continue;
    const parsed = supersededStopHookSchema.safeParse(row.payloadJson);
    if (parsed.success && parsed.data.params.supersededItemId === parsed.data.local.superseded_item_id) {
      messageIds.add(parsed.data.local.superseded_message_id);
    }
  }
  return messageIds;
}
