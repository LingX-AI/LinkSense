import { isDeepStrictEqual } from "node:util";
import {
  conversationFormRequestedSchema,
  conversationFormResponseContentSchema,
  conversationFormResponseMatchesSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormWaitingPolicyMatchesSchema,
  conversationFormWaitingPolicySchema,
  type ConversationUserInputResponse,
} from "@linksense/shared";
import { Prisma, type PrismaClient, type ConversationUserInputRequest, type ConversationEvent } from "../../generated/prisma/client.js";
import type { RunnerClient } from "../../adapters/runner.js";
import { AppError } from "../../lib/errors.js";
import { nextConversationEventSequence } from "../events/sequence.js";

export async function respondToFormUserInput(input: {
  prisma: PrismaClient;
  runner: Pick<RunnerClient, "respondUserInputRequest">;
  ownerId: string;
  conversationId: string;
  requestId: string;
  response?: ConversationUserInputResponse;
  now?: Date;
}): Promise<{ request: ConversationUserInputRequest; event: ConversationEvent | null }> {
  const now = input.now ?? new Date();
  const claimed = await input.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM conversation_user_input_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
    const request = await tx.conversationUserInputRequest.findFirst({ where: {
      id: input.requestId, conversationId: input.conversationId, ownerId: input.ownerId, requestKind: "form",
    } });
    if (!request) throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    if (request.status === "answered") {
      if (!input.response || request.responseSource === "recommendation" ||
        (request.resolvedAction === input.response.action && input.response.action === "accept" && isDeepStrictEqual(request.responseContentJson, input.response.content))) {
        return { request, response: null, done: true };
      }
      throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    }
    if (request.status !== "pending" && request.status !== "answering") throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    const [conversation, turn] = await Promise.all([
      tx.conversation.findFirst({ where: { id: input.conversationId, ownerId: input.ownerId, archiveStatus: "active" } }),
      tx.conversationTurn.findFirst({ where: { id: request.turnId, conversationId: input.conversationId, status: "running", codexThreadId: request.codexThreadId, codexTurnId: request.codexTurnId } }),
    ]);
    if (!conversation || !turn || conversation.codexThreadId !== request.codexThreadId || request.nativeRequestId === null) throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    const schema = conversationFormRequestedSchema.parse(request.formSchemaJson);
    const semantics = conversationFormResponseSemanticsSchema.parse(request.formResponseSemanticsJson);
    const policy = request.formWaitingPolicyJson === null
      ? { kind: "required" as const }
      : conversationFormWaitingPolicySchema.parse(request.formWaitingPolicyJson);
    if (!conversationFormWaitingPolicyMatchesSchema(policy, schema, semantics)) throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    const due = policy.kind === "optional" && request.autoResolveAt !== null && request.autoResolveAt <= now;
    if (!input.response && !due) return { request, response: null, done: true };
    if (request.status === "answering") {
      if (now.getTime() - request.updatedAt.getTime() < 30_000) return { request, response: null, done: true };
      // The first claimant owns both the answer and its source. A scheduled
      // timeout must never replace a user's already accepted submission.
      if ((!input.response && request.responseSource !== "recommendation") ||
        (input.response && request.responseSource === "user" &&
          (input.response.action !== request.resolvedAction || input.response.action !== "accept" || !isDeepStrictEqual(input.response.content, request.responseContentJson)))) {
        return { request, response: null, done: true };
      }
      const response: ConversationUserInputResponse = request.resolvedAction === "accept"
        ? { action: "accept", content: conversationFormResponseContentSchema.parse(request.responseContentJson) }
        : { action: "cancel" };
      const reclaimed = await tx.conversationUserInputRequest.update({
        where: { id: request.id },
        data: { updatedAt: now },
      });
      return { request: reclaimed, response, done: false };
    }
    const reserved = request.responseSource !== null && request.resolvedAction !== null;
    const response: ConversationUserInputResponse = reserved
      ? request.resolvedAction === "accept"
        ? { action: "accept", content: conversationFormResponseContentSchema.parse(request.responseContentJson) }
        : { action: "cancel" }
      : due && policy.kind === "optional"
      ? { action: "accept", content: policy.recommendation }
      : input.response ?? { action: "cancel" };
    if (policy.kind === "required" && response.action !== "accept") throw new AppError("VALIDATION_ERROR");
    if (response.action === "accept" && !conversationFormResponseMatchesSchema(schema, response.content)) throw new AppError("VALIDATION_ERROR");
    const stored = await tx.conversationUserInputRequest.update({ where: { id: request.id }, data: {
      status: "answering", resolvedAction: response.action,
      responseSource: reserved ? request.responseSource : due ? "recommendation" : "user",
      responseContentJson: response.action === "accept" ? response.content : Prisma.DbNull,
    } });
    return { request: stored, response, done: false };
  });
  if (claimed.done || !claimed.response) return { request: claimed.request, event: null };
  try {
    await input.runner.respondUserInputRequest({
      conversationId: input.conversationId, ownerId: input.ownerId,
      requestId: Number(claimed.request.nativeRequestId),
      codexThreadId: claimed.request.codexThreadId, codexTurnId: claimed.request.codexTurnId,
      itemId: claimed.request.codexItemId, response: claimed.response,
    });
  } catch (error) {
    const current = await input.prisma.conversationUserInputRequest.findUniqueOrThrow({ where: { id: claimed.request.id } });
    if (current.status === "answered") return { request: current, event: null };
    await input.prisma.conversationUserInputRequest.updateMany({ where: { id: claimed.request.id, status: "answering" }, data: { status: "pending" } });
    // Preserve the claimed answer after an uncertain delivery. A retry uses
    // the same native request identity, never starts or replays a turn.
    throw error;
  }
  return input.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE`;
    const updated = await tx.conversationUserInputRequest.updateMany({ where: { id: claimed.request.id, status: "answering" }, data: {
      status: claimed.response?.action === "accept" ? "answered" : "cancelled", resolvedAt: now,
    } });
    const request = await tx.conversationUserInputRequest.findUniqueOrThrow({ where: { id: claimed.request.id } });
    if (updated.count === 0) return { request, event: null };
    const sequenceNo = await nextConversationEventSequence(tx, input.conversationId);
    const event = await tx.conversationEvent.create({ data: {
      conversationId: input.conversationId, turnId: request.turnId, sequenceNo,
      eventType: "conversation.user_input_request.updated", visibility: "user_visible",
      payloadJson: { schema_version: 1, user_input_request_id: request.id, status: request.status },
      sseEventId: `${input.conversationId}:${sequenceNo}`,
    } });
    return { request, event };
  });
}
