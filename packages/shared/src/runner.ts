import { z } from "zod";

export const RUNNER_TURN_START_CONTRACT_VERSION =
  "model-switch-source-compact-v15" as const;

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
