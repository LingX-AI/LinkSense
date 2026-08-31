import { createHash } from "node:crypto";

import {
  threadGoalSchema,
  type RunnerCodexGoal,
  type ThreadGoal,
} from "@linksense/shared";

import type { Prisma } from "../../generated/prisma/client.js";

export type ConversationGoalRow = {
  conversationId: string;
  ownerId: string;
  codexThreadId: string;
  activeTurnId: string | null;
  objective: string;
  status: string;
  tokenBudget: bigint | null;
  tokensUsed: bigint;
  timeUsedSeconds: bigint;
  nativeCreatedAt: Date;
  nativeUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export function goalResumeIdempotencyKey(
  input: Pick<
    ConversationGoalRow,
    | "conversationId"
    | "codexThreadId"
    | "nativeUpdatedAt"
    | "objective"
    | "tokenBudget"
  > & {
    priorityCapabilityIds: string[];
    knowledgeBaseIds: string[];
  },
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 1,
        conversation_id: input.conversationId,
        codex_thread_id: input.codexThreadId,
        native_updated_at: input.nativeUpdatedAt.toISOString(),
        objective: input.objective,
        token_budget: input.tokenBudget?.toString() ?? null,
        priority_capability_ids: input.priorityCapabilityIds,
        knowledge_base_ids: input.knowledgeBaseIds,
      }),
    )
    .digest("hex");
  return `goal-resume:${digest}`;
}

export function projectConversationGoal(row: ConversationGoalRow): ThreadGoal {
  return threadGoalSchema.parse({
    thread_id: row.codexThreadId,
    objective: row.objective,
    status: row.status,
    token_budget: row.tokenBudget === null ? null : Number(row.tokenBudget),
    tokens_used: Number(row.tokensUsed),
    time_used_seconds: Number(row.timeUsedSeconds),
    created_at: row.nativeCreatedAt.toISOString(),
    updated_at: row.nativeUpdatedAt.toISOString(),
  });
}

export async function upsertConversationGoal(
  tx: Prisma.TransactionClient,
  input: {
    conversationId: string;
    ownerId: string;
    goal: RunnerCodexGoal;
    activeTurnId?: string | null;
  },
): Promise<ConversationGoalRow> {
  const nativeCreatedAt = nativeTimestamp(input.goal.createdAt);
  const nativeUpdatedAt = nativeTimestamp(input.goal.updatedAt);
  const lockedGoals = await tx.$queryRaw<
    Array<{
      nativeUpdatedAt: Date;
      status: string;
      activeTurnId: string | null;
    }>
  >`
    SELECT
      native_updated_at AS "nativeUpdatedAt",
      status,
      active_turn_id AS "activeTurnId"
    FROM conversation_goals
    WHERE conversation_id = ${input.conversationId}::uuid
    FOR UPDATE
  `;
  const lockedGoal = lockedGoals[0];
  const lockedNativeUpdatedAt = lockedGoal?.nativeUpdatedAt;
  const lateSameTimestampActiveRevision =
    lockedGoal !== undefined &&
    lockedGoal.nativeUpdatedAt instanceof Date &&
    lockedGoal.nativeUpdatedAt.getTime() === nativeUpdatedAt.getTime() &&
    lockedGoal.status === "complete" &&
    input.goal.status !== "complete" &&
    (input.activeTurnId === undefined ||
      input.activeTurnId === lockedGoal.activeTurnId);
  if (
    (lockedNativeUpdatedAt instanceof Date &&
      lockedNativeUpdatedAt.getTime() > nativeUpdatedAt.getTime()) ||
    lateSameTimestampActiveRevision
  ) {
    const current = await tx.conversationGoal.findUnique({
      where: { conversationId: input.conversationId },
    });
    if (!current) throw new Error("locked conversation Goal disappeared");
    return current;
  }
  return tx.conversationGoal.upsert({
    where: { conversationId: input.conversationId },
    create: {
      conversationId: input.conversationId,
      ownerId: input.ownerId,
      codexThreadId: input.goal.threadId,
      activeTurnId: input.activeTurnId ?? null,
      objective: input.goal.objective,
      status: input.goal.status,
      tokenBudget:
        input.goal.tokenBudget === null
          ? null
          : BigInt(input.goal.tokenBudget),
      tokensUsed: BigInt(input.goal.tokensUsed),
      timeUsedSeconds: BigInt(input.goal.timeUsedSeconds),
      nativeCreatedAt,
      nativeUpdatedAt,
    },
    update: {
      ownerId: input.ownerId,
      codexThreadId: input.goal.threadId,
      ...(input.activeTurnId !== undefined
        ? { activeTurnId: input.activeTurnId }
        : {}),
      objective: input.goal.objective,
      status: input.goal.status,
      tokenBudget:
        input.goal.tokenBudget === null
          ? null
          : BigInt(input.goal.tokenBudget),
      tokensUsed: BigInt(input.goal.tokensUsed),
      timeUsedSeconds: BigInt(input.goal.timeUsedSeconds),
      nativeCreatedAt,
      nativeUpdatedAt,
    },
  });
}

function nativeTimestamp(seconds: number): Date {
  return new Date(seconds * 1_000);
}
