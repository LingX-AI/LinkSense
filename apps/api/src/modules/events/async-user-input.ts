import { isDeepStrictEqual } from "node:util";
import {
  codexAsyncUserInputQuestionsSchema,
  projectAsyncUserInputQuestions,
} from "@linksense/shared";
import type {
  ConversationUserInputRequest,
  Prisma,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export async function upsertAsyncUserInputRequest(
  tx: Prisma.TransactionClient,
  conversationId: string,
  turn: {
    id: string;
    submittedBy: string;
    codexThreadId: string;
    codexTurnId: string;
  },
  item: { id: string; questions: unknown },
): Promise<ConversationUserInputRequest> {
  const questions = projectAsyncUserInputQuestions(
    codexAsyncUserInputQuestionsSchema.parse(item.questions),
  );
  const existing = await tx.conversationUserInputRequest.findFirst({
    where: {
      codexThreadId: turn.codexThreadId,
      codexTurnId: turn.codexTurnId,
      codexItemId: item.id,
    },
  });
  if (existing) {
    if (
      existing.conversationId !== conversationId ||
      existing.turnId !== turn.id ||
      existing.ownerId !== turn.submittedBy ||
      existing.requestKind !== "async_questions" ||
      !isDeepStrictEqual(existing.questionsJson, questions)
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    return existing;
  }
  return tx.conversationUserInputRequest.create({
    data: {
      conversationId,
      turnId: turn.id,
      ownerId: turn.submittedBy,
      codexThreadId: turn.codexThreadId,
      codexTurnId: turn.codexTurnId,
      codexItemId: item.id,
      nativeRequestId: null,
      requestKind: "async_questions",
      questionsJson: questions,
      status: "pending",
      autoResolveAt: null,
    },
  });
}
