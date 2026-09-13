import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  conversationAsyncUserInputMaximumQuestionCount,
  conversationUserInputQuestionSchema,
  type ConversationUserInputResponse,
} from "@linksense/shared";
import {
  Prisma,
  type PrismaClient,
  type ConversationEvent,
  type ConversationUserInputRequest,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { nextConversationEventSequence } from "../events/sequence.js";

const deliverySchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("steer"),
    turnId: z.uuid(),
    operationId: z.uuid(),
  }),
  z.strictObject({
    method: z.literal("start"),
    idempotencyKey: z.string().min(1).max(120),
  }),
]);
export type AsyncAnswerDelivery = z.infer<typeof deliverySchema>;

/** Same bounded question framing as Codex 0.154's AnsweredQuestion fragment. */
export function asyncAnswerText(
  questionsJson: unknown,
  response: ConversationUserInputResponse,
): string {
  if (response.action !== "accept") return "";
  const questions = z
    .array(conversationUserInputQuestionSchema)
    .min(1)
    .max(conversationAsyncUserInputMaximumQuestionCount)
    .parse(questionsJson);
  if (Object.keys(response.content).length !== questions.length)
    throw new AppError("VALIDATION_ERROR");
  return questions
    .map((question) => {
      const answer = response.content[question.id];
      if (
        typeof answer !== "string" ||
        !answer.trim() ||
        answer.length > 4_000
      ) {
        throw new AppError("VALIDATION_ERROR");
      }
      let title = "";
      let bytes = 0;
      for (const character of question.question) {
        bytes += Buffer.byteLength(character);
        if (bytes > 512) break;
        title += character;
      }
      return `> ${title.replace(/[\r\n]/g, " ")}\n\n${answer.trim()}`;
    })
    .join("\n\n");
}

export async function respondToAsyncUserInput(input: {
  prisma: PrismaClient;
  ownerId: string;
  conversationId: string;
  requestId: string;
  response: ConversationUserInputResponse;
  deliver: (
    delivery: AsyncAnswerDelivery,
    text: string,
    codexThreadId: string,
  ) => Promise<void>;
}): Promise<{
  request: ConversationUserInputRequest;
  event: ConversationEvent | null;
}> {
  const { prisma, ownerId, conversationId, requestId, response } = input;
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM conversation_user_input_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.conversationUserInputRequest.findFirst({
      where: {
        id: requestId,
        conversationId,
        ownerId,
        requestKind: "async_questions",
      },
    });
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId, archiveStatus: "active" },
    });
    const sourceTurn = request
      ? await tx.conversationTurn.findFirst({
          where: {
            id: request.turnId,
            conversationId,
            codexThreadId: request.codexThreadId,
            codexTurnId: request.codexTurnId,
          },
        })
      : null;
    if (
      !request ||
      !conversation ||
      !sourceTurn ||
      conversation.codexThreadId !== request.codexThreadId ||
      !["pending", "answering", "answered"].includes(request.status)
    ) {
      throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    }
    const text = asyncAnswerText(request.questionsJson, response);
    let delivery =
      request.responseDeliveryJson === null
        ? null
        : deliverySchema.parse(request.responseDeliveryJson);
    if (delivery || request.status === "answered") {
      const previous = {
        action: request.resolvedAction,
        content: request.responseContentJson,
      };
      if (
        previous.action !== response.action ||
        response.action !== "accept" ||
        asyncAnswerText(request.questionsJson, {
          action: "accept",
          content: z.record(z.string(), z.string()).parse(previous.content),
        }) !== text
      ) {
        throw new AppError("CONFLICT");
      }
      if (request.status === "answered")
        return { request, delivery, text, done: true };
    }
    if (response.action === "accept" && !delivery) {
      const active = await tx.conversationTurn.findFirst({
        where: {
          conversationId,
          codexThreadId: request.codexThreadId,
          status: "running",
        },
        orderBy: { sequenceNo: "desc" },
      });
      delivery = active
        ? { method: "steer", turnId: active.id, operationId: randomUUID() }
        : { method: "start", idempotencyKey: `async-answer:${request.id}` };
    }
    const stored = await tx.conversationUserInputRequest.update({
      where: { id: request.id },
      data: {
        status: "answering",
        resolvedAction: response.action,
        responseContentJson:
          response.action === "accept"
            ? (response.content as Prisma.InputJsonValue)
            : Prisma.DbNull,
        responseDeliveryJson: delivery ?? Prisma.DbNull,
      },
    });
    return { request: stored, delivery, text, done: false };
  });
  if (claimed.done) return { request: claimed.request, event: null };

  try {
    if (claimed.delivery)
      await input.deliver(
        claimed.delivery,
        claimed.text,
        claimed.request.codexThreadId,
      );
  } catch (error) {
    // An uncertain delivery keeps its original native operation identity. A
    // retry can inspect/complete that operation, never reroute the same answer.
    const definitelyNotSteered =
      error instanceof AppError && error.code === "TURN_STEER_REQUEST_FAILED";
    await prisma.conversationUserInputRequest.updateMany({
      where: {
        id: requestId,
        status: "answering",
        resolvedAction: response.action,
        responseDeliveryJson: claimed.delivery
          ? { equals: claimed.delivery }
          : { equals: Prisma.DbNull },
      },
      data: {
        status: "pending",
        ...(definitelyNotSteered
          ? {
              responseDeliveryJson: Prisma.DbNull,
              responseContentJson: Prisma.DbNull,
              resolvedAction: null,
            }
          : {}),
      },
    });
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    // Use the same lock order as claiming and native event ingestion. This also
    // serializes completion predicates across concurrent answer submissions.
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
    const changed = await tx.conversationUserInputRequest.updateMany({
      where: {
        id: requestId,
        status: { in: ["pending", "answering"] },
        resolvedAction: response.action,
        responseDeliveryJson: claimed.delivery
          ? { equals: claimed.delivery }
          : { equals: Prisma.DbNull },
      },
      data: {
        status: response.action === "accept" ? "answered" : "cancelled",
        resolvedAt: new Date(),
      },
    });
    const request = await tx.conversationUserInputRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (changed.count === 0) return { request, event: null };
    const sequenceNo = await nextConversationEventSequence(tx, conversationId);
    const event = await tx.conversationEvent.create({
      data: {
        conversationId,
        turnId: request.turnId,
        sequenceNo,
        eventType: "conversation.user_input_request.updated",
        visibility: "user_visible",
        payloadJson: {
          schema_version: 1,
          user_input_request_id: requestId,
          status: request.status,
        },
        sseEventId: `${conversationId}:${sequenceNo}`,
      },
    });
    return { request, event };
  });
}
