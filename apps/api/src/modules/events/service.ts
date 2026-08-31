import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import {
  conversationCollaborationModeSchema,
  conversationFormAutoResolutionMs,
  conversationFormResponseSemanticsMatchesSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormRequestedSchema,
  conversationFormUiHintsSchema,
  conversationTaskKindSchema,
  conversationUserInputQuestionSchema,
  emitInteractiveApplicationCustomEventInputSchema,
  interactiveApplicationManifestSchema,
  conversationEventSchema,
  runnerCodexGoalSchema,
  runnerCodexErrorMessageSchema,
  threadGoalStatusSchema,
} from "@linksense/shared";
import {
  Prisma,
  type ConversationEvent,
  type PrismaClient,
} from "../../generated/prisma/client.js";
import {
  isRunningTurnCapacityReady,
  type LinkSenseRedis,
  type RunningTurnRecoveryAttempt,
  type RunningTurnRecoveryStatus,
} from "../../adapters/redis.js";
import { AppError } from "../../lib/errors.js";
import { truncateConversationTitle } from "../../lib/conversation-title.js";
import type { ConversationService } from "../conversations/service.js";
import { projectKnowledgeCitations } from "./knowledge-citations.js";
import { createProjectedAssistantMessage } from "./knowledge-message-projection.js";
import type { TurnKnowledgeSourceStore } from "./knowledge-source-store.js";
import { nextConversationEventSequence } from "./sequence.js";
import type { UsageAnalyticsService } from "../usage/service.js";
import { upsertConversationGoal } from "../conversations/goals.js";

export type RunnerEventInput = {
  eventType: string;
  visibility: "user_visible" | "user_collapsed" | "internal_sanitized";
  threadId: string;
  turnId?: string;
  payload: Record<string, unknown>;
};

export type MethodRunnerEventInput = {
  method: string;
  visibility: "user_visible" | "user_collapsed" | "internal_sanitized";
  params: Record<string, unknown>;
};

export type IngestedRunnerEvent = RunnerEventInput | MethodRunnerEventInput;

export type ConversationTitleRefresh = {
  schedule(conversationId: string): void;
};

type ProcessExitRecoveryResult =
  | { outcome: "not_applicable" | "succeeded" }
  | { outcome: "failed"; reasonCode: string };

type RunningTurnRecoveryRow = {
  id: string;
  conversationId: string;
  submittedBy: string;
  capabilityGeneration: string;
};

type ActiveStartIntentRecoveryRow = {
  projectionTurnId: string;
  conversationId: string;
  ownerId: string;
};

type RecoverySlot = {
  conversationId: string;
  turnId: string;
  ownerId: string;
};

const ACTIVE_START_INTENT_STATUSES = ["prepared", "runner_succeeded"];
const UNRESOLVED_START_INTENT_STATUSES = [
  "slot_pending",
  "prepared",
  "runner_succeeded",
  "release_pending",
];
const TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "interrupted"]);
const MAX_CONTEXT_WINDOW_NATIVE_ATTEMPTS = 2;
const RUNNING_TURN_RECOVERY_SLOT_CONFLICT =
  "RUNNING_TURN_RECOVERY_SLOT_CONFLICT";
const RUNNING_TURN_RECOVERY_LEASE_UNAVAILABLE =
  "RUNNING_TURN_RECOVERY_LEASE_UNAVAILABLE";
const RUNNING_TURN_RECOVERY_ATTEMPT_UNAVAILABLE =
  "RUNNING_TURN_RECOVERY_ATTEMPT_UNAVAILABLE";
const RUNNING_TURN_RECOVERY_RECONCILE_STALE =
  "RUNNING_TURN_RECOVERY_RECONCILE_STALE";
const RUNNING_TURN_RECOVERY_COMPLETION_STALE =
  "RUNNING_TURN_RECOVERY_COMPLETION_STALE";
const AUTOMATION_EMPTY_RESULT = "AUTOMATION_EMPTY_RESULT";
const PLAN_OUTPUT_MISSING = "PLAN_OUTPUT_MISSING";
const SHARED_RECOVERY_OBSERVATION_TIMEOUT_MILLISECONDS = 5_000;
const SHARED_RECOVERY_OBSERVATION_POLL_MILLISECONDS = 100;
const recoveryRuntimeGenerationSchema = z.uuid();
const processExitRecoveryInputSchema = z.strictObject({
  conversationId: z.uuid(),
  projectionTurnId: z.uuid(),
  capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
});

type GroundedTurn = {
  id: string;
};

type CompletedAutomationOutcome =
  "not_automation" | "completed" | "empty_result";

type PlanOutputMissingEvent = {
  event: ConversationEvent;
  payload: {
    schema_version: 1;
    error_code: typeof PLAN_OUTPUT_MISSING;
    message_key: "errors.conversation.planOutputMissing";
    retryable: true;
  };
};

type InterruptedMessageCompletionEvent = {
  event: ConversationEvent;
  payload: Record<string, unknown>;
};

type TerminalProjectionResult = {
  becameTerminal: boolean;
  recoveryAttemptId: string | null;
  planOutputMissingEvent: PlanOutputMissingEvent | null;
};

class RunningTurnRecoveryCycleError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "RunningTurnRecoveryCycleError";
  }
}

export class ConversationEventService {
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryInFlight: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: LinkSenseRedis,
    private readonly conversations: ConversationService,
    private readonly titleRefresh?: ConversationTitleRefresh,
    private readonly knowledgeSources?: TurnKnowledgeSourceStore,
    private readonly usageAnalytics?: Pick<
      UsageAnalyticsService,
      "captureTokenUsage"
    >,
  ) {}

  getRunningTurnRecoveryStatus(): Promise<RunningTurnRecoveryStatus> {
    return this.redis.runningTurnRecoveryStatus();
  }

  async emitInteractiveApplicationCustomEvent(input: {
    ownerId: string;
    conversationId: string;
    codexTurnId: string;
    event: unknown;
  }) {
    const eventInput = emitInteractiveApplicationCustomEventInputSchema.parse(
      input.event,
    );
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        ownerId: input.ownerId,
        archiveStatus: "active",
      },
      select: {
        applicationId: true,
        codexThreadId: true,
        interactiveApplicationPackageId: true,
      },
    });
    if (
      !conversation?.applicationId ||
      !conversation.codexThreadId ||
      !conversation.interactiveApplicationPackageId
    ) {
      throw new AppError("APPLICATION_CUSTOM_EVENT_INVALID");
    }
    const [turn, package_] = await Promise.all([
      this.prisma.conversationTurn.findFirst({
        where: {
          conversationId: input.conversationId,
          codexTurnId: input.codexTurnId,
          status: "running",
        },
      }),
      this.prisma.interactiveApplicationPackage.findFirst({
        where: {
          id: conversation.interactiveApplicationPackageId,
          applicationId: conversation.applicationId,
        },
      }),
    ]);
    if (!turn || !package_) {
      throw new AppError("APPLICATION_CUSTOM_EVENT_INVALID");
    }
    const manifest = interactiveApplicationManifestSchema.parse(
      package_.manifestJson,
    );
    const definition = manifest.custom_events.find(
      (candidate) => candidate.name === eventInput.name,
    );
    if (!definition) {
      throw new AppError("APPLICATION_CUSTOM_EVENT_INVALID");
    }
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    let validate: ReturnType<Ajv2020["compile"]>;
    try {
      validate = ajv.compile(definition.payload_schema);
    } catch {
      throw new AppError("APPLICATION_CUSTOM_EVENT_INVALID");
    }
    if (!validate(eventInput.payload)) {
      throw new AppError("APPLICATION_CUSTOM_EVENT_INVALID");
    }

    const eventId = randomUUID();
    const result = await this.prisma.$transaction(async (tx) => {
      const sequenceNo = await nextConversationEventSequence(
        tx,
        input.conversationId,
      );
      const params = {
        eventId,
        threadId: conversation.codexThreadId!,
        turnId: input.codexTurnId,
        name: definition.name,
        eventSchemaVersion: definition.schema_version,
        payload: eventInput.payload,
      };
      const payload = {
        schema_version: 1 as const,
        source: "linksense_runner" as const,
        method: "linksense/application/custom-event" as const,
        params,
      };
      const event = await tx.conversationEvent.create({
        data: {
          id: eventId,
          conversationId: input.conversationId,
          turnId: turn.id,
          sequenceNo,
          eventType: "linksense/application/custom-event",
          visibility: "user_visible",
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${input.conversationId}:${sequenceNo}`,
        },
      });
      return { event, payload };
    });
    const projected = projectEvent(result.event, result.payload);
    await this.redis.publishConversationEvent(input.conversationId, projected);
    return {
      accepted: true as const,
      event_id: eventId,
      sequence: Number(result.event.sequenceNo),
    };
  }

  async ingest(
    conversationId: string,
    input: IngestedRunnerEvent,
    deliveryId: string = randomUUID(),
  ) {
    if ("method" in input) {
      return this.ingestMethodEvent(conversationId, input, deliveryId);
    }
    if (input.eventType === "conversation.title.updated") {
      return this.ingestTitleUpdate(conversationId, input, deliveryId);
    }
    if (!input.turnId) {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    const projection = await this.resolveTurnProjection(
      conversationId,
      input.threadId,
      input.turnId,
    );
    if (projection.status === "pending") {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    if (projection.status === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }
    const turn = projection.turn;
    const completedMessageProjection =
      input.eventType === "conversation.message.completed"
        ? await this.projectCompletedAssistantMessage(
            turn,
            typeof input.payload.text === "string" ? input.payload.text : "",
          )
        : null;

    const capabilityReferences = [
      input.payload.capability_reference,
      input.payload.capability_fallback_reference,
    ].filter((value): value is string => typeof value === "string");
    const attachedCapability =
      capabilityReferences.length > 0
        ? (
            await this.prisma.conversationEvent.findMany({
              where: {
                conversationId,
                turnId: turn.id,
                eventType: "conversation.capability.attached",
              },
              select: { payloadJson: true },
            })
          )
            .map((event) => asObject(event.payloadJson))
            .find(
              (payload) =>
                capabilityReferences.includes(String(payload.name ?? "")) ||
                capabilityReferences.includes(
                  String(payload.capability_id ?? ""),
                ),
            )
        : undefined;
    const attachedCapabilityId =
      typeof attachedCapability?.capability_id === "string"
        ? attachedCapability.capability_id
        : undefined;
    const attachedCapabilityType =
      attachedCapability?.capability_type === "plugin" ||
      attachedCapability?.capability_type === "skill"
        ? attachedCapability.capability_type
        : undefined;
    const attachedCapabilityName =
      typeof attachedCapability?.name === "string"
        ? attachedCapability.name
        : undefined;

    const terminalStatus = terminalStatusFromEvent(input);
    const result = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(
          tx,
          conversationId,
          input.threadId,
        ))
      ) {
        return {
          event: null,
          payload: {},
          messageId: null,
          becameTerminal: false,
          ignored: true,
        };
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== turn.id ||
          existingEvent.eventType !== input.eventType
        ) {
          throw new Error("runner event delivery id collision");
        }
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
          messageId: null,
          becameTerminal: false,
          ignored: false,
        };
      }
      const nativeItemId =
        input.eventType === "conversation.message.completed" &&
        typeof input.payload.item_id === "string"
          ? input.payload.item_id
          : null;
      if (nativeItemId) {
        const existingNativeItem = await tx.conversationEvent.findFirst({
          where: {
            conversationId,
            turnId: turn.id,
            eventType: input.eventType,
            payloadJson: { path: ["item_id"], equals: nativeItemId },
          },
        });
        if (existingNativeItem) {
          return {
            event: existingNativeItem,
            payload: asObject(existingNativeItem.payloadJson),
            messageId: null,
            becameTerminal: false,
            ignored: false,
          };
        }
      }
      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      let payload: Record<string, unknown> = sanitizePayload(
        input.eventType,
        input.payload,
        attachedCapabilityName,
      );
      let messageId: string | null = null;

      if (input.eventType === "conversation.message.completed") {
        if (!completedMessageProjection) {
          throw new AppError("INTERNAL_ERROR");
        }
        const message = await createProjectedAssistantMessage(tx, {
          conversationId,
          turnId: turn.id,
          projection: completedMessageProjection,
        });
        messageId = message.id;
        payload = {
          schema_version: 1,
          message_id: message.id,
          role: "assistant",
          ...(typeof input.payload.item_id === "string"
            ? { item_id: input.payload.item_id }
            : {}),
        };
      } else if (input.eventType === "conversation.message.delta") {
        payload = {
          schema_version: 1,
          message_id: stableStreamingMessageId(turn.id),
          role: "assistant",
          delta:
            typeof input.payload.delta === "string" ? input.payload.delta : "",
        };
      } else if (input.eventType === "conversation.reconnect") {
        payload = {
          schema_version: 1,
          codex_turn_id: turn.codexTurnId,
          reason_code: "transport_interrupted",
          will_retry: true,
          message_key: "conversation.codexReconnecting",
        };
      } else if (input.eventType === "conversation.status.changed") {
        payload = {
          schema_version: 1,
          turn_id: turn.id,
          turn_status: terminalStatus ?? "running",
          conversation_execution_status: terminalStatus ?? "running",
        };
      } else if (input.eventType === "conversation.capability.used") {
        if (
          !attachedCapabilityId ||
          !attachedCapabilityType ||
          !attachedCapabilityName ||
          input.payload.capability_type !== attachedCapabilityType
        ) {
          return {
            event: null,
            payload: {},
            messageId: null,
            becameTerminal: false,
            ignored: true,
          };
        }
        payload = {
          schema_version: 1,
          capability_id: attachedCapabilityId,
          capability_type: attachedCapabilityType,
          usage_type:
            attachedCapabilityType === "plugin" ? "auto_plugin" : "auto_skill",
          name: attachedCapabilityName,
          safe_summary:
            typeof input.payload.safe_summary === "string"
              ? input.payload.safe_summary
              : "capability_invoked",
        };
      } else if (
        input.eventType === "conversation.completed" ||
        input.eventType === "conversation.interrupted"
      ) {
        payload = {
          schema_version: 1,
          turn_id: turn.id,
          codex_turn_id: turn.codexTurnId,
          status:
            input.eventType === "conversation.completed"
              ? "completed"
              : "interrupted",
        };
      }

      let becameTerminal = false;
      let automationOutcome: CompletedAutomationOutcome = "not_automation";
      if (terminalStatus) {
        const terminalAt = new Date();
        const update = await tx.conversationTurn.updateMany({
          where: { id: turn.id, status: "running" },
          data: {
            status: terminalStatus,
            completedAt: terminalStatus === "interrupted" ? null : terminalAt,
            ...(terminalStatus === "interrupted"
              ? {
                  interruptRequestedAt: turn.interruptRequestedAt ?? terminalAt,
                  interruptedAt: terminalAt,
                }
              : {}),
            ...(terminalStatus === "failed"
              ? {
                  errorCode:
                    typeof input.payload.error_code === "string"
                      ? input.payload.error_code
                      : "CODEX_TURN_FAILED",
                }
              : {}),
          },
        });
        becameTerminal = update.count === 1;
        if (becameTerminal) {
          await tx.conversationUserInputRequest.updateMany({
            where: {
              turnId: turn.id,
              status: { in: ["pending", "answering"] },
            },
            data: {
              status: "cancelled",
              resolvedAt: terminalAt,
              responseContentJson: Prisma.DbNull,
            },
          });
          await settlePreparingPlanReview(
            tx,
            conversationId,
            turn.id,
            terminalStatus,
            terminalAt,
          );
          if (terminalStatus === "completed") {
            automationOutcome = await this.settleCompletedAutomationRun(
              tx,
              conversationId,
              turn,
              terminalAt,
            );
          }
          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              lastTurnStatus: terminalStatus,
              ...(terminalStatus === "failed" ||
              (terminalStatus === "completed" &&
                automationOutcome !== "empty_result")
                ? { completionUnread: true }
                : {}),
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: turn.submittedBy,
              action:
                terminalStatus === "interrupted"
                  ? "conversation_turn_interrupted"
                  : terminalStatus === "failed"
                    ? "conversation_turn_failed"
                    : "conversation_turn_completed",
              targetType: "conversation_turn",
              targetId: turn.id,
              result: terminalStatus === "failed" ? "failure" : "success",
              metadataJson: { conversation_id: conversationId },
            },
          });
        }
      }

      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: turn.id,
          sequenceNo,
          eventType: input.eventType,
          visibility: input.visibility,
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      if (automationOutcome === "empty_result") {
        await this.createAutomationEmptyResultEvent(
          tx,
          conversationId,
          turn.id,
        );
      }
      return {
        event,
        payload,
        messageId,
        becameTerminal,
        ignored: false,
      };
    });

    if (result.ignored || !result.event) {
      return { accepted: true, ignored: true };
    }

    if (terminalStatus) {
      await this.confirmTerminalRecovery(conversationId, turn);
    }
    if (input.visibility === "internal_sanitized") {
      return { accepted: true };
    }
    const projectedEvent = projectEvent(result.event, result.payload);
    await this.redis.publishConversationEvent(conversationId, projectedEvent);
    if (terminalStatus) {
      // A terminal delivery may be retried after the database transaction commits
      // but before capacity release or FIFO advancement completes. The slot is
      // tokenized by the local turn id, so replaying these post-actions cannot
      // release a newer turn that already occupies the same conversation.
      await this.redis.releaseTurnSlot(conversationId, turn.id);
      const head = await this.prisma.pendingRequest.findFirst({
        where: { conversationId },
        orderBy: { queueNo: "asc" },
      });
      if (head?.status === "waiting_previous_turn") {
        try {
          await this.conversations.startPending(
            turn.submittedBy,
            conversationId,
            head.id,
            {},
          );
        } catch (error) {
          // Deterministic domain failures (a newer turn won the lock, the head
          // changed, the user was disabled, or preflight blocked) are already
          // represented in current state. Infrastructure failures must reject
          // the delivery so the runner's durable outbox retries it.
          if (!(error instanceof AppError)) throw error;
        }
      }
    }
    if (terminalStatus === "completed" && result.becameTerminal) {
      this.titleRefresh?.schedule(conversationId);
    }
    return { accepted: true, event: projectedEvent };
  }

  /**
   * Persists one validated method event. Codex notifications retain their
   * native method; LinkSense-owned methods retain their separate source. Local
   * projections never create a second substitute lifecycle event.
   */
  private async ingestMethodEvent(
    conversationId: string,
    input: MethodRunnerEventInput,
    deliveryId: string,
  ) {
    if (input.method === "thread/tokenUsage/updated") {
      const usageResult = this.usageAnalytics
        ? await this.usageAnalytics.captureTokenUsage(
            conversationId,
            input.params,
          )
        : { accepted: true };
      if (!usageResult.accepted || usageResult.reason_code) {
        return usageResult;
      }
      return this.ingestNativeTokenUsageUpdate(
        conversationId,
        input,
        deliveryId,
      );
    }
    if (input.method === "thread/name/updated") {
      return this.ingestNativeTitleUpdate(conversationId, input, deliveryId);
    }
    if (input.method === "thread/goal/updated") {
      return this.ingestNativeGoalUpdate(conversationId, input, deliveryId);
    }
    if (input.method === "thread/goal/cleared") {
      return this.ingestNativeGoalClear(conversationId, input, deliveryId);
    }
    if (input.method === "serverRequest/resolved") {
      return this.ingestNativeServerRequestResolved(
        conversationId,
        input,
        deliveryId,
      );
    }

    const threadId = nativeThreadId(input.params);
    const turnId = nativeTurnId(input.params);
    if (!threadId || !turnId) {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    if (input.method === "turn/started") {
      await this.attachGoalContinuation(
        conversationId,
        threadId,
        turnId,
        nativeTurnStartedAt(input.params),
      );
    }
    const projection = await this.resolveTurnProjection(
      conversationId,
      threadId,
      turnId,
    );
    if (projection.status === "pending") {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    if (projection.status === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }
    const turn = projection.turn;

    const terminalStatus = nativeTerminalStatus(input);
    const contextWindowExceeded = nativeContextWindowExceeded(input);
    const contextWindowRecoveryEligible =
      contextWindowExceeded &&
      turn.taskKind === "turn" &&
      projection.attempt.attemptNo < MAX_CONTEXT_WINDOW_NATIVE_ATTEMPTS &&
      turn.status === "running" &&
      turn.interruptRequestedAt === null;
    const terminalFailureMessage =
      terminalStatus === "failed"
        ? nativeTurnFailureMessage(input.params.turn)
        : null;
    const nativeItem = asObject(input.params.item);
    const isCompletedAssistantOutput =
      input.method === "item/completed" &&
      (nativeItem.type === "agentMessage" || nativeItem.type === "plan") &&
      typeof nativeItem.id === "string";
    const nativeItemId = isCompletedAssistantOutput
      ? String(nativeItem.id)
      : null;
    const completedMessageProjection = isCompletedAssistantOutput
      ? await this.projectCompletedAssistantMessage(
          turn,
          typeof nativeItem.text === "string" ? nativeItem.text : "",
        )
      : null;
    const interruptedAssistantOutputs =
      terminalStatus === "interrupted"
        ? await this.loadInterruptedAssistantOutputs(
            conversationId,
            turn.id,
            turnId,
            turn,
          )
        : [];

    const result = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(tx, conversationId, threadId))
      ) {
        return {
          event: null,
          payload: {},
          becameTerminal: false,
          recoveryAttemptId: null,
          goalContinues: false,
          interruptedMessageEvents: [] as InterruptedMessageCompletionEvent[],
          planOutputMissingEvent: null,
          ignored: true,
        };
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== turn.id ||
          existingEvent.eventType !== input.method
        ) {
          throw new Error("runner event delivery id collision");
        }
        const existingRecoveryAttempt =
          terminalStatus === "failed" && contextWindowExceeded
            ? await tx.conversationTurnAttempt.findUnique({
                where: {
                  turnId_attemptNo: {
                    turnId: turn.id,
                    attemptNo: projection.attempt.attemptNo + 1,
                  },
                },
                select: { id: true, status: true },
              })
            : null;
        const activeGoal =
          turn.taskKind === "goal"
            ? await tx.conversationGoal.findUnique({
                where: { conversationId },
              })
            : null;
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
          becameTerminal: false,
          recoveryAttemptId:
            existingRecoveryAttempt?.status === "pending" ||
            existingRecoveryAttempt?.status === "running"
              ? existingRecoveryAttempt.id
              : null,
          goalContinues:
            activeGoal?.activeTurnId === turn.id &&
            activeGoal.status === "active",
          interruptedMessageEvents: interruptedAssistantOutputs.flatMap(
            (output) =>
              output.existingCompletion
                ? [output.existingCompletion]
                : [],
          ),
          planOutputMissingEvent: null,
          ignored: false,
        };
      }

      if (nativeItemId) {
        const existingNativeItem = await tx.conversationEvent.findFirst({
          where: {
            conversationId,
            turnId: turn.id,
            eventType: input.method,
            payloadJson: {
              path: ["params", "item", "id"],
              equals: nativeItemId,
            },
          },
        });
        if (existingNativeItem) {
          return {
            event: existingNativeItem,
            payload: asObject(existingNativeItem.payloadJson),
            becameTerminal: false,
            recoveryAttemptId: null,
            goalContinues: false,
            interruptedMessageEvents:
              [] as InterruptedMessageCompletionEvent[],
            planOutputMissingEvent: null,
            ignored: false,
          };
        }
      }

      const local: Record<string, unknown> = {};
      const stopHookSupersededItemId = blockedStopHookSupersededItemId(input);
      if (stopHookSupersededItemId) {
        const supersededOutput = await findStopHookSupersededOutput(
          tx,
          conversationId,
          turn.id,
          turnId,
          stopHookSupersededItemId,
        );
        if (supersededOutput) {
          local.superseded_message_id = supersededOutput.messageId;
          local.superseded_item_id = supersededOutput.itemId;
        }
      }
      if (isCompletedAssistantOutput) {
        if (!completedMessageProjection) {
          throw new AppError("INTERNAL_ERROR");
        }
        const message = await createProjectedAssistantMessage(tx, {
          conversationId,
          turnId: turn.id,
          projection: completedMessageProjection,
        });
        local.message_id = message.id;
        if (
          nativeItem.type === "plan" &&
          turn.collaborationMode === "plan" &&
          typeof nativeItem.id === "string" &&
          completedMessageProjection.contentText.trim().length > 0
        ) {
          const planReview = await upsertNativePlanReview(
            tx,
            conversationId,
            turn,
            message.id,
            nativeItem.id,
          );
          local.plan_review_id = planReview.id;
        }
      }
      if (
        input.method === "item/tool/requestUserInput" ||
        input.method === "linksense/form/request"
      ) {
        const userInputRequest = await upsertUserInputRequest(
          tx,
          conversationId,
          turn,
          input.method,
          input.params,
        );
        local.user_input_request_id = userInputRequest.id;
      }

      let becameTerminal = false;
      let recoveryAttemptId: string | null = null;
      let goalContinues = false;
      let effectiveVisibility =
        input.method === "error" && contextWindowRecoveryEligible
          ? "internal_sanitized"
          : input.visibility;
      let automationOutcome: CompletedAutomationOutcome = "not_automation";
      let planOutputMissing = false;
      const interruptedMessageEvents: InterruptedMessageCompletionEvent[] = [];
      if (terminalStatus) {
        const terminalAt = new Date();
        if (terminalStatus === "interrupted") {
          for (const output of interruptedAssistantOutputs) {
            if (output.existingCompletion) {
              interruptedMessageEvents.push(output.existingCompletion);
              continue;
            }
            if (!output.projection) continue;
            const message = await createProjectedAssistantMessage(tx, {
              conversationId,
              turnId: turn.id,
              projection: output.projection,
              now: terminalAt,
            });
            const messageSequenceNo = await nextConversationEventSequence(
              tx,
              conversationId,
            );
            const messagePayload = {
              schema_version: 1 as const,
              message_id: message.id,
              role: "assistant" as const,
              item_id: output.itemId,
            };
            const messageEvent = await tx.conversationEvent.create({
              data: {
                conversationId,
                turnId: turn.id,
                sequenceNo: messageSequenceNo,
                eventType: "conversation.message.completed",
                visibility: "user_visible",
                payloadJson: messagePayload,
                sseEventId: `${conversationId}:${messageSequenceNo}`,
              },
            });
            interruptedMessageEvents.push({
              event: messageEvent,
              payload: messagePayload,
            });
          }
        }
        if (projection.attemptPersisted) {
          await tx.conversationTurnAttempt.updateMany({
            where: {
              id: projection.attempt.id,
              status: { in: ["pending", "running"] },
            },
            data: {
              status: terminalStatus,
              completedAt: terminalAt,
              ...(terminalStatus === "failed"
                ? {
                    errorCode: contextWindowExceeded
                      ? "CONTEXT_WINDOW_EXCEEDED"
                      : "CODEX_TURN_FAILED",
                    errorMessage: terminalFailureMessage,
                  }
                : {}),
            },
          });
        }

        const currentTurn = await tx.conversationTurn.findUnique({
          where: { id: turn.id },
          select: {
            status: true,
            taskKind: true,
            interruptRequestedAt: true,
          },
        });
        const currentGoal =
          currentTurn?.taskKind === "goal"
            ? await tx.conversationGoal.findUnique({
                where: { conversationId },
              })
            : null;
        goalContinues =
          currentGoal?.activeTurnId === turn.id &&
          currentGoal.status === "active";
        const shouldRecoverContextWindow =
          terminalStatus === "failed" &&
          contextWindowExceeded &&
          currentTurn?.taskKind === "turn" &&
          projection.attemptPersisted &&
          projection.attempt.attemptNo < MAX_CONTEXT_WINDOW_NATIVE_ATTEMPTS &&
          currentTurn?.status === "running" &&
          currentTurn.interruptRequestedAt === null;

        if (shouldRecoverContextWindow) {
          effectiveVisibility = "internal_sanitized";
          const recoveryAttempt = await tx.conversationTurnAttempt.upsert({
            where: {
              turnId_attemptNo: {
                turnId: turn.id,
                attemptNo: projection.attempt.attemptNo + 1,
              },
            },
            create: {
              turnId: turn.id,
              attemptNo: projection.attempt.attemptNo + 1,
              kind: "context_recovery",
              codexThreadId: threadId,
              sourceCodexTurnId: turnId,
              status: "pending",
              ...(projection.attempt.continuationContextJson !== null
                ? {
                    continuationContextJson: projection.attempt
                      .continuationContextJson as Prisma.InputJsonValue,
                  }
                : {}),
            },
            update: {},
            select: { id: true, status: true },
          });
          if (
            recoveryAttempt.status === "pending" ||
            recoveryAttempt.status === "running"
          ) {
            recoveryAttemptId = recoveryAttempt.id;
          }
        } else if (!goalContinues) {
          const update = await tx.conversationTurn.updateMany({
            where: { id: turn.id, status: "running" },
            data: {
              status: terminalStatus,
              completedAt: terminalStatus === "interrupted" ? null : terminalAt,
              ...(terminalStatus === "interrupted"
                ? {
                    interruptRequestedAt:
                      turn.interruptRequestedAt ?? terminalAt,
                    interruptedAt: terminalAt,
                  }
                : {}),
              ...(terminalStatus === "failed"
                ? {
                    errorCode: "CODEX_TURN_FAILED",
                    errorMessage: terminalFailureMessage,
                  }
                : {}),
            },
          });
          becameTerminal = update.count === 1;
          if (becameTerminal) {
            await tx.conversationUserInputRequest.updateMany({
              where: {
                turnId: turn.id,
                status: { in: ["pending", "answering"] },
              },
              data: {
                status: "cancelled",
                resolvedAt: terminalAt,
                responseContentJson: Prisma.DbNull,
              },
            });
            await settlePreparingPlanReview(
              tx,
              conversationId,
              turn.id,
              terminalStatus,
              terminalAt,
            );
            if (
              terminalStatus === "completed" &&
              turn.taskKind === "turn" &&
              turn.collaborationMode === "plan"
            ) {
              planOutputMissing = await this.isPlanOutputMissing(
                tx,
                conversationId,
                turn,
              );
            }
            if (currentGoal?.activeTurnId === turn.id) {
              await tx.conversationGoal.updateMany({
                where: {
                  conversationId,
                  activeTurnId: turn.id,
                },
                data: { activeTurnId: null },
              });
            }
            if (terminalStatus === "completed") {
              automationOutcome = await this.settleCompletedAutomationRun(
                tx,
                conversationId,
                turn,
                terminalAt,
              );
            }
            await tx.conversation.update({
              where: { id: conversationId },
              data: {
                lastTurnStatus: terminalStatus,
                ...(terminalStatus === "failed" ||
                (terminalStatus === "completed" &&
                  automationOutcome !== "empty_result")
                  ? { completionUnread: true }
                  : {}),
              },
            });
            await tx.auditLog.create({
              data: {
                actorId: turn.submittedBy,
                action:
                  terminalStatus === "interrupted"
                    ? "conversation_turn_interrupted"
                    : terminalStatus === "failed"
                      ? "conversation_turn_failed"
                      : "conversation_turn_completed",
                targetType: "conversation_turn",
                targetId: turn.id,
                result: terminalStatus === "failed" ? "failure" : "success",
                metadataJson: { conversation_id: conversationId },
              },
            });
          }
        }
      }

      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      const payload = {
        schema_version:
          input.method === "linksense/form/request"
            ? (1 as const)
            : (2 as const),
        source:
          input.method === "linksense/form/request"
            ? ("linksense_runner" as const)
            : ("codex_app_server" as const),
        method: input.method,
        params:
          completedMessageProjection && isCompletedAssistantOutput
            ? {
                ...input.params,
                item: {
                  ...nativeItem,
                  text: completedMessageProjection.contentText,
                },
              }
            : input.params,
        ...(Object.keys(local).length > 0 ? { local } : {}),
      };
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: turn.id,
          sequenceNo,
          eventType: input.method,
          visibility: effectiveVisibility,
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      if (automationOutcome === "empty_result") {
        await this.createAutomationEmptyResultEvent(
          tx,
          conversationId,
          turn.id,
        );
      }
      const planOutputMissingEvent = planOutputMissing
        ? await this.createPlanOutputMissingEvent(tx, conversationId, turn.id)
        : null;
      return {
        event,
        payload,
        becameTerminal,
        recoveryAttemptId,
        goalContinues,
        interruptedMessageEvents,
        planOutputMissingEvent,
        ignored: false,
      };
    });

    if (result.ignored || !result.event) {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }

    if (terminalStatus && !result.goalContinues) {
      await this.confirmTerminalRecovery(conversationId, turn);
    }
    if (result.recoveryAttemptId) {
      await this.conversations
        .recoverContextWindowAttempt(result.recoveryAttemptId)
        .catch(() => undefined);
      return { accepted: true };
    }
    for (const interruptedMessageEvent of result.interruptedMessageEvents) {
      await this.redis.publishConversationEvent(
        conversationId,
        projectEvent(
          interruptedMessageEvent.event,
          interruptedMessageEvent.payload,
        ),
      );
    }
    if (result.event.visibility !== "internal_sanitized") {
      const projection = projectEvent(result.event, result.payload);
      await this.redis.publishConversationEvent(conversationId, projection);
    }
    if (result.planOutputMissingEvent) {
      await this.redis.publishConversationEvent(
        conversationId,
        projectEvent(
          result.planOutputMissingEvent.event,
          result.planOutputMissingEvent.payload,
        ),
      );
    }
    if (terminalStatus && !result.goalContinues) {
      await this.runTerminalPostActions(
        conversationId,
        turn.id,
        turn.submittedBy,
      );
    }
    if (terminalStatus === "completed" && result.becameTerminal) {
      this.titleRefresh?.schedule(conversationId);
    }
    return result.event.visibility === "internal_sanitized"
      ? { accepted: true }
      : {
          accepted: true,
          event: projectEvent(result.event, result.payload),
        };
  }

  private async ingestNativeTokenUsageUpdate(
    conversationId: string,
    input: MethodRunnerEventInput,
    deliveryId: string,
  ) {
    const threadId = nativeThreadId(input.params);
    const turnId = nativeTurnId(input.params);
    if (!threadId || !turnId) {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    const projection = await this.resolveTurnProjection(
      conversationId,
      threadId,
      turnId,
    );
    if (projection.status === "pending") {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    if (projection.status === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }
    const turn = projection.turn;

    const result = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveConversationBranch(tx, conversationId, threadId))) {
        return { event: null, payload: {}, ignored: true };
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== turn.id ||
          existingEvent.eventType !== input.method
        ) {
          throw new Error("runner event delivery id collision");
        }
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
          ignored: false,
        };
      }
      const sequenceNo = await nextConversationEventSequence(tx, conversationId);
      const payload = nativeEventPayload(input);
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: turn.id,
          sequenceNo,
          eventType: input.method,
          visibility: "user_collapsed",
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { event, payload, ignored: false };
    });

    if ("accepted" in result && result.accepted === false) {
      return result;
    }
    if (result.ignored || !result.event) {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }
    const projectedEvent = projectEvent(result.event, result.payload);
    await this.redis.publishConversationEvent(conversationId, projectedEvent);
    return { accepted: true, event: projectedEvent };
  }

  private async ingestNativeServerRequestResolved(
    conversationId: string,
    input: MethodRunnerEventInput,
    deliveryId: string,
  ) {
    const threadId = nativeThreadId(input.params);
    const requestId = input.params.requestId;
    if (
      !threadId ||
      typeof requestId !== "number" ||
      !Number.isSafeInteger(requestId) ||
      requestId < 0
    ) {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    const projectedRequest =
      await this.prisma.conversationUserInputRequest.findFirst({
        where: {
          conversationId,
          codexThreadId: threadId,
          nativeRequestId: BigInt(requestId),
        },
        orderBy: { createdAt: "desc" },
      });
    if (!projectedRequest) {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveConversationBranch(tx, conversationId, threadId))) {
        return { event: null, payload: {}, ignored: true };
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
          ignored: false,
        };
      }
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM conversation_user_input_requests
        WHERE id = ${projectedRequest.id}::uuid
        FOR UPDATE
      `;
      const current = await tx.conversationUserInputRequest.findUnique({
        where: { id: projectedRequest.id },
      });
      if (!current) return { event: null, payload: {}, ignored: true };
      if (current.status === "pending" || current.status === "answering") {
        await tx.conversationUserInputRequest.update({
          where: { id: current.id },
          data: {
            status:
              current.status === "answering"
                ? current.resolvedAction === "accept"
                  ? "answered"
                  : "cancelled"
                : "expired",
            resolvedAction:
              current.status === "answering"
                ? (current.resolvedAction ?? "cancel")
                : "cancel",
            resolvedAt: new Date(),
          },
        });
      }
      const sequenceNo = await nextConversationEventSequence(tx, conversationId);
      const payload = {
        ...nativeEventPayload(input),
        local: { user_input_request_id: current.id },
      };
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: current.turnId,
          sequenceNo,
          eventType: input.method,
          visibility: input.visibility,
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { event, payload, ignored: false };
    });
    if (result.ignored || !result.event) {
      return { accepted: true, ignored: true };
    }
    const projectedEvent = projectEvent(result.event, result.payload);
    await this.redis.publishConversationEvent(conversationId, projectedEvent);
    return { accepted: true, event: projectedEvent };
  }

  private async ingestNativeTitleUpdate(
    conversationId: string,
    input: MethodRunnerEventInput,
    deliveryId: string,
  ) {
    const threadId = nativeThreadId(input.params);
    if (!threadId) {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    const projection = await this.resolveThreadProjection(
      conversationId,
      threadId,
    );
    if (projection === "pending") {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    if (projection === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(tx, conversationId, threadId))
      ) {
        return { event: null, payload: {}, ignored: true };
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== null ||
          existingEvent.eventType !== input.method
        ) {
          throw new Error("runner event delivery id collision");
        }
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
          ignored: false,
        };
      }

      // LinkSense uses the administrator-selected managed chat model for task
      // naming. Persist the native Codex notification for protocol fidelity,
      // but do not let it race the configured title generator.
      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      const payload = {
        schema_version: 2 as const,
        source: "codex_app_server" as const,
        method: input.method,
        params: input.params,
      };
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: null,
          sequenceNo,
          eventType: input.method,
          visibility: input.visibility,
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { event, payload, ignored: false };
    });

    if (result.ignored || !result.event) {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }

    if (input.visibility === "internal_sanitized") {
      return { accepted: true };
    }
    const projectedEvent = projectEvent(result.event, result.payload);
    await this.redis.publishConversationEvent(conversationId, projectedEvent);
    return { accepted: true, event: projectedEvent };
  }

  private async ingestNativeGoalUpdate(
    conversationId: string,
    input: MethodRunnerEventInput,
    deliveryId: string,
  ) {
    const threadId = nativeThreadId(input.params);
    const goalTurnId = nativeTurnId(input.params);
    const parsedGoal = runnerCodexGoalSchema.safeParse(input.params.goal);
    if (
      !threadId ||
      !parsedGoal.success ||
      parsedGoal.data.threadId !== threadId
    ) {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    const projection = await this.resolveThreadProjection(
      conversationId,
      threadId,
    );
    if (projection === "pending") {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    if (projection === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(tx, conversationId, threadId))
      ) {
        return null;
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== null ||
          existingEvent.eventType !== input.method
        ) {
          throw new Error("runner event delivery id collision");
        }
        return {
          pending: false as const,
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
        };
      }
      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { ownerId: true },
      });
      if (!conversation) return null;
      const existingGoal = await tx.conversationGoal.findUnique({
        where: { conversationId },
      });
      let activeGoalTurnId: string | null;
      if (goalTurnId) {
        activeGoalTurnId = await this.promoteNativeGoalTurn(
          tx,
          conversationId,
          threadId,
          goalTurnId,
        );
        if (!activeGoalTurnId) return { pending: true as const };
      } else {
        activeGoalTurnId = existingGoal?.activeTurnId ?? null;
      }
      if (!activeGoalTurnId) {
        const activeGoalTurn = await tx.conversationTurn.findFirst({
          where: {
            conversationId,
            codexThreadId: threadId,
            taskKind: "goal",
            status: "running",
          },
          orderBy: { sequenceNo: "desc" },
          select: { id: true },
        });
        activeGoalTurnId = activeGoalTurn?.id ?? null;
      }
      await upsertConversationGoal(tx, {
        conversationId,
        ownerId: conversation.ownerId,
        goal: parsedGoal.data,
        activeTurnId:
          parsedGoal.data.status === "active" ? activeGoalTurnId : null,
      });
      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      const payload = nativeEventPayload(input);
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: null,
          sequenceNo,
          eventType: input.method,
          visibility: input.visibility,
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { pending: false as const, event, payload };
    });
    if (!result) {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }
    if (result.pending) {
      return { accepted: false, reason_code: "TURN_PROJECTION_PENDING" };
    }
    if (result.event.visibility !== "internal_sanitized") {
      const projected = projectEvent(result.event, result.payload);
      await this.redis.publishConversationEvent(conversationId, projected);
      return { accepted: true, event: projected };
    }
    return { accepted: true };
  }

  private async promoteNativeGoalTurn(
    tx: Prisma.TransactionClient,
    conversationId: string,
    threadId: string,
    codexTurnId: string,
  ): Promise<string | null> {
    const attempt = await tx.conversationTurnAttempt.findUnique({
      where: { codexTurnId },
      select: { turnId: true },
    });
    const projectionTurnId = attempt?.turnId;
    if (!projectionTurnId) return null;

    const lockedTurns = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM conversation_turns
      WHERE id = ${projectionTurnId}::uuid
        AND conversation_id = ${conversationId}::uuid
        AND codex_thread_id = ${threadId}
      FOR UPDATE
    `;
    if (lockedTurns.length !== 1) return null;

    const turn = await tx.conversationTurn.findUnique({
      where: { id: projectionTurnId },
      select: {
        id: true,
        conversationId: true,
        codexThreadId: true,
        taskKind: true,
        status: true,
      },
    });
    if (
      !turn ||
      turn.conversationId !== conversationId ||
      turn.codexThreadId !== threadId ||
      (turn.taskKind !== "turn" && turn.taskKind !== "goal")
    ) {
      return null;
    }
    if (turn.taskKind === "goal") return turn.id;

    const primaryAttempt = await tx.conversationTurnAttempt.updateMany({
      where: {
        turnId: turn.id,
        attemptNo: 1,
        kind: "primary",
      },
      data: { kind: "goal_primary" },
    });
    if (primaryAttempt.count !== 1) throw new AppError("CONFLICT");

    const promotedTurn = await tx.conversationTurn.updateMany({
      where: {
        id: turn.id,
        conversationId,
        codexThreadId: threadId,
        taskKind: "turn",
      },
      data: { taskKind: "goal" },
    });
    if (promotedTurn.count !== 1) throw new AppError("CONFLICT");
    return turn.id;
  }

  private async ingestNativeGoalClear(
    conversationId: string,
    input: MethodRunnerEventInput,
    deliveryId: string,
  ) {
    const threadId = nativeThreadId(input.params);
    if (!threadId) {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    const projection = await this.resolveThreadProjection(
      conversationId,
      threadId,
    );
    if (projection === "pending") {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    if (projection === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(tx, conversationId, threadId))
      ) {
        return null;
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== null ||
          existingEvent.eventType !== input.method
        ) {
          throw new Error("runner event delivery id collision");
        }
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
        };
      }
      await tx.conversationGoal.deleteMany({
        where: { conversationId, codexThreadId: threadId },
      });
      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      const payload = nativeEventPayload(input);
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: null,
          sequenceNo,
          eventType: input.method,
          visibility: input.visibility,
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { event, payload };
    });
    if (!result) {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }
    if (result.event.visibility !== "internal_sanitized") {
      const projected = projectEvent(result.event, result.payload);
      await this.redis.publishConversationEvent(conversationId, projected);
      return { accepted: true, event: projected };
    }
    return { accepted: true };
  }

  private async runTerminalPostActions(
    conversationId: string,
    turnId: string,
    submittedBy: string,
  ): Promise<void> {
    await this.redis.releaseTurnSlot(conversationId, turnId);
    const head = await this.prisma.pendingRequest.findFirst({
      where: { conversationId },
      orderBy: { queueNo: "asc" },
    });
    if (!head || head.status !== "waiting_previous_turn") return;
    try {
      await this.conversations.startPending(
        submittedBy,
        conversationId,
        head.id,
        {},
      );
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }

  private async confirmTerminalRecovery(
    conversationId: string,
    turn: {
      id: string;
      submittedBy: string;
      capabilityGeneration: string;
    },
  ): Promise<void> {
    await this.conversations.runnerForRecovery().confirmRecovery({
      conversationId,
      ownerId: turn.submittedBy,
      projectionTurnId: turn.id,
      capabilityGeneration: turn.capabilityGeneration,
    });
  }

  private async settleCompletedAutomationRun(
    tx: Prisma.TransactionClient,
    conversationId: string,
    turn: {
      id: string;
      submittedBy: string;
      idempotencyKey: string | null;
    },
    completedAt: Date,
  ): Promise<CompletedAutomationOutcome> {
    const identity: Prisma.AutomationRunWhereInput[] = [{ turnId: turn.id }];
    if (turn.idempotencyKey) {
      identity.push({ idempotencyKey: turn.idempotencyKey });
    }

    const run = await tx.automationRun.findFirst({
      where: {
        ownerId: turn.submittedBy,
        conversationId,
        status: { in: ["dispatching", "queued", "started"] },
        completedAt: null,
        OR: identity,
      },
      select: { id: true, automationId: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!run) return "not_automation";

    const [assistantMessages, artifact] = await Promise.all([
      tx.conversationMessage.findMany({
        where: {
          conversationId,
          turnId: turn.id,
          role: "assistant",
        },
        select: { contentText: true },
      }),
      tx.conversationFile.findFirst({
        where: {
          conversationId,
          turnId: turn.id,
          kind: "artifact",
          status: "registered",
          downloadable: true,
        },
        select: { id: true },
      }),
    ]);
    const hasDisplayableResult =
      assistantMessages.some(
        (message) => message.contentText.trim().length > 0,
      ) || Boolean(artifact);

    if (hasDisplayableResult) {
      const updated = await tx.automationRun.updateMany({
        where: {
          id: run.id,
          status: { in: ["dispatching", "queued", "started"] },
          completedAt: null,
        },
        data: { completedAt, errorCode: null },
      });
      return updated.count === 1 ? "completed" : "not_automation";
    }

    const failed = await tx.automationRun.updateMany({
      where: {
        id: run.id,
        status: { in: ["dispatching", "queued", "started"] },
        completedAt: null,
      },
      data: {
        status: "failed",
        turnId: null,
        pendingRequestId: null,
        errorCode: AUTOMATION_EMPTY_RESULT,
      },
    });
    if (failed.count !== 1) return "not_automation";

    const latestRun = await tx.automationRun.findFirst({
      where: { automationId: run.automationId },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (latestRun?.id === run.id) {
      await tx.automation.updateMany({
        where: { id: run.automationId, deletedAt: null },
        data: {
          lastRunStatus: "failed",
          lastErrorCode: AUTOMATION_EMPTY_RESULT,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: turn.submittedBy,
        action: "automation_run_empty_result",
        targetType: "automation_run",
        targetId: run.id,
        result: "failure",
        metadataJson: {
          automation_id: run.automationId,
          conversation_id: conversationId,
          turn_id: turn.id,
          reason_code: AUTOMATION_EMPTY_RESULT,
        },
      },
    });
    return "empty_result";
  }

  private async createAutomationEmptyResultEvent(
    tx: Prisma.TransactionClient,
    conversationId: string,
    turnId: string,
  ): Promise<void> {
    const sequenceNo = await nextConversationEventSequence(tx, conversationId);
    await tx.conversationEvent.create({
      data: {
        conversationId,
        turnId,
        sequenceNo,
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          schema_version: 1,
          error_code: AUTOMATION_EMPTY_RESULT,
          message_key: "errors.automation.emptyResult",
          retryable: true,
        },
        sseEventId: `${conversationId}:${sequenceNo}`,
      },
    });
  }

  private async createPlanOutputMissingEvent(
    tx: Prisma.TransactionClient,
    conversationId: string,
    turnId: string,
  ) {
    const sequenceNo = await nextConversationEventSequence(tx, conversationId);
    const payload: PlanOutputMissingEvent["payload"] = {
      schema_version: 1,
      error_code: PLAN_OUTPUT_MISSING,
      message_key: "errors.conversation.planOutputMissing",
      retryable: true,
    };
    const event = await tx.conversationEvent.create({
      data: {
        conversationId,
        turnId,
        sequenceNo,
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: payload,
        sseEventId: `${conversationId}:${sequenceNo}`,
      },
    });
    return { event, payload };
  }

  private async isPlanOutputMissing(
    tx: Prisma.TransactionClient,
    conversationId: string,
    turn: {
      id: string;
      taskKind: string;
      collaborationMode: string;
    },
  ): Promise<boolean> {
    if (
      turn.taskKind !== "turn" ||
      turn.collaborationMode !== "plan"
    ) {
      return false;
    }
    const planReview = await tx.conversationPlanReview.findFirst({
      where: {
        conversationId,
        sourceTurnId: turn.id,
      },
      select: { id: true },
    });
    return planReview === null;
  }

  private async publishPersistedPlanOutputMissingEvent(
    conversationId: string,
    turnId: string,
  ): Promise<void> {
    const [event, planReview] = await Promise.all([
      this.prisma.conversationEvent.findFirst({
        where: {
          conversationId,
          turnId,
          eventType: "conversation.error",
          payloadJson: {
            path: ["error_code"],
            equals: PLAN_OUTPUT_MISSING,
          },
        },
        orderBy: { sequenceNo: "desc" },
      }),
      this.prisma.conversationPlanReview.findFirst({
        where: { conversationId, sourceTurnId: turnId },
        select: { id: true },
      }),
    ]);
    if (!event || planReview) return;
    await this.redis.publishConversationEvent(
      conversationId,
      projectEvent(event, asObject(event.payloadJson)),
    );
  }

  private async reconcileTerminalProjection(
    conversationId: string,
    turn: {
      id: string;
      codexThreadId: string;
      codexTurnId: string;
      submittedBy: string;
      interruptRequestedAt: Date | null;
      idempotencyKey: string | null;
      taskKind: string;
      collaborationMode: string;
    },
    status: "completed" | "failed" | "interrupted",
    failureMessage: string | null,
    options: {
      contextWindowExceeded?: boolean;
      nativePlanOutputPresent?: boolean;
    } = {},
  ): Promise<TerminalProjectionResult> {
    return this.prisma.$transaction(async (tx) => {
      const terminalAt = new Date();
      const attempt = await tx.conversationTurnAttempt.findUnique({
        where: { codexTurnId: turn.codexTurnId },
      });
      if (attempt) {
        await tx.conversationTurnAttempt.updateMany({
          where: {
            id: attempt.id,
            status: { in: ["pending", "running"] },
          },
          data: {
            status,
            completedAt: terminalAt,
            ...(status === "failed"
              ? {
                  errorCode: options.contextWindowExceeded
                    ? "CONTEXT_WINDOW_EXCEEDED"
                    : "CODEX_TURN_FAILED",
                  errorMessage: failureMessage,
                }
              : {}),
          },
        });
      }
      if (
        status === "failed" &&
        options.contextWindowExceeded &&
        turn.taskKind === "turn" &&
        attempt &&
        attempt.turnId === turn.id &&
        attempt.attemptNo < MAX_CONTEXT_WINDOW_NATIVE_ATTEMPTS &&
        turn.interruptRequestedAt === null
      ) {
        const recoveryAttempt = await tx.conversationTurnAttempt.upsert({
          where: {
            turnId_attemptNo: {
              turnId: turn.id,
              attemptNo: attempt.attemptNo + 1,
            },
          },
          create: {
            turnId: turn.id,
            attemptNo: attempt.attemptNo + 1,
            kind: "context_recovery",
            codexThreadId: turn.codexThreadId,
            sourceCodexTurnId: turn.codexTurnId,
            status: "pending",
            ...(attempt.continuationContextJson !== null
              ? {
                  continuationContextJson:
                    attempt.continuationContextJson as Prisma.InputJsonValue,
                }
              : {}),
          },
          update: {},
          select: { id: true, status: true },
        });
        if (
          recoveryAttempt.status === "pending" ||
          recoveryAttempt.status === "running"
        ) {
          return {
            becameTerminal: false,
            recoveryAttemptId: recoveryAttempt.id,
            planOutputMissingEvent: null,
          };
        }
      }
      const update = await tx.conversationTurn.updateMany({
        where: { id: turn.id, status: "running" },
        data: {
          status,
          completedAt: status === "interrupted" ? null : terminalAt,
          ...(status === "interrupted"
            ? {
                interruptRequestedAt: turn.interruptRequestedAt ?? terminalAt,
                interruptedAt: terminalAt,
              }
            : {}),
          ...(status === "failed"
            ? {
                errorCode: "CODEX_TURN_FAILED",
                errorMessage: failureMessage,
              }
            : {}),
        },
      });
      if (update.count !== 1) {
        if (turn.taskKind === "goal") {
          await tx.conversationGoal.updateMany({
            where: {
              conversationId,
              activeTurnId: turn.id,
              status: { not: "active" },
            },
            data: { activeTurnId: null },
          });
        }
        return {
          becameTerminal: false,
          recoveryAttemptId: null,
          planOutputMissingEvent: null,
        };
      }
      if (turn.taskKind === "goal") {
        await tx.conversationGoal.updateMany({
          where: { conversationId, activeTurnId: turn.id },
          data: { activeTurnId: null },
        });
      }
      await tx.conversationUserInputRequest.updateMany({
        where: {
          turnId: turn.id,
          status: { in: ["pending", "answering"] },
        },
        data: {
          status: "cancelled",
          resolvedAt: terminalAt,
          responseContentJson: Prisma.DbNull,
        },
      });
      await settlePreparingPlanReview(
        tx,
        conversationId,
        turn.id,
        status,
        terminalAt,
      );
      const planOutputMissing =
        status === "completed" &&
        !options.nativePlanOutputPresent &&
        (await this.isPlanOutputMissing(tx, conversationId, turn));
      const automationOutcome =
        status === "completed"
          ? await this.settleCompletedAutomationRun(
              tx,
              conversationId,
              turn,
              terminalAt,
            )
          : "not_automation";
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastTurnStatus: status,
          ...(status === "failed" ||
          (status === "completed" && automationOutcome !== "empty_result")
            ? { completionUnread: true }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: turn.submittedBy,
          action:
            status === "interrupted"
              ? "conversation_turn_interrupted"
              : status === "failed"
                ? "conversation_turn_failed"
                : "conversation_turn_completed",
          targetType: "conversation_turn",
          targetId: turn.id,
          result: status === "failed" ? "failure" : "success",
          metadataJson: {
            conversation_id: conversationId,
            source: "codex_thread_reconciliation",
          },
        },
      });
      if (automationOutcome === "empty_result") {
        await this.createAutomationEmptyResultEvent(
          tx,
          conversationId,
          turn.id,
        );
      }
      const planOutputMissingEvent = planOutputMissing
        ? await this.createPlanOutputMissingEvent(tx, conversationId, turn.id)
        : null;
      return {
        becameTerminal: true,
        recoveryAttemptId: null,
        planOutputMissingEvent,
      };
    });
  }

  private async ingestTitleUpdate(
    conversationId: string,
    input: RunnerEventInput,
    deliveryId: string,
  ) {
    const projection = await this.resolveThreadProjection(
      conversationId,
      input.threadId,
    );
    if (projection === "pending") {
      return { accepted: false, reason_code: "THREAD_PROJECTION_PENDING" };
    }
    if (projection === "stale") {
      return { accepted: true, ignored: true, reason_code: "STALE_BRANCH" };
    }

    const title = normalizeGeneratedTitle(input.payload.title);
    if (!title) return { accepted: true, ignored: true };

    const result = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(
          tx,
          conversationId,
          input.threadId,
        ))
      ) {
        return { event: null, payload: {}, ignored: true };
      }
      const existingEvent = await tx.conversationEvent.findUnique({
        where: { id: deliveryId },
      });
      if (existingEvent) {
        if (
          existingEvent.conversationId !== conversationId ||
          existingEvent.turnId !== null ||
          existingEvent.eventType !== input.eventType
        ) {
          throw new Error("runner event delivery id collision");
        }
        return {
          event: existingEvent,
          payload: asObject(existingEvent.payloadJson),
          ignored: false,
        };
      }

      const updated = await tx.conversation.updateMany({
        where: {
          id: conversationId,
          codexThreadId: input.threadId,
          titleSource: "fallback",
        },
        data: { title, titleSource: "generated" },
      });
      if (updated.count !== 1) {
        return { event: null, payload: {}, ignored: true };
      }

      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      const payload = {
        schema_version: 1 as const,
        title,
        thread_id: input.threadId,
      };
      const event = await tx.conversationEvent.create({
        data: {
          id: deliveryId,
          conversationId,
          turnId: null,
          sequenceNo,
          eventType: "conversation.title.updated",
          visibility: "user_visible",
          payloadJson: payload,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { event, payload, ignored: false };
    });

    if (result.ignored || !result.event) {
      return { accepted: true, ignored: true };
    }
    const projectedEvent = projectEvent(result.event, result.payload);
    await this.redis.publishConversationEvent(conversationId, projectedEvent);
    return { accepted: true, event: projectedEvent };
  }

  async reconcileAfterProcessExit(rawInput: {
    conversationId: string;
    projectionTurnId: string;
    capabilityGeneration: string;
  }): Promise<ProcessExitRecoveryResult> {
    const conversationId = rawInput.conversationId;
    try {
      const input = processExitRecoveryInputSchema.parse(rawInput);
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      const running = await this.prisma.conversationTurn.findUnique({
        where: { id: input.projectionTurnId },
      });
      if (
        !conversation ||
        !running ||
        running.conversationId !== conversationId ||
        running.capabilityGeneration !== input.capabilityGeneration
      ) {
        return { outcome: "not_applicable" };
      }
      if (running.submittedBy !== conversation.ownerId) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      if (TERMINAL_TURN_STATUSES.has(running.status)) {
        if (
          running.status === "completed" &&
          running.taskKind === "turn" &&
          running.collaborationMode === "plan"
        ) {
          await this.publishPersistedPlanOutputMissingEvent(
            conversationId,
            running.id,
          );
        }
        await this.confirmTerminalRecovery(conversationId, running);
        await this.runTerminalPostActions(
          conversationId,
          running.id,
          running.submittedBy,
        );
        if (
          running.status === "completed" &&
          conversation.titleSource === "fallback"
        ) {
          this.titleRefresh?.schedule(conversationId);
        }
        return { outcome: "not_applicable" };
      }
      if (!conversation.codexThreadId || running.status !== "running") {
        throw new AppError("RUNNER_UNAVAILABLE");
      }
      const recoveryRuntime = await this.conversations.resolveRecoveryRuntime(
        conversation.ownerId,
        {
          conversationId,
          capabilityGeneration: running.capabilityGeneration,
          capabilitiesJson: running.capabilitiesJson,
          mcpGeneration: running.mcpGeneration,
          mcpServersJson: running.mcpServersJson,
          ...(running.model ? { model: running.model } : {}),
          ...(running.reasoningEffort
            ? { reasoningEffort: running.reasoningEffort }
            : {}),
        },
        { includeModelTransitionSource: true },
      );
      const result = await this.conversations.runnerForRecovery().reconcile({
        conversationId,
        ownerId: conversation.ownerId,
        expectedRuntimeGeneration: recoveryRuntimeGenerationSchema.parse(
          conversation.runtimeGeneration,
        ),
        capabilityGeneration: recoveryRuntime.capabilityGeneration,
        mcpGeneration: recoveryRuntime.mcpGeneration,
        mcpServers: recoveryRuntime.mcpServers,
        codexThreadId: conversation.codexThreadId,
        codexTurnId: running.codexTurnId,
        projectionTurnId: running.id,
        taskKind: conversationTaskKindSchema.parse(running.taskKind),
        collaborationMode: conversationCollaborationModeSchema.parse(
          running.collaborationMode,
        ),
        capabilities: recoveryRuntime.capabilities,
        environment: recoveryRuntime.environment,
        model: recoveryRuntime.modelRuntime.model,
        ...(recoveryRuntime.modelTransitionSource
          ? {
              modelTransitionSource:
                recoveryRuntime.modelTransitionSource,
            }
          : {}),
        reasoningEffort: recoveryRuntime.modelRuntime.reasoningEffort,
        modelProvider: recoveryRuntime.modelRuntime.provider,
      });
      const recoveredGoalStatus =
        running.taskKind === "goal"
          ? await this.reconcileRecoveredGoalProjection({
              conversationId,
              ownerId: conversation.ownerId,
              codexThreadId: conversation.codexThreadId,
              projectionTurnId: running.id,
              goal: result.goal,
            })
          : null;
      const thread = asObject(result.thread);
      const turns = Array.isArray(thread.turns) ? thread.turns : [];
      const projectedTurns = turns.map(asObject);
      const nativeTurn =
        projectedTurns.find((turn) => turn.id === running.codexTurnId) ??
        (running.taskKind === "goal"
          ? [...projectedTurns]
              .reverse()
              .find((turn) => nativeRecoveryTurnStatus(turn) !== null)
          : undefined);
      if (recoveredGoalStatus === "active") {
        return { outcome: "succeeded" };
      }
      const nativeStatus =
        recoveredGoalStatus === "complete"
          ? "completed"
          : nativeRecoveryTurnStatus(nativeTurn);
      if (nativeStatus === "inProgress") {
        return { outcome: "succeeded" };
      }
      if (
        nativeStatus === "completed" ||
        nativeStatus === "failed" ||
        nativeStatus === "interrupted"
      ) {
        const terminalProjection = await this.reconcileTerminalProjection(
          conversationId,
          running,
          nativeStatus,
          nativeStatus === "failed"
            ? nativeTurnFailureMessage(nativeTurn)
            : null,
          {
            contextWindowExceeded:
              nativeStatus === "failed" &&
              asObject(nativeTurn?.error).codexErrorInfo ===
                "contextWindowExceeded",
            nativePlanOutputPresent: nativeTurnHasCompletedPlanOutput(
              nativeTurn,
            ),
          },
        );
        if (terminalProjection.planOutputMissingEvent) {
          await this.redis.publishConversationEvent(
            conversationId,
            projectEvent(
              terminalProjection.planOutputMissingEvent.event,
              terminalProjection.planOutputMissingEvent.payload,
            ),
          );
        } else if (
          nativeStatus === "completed" &&
          running.taskKind === "turn" &&
          running.collaborationMode === "plan"
        ) {
          await this.publishPersistedPlanOutputMissingEvent(
            conversationId,
            running.id,
          );
        }
        await this.confirmTerminalRecovery(conversationId, running);
        if (terminalProjection.recoveryAttemptId) {
          await this.conversations.recoverContextWindowAttempt(
            terminalProjection.recoveryAttemptId,
          );
          return { outcome: "succeeded" };
        }
        await this.runTerminalPostActions(
          conversationId,
          running.id,
          running.submittedBy,
        );
        if (
          nativeStatus === "completed" &&
          terminalProjection.becameTerminal
        ) {
          this.titleRefresh?.schedule(conversationId);
        }
        return { outcome: "succeeded" };
      }
      throw new AppError("RUNNER_UNAVAILABLE");
    } catch (error) {
      const reasonCode = runningTurnRecoveryFailureReason(error);
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          action: "codex_thread_recovery_failed",
          targetType: "conversation",
          targetId: conversationId,
          result: "failure",
          metadataJson: { reason_code: "CODEX_THREAD_RECOVERY_UNAVAILABLE" },
        },
      });
      return { outcome: "failed", reasonCode };
    }
  }

  private async reconcileRecoveredGoalProjection(input: {
    conversationId: string;
    ownerId: string;
    codexThreadId: string;
    projectionTurnId: string;
    goal: unknown;
  }) {
    const parsedGoal = runnerCodexGoalSchema.safeParse(input.goal);
    if (
      !parsedGoal.success ||
      parsedGoal.data.threadId !== input.codexThreadId
    ) {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    const stored = await this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(
          tx,
          input.conversationId,
          input.codexThreadId,
        ))
      ) {
        throw new AppError("RUNNER_UNAVAILABLE");
      }
      return upsertConversationGoal(tx, {
        conversationId: input.conversationId,
        ownerId: input.ownerId,
        goal: parsedGoal.data,
        activeTurnId:
          parsedGoal.data.status === "active" ? input.projectionTurnId : null,
      });
    });
    return threadGoalStatusSchema.parse(stored.status);
  }

  recoverRunningTurns(
    options: { requireObserved?: boolean } = {},
  ): Promise<void> {
    if (this.recoveryInFlight) return this.recoveryInFlight;
    const inFlight = this.runRunningTurnRecoveryCycle(
      options.requireObserved ?? true,
    );
    this.recoveryInFlight = inFlight;
    const clear = () => {
      if (this.recoveryInFlight === inFlight) this.recoveryInFlight = null;
    };
    void inFlight.then(clear, clear);
    return inFlight;
  }

  private async runRunningTurnRecoveryCycle(
    requireObserved: boolean,
  ): Promise<void> {
    const attemptedAt = new Date().toISOString();
    let projectionRecoveryFailure: unknown = null;
    try {
      await this.conversations.recoverStartIntents();
    } catch (error) {
      projectionRecoveryFailure = error;
    }
    try {
      await this.conversations.recoverContextWindowAttempts?.();
    } catch (error) {
      projectionRecoveryFailure ??= error;
    }

    const lease = await this.redis.acquireRunningTurnReconcileLease();
    if (!lease) {
      if (!requireObserved) return;
      if (
        await this.waitForSharedRecoveryBaseline(
          projectionRecoveryFailure ? attemptedAt : null,
        )
      ) {
        return;
      }
      throw new RunningTurnRecoveryCycleError(
        RUNNING_TURN_RECOVERY_LEASE_UNAVAILABLE,
      );
    }
    let leaseReleased = false;
    const releaseLease = async () => {
      if (leaseReleased) return;
      leaseReleased = true;
      await this.redis
        .releaseRunningTurnReconcileLease(lease)
        .catch(() => undefined);
    };
    let attempt: RunningTurnRecoveryAttempt | null = null;
    try {
      attempt = await this.redis.beginRunningTurnRecoveryAttempt(
        lease,
        attemptedAt,
      );
      if (!attempt) {
        if (requireObserved) {
          throw new RunningTurnRecoveryCycleError(
            RUNNING_TURN_RECOVERY_ATTEMPT_UNAVAILABLE,
          );
        }
        return;
      }

      let runningTurns: RunningTurnRecoveryRow[] | null = null;
      let activeSlots: RecoverySlot[] = [];
      let snapshotFailureReason: string | null = null;
      try {
        const [runningSnapshot, intentSnapshot] =
          await this.prisma.$transaction(
            async (tx) =>
              Promise.all([
                tx.conversationTurn.findMany({
                  where: { status: "running" },
                  orderBy: { startedAt: "asc" },
                  select: {
                    id: true,
                    conversationId: true,
                    submittedBy: true,
                    capabilityGeneration: true,
                  },
                }),
                tx.conversationTurnStartIntent.findMany({
                  where: {
                    runnerStatus: { in: ACTIVE_START_INTENT_STATUSES },
                  },
                  orderBy: { createdAt: "asc" },
                  select: {
                    projectionTurnId: true,
                    conversationId: true,
                    ownerId: true,
                  },
                }),
              ]),
            { isolationLevel: "RepeatableRead" },
          );
        const merged = mergeRecoverySlots(runningSnapshot, intentSnapshot);
        if (merged.conflicted) {
          snapshotFailureReason = RUNNING_TURN_RECOVERY_SLOT_CONFLICT;
        } else {
          const reconciliation = await this.redis.reconcileRunningTurnSlots(
            merged.slots,
            lease,
          );
          if (reconciliation.conflicted) {
            snapshotFailureReason = RUNNING_TURN_RECOVERY_SLOT_CONFLICT;
          } else {
            runningTurns = reconciliation.applied ? runningSnapshot : null;
            activeSlots = reconciliation.applied ? merged.slots : [];
          }
        }
      } finally {
        await releaseLease();
      }
      if (snapshotFailureReason) {
        await this.finishRunningTurnRecoveryFailure(
          attempt,
          snapshotFailureReason,
          requireObserved,
        );
        return;
      }
      if (!runningTurns) {
        await this.finishRunningTurnRecoveryFailure(
          attempt,
          RUNNING_TURN_RECOVERY_RECONCILE_STALE,
          requireObserved,
        );
        return;
      }
      let firstFailureReason = projectionRecoveryFailure
        ? runningTurnRecoveryFailureReason(projectionRecoveryFailure)
        : null;
      for (let index = 0; index < runningTurns.length; index += 5) {
        const results = await Promise.all(
          runningTurns.slice(index, index + 5).map(async (turn) => {
            let token: string | null;
            try {
              token = await this.redis.acquireRecoveryLock(turn.conversationId);
            } catch (error) {
              return {
                outcome: "failed" as const,
                reasonCode: runningTurnRecoveryFailureReason(error),
              };
            }
            if (!token) return null;
            try {
              return await this.reconcileAfterProcessExit({
                conversationId: turn.conversationId,
                projectionTurnId: turn.id,
                capabilityGeneration: turn.capabilityGeneration,
              });
            } finally {
              await this.redis
                .releaseRecoveryLock(turn.conversationId, token)
                .catch(() => undefined);
            }
          }),
        );
        firstFailureReason ??=
          results.find(
            (
              result,
            ): result is Extract<
              ProcessExitRecoveryResult,
              { outcome: "failed" }
            > => result?.outcome === "failed",
          )?.reasonCode ?? null;
      }

      const terminalReleaseFailure =
        await this.releaseProvenTerminalSlots(activeSlots);
      firstFailureReason ??= terminalReleaseFailure;

      if (firstFailureReason) {
        await this.finishRunningTurnRecoveryFailure(
          attempt,
          firstFailureReason,
          requireObserved,
        );
        return;
      }
      const completionApplied =
        await this.redis.completeRunningTurnRecoveryAttempt(attempt, {
          outcome: "succeeded",
          completedAt: new Date().toISOString(),
        });
      if (!completionApplied && requireObserved) {
        throw new RunningTurnRecoveryCycleError(
          RUNNING_TURN_RECOVERY_COMPLETION_STALE,
        );
      }
    } catch (error) {
      if (error instanceof RunningTurnRecoveryCycleError) throw error;
      if (!attempt) throw error;
      const completionApplied = await this.redis
        .completeRunningTurnRecoveryAttempt(attempt, {
          outcome: "failed",
          completedAt: new Date().toISOString(),
          reasonCode: runningTurnRecoveryFailureReason(error),
        })
        .catch(() => null);
      if (completionApplied === false && requireObserved) {
        throw new RunningTurnRecoveryCycleError(
          RUNNING_TURN_RECOVERY_COMPLETION_STALE,
        );
      }
      if (requireObserved) throw error;
    } finally {
      await releaseLease();
    }
  }

  private async waitForSharedRecoveryBaseline(
    minimumAttemptedAt: string | null,
  ): Promise<boolean> {
    const deadline =
      Date.now() + SHARED_RECOVERY_OBSERVATION_TIMEOUT_MILLISECONDS;
    while (true) {
      const status = await this.redis.runningTurnRecoveryStatus();
      const observesRequiredAttempt =
        !minimumAttemptedAt ||
        recoveryAttemptIsAtLeast(status.last_attempt_at, minimumAttemptedAt);
      if (observesRequiredAttempt && isRunningTurnCapacityReady(status)) {
        return true;
      }
      if (observesRequiredAttempt && status.outcome === "failed") return false;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise<void>((resolve) => {
        setTimeout(
          resolve,
          Math.min(SHARED_RECOVERY_OBSERVATION_POLL_MILLISECONDS, remaining),
        );
      });
    }
  }

  private async finishRunningTurnRecoveryFailure(
    attempt: RunningTurnRecoveryAttempt,
    reasonCode: string,
    requireObserved: boolean,
  ): Promise<void> {
    const completionApplied =
      await this.redis.completeRunningTurnRecoveryAttempt(attempt, {
        outcome: "failed",
        completedAt: new Date().toISOString(),
        reasonCode,
      });
    if (!completionApplied) {
      if (requireObserved) {
        throw new RunningTurnRecoveryCycleError(
          RUNNING_TURN_RECOVERY_COMPLETION_STALE,
        );
      }
      return;
    }
    if (requireObserved) throw new RunningTurnRecoveryCycleError(reasonCode);
  }

  private async releaseProvenTerminalSlots(
    activeSlots: RecoverySlot[],
  ): Promise<string | null> {
    let observedSlots: Awaited<ReturnType<LinkSenseRedis["runningTurnSlots"]>>;
    try {
      observedSlots = await this.redis.runningTurnSlots();
    } catch (error) {
      return runningTurnRecoveryFailureReason(error);
    }
    const activeSlotKeys = new Set(
      activeSlots.map((slot) =>
        recoverySlotKey(slot.conversationId, slot.turnId),
      ),
    );
    const activeSlotsByConversation = new Map(
      activeSlots.map((slot) => [slot.conversationId, slot]),
    );
    const conflictingConversationIds = new Set<string>();
    for (const observed of observedSlots) {
      const active = activeSlotsByConversation.get(observed.conversationId);
      if (
        active &&
        (active.turnId !== observed.turnId ||
          active.ownerId !== observed.ownerId)
      ) {
        conflictingConversationIds.add(observed.conversationId);
      }
    }
    const candidates = observedSlots.filter(
      (slot) =>
        !conflictingConversationIds.has(slot.conversationId) &&
        !activeSlotKeys.has(recoverySlotKey(slot.conversationId, slot.turnId)),
    );
    let firstFailureReason: string | null =
      conflictingConversationIds.size > 0
        ? RUNNING_TURN_RECOVERY_SLOT_CONFLICT
        : null;
    for (let index = 0; index < candidates.length; index += 5) {
      const results = await Promise.all(
        candidates.slice(index, index + 5).map(async (slot) => {
          if (!slot.ownerId) return null;
          try {
            const [turn, differentRunningTurn, differentActiveIntent] =
              await Promise.all([
                this.prisma.conversationTurn.findUnique({
                  where: { id: slot.turnId },
                  select: {
                    id: true,
                    conversationId: true,
                    submittedBy: true,
                    status: true,
                  },
                }),
                this.prisma.conversationTurn.findFirst({
                  where: {
                    conversationId: slot.conversationId,
                    status: "running",
                    id: { not: slot.turnId },
                  },
                  select: { id: true },
                }),
                this.prisma.conversationTurnStartIntent.findFirst({
                  where: {
                    conversationId: slot.conversationId,
                    runnerStatus: { in: UNRESOLVED_START_INTENT_STATUSES },
                    projectionTurnId: { not: slot.turnId },
                  },
                  select: { projectionTurnId: true },
                }),
              ]);
            if (
              !turn ||
              turn.id !== slot.turnId ||
              turn.conversationId !== slot.conversationId ||
              turn.submittedBy !== slot.ownerId ||
              !TERMINAL_TURN_STATUSES.has(turn.status) ||
              differentRunningTurn ||
              differentActiveIntent
            ) {
              return null;
            }
            await this.redis.releaseTurnSlot(slot.conversationId, slot.turnId);
            return null;
          } catch (error) {
            return runningTurnRecoveryFailureReason(error);
          }
        }),
      );
      firstFailureReason ??=
        results.find((reason): reason is string => reason !== null) ?? null;
    }
    return firstFailureReason;
  }

  startRecoveryMonitor(intervalMilliseconds = 15_000): void {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setInterval(() => {
      void this.recoverRunningTurns({ requireObserved: false }).catch(
        () => undefined,
      );
    }, intervalMilliseconds);
    this.recoveryTimer.unref();
  }

  stopRecoveryMonitor(): void {
    if (!this.recoveryTimer) return;
    clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  async historyPage(
    ownerId: string,
    conversationId: string,
    input: { afterSequence: bigint; limit: number },
  ) {
    await this.conversations.assertOwner(ownerId, conversationId);
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const conversation = await tx.conversation.findUnique({
          where: { id: conversationId },
          select: { codexThreadId: true },
        });
        const currentThreadId = conversation?.codexThreadId ?? null;
        const activeTurnIds = currentThreadId
          ? (
              await tx.conversationTurn.findMany({
                where: { conversationId, codexThreadId: currentThreadId },
                select: { id: true },
              })
            ).map((turn) => turn.id)
          : [];
        const rows = await tx.conversationEvent.findMany({
          where: {
            conversationId,
            sequenceNo: { gt: input.afterSequence },
            visibility: { in: ["user_visible", "user_collapsed"] },
            OR: [
              ...(activeTurnIds.length > 0
                ? [{ turnId: { in: activeTurnIds } }]
                : []),
              {
                turnId: null,
                eventType: {
                  notIn: ["thread/name/updated", "conversation.title.updated"],
                },
              },
              ...(currentThreadId
                ? [
                    {
                      turnId: null,
                      eventType: "thread/name/updated",
                      payloadJson: {
                        path: ["params", "threadId"],
                        equals: currentThreadId,
                      },
                    },
                    {
                      turnId: null,
                      eventType: "conversation.title.updated",
                      payloadJson: {
                        path: ["thread_id"],
                        equals: currentThreadId,
                      },
                    },
                  ]
                : []),
            ],
          },
          orderBy: { sequenceNo: "asc" },
          take: input.limit + 1,
        });
        // An observed Pub/Sub event can be intentionally absent from the active
        // branch projection. Confirm that gap in the same database snapshot.
        const latestPersistedEvent =
          rows.length === 0
            ? await tx.conversationEvent.findFirst({
                where: { conversationId },
                orderBy: { sequenceNo: "desc" },
                select: { sequenceNo: true },
              })
            : null;
        return {
          rows,
          confirmedSequence:
            latestPersistedEvent &&
            latestPersistedEvent.sequenceNo > input.afterSequence
              ? latestPersistedEvent.sequenceNo
              : (rows.at(-1)?.sequenceNo ?? input.afterSequence),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    const { rows } = snapshot;
    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const items = pageRows.map((row) =>
      projectEvent(row, asObject(row.payloadJson)),
    );
    const lastRow = pageRows.at(-1);
    return {
      items,
      next_cursor: hasMore && lastRow ? lastRow.sseEventId : null,
      last_sequence: lastRow?.sequenceNo ?? input.afterSequence,
      confirmed_sequence: snapshot.confirmedSequence,
    };
  }

  async assertOwner(ownerId: string, conversationId: string): Promise<void> {
    await this.conversations.assertOwner(ownerId, conversationId);
  }

  private async projectCompletedAssistantMessage(
    turn: GroundedTurn,
    text: string,
  ) {
    const sources = this.knowledgeSources
      ? await this.knowledgeSources.read(turn.id)
      : new Map();
    return projectKnowledgeCitations(text, sources);
  }

  private async loadInterruptedAssistantOutputs(
    conversationId: string,
    projectionTurnId: string,
    codexTurnId: string,
    turn: GroundedTurn,
  ) {
    const events = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        turnId: projectionTurnId,
        eventType: {
          in: [
            "item/agentMessage/delta",
            "item/completed",
            "conversation.message.completed",
          ],
        },
      },
      orderBy: [{ sequenceNo: "asc" }, { id: "asc" }],
    });
    const outputs = collectInterruptedAssistantOutputs(events, codexTurnId);
    return Promise.all(
      outputs.map(async (output) => {
        if (output.existingCompletion) {
          return { ...output, projection: null };
        }
        const projection = await this.projectCompletedAssistantMessage(
          turn,
          output.text,
        );
        return {
          ...output,
          projection:
            projection.contentText.trim().length > 0 ? projection : null,
        };
      }),
    );
  }

  private async attachGoalContinuation(
    conversationId: string,
    threadId: string,
    codexTurnId: string,
    nativeStartedAt: Date | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await this.lockActiveConversationBranch(tx, conversationId, threadId))
      ) {
        return false;
      }
      await tx.$queryRaw<Array<{ conversation_id: string }>>`
        SELECT conversation_id
        FROM conversation_goals
        WHERE conversation_id = ${conversationId}::uuid
        FOR UPDATE
      `;
      const goal = await tx.conversationGoal.findFirst({
        where: {
          conversationId,
          codexThreadId: threadId,
        },
      });
      if (!goal) return false;

      const activeGoalTurnId =
        goal.status === "active" ? goal.activeTurnId : null;
      let turn;
      if (activeGoalTurnId) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_turns
          WHERE id = ${activeGoalTurnId}::uuid
          FOR UPDATE
        `;
        turn = await tx.conversationTurn.findFirst({
          where: {
            id: activeGoalTurnId,
            conversationId,
            codexThreadId: threadId,
            taskKind: "goal",
          },
        });
      } else {
        if (
          goal.status === "active" ||
          !nativeStartedAt ||
          nativeStartedAt < goal.nativeCreatedAt ||
          nativeStartedAt > goal.nativeUpdatedAt
        ) {
          return false;
        }
        const candidate = await tx.conversationTurn.findFirst({
          where: { conversationId, codexThreadId: threadId, taskKind: "goal" },
          orderBy: { sequenceNo: "desc" },
        });
        if (!candidate) return false;
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_turns
          WHERE id = ${candidate.id}::uuid
          FOR UPDATE
        `;
        turn = await tx.conversationTurn.findUnique({
          where: { id: candidate.id },
        });
        if (
          !turn ||
          turn.conversationId !== conversationId ||
          turn.codexThreadId !== threadId ||
          turn.taskKind !== "goal"
        ) {
          return false;
        }
      }
      if (!turn) return false;
      if (turn.codexTurnId === codexTurnId) return true;
      const existingAttempt = await tx.conversationTurnAttempt.findUnique({
        where: { codexTurnId },
      });
      if (existingAttempt) return existingAttempt.turnId === turn.id;
      const latestAttempt = await tx.conversationTurnAttempt.findFirst({
        where: { turnId: turn.id },
        orderBy: { attemptNo: "desc" },
      });
      if (
        !latestAttempt ||
        latestAttempt.codexTurnId !== turn.codexTurnId ||
        !TERMINAL_TURN_STATUSES.has(latestAttempt.status)
      ) {
        return false;
      }
      const startedAt = nativeStartedAt ?? new Date();
      await tx.conversationTurnAttempt.create({
        data: {
          turnId: turn.id,
          attemptNo: latestAttempt.attemptNo + 1,
          kind: "goal_continuation",
          codexThreadId: threadId,
          codexTurnId,
          sourceCodexTurnId: latestAttempt.codexTurnId,
          status: "running",
          ...(latestAttempt.continuationContextJson !== null
            ? {
                continuationContextJson:
                  latestAttempt.continuationContextJson as Prisma.InputJsonValue,
              }
            : {}),
          startedAt,
        },
      });
      const updated = await tx.conversationTurn.updateMany({
        where: {
          id: turn.id,
          status: turn.status,
          codexTurnId: turn.codexTurnId,
        },
        data: {
          codexTurnId,
          ...(activeGoalTurnId && turn.status !== "running"
            ? {
                status: "running",
                completedAt: null,
                interruptRequestedAt: null,
                interruptedAt: null,
                errorCode: null,
                errorMessage: null,
              }
            : {}),
        },
      });
      if (updated.count !== 1) throw new AppError("CONFLICT");
      if (activeGoalTurnId && turn.status !== "running") {
        await tx.conversation.updateMany({
          where: { id: conversationId, codexThreadId: threadId },
          data: { lastTurnStatus: "running", lastRunAt: startedAt },
        });
      }
      return true;
    });
  }

  private async resolveTurnProjection(
    conversationId: string,
    threadId: string,
    turnId: string,
  ) {
    const [conversation, persistedAttempt] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { codexThreadId: true },
      }),
      this.prisma.conversationTurnAttempt.findUnique({
        where: { codexTurnId: turnId },
      }),
    ]);
    if (!conversation) return { status: "stale" } as const;

    const turn = persistedAttempt
      ? await this.prisma.conversationTurn.findFirst({
          where: { id: persistedAttempt.turnId, conversationId },
        })
      : await this.prisma.conversationTurn.findFirst({
          where: { conversationId, codexTurnId: turnId },
        });
    if (!turn) {
      if (
        conversation.codexThreadId === threadId &&
        (await this.isStaleUnprojectedGoalTurn(
          conversationId,
          threadId,
          turnId,
        ))
      ) {
        return { status: "stale" } as const;
      }
      return { status: "pending" } as const;
    }
    const attempt =
      persistedAttempt ??
      ({
        id: turn.id,
        turnId: turn.id,
        attemptNo: 1,
        kind: "primary",
        codexThreadId: turn.codexThreadId,
        codexTurnId: turn.codexTurnId,
        sourceCodexTurnId: null,
        status: turn.status,
        continuationContextJson: null,
        errorCode: turn.errorCode,
        errorMessage: turn.errorMessage,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
      } as const);
    if (
      conversation.codexThreadId !== threadId ||
      turn.codexThreadId !== threadId ||
      attempt.codexThreadId !== threadId
    ) {
      return { status: "stale" } as const;
    }
    if (persistedAttempt && persistedAttempt.codexTurnId !== turn.codexTurnId) {
      return { status: "stale" } as const;
    }
    return {
      status: "active",
      turn,
      attempt,
      attemptPersisted: persistedAttempt !== null,
    } as const;
  }

  private async isStaleUnprojectedGoalTurn(
    conversationId: string,
    threadId: string,
    codexTurnId: string,
  ): Promise<boolean> {
    const goal = await this.prisma.conversationGoal.findFirst({
      where: {
        conversationId,
        codexThreadId: threadId,
        activeTurnId: { not: null },
      },
      select: { activeTurnId: true },
    });
    if (!goal?.activeTurnId) return false;

    const turn = await this.prisma.conversationTurn.findFirst({
      where: {
        id: goal.activeTurnId,
        conversationId,
        codexThreadId: threadId,
        taskKind: "goal",
      },
      select: { id: true, codexTurnId: true },
    });
    if (!turn?.codexTurnId || turn.codexTurnId === codexTurnId) return false;

    const latestAttempt = await this.prisma.conversationTurnAttempt.findFirst({
      where: { turnId: turn.id },
      orderBy: { attemptNo: "desc" },
      select: { codexTurnId: true },
    });
    if (!latestAttempt || latestAttempt.codexTurnId !== turn.codexTurnId) {
      return false;
    }

    // turn/started is given the first chance to attach a legitimate Goal
    // continuation before resolution reaches this branch. Any id still
    // unprojected here is therefore stale; acknowledging it prevents durable
    // FIFO delivery from blocking the real Goal attempt behind it.
    return true;
  }

  private async resolveThreadProjection(
    conversationId: string,
    threadId: string,
  ): Promise<"active" | "pending" | "stale"> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { codexThreadId: true },
    });
    if (!conversation) return "stale";
    if (conversation.codexThreadId === threadId) return "active";
    const projectedTurn = await this.prisma.conversationTurn.findFirst({
      where: { conversationId, codexThreadId: threadId },
      select: { id: true },
    });
    return projectedTurn ? "stale" : "pending";
  }

  private async lockActiveConversationBranch(
    tx: Prisma.TransactionClient,
    conversationId: string,
    threadId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM conversations
      WHERE id = ${conversationId}::uuid
        AND codex_thread_id = ${threadId}
      FOR SHARE
    `;
    return rows.length === 1;
  }
}

async function settlePreparingPlanReview(
  tx: Prisma.TransactionClient,
  conversationId: string,
  sourceTurnId: string,
  terminalStatus: "completed" | "failed" | "interrupted",
  terminalAt: Date,
): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM conversation_turns
    WHERE id = ${sourceTurnId}::uuid
    FOR UPDATE
  `;
  const preparingReview = await tx.conversationPlanReview.findFirst({
    where: { conversationId, sourceTurnId, status: "preparing" },
    select: { id: true },
  });
  if (!preparingReview) return;
  const resolution = await terminalPlanReviewResolution(
    tx,
    conversationId,
    sourceTurnId,
    terminalStatus,
    terminalAt,
  );
  await tx.conversationPlanReview.updateMany({
    where: {
      conversationId,
      sourceTurnId,
      status: "preparing",
    },
    data:
      resolution.status === "pending"
        ? { status: "pending" }
        : { status: "cancelled", resolvedAt: resolution.resolvedAt },
  });
}

async function upsertNativePlanReview(
  tx: Prisma.TransactionClient,
  conversationId: string,
  turn: {
    id: string;
    submittedBy: string;
  },
  planMessageId: string,
  codexItemId: string,
) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM conversation_turns
    WHERE id = ${turn.id}::uuid
    FOR UPDATE
  `;
  const sourceTurn = await tx.conversationTurn.findUnique({
    where: { id: turn.id },
  });
  if (
    !sourceTurn ||
    sourceTurn.conversationId !== conversationId ||
    sourceTurn.submittedBy !== turn.submittedBy ||
    sourceTurn.collaborationMode !== "plan"
  ) {
    throw new AppError("INTERNAL_ERROR");
  }
  const resolution =
    sourceTurn.status === "running"
      ? ({ status: "preparing", resolvedAt: null } as const)
      : await terminalPlanReviewResolution(
          tx,
          conversationId,
          turn.id,
          sourceTurn.status === "completed"
            ? "completed"
            : sourceTurn.status === "interrupted"
              ? "interrupted"
              : "failed",
          sourceTurn.completedAt ??
            sourceTurn.interruptedAt ??
            sourceTurn.updatedAt,
        );
  const planReview = await tx.conversationPlanReview.upsert({
    where: { sourceTurnId: turn.id },
    create: {
      conversationId,
      ownerId: turn.submittedBy,
      sourceTurnId: turn.id,
      planMessageId,
      codexItemId,
      status: resolution.status,
      resolvedAt: resolution.resolvedAt,
    },
    update: {},
  });
  if (
    planReview.conversationId !== conversationId ||
    planReview.ownerId !== turn.submittedBy ||
    planReview.planMessageId !== planMessageId ||
    planReview.codexItemId !== codexItemId
  ) {
    throw new AppError("INTERNAL_ERROR");
  }
  return planReview;
}

async function terminalPlanReviewResolution(
  tx: Prisma.TransactionClient,
  conversationId: string,
  sourceTurnId: string,
  terminalStatus: "completed" | "failed" | "interrupted",
  terminalAt: Date,
): Promise<
  | { status: "pending"; resolvedAt: null }
  | { status: "cancelled"; resolvedAt: Date }
> {
  if (terminalStatus !== "completed") {
    return { status: "cancelled", resolvedAt: terminalAt };
  }
  const [conversation, sourceTurn, queuedFollowUp, activeIntent] =
    await Promise.all([
      tx.conversation.findUnique({ where: { id: conversationId } }),
      tx.conversationTurn.findUnique({ where: { id: sourceTurnId } }),
      tx.pendingRequest.findFirst({
        where: { conversationId },
        select: { id: true },
      }),
      tx.conversationTurnStartIntent.findUnique({
        where: { conversationId },
        select: { projectionTurnId: true },
      }),
    ]);
  const latestTurn = conversation?.codexThreadId
    ? await tx.conversationTurn.findFirst({
        where: {
          conversationId,
          codexThreadId: conversation.codexThreadId,
        },
        orderBy: { sequenceNo: "desc" },
      })
    : null;
  if (
    !conversation ||
    conversation.collaborationMode !== "plan" ||
    !sourceTurn ||
    sourceTurn.conversationId !== conversationId ||
    sourceTurn.collaborationMode !== "plan" ||
    sourceTurn.codexThreadId !== conversation.codexThreadId ||
    latestTurn?.id !== sourceTurn.id ||
    queuedFollowUp ||
    activeIntent
  ) {
    return { status: "cancelled", resolvedAt: terminalAt };
  }
  return { status: "pending", resolvedAt: null };
}

function terminalStatusFromEvent(
  input: RunnerEventInput,
): "completed" | "failed" | "interrupted" | null {
  if (input.eventType !== "conversation.status.changed") return null;
  const status = input.payload.turn_status;
  return status === "completed" ||
    status === "failed" ||
    status === "interrupted"
    ? status
    : null;
}

function nativeThreadId(params: Record<string, unknown>): string | null {
  return typeof params.threadId === "string" && params.threadId.length > 0
    ? params.threadId
    : null;
}

async function upsertUserInputRequest(
  tx: Prisma.TransactionClient,
  conversationId: string,
  turn: {
    id: string;
    submittedBy: string;
    codexThreadId: string;
    codexTurnId: string;
  },
  method: "item/tool/requestUserInput" | "linksense/form/request",
  params: Record<string, unknown>,
) {
  const requestId = params.requestId;
  const itemId = params.itemId;
  if (
    typeof requestId !== "number" ||
    !Number.isSafeInteger(requestId) ||
    requestId < 0 ||
    typeof itemId !== "string" ||
    itemId.length === 0
  ) {
    throw new AppError("INTERNAL_ERROR");
  }

  if (method === "linksense/form/request") {
    const form = z
      .strictObject({
        serverName: z.string().min(1).max(240),
        message: z.string().min(1).max(4_000),
        requestedSchema: conversationFormRequestedSchema,
        uiHints: conversationFormUiHintsSchema,
        responseSemantics: conversationFormResponseSemanticsSchema,
        autoResolutionMs: z
          .number()
          .int()
          .min(60_000)
          .max(conversationFormAutoResolutionMs),
      })
      .parse({
        serverName: params.serverName,
        message: params.message,
        requestedSchema: params.requestedSchema,
        uiHints: params.uiHints,
        responseSemantics: params.responseSemantics,
        autoResolutionMs: params.autoResolutionMs,
      });
    if (
      !conversationFormResponseSemanticsMatchesSchema(
        form.responseSemantics,
        form.requestedSchema,
      )
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    const existing = await tx.conversationUserInputRequest.findFirst({
      where: {
        codexThreadId: turn.codexThreadId,
        codexTurnId: turn.codexTurnId,
        codexItemId: itemId,
      },
    });
    if (existing) {
      if (
        existing.conversationId !== conversationId ||
        existing.turnId !== turn.id ||
        existing.nativeRequestId !== BigInt(requestId) ||
        existing.requestKind !== "form" ||
        existing.serverName !== form.serverName ||
        existing.messageText !== form.message ||
        JSON.stringify(existing.formSchemaJson) !==
          JSON.stringify(form.requestedSchema) ||
        JSON.stringify(existing.formUiHintsJson) !==
          JSON.stringify(form.uiHints) ||
        JSON.stringify(existing.formResponseSemanticsJson) !==
          JSON.stringify(form.responseSemantics)
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
        codexItemId: itemId,
        nativeRequestId: BigInt(requestId),
        requestKind: "form",
        questionsJson: [],
        serverName: form.serverName,
        messageText: form.message,
        formSchemaJson: form.requestedSchema,
        formUiHintsJson: form.uiHints,
        formResponseSemanticsJson: form.responseSemantics,
        status: "pending",
        autoResolveAt: new Date(Date.now() + form.autoResolutionMs),
      },
    });
  }

  const nativeQuestions = Array.isArray(params.questions)
    ? params.questions
    : [];
  const questions = z
    .array(conversationUserInputQuestionSchema)
    .min(1)
    .max(3)
    .parse(
      nativeQuestions.map((value) => {
        const question = asObject(value);
        return {
          id: question.id,
          header: question.header,
          question: question.question,
          is_other: question.isOther,
          is_secret: question.isSecret,
          options: Array.isArray(question.options)
            ? question.options.map((value) => {
                const option = asObject(value);
                return {
                  label: option.label,
                  description: option.description,
                };
              })
            : null,
        };
      }),
    );
  const duplicateQuestionIds =
    new Set(questions.map((question) => question.id)).size !== questions.length;
  if (questions.length === 0 || duplicateQuestionIds) {
    throw new AppError("INTERNAL_ERROR");
  }
  const existing = await tx.conversationUserInputRequest.findFirst({
    where: {
      codexThreadId: turn.codexThreadId,
      codexTurnId: turn.codexTurnId,
      codexItemId: itemId,
    },
  });
  if (existing) {
    if (
      existing.conversationId !== conversationId ||
      existing.turnId !== turn.id ||
      existing.nativeRequestId !== BigInt(requestId) ||
      existing.requestKind !== "questions" ||
      JSON.stringify(existing.questionsJson) !== JSON.stringify(questions)
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    return existing;
  }
  const autoResolutionMs = params.autoResolutionMs;
  const isBlocking = params.isBlocking;
  if (typeof isBlocking !== "boolean") {
    throw new AppError("INTERNAL_ERROR");
  }
  return tx.conversationUserInputRequest.create({
    data: {
      conversationId,
      turnId: turn.id,
      ownerId: turn.submittedBy,
      codexThreadId: turn.codexThreadId,
      codexTurnId: turn.codexTurnId,
      codexItemId: itemId,
      nativeRequestId: BigInt(requestId),
      requestKind: "questions",
      questionsJson: questions,
      status: "pending",
      autoResolveAt:
        !isBlocking &&
        typeof autoResolutionMs === "number" &&
        autoResolutionMs > 0
          ? new Date(Date.now() + autoResolutionMs)
          : null,
    },
  });
}

function nativeTurnId(params: Record<string, unknown>): string | null {
  if (typeof params.turnId === "string" && params.turnId.length > 0) {
    return params.turnId;
  }
  const turn = asObject(params.turn);
  return typeof turn.id === "string" && turn.id.length > 0 ? turn.id : null;
}

function nativeTurnStartedAt(params: Record<string, unknown>): Date | null {
  const startedAt = asObject(params.turn).startedAt;
  return typeof startedAt === "number" && Number.isFinite(startedAt)
    ? new Date(startedAt * 1_000)
    : null;
}

function nativeEventPayload(input: MethodRunnerEventInput) {
  return {
    schema_version: 2 as const,
    source: "codex_app_server" as const,
    method: input.method,
    params: input.params,
  };
}

function nativeTerminalStatus(
  input: MethodRunnerEventInput,
): "completed" | "failed" | "interrupted" | null {
  if (input.method !== "turn/completed") return null;
  const status = asObject(input.params.turn).status;
  return status === "completed" ||
    status === "failed" ||
    status === "interrupted"
    ? status
    : null;
}

function nativeContextWindowExceeded(input: MethodRunnerEventInput): boolean {
  const error =
    input.method === "error"
      ? asObject(input.params.error)
      : input.method === "turn/completed"
        ? asObject(asObject(input.params.turn).error)
        : {};
  return error.codexErrorInfo === "contextWindowExceeded";
}

function blockedStopHookSupersededItemId(
  input: MethodRunnerEventInput,
): string | null {
  if (input.method !== "hook/completed") return null;
  const run = asObject(input.params.run);
  const itemId = input.params.supersededItemId;
  return run.eventName === "stop" &&
    run.status === "blocked" &&
    typeof itemId === "string" &&
    itemId.length > 0 &&
    itemId.length <= 512
    ? itemId
    : null;
}

async function findStopHookSupersededOutput(
  tx: Prisma.TransactionClient,
  conversationId: string,
  projectionTurnId: string,
  codexTurnId: string,
  supersededItemId: string,
): Promise<{ messageId: string; itemId: string } | null> {
  const event = await tx.conversationEvent.findFirst({
    where: {
      conversationId,
      turnId: projectionTurnId,
      eventType: "item/completed",
      payloadJson: {
        path: ["params", "item", "id"],
        equals: supersededItemId,
      },
    },
    orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
    select: { payloadJson: true },
  });
  const payload = asObject(event?.payloadJson);
  const params = asObject(payload.params);
  const item = asObject(params.item);
  const local = asObject(payload.local);
  return params.turnId === codexTurnId &&
    item.type === "agentMessage" &&
    item.phase === "final_answer" &&
    item.id === supersededItemId &&
    typeof local.message_id === "string" &&
    z.uuid().safeParse(local.message_id).success
    ? { messageId: local.message_id, itemId: supersededItemId }
    : null;
}

function nativeTurnFailureMessage(value: unknown): string | null {
  const error = asObject(asObject(value).error);
  const parsed = runnerCodexErrorMessageSchema.safeParse(error.message);
  return parsed.success ? parsed.data : null;
}

function projectEvent(
  row: {
    id: string;
    conversationId: string;
    turnId: string | null;
    sequenceNo: bigint;
    eventType: string;
    visibility: string;
    sseEventId: string;
    createdAt: Date;
  },
  payload: Record<string, unknown>,
) {
  const projection = {
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    sequence_no: Number(row.sequenceNo),
    event_type: row.eventType,
    visibility: row.visibility,
    payload,
    sse_event_id: row.sseEventId,
    created_at: row.createdAt.toISOString(),
  };
  return conversationEventSchema.parse(projection);
}

function sanitizePayload(
  eventType: RunnerEventInput["eventType"],
  payload: Record<string, unknown>,
  attachedCapabilityName?: string,
): Record<string, unknown> {
  if (
    eventType === "conversation.step.started" ||
    eventType === "conversation.step.completed" ||
    eventType === "conversation.tool.started" ||
    eventType === "conversation.tool.completed"
  ) {
    const action =
      typeof payload.action === "string" ? payload.action : "working";
    return {
      schema_version: 1,
      item_id:
        typeof payload.item_id === "string" ? payload.item_id : "unknown",
      action,
      ...(attachedCapabilityName
        ? { capability_name: attachedCapabilityName }
        : {}),
      safe_summary: action,
    };
  }
  if (eventType === "conversation.error") {
    return {
      schema_version: 1,
      error_code:
        typeof payload.error_code === "string"
          ? payload.error_code
          : "CODEX_TURN_FAILED",
      message_key:
        typeof payload.message_key === "string"
          ? payload.message_key
          : "errors.codexTurnFailed",
    };
  }
  if (eventType === "conversation.internal.observed") {
    return {
      schema_version: 1,
      ...(typeof payload.reason_code === "string"
        ? { reason_code: payload.reason_code }
        : {}),
    };
  }
  return { schema_version: 1 };
}

function runningTurnRecoveryFailureReason(error: unknown): string {
  if (
    error instanceof AppError &&
    error.code === "INTERNAL_ERROR" &&
    error.params?.reason_code === "TURN_PROJECTION_UNAVAILABLE"
  ) {
    return "RUNNING_TURN_RECOVERY_START_INTENT_FAILED";
  }
  if (error instanceof AppError && error.code === "RUNNER_UNAVAILABLE") {
    return "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE";
  }
  if (error instanceof Error && error.name === "RedisUnavailableError") {
    return "RUNNING_TURN_RECOVERY_REDIS_UNAVAILABLE";
  }
  if (error instanceof Error && error.name.startsWith("PrismaClient")) {
    return "RUNNING_TURN_RECOVERY_DATABASE_UNAVAILABLE";
  }
  return "RUNNING_TURN_RECOVERY_FAILED";
}

function mergeRecoverySlots(
  runningTurns: RunningTurnRecoveryRow[],
  activeIntents: ActiveStartIntentRecoveryRow[],
): { slots: RecoverySlot[]; conflicted: boolean } {
  const byConversation = new Map<string, RecoverySlot>();
  const inputs: RecoverySlot[] = [
    ...runningTurns.map((turn) => ({
      conversationId: turn.conversationId,
      turnId: turn.id,
      ownerId: turn.submittedBy,
    })),
    ...activeIntents.map((intent) => ({
      conversationId: intent.conversationId,
      turnId: intent.projectionTurnId,
      ownerId: intent.ownerId,
    })),
  ];
  for (const slot of inputs) {
    const existing = byConversation.get(slot.conversationId);
    if (!existing) {
      byConversation.set(slot.conversationId, slot);
      continue;
    }
    if (existing.turnId !== slot.turnId || existing.ownerId !== slot.ownerId) {
      return { slots: [], conflicted: true };
    }
  }
  return { slots: [...byConversation.values()], conflicted: false };
}

function recoverySlotKey(conversationId: string, turnId: string): string {
  return `${conversationId}:${turnId}`;
}

function recoveryAttemptIsAtLeast(
  observedAttemptedAt: string | null,
  minimumAttemptedAt: string,
): boolean {
  if (!observedAttemptedAt) return false;
  const observed = Date.parse(observedAttemptedAt);
  const minimum = Date.parse(minimumAttemptedAt);
  return (
    Number.isFinite(observed) && Number.isFinite(minimum) && observed >= minimum
  );
}

const MAX_INTERRUPTED_ASSISTANT_TEXT_CHARACTERS = 10_000_000;

function collectInterruptedAssistantOutputs(
  events: ConversationEvent[],
  codexTurnId: string,
): Array<{
  itemId: string;
  text: string;
  existingCompletion: InterruptedMessageCompletionEvent | null;
}> {
  const completedNativeItemIds = new Set<string>();
  const existingCompletionsByItemId = new Map<
    string,
    InterruptedMessageCompletionEvent
  >();
  const textByItemId = new Map<string, string>();

  for (const event of events) {
    const payload = asObject(event.payloadJson);
    if (event.eventType === "conversation.message.completed") {
      const itemId = payload.item_id;
      const messageId = payload.message_id;
      if (
        typeof itemId === "string" &&
        itemId.length > 0 &&
        payload.role === "assistant" &&
        typeof messageId === "string" &&
        z.uuid().safeParse(messageId).success
      ) {
        existingCompletionsByItemId.set(itemId, { event, payload });
      }
      continue;
    }
    if (
      payload.source !== "codex_app_server" ||
      payload.method !== event.eventType
    ) {
      continue;
    }
    const params = asObject(payload.params);
    if (params.turnId !== codexTurnId) continue;
    if (event.eventType === "item/completed") {
      const item = asObject(params.item);
      if (
        item.type === "agentMessage" &&
        typeof item.id === "string" &&
        item.id.length > 0
      ) {
        completedNativeItemIds.add(item.id);
      }
      continue;
    }
    if (event.eventType !== "item/agentMessage/delta") continue;
    const itemId = params.itemId;
    const delta = params.delta;
    if (
      typeof itemId !== "string" ||
      itemId.length === 0 ||
      typeof delta !== "string" ||
      delta.length === 0
    ) {
      continue;
    }
    const current = textByItemId.get(itemId) ?? "";
    if (current.length >= MAX_INTERRUPTED_ASSISTANT_TEXT_CHARACTERS) continue;
    textByItemId.set(
      itemId,
      `${current}${delta}`.slice(
        0,
        MAX_INTERRUPTED_ASSISTANT_TEXT_CHARACTERS,
      ),
    );
  }

  return [...textByItemId]
    .filter(
      ([itemId, text]) =>
        !completedNativeItemIds.has(itemId) && text.trim().length > 0,
    )
    .map(([itemId, text]) => ({
      itemId,
      text,
      existingCompletion: existingCompletionsByItemId.get(itemId) ?? null,
    }));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nativeTurnHasCompletedPlanOutput(
  nativeTurn: Record<string, unknown> | undefined,
): boolean {
  if (!nativeTurn || !Array.isArray(nativeTurn.items)) return false;
  return nativeTurn.items.some((value) => {
    const item = asObject(value);
    return (
      item.type === "plan" &&
      typeof item.text === "string" &&
      item.text.trim().length > 0
    );
  });
}

function nativeRecoveryTurnStatus(
  nativeTurn: Record<string, unknown> | undefined,
): "inProgress" | "completed" | "failed" | "interrupted" | null {
  const status = nativeTurn?.status;
  return status === "inProgress" ||
    status === "completed" ||
    status === "failed" ||
    status === "interrupted"
    ? status
    : null;
}

function stableStreamingMessageId(turnId: string): string {
  const hex = turnId.replaceAll("-", "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizeGeneratedTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  if (!normalized) return "";
  return truncateConversationTitle(normalized);
}
