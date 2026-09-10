import { z } from "zod";

import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { LinkSenseRedis } from "../adapters/redis.js";
import { nextConversationEventSequence } from "../modules/events/sequence.js";

export const DEPLOYMENT_STOPPED = "DEPLOYMENT_STOPPED";
const deploymentBlockCode = "deployment_stopped";

export function parseDeploymentStopCommand(
  args: string[],
): "interrupt" | "settle" {
  if (args.length === 1 && args[0] === "interrupt") return "interrupt";
  if (
    args.length === 2 &&
    args[0] === "settle" &&
    args[1] === "--runtime-stopped"
  )
    return "settle";
  throw new Error("Expected interrupt or settle --runtime-stopped");
}

const interruptTargetSchema = z.object({
  conversationId: z.uuid(),
  ownerId: z.uuid(),
  turnId: z.string().min(1),
});
export type DeploymentInterruptTarget = z.infer<typeof interruptTargetSchema>;

export async function listDeploymentInterruptTargets(
  prisma: PrismaClient,
): Promise<DeploymentInterruptTarget[]> {
  const [turns, intents] = await Promise.all([
    prisma.conversationTurn.findMany({
      where: { status: "running" },
      select: { conversationId: true, submittedBy: true, codexTurnId: true },
    }),
    prisma.conversationTurnStartIntent.findMany({
      where: { codexTurnId: { not: null } },
      select: { conversationId: true, ownerId: true, codexTurnId: true },
    }),
  ]);
  const targets = z.array(interruptTargetSchema).parse([
    ...turns.map((turn) => ({
      conversationId: turn.conversationId,
      ownerId: turn.submittedBy,
      turnId: turn.codexTurnId,
    })),
    ...intents.map((intent) => ({
      conversationId: intent.conversationId,
      ownerId: intent.ownerId,
      turnId: intent.codexTurnId,
    })),
  ]);
  return [
    ...new Map(
      targets.map((target) => [
        `${target.conversationId}:${target.turnId}`,
        target,
      ]),
    ).values(),
  ];
}

/** Cancellation requests share one deadline; they never wait for model completion. */
export async function interruptDeploymentTasks(
  targets: DeploymentInterruptTarget[],
  options: {
    baseUrl: string;
    secret: string;
    signal: AbortSignal;
    fetcher?: typeof fetch;
  },
): Promise<{ requested: number; unavailable: number }> {
  const fetcher = options.fetcher ?? fetch;
  const outcomes = await Promise.all(
    targets.map(async (target) => {
      try {
        const response = await fetcher(
          new URL(
            `/conversations/${target.conversationId}/turns/interrupt`,
            options.baseUrl,
          ),
          {
            method: "POST",
            signal: options.signal,
            headers: {
              authorization: `Bearer ${options.secret}`,
              "x-linksense-owner-id": target.ownerId,
              "content-type": "application/json",
            },
            body: JSON.stringify({ turnId: target.turnId }),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          return false;
        }
        const result = z
          .object({
            code: z.enum([
              "TURN_INTERRUPT_REQUESTED",
              "TURN_INTERRUPT_NOT_ACTIVE",
            ]),
          })
          .safeParse(await response.json());
        return result.success;
      } catch {
        return false;
      }
    }),
  );
  return {
    requested: outcomes.filter(Boolean).length,
    unavailable: outcomes.filter((value) => !value).length,
  };
}

/**
 * Offline deployment boundary only: every API, controller and owned worker must
 * be stopped. This records infrastructure termination, not a synthetic native
 * completion. Existing messages/files and already terminal turns are untouched.
 */
export async function settleDeploymentTasks(
  prisma: PrismaClient,
  redis: Pick<LinkSenseRedis, "releaseTurnSlot">,
  now = new Date(),
): Promise<{ turns: number; starts: number; pending: number }> {
  return prisma.$transaction(
    async (tx) => {
      const turns = await tx.conversationTurn.findMany({
        where: { status: "running" },
      });
      const intents = await tx.conversationTurnStartIntent.findMany({
        orderBy: { createdAt: "asc" },
      });
      const goals = await tx.conversationGoal.findMany({
        where: { status: "active" },
        select: { conversationId: true },
      });
      for (const conversationId of new Set(
        [...turns, ...intents, ...goals].map((item) => item.conversationId),
      )) {
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "conversation_execution_stopped_for_deployment",
            targetType: "conversation",
            targetId: conversationId,
            result: "success",
            createdAt: now,
            metadataJson: { reason_code: DEPLOYMENT_STOPPED },
          },
        });
      }
      // Retain accepted but not yet projected input as explicitly blocked drafts.
      // Removing its start intent prevents startup recovery from submitting it.
      for (const intent of intents) {
        const projected = await tx.conversationTurn.findUnique({
          where: { id: intent.projectionTurnId },
          select: { id: true },
        });
        if (!projected && intent.taskKind !== "compact") {
          let pending = intent.pendingRequestId
            ? await tx.pendingRequest.findUnique({
                where: { id: intent.pendingRequestId },
              })
            : null;
          if (
            pending &&
            (pending.conversationId !== intent.conversationId ||
              pending.submittedBy !== intent.ownerId)
          ) {
            throw new Error("Deployment pending request ownership mismatch");
          }
          if (!pending) {
            const latest = await tx.pendingRequest.findFirst({
              where: { conversationId: intent.conversationId },
              orderBy: { queueNo: "desc" },
              select: { queueNo: true },
            });
            pending = await tx.pendingRequest.create({
              data: {
                id: intent.projectionTurnId,
                conversationId: intent.conversationId,
                queueNo: (latest?.queueNo ?? 0n) + 1n,
                submittedBy: intent.ownerId,
                inputText: intent.inputText,
                collaborationMode: intent.collaborationMode,
                priorityCapabilityIdsJson: z
                  .array(z.string())
                  .parse(intent.priorityCapabilityIdsJson),
                knowledgeBaseIdsJson: z
                  .array(z.string())
                  .parse(intent.knowledgeBaseIdsJson),
                status: "blocked_preflight",
                blockCode: deploymentBlockCode,
                idempotencyKey: intent.idempotencyKey,
                lastStartCheckedAt: now,
              },
            });
          }
          const attachments = z
            .array(z.object({ id: z.uuid() }))
            .parse(intent.attachmentsJson);
          await tx.conversationFile.updateMany({
            where: {
              conversationId: intent.conversationId,
              id: { in: attachments.map((file) => file.id) },
              turnId: null,
              kind: "attachment",
            },
            data: { pendingRequestId: pending.id, status: "pending" },
          });
          if (intent.pendingRequestId) {
            await tx.pendingRequest.update({
              where: { id: pending.id },
              data: {
                status: "blocked_preflight",
                blockCode: deploymentBlockCode,
                steerOperationId: null,
                steerTurnId: null,
                lastStartCheckedAt: now,
              },
            });
          }
        }
        // The API is offline. Releasing before deleting leaves a retryable intent
        // if Redis fails; a rolled-back transaction is reconciled on next boot.
        await redis.releaseTurnSlot(
          intent.conversationId,
          intent.projectionTurnId,
        );
        await tx.conversationTurnStartIntent.delete({
          where: { projectionTurnId: intent.projectionTurnId },
        });
      }
      const pending = await tx.pendingRequest.findMany({
        where: {
          status: {
            in: ["waiting_previous_turn", "blocked_overload", "steering"],
          },
        },
      });
      for (const request of pending) {
        await tx.pendingRequest.update({
          where: { id: request.id },
          data: {
            status: "blocked_preflight",
            blockCode: deploymentBlockCode,
            steerOperationId: null,
            steerTurnId: null,
            lastStartCheckedAt: now,
          },
        });
        await appendEvent(
          tx,
          request.conversationId,
          null,
          "conversation.pending_request.updated",
          {
            pending_request_id: request.id,
            status: "blocked_preflight",
            block_code: deploymentBlockCode,
            queue_no: Number(request.queueNo),
            last_start_checked_at: now.toISOString(),
          },
        );
      }
      const turnIds = turns.map((turn) => turn.id);
      await tx.conversationTurnAttempt.updateMany({
        where: { status: { in: ["pending", "running"] } },
        data: {
          status: "failed",
          completedAt: now,
          errorCode: DEPLOYMENT_STOPPED,
        },
      });
      await tx.conversationUserInputRequest.updateMany({
        where: {
          turnId: { in: turnIds },
          status: { in: ["pending", "answering"] },
        },
        data: {
          status: "cancelled",
          resolvedAt: now,
          responseContentJson: Prisma.DbNull,
        },
      });
      await tx.conversationPlanReview.updateMany({
        where: { sourceTurnId: { in: turnIds }, status: "preparing" },
        data: { status: "cancelled", resolvedAt: now },
      });
      // Completed pending plan reviews remain available for an explicit decision.
      await tx.conversationGoal.updateMany({
        where: { status: "active" },
        data: { status: "paused", activeTurnId: null },
      });
      for (const turn of turns) {
        await tx.conversationTurn.update({
          where: { id: turn.id },
          data: {
            status: "failed",
            completedAt: now,
            errorCode: DEPLOYMENT_STOPPED,
            errorMessage: null,
            interruptRequestedAt: turn.interruptRequestedAt ?? now,
          },
        });
        await tx.conversation.update({
          where: { id: turn.conversationId },
          data: { lastTurnStatus: "failed", completionUnread: true },
        });
        await appendEvent(
          tx,
          turn.conversationId,
          turn.id,
          "conversation.status.changed",
          {
            turn_id: turn.id,
            turn_status: "failed",
            conversation_execution_status: "failed",
          },
        );
        await appendEvent(
          tx,
          turn.conversationId,
          turn.id,
          "conversation.error",
          {
            error_code: DEPLOYMENT_STOPPED,
            message_key: "errors.deploymentStopped",
            retryable: true,
          },
        );
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "conversation_turn_stopped_for_deployment",
            targetType: "conversation_turn",
            targetId: turn.id,
            result: "success",
            metadataJson: {
              conversation_id: turn.conversationId,
              reason_code: DEPLOYMENT_STOPPED,
            },
          },
        });
        await redis.releaseTurnSlot(turn.conversationId, turn.id);
      }
      const automationRuns = await tx.automationRun.findMany({
        where: {
          completedAt: null,
          OR: [
            { status: { in: ["dispatching", "queued"] } },
            { status: "started", turnId: { in: turnIds } },
          ],
        },
      });
      for (const run of automationRuns) {
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "automation_run_stopped_for_deployment",
            targetType: "automation_run",
            targetId: run.id,
            result: "success",
            metadataJson: {
              conversation_id: run.conversationId,
              turn_id: run.turnId,
              pending_request_id: run.pendingRequestId,
              reason_code: DEPLOYMENT_STOPPED,
            },
          },
        });
        await tx.automationRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            turnId: null,
            pendingRequestId: null,
            errorCode: DEPLOYMENT_STOPPED,
            completedAt: now,
          },
        });
        await tx.automation.updateMany({
          where: {
            id: run.automationId,
            OR: [{ lastRunAt: null }, { lastRunAt: { lte: run.scheduledFor } }],
          },
          data: { lastRunStatus: "failed", lastErrorCode: DEPLOYMENT_STOPPED },
        });
      }
      return {
        turns: turns.length,
        starts: intents.length,
        pending: pending.length,
      };
    },
    { timeout: 60_000 },
  );
}

async function appendEvent(
  tx: Prisma.TransactionClient,
  conversationId: string,
  turnId: string | null,
  eventType: string,
  payload: Prisma.InputJsonObject,
): Promise<void> {
  const sequenceNo = await nextConversationEventSequence(tx, conversationId);
  await tx.conversationEvent.create({
    data: {
      conversationId,
      turnId,
      sequenceNo,
      eventType,
      visibility: "user_visible",
      payloadJson: { schema_version: 1, ...payload },
      sseEventId: `${conversationId}:${sequenceNo}`,
    },
  });
}
