import { z } from "zod";

export const RUNNER_TURN_START_CONTRACT_VERSION =
  "task-capability-snapshots-v19" as const;

/** Names are server-resolved display data; null means unavailable to this user. */
export const runnerKnowledgeBaseSelectionSchema = z
  .array(z.strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(160).nullable(),
  }))
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    { message: "knowledge_selection_is_duplicated" },
  );

export type RunnerKnowledgeBaseSelection = z.infer<
  typeof runnerKnowledgeBaseSelectionSchema
>;

export const RUNNER_TURN_INTERRUPT_REQUESTED =
  "TURN_INTERRUPT_REQUESTED" as const;
export const RUNNER_TURN_INTERRUPT_NOT_ACTIVE =
  "TURN_INTERRUPT_NOT_ACTIVE" as const;

export const runnerTurnInterruptResultSchema = z.strictObject({
  code: z.union([
    z.literal(RUNNER_TURN_INTERRUPT_REQUESTED),
    z.literal(RUNNER_TURN_INTERRUPT_NOT_ACTIVE),
  ]),
});

export type RunnerTurnInterruptResult = z.infer<
  typeof runnerTurnInterruptResultSchema
>;
