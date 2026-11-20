import { isDeepStrictEqual } from "node:util";
import {
  desktopApprovalDetailsSchema,
  desktopApprovalResponseSchema,
  desktopApprovalRequestSchema,
  desktopApprovalTimeoutMs,
  type DesktopApprovalRequest,
  type DesktopApprovalResponse,
  type runnerDesktopApprovalParamsSchema,
} from "@linksense/shared";
import type { z } from "zod";
import type { RunnerClient } from "../../adapters/runner.js";
import type { ConversationDesktopApproval, Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { AuditService, type AuditContext } from "../audit/service.js";
import { lockDesktopConversation, type DesktopProjectionFence } from "../desktop-credentials/run-authority.js";
import { nextConversationEventSequence } from "../events/sequence.js";

type ApprovalStatus = DesktopApprovalRequest["status"];

export function projectDesktopApproval(row: ConversationDesktopApproval): DesktopApprovalRequest {
  return desktopApprovalRequestSchema.parse({
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    item_id: row.codexItemId,
    kind: "desktop_approval",
    approval: row.approvalJson,
    status: row.status,
    auto_resolve_at: row.expiresAt.toISOString(),
    resolved_action: row.resolvedAction,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

export async function recordDesktopApproval(
  prisma: PrismaClient,
  fence: DesktopProjectionFence,
  request: z.infer<typeof runnerDesktopApprovalParamsSchema>,
  deliveryId: string,
) {
  const { scope } = fence;
  return prisma.$transaction(async tx => {
    const branch = await lockDesktopConversation(tx, scope);
    if (request.threadId !== branch.codexThreadId) throw new AppError("FORBIDDEN");
    await fence.check();
    const turn = await tx.conversationTurn.findFirst({
      where: { id: scope.turnId, conversationId: scope.conversationId, submittedBy: scope.ownerId,
        codexThreadId: request.threadId, codexTurnId: request.turnId, status: "running", interruptRequestedAt: null },
      select: { id: true },
    });
    if (!turn) return null;
    const nativeRequestId = BigInt(request.requestId);
    const existing = await tx.conversationDesktopApproval.findUnique({
      where: { turnId_nativeRequestId: { turnId: scope.turnId, nativeRequestId } },
    });
    if (existing) {
      if (existing.conversationId !== scope.conversationId || existing.ownerId !== scope.ownerId ||
        existing.codexThreadId !== request.threadId || existing.codexTurnId !== request.turnId ||
        existing.codexItemId !== request.itemId || !isDeepStrictEqual(existing.approvalJson, request.approval)) {
        throw new AppError("FORBIDDEN");
      }
      return tx.conversationEvent.findUnique({ where: { id: existing.id } });
    }
    const stored = await tx.conversationDesktopApproval.create({
      data: { id: deliveryId, ownerId: scope.ownerId, conversationId: scope.conversationId, turnId: scope.turnId,
        codexThreadId: request.threadId, codexTurnId: request.turnId, codexItemId: request.itemId, nativeRequestId,
        approvalJson: request.approval, expiresAt: new Date(Date.now() + desktopApprovalTimeoutMs), status: "pending" },
    });
    await new AuditService(tx).write({
      actorId: scope.ownerId,
      action: "desktop_tool_requested",
      targetType: "conversation_desktop_approval", targetId: stored.id, result: "success",
      metadata: { operation: request.approval.method, device_id: scope.deviceId,
        conversation_id: scope.conversationId, turn_id: scope.turnId },
    });
    return appendApprovalUpdate(tx, stored, "pending", deliveryId);
  });
}

async function appendApprovalUpdate(
  tx: Prisma.TransactionClient,
  { conversationId, turnId, id }: Pick<ConversationDesktopApproval, "conversationId" | "turnId" | "id">,
  status: ApprovalStatus,
  deliveryId?: string,
) {
  const sequenceNo = await nextConversationEventSequence(tx, conversationId);
  return tx.conversationEvent.create({ data: {
    ...(deliveryId ? { id: deliveryId } : {}),
    conversationId, turnId, sequenceNo,
    eventType: "conversation.user_input_request.updated", visibility: "user_visible",
    // Existing clients consume this as a refresh; the detail carries the delivery outcome.
    payloadJson: { schema_version: 1, user_input_request_id: id, status: status === "unconfirmed" ? "cancelled" : status },
    sseEventId: `${conversationId}:${sequenceNo}`,
  } });
}

export async function cancelDesktopApprovals(
  tx: Prisma.TransactionClient,
  turnId: string,
  resolvedAt: Date,
): Promise<void> {
  await tx.conversationDesktopApproval.updateMany({
    where: { turnId, status: "pending" },
    data: { status: "cancelled", resolvedAt, resolvedAction: null },
  });
  // Stop and revocation do not prove that an in-flight choice had no effect.
  await tx.conversationDesktopApproval.updateMany({
    where: { turnId, status: "answering" },
    data: { status: "unconfirmed", resolvedAt },
  });
}

export async function respondToDesktopApproval(input: {
  prisma: PrismaClient;
  runner: Pick<RunnerClient, "respondUserInputRequest">;
  scope: DesktopProjectionFence["scope"];
  requestId: string;
  response: DesktopApprovalResponse;
  context: AuditContext;
}) {
  const { prisma, scope, requestId, response } = input;
  desktopApprovalResponseSchema.parse(response);
  const { ownerId, conversationId, turnId, runtimeGeneration } = scope;
  const where = { id: requestId, ownerId, conversationId, turnId };
  const unavailable = () => new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
  const row = await prisma.$transaction(async tx => {
    const branch = await lockDesktopConversation(tx, scope);
    const first = await tx.conversationDesktopApproval.findFirst({
      where: { ownerId, conversationId, turnId, expiresAt: { gt: new Date() }, status: { in: ["pending", "answering"] } },
      orderBy: { nativeRequestId: "asc" },
    });
    if (first?.id !== requestId || first.status !== "pending" || first.codexThreadId !== branch.codexThreadId) {
      throw unavailable();
    }
    const turn = await tx.conversationTurn.findFirst({
      where: { id: turnId, conversationId, submittedBy: ownerId, codexThreadId: first.codexThreadId,
        codexTurnId: first.codexTurnId, status: "running", interruptRequestedAt: null },
      select: { id: true },
    });
    if (!turn) throw unavailable();
    const approval = desktopApprovalDetailsSchema.parse(first.approvalJson);
    if (approval.method !== response.method || !approval.decisions.includes(response.decision)) {
      throw new AppError("VALIDATION_ERROR");
    }
    const claimed = await tx.conversationDesktopApproval.updateMany({
      where: { ...where, status: "pending", expiresAt: { gt: new Date() } },
      data: { status: "answering", resolvedAction: response.decision },
    });
    if (claimed.count !== 1) throw unavailable();
    // Record the user's decision before delivery. A lost receipt must not
    // erase what was chosen, and `delivery` tells the audit reader that the
    // reply itself is still unconfirmed.
    await new AuditService(tx).write({
      ...input.context, actorId: ownerId, action: "desktop_approval_responded",
      targetType: "conversation_desktop_approval", targetId: requestId, result: "success",
      metadata: { conversation_id: conversationId, turn_id: turnId, operation: response.method,
        action: response.decision, delivery: "unconfirmed" },
    });
    return first;
  });
  try {
    await input.runner.respondUserInputRequest({
      conversationId, ownerId, requestId: Number(row.nativeRequestId),
      codexThreadId: row.codexThreadId, codexTurnId: row.codexTurnId, itemId: row.codexItemId,
      response, desktop: { turnId, runtimeGeneration },
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const gone = error.code === "USER_INPUT_REQUEST_UNAVAILABLE" || error.code === "FORBIDDEN";
    // Reopen only if the transport can prove it did not send the answer.
    if (!gone && error.code !== "RUNNER_UNAVAILABLE") throw error;
    await prisma.conversationDesktopApproval.updateMany({
      where: { ...where, status: "answering" },
      data: gone
        ? { status: "cancelled", resolvedAt: new Date(), resolvedAction: null }
        : { status: "pending", resolvedAction: null },
    });
    throw error;
  }
  const status = response.decision === "accept" ? "answered" : "cancelled";
  return prisma.$transaction(async tx => {
    const branch = await lockDesktopConversation(tx, scope);
    if (branch.codexThreadId !== row.codexThreadId) throw unavailable();
    const [stored] = await tx.conversationDesktopApproval.updateManyAndReturn({
      // Native closure can arrive before the device confirms the submission.
      where: { ...where, status: { in: ["answering", "unconfirmed"] }, resolvedAction: response.decision },
      data: { status, resolvedAt: new Date() },
    });
    if (!stored) throw unavailable();
    await new AuditService(tx).write({
      ...input.context, actorId: ownerId, action: "desktop_approval_responded",
      targetType: "conversation_desktop_approval", targetId: requestId, result: "success",
      metadata: { conversation_id: conversationId, turn_id: turnId, operation: response.method,
        action: response.decision, delivery: "confirmed" },
    });
    return { stored, event: await appendApprovalUpdate(tx, stored, status) };
  });
}

export async function resolveDesktopApproval(
  prisma: PrismaClient,
  fence: DesktopProjectionFence,
  threadId: string,
  requestId: number,
  deliveryId: string,
) {
  const { scope } = fence;
  const identity = { turnId: scope.turnId, nativeRequestId: BigInt(requestId) };
  // A browser question shares the native request namespace, but not this table.
  if (!await prisma.conversationDesktopApproval.findUnique({
    where: { turnId_nativeRequestId: identity }, select: { id: true },
  })) return undefined;
  return prisma.$transaction(async tx => {
    const branch = await lockDesktopConversation(tx, scope);
    await fence.check();
    const current = await tx.conversationDesktopApproval.findUnique({
      where: { turnId_nativeRequestId: identity },
    });
    if (!current) return null;
    if (branch.codexThreadId !== threadId || current.codexThreadId !== threadId ||
      current.ownerId !== scope.ownerId || current.conversationId !== scope.conversationId) {
      throw new AppError("FORBIDDEN");
    }
    const duplicate = await tx.conversationEvent.findUnique({ where: { id: deliveryId } });
    if (duplicate) {
      if (duplicate.conversationId !== scope.conversationId || duplicate.turnId !== scope.turnId ||
        duplicate.eventType !== "conversation.user_input_request.updated") throw new AppError("FORBIDDEN");
      return duplicate;
    }
    if (current.status !== "pending" && current.status !== "answering") return null;
    // Native closure only proves the JSON-RPC request closed. A pending card
    // never sent a decision, while an answering card may already have been
    // applied by Codex; never report either as a confirmed cancellation.
    const status = current.status === "answering" ? "unconfirmed" : "cancelled";
    await tx.conversationDesktopApproval.update({
      where: { id: current.id },
      data: {
        status, resolvedAt: new Date(),
        ...(status === "cancelled" ? { resolvedAction: null } : {}),
      },
    });
    return appendApprovalUpdate(tx, current, status, deliveryId);
  });
}
