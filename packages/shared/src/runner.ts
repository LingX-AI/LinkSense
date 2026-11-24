import { z } from "zod";

export const DOCKER_WORKER_CREATE_TIMEOUT_MS = 120_000;
export const DOCKER_ENGINE_REQUEST_TIMEOUT_MS = 15_000;
export const WORKER_HTTP_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_WORKER_READY_TIMEOUT_SECONDS = 60;
export const WORKER_CREATE_RECOVERY_WINDOW_MS = 10_000;
export const runnerRequestIdHeader = "x-linksense-request-id";

export function workerColdStartTimeoutMs(
  readyTimeoutSeconds: number,
  workerRequestTimeoutMs = WORKER_HTTP_REQUEST_TIMEOUT_MS,
): number {
  // Reserve part of the margin for Docker to make an ambiguous creation visible.
  return DOCKER_WORKER_CREATE_TIMEOUT_MS + DOCKER_ENGINE_REQUEST_TIMEOUT_MS
    + readyTimeoutSeconds * 1_000 + workerRequestTimeoutMs + 15_000;
}

/** Wake business projection after the native result is durably recorded. */
export const runnerStartSettledSchema = z.strictObject({
  conversationId: z.uuid(),
  projectionTurnId: z.uuid(),
  runtimeGeneration: z.uuid(),
});
export type RunnerStartSettled = z.infer<typeof runnerStartSettledSchema>;
export const runnerStartSettledReceiptSchema = z.strictObject({ settled: z.boolean() });

// v27 distinguishes executing existing automations from interactive schedule management.
export const RUNNER_TURN_START_CONTRACT_VERSION =
  "user-project-runtime-v27" as const;

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
