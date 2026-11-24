import { capabilitySelectionIdSchema, conversationStartFailurePayloadSchema, errorCatalog } from "@linksense/shared";
import { z } from "zod";

import type { LinkSenseRedis, RunningTurnSlot } from "../../adapters/redis.js";
import { Prisma, type ConversationEvent, type PrismaClient } from "../../generated/prisma/client.js";
import { loadInterruptedAssistantOutputs, persistInterruptedAssistantOutputs } from "../events/interrupted-assistant-output.js";
import type { KnowledgeCitationProjection } from "../events/knowledge-citations.js";
import { nextConversationEventSequence } from "../events/sequence.js";
import { cancelDesktopApprovals } from "../conversations/desktop-approvals.js";
import { recordRecoveredLocalQuoteDraft, recoveredLocalQuoteRequest } from "../conversations/recovered-local-quote-draft.js";

type RevokedConversation = { ownerId: string; deviceId: string; conversationId: string; runtimeGeneration: string };
export type RevokedMacTurn = RevokedConversation & { projectionTurnId: string };
type RevokedWork = RevokedConversation & { turnIds: string[] };
type RecoverySlot = RevokedMacTurn | { deviceId: null; conversationId: string; projectionTurnId: string };
const errorCode = "DESKTOP_DEVICE_REVOKED";
const messageKey = errorCatalog[errorCode].message_key;
/** Public block code for a Mac draft blocked by device revocation. */
export const REVOKED_MAC_PENDING_BLOCK_CODE = "desktop_device_revoked";
const attachmentIds = z.array(z.object({ id: z.uuid() }));
const priorityCapabilityIds = z.array(capabilitySelectionIdSchema);
const knowledgeBaseIds = z.array(z.uuid());

export async function revokedMacRecoveryPage(
  prisma: PrismaClient,
  after: string | null,
  limit: number,
): Promise<RevokedWork[]> {
  // Start from outstanding work, not historical revoked devices or terminal turns.
  return prisma.$queryRaw<RevokedWork[]>`
    SELECT c.id AS "conversationId", c.owner_id AS "ownerId", d.id AS "deviceId",
      c.runtime_generation AS "runtimeGeneration", array_agg(DISTINCT work.turn_id) AS "turnIds"
    FROM (
      SELECT conversation_id, submitted_by AS owner_id, id AS turn_id, NULL::uuid AS runtime_generation
      FROM conversation_turns WHERE status = 'running'
      UNION ALL
      SELECT conversation_id, owner_id, projection_turn_id, runtime_generation
      FROM conversation_turn_start_intents
    ) work
    JOIN conversations c ON c.id = work.conversation_id AND c.owner_id = work.owner_id
      AND (work.runtime_generation IS NULL OR c.runtime_generation = work.runtime_generation)
    JOIN desktop_devices d ON d.id = c.desktop_device_id AND d.owner_id = c.owner_id
    WHERE d.platform = 'darwin' AND d.revoked_at IS NOT NULL AND c.execution_target = 'local'
      AND (${after}::uuid IS NULL OR work.conversation_id > ${after}::uuid)
    GROUP BY c.id, d.id
    ORDER BY c.id LIMIT ${limit}`;
}

export async function recoverableSlotOwners(
  prisma: PrismaClient,
  slots: readonly RunningTurnSlot[],
): Promise<RecoverySlot[]> {
  if (!slots.length) return [];
  // Older completed turns may still have a reservation without a release row.
  return prisma.$queryRaw<RecoverySlot[]>`
    SELECT slot.conversation_id AS "conversationId", slot.owner_id AS "ownerId", d.id AS "deviceId",
      c.runtime_generation AS "runtimeGeneration", slot.turn_id AS "projectionTurnId"
    FROM unnest(
      ${slots.map(slot => slot.conversationId)}::uuid[],
      ${slots.map(slot => slot.turnId)}::uuid[],
      ${slots.map(slot => slot.ownerId)}::uuid[]
    ) AS slot(conversation_id, turn_id, owner_id)
    LEFT JOIN conversations c ON c.id = slot.conversation_id
    LEFT JOIN desktop_devices d ON d.id = c.desktop_device_id AND d.owner_id = c.owner_id
    WHERE c.id IS NULL OR (
      c.owner_id = slot.owner_id AND c.execution_target = 'local'
      AND d.platform = 'darwin' AND d.revoked_at IS NOT NULL
    )`;
}

/** Close LinkSense's projection when the device can no longer prove a native outcome. */
export async function settleRevokedMacTurn(
  prisma: PrismaClient,
  redis: Pick<LinkSenseRedis, "acquireConversationLock" | "releaseConversationLock">,
  { ownerId, deviceId, conversationId, projectionTurnId: turnId, runtimeGeneration }: RevokedMacTurn,
  project: (text: string) => Promise<KnowledgeCitationProjection>,
): Promise<ConversationEvent[]> {
  const lock = await redis.acquireConversationLock(conversationId, 120_000);
  if (!lock) throw new Error("TASK_RECOVERY_BUSY");
  try {
    const result = await prisma.$transaction(async tx => {
      const [branch] = await tx.$queryRaw<Array<{ codexThreadId: string | null }>>`
        SELECT c.codex_thread_id AS "codexThreadId"
        FROM conversations c
        JOIN desktop_devices d ON d.id = c.desktop_device_id AND d.owner_id = c.owner_id
        WHERE c.id = ${conversationId}::uuid AND c.owner_id = ${ownerId}::uuid
          AND c.runtime_generation = ${runtimeGeneration}::uuid AND c.execution_target = 'local'
          AND d.id = ${deviceId}::uuid AND d.platform = 'darwin' AND d.revoked_at IS NOT NULL
        FOR NO KEY UPDATE OF c FOR SHARE OF d`;
      if (!branch) return null;
      const now = new Date();
      const events: ConversationEvent[] = [];
      const append = async (eventType: string, linkedTurn: string | null, payloadJson: Prisma.InputJsonObject) => {
        const sequenceNo = await nextConversationEventSequence(tx, conversationId);
        events.push(await tx.conversationEvent.create({ data: {
          conversationId, turnId: linkedTurn, sequenceNo, eventType,
          visibility: "user_visible", payloadJson, sseEventId: `${conversationId}:${sequenceNo}`,
        } }));
      };
      const intent = await tx.conversationTurnStartIntent.findFirst({
        where: { projectionTurnId: turnId, conversationId, ownerId, runtimeGeneration },
      });
      if (intent) {
        const blocked = { status: "blocked_preflight", blockCode: REVOKED_MAC_PENDING_BLOCK_CODE, lastStartCheckedAt: now } as const;
        let [draft] = intent.pendingRequestId
          ? await tx.pendingRequest.updateManyAndReturn({
            where: { id: intent.pendingRequestId, conversationId, submittedBy: ownerId }, data: blocked,
            select: { id: true, queueNo: true },
          })
          : [];
        if (!draft) {
          const tail = await tx.pendingRequest.findFirst({
            where: { conversationId }, orderBy: { queueNo: "desc" }, select: { queueNo: true },
          });
          // Only a validated sidecar supplies the exact plain request; it stays
          // authoritative even when the literal looks like an annotation prompt.
          const recoveredRequest = recoveredLocalQuoteRequest(intent.messageDisplayJson);
          draft = await tx.pendingRequest.create({
            data: {
              id: turnId, conversationId, submittedBy: ownerId, queueNo: (tail?.queueNo ?? 0n) + 1n,
              inputText: recoveredRequest ?? intent.inputText,
              collaborationMode: intent.collaborationMode, idempotencyKey: intent.idempotencyKey,
              priorityCapabilityIdsJson: priorityCapabilityIds.parse(intent.priorityCapabilityIdsJson),
              knowledgeBaseIdsJson: knowledgeBaseIds.parse(intent.knowledgeBaseIdsJson), ...blocked,
            },
            select: { id: true, queueNo: true },
          });
          if (recoveredRequest !== null) {
            await recordRecoveredLocalQuoteDraft(tx, conversationId, draft.id);
          }
        }
        await tx.conversationFile.updateMany({
          where: {
            id: { in: attachmentIds.parse(intent.attachmentsJson).map(file => file.id) },
            conversationId, turnId: null, kind: "attachment", status: { in: ["staged", "pending"] },
            OR: [{ pendingRequestId: null }, { pendingRequestId: draft.id }],
          },
          data: { pendingRequestId: draft.id, status: "pending" },
        });
        await tx.conversationTurnStartIntent.delete({ where: { projectionTurnId: turnId } });
        await append("conversation.pending_request.updated", null, {
          schema_version: 1, pending_request_id: draft.id, status: blocked.status, block_code: blocked.blockCode,
          queue_no: Number(draft.queueNo), last_start_checked_at: now.toISOString(),
        });
        // Keep the existing start-failure contract so older clients clear the pending submission.
        await append("conversation.error", null, conversationStartFailurePayloadSchema.parse({
          schema_version: 1, error_code: "RUNNER_UNAVAILABLE", message_key: "errors.runnerUnavailable", retryable: true,
          start_failure: { turn_id: turnId, idempotency_key: intent.idempotencyKey },
        }));
        await append("conversation.error", null, {
          schema_version: 1, error_code: errorCode, message_key: messageKey, retryable: false,
        });
      }

      const [stopped] = await tx.conversationTurn.updateManyAndReturn({
        where: { id: turnId, conversationId, submittedBy: ownerId, status: "running" },
        data: { status: "failed", completedAt: now, errorCode, errorMessage: null },
        select: { codexThreadId: true, codexTurnId: true },
      });
      if (stopped) {
        await cancelDesktopApprovals(tx, turnId, now);
        const outputs = await loadInterruptedAssistantOutputs(tx, conversationId, turnId, stopped.codexTurnId, project);
        const messages = await persistInterruptedAssistantOutputs(tx, conversationId, turnId, outputs, now);
        events.push(...messages.map(message => message.event));
        await tx.conversationTurnAttempt.updateMany({
          where: { turnId, status: { in: ["running", "pending"] } },
          data: { status: "failed", completedAt: now, errorCode, errorMessage: null },
        });
        await tx.conversationUserInputRequest.updateMany({
          where: { conversationId, turnId, ownerId, status: { in: ["pending", "answering"] } },
          data: { status: "cancelled", resolvedAt: now, responseContentJson: Prisma.DbNull },
        });
        if (branch.codexThreadId === stopped.codexThreadId) {
          await tx.conversation.update({
            where: { id: conversationId },
            data: { lastTurnStatus: "failed", completionUnread: true },
          });
        }
        await append("conversation.status.changed", turnId, {
          schema_version: 1, turn_id: turnId, turn_status: "failed", conversation_execution_status: "failed",
        });
        await append("conversation.error", turnId, {
          schema_version: 1, error_code: errorCode, message_key: messageKey, retryable: false,
        });
        await tx.auditLog.create({ data: {
          action: "conversation_turn_failed", targetType: "conversation_turn", targetId: turnId,
          result: "failure", metadataJson: { conversation_id: conversationId, reason_code: errorCode },
        } });
      }
      // The reservation remains releasable even if the conversation is deleted.
      await tx.desktopTurnSlotRelease.createMany({ data: [{ turnId, conversationId }], skipDuplicates: true });
      return events;
    });
    return result ?? [];
  } finally {
    await redis.releaseConversationLock(conversationId, lock);
  }
}
