import { createHash } from "node:crypto";
import { access, chmod, constants, copyFile, lstat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { v5 as uuidv5 } from "uuid";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

import {
  RunnerStartOperationUncertainError,
  RunnerSteerOperationUncertainError,
  type RunnerStartOperation,
  type RunnerStartInput,
  type RunnerCapability,
  type RunnerClient,
  type RunnerGoalRuntimeInput,
  type RunnerGoalClearInput,
  type RunnerSubAgentReadRuntimeInput,
} from "../../adapters/runner.js";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import { AppError } from "../../lib/errors.js";
import { truncateConversationTitle } from "../../lib/conversation-title.js";
import { ensureSharedWorkspaceDirectory } from "../../lib/shared-workspace-directory.js";
import {
  conversationWorkspaceRelativePath,
  resolveConversationWorkspaceEntry,
  resolveConversationWorkspaceRoot,
} from "../../lib/user-runtime-paths.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import { restoreUnreferencedVersionCleanupEligibility } from "../knowledge/retention.js";
import type { KnowledgeStore } from "../knowledge/types.js";
import {
  builtInCapabilityDefinitionForId,
  capabilitySelectionIdSchema,
  capabilitySourceTypeSchema,
  capabilityTypeSchema,
  capabilityAttachedEventSchema,
  buildOfficeAnnotationDisplay,
  conversationFormResponseContentSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormRequestedSchema,
  conversationFormResponseMatchesSchema,
  conversationFormUiHintsSchema,
  officeAnnotationRequestText,
  conversationCollaborationModeSchema,
  conversationEventSchema,
  conversationPlanReviewActionSchema,
  conversationPlanReviewStatusSchema,
  conversationUserInputQuestionSchema,
  conversationUserInputResponseSchema,
  knowledgeBaseIdsSchema,
  modelAutoCompactTokenLimitFor,
  reasoningEffortSchema,
  referencedRunnerCodexSubAgentKeys,
  runnerCodexItemSchema,
  runnerCodexPreviewLimits,
  runtimeMcpServerSchema,
  RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
  RUNNER_TURN_INTERRUPT_REQUESTED,
  userMessageDisplaySchema,
  type HtmlAnnotation,
  type ApplicationIcon,
  type ConversationCollaborationMode,
  type ConversationOrderGroup,
  type ConversationPlanReviewAction,
  type ConversationUserInputResponse,
  type Locale,
  type PublicKnowledgeCitation,
  type ReasoningEffort,
  type OfficeAnnotationInput,
  type PresentationAnnotation,
  type PresentationAnnotationInput,
  type SpreadsheetAnnotation,
  type SpreadsheetChartElementSelection,
  type UserMessageDisplay,
  type UserMessageCapability,
  type WordAnnotation,
  type RuntimeMcpServer,
  type RunnerCodexGoal,
  type ResolvedExecutionConcurrencySettings,
  type ThreadGoal,
  workspacePermissionPolicy,
} from "@linksense/shared";
import { capabilityPackageNameSchema } from "../capabilities/package-name.js";
import type { CapabilityRuntimeVerification } from "../capabilities/user-home-materializer.js";
import { nextConversationEventSequence } from "../events/sequence.js";
import type {
  ModelRuntimeSettingsReader,
  ResolvedModelTransitionRuntime,
  ResolvedModelRuntime,
} from "../system/model-provider-settings.js";
import {
  buildOfficeAnnotationRunnerContext,
  inspectOfficeAnnotationPrompt,
  OFFICE_ANNOTATION_PROMPT_MARKER,
} from "./annotation-prompt.js";
import {
  forkBaseTitle,
  forkedConversationTitle,
  isValidForkedThreadHistory,
  remapForkedJson,
} from "./fork.js";
import {
  goalResumeIdempotencyKey,
  projectConversationGoal,
  upsertConversationGoal,
  type ConversationGoalRow,
} from "./goals.js";

export type ExecutionCapability = RunnerCapability & {
  sourcePath: string;
  description: string | null;
  sourceType?: string;
  sourceOwnerId?: string;
  credentialFingerprint?: string;
};

const EMPTY_MCP_GENERATION =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SKILL_USAGE_SOURCE_NAMESPACE = "6c0f0e31-433c-4b11-b32a-7e27a2e56f49";
const nativeSubAgentItemEventPayloadSchema = z.object({
  schema_version: z.literal(2),
  source: z.literal("codex_app_server"),
  method: z.enum(["item/started", "item/completed"]),
  params: z.object({ item: runnerCodexItemSchema }),
});

export type ApplicationTurnConfiguration = {
  kind: "standard" | "interactive";
  applicationId: string;
  applicationOwnerId: string;
  applicationName: string;
  applicationUpdatedAt: Date;
  instructions: string;
  model: string | null;
  reasoningEffort:
    "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null;
  capabilityIds: string[];
  knowledgeBaseIds: string[];
  mcpServerIds: string[];
};

export interface ConversationApplicationResolver {
  resolveRuntime(
    actorId: string,
    applicationId: string,
    interactivePackageId?: string | null,
  ): Promise<ApplicationTurnConfiguration>;
  assertCurrentAccess(actorId: string, applicationId: string): Promise<void>;
  allowsUserModelSelection(
    actorId: string,
    applicationId: string,
  ): Promise<boolean>;
  resolveDisplayIcons?(
    actorId: string,
    applicationIds: readonly string[],
  ): Promise<ReadonlyMap<string, ApplicationIcon>>;
}

export type CapabilityResolutionScope = {
  applicationId?: string;
  sourceOwnerId: string;
  capabilityIds: string[];
  mcpServerIds: string[];
};

export interface ConversationPreflight {
  ensureUserHome(userId: string): Promise<void>;
  resolve(input: {
    userId: string;
    priorityCapabilityIds: string[];
    capabilityScope?: CapabilityResolutionScope;
  }): Promise<{
    capabilities: ExecutionCapability[];
    capabilityGeneration: string;
    capabilityVerification: CapabilityRuntimeVerification;
    mcpServers?: RuntimeMcpServer[];
    mcpGeneration?: string;
    environment?: Record<string, string>;
    credentialUsageReceipts?: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }>;
    mcpCredentialUsageReceipts?: Array<{ serverId: string }>;
  }>;
  commitCredentialUsage?(
    receipts: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }>,
  ): Promise<void>;
  resolveRecovery(input: {
    userId: string;
    capabilities: PersistedTurnCapability[];
    mcpServers?: RuntimeMcpServer[];
    applicationId?: string;
  }): Promise<{
    environment?: Record<string, string>;
  }>;
  resolveStartIntentRecovery(input: {
    userId: string;
    capabilities: PersistedTurnCapability[];
    mcpServers?: RuntimeMcpServer[];
    applicationId?: string;
  }): Promise<{
    environment?: Record<string, string>;
  }>;
  withCapabilityStartBarrier<T>(
    input: {
      userId: string;
      priorityCapabilityIds: string[];
      capabilities: ExecutionCapability[];
      capabilityGeneration: string;
      capabilityVerification: CapabilityRuntimeVerification;
      mcpServers?: RuntimeMcpServer[];
      mcpGeneration?: string;
      environment: Record<string, string>;
      credentialUsageReceipts: Array<{
        userId: string;
        capabilityId: string;
        credentialIds: string[];
      }>;
      mcpCredentialUsageReceipts?: Array<{ serverId: string }>;
      capabilityScope?: CapabilityResolutionScope;
    },
    action: () => Promise<T>,
  ): Promise<T>;
}

export type TokenLimitEnforcer = {
  assertCanStartTask(userId: string): Promise<void>;
};

function projectRunnerCapabilities(
  capabilities: Array<{
    id: string;
    name: string;
    type: "plugin" | "skill";
    revision: string;
    credentialEnvironment?: Record<string, string> | undefined;
  }>,
): RunnerCapability[] {
  return capabilities.map(
    ({ id, name, type, revision, credentialEnvironment }) => ({
      id,
      name,
      type,
      revision,
      ...(credentialEnvironment ? { credentialEnvironment } : {}),
    }),
  );
}

export interface RuntimeCleanupScheduler {
  enqueueRuntimeCleanup(ownerId: string, conversationId: string): Promise<void>;
  enqueueConversationPrewarm(input: {
    ownerId: string;
    conversationId: string;
    collaborationMode: ConversationCollaborationMode;
  }): Promise<void>;
}

type TurnSubmissionBase = {
  collaborationMode?: ConversationCollaborationMode;
  priorityCapabilityIds: string[];
  knowledgeBaseIds?: string[];
  idempotencyKey?: string;
  submitMode: "normal" | "next_turn" | "manual_retry";
  preserveStagedAttachments?: boolean;
  modelPreference?: {
    modelId: string;
    reasoningEffort: ReasoningEffort;
  };
  goal?: {
    objective: string;
    tokenBudget?: number | null;
    resumeExisting?: boolean;
  };
};

export type TurnSubmission = TurnSubmissionBase &
  (
    | {
        inputText: string;
        officeAnnotation?: never;
        presentationAnnotation?: never;
      }
    | {
        inputText?: never;
        officeAnnotation: OfficeAnnotationInput;
        presentationAnnotation?: never;
      }
    | {
        inputText?: never;
        officeAnnotation?: never;
        presentationAnnotation: PresentationAnnotationInput;
      }
  );

export type TurnStartReceipt = {
  turn_id: string;
  accepted: true;
  status: "starting" | "running";
};

export type GoalStartInput = {
  objective: string;
  tokenBudget?: number | null;
  priorityCapabilityIds: string[];
  knowledgeBaseIds?: string[];
  idempotencyKey?: string;
};

export type GoalUpdateInput = {
  objective?: string;
  tokenBudget?: number | null;
  status?: "paused" | "blocked" | "usageLimited" | "complete";
};

type PendingTurnSubmissionBase = {
  collaborationMode?: ConversationCollaborationMode;
  priorityCapabilityIds: string[];
  knowledgeBaseIds?: string[];
  idempotencyKey?: string;
  preserveStagedAttachments?: boolean;
  modelPreference?: {
    modelId: string;
    reasoningEffort: ReasoningEffort;
  };
};

type PendingTurnSubmission = PendingTurnSubmissionBase &
  (
    | {
        inputText: string;
        officeAnnotation?: never;
        presentationAnnotation?: never;
      }
    | {
        inputText?: never;
        officeAnnotation: OfficeAnnotationInput;
        presentationAnnotation?: never;
      }
    | {
        inputText?: never;
        officeAnnotation?: never;
        presentationAnnotation: PresentationAnnotationInput;
      }
  );

type PreparedTurnSubmission = Omit<
  TurnSubmissionBase,
  "knowledgeBaseIds"
> & {
  inputText: string;
  collaborationMode: ConversationCollaborationMode;
  knowledgeBaseIds: string[];
  messageDisplay: UserMessageDisplay | null;
};

function submissionOfficeAnnotation(
  submission: TurnSubmission | PendingTurnSubmission,
): OfficeAnnotationInput | null {
  if ("officeAnnotation" in submission && submission.officeAnnotation) {
    return submission.officeAnnotation;
  }
  if (
    "presentationAnnotation" in submission &&
    submission.presentationAnnotation
  ) {
    return submission.presentationAnnotation;
  }
  return null;
}

type RegenerationSource = {
  messageId: string;
  turnId: string;
  turnSequenceNo: number;
  codexThreadId: string;
  codexTurnId: string;
};

type PlanReviewTurnAction = {
  reviewId: string;
  action: Extract<ConversationPlanReviewAction, "implement" | "revise">;
};

export type PlanReviewActionInput =
  | { action: "implement"; idempotencyKey: string }
  | { action: "revise"; feedback: string; idempotencyKey: string }
  | { action: "skip" }
  | { action: "exit" };

const CONVERSATION_DETAIL_EVENT_LIMIT = 200;
const PLAN_OUTPUT_MISSING_ERROR_CODE = "PLAN_OUTPUT_MISSING";
const ACCEPTED_START_RECOVERY_WINDOW_MILLISECONDS = 60_000;
const ACCEPTED_START_RECOVERY_POLL_MILLISECONDS = 250;
const START_INTENT_RECOVERY_LOCK_TTL_MILLISECONDS = 15_000;
const RESERVED_RUNTIME_CLAIM_WINDOW_MILLISECONDS = 1_000;
const RESERVED_RUNTIME_CLAIM_POLL_MILLISECONDS = 25;
const CONVERSATION_DETAIL_TRANSIENT_EVENT_TYPES = [
  "conversation.message.delta",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "turn/plan/updated",
] as const;
const USER_MESSAGE_DISPLAY_EVENT_TYPE = "conversation.message.display_context";
const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HTML_MIME_TYPE = "text/html";
const TERMINAL_TURN_STATUSES = ["completed", "failed", "interrupted"] as const;
const userMessageDisplayEventPayloadSchema = z.strictObject({
  schema_version: z.literal(1),
  message_id: z.uuid(),
  display: userMessageDisplaySchema,
});
const steeredMessageEventPayloadSchema = z.strictObject({
  schema_version: z.literal(1),
  message_id: z.uuid(),
  role: z.literal("user"),
  usage_type: z.literal("steer_current_turn"),
});
const rawPlanEventRowSchema = z.strictObject({
  id: z.uuid(),
  conversationId: z.uuid(),
  turnId: z.uuid(),
  sequenceNo: z.bigint().nonnegative(),
  eventType: z.literal("turn/plan/updated"),
  visibility: z.enum(["user_visible", "user_collapsed"]),
  payloadJson: z.unknown(),
  sseEventId: z.string().min(1).max(160),
  createdAt: z.date(),
});
const rawFileChangeCountRowSchema = z.strictObject({
  turnId: z.uuid(),
  fileCount: z.bigint().nonnegative().max(BigInt(Number.MAX_SAFE_INTEGER)),
});
const credentialEnvironmentSnapshotSchema = z
  .record(
    z
      .string()
      .max(120)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    z.string().regex(/^LINKSENSE_CREDENTIAL_[A-F0-9]{32}$/u),
  )
  .refine((value) => Object.keys(value).length > 0);
const persistedTurnCapabilitySchema = z.strictObject({
  id: z.uuid(),
  type: capabilityTypeSchema,
  name: capabilityPackageNameSchema,
  revision: z.string().min(1).max(160),
  credentialEnvironment: credentialEnvironmentSnapshotSchema.optional(),
  description: z.string().max(4_000).nullable(),
  sourceType: capabilitySourceTypeSchema,
  sourceOwnerId: z.uuid().optional(),
});
const turnStartIntentCredentialUsageReceiptSchema = z.strictObject({
  userId: z.uuid(),
  capabilityId: z.string().min(1),
  credentialIds: z.array(z.uuid()),
});
const turnStartIntentMcpCredentialUsageReceiptSchema = z.strictObject({
  serverId: z.uuid(),
});
const turnStartIntentAttachmentSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal("attachment"),
  source: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().nullable(),
  sizeBytes: z.string().regex(/^\d+$/u),
  checksumSha256: z.string().nullable(),
  storageBackend: z.string().min(1),
  workspaceRelativePath: z.string().nullable(),
  minioObjectKey: z.string().nullable(),
  downloadable: z.boolean(),
  createdBy: z.uuid().nullable(),
});
const turnStartIntentRegenerationSchema = z.strictObject({
  messageId: z.uuid(),
  turnId: z.uuid(),
  turnSequenceNo: z.number().int().positive(),
  codexThreadId: z.string().min(1),
  codexTurnId: z.string().min(1),
});
const turnStartIntentSchema = z.strictObject({
  projectionTurnId: z.uuid(),
  ownerId: z.uuid(),
  conversationId: z.uuid(),
  runtimeGeneration: z.uuid(),
  capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
  mcpGeneration: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullish()
    .transform((value) => value ?? EMPTY_MCP_GENERATION),
  model: z
    .string()
    .min(1)
    .max(240)
    .nullish()
    .transform((value) => value ?? null),
  reasoningEffort: reasoningEffortSchema
    .nullish()
    .transform((value) => value ?? null),
  applicationId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? null),
  applicationUpdatedAt: z
    .date()
    .nullish()
    .transform((value) => value ?? null),
  applicationInstructions: z
    .string()
    .max(20_000)
    .nullish()
    .transform((value) => value ?? null),
  inputText: z.string(),
  taskKind: z
    .enum(["turn", "goal", "compact"])
    .nullish()
    .transform((value) => value ?? "turn"),
  collaborationMode: conversationCollaborationModeSchema
    .nullish()
    .transform((value) => value ?? "default"),
  goalObjective: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .nullish()
    .transform((value) => value ?? null),
  goalTokenBudget: z
    .bigint()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  priorityCapabilityIdsJson: z.array(capabilitySelectionIdSchema),
  knowledgeBaseIdsJson: z.array(z.uuid()),
  capabilitiesJson: z.array(persistedTurnCapabilitySchema),
  mcpServersJson: z
    .array(runtimeMcpServerSchema)
    .nullish()
    .transform((value) => value ?? []),
  credentialUsageReceiptsJson: z.array(
    turnStartIntentCredentialUsageReceiptSchema,
  ),
  mcpCredentialUsageReceiptsJson: z
    .array(turnStartIntentMcpCredentialUsageReceiptSchema)
    .nullish()
    .transform((value) => value ?? []),
  attachmentsJson: z.array(turnStartIntentAttachmentSchema),
  messageDisplayJson: userMessageDisplaySchema.nullable(),
  submitMode: z.enum(["normal", "next_turn", "manual_retry"]),
  idempotencyKey: z.string().min(1).max(120).nullable(),
  preservesStagedAttachments: z.boolean(),
  pendingRequestId: z.uuid().nullable(),
  planReviewId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? null),
  planReviewAction: z
    .enum(["implement", "revise"])
    .nullish()
    .transform((value) => value ?? null),
  regenerationJson: turnStartIntentRegenerationSchema.nullable(),
  auditIpAddress: z.string().nullable(),
  auditUserAgent: z.string().nullable(),
  runnerStatus: z.enum([
    "slot_pending",
    "prepared",
    "runner_succeeded",
    "release_pending",
  ]),
  codexThreadId: z.string().min(1).nullable(),
  codexTurnId: z.string().min(1).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).superRefine((intent, context) => {
  const isGoal = intent.taskKind === "goal";
  if (isGoal !== (intent.goalObjective !== null)) {
    context.addIssue({
      code: "custom",
      path: ["goalObjective"],
      message: "goal_objective_does_not_match_task_kind",
    });
  }
  if (!isGoal && intent.goalTokenBudget !== null) {
    context.addIssue({
      code: "custom",
      path: ["goalTokenBudget"],
      message: "goal_token_budget_requires_goal_task",
    });
  }
  if ((intent.planReviewId === null) !== (intent.planReviewAction === null)) {
    context.addIssue({
      code: "custom",
      path: ["planReviewId"],
      message: "plan_review_action_requires_review_id",
    });
  }
  if (
    intent.planReviewAction === "implement" &&
    intent.collaborationMode !== "default"
  ) {
    context.addIssue({
      code: "custom",
      path: ["collaborationMode"],
      message: "plan_implementation_requires_default_mode",
    });
  }
  if (
    intent.planReviewAction === "revise" &&
    intent.collaborationMode !== "plan"
  ) {
    context.addIssue({
      code: "custom",
      path: ["collaborationMode"],
      message: "plan_revision_requires_plan_mode",
    });
  }
});

type TurnStartIntent = z.infer<typeof turnStartIntentSchema>;
export type PersistedTurnCapability = z.infer<
  typeof persistedTurnCapabilitySchema
>;
const persistedTurnRecoveryStateSchema = z.strictObject({
  conversationId: z.uuid().optional(),
  capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
  capabilitiesJson: z.array(persistedTurnCapabilitySchema),
  mcpGeneration: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullish()
    .transform((value) => value ?? EMPTY_MCP_GENERATION),
  mcpServersJson: z
    .array(runtimeMcpServerSchema)
    .nullish()
    .transform((value) => value ?? []),
  model: z.string().min(1).max(240).nullable().optional(),
  reasoningEffort: reasoningEffortSchema.nullable().optional(),
});
const contextWindowContinuationContextSchema = z.strictObject({
  collaboration_mode: conversationCollaborationModeSchema.default("default"),
  require_final_response: z.boolean().default(false),
  application_instructions: z.string().max(20_000).nullable().default(null),
  selected_knowledge_base_count: z.number().int().nonnegative().default(0),
  priority_capability_ids: z.array(capabilitySelectionIdSchema).default([]),
});
const CONTEXT_WINDOW_CONTINUATION_INPUT = [
  "<linksense_context_window_recovery>",
  "The previous native turn stopped only because the model context window was exceeded.",
  "Continue the same task from the current persisted conversation and workspace state.",
  "Do not repeat commands, file edits, tool calls, or other actions that are already complete.",
  "First inspect the retained context and current state, then finish all remaining work.",
  "</linksense_context_window_recovery>",
].join("\n");
const PLAN_IMPLEMENTATION_INPUT = "Implement the plan.";
type TurnStartIntentAttachment = z.infer<
  typeof turnStartIntentAttachmentSchema
>;
type TurnStartProjectionResult = {
  created: Parameters<typeof projectTurn>[0];
  attachedEvents: Array<Parameters<typeof projectStoredEvent>[0]>;
};
type StartedRunnerTurn = {
  codexThreadId: string;
  codexTurnId: string;
  goal?: RunnerCodexGoal | undefined;
};

export type ExecutionConcurrencySettingsReader = {
  resolveExecutionConcurrencySettings(): Promise<ResolvedExecutionConcurrencySettings>;
};

type ConversationDetailEventRow = {
  id: string;
  conversationId: string;
  turnId: string | null;
  sequenceNo: bigint;
  eventType: string;
  visibility: string;
  payloadJson: unknown;
  sseEventId: string;
  createdAt: Date;
};

type ModelContextUsageCursorRow = {
  lastTotalTokens: bigint | null;
  modelContextWindow: bigint | null;
  lastObservedAt: Date;
};

export class ConversationService {
  private readonly acceptedStartRecoveries = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: LinkSenseRedis,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
    private readonly preflight: ConversationPreflight,
    private readonly workspaceRoot: string,
    private readonly cleanup: RuntimeCleanupScheduler,
    private readonly knowledgeStore?: Pick<
      KnowledgeStore,
      "resolveUsableKnowledgeBaseIds"
    > &
      Partial<Pick<KnowledgeStore, "findKnowledgeBaseAccess">>,
    private readonly modelRuntimeSettings?: ModelRuntimeSettingsReader,
    private readonly applicationResolver?: ConversationApplicationResolver,
    private readonly tokenLimits?: TokenLimitEnforcer,
    private readonly executionConcurrencySettings?: ExecutionConcurrencySettingsReader,
  ) {}

  private async executionConcurrencyForStart(): Promise<ResolvedExecutionConcurrencySettings> {
    return this.executionConcurrencySettings
      ? this.executionConcurrencySettings.resolveExecutionConcurrencySettings()
      : {
          max_concurrent_conversations: this.redis.maxConcurrentTurns,
          runner_app_server_process_limit: this.redis.maxConcurrentTurns,
        };
  }

  runnerForRecovery(): RunnerClient {
    return this.runner;
  }

  private async applicationRuntimeForConversation(
    ownerId: string,
    applicationId: string | null | undefined,
    interactivePackageId?: string | null,
  ): Promise<ApplicationTurnConfiguration | null> {
    if (applicationId == null) return null;
    if (!this.applicationResolver) {
      throw new AppError("APPLICATION_NOT_FOUND");
    }
    return interactivePackageId === undefined
      ? this.applicationResolver.resolveRuntime(ownerId, applicationId)
      : this.applicationResolver.resolveRuntime(
          ownerId,
          applicationId,
          interactivePackageId,
        );
  }

  private async modelRuntimeForUser(
    userId: string,
    conversationId?: string,
  ): Promise<ResolvedModelRuntime> {
    if (!this.modelRuntimeSettings) {
      throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED");
    }
    const runtime = await this.modelRuntimeSettings.resolveRuntime(
      userId,
      conversationId,
    );
    return this.withObservedAutoCompaction(userId, conversationId, runtime);
  }

  private async modelRuntimeForSelection(
    userId: string,
    conversationId: string | undefined,
    model: string,
    reasoningEffort: ResolvedModelRuntime["reasoningEffort"],
  ): Promise<ResolvedModelRuntime> {
    if (!this.modelRuntimeSettings) {
      throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED");
    }
    const runtime = await this.modelRuntimeSettings.resolveRuntimeForSelection(
      model,
      reasoningEffort,
    );
    return this.withObservedAutoCompaction(userId, conversationId, runtime);
  }

  private async modelRuntimeForIntent(
    intent: TurnStartIntent,
  ): Promise<ResolvedModelRuntime> {
    if (intent.model && intent.reasoningEffort) {
      return this.modelRuntimeForSelection(
        intent.ownerId,
        intent.conversationId,
        intent.model,
        intent.reasoningEffort,
      );
    }
    return this.modelRuntimeForUser(intent.ownerId, intent.conversationId);
  }

  private async withObservedAutoCompaction(
    ownerId: string,
    conversationId: string | undefined,
    runtime: ResolvedModelRuntime,
  ): Promise<ResolvedModelRuntime> {
    if (
      !conversationId ||
      runtime.provider.modelContextWindow !== undefined ||
      runtime.provider.modelAutoCompactTokenLimit !== undefined
    ) {
      return runtime;
    }
    const cursor = await this.prisma.codexThreadTokenUsageCursor.findFirst({
      where: { conversationId, ownerId },
      orderBy: { lastObservedAt: "desc" },
      select: {
        lastCodexTurnId: true,
        modelContextWindow: true,
      },
    });
    if (
      cursor?.modelContextWindow === null ||
      cursor?.modelContextWindow === undefined ||
      cursor.modelContextWindow <= 0n ||
      cursor.modelContextWindow > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return runtime;
    }
    const sourceTurn = await this.prisma.conversationTurn.findFirst({
      where: {
        conversationId,
        codexTurnId: cursor.lastCodexTurnId,
      },
      select: { model: true },
    });
    if (sourceTurn?.model !== runtime.model) return runtime;
    const modelContextWindow = Number(cursor.modelContextWindow);
    return {
      ...runtime,
      provider: {
        ...runtime.provider,
        modelAutoCompactTokenLimit:
          modelAutoCompactTokenLimitFor(modelContextWindow),
      },
    };
  }

  private async modelTransitionSourceForIntent(
    intent: TurnStartIntent,
    currentModel: string,
    codexThreadId: string | null,
  ): Promise<ResolvedModelTransitionRuntime | null> {
    return this.modelTransitionSourceForConversation(
      intent.conversationId,
      currentModel,
      codexThreadId,
      intent.regenerationJson?.turnSequenceNo,
    );
  }

  private async modelTransitionSourceForConversation(
    conversationId: string,
    currentModel: string,
    codexThreadId: string | null,
    beforeSequenceNo?: number,
  ): Promise<ResolvedModelTransitionRuntime | null> {
    if (!codexThreadId) return null;
    const establishedSourceTurn = await this.prisma.conversationTurn.findFirst({
      where: {
        conversationId,
        codexThreadId,
        model: { not: null },
        status: "completed",
        ...(beforeSequenceNo === undefined
          ? {}
          : { sequenceNo: { lt: beforeSequenceNo } }),
      },
      orderBy: { sequenceNo: "desc" },
      select: { model: true },
    });
    const fallbackSourceTurn = establishedSourceTurn
      ? null
      : await this.prisma.conversationTurn.findFirst({
          where: {
            conversationId,
            codexThreadId,
            model: { not: null },
            ...(beforeSequenceNo === undefined
              ? {}
              : { sequenceNo: { lt: beforeSequenceNo } }),
          },
          orderBy: { sequenceNo: "desc" },
          select: { model: true },
        });
    const sourceModel = (
      establishedSourceTurn ?? fallbackSourceTurn
    )?.model?.trim();
    if (!sourceModel || sourceModel === currentModel) return null;
    if (!this.modelRuntimeSettings) {
      throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED");
    }
    return this.modelRuntimeSettings.resolveModelTransitionRuntime(sourceModel);
  }

  private async validateKnowledgeBaseSelection(
    ownerId: string,
    requestedIds: string[] | undefined,
  ): Promise<string[]> {
    const parsed = knowledgeBaseIdsSchema.safeParse(requestedIds ?? []);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR");
    if (parsed.data.length === 0) return [];
    if (!this.knowledgeStore) {
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
    }
    // Keep the user's ordered selection as the immutable turn snapshot.
    // Authorization and availability are intentionally intersected again at
    // retrieval time. A revoked, archived, disabled, or deleted selection must
    // not block an otherwise valid task submission, and preserving it here lets
    // the MCP return an accurate partial/no-available-bases notice.
    await this.knowledgeStore.resolveUsableKnowledgeBaseIds(
      ownerId,
      parsed.data,
    );
    return parsed.data;
  }

  async prewarm(
    ownerId: string,
    input: {
      conversationId?: string;
      collaborationMode: ConversationCollaborationMode;
    },
  ): Promise<{ accepted: true; conversation_id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { status: true },
    });
    if (!user || user.status !== "active") throw new AppError("USER_DISABLED");
    const conversationId = input.conversationId ?? crypto.randomUUID();
    if (input.conversationId) {
      const existing = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { ownerId: true },
      });
      if (!existing || existing.ownerId !== ownerId) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
    }
    await this.cleanup.enqueueConversationPrewarm({
      ownerId,
      conversationId,
      collaborationMode: input.collaborationMode,
    });
    return { accepted: true as const, conversation_id: conversationId };
  }

  async executePrewarm(input: {
    ownerId: string;
    conversationId: string;
    collaborationMode: ConversationCollaborationMode;
  }): Promise<void> {
    const existing = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        ownerId: true,
        applicationId: true,
        codexThreadId: true,
        collaborationMode: true,
      },
    });
    if (existing && existing.ownerId !== input.ownerId) return;
    if (existing?.applicationId) {
      await this.preflight.ensureUserHome(input.ownerId);
      await this.runner.prewarmWorker(input.ownerId);
      return;
    }

    const [resolved, modelRuntime, executionConcurrency] = await Promise.all([
      this.preflight.resolve({
        userId: input.ownerId,
        priorityCapabilityIds: [],
      }),
      this.modelRuntimeForUser(
        input.ownerId,
        existing ? input.conversationId : undefined,
      ),
      this.executionConcurrencyForStart(),
    ]);
    const [runtime] = await Promise.all([
      this.runner.prepareRuntime(input.conversationId, input.ownerId),
      this.runner.prewarmWorker(input.ownerId),
    ]);
    const collaborationMode = existing
      ? conversationCollaborationModeSchema.parse(existing.collaborationMode)
      : input.collaborationMode;
    const modelTransitionSource = existing
      ? await this.modelTransitionSourceForConversation(
          input.conversationId,
          modelRuntime.model,
          existing.codexThreadId,
        )
      : null;
    await this.runner.prewarmConversation({
      conversationId: input.conversationId,
      projectionTurnId: crypto.randomUUID(),
      appServerProcessLimit:
        executionConcurrency.runner_app_server_process_limit,
      ownerId: input.ownerId,
      expectedRuntimeGeneration: runtime.runtimeGeneration,
      capabilityGeneration: resolved.capabilityGeneration,
      mcpGeneration: resolved.mcpGeneration ?? EMPTY_MCP_GENERATION,
      mcpServers: resolved.mcpServers ?? [],
      codexThreadId: existing?.codexThreadId ?? null,
      ...(modelTransitionSource ? { modelTransitionSource } : {}),
      collaborationMode,
      context: {
        userInput: "",
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: projectRunnerCapabilities(resolved.capabilities),
      environment: resolved.environment ?? {},
      model: modelRuntime.model,
      reasoningEffort: modelRuntime.reasoningEffort,
      modelProvider: modelRuntime.provider,
    });
  }

  async resolveRecoveryRuntime(
    ownerId: string,
    persistedState: {
      conversationId?: unknown;
      capabilityGeneration: unknown;
      capabilitiesJson: unknown;
      mcpGeneration?: unknown;
      mcpServersJson?: unknown;
      model?: unknown;
      reasoningEffort?: unknown;
    },
    options: { includeModelTransitionSource?: boolean } = {},
  ): Promise<{
    capabilities: RunnerCapability[];
    capabilityGeneration: string;
    mcpGeneration: string;
    mcpServers: RuntimeMcpServer[];
    environment: Record<string, string>;
    modelRuntime: ResolvedModelRuntime;
    modelTransitionSource: ResolvedModelTransitionRuntime | null;
  }> {
    const parsed = persistedTurnRecoveryStateSchema.safeParse(persistedState);
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    const recoveryApplication = parsed.data.conversationId
      ? await this.prisma.conversation.findFirst({
        where: {
          id: parsed.data.conversationId,
          ownerId,
        },
        select: { applicationId: true, codexThreadId: true },
      })
      : null;
    const [resolved, modelRuntime] = await Promise.all([
      this.preflight.resolveRecovery({
        userId: ownerId,
        capabilities: parsed.data.capabilitiesJson,
        mcpServers: parsed.data.mcpServersJson,
        ...(recoveryApplication?.applicationId
          ? { applicationId: recoveryApplication.applicationId }
          : {}),
      }),
      parsed.data.model && parsed.data.reasoningEffort
        ? this.modelRuntimeForSelection(
            ownerId,
            parsed.data.conversationId,
            parsed.data.model,
            parsed.data.reasoningEffort,
          )
        : this.modelRuntimeForUser(ownerId, parsed.data.conversationId),
    ]);
    const modelTransitionSource =
      options.includeModelTransitionSource === true &&
      parsed.data.conversationId &&
      recoveryApplication?.codexThreadId
        ? await this.modelTransitionSourceForConversation(
            parsed.data.conversationId,
            modelRuntime.model,
            recoveryApplication.codexThreadId,
          )
        : null;
    return {
      capabilities: projectRunnerCapabilities(parsed.data.capabilitiesJson),
      capabilityGeneration: parsed.data.capabilityGeneration,
      mcpGeneration: parsed.data.mcpGeneration,
      mcpServers: parsed.data.mcpServersJson,
      environment: resolved.environment ?? {},
      modelRuntime,
      modelTransitionSource,
    };
  }

  private async requireConversationGoal(
    ownerId: string,
    conversationId: string,
  ): Promise<ConversationGoalRow> {
    await this.assertOwner(ownerId, conversationId);
    const goal = await this.prisma.conversationGoal.findFirst({
      where: { conversationId, ownerId },
    });
    if (!goal) throw new AppError("CONFLICT");
    return goal;
  }

  private async buildGoalRuntimeInput(
    ownerId: string,
    conversationId: string,
    goal: ConversationGoalRow,
    projectionTurnId?: string,
  ): Promise<RunnerGoalRuntimeInput> {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (conversation.codexThreadId !== goal.codexThreadId) {
      throw new AppError("CONFLICT");
    }
    const selectedTurnId = projectionTurnId ?? goal.activeTurnId;
    const activeTurn = selectedTurnId
      ? await this.prisma.conversationTurn.findFirst({
          where: {
            id: selectedTurnId,
            conversationId,
            codexThreadId: goal.codexThreadId,
          },
        })
      : null;
    const projectionTurn =
      activeTurn ??
      (await this.prisma.conversationTurn.findFirst({
        where: { conversationId, codexThreadId: goal.codexThreadId },
        orderBy: { sequenceNo: "desc" },
      }));
    if (!projectionTurn) throw new AppError("CONFLICT");
    const runtime = await this.resolveRecoveryRuntime(ownerId, {
      conversationId,
      capabilityGeneration: projectionTurn.capabilityGeneration,
      capabilitiesJson: projectionTurn.capabilitiesJson,
      mcpGeneration: projectionTurn.mcpGeneration,
      mcpServersJson: projectionTurn.mcpServersJson,
      model: projectionTurn.model,
      reasoningEffort: projectionTurn.reasoningEffort,
    });
    return {
      conversationId,
      ownerId,
      expectedRuntimeGeneration: conversation.runtimeGeneration,
      capabilityGeneration: runtime.capabilityGeneration,
      mcpGeneration: runtime.mcpGeneration,
      mcpServers: runtime.mcpServers,
      codexThreadId: goal.codexThreadId,
      projectionTurnId: projectionTurn.id,
      capabilities: runtime.capabilities,
      environment: runtime.environment,
      model: runtime.modelRuntime.model,
      reasoningEffort: runtime.modelRuntime.reasoningEffort,
      modelProvider: runtime.modelRuntime.provider,
    };
  }

  private async buildGoalClearInput(
    ownerId: string,
    conversationId: string,
    goal: ConversationGoalRow,
  ): Promise<RunnerGoalClearInput> {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (conversation.codexThreadId !== goal.codexThreadId) {
      throw new AppError("CONFLICT");
    }
    const projectionTurn = await this.prisma.conversationTurn.findFirst({
      where: { conversationId, codexThreadId: goal.codexThreadId },
      orderBy: { sequenceNo: "desc" },
      select: { id: true },
    });
    if (!projectionTurn) throw new AppError("CONFLICT");
    const modelRuntime = await this.modelRuntimeForUser(
      ownerId,
      conversationId,
    );
    return {
      conversationId,
      ownerId,
      expectedRuntimeGeneration: conversation.runtimeGeneration,
      codexThreadId: goal.codexThreadId,
      projectionTurnId: projectionTurn.id,
      model: modelRuntime.model,
      reasoningEffort: modelRuntime.reasoningEffort,
      modelProvider: modelRuntime.provider,
    };
  }

  async recoverStartIntents(): Promise<void> {
    let intents: Array<{ projectionTurnId: string; conversationId: string }>;
    try {
      intents = await this.prisma.conversationTurnStartIntent.findMany({
        orderBy: { createdAt: "asc" },
        select: { projectionTurnId: true, conversationId: true },
      });
    } catch {
      throw turnProjectionUnavailableError();
    }
    let recoveryFailed = false;
    for (let index = 0; index < intents.length; index += 5) {
      await Promise.all(
        intents.slice(index, index + 5).map(({ projectionTurnId, conversationId }) =>
          this.recoverStartIntentUnderLease(
            projectionTurnId,
            conversationId,
          ).catch(async () => {
            recoveryFailed = true;
            await this.audit
              .write({
                actorId: null,
                action: "codex_turn_projection_recovery_failed",
                targetType: "conversation_turn",
                targetId: projectionTurnId,
                result: "failed",
                metadata: { reason_code: "TURN_PROJECTION_UNAVAILABLE" },
              })
              .catch(() => undefined);
          }),
        ),
      );
    }
    if (recoveryFailed) throw turnProjectionUnavailableError();
  }

  private async recoverStartIntentUnderLease(
    projectionTurnId: string,
    conversationId: string,
  ): Promise<void> {
    const token = await this.redis.acquireRecoveryLock(
      conversationId,
      START_INTENT_RECOVERY_LOCK_TTL_MILLISECONDS,
    );
    if (!token) return;
    try {
      await this.recoverStartIntent(projectionTurnId);
    } finally {
      await this.redis
        .releaseRecoveryLock(conversationId, token)
        .catch(() => undefined);
    }
  }

  async recoverContextWindowAttempts(): Promise<void> {
    const attempts = await this.prisma.conversationTurnAttempt.findMany({
      where: { kind: "context_recovery", status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    let recoveryFailed = false;
    for (let index = 0; index < attempts.length; index += 5) {
      await Promise.all(
        attempts.slice(index, index + 5).map(({ id }) =>
          this.recoverContextWindowAttempt(id).catch(async () => {
            recoveryFailed = true;
            await this.audit
              .write({
                actorId: null,
                action: "codex_context_window_recovery_failed",
                targetType: "conversation_turn_attempt",
                targetId: id,
                result: "failed",
                metadata: { reason_code: "TURN_PROJECTION_UNAVAILABLE" },
              })
              .catch(() => undefined);
          }),
        ),
      );
    }
    if (recoveryFailed) throw turnProjectionUnavailableError();
  }

  async recoverContextWindowAttempt(
    attemptId: string,
  ): Promise<"missing" | "pending" | "running" | "terminal"> {
    const initial = await this.prisma.conversationTurnAttempt.findUnique({
      where: { id: attemptId },
      select: { turnId: true },
    });
    if (!initial) return "missing";
    const initialTurn = await this.prisma.conversationTurn.findUnique({
      where: { id: initial.turnId },
      select: { conversationId: true },
    });
    if (!initialTurn) return "missing";

    const lock = await this.acquireConversationLock(initialTurn.conversationId);
    try {
      const attempt = await this.prisma.conversationTurnAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt || attempt.turnId !== initial.turnId) return "missing";
      if (attempt.status === "running") return "running";
      if (attempt.status !== "pending") return "terminal";
      if (
        attempt.kind !== "context_recovery" ||
        attempt.attemptNo !== 2 ||
        !attempt.sourceCodexTurnId ||
        attempt.codexTurnId
      ) {
        throw new AppError("CONFLICT");
      }
      const sourceCodexTurnId = attempt.sourceCodexTurnId;

      const [turn, conversation, sourceAttempt] = await Promise.all([
        this.prisma.conversationTurn.findUnique({
          where: { id: attempt.turnId },
        }),
        this.prisma.conversation.findUnique({
          where: { id: initialTurn.conversationId },
        }),
        this.prisma.conversationTurnAttempt.findUnique({
          where: {
            turnId_attemptNo: { turnId: attempt.turnId, attemptNo: 1 },
          },
        }),
      ]);
      if (
        !turn ||
        !conversation ||
        turn.conversationId !== conversation.id ||
        turn.status !== "running" ||
        turn.submittedBy !== conversation.ownerId ||
        !conversation.codexThreadId ||
        attempt.codexThreadId !== conversation.codexThreadId ||
        turn.codexTurnId !== sourceCodexTurnId
      ) {
        await this.prisma.conversationTurnAttempt.updateMany({
          where: { id: attempt.id, status: "pending" },
          data: { status: "interrupted", completedAt: new Date() },
        });
        return "terminal";
      }

      const persistedState = persistedTurnRecoveryStateSchema.parse({
        conversationId: conversation.id,
        capabilityGeneration: turn.capabilityGeneration,
        capabilitiesJson: turn.capabilitiesJson,
        mcpGeneration: turn.mcpGeneration,
        mcpServersJson: turn.mcpServersJson,
        model: turn.model,
        reasoningEffort: turn.reasoningEffort,
      });
      const [runtime, capabilityEvents, executionConcurrency] = await Promise.all([
        this.resolveRecoveryRuntime(conversation.ownerId, persistedState),
        this.prisma.conversationEvent.findMany({
          where: {
            conversationId: conversation.id,
            turnId: turn.id,
            eventType: "conversation.capability.attached",
          },
          orderBy: { sequenceNo: "asc" },
          select: { payloadJson: true },
        }),
        this.executionConcurrencyForStart(),
      ]);
      const storedContext = contextWindowContinuationContextSchema.safeParse(
        sourceAttempt?.continuationContextJson,
      );
      const continuationContext = storedContext.success
        ? storedContext.data
        : {
            collaboration_mode: conversationCollaborationModeSchema.parse(
              turn.collaborationMode,
            ),
            require_final_response: false,
            application_instructions: null,
            selected_knowledge_base_count: jsonStringArray(
              turn.knowledgeBaseIdsJson,
            ).length,
            priority_capability_ids: priorityCapabilityIdsFromEvents(
              capabilityEvents.map((event) => event.payloadJson),
            ),
          };
      const started = await this.runner.startTurn({
        conversationId: conversation.id,
        collaborationMode: conversationCollaborationModeSchema.parse(
          turn.collaborationMode,
        ),
        projectionTurnId: attempt.id,
        appServerProcessLimit:
          executionConcurrency.runner_app_server_process_limit,
        eventProjectionTurnId: turn.id,
        ownerId: conversation.ownerId,
        expectedRuntimeGeneration: z
          .uuid()
          .parse(conversation.runtimeGeneration),
        capabilityGeneration: runtime.capabilityGeneration,
        mcpGeneration: runtime.mcpGeneration,
        mcpServers: runtime.mcpServers,
        codexThreadId: conversation.codexThreadId,
        context: {
          userInput: CONTEXT_WINDOW_CONTINUATION_INPUT,
          ...(continuationContext.require_final_response
            ? { requireFinalResponse: true }
            : {}),
          ...(continuationContext.application_instructions
            ? {
                applicationInstructions:
                  continuationContext.application_instructions,
              }
            : {}),
          selectedKnowledgeBaseCount:
            continuationContext.selected_knowledge_base_count,
          attachments: [],
          priorityPlugins: runnerPriorityCapabilities(
            continuationContext.priority_capability_ids,
            persistedState.capabilitiesJson,
            "plugin",
          ),
          prioritySkills: runnerPriorityCapabilities(
            continuationContext.priority_capability_ids,
            persistedState.capabilitiesJson,
            "skill",
          ),
        },
        capabilities: runtime.capabilities,
        environment: runtime.environment,
        model: runtime.modelRuntime.model,
        reasoningEffort: runtime.modelRuntime.reasoningEffort,
        modelProvider: runtime.modelRuntime.provider,
      });
      if (started.codexThreadId !== conversation.codexThreadId) {
        throw new AppError("CONFLICT");
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_turns
          WHERE id = ${turn.id}::uuid
          FOR UPDATE
        `;
        const currentAttempt = await tx.conversationTurnAttempt.findUnique({
          where: { id: attempt.id },
        });
        if (
          currentAttempt?.status === "running" &&
          currentAttempt.codexTurnId === started.codexTurnId
        ) {
          return;
        }
        if (
          !currentAttempt ||
          currentAttempt.status !== "pending" ||
          currentAttempt.codexTurnId !== null
        ) {
          throw new AppError("CONFLICT");
        }
        const bound = await tx.conversationTurnAttempt.updateMany({
          where: { id: attempt.id, status: "pending", codexTurnId: null },
          data: {
            codexThreadId: started.codexThreadId,
            codexTurnId: started.codexTurnId,
            status: "running",
            startedAt: new Date(),
          },
        });
        const projected = await tx.conversationTurn.updateMany({
          where: {
            id: turn.id,
            conversationId: conversation.id,
            status: "running",
            codexTurnId: sourceCodexTurnId,
          },
          data: { codexTurnId: started.codexTurnId },
        });
        if (bound.count !== 1 || projected.count !== 1) {
          throw new AppError("CONFLICT");
        }
        await tx.auditLog.create({
          data: {
            actorId: turn.submittedBy,
            action: "codex_context_window_recovery_started",
            targetType: "conversation_turn",
            targetId: turn.id,
            result: "success",
            metadataJson: { attempt_no: attempt.attemptNo },
          },
        });
      });
      return "running";
    } finally {
      await this.redis
        .releaseConversationLock(initialTurn.conversationId, lock)
        .catch(() => undefined);
    }
  }

  async recoverStartIntent(
    projectionTurnId: string,
    options: { resubmitNonTerminal?: boolean } = {},
  ): Promise<"missing" | "pending" | "projected" | "released"> {
    const resubmitNonTerminal = options.resubmitNonTerminal ?? true;
    const initial = await this.prisma.conversationTurnStartIntent.findUnique({
      where: { projectionTurnId },
    });
    if (!initial) return "missing";
    const initialIntent = parseTurnStartIntent(initial);
    const lock = await this.acquireConversationLock(
      initialIntent.conversationId,
    );
    try {
      const stored = await this.prisma.conversationTurnStartIntent.findUnique({
        where: { projectionTurnId },
      });
      if (!stored) return "missing";
      let intent = parseTurnStartIntent(stored);
      if (
        intent.conversationId !== initialIntent.conversationId ||
        intent.ownerId !== initialIntent.ownerId
      ) {
        throw new AppError("CONFLICT");
      }

      if (intent.runnerStatus === "release_pending") {
        await this.finishReleasePendingStartIntent(intent);
        return "released";
      }
      if (intent.runnerStatus === "slot_pending") {
        const slots = await this.redis.runningTurnSlots();
        const hasExactSlot = slots.some(
          (slot) =>
            slot.conversationId === intent.conversationId &&
            slot.turnId === intent.projectionTurnId &&
            slot.ownerId === intent.ownerId,
        );
        if (hasExactSlot) {
          intent = await this.markStartIntentSlotAcquired(intent);
        } else {
          let operation = await this.runner.inspectStartOperation(
            intent.conversationId,
            intent.projectionTurnId,
            intent.ownerId,
          );
          assertMatchingStartOperation(intent, operation);
          if (operation === null) {
            operation = await this.runner.sealStartOperation(
              intent.conversationId,
              intent.projectionTurnId,
              intent.ownerId,
              intent.runtimeGeneration,
            );
            assertMatchingStartOperation(intent, operation);
          }
          if (
            resubmitNonTerminal &&
            (operation.status === "starting" ||
              operation.status === "uncertain")
          ) {
            const resumed = await this.resumeDurableStartIntent(intent);
            if (resumed === null) {
              const deleted =
                await this.deleteUnacquiredMissingStartIntent(intent);
              return deleted ? "released" : "pending";
            }
            operation = resumed;
            assertMatchingStartOperation(intent, operation);
          }
          if (
            operation.status === "starting" ||
            operation.status === "uncertain"
          ) {
            return "pending";
          }
          if (operation.status === "failed") {
            const deleted =
              await this.deleteUnacquiredMissingStartIntent(intent);
            return deleted ? "released" : "pending";
          }
          intent = await this.markStartIntentSlotAcquired(intent);
          const succeeded = await this.recordSucceededStartIntent(
            intent,
            operation.result,
          );
          await this.publishStartProjection(succeeded, operation.result);
          return "projected";
        }
      }
      if (
        intent.runnerStatus === "runner_succeeded" &&
        intent.codexThreadId &&
        intent.codexTurnId
      ) {
        await this.publishStartProjection(
          intent,
          await this.startedTurnForSucceededIntent(intent),
        );
        return "projected";
      }

      let operation = await this.runner.inspectStartOperation(
        intent.conversationId,
        intent.projectionTurnId,
        intent.ownerId,
      );
      assertMatchingStartOperation(intent, operation);
      let sealedMissingOperation = false;
      if (operation === null) {
        sealedMissingOperation = true;
        operation = await this.runner.sealStartOperation(
          intent.conversationId,
          intent.projectionTurnId,
          intent.ownerId,
          intent.runtimeGeneration,
        );
        assertMatchingStartOperation(intent, operation);
      }
      if (
        resubmitNonTerminal &&
        (operation.status === "starting" || operation.status === "uncertain")
      ) {
        const resumed = await this.resumeDurableStartIntent(intent);
        if (resumed === null) {
          const releasing = await this.markStartIntentForRelease(intent);
          await this.finishReleasePendingStartIntent(releasing);
          return "released";
        }
        operation = resumed;
        assertMatchingStartOperation(intent, operation);
      }
      if (operation.status === "starting" || operation.status === "uncertain") {
        return "pending";
      }
      if (operation.status === "succeeded") {
        const succeeded = await this.recordSucceededStartIntent(
          intent,
          operation.result,
        );
        await this.publishStartProjection(succeeded, operation.result);
        return "projected";
      }
      if (sealedMissingOperation) {
        const marked = await this.markMissingStartIntentForRelease(intent);
        if (!marked) return "pending";
        await this.finishReleasePendingStartIntent({
          ...intent,
          runnerStatus: "release_pending",
        });
        return "released";
      }

      const releasing = await this.markStartIntentForRelease(intent);
      await this.finishReleasePendingStartIntent(releasing);
      return "released";
    } finally {
      await this.redis
        .releaseConversationLock(initialIntent.conversationId, lock)
        .catch(() => undefined);
    }
  }

  private async resumeDurableStartIntent(
    intent: TurnStartIntent,
  ): Promise<RunnerStartOperation | null> {
    const [conversation, owner] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: intent.conversationId, ownerId: intent.ownerId },
        select: {
          codexThreadId: true,
          runtimeGeneration: true,
          applicationId: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: intent.ownerId },
        select: { status: true },
      }),
    ]);
    if (
      !conversation ||
      conversation.runtimeGeneration !== intent.runtimeGeneration ||
      owner?.status !== "active" ||
      (conversation.applicationId ?? null) !== intent.applicationId ||
      (intent.regenerationJson !== null &&
        conversation.codexThreadId !== intent.regenerationJson.codexThreadId)
    ) {
      return null;
    }

    if (intent.applicationId !== null) {
      if (!this.applicationResolver) return null;
      try {
        await this.applicationResolver.assertCurrentAccess(
          intent.ownerId,
          intent.applicationId,
        );
      } catch (error) {
        if (error instanceof AppError) return null;
        throw error;
      }
    }

    let recovery: Awaited<
      ReturnType<ConversationPreflight["resolveStartIntentRecovery"]>
    >;
    let modelRuntime: ResolvedModelRuntime;
    try {
      const resolved = await Promise.all([
        this.preflight.resolveStartIntentRecovery({
          userId: intent.ownerId,
          capabilities: intent.capabilitiesJson,
          mcpServers: intent.mcpServersJson,
          ...(intent.applicationId
            ? { applicationId: intent.applicationId }
            : {}),
        }),
        this.modelRuntimeForIntent(intent),
      ]);
      recovery = resolved[0];
      modelRuntime = resolved[1];
    } catch (error) {
      if (error instanceof AppError) return null;
      throw error;
    }

    const modelTransitionSource = await this.modelTransitionSourceForIntent(
      intent,
      modelRuntime.model,
      conversation.codexThreadId,
    );
    const executionConcurrency = await this.executionConcurrencyForStart();
    return this.runner.acceptStartTurn(
      buildRunnerStartInputFromIntent(
        intent,
        conversation.codexThreadId,
        intent.capabilitiesJson,
        recovery.environment ?? {},
        modelRuntime,
        modelTransitionSource,
        executionConcurrency,
      ),
    );
  }

  private trackAcceptedStartRecovery(projectionTurnId: string): void {
    if (this.acceptedStartRecoveries.has(projectionTurnId)) return;
    const recovery = this.recoverAcceptedStartUntilSettled(projectionTurnId);
    const tracked = recovery
      .catch(async () => {
        await this.audit
          .write({
            actorId: null,
            action: "codex_turn_projection_recovery_failed",
            targetType: "conversation_turn",
            targetId: projectionTurnId,
            result: "failed",
            metadata: { reason_code: "TURN_PROJECTION_UNAVAILABLE" },
          })
          .catch(() => undefined);
      })
      .finally(() => {
        if (this.acceptedStartRecoveries.get(projectionTurnId) === tracked) {
          this.acceptedStartRecoveries.delete(projectionTurnId);
        }
      });
    // Retaining the promise makes the background continuation observable and
    // deduplicated. The periodic recovery coordinator remains the durable
    // fallback if this API process exits or this bounded fast path times out.
    this.acceptedStartRecoveries.set(projectionTurnId, tracked);
  }

  private async recoverAcceptedStartUntilSettled(
    projectionTurnId: string,
  ): Promise<void> {
    const intent = await this.prisma.conversationTurnStartIntent.findUnique({
      where: { projectionTurnId },
      select: { conversationId: true },
    });
    if (!intent) return;
    const lockTtlMilliseconds =
      START_INTENT_RECOVERY_LOCK_TTL_MILLISECONDS;
    const token = await this.redis.acquireRecoveryLock(
      intent.conversationId,
      lockTtlMilliseconds,
    );
    if (!token) return;
    try {
      const deadline = Date.now() + ACCEPTED_START_RECOVERY_WINDOW_MILLISECONDS;
      let delayMilliseconds = ACCEPTED_START_RECOVERY_POLL_MILLISECONDS;
      let renewAt = Date.now() + Math.floor(lockTtlMilliseconds / 2);
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMilliseconds);
          timer.unref();
        });
        if (Date.now() >= renewAt) {
          const renewed = await this.redis.renewRecoveryLock(
            intent.conversationId,
            token,
            lockTtlMilliseconds,
          );
          if (!renewed) return;
          renewAt = Date.now() + Math.floor(lockTtlMilliseconds / 2);
        }
        // Observe the durable Runner operation only. Native turn submission is
        // never replayed by this fast projection path.
        const outcome = await this.recoverStartIntent(projectionTurnId, {
          resubmitNonTerminal: false,
        });
        if (outcome !== "pending") return;
        delayMilliseconds = Math.min(delayMilliseconds * 2, 1_000);
      }
    } finally {
      await this.redis
        .releaseRecoveryLock(intent.conversationId, token)
        .catch(() => undefined);
    }
  }

  async list(
    ownerId: string,
    input: {
      search?: string;
      archived?: boolean;
      cursor?: string;
      limit: number;
    },
  ) {
    const cursor = input.cursor ? parseConversationCursor(input.cursor) : null;
    if (input.cursor && !cursor) throw new AppError("VALIDATION_ERROR");
    const archiveStatus = input.archived ? "archived" : "active";
    const [rows, totalCount] = await Promise.all([
      input.search
        ? this.searchConversations(ownerId, {
            search: input.search,
            archiveStatus,
            cursor,
            limit: input.limit + 1,
          })
        : this.prisma.conversation.findMany({
            where: {
              ownerId,
              archiveStatus,
              ...(cursor
                ? {
                    OR: [
                      { updatedAt: { lt: cursor.updatedAt } },
                      { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                    ],
                  }
                : {}),
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: input.limit + 1,
          }),
      input.search || !input.archived
        ? Promise.resolve(undefined)
        : this.prisma.conversation.count({
            where: { ownerId, archiveStatus },
          }),
    ]);
    const selected = rows.slice(0, input.limit);
    const ids = selected.map((row) => row.id);
    const currentThreadIds = new Map(
      selected.flatMap((row) =>
        row.codexThreadId ? [[row.id, row.codexThreadId] as const] : [],
      ),
    );
    const [
      running,
      pending,
      automationTargets,
      applicationIcons,
      planOutputMissingConversationIds,
    ] = await Promise.all([
      this.prisma.conversationTurn.findMany({
        where: { conversationId: { in: ids }, status: "running" },
        select: { conversationId: true, codexThreadId: true },
      }),
      this.prisma.pendingRequest.findMany({
        where: { conversationId: { in: ids } },
        select: { conversationId: true },
        distinct: ["conversationId"],
      }),
      ids.length > 0
        ? this.prisma.automation.findMany({
            where: {
              ownerId,
              conversationId: { in: ids },
              deletedAt: null,
            },
            select: { conversationId: true },
            distinct: ["conversationId"],
          })
        : Promise.resolve([]),
      this.resolveApplicationDisplayIcons(ownerId, selected),
      this.findLatestPlanOutputMissingConversationIds(selected),
    ]);
    const runningIds = new Set(
      running
        .filter(
          (row) =>
            currentThreadIds.get(row.conversationId) === row.codexThreadId,
        )
        .map((row) => row.conversationId),
    );
    const pendingIds = new Set(pending.map((row) => row.conversationId));
    const automationTargetIds = new Set(
      automationTargets.map((row) => row.conversationId),
    );
    return {
      items: selected.map((row) =>
        projectConversation(
          row,
          runningIds.has(row.id)
            ? "running"
            : pendingIds.has(row.id)
              ? "pending"
              : planOutputMissingConversationIds.has(row.id)
                ? "failed"
                : (row.lastTurnStatus ?? "idle"),
          row.applicationId
            ? applicationIcons.get(row.applicationId)
            : undefined,
          automationTargetIds.has(row.id),
        ),
      ),
      next_cursor:
        rows.length > input.limit
          ? selected.at(-1)
            ? encodeConversationCursor(selected.at(-1)!)
            : null
          : null,
      ...(totalCount === undefined ? {} : { total_count: totalCount }),
    };
  }

  private async resolveApplicationDisplayIcons(
    ownerId: string,
    conversations: readonly ConversationProjection[],
  ): Promise<ReadonlyMap<string, ApplicationIcon>> {
    const applicationIds = [
      ...new Set(
        conversations.flatMap((conversation) =>
          conversation.applicationId ? [conversation.applicationId] : [],
        ),
      ),
    ];
    if (
      applicationIds.length === 0 ||
      this.applicationResolver?.resolveDisplayIcons === undefined
    ) {
      return new Map();
    }
    try {
      return await this.applicationResolver.resolveDisplayIcons(
        ownerId,
        applicationIds,
      );
    } catch {
      // Icons are optional presentation metadata and must never make the task
      // list unavailable when storage or application metadata is degraded.
      return new Map();
    }
  }

  private async findLatestPlanOutputMissingConversationIds(
    conversations: readonly Pick<
      ConversationProjection,
      "id" | "codexThreadId"
    >[],
  ): Promise<ReadonlySet<string>> {
    const activeBranches = conversations.flatMap((conversation) =>
      conversation.codexThreadId
        ? [
            {
              conversationId: conversation.id,
              codexThreadId: conversation.codexThreadId,
            },
          ]
        : [],
    );
    if (activeBranches.length === 0) return new Set();

    const latestTurns = await this.prisma.conversationTurn.findMany({
      where: { OR: activeBranches },
      orderBy: [{ conversationId: "asc" }, { sequenceNo: "desc" }],
      distinct: ["conversationId"],
      select: { id: true, conversationId: true },
    });
    if (latestTurns.length === 0) return new Set();

    const missingEvents = await this.prisma.conversationEvent.findMany({
      where: {
        turnId: { in: latestTurns.map((turn) => turn.id) },
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          path: ["error_code"],
          equals: PLAN_OUTPUT_MISSING_ERROR_CODE,
        },
      },
      select: { turnId: true },
    });
    const missingTurnIds = new Set(
      missingEvents.flatMap((event) =>
        event.turnId ? [event.turnId] : [],
      ),
    );
    if (missingTurnIds.size === 0) return new Set();
    const projectedPlanReviews = await this.prisma.conversationPlanReview.findMany(
      {
        where: { sourceTurnId: { in: [...missingTurnIds] } },
        select: { sourceTurnId: true },
      },
    );
    const reviewedTurnIds = new Set(
      projectedPlanReviews.map((review) => review.sourceTurnId),
    );
    return new Set(
      latestTurns.flatMap((turn) =>
        missingTurnIds.has(turn.id) && !reviewedTurnIds.has(turn.id)
          ? [turn.conversationId]
          : [],
      ),
    );
  }

  private async searchConversations(
    ownerId: string,
    input: {
      search: string;
      archiveStatus: string;
      cursor: ConversationCursor | null;
      limit: number;
    },
  ) {
    const cursorFilter = input.cursor
      ? Prisma.sql`AND (
          c.updated_at < ${input.cursor.updatedAt}
          OR (c.updated_at = ${input.cursor.updatedAt} AND c.id < CAST(${input.cursor.id} AS uuid))
        )`
      : Prisma.empty;
    const matching = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`
      SELECT c.id
      FROM conversations AS c
      WHERE c.owner_id = CAST(${ownerId} AS uuid)
        AND c.archive_status = ${input.archiveStatus}
        ${cursorFilter}
        AND (
          (
            NOT (
              c.title_source = 'fallback'
              AND (
                c.title LIKE '[LinkSense presentation annotation]%'
                OR (
                  c.title LIKE '用户要求：%'
                  AND (
                    strpos(c.title, '请基于演示文稿') > 0
                    OR strpos(c.title, '元素定位：') > 0
                  )
                )
                OR (
                  c.title LIKE 'User request:%'
                  AND (
                    strpos(c.title, 'Complete that request') > 0
                    OR strpos(c.title, 'Element locator:') > 0
                  )
                )
              )
            )
            AND strpos(lower(c.title), lower(${input.search})) > 0
          )
          OR EXISTS (
            SELECT 1 FROM conversation_messages AS message
            JOIN conversation_turns AS message_turn
              ON message_turn.id = message.turn_id
            WHERE message.conversation_id = c.id
              AND message_turn.conversation_id = c.id
              AND message_turn.codex_thread_id = c.codex_thread_id
              AND message.content_text NOT LIKE '[LinkSense presentation annotation]%'
              AND NOT (
                message.content_text LIKE '用户要求：%'
                AND strpos(message.content_text, '元素定位：') > 0
              )
              AND NOT (
                message.content_text LIKE 'User request:%'
                AND strpos(message.content_text, 'Element locator:') > 0
              )
              AND NOT (
                message.role = 'user'
                AND message.sequence_no = (
                  SELECT min(first_user_message.sequence_no)
                  FROM conversation_messages AS first_user_message
                  WHERE first_user_message.conversation_id = c.id
                    AND first_user_message.turn_id = message.turn_id
                    AND first_user_message.role = 'user'
                )
                AND EXISTS (
                  SELECT 1 FROM conversation_events AS display_event
                  WHERE display_event.conversation_id = c.id
                    AND display_event.turn_id = message.turn_id
                    AND display_event.event_type = ${USER_MESSAGE_DISPLAY_EVENT_TYPE}
                    AND display_event.visibility = 'internal_sanitized'
                )
              )
              AND strpos(lower(message.content_text), lower(${input.search})) > 0
          )
          OR EXISTS (
            SELECT 1 FROM conversation_files AS file
            WHERE file.conversation_id = c.id
              AND (
                file.turn_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM conversation_turns AS file_turn
                  WHERE file_turn.id = file.turn_id
                    AND file_turn.conversation_id = c.id
                    AND file_turn.codex_thread_id = c.codex_thread_id
                )
              )
              AND strpos(lower(file.filename), lower(${input.search})) > 0
          )
          OR EXISTS (
            SELECT 1 FROM conversation_turns AS turn
            WHERE turn.conversation_id = c.id
              AND turn.codex_thread_id = c.codex_thread_id
              AND (
                strpos(lower(coalesce(turn.error_code, '')), lower(${input.search})) > 0
                OR strpos(lower(coalesce(turn.error_message, '')), lower(${input.search})) > 0
              )
          )
          OR EXISTS (
            SELECT 1 FROM conversation_events AS event
            WHERE event.conversation_id = c.id
              AND (
                event.turn_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM conversation_turns AS event_turn
                  WHERE event_turn.id = event.turn_id
                    AND event_turn.conversation_id = c.id
                    AND event_turn.codex_thread_id = c.codex_thread_id
                )
              )
              AND event.event_type IN (
                'conversation.capability.attached',
                'conversation.capability.used',
                'conversation.system_capability.used',
                'conversation.error',
                'item/started',
                'item/completed',
                'error'
              )
              AND (
                strpos(lower(coalesce(event.payload_json ->> 'name', '')), lower(${input.search})) > 0
                OR strpos(lower(coalesce(event.payload_json ->> 'capability_name', '')), lower(${input.search})) > 0
                OR strpos(lower(coalesce(event.payload_json ->> 'error_code', '')), lower(${input.search})) > 0
                OR strpos(lower(coalesce(event.payload_json ->> 'error_type', '')), lower(${input.search})) > 0
                OR strpos(lower(coalesce(event.payload_json #>> '{params,item,server}', '')), lower(${input.search})) > 0
                OR strpos(lower(coalesce(event.payload_json #>> '{params,item,tool}', '')), lower(${input.search})) > 0
              )
          )
        )
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${input.limit}
    `);
    if (matching.length === 0) return [];
    const rows = await this.prisma.conversation.findMany({
      where: { id: { in: matching.map((row) => row.id) } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return matching.flatMap((row) => {
      const conversation = byId.get(row.id);
      return conversation ? [conversation] : [];
    });
  }

  async get(ownerId: string, conversationId: string) {
    const conversation = await this.assertOwner(ownerId, conversationId);
    const turns = conversation.codexThreadId
      ? await this.prisma.conversationTurn.findMany({
          where: {
            conversationId,
            codexThreadId: conversation.codexThreadId,
          },
          orderBy: { sequenceNo: "asc" },
        })
      : [];
    const activeTurnIds = turns.map((turn) => turn.id);
    const visibleEventScope = {
      conversationId,
      OR: [{ turnId: null }, { turnId: { in: activeTurnIds } }],
      visibility: { in: ["user_visible", "user_collapsed"] },
    } satisfies Prisma.ConversationEventWhereInput;
    const [
      messages,
      pending,
      files,
      events,
      latestPlanEvents,
      turnFileChangeCounts,
      userMessageDisplayEvents,
      priorityCapabilityEvents,
      userInputRequests,
      planReviews,
      goal,
      latestModelContextUsage,
    ] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { conversationId, turnId: { in: activeTurnIds } },
        orderBy: { sequenceNo: "asc" },
      }),
      this.prisma.pendingRequest.findMany({
        where: { conversationId },
        orderBy: { queueNo: "asc" },
      }),
      this.prisma.conversationFile.findMany({
        where: {
          conversationId,
          OR: [{ turnId: null }, { turnId: { in: activeTurnIds } }],
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.conversationEvent.findMany({
        where: {
          ...visibleEventScope,
          eventType: {
            notIn: [...CONVERSATION_DETAIL_TRANSIENT_EVENT_TYPES],
          },
        },
        orderBy: { sequenceNo: "desc" },
        take: CONVERSATION_DETAIL_EVENT_LIMIT,
      }),
      this.findLatestPlanEvents(conversationId, activeTurnIds),
      this.countTurnFileChanges(conversationId, activeTurnIds),
      this.findUserMessageDisplayEvents(conversationId, activeTurnIds),
      this.findPriorityCapabilityEvents(conversationId, activeTurnIds),
      this.prisma.conversationUserInputRequest.findMany({
        where: { conversationId, turnId: { in: activeTurnIds } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.conversationPlanReview.findMany({
        where: { conversationId, sourceTurnId: { in: activeTurnIds } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.conversationGoal.findFirst({
        where: { conversationId, ownerId },
      }),
      this.prisma.codexThreadTokenUsageCursor.findFirst({
        where: { conversationId, ownerId },
        orderBy: { lastObservedAt: "desc" },
        select: {
          lastTotalTokens: true,
          modelContextWindow: true,
          lastObservedAt: true,
        },
      }),
    ]);
    const planReviewTurnIds = new Set(
      planReviews.map((review) => review.sourceTurnId),
    );
    const stopHookEvents =
      planReviewTurnIds.size > 0
        ? await this.prisma.conversationEvent.findMany({
            where: {
              conversationId,
              turnId: { in: [...planReviewTurnIds] },
              eventType: "hook/completed",
            },
            select: { turnId: true, payloadJson: true },
          })
        : [];
    const supersededAssistantMessageIds =
      indexStopHookSupersededAssistantMessageIds(
        stopHookEvents,
        planReviewTurnIds,
      );
    const visibleMessages = messages.filter(
      (message) => !supersededAssistantMessageIds.has(message.id),
    );
    const forkSource = await this.resolveForkSourceProjection(
      ownerId,
      conversation,
      visibleMessages,
    );
    const publicKnowledgeCitations = await this.loadPublicKnowledgeCitations(
      conversationId,
      activeTurnIds,
    );
    const steeredMessageEvents = await this.findSteeredMessageEvents(
      conversationId,
      activeTurnIds,
    );
    const steeredMessageMetadata = new Map<
      string,
      { usageType: "steer_current_turn"; eventSequenceNo: number }
    >();
    for (const event of steeredMessageEvents) {
      const payload = steeredMessageEventPayloadSchema.safeParse(
        event.payloadJson,
      );
      if (!payload.success) continue;
      steeredMessageMetadata.set(payload.data.message_id, {
        usageType: payload.data.usage_type,
        eventSequenceNo: Number(event.sequenceNo),
      });
    }
    const userMessageDisplays = indexUserMessageDisplays(
      userMessageDisplayEvents,
    );
    const priorityCapabilitiesByTurn = indexPriorityUserMessageCapabilities(
      priorityCapabilityEvents,
    );
    const detailEvents = mergeConversationDetailEvents(
      events.filter(
        (event) =>
          !isSupersededPlanOutputMissingEvent(event, planReviewTurnIds),
      ),
      latestPlanEvents,
    );
    // Event ingestion commits the native terminal notification and the local
    // turn transition atomically. Detail reads span several independent
    // projections, so a request crossing that commit can otherwise combine a
    // stale `running` turn row with a newer `turn/completed` cursor. Ground the
    // lifecycle in the native event whenever it is present; this also prevents
    // returning a cursor that permanently skips the completion on re-entry.
    const terminalStatusByTurnId = indexNativeTerminalTurnStatuses(detailEvents);
    const projectedTurns = turns.map((turn) => {
      const terminal = terminalStatusByTurnId.get(turn.id);
      return terminal
        ? {
            ...turn,
            status: terminal.status,
            completedAt:
              terminal.status === "interrupted"
                ? turn.completedAt
                : (turn.completedAt ?? terminal.completedAt),
            interruptedAt:
              terminal.status === "interrupted"
                ? (turn.interruptedAt ?? terminal.completedAt)
                : turn.interruptedAt,
          }
        : turn;
    });
    const runningTurn = projectedTurns.find(
      (turn) => turn.status === "running",
    );
    const firstUserMessageIds = indexFirstUserMessageIds(visibleMessages);
    const knowledgeBaseIdsByTurn = new Map(
      projectedTurns.map((turn) => [
        turn.id,
        jsonStringArray(turn.knowledgeBaseIdsJson),
      ]),
    );
    const latestTurn = projectedTurns.at(-1);
    const planOutputMissing =
      latestTurn && !planReviewTurnIds.has(latestTurn.id)
      ? await this.hasPlanOutputMissingEvent(conversationId, latestTurn.id)
      : false;
    const executionStatus = runningTurn
      ? "running"
      : pending.length > 0
        ? "pending"
        : planOutputMissing
          ? "failed"
          : latestTurn &&
              (latestTurn.status === "completed" ||
                latestTurn.status === "failed" ||
                latestTurn.status === "interrupted")
            ? latestTurn.status
            : (conversation.lastTurnStatus ?? "idle");
    const runningResumeAnchor = runningTurn
      ? selectRunningResumeAnchor(detailEvents, runningTurn.id)
      : undefined;
    const terminalResumeCursor = runningTurn
      ? undefined
      : selectTerminalResumeCursor(
          conversationId,
          detailEvents,
          new Set(messages.map((message) => message.id)),
        );
    return {
      conversation: {
        ...projectConversation(conversation, executionStatus),
        ...(forkSource ? { fork_source: forkSource } : {}),
      },
      goal: goal ? projectConversationGoal(goal) : null,
      messages: visibleMessages.map((message) =>
        projectMessage(
          message,
          resolveUserMessageProjection(
            message,
            userMessageDisplays,
            files,
            firstUserMessageIds.has(message.id),
            priorityCapabilitiesByTurn,
          ),
          message.turnId
            ? (knowledgeBaseIdsByTurn.get(message.turnId) ?? [])
            : [],
          publicKnowledgeCitations.get(message.id) ?? [],
          steeredMessageMetadata.get(message.id),
        ),
      ),
      turns: projectedTurns.map(projectTurn),
      pending_requests: pending.map(projectPending),
      user_input_requests: userInputRequests.map(projectUserInputRequest),
      plan_reviews: planReviews.map(projectPlanReview),
      files: files.map(projectFile),
      events: detailEvents.map(projectStoredEvent),
      model_context_usage: projectModelContextUsage(latestModelContextUsage),
      ...(runningTurn
        ? {
            // Detail snapshots intentionally omit high-frequency stream
            // deltas. Re-entering a running task resumes from an open
            // agentMessage start when present so the active item is rebuilt
            // from its first text delta instead of from a later durable event.
            last_event_id:
              runningResumeAnchor?.sseEventId ?? `${conversationId}:0`,
          }
        : terminalResumeCursor
          ? { last_event_id: terminalResumeCursor }
          : {}),
      turn_file_change_counts: turnFileChangeCounts,
      activities: detailEvents
        .map(projectActivity)
        .filter((value) => value !== null),
    };
  }

  private async resolveForkSourceProjection(
    ownerId: string,
    conversation: {
      createdAt: Date;
      forkSourceConversationId: string | null;
      forkSourceMessageId: string | null;
    },
    messages: readonly { sequenceNo: number; createdAt: Date }[],
  ): Promise<
    | {
        available: true;
        conversation_id: string;
        message_id: string;
        title: string;
        boundary_sequence_no: number;
      }
    | {
        available: false;
        boundary_sequence_no: number;
      }
    | null
  > {
    const sourceConversationId = conversation.forkSourceConversationId;
    const sourceMessageId = conversation.forkSourceMessageId;
    if (!sourceConversationId || !sourceMessageId) return null;

    // Copied messages keep their original timestamps and sequence numbers,
    // while the child conversation is created at the fork boundary. This
    // fallback keeps the marker renderable if the direct source was deleted.
    const fallbackBoundarySequenceNo = messages
      .filter((message) => message.createdAt <= conversation.createdAt)
      .at(-1)?.sequenceNo;
    const sourceConversation = await this.prisma.conversation.findFirst({
      where: { id: sourceConversationId, ownerId },
      select: { id: true, title: true, titleSource: true },
    });
    if (!sourceConversation) {
      return fallbackBoundarySequenceNo === undefined
        ? null
        : {
            available: false,
            boundary_sequence_no: fallbackBoundarySequenceNo,
          };
    }

    const sourceMessage = await this.prisma.conversationMessage.findFirst({
      where: {
        id: sourceMessageId,
        conversationId: sourceConversationId,
      },
      select: { id: true, sequenceNo: true },
    });
    const boundarySequenceNo = sourceMessage
      ? messages.some(
          (message) => message.sequenceNo === sourceMessage.sequenceNo,
        )
        ? sourceMessage.sequenceNo
        : fallbackBoundarySequenceNo
      : fallbackBoundarySequenceNo;
    if (boundarySequenceNo === undefined) return null;
    if (!sourceMessage) {
      return {
        available: false,
        boundary_sequence_no: boundarySequenceNo,
      };
    }
    return {
      available: true,
      conversation_id: sourceConversationId,
      message_id: sourceMessage.id,
      title: projectTaskTitle(
        sourceConversation.title,
        sourceConversation.titleSource,
      ),
      boundary_sequence_no: boundarySequenceNo,
    };
  }

  private async hasPlanOutputMissingEvent(
    conversationId: string,
    turnId: string,
  ): Promise<boolean> {
    const event = await this.prisma.conversationEvent.findFirst({
      where: {
        conversationId,
        turnId,
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          path: ["error_code"],
          equals: PLAN_OUTPUT_MISSING_ERROR_CODE,
        },
      },
      select: { id: true },
    });
    return event !== null;
  }

  private async loadPublicKnowledgeCitations(
    conversationId: string,
    activeTurnIds: string[],
  ): Promise<Map<string, PublicKnowledgeCitation[]>> {
    if (activeTurnIds.length === 0) return new Map();
    const citations =
      await this.prisma.conversationMessageKnowledgeCitation.findMany({
        where: {
          conversationId,
          turnId: { in: activeTurnIds },
        },
        orderBy: [{ messageId: "asc" }, { citationNo: "asc" }],
      });
    if (citations.length === 0) return new Map();

    const citationIds = citations.map((citation) => citation.id);
    const anchors =
      await this.prisma.conversationMessageKnowledgeCitationAnchor.findMany({
        where: { citationId: { in: citationIds } },
        orderBy: { occurrenceNo: "asc" },
      });
    const anchorsByCitationId = new Map<
      string,
      Array<{ occurrence_no: number; after_offset_utf16: number }>
    >();
    for (const anchor of anchors) {
      const existing = anchorsByCitationId.get(anchor.citationId) ?? [];
      existing.push({
        occurrence_no: anchor.occurrenceNo,
        after_offset_utf16: anchor.anchorAfterOffsetUtf16,
      });
      anchorsByCitationId.set(anchor.citationId, existing);
    }

    const byMessageId = new Map<string, PublicKnowledgeCitation[]>();
    for (const citation of citations) {
      const citationAnchors = anchorsByCitationId.get(citation.id) ?? [];
      if (
        citation.knowledgeBaseNameSnapshot.trim().length === 0 ||
        citation.documentNameSnapshot.trim().length === 0 ||
        citationAnchors.length === 0
      ) {
        continue;
      }
      const item: PublicKnowledgeCitation = {
        citation_id: citation.id,
        citation_no: citation.citationNo,
        anchors: citationAnchors,
        summary: {
          knowledge_base_name: citation.knowledgeBaseNameSnapshot,
          document_name: citation.documentNameSnapshot,
          title_path: citation.titlePath,
          page_numbers: citation.pageNumbers,
        },
      };
      const items = byMessageId.get(citation.messageId) ?? [];
      items.push(item);
      byMessageId.set(citation.messageId, items);
    }
    return byMessageId;
  }

  private async findUserMessageDisplayEvents(
    conversationId: string,
    activeTurnIds: string[],
  ) {
    if (activeTurnIds.length === 0) return [];
    return this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        turnId: { in: activeTurnIds },
        eventType: USER_MESSAGE_DISPLAY_EVENT_TYPE,
        visibility: "internal_sanitized",
      },
      orderBy: { sequenceNo: "asc" },
      select: { turnId: true, payloadJson: true },
    });
  }

  private async findSteeredMessageEvents(
    conversationId: string,
    activeTurnIds: string[],
  ) {
    if (activeTurnIds.length === 0) return [];
    return this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        turnId: { in: activeTurnIds },
        eventType: "conversation.message.completed",
        visibility: "user_visible",
      },
      orderBy: { sequenceNo: "asc" },
      select: { sequenceNo: true, payloadJson: true },
    });
  }

  private async findPriorityCapabilityEvents(
    conversationId: string,
    activeTurnIds: string[],
  ) {
    if (activeTurnIds.length === 0) return [];
    return this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        turnId: { in: activeTurnIds },
        eventType: "conversation.capability.attached",
        visibility: { in: ["user_visible", "user_collapsed"] },
      },
      orderBy: { sequenceNo: "asc" },
    });
  }

  /**
   * The bounded detail window may evict an older turn's latest plan from a
   * long-running conversation. Keep this query narrowly scoped to the latest
   * sanitized plan event for every turn on the active branch.
   */
  private async findLatestPlanEvents(
    conversationId: string,
    activeTurnIds: string[],
  ): Promise<ConversationDetailEventRow[]> {
    if (activeTurnIds.length === 0) return [];

    const activeTurnIdSql = Prisma.join(
      activeTurnIds.map((turnId) => Prisma.sql`CAST(${turnId} AS uuid)`),
    );
    const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT
        latest.id,
        latest.conversation_id AS "conversationId",
        latest.turn_id AS "turnId",
        latest.sequence_no AS "sequenceNo",
        latest.event_type AS "eventType",
        latest.visibility,
        latest.payload_json AS "payloadJson",
        latest.sse_event_id AS "sseEventId",
        latest.created_at AS "createdAt"
      FROM (
        SELECT DISTINCT ON (event.turn_id) event.*
        FROM conversation_events AS event
        WHERE event.conversation_id = CAST(${conversationId} AS uuid)
          AND event.turn_id IN (${activeTurnIdSql})
          AND event.visibility IN ('user_visible', 'user_collapsed')
          AND event.event_type = 'turn/plan/updated'
        ORDER BY event.turn_id ASC, event.sequence_no DESC, event.id DESC
      ) AS latest
      ORDER BY latest.sequence_no ASC, latest.id ASC
    `);
    const activeTurnIdSet = new Set(activeTurnIds);
    const parsedRows = z
      .array(
        rawPlanEventRowSchema.refine(
          (row) =>
            row.conversationId === conversationId &&
            activeTurnIdSet.has(row.turnId),
          "plan event is outside the active conversation branch",
        ),
      )
      .parse(rows);
    for (const row of parsedRows) projectStoredEvent(row);
    return parsedRows;
  }

  private async countTurnFileChanges(
    conversationId: string,
    activeTurnIds: string[],
  ): Promise<Record<string, number>> {
    if (activeTurnIds.length === 0) return {};

    const activeTurnIdSql = Prisma.join(
      activeTurnIds.map((turnId) => Prisma.sql`CAST(${turnId} AS uuid)`),
    );
    const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
      WITH ranked_file_changes AS (
        SELECT
          event.turn_id,
          event.payload_json #>> '{params,item,id}' AS item_id,
          event.payload_json #> '{params,item,changes}' AS changes,
          row_number() OVER (
            PARTITION BY
              event.turn_id,
              event.payload_json #>> '{params,item,id}'
            ORDER BY event.sequence_no DESC, event.id DESC
          ) AS lifecycle_rank
        FROM conversation_events AS event
        WHERE event.conversation_id = CAST(${conversationId} AS uuid)
          AND event.turn_id IN (${activeTurnIdSql})
          AND event.visibility IN ('user_visible', 'user_collapsed')
          AND event.event_type IN ('item/started', 'item/completed')
          AND event.payload_json ->> 'source' = 'codex_app_server'
          AND event.payload_json ->> 'method' = event.event_type
          AND event.payload_json #>> '{params,item,type}' = 'fileChange'
          AND coalesce(event.payload_json #>> '{params,item,id}', '') <> ''
          AND jsonb_typeof(
            event.payload_json #> '{params,item,changes}'
          ) = 'array'
      ), latest_file_changes AS (
        SELECT turn_id, changes
        FROM ranked_file_changes
        WHERE lifecycle_rank = 1
      ), safe_paths AS (
        SELECT
          latest.turn_id,
          change ->> 'path' AS path
        FROM latest_file_changes AS latest
        CROSS JOIN LATERAL jsonb_array_elements(latest.changes) AS change
        WHERE jsonb_typeof(change) = 'object'
          AND jsonb_typeof(change -> 'path') = 'string'
      )
      SELECT
        turn_id AS "turnId",
        count(DISTINCT path) AS "fileCount"
      FROM safe_paths
      WHERE path <> ''
      GROUP BY turn_id
      ORDER BY turn_id ASC
    `);
    const activeTurnIdSet = new Set(activeTurnIds);
    const parsedRows = z
      .array(
        rawFileChangeCountRowSchema.refine(
          (row) => activeTurnIdSet.has(row.turnId),
          "file-change count is outside the active conversation branch",
        ),
      )
      .parse(rows);
    const counts = Object.fromEntries(
      activeTurnIds.map((turnId) => [turnId, 0]),
    );
    for (const row of parsedRows) counts[row.turnId] = Number(row.fileCount);
    return counts;
  }

  async create(
    ownerId: string,
    input: {
      collaborationMode: ConversationCollaborationMode;
      fallbackLocale?: Locale;
      prewarmedConversationId?: string;
    },
  ) {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const conversation = await this.createConversation(
        ownerId,
        input.fallbackLocale,
        undefined,
        { collaborationMode: input.collaborationMode },
        input.prewarmedConversationId,
      );
      return projectConversation(
        conversation,
        conversation.lastTurnStatus ?? "idle",
      );
    });
  }

  async patch(
    ownerId: string,
    conversationId: string,
    input: {
      title?: string;
      archiveStatus?: "active" | "archived";
      pinned?: boolean;
      completionRead?: true;
      collaborationMode?: ConversationCollaborationMode;
    },
  ) {
    const ownedConversation = await this.assertOwner(ownerId, conversationId);
    if (input.title && ownedConversation.applicationId !== null) {
      throw new AppError("APPLICATION_CONVERSATION_RENAME_UNSUPPORTED");
    }
    const now = new Date();
    const conversation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM conversations
        WHERE id = ${conversationId}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE
      `;
      const lockedConversation = await tx.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!lockedConversation || lockedConversation.ownerId !== ownerId) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      if (
        input.collaborationMode &&
        input.collaborationMode !== lockedConversation.collaborationMode
      ) {
        const [
          runningTurns,
          activeIntent,
          pendingRequests,
          activeGoal,
          activePlanReview,
        ] =
          await Promise.all([
            tx.conversationTurn.count({
              where: { conversationId, status: "running" },
            }),
            tx.conversationTurnStartIntent.count({ where: { conversationId } }),
            tx.pendingRequest.count({ where: { conversationId } }),
            tx.conversationGoal.findUnique({ where: { conversationId } }),
            tx.conversationPlanReview.count({
              where: {
                conversationId,
                status: { in: ["preparing", "pending"] },
              },
            }),
          ]);
        if (
          runningTurns > 0 ||
          activeIntent > 0 ||
          pendingRequests > 0 ||
          activePlanReview > 0 ||
          (activeGoal !== null && activeGoal.status !== "complete")
        ) {
          throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
        }
        if (input.collaborationMode === "plan") {
          const automationCount = await tx.automation.count({
            where: { conversationId, deletedAt: null },
          });
          if (automationCount > 0) {
            throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
          }
        }
      }
      if (input.pinned === false || input.archiveStatus === "archived") {
        const automationCount = await tx.automation.count({
          where: { conversationId, deletedAt: null },
        });
        if (automationCount > 0) throw new AppError("AUTOMATION_TASK_IN_USE");
      }
      if (input.completionRead) {
        await tx.automationRun.updateMany({
          where: {
            ownerId,
            conversationId,
            completedAt: { not: null },
            completionReadAt: null,
          },
          data: { completionReadAt: now },
        });
      }
      return tx.conversation.update({
        where: { id: conversationId },
        data: {
          ...(input.title ? { title: input.title, titleSource: "manual" } : {}),
          ...(input.archiveStatus
            ? {
                archiveStatus: input.archiveStatus,
                archivedAt: input.archiveStatus === "archived" ? now : null,
                sortOrder: null,
                ...(input.archiveStatus === "archived"
                  ? { pinnedAt: null }
                  : {}),
              }
            : {}),
          ...(input.pinned !== undefined && input.archiveStatus !== "archived"
            ? { pinnedAt: input.pinned ? now : null, sortOrder: null }
            : {}),
          ...(input.completionRead ? { completionUnread: false } : {}),
          ...(input.collaborationMode
            ? { collaborationMode: input.collaborationMode }
            : {}),
        },
      });
    });
    return projectConversation(
      conversation,
      conversation.lastTurnStatus ?? "idle",
    );
  }

  async reorder(
    ownerId: string,
    input: {
      group: ConversationOrderGroup;
      conversationIds: readonly string[];
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM conversations
        WHERE owner_id = ${ownerId}::uuid
          AND archive_status = 'active'
          AND ${
            input.group === "pinned"
              ? Prisma.sql`pinned_at IS NOT NULL`
              : Prisma.sql`pinned_at IS NULL`
          }
        FOR UPDATE
      `);
      const currentIds = new Set(rows.map((row) => row.id));
      if (
        currentIds.size !== input.conversationIds.length ||
        input.conversationIds.some((id) => !currentIds.has(id))
      ) {
        throw new AppError("CONVERSATION_ORDER_CONFLICT");
      }

      const orderedRows = input.conversationIds.map((id, sortOrder) =>
        Prisma.sql`(${id}::uuid, ${sortOrder}::integer)`,
      );
      await tx.$executeRaw(Prisma.sql`
        UPDATE conversations AS conversation
        SET sort_order = ordered.sort_order
        FROM (VALUES ${Prisma.join(orderedRows)}) AS ordered(id, sort_order)
        WHERE conversation.id = ordered.id
      `);
      return {
        group: input.group,
        conversation_ids: [...input.conversationIds],
      };
    });
  }

  async delete(ownerId: string, conversationId: string, context: AuditContext) {
    await this.assertOwner(ownerId, conversationId);
    const deleted = await this.deleteOwnedConversation(
      ownerId,
      conversationId,
      context,
    );
    if (!deleted) throw new AppError("CONVERSATION_NOT_FOUND");
  }

  async clearArchived(ownerId: string, context: AuditContext) {
    const archivedConversations = await this.prisma.conversation.findMany({
      where: { ownerId, archiveStatus: "archived" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    let deletedCount = 0;
    for (const conversation of archivedConversations) {
      const deleted = await this.deleteOwnedConversation(
        ownerId,
        conversation.id,
        context,
        "archived",
      );
      if (deleted) deletedCount += 1;
    }
    return { deleted_count: deletedCount };
  }

  private async deleteOwnedConversation(
    ownerId: string,
    conversationId: string,
    context: AuditContext,
    expectedArchiveStatus?: "archived",
  ): Promise<boolean> {
    const lock = await this.redis.acquireConversationLock(
      conversationId,
      120_000,
    );
    if (!lock) throw new AppError("CONFLICT");
    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const lockedConversation = await tx.$queryRaw<
          Array<{ id: string; archiveStatus: string }>
        >`
        SELECT id, archive_status AS "archiveStatus"
        FROM conversations
        WHERE id = ${conversationId}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE
      `;
        const currentConversation = lockedConversation[0];
        if (!currentConversation) return false;
        if (
          expectedArchiveStatus &&
          currentConversation.archiveStatus !== expectedArchiveStatus
        ) {
          return false;
        }
        const automationCount = await tx.automation.count({
          where: { conversationId, deletedAt: null },
        });
        if (automationCount > 0) throw new AppError("AUTOMATION_TASK_IN_USE");
        await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM conversation_files
        WHERE conversation_id = ${conversationId}::uuid
        FOR UPDATE
      `;
        const running = await tx.conversationTurn.count({
          where: { conversationId, status: "running" },
        });
        if (running > 0) throw new AppError("CONFLICT");
        const unresolvedStart = await tx.conversationTurnStartIntent.count({
          where: { conversationId },
        });
        if (unresolvedStart > 0) throw new AppError("CONFLICT");
        const artifacts = await tx.conversationFile.findMany({
          where: {
            conversationId,
            kind: "artifact",
            minioObjectKey: { not: null },
          },
        });
        const deletedAt = new Date();
        const retainedArtifactIds: string[] = [];
        for (const artifact of artifacts) {
          if (!artifact.minioObjectKey) continue;
          const retained = await tx.retainedArtifact.create({
            data: {
              originalFileId: artifact.id,
              conversationId,
              ownerId,
              minioObjectKey: artifact.minioObjectKey,
              mimeType: artifact.mimeType,
              sizeBytes: artifact.sizeBytes,
              checksumSha256: artifact.checksumSha256,
              artifactCreatedAt: artifact.createdAt,
              conversationDeletedAt: deletedAt,
              createdAt: deletedAt,
            },
          });
          retainedArtifactIds.push(retained.id);
        }
        const fileSummary = await tx.conversationFile.aggregate({
          where: { conversationId },
          _count: { id: true },
          _sum: { sizeBytes: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: ownerId,
            action: "conversation_deleted",
            targetType: "conversation",
            targetId: conversationId,
            result: "success",
            metadataJson: {
              file_count: fileSummary._count.id,
              retained_artifact_count: retainedArtifactIds.length,
              retained_artifact_ids: retainedArtifactIds,
              total_size_bytes: Number(fileSummary._sum.sizeBytes ?? 0n),
            },
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          },
        });
        await tx.runtimeCleanupOutbox.upsert({
          where: { conversationId },
          create: {
            ownerId,
            conversationId,
            status: "pending",
            stage: "reconcile",
          },
          update: {
            status: "pending",
            stage: "reconcile",
            attemptCount: 0,
            nextAttemptAt: new Date(),
            lastAttemptAt: null,
            lastErrorCode: null,
            claimToken: null,
            leaseExpiresAt: null,
          },
        });
        await deleteConversationGraph(tx, conversationId);
        return true;
      });

      if (deleted) {
        await this.cleanup
          .enqueueRuntimeCleanup(ownerId, conversationId)
          .catch(() => undefined);
      }
      return deleted;
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }
  }

  async createPending(
    ownerId: string,
    conversationId: string,
    input: PendingTurnSubmission,
    context: AuditContext,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const conversation = await this.assertOwner(ownerId, conversationId);
      const collaborationMode = conversationCollaborationModeSchema.parse(
        conversation.collaborationMode,
      );
      if (
        input.collaborationMode !== undefined &&
        input.collaborationMode !== collaborationMode
      ) {
        throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
      }
      const applicationRuntime = await this.applicationRuntimeForConversation(
        ownerId,
        conversation.applicationId,
        conversation.interactiveApplicationPackageId,
      );
      const knowledgeBaseIds = applicationRuntime?.kind === "standard"
        ? applicationRuntime.knowledgeBaseIds
        : await this.validateKnowledgeBaseSelection(
            ownerId,
            input.knowledgeBaseIds,
          );
      return this.createPendingForActiveUser(
        ownerId,
        conversationId,
        {
          ...input,
          collaborationMode,
          priorityCapabilityIds:
            applicationRuntime?.capabilityIds ?? input.priorityCapabilityIds,
          knowledgeBaseIds,
        },
        context,
      );
    });
  }

  private async createPendingForActiveUser(
    ownerId: string,
    conversationId: string,
    input: PendingTurnSubmission,
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    const officeAnnotation = submissionOfficeAnnotation(input);
    const preparedAnnotation = officeAnnotation
      ? await this.prepareOfficeAnnotation(conversationId, officeAnnotation)
      : null;
    const inputText = preparedAnnotation
      ? preparedAnnotation.inputText
      : "inputText" in input
        ? input.inputText
        : "";
    const preservesStagedAttachments =
      Boolean(officeAnnotation) || input.preserveStagedAttachments === true;
    const lock = await this.acquireConversationLock(conversationId);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE
      `;
        const running = await tx.conversationTurn.findFirst({
          where: { conversationId, status: "running" },
        });
        const startIntentRow = running
          ? null
          : await tx.conversationTurnStartIntent.findUnique({
              where: { conversationId },
            });
        const startIntent = startIntentRow
          ? parseTurnStartIntent(startIntentRow)
          : null;
        const activeTurnId =
          running?.id ??
          (startIntent && startIntent.runnerStatus !== "release_pending"
            ? startIntent.projectionTurnId
            : null);
        if (!activeTurnId) throw new AppError("CONFLICT");
        const pendingPlanReview = await tx.conversationPlanReview.findFirst({
          where: { conversationId, status: "pending" },
          select: { id: true },
        });
        if (pendingPlanReview) throw new AppError("PLAN_REVIEW_PENDING");
        const existing = await tx.pendingRequest.findMany({
          where: { conversationId },
          orderBy: { queueNo: "asc" },
        });
        if (existing.length >= 5)
          throw new AppError("PENDING_REQUEST_LIMIT_REACHED");
        if (inputText.trim().length === 0) {
          const attachment = await tx.conversationFile.findFirst({
            where: {
              conversationId,
              pendingRequestId: null,
              turnId: null,
              kind: "attachment",
              status: "staged",
            },
            select: { id: true },
          });
          if (!attachment) throw new AppError("VALIDATION_ERROR");
        }
        const nextQueueNo = (existing.at(-1)?.queueNo ?? 0n) + 1n;
        const pending = await tx.pendingRequest.create({
          data: {
            conversationId,
            queueNo: nextQueueNo,
            submittedBy: ownerId,
            inputText,
            priorityCapabilityIdsJson: input.priorityCapabilityIds,
            knowledgeBaseIdsJson: input.knowledgeBaseIds ?? [],
            collaborationMode: input.collaborationMode ?? "default",
            status: "waiting_previous_turn",
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });
        if (!preservesStagedAttachments) {
          await tx.conversationFile.updateMany({
            where: {
              conversationId,
              pendingRequestId: null,
              turnId: null,
              status: "staged",
            },
            data: {
              pendingRequestId: pending.id,
              status: "pending",
            },
          });
        }
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            selectedKnowledgeBaseIdsJson: input.knowledgeBaseIds ?? [],
          },
        });
        const sequenceNo = await nextConversationEventSequence(
          tx,
          conversationId,
        );
        const event = await tx.conversationEvent.create({
          data: {
            conversationId,
            turnId: activeTurnId,
            sequenceNo,
            eventType: "conversation.pending_request.updated",
            visibility: "user_visible",
            payloadJson: {
              schema_version: 1,
              pending_request_id: pending.id,
              status: pending.status,
              block_code: null,
              queue_no: Number(pending.queueNo),
            },
            sseEventId: `${conversationId}:${sequenceNo}`,
          },
        });
        return { pending, event };
      });
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "conversation_pending_request_created",
        targetType: "pending_request",
        targetId: result.pending.id,
        result: "success",
        metadata: {
          conversation_id: conversationId,
          queue_no: Number(result.pending.queueNo),
        },
      });
      await this.redis
        .publishConversationEvent(
          conversationId,
          projectStoredEvent(result.event),
        )
        .catch(() => undefined);
      return projectPending(result.pending);
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }
  }

  async reorderPending(
    ownerId: string,
    conversationId: string,
    pendingIds: string[],
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    const lock = await this.acquireConversationLock(conversationId);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE
        `;
        const current = await tx.pendingRequest.findMany({
          where: { conversationId },
          orderBy: { queueNo: "asc" },
        });
        const currentIds = current.map((pending) => pending.id);
        const exactPendingSet =
          currentIds.length === pendingIds.length &&
          currentIds.every((id) => pendingIds.includes(id));
        if (!exactPendingSet) throw new AppError("CONFLICT");
        if (current.some((pending) => pending.status === "steering")) {
          throw new AppError("CONFLICT");
        }
        const unchanged = currentIds.every(
          (id, index) => id === pendingIds[index],
        );
        if (unchanged) return { items: current, event: null };

        const protectedByStartIntent =
          await tx.conversationTurnStartIntent.findFirst({
            where: {
              conversationId,
              pendingRequestId: { in: pendingIds },
            },
            select: { projectionTurnId: true },
          });
        if (protectedByStartIntent) throw new AppError("CONFLICT");

        for (const [index, pendingId] of pendingIds.entries()) {
          await tx.pendingRequest.update({
            where: { id: pendingId },
            data: { queueNo: BigInt(-(index + 1)) },
          });
        }
        for (const [index, pendingId] of pendingIds.entries()) {
          await tx.pendingRequest.update({
            where: { id: pendingId },
            data: { queueNo: BigInt(index + 1) },
          });
        }

        const currentById = new Map(
          current.map((pending) => [pending.id, pending]),
        );
        const items = pendingIds.map((pendingId, index) => ({
          ...currentById.get(pendingId)!,
          queueNo: BigInt(index + 1),
        }));
        const changed = items.find(
          (pending, index) => currentIds[index] !== pending.id,
        )!;
        const sequenceNo = await nextConversationEventSequence(
          tx,
          conversationId,
        );
        const event = await tx.conversationEvent.create({
          data: {
            conversationId,
            sequenceNo,
            eventType: "conversation.pending_request.updated",
            visibility: "user_visible",
            payloadJson: {
              schema_version: 1,
              pending_request_id: changed.id,
              status: changed.status,
              block_code: changed.blockCode,
              queue_no: Number(changed.queueNo),
            },
            sseEventId: `${conversationId}:${sequenceNo}`,
          },
        });
        return { items, event };
      });

      if (!result.event) return { items: result.items.map(projectPending) };
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "conversation_pending_requests_reordered",
        targetType: "conversation",
        targetId: conversationId,
        result: "success",
        metadata: {
          conversation_id: conversationId,
          pending_request_ids: pendingIds.join(","),
        },
      });
      await this.redis
        .publishConversationEvent(
          conversationId,
          projectStoredEvent(result.event),
        )
        .catch(() => undefined);
      return { items: result.items.map(projectPending) };
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }
  }

  async cancelPending(
    ownerId: string,
    conversationId: string,
    pendingId: string,
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    const lock = await this.acquireConversationLock(conversationId);
    let wasHead: boolean;
    let nextPendingId: string | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE
        `;
        const list = await tx.pendingRequest.findMany({
          where: { conversationId },
          orderBy: { queueNo: "asc" },
        });
        const pending = list.find((item) => item.id === pendingId);
        if (!pending) throw new AppError("NOT_FOUND");
        if (pending.status === "steering") throw new AppError("CONFLICT");
        const protectedByStartIntent =
          await tx.conversationTurnStartIntent.findFirst({
            where: {
              ownerId,
              conversationId,
              pendingRequestId: pendingId,
            },
            select: { projectionTurnId: true },
          });
        if (protectedByStartIntent) throw new AppError("CONFLICT");
        await tx.conversationFile.updateMany({
          where: { pendingRequestId: pendingId, status: "pending" },
          data: { pendingRequestId: null, status: "staged" },
        });
        await tx.pendingRequest.delete({ where: { id: pendingId } });
        const sequenceNo = await nextConversationEventSequence(
          tx,
          conversationId,
        );
        const event = await tx.conversationEvent.create({
          data: {
            conversationId,
            sequenceNo,
            eventType: "conversation.pending_request.cancelled",
            visibility: "user_visible",
            payloadJson: {
              schema_version: 1,
              pending_request_id: pendingId,
            },
            sseEventId: `${conversationId}:${sequenceNo}`,
          },
        });
        return { wasHead: list[0]?.id === pendingId, event };
      });
      wasHead = result.wasHead;
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "conversation_pending_request_cancelled",
        targetType: "pending_request",
        targetId: pendingId,
        result: "success",
        metadata: { conversation_id: conversationId },
      });
      await this.redis
        .publishConversationEvent(
          conversationId,
          projectStoredEvent(result.event),
        )
        .catch(() => undefined);
      const running = await this.prisma.conversationTurn.count({
        where: { conversationId, status: "running" },
      });
      if (result.wasHead && running === 0) {
        const next = await this.prisma.pendingRequest.findFirst({
          where: { conversationId },
          orderBy: { queueNo: "asc" },
        });
        nextPendingId = next?.id ?? null;
      }
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }
    if (nextPendingId) {
      await this.startPending(
        ownerId,
        conversationId,
        nextPendingId,
        context,
      ).catch(() => undefined);
    }
    return { was_head: wasHead };
  }

  async restorePendingToInput(
    ownerId: string,
    conversationId: string,
    pendingId: string,
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    const lock = await this.acquireConversationLock(conversationId);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE
        `;
        const pending = await tx.pendingRequest.findFirst({
          where: { id: pendingId, conversationId },
        });
        if (!pending) throw new AppError("NOT_FOUND");
        if (pending.status === "steering") throw new AppError("CONFLICT");
        const protectedByStartIntent =
          await tx.conversationTurnStartIntent.findFirst({
            where: {
              ownerId,
              conversationId,
              pendingRequestId: pendingId,
            },
            select: { projectionTurnId: true },
          });
        if (protectedByStartIntent) throw new AppError("CONFLICT");

        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            selectedKnowledgeBaseIdsJson: jsonStringArray(
              pending.knowledgeBaseIdsJson,
            ),
          },
        });

        await tx.conversationFile.updateMany({
          where: { pendingRequestId: pendingId, status: "pending" },
          data: { pendingRequestId: null, status: "staged" },
        });
        await tx.pendingRequest.delete({ where: { id: pendingId } });
        const sequenceNo = await nextConversationEventSequence(
          tx,
          conversationId,
        );
        const event = await tx.conversationEvent.create({
          data: {
            conversationId,
            sequenceNo,
            eventType: "conversation.pending_request.cancelled",
            visibility: "user_visible",
            payloadJson: {
              schema_version: 1,
              pending_request_id: pendingId,
            },
            sseEventId: `${conversationId}:${sequenceNo}`,
          },
        });
        return { pending, event };
      });
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "conversation_pending_request_restored_to_input",
        targetType: "pending_request",
        targetId: pendingId,
        result: "success",
        metadata: { conversation_id: conversationId },
      });
      await this.redis
        .publishConversationEvent(
          conversationId,
          projectStoredEvent(result.event),
        )
        .catch(() => undefined);
      return {
        pending_request_id: pendingId,
        input_text: result.pending.inputText,
        priority_capability_ids: jsonStringArray(
          result.pending.priorityCapabilityIdsJson,
        ),
        knowledge_base_ids: jsonStringArray(
          result.pending.knowledgeBaseIdsJson,
        ),
      };
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }
  }

  async startPending(
    ownerId: string,
    conversationId: string,
    pendingId: string,
    context: AuditContext,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, () =>
      this.startPendingForActiveUser(
        ownerId,
        conversationId,
        pendingId,
        context,
      ),
    );
  }

  private async startPendingForActiveUser(
    ownerId: string,
    conversationId: string,
    pendingId: string,
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    const lock = await this.acquireConversationLock(conversationId);
    let lockTransferred = false;
    try {
      const projectedTurnId = deterministicUuid(
        conversationId,
        `pending-start:${pendingId}`,
      );
      const projected = await this.prisma.conversationTurn.findUnique({
        where: { id: projectedTurnId },
      });
      if (projected?.conversationId === conversationId) {
        return projectTurn(projected);
      }
      const first = await this.prisma.pendingRequest.findFirst({
        where: { conversationId },
        orderBy: { queueNo: "asc" },
      });
      if (!first || first.id !== pendingId) {
        throw new AppError("PENDING_REQUEST_NOT_QUEUE_HEAD");
      }
      if (first.status === "steering") throw new AppError("CONFLICT");
      lockTransferred = true;
      return this.startTurnInternal(
        ownerId,
        conversationId,
        {
          inputText: first.inputText,
          collaborationMode: conversationCollaborationModeSchema.parse(
            first.collaborationMode,
          ),
          priorityCapabilityIds: jsonStringArray(
            first.priorityCapabilityIdsJson,
          ),
          knowledgeBaseIds: jsonStringArray(first.knowledgeBaseIdsJson),
          ...(first.idempotencyKey
            ? { idempotencyKey: first.idempotencyKey }
            : {}),
          submitMode: "next_turn",
        },
        context,
        first.id,
        lock,
      );
    } finally {
      if (!lockTransferred) {
        await this.redis
          .releaseConversationLock(conversationId, lock)
          .catch(() => undefined);
      }
    }
  }

  async startTurn(
    ownerId: string,
    conversationId: string,
    input: TurnSubmission,
    context: AuditContext,
  ): Promise<ReturnType<typeof projectTurn>> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const knowledgeBaseIds = await this.validateKnowledgeBaseSelection(
        ownerId,
        input.knowledgeBaseIds,
      );
      return this.startTurnInternal(
        ownerId,
        conversationId,
        { ...input, knowledgeBaseIds },
        context,
      );
    }) as Promise<ReturnType<typeof projectTurn>>;
  }

  async acceptTurn(
    ownerId: string,
    conversationId: string,
    input: TurnSubmission,
    context: AuditContext,
  ): Promise<TurnStartReceipt> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const knowledgeBaseIds = await this.validateKnowledgeBaseSelection(
        ownerId,
        input.knowledgeBaseIds,
      );
      return this.startTurnInternal(
        ownerId,
        conversationId,
        { ...input, knowledgeBaseIds },
        context,
        undefined,
        undefined,
        undefined,
        true,
      );
    }) as Promise<TurnStartReceipt>;
  }

  async acceptGoal(
    ownerId: string,
    conversationId: string,
    input: GoalStartInput,
    context: AuditContext,
  ): Promise<TurnStartReceipt> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const objective = input.objective.trim();
      if (objective.length === 0 || objective.length > 4_000) {
        throw new AppError("VALIDATION_ERROR");
      }
      const knowledgeBaseIds = await this.validateKnowledgeBaseSelection(
        ownerId,
        input.knowledgeBaseIds,
      );
      return this.startTurnInternal(
        ownerId,
        conversationId,
        {
          inputText: objective,
          priorityCapabilityIds: input.priorityCapabilityIds,
          knowledgeBaseIds,
          ...(input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
          submitMode: "normal",
          goal: {
            objective,
            ...(input.tokenBudget !== undefined
              ? { tokenBudget: input.tokenBudget }
              : {}),
          },
        },
        context,
        undefined,
        undefined,
        undefined,
        true,
      );
    }) as Promise<TurnStartReceipt>;
  }

  async acceptCompaction(
    ownerId: string,
    conversationId: string,
    idempotencyKey: string,
    context: AuditContext,
  ): Promise<TurnStartReceipt> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const normalizedKey = idempotencyKey.trim();
      if (normalizedKey.length === 0 || normalizedKey.length > 120) {
        throw new AppError("VALIDATION_ERROR");
      }

      const lock = await this.acquireConversationLock(conversationId);
      try {
        const projectionTurnId = deterministicUuid(
          conversationId,
          `compact-start:${normalizedKey}`,
        );
        const existingTurn = await this.prisma.conversationTurn.findUnique({
          where: { id: projectionTurnId },
        });
        if (existingTurn) {
          if (
            existingTurn.conversationId !== conversationId ||
            existingTurn.submittedBy !== ownerId ||
            existingTurn.taskKind !== "compact" ||
            existingTurn.idempotencyKey !== normalizedKey
          ) {
            throw new AppError("CONFLICT");
          }
          return startReceipt(existingTurn.id, "running");
        }

        const activeIntentRow =
          await this.prisma.conversationTurnStartIntent.findUnique({
            where: { conversationId },
          });
        if (activeIntentRow) {
          const activeIntent = parseTurnStartIntent(activeIntentRow);
          if (
            activeIntent.projectionTurnId !== projectionTurnId ||
            activeIntent.ownerId !== ownerId ||
            activeIntent.taskKind !== "compact" ||
            activeIntent.idempotencyKey !== normalizedKey
          ) {
            throw new AppError("CONVERSATION_COMPACTION_UNAVAILABLE");
          }
          if (
            activeIntent.runnerStatus === "runner_succeeded" &&
            activeIntent.codexThreadId &&
            activeIntent.codexTurnId
          ) {
            const projection = await this.publishStartProjection(
              activeIntent,
              await this.startedTurnForSucceededIntent(activeIntent),
            );
            return startReceipt(projection.created.id, "running");
          }
          if (activeIntent.runnerStatus === "prepared") {
            const operation = await this.runner.inspectStartOperation(
              conversationId,
              projectionTurnId,
              ownerId,
            );
            assertMatchingStartOperation(activeIntent, operation);
            if (
              operation?.status === "starting" ||
              operation?.status === "succeeded"
            ) {
              this.trackAcceptedStartRecovery(projectionTurnId);
              return startReceipt(projectionTurnId, "starting");
            }
          }
          throw new RunnerStartOperationUncertainError();
        }

        const source = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM conversations
            WHERE id = ${conversationId}::uuid
            FOR UPDATE
          `;
          const [
            conversation,
            latestTurn,
            runningCount,
            startIntent,
          ] = await Promise.all([
            tx.conversation.findUnique({ where: { id: conversationId } }),
            tx.conversationTurn.findFirst({
              where: { conversationId },
              orderBy: { sequenceNo: "desc" },
            }),
            tx.conversationTurn.count({
              where: { conversationId, status: "running" },
            }),
            tx.conversationTurnStartIntent.findUnique({
              where: { conversationId },
              select: { projectionTurnId: true },
            }),
          ]);
          if (
            !conversation ||
            conversation.ownerId !== ownerId ||
            conversation.archiveStatus !== "active" ||
            !conversation.codexThreadId
          ) {
            throw new AppError("CONVERSATION_NOT_FOUND");
          }
          if (
            !latestTurn ||
            !TERMINAL_TURN_STATUSES.includes(
              latestTurn.status as (typeof TERMINAL_TURN_STATUSES)[number],
            ) ||
            latestTurn.codexThreadId !== conversation.codexThreadId ||
            runningCount > 0 ||
            startIntent
          ) {
            throw new AppError("CONVERSATION_COMPACTION_UNAVAILABLE");
          }
          return { conversation, latestTurn };
        });

        await this.tokenLimits?.assertCanStartTask(ownerId);
        const persistedState = persistedTurnRecoveryStateSchema.parse({
          conversationId,
          capabilityGeneration: source.latestTurn.capabilityGeneration,
          capabilitiesJson: source.latestTurn.capabilitiesJson,
          mcpGeneration: source.latestTurn.mcpGeneration,
          mcpServersJson: source.latestTurn.mcpServersJson,
          model: source.latestTurn.model,
          reasoningEffort: source.latestTurn.reasoningEffort,
        });
        const [runtime, modelRuntime, applicationRuntime] = await Promise.all([
          this.runner.prepareRuntime(conversationId, ownerId),
          persistedState.model && persistedState.reasoningEffort
            ? this.modelRuntimeForSelection(
                ownerId,
                conversationId,
                persistedState.model,
                persistedState.reasoningEffort,
              )
            : this.modelRuntimeForUser(ownerId, conversationId),
          this.applicationRuntimeForConversation(
            ownerId,
            source.conversation.applicationId,
            source.conversation.interactiveApplicationPackageId,
          ),
        ]);
        const refreshed = await this.prisma.conversation.updateMany({
          where: {
            id: conversationId,
            ownerId,
            codexThreadId: source.conversation.codexThreadId,
          },
          data: {
            agentsTemplateVersion: runtime.agentsTemplateVersion,
            runtimeGeneration: runtime.runtimeGeneration,
          },
        });
        if (refreshed.count !== 1) {
          throw new AppError("CONVERSATION_COMPACTION_UNAVAILABLE");
        }

        const executionConcurrency = await this.executionConcurrencyForStart();
        let startIntent = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM conversations
            WHERE id = ${conversationId}::uuid
            FOR UPDATE
          `;
          const [
            conversation,
            latestTurn,
            runningCount,
            existingIntent,
          ] = await Promise.all([
            tx.conversation.findUnique({ where: { id: conversationId } }),
            tx.conversationTurn.findFirst({
              where: { conversationId },
              orderBy: { sequenceNo: "desc" },
            }),
            tx.conversationTurn.count({
              where: { conversationId, status: "running" },
            }),
            tx.conversationTurnStartIntent.findUnique({
              where: { conversationId },
              select: { projectionTurnId: true },
            }),
          ]);
          if (
            !conversation ||
            conversation.ownerId !== ownerId ||
            conversation.archiveStatus !== "active" ||
            conversation.codexThreadId !== source.conversation.codexThreadId ||
            conversation.applicationId !== source.conversation.applicationId ||
            conversation.runtimeGeneration !== runtime.runtimeGeneration ||
            latestTurn?.id !== source.latestTurn.id ||
            !TERMINAL_TURN_STATUSES.includes(
              latestTurn.status as (typeof TERMINAL_TURN_STATUSES)[number],
            ) ||
            latestTurn.codexThreadId !== conversation.codexThreadId ||
            runningCount > 0 ||
            existingIntent
          ) {
            throw new AppError("CONVERSATION_COMPACTION_UNAVAILABLE");
          }

          return parseTurnStartIntent(
            await tx.conversationTurnStartIntent.create({
              data: {
                projectionTurnId,
                ownerId,
                conversationId,
                runtimeGeneration: runtime.runtimeGeneration,
                capabilityGeneration: persistedState.capabilityGeneration,
                mcpGeneration: persistedState.mcpGeneration,
                model: modelRuntime.model,
                reasoningEffort: modelRuntime.reasoningEffort,
                applicationId: applicationRuntime?.applicationId ?? null,
                applicationUpdatedAt:
                  applicationRuntime?.applicationUpdatedAt ?? null,
                applicationInstructions: applicationRuntime?.instructions ?? null,
                inputText: "",
                taskKind: "compact",
                collaborationMode: conversationCollaborationModeSchema.parse(
                  latestTurn.collaborationMode,
                ),
                goalObjective: null,
                goalTokenBudget: null,
                priorityCapabilityIdsJson: [],
                knowledgeBaseIdsJson: [],
                capabilitiesJson: persistedState.capabilitiesJson,
                mcpServersJson: persistedState.mcpServersJson,
                credentialUsageReceiptsJson: [],
                mcpCredentialUsageReceiptsJson: [],
                attachmentsJson: [],
                messageDisplayJson: Prisma.DbNull,
                submitMode: "normal",
                idempotencyKey: normalizedKey,
                preservesStagedAttachments: true,
                pendingRequestId: null,
                planReviewId: null,
                planReviewAction: null,
                regenerationJson: Prisma.DbNull,
                auditIpAddress: context.ipAddress ?? null,
                auditUserAgent: context.userAgent ?? null,
                runnerStatus: "slot_pending",
              },
            }),
          );
        });

        const acquired = await this.redis.acquireTurnSlot(
          conversationId,
          projectionTurnId,
          ownerId,
          executionConcurrency.max_concurrent_conversations,
        );
        if (!acquired.capacityReady || !acquired.acquired) {
          await this.prisma.conversationTurnStartIntent.deleteMany({
            where: {
              projectionTurnId,
              ownerId,
              conversationId,
              runnerStatus: "slot_pending",
            },
          });
          throw new AppError(
            acquired.capacityReady
              ? "CONVERSATION_OVERLOADED"
              : "RUNNER_UNAVAILABLE",
          );
        }

        try {
          startIntent = await this.markStartIntentSlotAcquired(startIntent);
        } catch {
          throw new RunnerStartOperationUncertainError();
        }

        try {
          await this.runner.acceptStartTurn(
            buildRunnerStartInputFromIntent(
              startIntent,
              source.conversation.codexThreadId,
              persistedState.capabilitiesJson,
              {},
              modelRuntime,
              null,
              executionConcurrency,
            ),
          );
          this.trackAcceptedStartRecovery(projectionTurnId);
          return startReceipt(projectionTurnId, "starting");
        } catch (error) {
          if (!(error instanceof RunnerStartOperationUncertainError)) {
            try {
              const releasing =
                await this.markStartIntentForRelease(startIntent);
              await this.finishReleasePendingStartIntent(releasing);
            } catch {
              throw new RunnerStartOperationUncertainError();
            }
          }
          throw error;
        }
      } finally {
        await this.redis
          .releaseConversationLock(conversationId, lock)
          .catch(() => undefined);
      }
    });
  }

  async getGoal(
    ownerId: string,
    conversationId: string,
  ): Promise<ThreadGoal | null> {
    await this.assertOwner(ownerId, conversationId);
    const goal = await this.prisma.conversationGoal.findFirst({
      where: { conversationId, ownerId },
    });
    return goal ? projectConversationGoal(goal) : null;
  }

  async updateGoal(
    ownerId: string,
    conversationId: string,
    input: GoalUpdateInput,
    context: AuditContext,
  ): Promise<ThreadGoal> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const lock = await this.acquireConversationLock(conversationId);
      try {
        const goal = await this.requireConversationGoal(
          ownerId,
          conversationId,
        );
        const objective = input.objective?.trim();
        if (
          objective !== undefined &&
          (objective.length === 0 || objective.length > 4_000)
        ) {
          throw new AppError("VALIDATION_ERROR");
        }
        const runtime = await this.buildGoalRuntimeInput(
          ownerId,
          conversationId,
          goal,
        );
        const updated = await this.runner.setGoal({
          ...runtime,
          ...(objective !== undefined ? { objective } : {}),
          ...(input.tokenBudget !== undefined
            ? { tokenBudget: input.tokenBudget }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        });
        if (input.status !== undefined && updated.status !== input.status) {
          throw new AppError("CONFLICT");
        }
        const stored = await this.prisma.$transaction((tx) =>
          upsertConversationGoal(tx, {
            conversationId,
            ownerId,
            goal: updated,
          }),
        );
        await this.audit.write({
          ...context,
          actorId: ownerId,
          action:
            input.status === "paused"
              ? "conversation_goal_paused"
              : "conversation_goal_updated",
          targetType: "conversation_goal",
          targetId: conversationId,
          result: "success",
          metadata: { conversation_id: conversationId },
        });
        return projectConversationGoal(stored);
      } finally {
        await this.redis
          .releaseConversationLock(conversationId, lock)
          .catch(() => undefined);
      }
    }) as Promise<ThreadGoal>;
  }

  async resumeGoal(
    ownerId: string,
    conversationId: string,
    context: AuditContext,
  ): Promise<TurnStartReceipt> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const lock = await this.acquireConversationLock(conversationId);
      let lockTransferred = false;
      try {
        const conversation = await this.assertOwner(ownerId, conversationId);
        const goal = await this.requireConversationGoal(
          ownerId,
          conversationId,
        );
        const runningGoalTurn = await this.prisma.conversationTurn.findFirst({
          where: {
            conversationId,
            codexThreadId: goal.codexThreadId,
            taskKind: "goal",
            status: "running",
          },
          orderBy: { sequenceNo: "desc" },
        });
        if (goal.status === "active") {
          if (!runningGoalTurn) throw new AppError("CONFLICT");
          return startReceipt(runningGoalTurn.id, "running");
        }
        if (
          !["paused", "blocked", "usageLimited", "budgetLimited"].includes(
            goal.status,
          )
        ) {
          throw new AppError("CONFLICT");
        }
        if (runningGoalTurn) {
          const runtime = await this.buildGoalRuntimeInput(
            ownerId,
            conversationId,
            goal,
            runningGoalTurn.id,
          );
          const updated = await this.runner.setGoal({
            ...runtime,
            status: "active",
          });
          await this.prisma.$transaction((tx) =>
            upsertConversationGoal(tx, {
              conversationId,
              ownerId,
              goal: updated,
              activeTurnId: runningGoalTurn.id,
            }),
          );
          await this.audit.write({
            ...context,
            actorId: ownerId,
            action: "conversation_goal_resumed",
            targetType: "conversation_goal",
            targetId: conversationId,
            result: "success",
            metadata: { conversation_id: conversationId },
          });
          return startReceipt(runningGoalTurn.id, "running");
        }
        const priorityCapabilityIds: string[] = [];
        const knowledgeBaseIds = jsonStringArray(
          conversation.selectedKnowledgeBaseIdsJson,
        );
        lockTransferred = true;
        return this.startTurnInternal(
          ownerId,
          conversationId,
          {
            inputText: goal.objective,
            priorityCapabilityIds,
            knowledgeBaseIds,
            idempotencyKey: goalResumeIdempotencyKey({
              conversationId,
              codexThreadId: goal.codexThreadId,
              nativeUpdatedAt: goal.nativeUpdatedAt,
              objective: goal.objective,
              tokenBudget: goal.tokenBudget,
              priorityCapabilityIds,
              knowledgeBaseIds,
            }),
            submitMode: "normal",
            preserveStagedAttachments: true,
            goal: {
              objective: goal.objective,
              tokenBudget:
                goal.tokenBudget === null ? null : Number(goal.tokenBudget),
              resumeExisting: true,
            },
          },
          context,
          undefined,
          lock,
          undefined,
          true,
        );
      } finally {
        if (!lockTransferred) {
          await this.redis
            .releaseConversationLock(conversationId, lock)
            .catch(() => undefined);
        }
      }
    }) as Promise<TurnStartReceipt>;
  }

  async clearGoal(
    ownerId: string,
    conversationId: string,
    context: AuditContext,
  ): Promise<{ cleared: boolean }> {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const lock = await this.acquireConversationLock(conversationId);
      try {
        const goal = await this.prisma.conversationGoal.findFirst({
          where: { conversationId, ownerId },
        });
        if (!goal) {
          await this.assertOwner(ownerId, conversationId);
          return { cleared: false };
        }
        const runtime = await this.buildGoalClearInput(
          ownerId,
          conversationId,
          goal,
        );
        const cleared = await this.runner.clearGoal(runtime);
        await this.prisma.conversationGoal.deleteMany({
          where: { conversationId, ownerId },
        });
        await this.audit.write({
          ...context,
          actorId: ownerId,
          action: "conversation_goal_cleared",
          targetType: "conversation_goal",
          targetId: conversationId,
          result: "success",
          metadata: { conversation_id: conversationId },
        });
        return { cleared };
      } finally {
        await this.redis
          .releaseConversationLock(conversationId, lock)
          .catch(() => undefined);
      }
    }) as Promise<{ cleared: boolean }>;
  }

  async submitScheduledTurn(
    ownerId: string,
    conversationId: string,
    inputText: string,
    idempotencyKey: string,
    modelPreference?: {
      modelId: string;
      reasoningEffort: ReasoningEffort;
    },
  ): Promise<
    | { status: "started"; turnId: string }
    | { status: "queued"; pendingRequestId: string }
  > {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (conversation.archiveStatus !== "active" || !conversation.pinnedAt) {
      throw new AppError("AUTOMATION_TASK_NOT_PINNED");
    }
    if (conversation.collaborationMode !== "default") {
      throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
    }
    const context: AuditContext = {
      actorId: ownerId,
      ipAddress: null,
      userAgent: null,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [existingTurn, existingPending] = await Promise.all([
        this.prisma.conversationTurn.findFirst({
          where: { conversationId, idempotencyKey },
          select: { id: true },
        }),
        this.prisma.pendingRequest.findFirst({
          where: { conversationId, idempotencyKey },
          select: { id: true },
        }),
      ]);
      if (existingTurn) {
        return { status: "started", turnId: existingTurn.id };
      }
      if (existingPending) {
        return { status: "queued", pendingRequestId: existingPending.id };
      }

      const running = await this.prisma.conversationTurn.count({
        where: { conversationId, status: "running" },
      });
      try {
        if (running > 0) {
          const pending = await this.createPending(
            ownerId,
            conversationId,
            {
              inputText,
              priorityCapabilityIds: [],
              knowledgeBaseIds: [],
              idempotencyKey,
              preserveStagedAttachments: true,
              ...(modelPreference ? { modelPreference } : {}),
            },
            context,
          );
          return { status: "queued", pendingRequestId: pending.id };
        }
        const turn = await this.startTurn(
          ownerId,
          conversationId,
          {
            inputText,
            priorityCapabilityIds: [],
            knowledgeBaseIds: [],
            idempotencyKey,
            submitMode: "normal",
            preserveStagedAttachments: true,
            ...(modelPreference ? { modelPreference } : {}),
          },
          context,
        );
        return { status: "started", turnId: turn.id };
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "CONFLICT") {
          throw error;
        }
      }
    }
    throw new AppError("CONFLICT");
  }

  private async findProjectedRegeneration(
    conversationId: string,
    regenerationMessageId: string,
    idempotencyKey: string,
    inputText: string,
  ) {
    const turn = await this.prisma.conversationTurn.findFirst({
      where: { conversationId, idempotencyKey },
    });
    if (!turn) return null;
    const [message, capabilityEvents] = await Promise.all([
      this.prisma.conversationMessage.findFirst({
        where: { conversationId, turnId: turn.id, role: "user" },
        orderBy: { sequenceNo: "asc" },
      }),
      this.prisma.conversationEvent.findMany({
        where: {
          conversationId,
          turnId: turn.id,
          eventType: "conversation.capability.attached",
        },
        orderBy: { sequenceNo: "asc" },
      }),
    ]);
    const requestHash = turnIdempotencyRequestHash({
      inputText,
      messageDisplay: null,
      submitMode: "manual_retry",
      priorityCapabilityIds: priorityCapabilityIdsFromEvents(
        capabilityEvents.map((event) => event.payloadJson),
      ),
      knowledgeBaseIds: jsonStringArray(turn.knowledgeBaseIdsJson),
      preservesStagedAttachments: false,
      pendingRequestId: null,
      regenerationMessageId,
      taskKind: "turn",
      collaborationMode: conversationCollaborationModeSchema.parse(
        turn.collaborationMode,
      ),
      goalObjective: null,
      goalTokenBudget: null,
    });
    if (
      turn.submitMode !== "manual_retry" ||
      turn.idempotencyRequestHash !== requestHash ||
      !message ||
      message.contentText !== inputText
    ) {
      throw new AppError("CONFLICT");
    }
    return projectTurn(turn);
  }

  async regenerate(
    ownerId: string,
    conversationId: string,
    messageId: string,
    input: { inputText: string; idempotencyKey: string },
    context: AuditContext,
  ): Promise<ReturnType<typeof projectTurn>> {
    return this.regenerateInternal(
      ownerId,
      conversationId,
      messageId,
      input,
      context,
      false,
    ) as Promise<ReturnType<typeof projectTurn>>;
  }

  async acceptRegeneration(
    ownerId: string,
    conversationId: string,
    messageId: string,
    input: { inputText: string; idempotencyKey: string },
    context: AuditContext,
  ): Promise<TurnStartReceipt> {
    return this.regenerateInternal(
      ownerId,
      conversationId,
      messageId,
      input,
      context,
      true,
    ) as Promise<TurnStartReceipt>;
  }

  private async regenerateInternal(
    ownerId: string,
    conversationId: string,
    messageId: string,
    input: { inputText: string; idempotencyKey: string },
    context: AuditContext,
    returnWhenAccepted: boolean,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      await this.assertOwner(ownerId, conversationId);
      const inputText = input.inputText.trim();
      if (inputText.length === 0) throw new AppError("VALIDATION_ERROR");
      const scopedIdempotencyKey = `regenerate:${messageId}:${input.idempotencyKey}`;
      const existingProjection = await this.findProjectedRegeneration(
        conversationId,
        messageId,
        scopedIdempotencyKey,
        inputText,
      );
      if (existingProjection) {
        return returnWhenAccepted
          ? startReceipt(existingProjection.id, "running")
          : existingProjection;
      }

      const lock = await this.acquireConversationLock(conversationId);
      let startOwnsLock = false;
      try {
        const conversation = await this.assertOwner(ownerId, conversationId);
        if (!conversation.codexThreadId) throw new AppError("CONFLICT");

        const repeatedProjection = await this.findProjectedRegeneration(
          conversationId,
          messageId,
          scopedIdempotencyKey,
          inputText,
        );
        if (repeatedProjection) {
          return returnWhenAccepted
            ? startReceipt(repeatedProjection.id, "running")
            : repeatedProjection;
        }

        const pendingCount = await this.prisma.pendingRequest.count({
          where: { conversationId },
        });
        if (pendingCount > 0) throw new AppError("CONFLICT");

        const latestTurn = await this.prisma.conversationTurn.findFirst({
          where: {
            conversationId,
            codexThreadId: conversation.codexThreadId,
          },
          orderBy: { sequenceNo: "desc" },
        });
        if (
          !latestTurn ||
          !TERMINAL_TURN_STATUSES.includes(
            latestTurn.status as (typeof TERMINAL_TURN_STATUSES)[number],
          )
        ) {
          throw new AppError("CONFLICT");
        }

        const firstUserMessage =
          await this.prisma.conversationMessage.findFirst({
            where: {
              conversationId,
              turnId: latestTurn.id,
              role: "user",
            },
            orderBy: { sequenceNo: "asc" },
          });
        if (!firstUserMessage || firstUserMessage.id !== messageId) {
          throw new AppError("CONFLICT");
        }

        const capabilityEvents = await this.prisma.conversationEvent.findMany({
          where: {
            conversationId,
            turnId: latestTurn.id,
            eventType: "conversation.capability.attached",
          },
          orderBy: { sequenceNo: "asc" },
        });
        const priorityCapabilityIds = priorityCapabilityIdsFromEvents(
          capabilityEvents.map((event) => event.payloadJson),
        );
        const regeneration: RegenerationSource = {
          messageId,
          turnId: latestTurn.id,
          turnSequenceNo: latestTurn.sequenceNo,
          codexThreadId: latestTurn.codexThreadId,
          codexTurnId: latestTurn.codexTurnId,
        };

        startOwnsLock = true;
        const submission: TurnSubmission = {
          inputText,
          collaborationMode: conversationCollaborationModeSchema.parse(
            latestTurn.collaborationMode,
          ),
          priorityCapabilityIds,
          knowledgeBaseIds: jsonStringArray(latestTurn.knowledgeBaseIdsJson),
          idempotencyKey: scopedIdempotencyKey,
          submitMode: "manual_retry",
        };
        return returnWhenAccepted
          ? await this.startTurnInternal(
              ownerId,
              conversationId,
              submission,
              context,
              undefined,
              lock,
              regeneration,
              true,
            )
          : await this.startTurnInternal(
              ownerId,
              conversationId,
              submission,
              context,
              undefined,
              lock,
              regeneration,
              false,
            );
      } finally {
        if (!startOwnsLock) {
          await this.redis
            .releaseConversationLock(conversationId, lock)
            .catch(() => undefined);
        }
      }
    });
  }

  async steer(
    ownerId: string,
    conversationId: string,
    localTurnId: string,
    text: string,
    operationId: string,
    context: AuditContext,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      await this.assertOwner(ownerId, conversationId);
      const lock = await this.acquireConversationLock(conversationId);
      try {
        const turn = await this.prisma.conversationTurn.findFirst({
          where: { id: localTurnId, conversationId },
        });
        if (!turn) throw new AppError("TURN_STEER_REQUEST_FAILED");

        const messageId = deterministicUuid(
          turn.id,
          `steer-message:${operationId}`,
        );
        const eventId = deterministicUuid(
          turn.id,
          `steer-event:${operationId}`,
        );
        const auditId = deterministicUuid(
          turn.id,
          `steer-audit:${operationId}`,
        );
        const existingMessage =
          await this.prisma.conversationMessage.findUnique({
            where: { id: messageId },
          });
        if (existingMessage) {
          if (
            existingMessage.conversationId !== conversationId ||
            existingMessage.turnId !== turn.id ||
            existingMessage.role !== "user" ||
            existingMessage.contentText !== text
          ) {
            throw new AppError("CONFLICT");
          }
          return { turn_id: localTurnId, accepted: true };
        }

        const accepted = await this.runner.steer({
          conversationId,
          operationId,
          projectionTurnId: turn.id,
          ownerId,
          expectedCodexTurnId: turn.codexTurnId,
          text,
        });
        if (accepted.turnId !== turn.codexTurnId) {
          throw new AppError("TURN_STEER_REQUEST_UNCERTAIN");
        }

        const result = await this.prisma.$transaction(async (tx) => {
          const duplicate = await tx.conversationMessage.findUnique({
            where: { id: messageId },
          });
          if (duplicate) {
            if (
              duplicate.conversationId !== conversationId ||
              duplicate.turnId !== turn.id ||
              duplicate.role !== "user" ||
              duplicate.contentText !== text
            ) {
              throw new AppError("CONFLICT");
            }
            const event = await tx.conversationEvent.findUnique({
              where: { id: eventId },
            });
            if (!event) throw new AppError("INTERNAL_ERROR");
            return { event, created: false };
          }

          const sequenceNo = await nextConversationEventSequence(
            tx,
            conversationId,
          );
          const latestMessage = await tx.conversationMessage.findFirst({
            where: { conversationId },
            orderBy: { sequenceNo: "desc" },
          });
          const message = await tx.conversationMessage.create({
            data: {
              id: messageId,
              conversationId,
              turnId: turn.id,
              sequenceNo: (latestMessage?.sequenceNo ?? 0) + 1,
              role: "user",
              contentText: text,
            },
          });
          const event = await tx.conversationEvent.create({
            data: {
              id: eventId,
              conversationId,
              turnId: turn.id,
              sequenceNo,
              eventType: "conversation.message.completed",
              visibility: "user_visible",
              payloadJson: {
                schema_version: 1,
                message_id: message.id,
                role: "user",
                usage_type: "steer_current_turn",
              },
              sseEventId: `${conversationId}:${sequenceNo}`,
            },
          });
          await tx.auditLog.create({
            data: {
              id: auditId,
              actorId: ownerId,
              action: "conversation_turn_steered",
              targetType: "conversation_turn",
              targetId: turn.id,
              result: "success",
              metadataJson: { conversation_id: conversationId },
              ipAddress: context.ipAddress ?? null,
              userAgent: context.userAgent ?? null,
            },
          });
          return { event, created: true };
        });
        if (result.created) {
          await this.redis
            .publishConversationEvent(
              conversationId,
              projectStoredEvent(result.event),
            )
            .catch(() => undefined);
        }
        return { turn_id: localTurnId, accepted: true };
      } finally {
        await this.redis
          .releaseConversationLock(conversationId, lock)
          .catch(() => undefined);
      }
    });
  }

  async steerPending(
    ownerId: string,
    conversationId: string,
    pendingId: string,
    context: AuditContext,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, () =>
      this.steerPendingForActiveUser(
        ownerId,
        conversationId,
        pendingId,
        context,
      ),
    );
  }

  private async steerPendingForActiveUser(
    ownerId: string,
    conversationId: string,
    pendingId: string,
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    const messageId = deterministicUuid(pendingId, "pending-steer-message");
    const existingMessage = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
    });
    if (existingMessage) {
      if (
        existingMessage.conversationId !== conversationId ||
        existingMessage.role !== "user" ||
        existingMessage.turnId === null
      ) {
        throw new AppError("CONFLICT");
      }
      return { turn_id: existingMessage.turnId, accepted: true };
    }

    const lock = await this.acquireConversationLock(conversationId);
    let pendingToAdvance: string | null = null;
    let errorToThrow: unknown;
    try {
      const reservation = await this.reservePendingSteer({
        ownerId,
        conversationId,
        pendingId,
      });
      if (reservation.event) {
        await this.redis
          .publishConversationEvent(
            conversationId,
            projectStoredEvent(reservation.event),
          )
          .catch(() => undefined);
      }

      try {
        const accepted = await this.runner.steer({
          conversationId,
          operationId: reservation.operationId,
          projectionTurnId: reservation.turnId,
          ownerId,
          expectedCodexTurnId: reservation.codexTurnId,
          text: reservation.text,
        });
        if (accepted.turnId !== reservation.codexTurnId) {
          throw new RunnerSteerOperationUncertainError();
        }

        const projection = await this.persistPendingSteerProjection({
          ownerId,
          conversationId,
          pendingId,
          operationId: reservation.operationId,
          turnId: reservation.turnId,
          text: reservation.text,
          messageId,
          context,
        });
        if (projection.created) {
          for (const event of projection.events) {
            await this.redis
              .publishConversationEvent(
                conversationId,
                projectStoredEvent(event),
              )
              .catch(() => undefined);
          }
        }
        return { turn_id: reservation.turnId, accepted: true };
      } catch (error) {
        if (
          error instanceof RunnerSteerOperationUncertainError ||
          (error instanceof AppError &&
            error.code === "TURN_STEER_REQUEST_UNCERTAIN")
        ) {
          throw error;
        }
        if (
          error instanceof AppError &&
          error.code === "TURN_STEER_REQUEST_FAILED"
        ) {
          const released = await this.releasePendingSteerReservation({
            ownerId,
            conversationId,
            pendingId,
            operationId: reservation.operationId,
            turnId: reservation.turnId,
          });
          if (released) {
            pendingToAdvance = pendingId;
            await this.redis
              .publishConversationEvent(
                conversationId,
                projectStoredEvent(released),
              )
              .catch(() => undefined);
          }
        }
        errorToThrow = error;
      }
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }

    if (pendingToAdvance) {
      await this.startPending(
        ownerId,
        conversationId,
        pendingToAdvance,
        context,
      ).catch(() => undefined);
    }
    throw errorToThrow ?? new AppError("INTERNAL_ERROR");
  }

  private async reservePendingSteer(input: {
    ownerId: string;
    conversationId: string;
    pendingId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE
      `;
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM pending_requests WHERE id = ${input.pendingId}::uuid FOR UPDATE
      `;
      const pending = await tx.pendingRequest.findFirst({
        where: {
          id: input.pendingId,
          conversationId: input.conversationId,
          submittedBy: input.ownerId,
        },
      });
      if (!pending) throw new AppError("NOT_FOUND");

      if (pending.status === "steering") {
        if (!pending.steerOperationId || !pending.steerTurnId) {
          throw new AppError("CONFLICT");
        }
        const turn = await tx.conversationTurn.findFirst({
          where: {
            id: pending.steerTurnId,
            conversationId: input.conversationId,
            submittedBy: input.ownerId,
          },
        });
        if (!turn) throw new AppError("CONFLICT");
        return {
          operationId: pending.steerOperationId,
          turnId: turn.id,
          codexTurnId: turn.codexTurnId,
          text: pending.inputText,
          event: null,
        };
      }

      const [head, running, attachment, startIntent] = await Promise.all([
        tx.pendingRequest.findFirst({
          where: { conversationId: input.conversationId },
          orderBy: { queueNo: "asc" },
        }),
        tx.conversationTurn.findFirst({
          where: {
            conversationId: input.conversationId,
            status: "running",
          },
          orderBy: { sequenceNo: "desc" },
        }),
        tx.conversationFile.findFirst({
          where: {
            conversationId: input.conversationId,
            pendingRequestId: pending.id,
            status: "pending",
          },
          select: { id: true },
        }),
        tx.conversationTurnStartIntent.findFirst({
          where: {
            ownerId: input.ownerId,
            conversationId: input.conversationId,
            pendingRequestId: pending.id,
          },
          select: { projectionTurnId: true },
        }),
      ]);
      if (
        head?.id !== pending.id ||
        pending.status !== "waiting_previous_turn" ||
        pending.inputText.trim().length === 0 ||
        jsonStringArray(pending.priorityCapabilityIdsJson).length > 0 ||
        jsonStringArray(pending.knowledgeBaseIdsJson).length > 0 ||
        attachment ||
        startIntent ||
        !running
      ) {
        throw new AppError("TURN_STEER_REQUEST_FAILED");
      }

      const operationId = crypto.randomUUID();
      const reserved = await tx.pendingRequest.update({
        where: { id: pending.id },
        data: {
          status: "steering",
          blockCode: null,
          steerOperationId: operationId,
          steerTurnId: running.id,
        },
      });
      const sequenceNo = await nextConversationEventSequence(
        tx,
        input.conversationId,
      );
      const event = await tx.conversationEvent.create({
        data: {
          conversationId: input.conversationId,
          turnId: running.id,
          sequenceNo,
          eventType: "conversation.pending_request.updated",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            pending_request_id: reserved.id,
            status: "steering",
            block_code: null,
            queue_no: Number(reserved.queueNo),
          },
          sseEventId: `${input.conversationId}:${sequenceNo}`,
        },
      });
      return {
        operationId,
        turnId: running.id,
        codexTurnId: running.codexTurnId,
        text: reserved.inputText,
        event,
      };
    });
  }

  private async persistPendingSteerProjection(input: {
    ownerId: string;
    conversationId: string;
    pendingId: string;
    operationId: string;
    turnId: string;
    text: string;
    messageId: string;
    context: AuditContext;
  }) {
    const messageEventId = deterministicUuid(
      input.pendingId,
      "pending-steer-message-event",
    );
    const cancelledEventId = deterministicUuid(
      input.pendingId,
      "pending-steer-cancelled-event",
    );
    const auditId = deterministicUuid(input.pendingId, "pending-steer-audit");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE
      `;
      const duplicate = await tx.conversationMessage.findUnique({
        where: { id: input.messageId },
      });
      if (duplicate) {
        if (
          duplicate.conversationId !== input.conversationId ||
          duplicate.turnId !== input.turnId ||
          duplicate.role !== "user" ||
          duplicate.contentText !== input.text
        ) {
          throw new AppError("CONFLICT");
        }
        return { created: false, events: [] };
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM pending_requests WHERE id = ${input.pendingId}::uuid FOR UPDATE
      `;
      const pending = await tx.pendingRequest.findFirst({
        where: {
          id: input.pendingId,
          conversationId: input.conversationId,
          submittedBy: input.ownerId,
        },
      });
      if (
        !pending ||
        pending.status !== "steering" ||
        pending.steerOperationId !== input.operationId ||
        pending.steerTurnId !== input.turnId ||
        pending.inputText !== input.text
      ) {
        throw new AppError("TURN_STEER_REQUEST_UNCERTAIN");
      }

      const latestMessage = await tx.conversationMessage.findFirst({
        where: { conversationId: input.conversationId },
        orderBy: { sequenceNo: "desc" },
      });
      const message = await tx.conversationMessage.create({
        data: {
          id: input.messageId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          sequenceNo: (latestMessage?.sequenceNo ?? 0) + 1,
          role: "user",
          contentText: input.text,
        },
      });
      const messageSequenceNo = await nextConversationEventSequence(
        tx,
        input.conversationId,
      );
      const messageEvent = await tx.conversationEvent.create({
        data: {
          id: messageEventId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          sequenceNo: messageSequenceNo,
          eventType: "conversation.message.completed",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            message_id: message.id,
            role: "user",
            usage_type: "steer_current_turn",
          },
          sseEventId: `${input.conversationId}:${messageSequenceNo}`,
        },
      });
      await tx.pendingRequest.delete({ where: { id: pending.id } });
      const cancelledSequenceNo = messageSequenceNo + 1n;
      const cancelledEvent = await tx.conversationEvent.create({
        data: {
          id: cancelledEventId,
          conversationId: input.conversationId,
          sequenceNo: cancelledSequenceNo,
          eventType: "conversation.pending_request.cancelled",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            pending_request_id: pending.id,
          },
          sseEventId: `${input.conversationId}:${cancelledSequenceNo}`,
        },
      });
      await tx.auditLog.create({
        data: {
          id: auditId,
          actorId: input.ownerId,
          action: "conversation_pending_request_steered",
          targetType: "pending_request",
          targetId: pending.id,
          result: "success",
          metadataJson: {
            conversation_id: input.conversationId,
            turn_id: input.turnId,
          },
          ipAddress: input.context.ipAddress ?? null,
          userAgent: input.context.userAgent ?? null,
        },
      });
      return { created: true, events: [messageEvent, cancelledEvent] };
    });
  }

  private async releasePendingSteerReservation(input: {
    ownerId: string;
    conversationId: string;
    pendingId: string;
    operationId: string;
    turnId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE
      `;
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM pending_requests WHERE id = ${input.pendingId}::uuid FOR UPDATE
      `;
      const pending = await tx.pendingRequest.findFirst({
        where: {
          id: input.pendingId,
          conversationId: input.conversationId,
          submittedBy: input.ownerId,
        },
      });
      if (
        !pending ||
        pending.status !== "steering" ||
        pending.steerOperationId !== input.operationId ||
        pending.steerTurnId !== input.turnId
      ) {
        return null;
      }
      const released = await tx.pendingRequest.update({
        where: { id: pending.id },
        data: {
          status: "waiting_previous_turn",
          steerOperationId: null,
          steerTurnId: null,
        },
      });
      const sequenceNo = await nextConversationEventSequence(
        tx,
        input.conversationId,
      );
      return tx.conversationEvent.create({
        data: {
          conversationId: input.conversationId,
          sequenceNo,
          eventType: "conversation.pending_request.updated",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            pending_request_id: released.id,
            status: "waiting_previous_turn",
            block_code: null,
            queue_no: Number(released.queueNo),
          },
          sseEventId: `${input.conversationId}:${sequenceNo}`,
        },
      });
    });
  }

  async interrupt(
    ownerId: string,
    conversationId: string,
    localTurnId: string,
    context: AuditContext,
  ) {
    await this.assertOwner(ownerId, conversationId);
    let turn = await this.prisma.conversationTurn.findFirst({
      where: { id: localTurnId, conversationId },
    });
    if (!turn) {
      const startIntent =
        await this.prisma.conversationTurnStartIntent.findUnique({
          where: { projectionTurnId: localTurnId },
        });
      if (!startIntent) {
        turn = await this.prisma.conversationTurn.findFirst({
          where: { id: localTurnId, conversationId },
        });
        if (!turn) {
          return {
            code: RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
            turn_id: localTurnId,
          };
        }
      } else if (
        startIntent.conversationId !== conversationId ||
        startIntent.ownerId !== ownerId
      ) {
        throw new AppError("TURN_INTERRUPT_REQUEST_FAILED");
      }

      if (startIntent) {
        const deadline =
          Date.now() + ACCEPTED_START_RECOVERY_WINDOW_MILLISECONDS;
        while (!turn && Date.now() < deadline) {
          const outcome = await this.recoverStartIntent(localTurnId);
          turn = await this.prisma.conversationTurn.findFirst({
            where: { id: localTurnId, conversationId },
          });
          if (turn) break;
          if (outcome === "missing" || outcome === "released") {
            return {
              code: RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
              turn_id: localTurnId,
            };
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(
              resolve,
              ACCEPTED_START_RECOVERY_POLL_MILLISECONDS,
            );
            timer.unref();
          });
        }
        if (!turn) throw turnProjectionUnavailableError();
      }
    }
    if (!turn) {
      return {
        code: RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
        turn_id: localTurnId,
      };
    }
    if (
      TERMINAL_TURN_STATUSES.includes(
        turn.status as (typeof TERMINAL_TURN_STATUSES)[number],
      )
    ) {
      return { code: RUNNER_TURN_INTERRUPT_NOT_ACTIVE, turn_id: turn.id };
    }
    if (turn.status !== "running") {
      throw new AppError("TURN_INTERRUPT_REQUEST_FAILED");
    }
    if (turn.interruptRequestedAt) {
      return { code: RUNNER_TURN_INTERRUPT_REQUESTED, turn_id: turn.id };
    }
    if (turn.taskKind === "goal") {
      const goal = await this.prisma.conversationGoal.findFirst({
        where: {
          conversationId,
          ownerId,
          activeTurnId: turn.id,
          status: "active",
        },
        select: { conversationId: true },
      });
      if (goal) {
        await this.updateGoal(
          ownerId,
          conversationId,
          { status: "paused" },
          context,
        );
      }
    }
    const interrupt = await this.runner.interrupt(
      conversationId,
      ownerId,
      turn.codexTurnId,
    );
    if (interrupt.code === RUNNER_TURN_INTERRUPT_NOT_ACTIVE) {
      return { code: RUNNER_TURN_INTERRUPT_NOT_ACTIVE, turn_id: turn.id };
    }
    await this.prisma.conversationTurn.update({
      where: { id: turn.id },
      data: { interruptRequestedAt: new Date() },
    });
    await this.audit.write({
      ...context,
      actorId: ownerId,
      action: "conversation_turn_interrupt_requested",
      targetType: "conversation_turn",
      targetId: turn.id,
      result: "success",
      metadata: { conversation_id: conversationId },
    });
    return { code: RUNNER_TURN_INTERRUPT_REQUESTED, turn_id: turn.id };
  }

  async respondToUserInputRequest(
    ownerId: string,
    conversationId: string,
    requestId: string,
    rawResponse: ConversationUserInputResponse,
    context: AuditContext,
  ) {
    const response = conversationUserInputResponseSchema.parse(rawResponse);
    await this.assertOwner(ownerId, conversationId);
    const lock = await this.acquireConversationLock(conversationId);
    let request: {
      id: string;
      turnId: string;
      codexThreadId: string;
      codexTurnId: string;
      codexItemId: string;
      nativeRequestId: bigint;
      requestKind: string;
      questionsJson: unknown;
      formSchemaJson: unknown;
    };
    try {
      request = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_user_input_requests
          WHERE id = ${requestId}::uuid
          FOR UPDATE
        `;
        const stored = await tx.conversationUserInputRequest.findFirst({
          where: { id: requestId, conversationId, ownerId },
        });
        if (!stored || stored.status !== "pending") {
          throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
        }
        const [conversation, turn] = await Promise.all([
          tx.conversation.findUnique({ where: { id: conversationId } }),
          tx.conversationTurn.findUnique({ where: { id: stored.turnId } }),
        ]);
        if (
          !conversation ||
          !turn ||
          turn.status !== "running" ||
          turn.conversationId !== conversationId ||
          conversation.codexThreadId !== stored.codexThreadId ||
          turn.codexThreadId !== stored.codexThreadId ||
          turn.codexTurnId !== stored.codexTurnId
        ) {
          throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
        }
        validateConversationUserInputResponse(stored, response);
        const claimed = await tx.conversationUserInputRequest.updateMany({
          where: { id: stored.id, status: "pending" },
          data: {
            status: "answering",
            resolvedAction: response.action,
            ...(stored.requestKind === "form"
              ? {
                  responseContentJson:
                    response.action === "accept"
                      ? (response.content as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                }
              : {}),
          },
        });
        if (claimed.count !== 1) {
          throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
        }
        return stored;
      });
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }

    try {
      await this.runner.respondUserInputRequest({
        conversationId,
        ownerId,
        requestId: Number(request.nativeRequestId),
        codexThreadId: request.codexThreadId,
        codexTurnId: request.codexTurnId,
        itemId: request.codexItemId,
        response,
      });
    } catch (error) {
      await this.prisma.conversationUserInputRequest.updateMany({
        where: { id: request.id, status: "answering" },
        data:
          error instanceof AppError &&
          error.code === "USER_INPUT_REQUEST_UNAVAILABLE"
            ? {
                status: "cancelled",
                resolvedAction: "cancel",
                resolvedAt: new Date(),
                responseContentJson: Prisma.DbNull,
              }
            : {
                status: "pending",
                resolvedAction: null,
                responseContentJson: Prisma.DbNull,
              },
      });
      throw error;
    }

    const terminalStatus =
      response.action === "accept" ? "answered" : "cancelled";
    const result = await this.prisma.$transaction(async (tx) => {
      const completed = await tx.conversationUserInputRequest.updateMany({
        where: { id: request.id, status: "answering" },
        data: {
          status: terminalStatus,
          resolvedAction: response.action,
          resolvedAt: new Date(),
        },
      });
      const stored = await tx.conversationUserInputRequest.findUnique({
        where: { id: request.id },
      });
      if (
        !stored ||
        (completed.count !== 1 && stored.status !== terminalStatus)
      ) {
        throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
      }
      const sequenceNo = await nextConversationEventSequence(tx, conversationId);
      const event = await tx.conversationEvent.create({
        data: {
          conversationId,
          turnId: stored.turnId,
          sequenceNo,
          eventType: "conversation.user_input_request.updated",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            user_input_request_id: stored.id,
            status: terminalStatus,
          },
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return { stored, event };
    });
    await this.audit.write({
      ...context,
      actorId: ownerId,
      action: "conversation_user_input_request_responded",
      targetType: "conversation_user_input_request",
      targetId: request.id,
      result: "success",
      metadata: {
        conversation_id: conversationId,
        turn_id: request.turnId,
        action: response.action,
      },
    });
    await this.redis
      .publishConversationEvent(
        conversationId,
        projectStoredEvent(result.event),
      )
      .catch(() => undefined);
    return projectUserInputRequest(result.stored);
  }

  async actOnPlanReview(
    ownerId: string,
    conversationId: string,
    reviewId: string,
    input: PlanReviewActionInput,
    context: AuditContext,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const lock = await this.acquireConversationLock(conversationId);
      let lockTransferred = false;
      try {
        if (input.action === "skip" || input.action === "exit") {
          const result = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM conversations
              WHERE id = ${conversationId}::uuid
              FOR UPDATE
            `;
            await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM conversation_plan_reviews
              WHERE id = ${reviewId}::uuid
              FOR UPDATE
            `;
            const [conversation, review, activeIntent, pendingCount] =
              await Promise.all([
                tx.conversation.findUnique({ where: { id: conversationId } }),
                tx.conversationPlanReview.findUnique({
                  where: { id: reviewId },
                }),
                tx.conversationTurnStartIntent.findUnique({
                  where: { conversationId },
                }),
                tx.pendingRequest.count({ where: { conversationId } }),
              ]);
            if (
              !conversation ||
              conversation.ownerId !== ownerId ||
              !review ||
              review.conversationId !== conversationId ||
              review.ownerId !== ownerId
            ) {
              throw new AppError("PLAN_REVIEW_UNAVAILABLE");
            }
            if (review.status === "resolved") {
              if (
                review.decision !== input.action ||
                review.followUpTurnId !== null
              ) {
                throw new AppError("PLAN_REVIEW_UNAVAILABLE");
              }
              return { review, event: null };
            }
            const [sourceTurn, latestTurn, runningCount] = await Promise.all([
              tx.conversationTurn.findUnique({
                where: { id: review.sourceTurnId },
              }),
              tx.conversationTurn.findFirst({
                where: {
                  conversationId,
                  ...(conversation.codexThreadId
                    ? { codexThreadId: conversation.codexThreadId }
                    : {}),
                },
                orderBy: { sequenceNo: "desc" },
              }),
              tx.conversationTurn.count({
                where: { conversationId, status: "running" },
              }),
            ]);
            if (
              review.status !== "pending" ||
              conversation.collaborationMode !== "plan" ||
              !sourceTurn ||
              sourceTurn.id !== latestTurn?.id ||
              sourceTurn.status !== "completed" ||
              sourceTurn.collaborationMode !== "plan" ||
              sourceTurn.codexThreadId !== conversation.codexThreadId ||
              activeIntent ||
              pendingCount > 0 ||
              runningCount > 0
            ) {
              throw new AppError("PLAN_REVIEW_UNAVAILABLE");
            }
            const resolvedAt = new Date();
            const updated = await tx.conversationPlanReview.update({
              where: { id: review.id },
              data: {
                status: "resolved",
                decision: input.action,
                followUpTurnId: null,
                resolvedAt,
              },
            });
            if (input.action === "exit") {
              await tx.conversation.update({
                where: { id: conversationId },
                data: { collaborationMode: "default" },
              });
            }
            const sequenceNo = await nextConversationEventSequence(
              tx,
              conversationId,
            );
            const event = await tx.conversationEvent.create({
              data: {
                conversationId,
                turnId: review.sourceTurnId,
                sequenceNo,
                eventType: "conversation.plan_review.updated",
                visibility: "user_visible",
                payloadJson: {
                  schema_version: 1,
                  plan_review_id: review.id,
                  source_turn_id: review.sourceTurnId,
                  status: "resolved",
                  decision: input.action,
                  follow_up_turn_id: null,
                },
                sseEventId: `${conversationId}:${sequenceNo}`,
              },
            });
            return { review: updated, event };
          });
          if (result.event) {
            await this.redis
              .publishConversationEvent(
                conversationId,
                projectStoredEvent(result.event),
              )
              .catch(() => undefined);
            await this.audit.write({
              ...context,
              actorId: ownerId,
              action: "conversation_plan_review_resolved",
              targetType: "conversation_plan_review",
              targetId: reviewId,
              result: "success",
              metadata: {
                conversation_id: conversationId,
                decision: input.action,
              },
            });
          }
          return { review: projectPlanReview(result.review), turn: null };
        }

        const clientIdempotencyKey = input.idempotencyKey.trim();
        const requestedInputText =
          input.action === "implement"
            ? PLAN_IMPLEMENTATION_INPUT
            : input.feedback.trim();
        if (
          clientIdempotencyKey.length === 0 ||
          clientIdempotencyKey.length > 120 ||
          requestedInputText.length === 0 ||
          requestedInputText.length > 1_000_000
        ) {
          throw new AppError("VALIDATION_ERROR");
        }
        const requestedIdempotencyKey = planReviewIdempotencyKey(
          reviewId,
          input.action,
          clientIdempotencyKey,
        );

        const prepared = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM conversations
            WHERE id = ${conversationId}::uuid
            FOR UPDATE
          `;
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM conversation_plan_reviews
            WHERE id = ${reviewId}::uuid
            FOR UPDATE
          `;
          const [conversation, review, activeIntent, pendingCount] =
            await Promise.all([
              tx.conversation.findUnique({ where: { id: conversationId } }),
              tx.conversationPlanReview.findUnique({ where: { id: reviewId } }),
              tx.conversationTurnStartIntent.findUnique({
                where: { conversationId },
              }),
              tx.pendingRequest.count({ where: { conversationId } }),
            ]);
          if (
            !conversation ||
            conversation.ownerId !== ownerId ||
            !review ||
            review.conversationId !== conversationId ||
            review.ownerId !== ownerId
          ) {
            throw new AppError("PLAN_REVIEW_UNAVAILABLE");
          }
          if (review.status === "resolved") {
            if (
              review.decision !== input.action ||
              !review.followUpTurnId
            ) {
              throw new AppError("PLAN_REVIEW_UNAVAILABLE");
            }
            const [turn, userMessage, capabilityEvents] = await Promise.all([
              tx.conversationTurn.findUnique({
                where: { id: review.followUpTurnId },
              }),
              tx.conversationMessage.findFirst({
                where: {
                  conversationId,
                  turnId: review.followUpTurnId,
                  role: "user",
                },
                orderBy: { sequenceNo: "asc" },
              }),
              tx.conversationEvent.findMany({
                where: {
                  conversationId,
                  turnId: review.followUpTurnId,
                  eventType: "conversation.capability.attached",
                },
                orderBy: { sequenceNo: "asc" },
              }),
            ]);
            if (
              !turn ||
              turn.conversationId !== conversationId ||
              !userMessage ||
              userMessage.contentText !== requestedInputText ||
              turn.idempotencyKey !== requestedIdempotencyKey
            ) {
              throw new AppError("CONFLICT");
            }
            const expectedRequestHash = turnIdempotencyRequestHash({
              inputText: requestedInputText,
              messageDisplay: null,
              submitMode: "normal",
              priorityCapabilityIds: priorityCapabilityIdsFromEvents(
                capabilityEvents.map((event) => event.payloadJson),
              ),
              knowledgeBaseIds: jsonStringArray(turn.knowledgeBaseIdsJson),
              preservesStagedAttachments: true,
              pendingRequestId: null,
              regenerationMessageId: null,
              taskKind: "turn",
              collaborationMode:
                input.action === "implement" ? "default" : "plan",
              goalObjective: null,
              goalTokenBudget: null,
              planReviewId: review.id,
              planReviewAction: input.action,
            });
            if (turn.idempotencyRequestHash !== expectedRequestHash) {
              throw new AppError("CONFLICT");
            }
            if (turn.taskKind !== "turn") {
              throw new AppError("PLAN_REVIEW_UNAVAILABLE");
            }
            return { kind: "resolved" as const, review, turn };
          }
          const [sourceTurn, latestTurn, planMessage, capabilityEvents] =
            await Promise.all([
              tx.conversationTurn.findUnique({
                where: { id: review.sourceTurnId },
              }),
              tx.conversationTurn.findFirst({
                where: {
                  conversationId,
                  ...(conversation.codexThreadId
                    ? { codexThreadId: conversation.codexThreadId }
                    : {}),
                },
                orderBy: { sequenceNo: "desc" },
              }),
              tx.conversationMessage.findUnique({
                where: { id: review.planMessageId },
              }),
              tx.conversationEvent.findMany({
                where: {
                  conversationId,
                  turnId: review.sourceTurnId,
                  eventType: "conversation.capability.attached",
                },
                orderBy: { sequenceNo: "asc" },
              }),
            ]);
          const parsedIntent = activeIntent
            ? parseTurnStartIntent(activeIntent)
            : null;
          if (
            review.status !== "pending" ||
            conversation.collaborationMode !== "plan" ||
            !sourceTurn ||
            sourceTurn.id !== latestTurn?.id ||
            sourceTurn.status !== "completed" ||
            sourceTurn.collaborationMode !== "plan" ||
            sourceTurn.codexThreadId !== conversation.codexThreadId ||
            !planMessage ||
            planMessage.turnId !== sourceTurn.id ||
            planMessage.role !== "assistant" ||
            pendingCount > 0 ||
            (parsedIntent &&
              (parsedIntent.planReviewId !== review.id ||
                parsedIntent.planReviewAction !== input.action ||
                parsedIntent.idempotencyKey !== requestedIdempotencyKey ||
                parsedIntent.inputText !== requestedInputText))
          ) {
            throw new AppError("PLAN_REVIEW_UNAVAILABLE");
          }
          return {
            kind: "pending" as const,
            review,
            sourceTurn,
            priorityCapabilityIds: priorityCapabilityIdsFromEvents(
              capabilityEvents.map((event) => event.payloadJson),
            ),
          };
        });
        if (prepared.kind === "resolved") {
          return {
            review: projectPlanReview(prepared.review),
            turn: projectTurn(prepared.turn),
          };
        }

        const knowledgeBaseIds = await this.validateKnowledgeBaseSelection(
          ownerId,
          jsonStringArray(prepared.sourceTurn.knowledgeBaseIdsJson),
        );
        lockTransferred = true;
        const turn = await this.startTurnInternal(
          ownerId,
          conversationId,
          {
            inputText: requestedInputText,
            collaborationMode:
              input.action === "implement" ? "default" : "plan",
            priorityCapabilityIds: prepared.priorityCapabilityIds,
            knowledgeBaseIds,
            idempotencyKey: requestedIdempotencyKey,
            submitMode: "normal",
            preserveStagedAttachments: true,
          },
          context,
          undefined,
          lock,
          undefined,
          false,
          { reviewId, action: input.action },
        );
        const resolvedReview =
          await this.prisma.conversationPlanReview.findUnique({
            where: { id: reviewId },
          });
        if (
          !resolvedReview ||
          resolvedReview.status !== "resolved" ||
          resolvedReview.decision !== input.action ||
          resolvedReview.followUpTurnId !== turn.id
        ) {
          throw new AppError("PLAN_REVIEW_UNAVAILABLE");
        }
        return { review: projectPlanReview(resolvedReview), turn };
      } finally {
        if (!lockTransferred) {
          await this.redis
            .releaseConversationLock(conversationId, lock)
            .catch(() => undefined);
        }
      }
    });
  }

  async getSubAgentDetail(
    ownerId: string,
    conversationId: string,
    localTurnId: string,
    agentKey: string,
  ) {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (!conversation.codexThreadId) throw new AppError("NOT_FOUND");
    const turn = await this.prisma.conversationTurn.findFirst({
      where: {
        id: localTurnId,
        conversationId,
        codexThreadId: conversation.codexThreadId,
      },
    });
    if (!turn) throw new AppError("NOT_FOUND");
    const runtime = await this.buildSubAgentReadRuntimeInput(
      ownerId,
      conversationId,
      conversation,
      turn,
    );
    if (!runtime.authorizedAgentKeys.includes(agentKey)) {
      throw new AppError("NOT_FOUND");
    }
    return this.runner.readSubAgentDetail({
      ...runtime,
      agentKey,
    });
  }

  async getSubAgentSummaries(
    ownerId: string,
    conversationId: string,
    localTurnId: string,
  ) {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (!conversation.codexThreadId) throw new AppError("NOT_FOUND");
    const turn = await this.prisma.conversationTurn.findFirst({
      where: {
        id: localTurnId,
        conversationId,
        codexThreadId: conversation.codexThreadId,
      },
    });
    if (!turn) throw new AppError("NOT_FOUND");
    const runtime = await this.buildSubAgentReadRuntimeInput(
      ownerId,
      conversationId,
      conversation,
      turn,
    );
    if (runtime.authorizedAgentKeys.length === 0) return { agents: [] };
    return this.runner.readSubAgentSummaries(runtime);
  }

  private async buildSubAgentReadRuntimeInput(
    ownerId: string,
    conversationId: string,
    conversation: {
      codexThreadId: string | null;
      runtimeGeneration: string;
    },
    turn: {
      id: string;
      codexThreadId: string;
      codexTurnId: string;
      model: string | null;
      reasoningEffort: string | null;
    },
  ): Promise<RunnerSubAgentReadRuntimeInput> {
    if (
      !conversation.codexThreadId ||
      conversation.codexThreadId !== turn.codexThreadId
    ) {
      throw new AppError("NOT_FOUND");
    }
    const modelRuntime =
      turn.model && turn.reasoningEffort
        ? await this.modelRuntimeForSelection(
            ownerId,
            conversationId,
            turn.model,
            reasoningEffortSchema.parse(turn.reasoningEffort),
          )
        : await this.modelRuntimeForUser(ownerId, conversationId);
    const authorizedAgentKeys = await this.authorizedSubAgentKeysForTurn(
      conversationId,
      turn.id,
    );
    return {
      conversationId,
      ownerId,
      expectedRuntimeGeneration: z.uuid().parse(conversation.runtimeGeneration),
      codexThreadId: conversation.codexThreadId,
      codexTurnId: turn.codexTurnId,
      authorizedAgentKeys,
      projectionTurnId: turn.id,
      model: modelRuntime.model,
      reasoningEffort: modelRuntime.reasoningEffort,
      modelProvider: modelRuntime.provider,
    };
  }

  private async authorizedSubAgentKeysForTurn(
    conversationId: string,
    turnId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        turnId,
        eventType: { in: ["item/started", "item/completed"] },
      },
      orderBy: { sequenceNo: "asc" },
      select: { eventType: true, payloadJson: true },
    });
    const agentKeys: string[] = [];
    const seenAgentKeys = new Set<string>();
    for (const row of rows) {
      const parsed = nativeSubAgentItemEventPayloadSchema.safeParse(
        row.payloadJson,
      );
      if (!parsed.success || parsed.data.method !== row.eventType) continue;
      for (const agentKey of referencedRunnerCodexSubAgentKeys(
        parsed.data.params.item,
      )) {
        if (seenAgentKeys.has(agentKey)) continue;
        seenAgentKeys.add(agentKey);
        agentKeys.push(agentKey);
        if (agentKeys.length >= runnerCodexPreviewLimits.subAgents) {
          return agentKeys;
        }
      }
    }
    return agentKeys;
  }

  async assertOwner(ownerId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ownerId },
    });
    if (!conversation) throw new AppError("CONVERSATION_NOT_FOUND");
    return conversation;
  }

  async assertModelPreferenceMutable(
    ownerId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (conversation.applicationId === null) return;
    if (!this.applicationResolver) throw new AppError("APPLICATION_NOT_FOUND");
    const allowed = await this.applicationResolver.allowsUserModelSelection(
      ownerId,
      conversation.applicationId,
    );
    if (!allowed) throw new AppError("FORBIDDEN");
  }

  async assertAutomationCompatible(
    ownerId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.assertOwner(ownerId, conversationId);
    if (conversation.archiveStatus !== "active" || !conversation.pinnedAt) {
      throw new AppError("AUTOMATION_TASK_NOT_PINNED");
    }
    if (conversation.collaborationMode !== "default") {
      throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
    }
  }

  async forkConversationAtMessage(
    ownerId: string,
    conversationId: string,
    messageId: string,
    idempotencyKey: string,
    context: AuditContext,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, async () => {
      const idempotent = await this.prisma.conversation.findFirst({
        where: { ownerId, forkIdempotencyKey: idempotencyKey },
      });
      if (idempotent) {
        if (
          idempotent.forkSourceConversationId !== conversationId ||
          idempotent.forkSourceMessageId !== messageId
        ) {
          throw new AppError("CONFLICT");
        }
        return projectConversation(
          idempotent,
          idempotent.lastTurnStatus ?? "idle",
        );
      }

      const lock = await this.acquireConversationLock(conversationId);
      const forkConversationId = crypto.randomUUID();
      let forkRuntimePrepared = false;
      try {
        const source = await this.prisma.conversation.findFirst({
          where: { id: conversationId, ownerId },
        });
        if (!source) throw new AppError("CONVERSATION_NOT_FOUND");
        if (source.archiveStatus !== "active" || !source.codexThreadId) {
          throw new AppError("CONFLICT");
        }

        const [activeTurns, activeIntents, pendingRequests] = await Promise.all([
          this.prisma.conversationTurn.count({
            where: { conversationId, status: "running" },
          }),
          this.prisma.conversationTurnStartIntent.count({
            where: { conversationId },
          }),
          this.prisma.pendingRequest.count({ where: { conversationId } }),
        ]);
        if (activeTurns > 0 || activeIntents > 0 || pendingRequests > 0) {
          throw new AppError("CONFLICT");
        }

        const sourceMessage = await this.prisma.conversationMessage.findFirst({
          where: {
            id: messageId,
            conversationId,
            role: "assistant",
            turnId: { not: null },
          },
        });
        if (!sourceMessage?.turnId) throw new AppError("CONFLICT");
        const sourceTurn = await this.prisma.conversationTurn.findFirst({
          where: {
            id: sourceMessage.turnId,
            conversationId,
            codexThreadId: source.codexThreadId,
          },
        });
        if (
          !sourceTurn ||
          !TERMINAL_TURN_STATUSES.includes(
            sourceTurn.status as (typeof TERMINAL_TURN_STATUSES)[number],
          )
        ) {
          throw new AppError("CONFLICT");
        }
        const laterMessageInTurn = await this.prisma.conversationMessage.count({
          where: {
            conversationId,
            turnId: sourceTurn.id,
            sequenceNo: { gt: sourceMessage.sequenceNo },
          },
        });
        if (laterMessageInTurn > 0) throw new AppError("CONFLICT");

        const turns = await this.prisma.conversationTurn.findMany({
          where: {
            conversationId,
            codexThreadId: source.codexThreadId,
            sequenceNo: { lte: sourceTurn.sequenceNo },
          },
          orderBy: { sequenceNo: "asc" },
        });
        if (
          turns.length === 0 ||
          turns.at(-1)?.id !== sourceTurn.id ||
          turns.some(
            (turn) =>
              !TERMINAL_TURN_STATUSES.includes(
                turn.status as (typeof TERMINAL_TURN_STATUSES)[number],
              ),
          )
        ) {
          throw new AppError("CONFLICT");
        }
        const turnIds = turns.map((turn) => turn.id);
        const messages = await this.prisma.conversationMessage.findMany({
          where: {
            conversationId,
            sequenceNo: { lte: sourceMessage.sequenceNo },
          },
          orderBy: { sequenceNo: "asc" },
        });
        const messageIds = messages.map((message) => message.id);

        const [
          events,
          files,
          turnKnowledgeBases,
          planReviews,
          userInputRequests,
          citations,
        ] = await Promise.all([
          this.prisma.conversationEvent.findMany({
            where: {
              conversationId,
              createdAt: {
                lte:
                  sourceTurn.completedAt ??
                  sourceTurn.interruptedAt ??
                  sourceTurn.updatedAt,
              },
              OR: [{ turnId: null }, { turnId: { in: turnIds } }],
            },
            orderBy: { sequenceNo: "asc" },
          }),
          this.prisma.conversationFile.findMany({
            where: { conversationId, turnId: { in: turnIds } },
            orderBy: { createdAt: "asc" },
          }),
          this.prisma.conversationTurnKnowledgeBase.findMany({
            where: { turnId: { in: turnIds } },
            orderBy: [{ turnId: "asc" }, { selectionOrder: "asc" }],
          }),
          this.prisma.conversationPlanReview.findMany({
            where: {
              conversationId,
              sourceTurnId: { in: turnIds },
              planMessageId: { in: messageIds },
            },
            orderBy: { createdAt: "asc" },
          }),
          this.prisma.conversationUserInputRequest.findMany({
            where: { conversationId, turnId: { in: turnIds } },
            orderBy: { createdAt: "asc" },
          }),
          this.prisma.conversationMessageKnowledgeCitation.findMany({
            where: {
              conversationId,
              turnId: { in: turnIds },
              messageId: { in: messageIds },
            },
            orderBy: [{ messageId: "asc" }, { citationNo: "asc" }],
          }),
        ]);
        const citationIds = citations.map((citation) => citation.id);
        const citationAnchors =
          citationIds.length === 0
            ? []
            : await this.prisma.conversationMessageKnowledgeCitationAnchor.findMany(
                {
                  where: { citationId: { in: citationIds } },
                  orderBy: [
                    { messageId: "asc" },
                    { occurrenceNo: "asc" },
                  ],
                },
              );

        await this.preflight.ensureUserHome(ownerId);
        const runtime = await this.runner.prepareRuntime(
          forkConversationId,
          ownerId,
        );
        forkRuntimePrepared = true;
        const forkWorkspace = resolveConversationWorkspaceRoot(
          this.workspaceRoot,
          ownerId,
          forkConversationId,
        );
        await Promise.all(
          ["attachments", "artifacts", "temp"].map((directory) =>
            ensureSharedWorkspaceDirectory(
              forkWorkspace,
              join(forkWorkspace, directory),
            ),
          ),
        );
        await copyForkWorkspaceFiles({
          workspaceRoot: this.workspaceRoot,
          ownerId,
          sourceConversationId: conversationId,
          targetConversationId: forkConversationId,
          relativePaths: files.flatMap((file) =>
            file.workspaceRelativePath ? [file.workspaceRelativePath] : [],
          ),
        });

        const modelRuntime = await this.modelRuntimeForUser(
          ownerId,
          conversationId,
        );
        const forkedThread = await this.runner.forkThread({
          conversationId: forkConversationId,
          ownerId,
          expectedRuntimeGeneration: runtime.runtimeGeneration,
          sourceCodexThreadId: source.codexThreadId,
          throughCodexTurnId: sourceTurn.codexTurnId,
          projectionTurnId: crypto.randomUUID(),
          model: modelRuntime.model,
          reasoningEffort: modelRuntime.reasoningEffort,
          modelProvider: modelRuntime.provider,
        });
        const expectedCodexTurnIds = turns.map((turn) => turn.codexTurnId);
        if (
          !isValidForkedThreadHistory(
            forkedThread.codexTurnIds,
            expectedCodexTurnIds,
          )
        ) {
          throw new AppError("CONFLICT");
        }

        const turnIdMap = new Map(
          turns.map((turn) => [turn.id, crypto.randomUUID()]),
        );
        const messageIdMap = new Map(
          messages.map((message) => [message.id, crypto.randomUUID()]),
        );
        const eventIdMap = new Map(
          events.map((event) => [event.id, crypto.randomUUID()]),
        );
        const fileIdMap = new Map(
          files.map((file) => [file.id, crypto.randomUUID()]),
        );
        const planReviewIdMap = new Map(
          planReviews.map((review) => [review.id, crypto.randomUUID()]),
        );
        const userInputRequestIdMap = new Map(
          userInputRequests.map((request) => [request.id, crypto.randomUUID()]),
        );
        const citationIdMap = new Map(
          citations.map((citation) => [citation.id, crypto.randomUUID()]),
        );
        const replacements = new Map<string, string>([
          [conversationId, forkConversationId],
          [source.codexThreadId, forkedThread.codexThreadId],
          ...turnIdMap,
          ...messageIdMap,
          ...eventIdMap,
          ...fileIdMap,
          ...planReviewIdMap,
          ...userInputRequestIdMap,
          ...citationIdMap,
        ]);

        const created = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.conversation.findFirst({
            where: { ownerId, forkIdempotencyKey: idempotencyKey },
          });
          if (existing) {
            if (
              existing.forkSourceConversationId !== conversationId ||
              existing.forkSourceMessageId !== messageId
            ) {
              throw new AppError("CONFLICT");
            }
            return existing;
          }

          const rootConversationId = source.forkRootId ?? source.id;
          const baseTitle = forkBaseTitle(source.title, source.forkSequence);
          const counter = await tx.conversationForkCounter.upsert({
            where: { rootConversationId },
            create: {
              rootConversationId,
              ownerId,
              baseTitle,
              nextSequence: 3,
            },
            update: { nextSequence: { increment: 1 } },
          });
          const forkSequence = counter.nextSequence - 1;
          const forkedConversation = await tx.conversation.create({
            data: {
              id: forkConversationId,
              ownerId,
              title: forkedConversationTitle(counter.baseTitle, forkSequence),
              titleSource: "manual",
              archiveStatus: "active",
              pinnedAt: null,
              sortOrder: null,
              workspaceRelPath: conversationWorkspaceRelativePath(
                ownerId,
                forkConversationId,
              ),
              codexThreadId: forkedThread.codexThreadId,
              agentsTemplateVersion: runtime.agentsTemplateVersion,
              collaborationMode: source.collaborationMode,
              runtimeGeneration: runtime.runtimeGeneration,
              preferredModel: source.preferredModel,
              lastTurnStatus: sourceTurn.status,
              lastRunAt: sourceTurn.completedAt ?? sourceTurn.startedAt,
              completionUnread: false,
              selectedKnowledgeBaseIdsJson:
                sourceTurn.knowledgeBaseIdsJson as Prisma.InputJsonValue,
              applicationId: source.applicationId,
              applicationNameSnapshot: source.applicationNameSnapshot,
              interactiveApplicationPackageId:
                source.interactiveApplicationPackageId,
              forkRootId: rootConversationId,
              forkSequence,
              forkSourceConversationId: conversationId,
              forkSourceMessageId: messageId,
              forkIdempotencyKey: idempotencyKey,
            },
          });

          await tx.conversationTurn.createMany({
            data: turns.map((turn) => ({
              id: turnIdMap.get(turn.id)!,
              conversationId: forkConversationId,
              sequenceNo: turn.sequenceNo,
              submittedBy: turn.submittedBy,
              codexThreadId: forkedThread.codexThreadId,
              codexTurnId: turn.codexTurnId,
              status: turn.status,
              taskKind: turn.taskKind,
              collaborationMode: turn.collaborationMode,
              submitMode: turn.submitMode,
              idempotencyKey: null,
              idempotencyRequestHash: null,
              knowledgeBaseIdsJson:
                turn.knowledgeBaseIdsJson as Prisma.InputJsonValue,
              capabilityGeneration: turn.capabilityGeneration,
              capabilitiesJson: remapForkedJson(
                turn.capabilitiesJson,
                replacements,
              ) as Prisma.InputJsonValue,
              mcpGeneration: turn.mcpGeneration,
              mcpServersJson: remapForkedJson(
                turn.mcpServersJson,
                replacements,
              ) as Prisma.InputJsonValue,
              model: turn.model,
              reasoningEffort: turn.reasoningEffort,
              startedAt: turn.startedAt,
              completedAt: turn.completedAt,
              interruptRequestedAt: turn.interruptRequestedAt,
              interruptedAt: turn.interruptedAt,
              errorCode: turn.errorCode,
              errorMessage: turn.errorMessage,
              createdAt: turn.createdAt,
              updatedAt: turn.updatedAt,
            })),
          });
          await tx.conversationMessage.createMany({
            data: messages.map((message) => ({
              id: messageIdMap.get(message.id)!,
              conversationId: forkConversationId,
              turnId: message.turnId ? turnIdMap.get(message.turnId)! : null,
              sequenceNo: message.sequenceNo,
              role: message.role,
              contentText: message.contentText,
              createdAt: message.createdAt,
              updatedAt: message.updatedAt,
            })),
          });
          if (events.length > 0) {
            await tx.conversationEvent.createMany({
              data: events.map((event) => ({
                id: eventIdMap.get(event.id)!,
                conversationId: forkConversationId,
                turnId: event.turnId ? turnIdMap.get(event.turnId)! : null,
                sequenceNo: event.sequenceNo,
                eventType: event.eventType,
                visibility: event.visibility,
                payloadJson: remapForkedJson(
                  event.payloadJson,
                  replacements,
                ) as Prisma.InputJsonValue,
                sseEventId: `fork:${forkConversationId}:${event.sequenceNo}`,
                createdAt: event.createdAt,
              })),
            });
          }
          if (files.length > 0) {
            await tx.conversationFile.createMany({
              data: files.map((file) => ({
                id: fileIdMap.get(file.id)!,
                conversationId: forkConversationId,
                pendingRequestId: null,
                turnId: file.turnId ? turnIdMap.get(file.turnId)! : null,
                kind: file.kind,
                source: file.source,
                status: file.status,
                filename: file.filename,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                checksumSha256: file.checksumSha256,
                storageBackend: file.storageBackend,
                workspaceRelativePath: file.workspaceRelativePath,
                minioObjectKey: file.minioObjectKey,
                downloadable: file.downloadable,
                downloadCardEventId: file.downloadCardEventId
                  ? (eventIdMap.get(file.downloadCardEventId) ?? null)
                  : null,
                createdBy: file.createdBy,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
              })),
            });
          }
          if (turnKnowledgeBases.length > 0) {
            await tx.conversationTurnKnowledgeBase.createMany({
              data: turnKnowledgeBases.map((selection) => ({
                id: crypto.randomUUID(),
                turnId: turnIdMap.get(selection.turnId)!,
                knowledgeBaseId: selection.knowledgeBaseId,
                selectionOrder: selection.selectionOrder,
                createdAt: selection.createdAt,
              })),
            });
          }
          if (planReviews.length > 0) {
            await tx.conversationPlanReview.createMany({
              data: planReviews.map((review) => {
                const followUpTurnId = review.followUpTurnId
                  ? (turnIdMap.get(review.followUpTurnId) ?? null)
                  : null;
                return {
                  id: planReviewIdMap.get(review.id)!,
                  conversationId: forkConversationId,
                  ownerId,
                  sourceTurnId: turnIdMap.get(review.sourceTurnId)!,
                  planMessageId: messageIdMap.get(review.planMessageId)!,
                  codexItemId: review.codexItemId,
                  status:
                    review.followUpTurnId && !followUpTurnId
                      ? "pending"
                      : review.status,
                  decision:
                    review.followUpTurnId && !followUpTurnId
                      ? null
                      : review.decision,
                  followUpTurnId,
                  resolvedAt:
                    review.followUpTurnId && !followUpTurnId
                      ? null
                      : review.resolvedAt,
                  createdAt: review.createdAt,
                  updatedAt: review.updatedAt,
                };
              }),
            });
          }
          if (userInputRequests.length > 0) {
            await tx.conversationUserInputRequest.createMany({
              data: userInputRequests.map((request) => ({
                id: userInputRequestIdMap.get(request.id)!,
                conversationId: forkConversationId,
                turnId: turnIdMap.get(request.turnId)!,
                ownerId,
                codexThreadId: forkedThread.codexThreadId,
                codexTurnId: request.codexTurnId,
                codexItemId: request.codexItemId,
                nativeRequestId: request.nativeRequestId,
                requestKind: request.requestKind,
                questionsJson: remapForkedJson(
                  request.questionsJson,
                  replacements,
                ) as Prisma.InputJsonValue,
                serverName: request.serverName,
                messageText: request.messageText,
                formSchemaJson: request.formSchemaJson
                  ? (remapForkedJson(
                      request.formSchemaJson,
                      replacements,
                    ) as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                formUiHintsJson: request.formUiHintsJson
                  ? (remapForkedJson(
                      request.formUiHintsJson,
                      replacements,
                    ) as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                formResponseSemanticsJson: request.formResponseSemanticsJson
                  ? (remapForkedJson(
                      request.formResponseSemanticsJson,
                      replacements,
                    ) as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                responseContentJson: request.responseContentJson
                  ? (remapForkedJson(
                      request.responseContentJson,
                      replacements,
                    ) as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                status: request.status,
                autoResolveAt: request.autoResolveAt,
                resolvedAction: request.resolvedAction,
                resolvedAt: request.resolvedAt,
                createdAt: request.createdAt,
                updatedAt: request.updatedAt,
              })),
            });
          }
          if (citations.length > 0) {
            await tx.conversationMessageKnowledgeCitation.createMany({
              data: citations.map((citation) => ({
                id: citationIdMap.get(citation.id)!,
                conversationId: forkConversationId,
                turnId: turnIdMap.get(citation.turnId)!,
                messageId: messageIdMap.get(citation.messageId)!,
                knowledgeBaseId: citation.knowledgeBaseId,
                documentId: citation.documentId,
                documentVersionId: citation.documentVersionId,
                knowledgeBaseNameSnapshot:
                  citation.knowledgeBaseNameSnapshot,
                documentNameSnapshot: citation.documentNameSnapshot,
                parentId: citation.parentId,
                citationNo: citation.citationNo,
                titlePath: citation.titlePath,
                matchedChildIds: citation.matchedChildIds,
                pageNumbers: citation.pageNumbers,
                createdAt: citation.createdAt,
                updatedAt: citation.updatedAt,
              })),
            });
          }
          if (citationAnchors.length > 0) {
            await tx.conversationMessageKnowledgeCitationAnchor.createMany({
              data: citationAnchors.map((anchor) => ({
                id: crypto.randomUUID(),
                messageId: messageIdMap.get(anchor.messageId)!,
                citationId: citationIdMap.get(anchor.citationId)!,
                occurrenceNo: anchor.occurrenceNo,
                anchorAfterOffsetUtf16: anchor.anchorAfterOffsetUtf16,
                createdAt: anchor.createdAt,
                updatedAt: anchor.updatedAt,
              })),
            });
          }
          await tx.usageActivityRecord.create({
            data: {
              activityType: "task_created",
              sourceId: forkedConversation.id,
              ownerId,
              conversationId: forkedConversation.id,
              applicationId: forkedConversation.applicationId,
              applicationNameSnapshot:
                forkedConversation.applicationNameSnapshot,
              occurredAt: forkedConversation.createdAt,
            },
          });
          return forkedConversation;
        });
        forkRuntimePrepared = false;

        await this.audit
          .write({
            ...context,
            actorId: ownerId,
            action: "conversation_forked",
            targetType: "conversation",
            targetId: created.id,
            result: "success",
            metadata: {
              source_conversation_id: conversationId,
              source_message_id: messageId,
              fork_sequence: created.forkSequence,
            },
          })
          .catch(() => undefined);
        return projectConversation(created, created.lastTurnStatus ?? "idle");
      } catch (error) {
        if (forkRuntimePrepared) {
          await this.cleanup
            .enqueueRuntimeCleanup(ownerId, forkConversationId)
            .catch(() => undefined);
        }
        throw error;
      } finally {
        await this.redis
          .releaseConversationLock(conversationId, lock)
          .catch(() => undefined);
      }
    });
  }

  async createApplicationConversation(
    ownerId: string,
    application: {
      id: string;
      name: string;
      kind: "standard" | "interactive";
      interactivePackageId: string | null;
    },
  ) {
    return this.withActiveUserLifecycleLock(ownerId, () =>
      this.createConversation(ownerId, undefined, application),
    );
  }

  async createExternalApplicationConversation(
    ownerId: string,
    application: {
      id: string;
      name: string;
      kind: "standard" | "interactive";
      interactivePackageId: string | null;
    },
  ) {
    return this.withActiveUserLifecycleLock(ownerId, () =>
      this.createConversation(ownerId, undefined, application, {
        autoGenerateTitle: true,
      }),
    );
  }

  async createPinnedConversation(
    ownerId: string,
    title: string,
    fallbackLocale?: Locale,
  ) {
    return this.withActiveUserLifecycleLock(ownerId, () =>
      this.createConversation(ownerId, fallbackLocale, undefined, {
        title,
        pinned: true,
      }),
    );
  }

  private async createConversation(
    ownerId: string,
    fallbackLocale?: Locale,
    application?: {
      id: string;
      name: string;
      kind: "standard" | "interactive";
      interactivePackageId: string | null;
    },
    options?: {
      title?: string;
      pinned?: boolean;
      collaborationMode?: ConversationCollaborationMode;
      autoGenerateTitle?: boolean;
    },
    prewarmedConversationId?: string,
  ) {
    let id = prewarmedConversationId ?? crypto.randomUUID();
    try {
      let prewarmedRuntime = null;
      if (prewarmedConversationId) {
        const collision = await this.prisma.conversation.findUnique({
          where: { id: prewarmedConversationId },
          select: { id: true },
        });
        if (collision) {
          id = crypto.randomUUID();
        } else {
          prewarmedRuntime = await this.runner
            .inspectPrewarmedConversation(id, ownerId)
            .catch(() => null);
        }
      }
      let runtime: Awaited<ReturnType<RunnerClient["prepareRuntime"]>>;
      if (prewarmedRuntime) {
        runtime = prewarmedRuntime;
      } else {
        const reservedRuntime = prewarmedConversationId
          ? await this.waitForReservedRuntime(id, ownerId)
          : null;
        if (reservedRuntime) {
          runtime = reservedRuntime;
        } else {
          // The hot resolve validates the durable capability publication and
          // falls back to a full repair only when its markers are stale. This
          // keeps an immediate first send from repeating the expensive full
          // HOME scan already performed by capability mutations or prewarm.
          await this.preflight.resolve({
            userId: ownerId,
            priorityCapabilityIds: [],
          });
          runtime = await this.runner.prepareRuntime(id, ownerId);
        }
      }
      const workspace = resolveConversationWorkspaceRoot(
        this.workspaceRoot,
        ownerId,
        id,
      );
      await Promise.all(
        ["attachments", "artifacts", "temp"].map((directory) =>
          ensureSharedWorkspaceDirectory(
            workspace,
            join(workspace, directory),
          ),
        ),
      );
      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { preferredLocale: true },
      });
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.conversation.create({
          data: {
            id,
            ownerId,
            title:
              options?.title ??
              (application && !options?.autoGenerateTitle
                ? application.name
                : undefined) ??
              ((owner?.preferredLocale ?? fallbackLocale) === "en-US"
                ? "Untitled task"
                : "未命名任务"),
            titleSource:
              options?.title || (application && !options?.autoGenerateTitle)
                ? "manual"
                : "fallback",
            archiveStatus: "active",
            pinnedAt: options?.pinned ? new Date() : null,
            workspaceRelPath: conversationWorkspaceRelativePath(ownerId, id),
            agentsTemplateVersion: runtime.agentsTemplateVersion,
            collaborationMode: options?.collaborationMode ?? "default",
            runtimeGeneration: runtime.runtimeGeneration,
            codexThreadId: prewarmedRuntime?.codexThreadId ?? null,
            applicationId: application?.id ?? null,
            applicationNameSnapshot: application?.name ?? null,
            interactiveApplicationPackageId:
              application?.kind === "interactive"
                ? application.interactivePackageId
                : null,
          },
        });
        await tx.usageActivityRecord.create({
          data: {
            activityType: "task_created",
            sourceId: created.id,
            ownerId: created.ownerId,
            conversationId: created.id,
            applicationId: created.applicationId,
            applicationNameSnapshot: created.applicationNameSnapshot,
            occurredAt: created.createdAt,
          },
        });
        return created;
      });
    } catch (error) {
      await this.cleanup
        .enqueueRuntimeCleanup(ownerId, id)
        .catch(() => undefined);
      throw error;
    }
  }

  private async waitForReservedRuntime(
    conversationId: string,
    ownerId: string,
  ): Promise<Awaited<ReturnType<RunnerClient["inspectRuntime"]>>> {
    const deadline = Date.now() + RESERVED_RUNTIME_CLAIM_WINDOW_MILLISECONDS;
    do {
      const runtime = await this.runner
        .inspectRuntime(conversationId, ownerId)
        .catch(() => null);
      if (runtime) return runtime;
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          resolve,
          RESERVED_RUNTIME_CLAIM_POLL_MILLISECONDS,
        );
        timer.unref();
      });
    } while (Date.now() < deadline);
    return null;
  }

  private async prepareOfficeAnnotation(
    conversationId: string,
    annotation: OfficeAnnotationInput,
  ): Promise<{
    inputText: string;
    display: UserMessageDisplay;
  }> {
    const file = await this.prisma.conversationFile.findFirst({
      where: { id: annotation.file_id, conversationId },
      select: { filename: true, mimeType: true },
    });
    if (!file || !matchesAnnotationFile(annotation.kind, file)) {
      throw new AppError("VALIDATION_ERROR");
    }
    assertOfficeAnnotationSemantics(annotation);

    const display = buildOfficeAnnotationDisplay(annotation, file.filename);
    return {
      inputText: buildOfficeAnnotationPrompt(annotation, display),
      display,
    };
  }

  private async ensureUserMessageDisplaySidecar(
    conversationId: string,
    turnId: string,
    messageId: string,
    display: UserMessageDisplay,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversationEvent.findMany({
        where: {
          conversationId,
          turnId,
          eventType: USER_MESSAGE_DISPLAY_EVENT_TYPE,
          visibility: "internal_sanitized",
        },
        orderBy: { sequenceNo: "desc" },
      });
      const payload = {
        schema_version: 1 as const,
        message_id: messageId,
        display,
      };
      const alreadyStored = existing.some((event) => {
        const parsed = userMessageDisplayEventPayloadSchema.safeParse(
          event.payloadJson,
        );
        return (
          parsed.success &&
          parsed.data.message_id === messageId &&
          JSON.stringify(parsed.data.display) === JSON.stringify(display)
        );
      });
      if (alreadyStored) {
        return;
      }
      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      await tx.conversationEvent.create({
        data: {
          conversationId,
          turnId,
          sequenceNo,
          eventType: USER_MESSAGE_DISPLAY_EVENT_TYPE,
          visibility: "internal_sanitized",
          payloadJson: payload,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
    });
  }

  private async createStartIntentWithResourceLease(input: {
    projectionTurnId: string;
    ownerId: string;
    conversationId: string;
    expectedRuntimeGeneration: string;
    capabilityGeneration: string;
    mcpGeneration: string;
    modelRuntime: ResolvedModelRuntime;
    applicationRuntime: ApplicationTurnConfiguration | null;
    expectedCodexThreadId: string | null;
    prepared: PreparedTurnSubmission;
    preservesStagedAttachments: boolean;
    pendingRequestId: string | null;
    regeneration: RegenerationSource | null;
    attachments: TurnStartIntentAttachment[];
    capabilities: TurnStartIntent["capabilitiesJson"];
    mcpServers: TurnStartIntent["mcpServersJson"];
    credentialUsageReceipts: TurnStartIntent["credentialUsageReceiptsJson"];
    mcpCredentialUsageReceipts: TurnStartIntent["mcpCredentialUsageReceiptsJson"];
    audit: AuditContext;
    planReviewAction: PlanReviewTurnAction | null;
  }): Promise<TurnStartIntent> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${input.ownerId}::uuid FOR UPDATE
      `;
      const owner = await tx.user.findUnique({
        where: { id: input.ownerId },
        select: { status: true },
      });
      if (owner?.status !== "active") throw new AppError("USER_DISABLED");

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM conversations
        WHERE id = ${input.conversationId}::uuid
        FOR UPDATE
      `;
      const [conversation, cleanup, activeIntent, pendingPlanReview] =
        await Promise.all([
        tx.conversation.findUnique({
          where: { id: input.conversationId },
        }),
        tx.runtimeCleanupOutbox.findUnique({
          where: { conversationId: input.conversationId },
          select: { id: true },
        }),
        tx.conversationTurnStartIntent.findUnique({
          where: { conversationId: input.conversationId },
        }),
        tx.conversationPlanReview.findFirst({
          where: {
            conversationId: input.conversationId,
            status: { in: ["preparing", "pending"] },
          },
        }),
      ]);
      const implementsPendingPlan =
        input.planReviewAction?.action === "implement" &&
        conversation?.collaborationMode === "plan" &&
        input.prepared.collaborationMode === "default";
      if (
        !conversation ||
        conversation.ownerId !== input.ownerId ||
        conversation.runtimeGeneration !== input.expectedRuntimeGeneration ||
        conversation.codexThreadId !== input.expectedCodexThreadId ||
        (conversation.collaborationMode !== input.prepared.collaborationMode &&
          !implementsPendingPlan) ||
        cleanup
      ) {
        throw new AppError("CONFLICT");
      }
      if (input.planReviewAction) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_plan_reviews
          WHERE id = ${input.planReviewAction.reviewId}::uuid
          FOR UPDATE
        `;
        const [planReview, sourceTurn, latestTurn, planMessage, pendingCount] =
          await Promise.all([
            tx.conversationPlanReview.findUnique({
              where: { id: input.planReviewAction.reviewId },
            }),
            tx.conversationTurn.findUnique({
              where: { id: pendingPlanReview?.sourceTurnId ?? crypto.randomUUID() },
            }),
            tx.conversationTurn.findFirst({
              where: {
                conversationId: input.conversationId,
                ...(conversation.codexThreadId
                  ? { codexThreadId: conversation.codexThreadId }
                  : {}),
              },
              orderBy: { sequenceNo: "desc" },
            }),
            tx.conversationMessage.findUnique({
              where: {
                id: pendingPlanReview?.planMessageId ?? crypto.randomUUID(),
              },
            }),
            tx.pendingRequest.count({
              where: { conversationId: input.conversationId },
            }),
          ]);
        const expectedMode =
          input.planReviewAction.action === "implement" ? "default" : "plan";
        const expectedInput =
          input.planReviewAction.action === "implement"
            ? PLAN_IMPLEMENTATION_INPUT
            : input.prepared.inputText.trim();
        if (
          !planReview ||
          planReview.id !== pendingPlanReview?.id ||
          planReview.conversationId !== input.conversationId ||
          planReview.ownerId !== input.ownerId ||
          planReview.status !== "pending" ||
          !sourceTurn ||
          sourceTurn.id !== planReview.sourceTurnId ||
          sourceTurn.id !== latestTurn?.id ||
          sourceTurn.status !== "completed" ||
          sourceTurn.collaborationMode !== "plan" ||
          sourceTurn.codexThreadId !== conversation.codexThreadId ||
          !planMessage ||
          planMessage.id !== planReview.planMessageId ||
          planMessage.conversationId !== input.conversationId ||
          planMessage.turnId !== sourceTurn.id ||
          planMessage.role !== "assistant" ||
          input.prepared.goal ||
          input.prepared.collaborationMode !== expectedMode ||
          input.prepared.inputText.trim() !== expectedInput ||
          !input.preservesStagedAttachments ||
          input.pendingRequestId ||
          input.regeneration ||
          pendingCount > 0
        ) {
          throw new AppError("PLAN_REVIEW_UNAVAILABLE");
        }
      } else if (pendingPlanReview) {
        throw new AppError("PLAN_REVIEW_PENDING");
      }
      if (input.applicationRuntime) {
        if (
          conversation.applicationId !== input.applicationRuntime.applicationId
        ) {
          throw new AppError("CONFLICT");
        }
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM applications
          WHERE id = ${input.applicationRuntime.applicationId}::uuid
          FOR SHARE
        `;
        const [application, capabilityBindings, knowledgeBindings, mcpBindings] =
          await Promise.all([
            tx.application.findFirst({
              where: {
                id: input.applicationRuntime.applicationId,
                ownerId: input.applicationRuntime.applicationOwnerId,
                status: "active",
                updatedAt: input.applicationRuntime.applicationUpdatedAt,
              },
            }),
            tx.applicationCapability.findMany({
              where: { applicationId: input.applicationRuntime.applicationId },
              orderBy: { selectionOrder: "asc" },
              select: { capabilityId: true },
            }),
            tx.applicationKnowledgeBase.findMany({
              where: { applicationId: input.applicationRuntime.applicationId },
              orderBy: { selectionOrder: "asc" },
              select: { knowledgeBaseId: true },
            }),
            tx.applicationMcpServer.findMany({
              where: { applicationId: input.applicationRuntime.applicationId },
              orderBy: { selectionOrder: "asc" },
              select: { mcpServerId: true },
            }),
          ]);
        if (
          !application ||
          (input.applicationRuntime.kind === "standard" &&
            application.instructions !== input.applicationRuntime.instructions) ||
          (input.applicationRuntime.kind === "interactive" &&
            application.kind !== "interactive") ||
          application.model !== input.applicationRuntime.model ||
          application.reasoningEffort !==
            input.applicationRuntime.reasoningEffort ||
          (input.applicationRuntime.kind === "standard" &&
            (JSON.stringify(
              capabilityBindings.map((binding) => binding.capabilityId),
            ) !== JSON.stringify(input.applicationRuntime.capabilityIds) ||
              JSON.stringify(
                knowledgeBindings.map((binding) => binding.knowledgeBaseId),
              ) !== JSON.stringify(input.applicationRuntime.knowledgeBaseIds) ||
              JSON.stringify(mcpBindings.map((binding) => binding.mcpServerId)) !==
                JSON.stringify(input.applicationRuntime.mcpServerIds)))
        ) {
          throw new AppError("CONFLICT");
        }
        if (application.ownerId !== input.ownerId) {
          const externalSession =
            await tx.applicationExternalSession.findFirst({
              where: {
                applicationId: application.id,
                runtimePrincipalId: input.ownerId,
                status: "active",
                absoluteExpiresAt: { gt: new Date() },
              },
              select: { externalAccessId: true },
            });
          const externalAccess = externalSession
            ? await tx.applicationExternalAccess.findFirst({
                where: {
                  id: externalSession.externalAccessId,
                  applicationId: application.id,
                  enabled: true,
                },
                select: { id: true },
              })
            : null;
          if (!externalAccess) {
            const groupIds = (
              await tx.userGroupMember.findMany({
                where: { userId: input.ownerId, status: "active" },
                select: { userGroupId: true },
              })
            ).map((membership) => membership.userGroupId);
            const grant = await tx.applicationGrant.findFirst({
              where: {
                applicationId: application.id,
                status: "active",
                OR: [
                  { granteeType: "user", userId: input.ownerId },
                  ...(groupIds.length > 0
                    ? [
                        {
                          granteeType: "user_group",
                          userGroupId: { in: groupIds },
                        },
                      ]
                    : []),
                ],
              },
              select: { id: true },
            });
            if (!grant) throw new AppError("APPLICATION_NOT_FOUND");
          }
        }
      } else if (conversation.applicationId != null) {
        throw new AppError("CONFLICT");
      }
      if (activeIntent) {
        const active = parseTurnStartIntent(activeIntent);
        if (
          active.projectionTurnId === input.projectionTurnId &&
          matchesStartIntentSubmission(active, {
            ownerId: input.ownerId,
            conversationId: input.conversationId,
            input: input.prepared,
            preservesStagedAttachments: input.preservesStagedAttachments,
            files: input.attachments,
            ...(input.pendingRequestId
              ? { pendingId: input.pendingRequestId }
              : {}),
            ...(input.regeneration ? { regeneration: input.regeneration } : {}),
            ...(input.planReviewAction
              ? { planReviewAction: input.planReviewAction }
              : {}),
          })
        ) {
          throw new RunnerStartOperationUncertainError();
        }
        throw new AppError("CONFLICT");
      }
      if (input.prepared.goal) {
        const existingGoal = await tx.conversationGoal.findUnique({
          where: { conversationId: input.conversationId },
        });
        if (input.prepared.goal.resumeExisting) {
          if (
            !existingGoal ||
            existingGoal.ownerId !== input.ownerId ||
            existingGoal.objective !== input.prepared.goal.objective ||
            ![
              "paused",
              "blocked",
              "usageLimited",
              "budgetLimited",
            ].includes(existingGoal.status)
          ) {
            throw new AppError("CONFLICT");
          }
        } else if (existingGoal && existingGoal.status !== "complete") {
          throw new AppError("CONFLICT");
        }
      } else if (input.prepared.collaborationMode === "plan") {
        const existingGoal = await tx.conversationGoal.findUnique({
          where: { conversationId: input.conversationId },
        });
        if (existingGoal && existingGoal.status !== "complete") {
          throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
        }
      }
      const running = await tx.conversationTurn.count({
        where: {
          conversationId: input.conversationId,
          status: "running",
          ...(conversation.codexThreadId
            ? { codexThreadId: conversation.codexThreadId }
            : {}),
        },
      });
      if (running > 0) throw new AppError("CONFLICT");

      if (input.pendingRequestId) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM pending_requests
          WHERE id = ${input.pendingRequestId}::uuid
          FOR UPDATE
        `;
        const [pending, head] = await Promise.all([
          tx.pendingRequest.findFirst({
            where: {
              id: input.pendingRequestId,
              conversationId: input.conversationId,
              submittedBy: input.ownerId,
            },
          }),
          tx.pendingRequest.findFirst({
            where: { conversationId: input.conversationId },
            orderBy: { queueNo: "asc" },
          }),
        ]);
        if (
          !pending ||
          head?.id !== pending.id ||
          ![
            "waiting_previous_turn",
            "blocked_overload",
            "blocked_preflight",
          ].includes(pending.status) ||
          pending.inputText !== input.prepared.inputText ||
          pending.idempotencyKey !== (input.prepared.idempotencyKey ?? null) ||
          (!input.applicationRuntime &&
            (JSON.stringify(
              jsonStringArray(pending.priorityCapabilityIdsJson),
            ) !== JSON.stringify(input.prepared.priorityCapabilityIds) ||
              JSON.stringify(jsonStringArray(pending.knowledgeBaseIdsJson)) !==
                JSON.stringify(input.prepared.knowledgeBaseIds)))
        ) {
          throw new AppError("CONFLICT");
        }
      } else if (input.regeneration) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_turns
          WHERE id = ${input.regeneration.turnId}::uuid
          FOR UPDATE
        `;
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_messages
          WHERE id = ${input.regeneration.messageId}::uuid
          FOR UPDATE
        `;
        const [sourceTurn, sourceMessage, latestTurn] = await Promise.all([
          tx.conversationTurn.findUnique({
            where: { id: input.regeneration.turnId },
          }),
          tx.conversationMessage.findUnique({
            where: { id: input.regeneration.messageId },
          }),
          tx.conversationTurn.findFirst({
            where: {
              conversationId: input.conversationId,
              codexThreadId: input.regeneration.codexThreadId,
            },
            orderBy: { sequenceNo: "desc" },
          }),
        ]);
        if (
          !sourceTurn ||
          sourceTurn.id !== latestTurn?.id ||
          sourceTurn.conversationId !== input.conversationId ||
          sourceTurn.sequenceNo !== input.regeneration.turnSequenceNo ||
          sourceTurn.codexThreadId !== input.regeneration.codexThreadId ||
          sourceTurn.codexTurnId !== input.regeneration.codexTurnId ||
          (!input.applicationRuntime &&
            JSON.stringify(jsonStringArray(sourceTurn.knowledgeBaseIdsJson)) !==
              JSON.stringify(input.prepared.knowledgeBaseIds)) ||
          !TERMINAL_TURN_STATUSES.includes(
            sourceTurn.status as (typeof TERMINAL_TURN_STATUSES)[number],
          ) ||
          !sourceMessage ||
          sourceMessage.conversationId !== input.conversationId ||
          sourceMessage.turnId !== sourceTurn.id ||
          sourceMessage.role !== "user"
        ) {
          throw new AppError("CONFLICT");
        }
      }

      const sourceWhere = input.regeneration
        ? {
            conversationId: input.conversationId,
            turnId: input.regeneration.turnId,
            kind: "attachment",
            status: "bound",
          }
        : input.pendingRequestId
          ? {
              conversationId: input.conversationId,
              pendingRequestId: input.pendingRequestId,
              turnId: null,
              kind: "attachment",
              status: "pending",
            }
          : !input.preservesStagedAttachments
            ? {
                conversationId: input.conversationId,
                pendingRequestId: null,
                turnId: null,
                kind: "attachment",
                status: "staged",
              }
            : null;
      let currentAttachments: Array<{
        id: string;
        kind: string;
        source: string;
        filename: string;
        mimeType: string | null;
        sizeBytes: bigint;
        checksumSha256: string | null;
        storageBackend: string;
        workspaceRelativePath: string | null;
        minioObjectKey: string | null;
        downloadable: boolean;
        createdBy: string | null;
      }> = [];
      if (sourceWhere) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM conversation_files
          WHERE conversation_id = ${input.conversationId}::uuid
            AND kind = 'attachment'
            AND ${
              input.regeneration
                ? Prisma.sql`turn_id = ${input.regeneration.turnId}::uuid AND status = 'bound'`
                : input.pendingRequestId
                  ? Prisma.sql`pending_request_id = ${input.pendingRequestId}::uuid AND turn_id IS NULL AND status = 'pending'`
                  : Prisma.sql`pending_request_id IS NULL AND turn_id IS NULL AND status = 'staged'`
            }
          ORDER BY id
          FOR UPDATE
        `);
        currentAttachments = await tx.conversationFile.findMany({
          where: sourceWhere,
          orderBy: { id: "asc" },
        });
      }
      if (!matchesAttachmentSnapshot(input.attachments, currentAttachments)) {
        throw new AppError("ATTACHMENT_UPLOAD_INVALID");
      }

      if (input.prepared.messageDisplay) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_files
          WHERE id = ${input.prepared.messageDisplay.file_id}::uuid
          FOR UPDATE
        `;
        const annotationFile = await tx.conversationFile.findFirst({
          where: {
            id: input.prepared.messageDisplay.file_id,
            conversationId: input.conversationId,
          },
          select: { filename: true, mimeType: true },
        });
        if (
          !annotationFile ||
          annotationFile.filename !== input.prepared.messageDisplay.file_name ||
          !matchesAnnotationFile(
            input.prepared.messageDisplay.kind,
            annotationFile,
          )
        ) {
          throw new AppError("VALIDATION_ERROR");
        }
      }

      return parseTurnStartIntent(
        await tx.conversationTurnStartIntent.create({
          data: {
            projectionTurnId: input.projectionTurnId,
            ownerId: input.ownerId,
            conversationId: input.conversationId,
            runtimeGeneration: input.expectedRuntimeGeneration,
            capabilityGeneration: input.capabilityGeneration,
            mcpGeneration: input.mcpGeneration,
            model: input.modelRuntime.model,
            reasoningEffort: input.modelRuntime.reasoningEffort,
            applicationId: input.applicationRuntime?.applicationId ?? null,
            applicationUpdatedAt:
              input.applicationRuntime?.applicationUpdatedAt ?? null,
            applicationInstructions:
              input.applicationRuntime?.instructions ?? null,
            inputText: input.prepared.inputText,
            taskKind: input.prepared.goal ? "goal" : "turn",
            collaborationMode: input.prepared.collaborationMode,
            goalObjective: input.prepared.goal?.objective ?? null,
            goalTokenBudget:
              input.prepared.goal?.tokenBudget === undefined ||
              input.prepared.goal.tokenBudget === null
                ? null
                : BigInt(input.prepared.goal.tokenBudget),
            priorityCapabilityIdsJson: input.prepared.priorityCapabilityIds,
            knowledgeBaseIdsJson: input.prepared.knowledgeBaseIds,
            capabilitiesJson: input.capabilities,
            mcpServersJson: input.mcpServers,
            credentialUsageReceiptsJson: input.credentialUsageReceipts,
            mcpCredentialUsageReceiptsJson: input.mcpCredentialUsageReceipts,
            attachmentsJson: input.attachments,
            messageDisplayJson: input.prepared.messageDisplay ?? Prisma.DbNull,
            submitMode: input.prepared.submitMode,
            idempotencyKey: input.prepared.idempotencyKey ?? null,
            preservesStagedAttachments: input.preservesStagedAttachments,
            pendingRequestId: input.pendingRequestId,
            planReviewId: input.planReviewAction?.reviewId ?? null,
            planReviewAction: input.planReviewAction?.action ?? null,
            regenerationJson: input.regeneration ?? Prisma.DbNull,
            auditIpAddress: input.audit.ipAddress ?? null,
            auditUserAgent: input.audit.userAgent ?? null,
            runnerStatus: "slot_pending",
          },
        }),
      );
    });
  }

  private async markStartIntentSlotAcquired(
    intent: TurnStartIntent,
  ): Promise<TurnStartIntent> {
    const updated = await this.prisma.conversationTurnStartIntent.updateMany({
      where: {
        projectionTurnId: intent.projectionTurnId,
        ownerId: intent.ownerId,
        conversationId: intent.conversationId,
        runtimeGeneration: intent.runtimeGeneration,
        runnerStatus: "slot_pending",
      },
      data: { runnerStatus: "prepared" },
    });
    if (updated.count !== 1) throw new AppError("CONFLICT");
    const stored = await this.prisma.conversationTurnStartIntent.findUnique({
      where: { projectionTurnId: intent.projectionTurnId },
    });
    const prepared = stored ? parseTurnStartIntent(stored) : null;
    if (
      !prepared ||
      prepared.ownerId !== intent.ownerId ||
      prepared.conversationId !== intent.conversationId ||
      prepared.runtimeGeneration !== intent.runtimeGeneration ||
      prepared.runnerStatus !== "prepared"
    ) {
      throw new AppError("CONFLICT");
    }
    return prepared;
  }

  private async recordSucceededStartIntent(
    intent: TurnStartIntent,
    startedTurn: StartedRunnerTurn,
  ): Promise<TurnStartIntent> {
    await this.prisma.conversationTurnStartIntent.updateMany({
      where: {
        projectionTurnId: intent.projectionTurnId,
        ownerId: intent.ownerId,
        conversationId: intent.conversationId,
        runtimeGeneration: intent.runtimeGeneration,
        runnerStatus: "prepared",
      },
      data: {
        runnerStatus: "runner_succeeded",
        codexThreadId: startedTurn.codexThreadId,
        codexTurnId: startedTurn.codexTurnId,
      },
    });
    const stored = await this.prisma.conversationTurnStartIntent.findUnique({
      where: { projectionTurnId: intent.projectionTurnId },
    });
    const succeeded = stored ? parseTurnStartIntent(stored) : null;
    if (
      !succeeded ||
      succeeded.ownerId !== intent.ownerId ||
      succeeded.conversationId !== intent.conversationId ||
      succeeded.runtimeGeneration !== intent.runtimeGeneration ||
      succeeded.runnerStatus !== "runner_succeeded" ||
      succeeded.codexThreadId !== startedTurn.codexThreadId ||
      succeeded.codexTurnId !== startedTurn.codexTurnId
    ) {
      throw new AppError("CONFLICT");
    }
    return succeeded;
  }

  private async startedTurnForSucceededIntent(
    intent: TurnStartIntent,
  ): Promise<StartedRunnerTurn> {
    if (!intent.codexThreadId || !intent.codexTurnId) {
      throw new AppError("CONFLICT");
    }
    const fallback = {
      codexThreadId: intent.codexThreadId,
      codexTurnId: intent.codexTurnId,
    };
    if (intent.taskKind !== "goal") return fallback;
    const operation = await this.runner.inspectStartOperation(
      intent.conversationId,
      intent.projectionTurnId,
      intent.ownerId,
    );
    assertMatchingStartOperation(intent, operation);
    if (
      operation?.status === "succeeded" &&
      operation.result.codexThreadId === intent.codexThreadId &&
      operation.result.codexTurnId === intent.codexTurnId &&
      operation.result.goal
    ) {
      return operation.result;
    }
    throw new RunnerStartOperationUncertainError();
  }

  private async publishStartProjection(
    intent: TurnStartIntent,
    startedTurn: StartedRunnerTurn,
  ) {
    const projection = await this.persistStartProjection(intent, startedTurn);
    await this.publishAttachedStartEvents(intent.conversationId, projection);
    return projection;
  }

  private async publishAttachedStartEvents(
    conversationId: string,
    projection: TurnStartProjectionResult,
  ): Promise<void> {
    for (const event of projection.attachedEvents) {
      await this.redis
        .publishConversationEvent(conversationId, projectStoredEvent(event))
        .catch(() => undefined);
    }
  }

  private async persistStartProjection(
    intent: TurnStartIntent,
    startedTurn: StartedRunnerTurn,
  ): Promise<TurnStartProjectionResult> {
    const startedGoal = goalSnapshotForStart(intent, startedTurn);
    const isCompact = intent.taskKind === "compact";
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.conversationTurnStartIntent.updateMany({
        where: {
          projectionTurnId: intent.projectionTurnId,
          ownerId: intent.ownerId,
          conversationId: intent.conversationId,
          runtimeGeneration: intent.runtimeGeneration,
          runnerStatus: "runner_succeeded",
          codexThreadId: startedTurn.codexThreadId,
          codexTurnId: startedTurn.codexTurnId,
          knowledgeBaseIdsJson: { equals: intent.knowledgeBaseIdsJson },
        },
        data: { runnerStatus: "runner_succeeded" },
      });
      if (claimed.count !== 1) {
        const existing = await tx.conversationTurn.findUnique({
          where: { id: intent.projectionTurnId },
        });
        if (
          existing?.conversationId === intent.conversationId &&
          existing.submittedBy === intent.ownerId &&
          existing.codexThreadId === startedTurn.codexThreadId &&
          existing.codexTurnId === startedTurn.codexTurnId &&
          existing.idempotencyRequestHash ===
            (intent.idempotencyKey
              ? turnStartIntentIdempotencyRequestHash(intent)
              : null)
        ) {
          if (intent.planReviewId && intent.planReviewAction) {
            const review = await tx.conversationPlanReview.findUnique({
              where: { id: intent.planReviewId },
            });
            if (
              !review ||
              review.status !== "resolved" ||
              review.decision !== intent.planReviewAction ||
              review.followUpTurnId !== existing.id
            ) {
              throw new AppError("PLAN_REVIEW_UNAVAILABLE");
            }
          }
          await recordTurnStartedActivity(tx, existing);
          if (!isCompact) {
            await recordSelectedSkillUsageActivity(tx, intent, {
              id: existing.id,
              startedAt: existing.startedAt,
            });
          }
          return { created: existing, attachedEvents: [] };
        }
        throw new AppError("CONFLICT");
      }

      const activeConversation = await tx.conversation.findUnique({
        where: { id: intent.conversationId },
        select: { codexThreadId: true, collaborationMode: true },
      });
      if (!activeConversation) throw new AppError("CONFLICT");
      if (intent.planReviewId) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_plan_reviews
          WHERE id = ${intent.planReviewId}::uuid
          FOR UPDATE
        `;
      }
      const planReview = intent.planReviewId
        ? await tx.conversationPlanReview.findUnique({
            where: { id: intent.planReviewId },
          })
        : null;
      const latestTurn = await tx.conversationTurn.findFirst({
        where: { conversationId: intent.conversationId },
        orderBy: { sequenceNo: "desc" },
      });
      const latestMessage = await tx.conversationMessage.findFirst({
        where: { conversationId: intent.conversationId },
        orderBy: { sequenceNo: "desc" },
      });
      if (
        intent.planReviewId &&
        (!intent.planReviewAction ||
          !planReview ||
          planReview.conversationId !== intent.conversationId ||
          planReview.ownerId !== intent.ownerId ||
          planReview.status !== "pending" ||
          planReview.sourceTurnId !== latestTurn?.id ||
          activeConversation.collaborationMode !== "plan")
      ) {
        throw new AppError("PLAN_REVIEW_UNAVAILABLE");
      }
      const regeneration = intent.regenerationJson;
      const regeneratesLogicalFirstTurn = regeneration
        ? (await tx.conversationTurn.count({
            where: {
              conversationId: intent.conversationId,
              codexThreadId: regeneration.codexThreadId,
              sequenceNo: { lt: regeneration.turnSequenceNo },
            },
          })) === 0
        : false;
      if (regeneration) {
        await tx.conversationTurn.updateMany({
          where: {
            conversationId: intent.conversationId,
            codexThreadId: regeneration.codexThreadId,
            sequenceNo: { lt: regeneration.turnSequenceNo },
          },
          data: { codexThreadId: startedTurn.codexThreadId },
        });
      } else if (
        activeConversation.codexThreadId &&
        activeConversation.codexThreadId !== startedTurn.codexThreadId
      ) {
        await tx.conversationTurn.updateMany({
          where: {
            conversationId: intent.conversationId,
            codexThreadId: activeConversation.codexThreadId,
          },
          data: { codexThreadId: startedTurn.codexThreadId },
        });
      }
      const created = await tx.conversationTurn.create({
        data: {
          id: intent.projectionTurnId,
          conversationId: intent.conversationId,
          sequenceNo: (latestTurn?.sequenceNo ?? 0) + 1,
          submittedBy: intent.ownerId,
          codexThreadId: startedTurn.codexThreadId,
          codexTurnId: startedTurn.codexTurnId,
          status: "running",
          taskKind: intent.taskKind,
          collaborationMode: intent.collaborationMode,
          submitMode: intent.submitMode,
          idempotencyKey: intent.idempotencyKey,
          idempotencyRequestHash: intent.idempotencyKey
            ? turnStartIntentIdempotencyRequestHash(intent)
            : null,
          knowledgeBaseIdsJson: intent.knowledgeBaseIdsJson,
          capabilityGeneration: intent.capabilityGeneration,
          capabilitiesJson: intent.capabilitiesJson,
          mcpGeneration: intent.mcpGeneration,
          mcpServersJson: intent.mcpServersJson,
          model: intent.model,
          reasoningEffort: intent.reasoningEffort,
          startedAt: intent.createdAt,
        },
      });
      await tx.conversationTurnAttempt.create({
        data: {
          turnId: created.id,
          attemptNo: 1,
          kind:
            intent.taskKind === "goal"
              ? "goal_primary"
              : isCompact
                ? "compact"
                : "primary",
          codexThreadId: startedTurn.codexThreadId,
          codexTurnId: startedTurn.codexTurnId,
          status: "running",
          continuationContextJson: {
            collaboration_mode: intent.collaborationMode,
            require_final_response:
              intent.idempotencyKey?.startsWith("automation:") ?? false,
            application_instructions: intent.applicationInstructions,
            selected_knowledge_base_count: intent.knowledgeBaseIdsJson.length,
            priority_capability_ids: intent.priorityCapabilityIdsJson,
          },
          startedAt: intent.createdAt,
        },
      });
      if (startedGoal) {
        await upsertConversationGoal(tx, {
          conversationId: intent.conversationId,
          ownerId: intent.ownerId,
          goal: startedGoal,
          activeTurnId: created.id,
        });
      }
      await recordTurnStartedActivity(tx, created);
      if (!isCompact) {
        await recordSelectedSkillUsageActivity(tx, intent, created);
      }
      if (!isCompact && intent.model) {
        await tx.conversation.updateMany({
          where: {
            id: intent.conversationId,
            preferredModel: null,
          },
          data: { preferredModel: intent.model },
        });
      }
      if (!isCompact && intent.knowledgeBaseIdsJson.length > 0) {
        await tx.conversationTurnKnowledgeBase.createMany({
          data: intent.knowledgeBaseIdsJson.map(
            (knowledgeBaseId, selectionOrder) => ({
              turnId: created.id,
              knowledgeBaseId,
              selectionOrder,
              createdAt: intent.createdAt,
            }),
          ),
        });
      }
      const attachedCapabilities = isCompact
        ? []
        : attachedCapabilitiesForStartIntent(intent);
      const attachedEvents: TurnStartProjectionResult["attachedEvents"] = [];
      let eventSequence =
        attachedCapabilities.length > 0 || intent.messageDisplayJson
          ? await nextConversationEventSequence(tx, intent.conversationId)
          : null;
      for (const capability of attachedCapabilities) {
        if (eventSequence === null) break;
        const event = await tx.conversationEvent.create({
          data: {
            conversationId: intent.conversationId,
            turnId: created.id,
            sequenceNo: eventSequence,
            eventType: "conversation.capability.attached",
            visibility: "user_collapsed",
            payloadJson: {
              schema_version: 1,
              capability_id: capability.id,
              capability_type: capability.type,
              usage_type:
                capability.type === "plugin" ? "auto_plugin" : "auto_skill",
              priority_requested: intent.priorityCapabilityIdsJson.includes(
                capability.id,
              ),
              name: capability.name,
              source_type: capability.sourceType,
              status: "active",
            },
            sseEventId: `${intent.conversationId}:${eventSequence}`,
          },
        });
        attachedEvents.push(event);
        eventSequence += 1n;
      }
      const userMessage = isCompact
        ? null
        : await tx.conversationMessage.create({
            data: {
              conversationId: intent.conversationId,
              turnId: created.id,
              sequenceNo: (latestMessage?.sequenceNo ?? 0) + 1,
              role: "user",
              contentText: intent.inputText,
            },
          });
      if (intent.messageDisplayJson && eventSequence !== null && userMessage) {
        await tx.conversationEvent.create({
          data: {
            conversationId: intent.conversationId,
            turnId: created.id,
            sequenceNo: eventSequence,
            eventType: USER_MESSAGE_DISPLAY_EVENT_TYPE,
            visibility: "internal_sanitized",
            payloadJson: {
              schema_version: 1,
              message_id: userMessage.id,
              display: intent.messageDisplayJson,
            },
            sseEventId: `${intent.conversationId}:${eventSequence}`,
          },
        });
      }
      if (regeneration) {
        for (const file of intent.attachmentsJson) {
          await tx.conversationFile.create({
            data: {
              id: deterministicUuid(
                intent.projectionTurnId,
                `regenerated-attachment:${file.id}`,
              ),
              conversationId: intent.conversationId,
              pendingRequestId: null,
              turnId: created.id,
              kind: file.kind,
              source: file.source,
              status: "bound",
              filename: file.filename,
              mimeType: file.mimeType,
              sizeBytes: BigInt(file.sizeBytes),
              checksumSha256: file.checksumSha256,
              storageBackend: file.storageBackend,
              workspaceRelativePath: file.workspaceRelativePath,
              minioObjectKey: file.minioObjectKey,
              downloadable: file.downloadable,
              downloadCardEventId: null,
              createdBy: file.createdBy,
            },
          });
        }
      } else if (
        !intent.preservesStagedAttachments &&
        intent.attachmentsJson.length > 0
      ) {
        const attachmentIds = intent.attachmentsJson.map((file) => file.id);
        const bound = await tx.conversationFile.updateMany({
          where: {
            id: { in: attachmentIds },
            conversationId: intent.conversationId,
            kind: "attachment",
            turnId: null,
            ...(intent.pendingRequestId
              ? {
                  pendingRequestId: intent.pendingRequestId,
                  status: "pending",
                }
              : {
                  pendingRequestId: null,
                  status: "staged",
                }),
          },
          data: {
            pendingRequestId: null,
            turnId: created.id,
            status: "bound",
          },
        });
        if (bound.count !== attachmentIds.length) {
          throw new AppError("ATTACHMENT_UPLOAD_INVALID");
        }
      }
      if (intent.pendingRequestId) {
        const consumed = await tx.pendingRequest.deleteMany({
          where: {
            id: intent.pendingRequestId,
            conversationId: intent.conversationId,
            submittedBy: intent.ownerId,
          },
        });
        if (consumed.count !== 1) throw new AppError("CONFLICT");
      }
      const firstTurnTitle = !isCompact && (
        regeneration ? regeneratesLogicalFirstTurn : created.sequenceNo === 1
      )
        ? fallbackTitle(
            intent.messageDisplayJson
              ? officeAnnotationRequestText(intent.messageDisplayJson)
              : intent.inputText,
          )
        : "";
      await tx.conversation.update({
        where: { id: intent.conversationId },
        data: {
          codexThreadId: startedTurn.codexThreadId,
          lastTurnStatus: "running",
          lastRunAt: new Date(),
          ...(!isCompact
            ? { selectedKnowledgeBaseIdsJson: intent.knowledgeBaseIdsJson }
            : {}),
          ...(intent.planReviewAction
            ? { collaborationMode: intent.collaborationMode }
            : {}),
        },
      });
      if (planReview && intent.planReviewAction) {
        const resolvedAt = new Date();
        const resolved = await tx.conversationPlanReview.updateMany({
          where: {
            id: planReview.id,
            conversationId: intent.conversationId,
            ownerId: intent.ownerId,
            status: "pending",
            decision: null,
            followUpTurnId: null,
          },
          data: {
            status: "resolved",
            decision: intent.planReviewAction,
            followUpTurnId: created.id,
            resolvedAt,
          },
        });
        if (resolved.count !== 1) {
          throw new AppError("PLAN_REVIEW_UNAVAILABLE");
        }
        const sequenceNo = await nextConversationEventSequence(
          tx,
          intent.conversationId,
        );
        const event = await tx.conversationEvent.create({
          data: {
            conversationId: intent.conversationId,
            turnId: planReview.sourceTurnId,
            sequenceNo,
            eventType: "conversation.plan_review.updated",
            visibility: "user_visible",
            payloadJson: {
              schema_version: 1,
              plan_review_id: planReview.id,
              source_turn_id: planReview.sourceTurnId,
              status: "resolved",
              decision: intent.planReviewAction,
              follow_up_turn_id: created.id,
            },
            sseEventId: `${intent.conversationId}:${sequenceNo}`,
          },
        });
        attachedEvents.push(event);
      }
      if (firstTurnTitle) {
        await tx.conversation.updateMany({
          where: {
            id: intent.conversationId,
            titleSource: "fallback",
          },
          data: { title: firstTurnTitle },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: intent.ownerId,
          action:
            intent.taskKind === "goal"
              ? "conversation_goal_started"
              : isCompact
                ? "conversation_context_compaction_started"
              : regeneration
                ? "conversation_turn_regenerated"
                : "conversation_turn_started",
          targetType: "conversation_turn",
          targetId: created.id,
          result: "success",
          metadataJson: {
            conversation_id: intent.conversationId,
            submit_mode: intent.submitMode,
            ...(regeneration
              ? {
                  regenerated_from_message_id: regeneration.messageId,
                  regenerated_from_turn_id: regeneration.turnId,
                }
              : {}),
            ...(intent.planReviewId && intent.planReviewAction
              ? {
                  plan_review_id: intent.planReviewId,
                  plan_review_action: intent.planReviewAction,
                }
              : {}),
          },
          ipAddress: intent.auditIpAddress,
          userAgent: intent.auditUserAgent,
        },
      });
      const credentialUsedAt = new Date();
      for (const receipt of intent.credentialUsageReceiptsJson) {
        for (const credentialId of receipt.credentialIds) {
          await tx.credential.updateMany({
            where: { id: credentialId },
            data: { lastUsedAt: credentialUsedAt },
          });
          await tx.auditLog.create({
            data: {
              actorId: intent.ownerId,
              action: "credential_used",
              targetType: "credential",
              targetId: credentialId,
              result: "success",
              metadataJson: { capability_id: receipt.capabilityId },
              ipAddress: intent.auditIpAddress,
              userAgent: intent.auditUserAgent,
            },
          });
        }
      }
      for (const receipt of intent.mcpCredentialUsageReceiptsJson) {
        await tx.mcpServer.updateMany({
          where: {
            id: receipt.serverId,
            ...(intent.applicationId ? {} : { ownerId: intent.ownerId }),
          },
          data: { lastUsedAt: credentialUsedAt },
        });
        await tx.auditLog.create({
          data: {
            actorId: intent.ownerId,
            action: "mcp_server_credential_used",
            targetType: "mcp_server",
            targetId: receipt.serverId,
            result: "success",
            metadataJson: {},
            ipAddress: intent.auditIpAddress,
            userAgent: intent.auditUserAgent,
          },
        });
      }
      const deleted = await tx.conversationTurnStartIntent.deleteMany({
        where: {
          projectionTurnId: intent.projectionTurnId,
          ownerId: intent.ownerId,
          conversationId: intent.conversationId,
          runtimeGeneration: intent.runtimeGeneration,
          runnerStatus: "runner_succeeded",
          codexThreadId: startedTurn.codexThreadId,
          codexTurnId: startedTurn.codexTurnId,
        },
      });
      if (deleted.count !== 1) throw new AppError("CONFLICT");
      return { created, attachedEvents };
    });
  }

  private async markStartIntentForRelease(
    intent: TurnStartIntent,
  ): Promise<TurnStartIntent> {
    try {
      const marked = await this.prisma.conversationTurnStartIntent.updateMany({
        where: {
          projectionTurnId: intent.projectionTurnId,
          ownerId: intent.ownerId,
          conversationId: intent.conversationId,
          runtimeGeneration: intent.runtimeGeneration,
          runnerStatus: "prepared",
        },
        data: {
          runnerStatus: "release_pending",
          codexThreadId: null,
          codexTurnId: null,
        },
      });
      if (marked.count === 1) {
        return {
          ...intent,
          runnerStatus: "release_pending",
          codexThreadId: null,
          codexTurnId: null,
        };
      }
      const stored = await this.prisma.conversationTurnStartIntent.findUnique({
        where: { projectionTurnId: intent.projectionTurnId },
      });
      const releasing = stored ? parseTurnStartIntent(stored) : null;
      if (
        releasing?.ownerId === intent.ownerId &&
        releasing.conversationId === intent.conversationId &&
        releasing.runtimeGeneration === intent.runtimeGeneration &&
        releasing.runnerStatus === "release_pending" &&
        releasing.codexThreadId === null &&
        releasing.codexTurnId === null
      ) {
        return releasing;
      }
    } catch {
      throw new RunnerStartOperationUncertainError();
    }
    throw new RunnerStartOperationUncertainError();
  }

  private async markMissingStartIntentForRelease(
    intent: TurnStartIntent,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [stored, conversation, cleanup] = await Promise.all([
        tx.conversationTurnStartIntent.findUnique({
          where: { projectionTurnId: intent.projectionTurnId },
          select: {
            ownerId: true,
            conversationId: true,
            runtimeGeneration: true,
            runnerStatus: true,
          },
        }),
        tx.conversation.findUnique({
          where: { id: intent.conversationId },
          select: { ownerId: true, runtimeGeneration: true },
        }),
        tx.runtimeCleanupOutbox.findUnique({
          where: { conversationId: intent.conversationId },
          select: { id: true },
        }),
      ]);
      if (
        stored?.ownerId !== intent.ownerId ||
        stored.conversationId !== intent.conversationId ||
        stored.runtimeGeneration !== intent.runtimeGeneration ||
        stored.runnerStatus !== "prepared" ||
        conversation?.ownerId !== intent.ownerId ||
        conversation.runtimeGeneration !== intent.runtimeGeneration ||
        cleanup
      ) {
        return false;
      }
      const marked = await tx.conversationTurnStartIntent.updateMany({
        where: {
          projectionTurnId: intent.projectionTurnId,
          ownerId: intent.ownerId,
          conversationId: intent.conversationId,
          runtimeGeneration: intent.runtimeGeneration,
          runnerStatus: "prepared",
        },
        data: { runnerStatus: "release_pending" },
      });
      return marked.count === 1;
    });
  }

  private async deleteUnacquiredMissingStartIntent(
    intent: TurnStartIntent,
  ): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${intent.ownerId}::uuid FOR UPDATE
      `;
      const [stored, conversation, cleanup] = await Promise.all([
        tx.conversationTurnStartIntent.findUnique({
          where: { projectionTurnId: intent.projectionTurnId },
          select: {
            ownerId: true,
            conversationId: true,
            runtimeGeneration: true,
            runnerStatus: true,
          },
        }),
        tx.conversation.findUnique({
          where: { id: intent.conversationId },
          select: { ownerId: true, runtimeGeneration: true },
        }),
        tx.runtimeCleanupOutbox.findUnique({
          where: { conversationId: intent.conversationId },
          select: { id: true },
        }),
      ]);
      if (
        stored?.ownerId !== intent.ownerId ||
        stored.conversationId !== intent.conversationId ||
        stored.runtimeGeneration !== intent.runtimeGeneration ||
        stored.runnerStatus !== "slot_pending" ||
        conversation?.ownerId !== intent.ownerId ||
        conversation.runtimeGeneration !== intent.runtimeGeneration ||
        cleanup
      ) {
        return { deleted: false, pendingEvent: null };
      }
      const pendingEvent = await this.settleUnstartedPendingIntent(tx, intent);
      const deleted = await tx.conversationTurnStartIntent.deleteMany({
        where: {
          projectionTurnId: intent.projectionTurnId,
          ownerId: intent.ownerId,
          conversationId: intent.conversationId,
          runtimeGeneration: intent.runtimeGeneration,
          runnerStatus: "slot_pending",
        },
      });
      if (deleted.count !== 1) {
        throw new RunnerStartOperationUncertainError();
      }
      return { deleted: true, pendingEvent };
    });
    if (result.pendingEvent) {
      await this.redis
        .publishConversationEvent(
          intent.conversationId,
          projectStoredEvent(result.pendingEvent),
        )
        .catch(() => undefined);
    }
    return result.deleted;
  }

  private async finishReleasePendingStartIntent(
    intent: TurnStartIntent,
  ): Promise<void> {
    const pendingEvent = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${intent.ownerId}::uuid FOR UPDATE
      `;
      await tx.$queryRaw<Array<{ projectionTurnId: string }>>`
        SELECT projection_turn_id AS "projectionTurnId"
        FROM conversation_turn_start_intents
        WHERE projection_turn_id = ${intent.projectionTurnId}::uuid
        FOR UPDATE
      `;
      const stored = await tx.conversationTurnStartIntent.findUnique({
        where: { projectionTurnId: intent.projectionTurnId },
      });
      if (!stored) return;
      const releasing = parseTurnStartIntent(stored);
      if (
        releasing.ownerId !== intent.ownerId ||
        releasing.conversationId !== intent.conversationId ||
        releasing.runtimeGeneration !== intent.runtimeGeneration ||
        releasing.runnerStatus !== "release_pending" ||
        releasing.codexThreadId !== null ||
        releasing.codexTurnId !== null
      ) {
        throw new RunnerStartOperationUncertainError();
      }
      const pendingEvent = await this.settleUnstartedPendingIntent(
        tx,
        releasing,
      );
      await this.redis.releaseTurnSlot(
        releasing.conversationId,
        releasing.projectionTurnId,
      );
      const deleted = await tx.conversationTurnStartIntent.deleteMany({
        where: {
          projectionTurnId: releasing.projectionTurnId,
          ownerId: releasing.ownerId,
          conversationId: releasing.conversationId,
          runtimeGeneration: releasing.runtimeGeneration,
          runnerStatus: "release_pending",
        },
      });
      if (deleted.count !== 1) {
        throw new RunnerStartOperationUncertainError();
      }
      return pendingEvent;
    });
    if (pendingEvent) {
      await this.redis
        .publishConversationEvent(
          intent.conversationId,
          projectStoredEvent(pendingEvent),
        )
        .catch(() => undefined);
    }
  }

  private async settleUnstartedPendingIntent(
    tx: Prisma.TransactionClient,
    intent: TurnStartIntent,
  ): Promise<Parameters<typeof projectStoredEvent>[0] | null> {
    if (!intent.pendingRequestId) {
      const sequenceNo = await nextConversationEventSequence(
        tx,
        intent.conversationId,
      );
      return tx.conversationEvent.create({
        data: {
          conversationId: intent.conversationId,
          sequenceNo,
          eventType: "conversation.error",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            error_code: "RUNNER_UNAVAILABLE",
            message_key: "errors.runnerUnavailable",
            retryable: true,
          },
          sseEventId: `${intent.conversationId}:${sequenceNo}`,
        },
      });
    }
    const owner = await tx.user.findUnique({
      where: { id: intent.ownerId },
      select: { status: true },
    });
    if (owner?.status === "disabled") {
      await tx.conversationFile.updateMany({
        where: {
          conversationId: intent.conversationId,
          pendingRequestId: intent.pendingRequestId,
          turnId: null,
          kind: "attachment",
          status: "pending",
        },
        data: {
          pendingRequestId: null,
          status: "staged",
        },
      });
      const cancelled = await tx.pendingRequest.deleteMany({
        where: {
          id: intent.pendingRequestId,
          conversationId: intent.conversationId,
          submittedBy: intent.ownerId,
        },
      });
      if (cancelled.count > 0) {
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "conversation_pending_request_cancelled_user_disabled",
            targetType: "pending_request",
            targetId: intent.pendingRequestId,
            result: "success",
            metadataJson: { conversation_id: intent.conversationId },
            ipAddress: null,
            userAgent: null,
          },
        });
      }
      return null;
    }
    const pending = await tx.pendingRequest.findFirst({
      where: {
        id: intent.pendingRequestId,
        conversationId: intent.conversationId,
        submittedBy: intent.ownerId,
      },
    });
    if (!pending) throw new RunnerStartOperationUncertainError();
    const checkedAt = new Date();
    const blocked = await tx.pendingRequest.updateMany({
      where: {
        id: pending.id,
        conversationId: intent.conversationId,
        submittedBy: intent.ownerId,
      },
      data: {
        status: "blocked_preflight",
        blockCode: "runner_unavailable",
        lastStartCheckedAt: checkedAt,
      },
    });
    if (blocked.count !== 1) {
      throw new RunnerStartOperationUncertainError();
    }
    const sequenceNo = await nextConversationEventSequence(
      tx,
      intent.conversationId,
    );
    return tx.conversationEvent.create({
      data: {
        conversationId: intent.conversationId,
        sequenceNo,
        eventType: "conversation.pending_request.updated",
        visibility: "user_visible",
        payloadJson: {
          schema_version: 1,
          pending_request_id: pending.id,
          status: "blocked_preflight",
          block_code: "runner_unavailable",
          queue_no: Number(pending.queueNo),
          last_start_checked_at: checkedAt.toISOString(),
        },
        sseEventId: `${intent.conversationId}:${sequenceNo}`,
      },
    });
  }

  private async recordPendingStartBlock(
    conversationId: string,
    pendingId: string | undefined,
    error: unknown,
  ): Promise<void> {
    if (!pendingId || !(error instanceof AppError)) return;
    const blockCode = mapPreflightBlockCode(error.code);
    if (!blockCode) return;
    const update = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.pendingRequest.update({
        where: { id: pendingId },
        data: {
          status: "blocked_preflight",
          blockCode,
          lastStartCheckedAt: new Date(),
        },
      });
      const sequenceNo = await nextConversationEventSequence(
        tx,
        conversationId,
      );
      const event = await tx.conversationEvent.create({
        data: {
          conversationId,
          sequenceNo,
          eventType: "conversation.pending_request.updated",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            pending_request_id: pending.id,
            status: pending.status,
            block_code: pending.blockCode,
            queue_no: Number(pending.queueNo),
            last_start_checked_at:
              pending.lastStartCheckedAt?.toISOString() ?? null,
          },
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      });
      return event;
    });
    await this.redis
      .publishConversationEvent(conversationId, projectStoredEvent(update))
      .catch(() => undefined);
  }

  private startTurnInternal(
    ownerId: string,
    conversationId: string,
    submission: TurnSubmission,
    context: AuditContext,
    pendingId?: string,
    existingLock?: string,
    regeneration?: RegenerationSource,
    returnWhenAccepted?: false,
    planReviewAction?: PlanReviewTurnAction,
  ): Promise<ReturnType<typeof projectTurn>>;
  private startTurnInternal(
    ownerId: string,
    conversationId: string,
    submission: TurnSubmission,
    context: AuditContext,
    pendingId: string | undefined,
    existingLock: string | undefined,
    regeneration: RegenerationSource | undefined,
    returnWhenAccepted: true,
    planReviewAction?: never,
  ): Promise<TurnStartReceipt>;
  private async startTurnInternal(
    ownerId: string,
    conversationId: string,
    submission: TurnSubmission,
    context: AuditContext,
    pendingId?: string,
    existingLock?: string,
    regeneration?: RegenerationSource,
    returnWhenAccepted = false,
    planReviewAction?: PlanReviewTurnAction,
  ) {
    const lock =
      existingLock ?? (await this.acquireConversationLock(conversationId));
    try {
      const conversation = await this.assertOwner(ownerId, conversationId);
      const applicationRuntime = await this.applicationRuntimeForConversation(
        ownerId,
        conversation.applicationId,
        conversation.interactiveApplicationPackageId,
      );
      const officeAnnotation = submissionOfficeAnnotation(submission);
      const preservesStagedAttachments =
        Boolean(officeAnnotation) ||
        (submission.preserveStagedAttachments === true &&
          !pendingId &&
          !regeneration);
      const preparedAnnotation = officeAnnotation
        ? await this.prepareOfficeAnnotation(conversationId, officeAnnotation)
        : null;
      const input: PreparedTurnSubmission = {
        inputText: preparedAnnotation
          ? preparedAnnotation.inputText
          : "inputText" in submission
            ? submission.inputText
            : "",
        collaborationMode: submission.goal
          ? "default"
          : (submission.collaborationMode ??
            conversationCollaborationModeSchema.parse(
              conversation.collaborationMode,
            )),
        priorityCapabilityIds:
          applicationRuntime?.capabilityIds ?? submission.priorityCapabilityIds,
        knowledgeBaseIds:
          applicationRuntime?.knowledgeBaseIds ??
          submission.knowledgeBaseIds ??
          [],
        ...(submission.idempotencyKey
          ? { idempotencyKey: submission.idempotencyKey }
          : {}),
        submitMode: submission.submitMode,
        ...(submission.goal
          ? {
              goal: {
                objective: submission.goal.objective,
                ...(submission.goal.tokenBudget !== undefined
                  ? { tokenBudget: submission.goal.tokenBudget }
                  : {}),
                ...(submission.goal.resumeExisting
                  ? { resumeExisting: true }
                  : {}),
              },
            }
          : {}),
        ...(preservesStagedAttachments
          ? { preserveStagedAttachments: true }
          : {}),
        messageDisplay: preparedAnnotation?.display ?? null,
      };
      const currentCollaborationMode =
        conversationCollaborationModeSchema.parse(
          conversation.collaborationMode,
        );
      const implementsPendingPlan =
        planReviewAction?.action === "implement" &&
        currentCollaborationMode === "plan" &&
        input.collaborationMode === "default";
      if (
        input.collaborationMode !== currentCollaborationMode &&
        !implementsPendingPlan
      ) {
        throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
      }
      const idempotencyRequestHash = input.idempotencyKey
        ? turnIdempotencyRequestHash({
            inputText: input.inputText,
            messageDisplay: input.messageDisplay,
            submitMode: input.submitMode,
            priorityCapabilityIds: input.priorityCapabilityIds,
            knowledgeBaseIds: input.knowledgeBaseIds,
            preservesStagedAttachments,
            pendingRequestId: pendingId ?? null,
            regenerationMessageId: regeneration?.messageId ?? null,
            taskKind: input.goal ? "goal" : "turn",
            collaborationMode: input.collaborationMode,
            goalObjective: input.goal?.objective ?? null,
            goalTokenBudget: input.goal?.tokenBudget ?? null,
            planReviewId: planReviewAction?.reviewId ?? null,
            planReviewAction: planReviewAction?.action ?? null,
          })
        : null;
      if (input.idempotencyKey && idempotencyRequestHash) {
        const existingTurn = await this.prisma.conversationTurn.findFirst({
          where: {
            conversationId,
            idempotencyKey: input.idempotencyKey,
          },
        });
        if (existingTurn) {
          if (existingTurn.idempotencyRequestHash !== idempotencyRequestHash) {
            throw new AppError("CONFLICT");
          }
          const existingMessage =
            await this.prisma.conversationMessage.findFirst({
              where: { conversationId, turnId: existingTurn.id, role: "user" },
              orderBy: { sequenceNo: "asc" },
            });
          if (
            !existingMessage ||
            existingMessage.contentText !== input.inputText
          ) {
            throw new AppError("CONFLICT");
          }
          if (input.messageDisplay) {
            await this.ensureUserMessageDisplaySidecar(
              conversationId,
              existingTurn.id,
              existingMessage.id,
              input.messageDisplay,
            );
          }
          return returnWhenAccepted
            ? startReceipt(existingTurn.id, "running")
            : projectTurn(existingTurn);
        }
      }
      if (!planReviewAction) {
        const pendingPlanReview =
          await this.prisma.conversationPlanReview.findFirst({
            where: {
              conversationId,
              status: { in: ["preparing", "pending"] },
            },
            select: { id: true },
          });
        if (pendingPlanReview) throw new AppError("PLAN_REVIEW_PENDING");
      }
      const running = await this.prisma.conversationTurn.count({
        where: {
          conversationId,
          status: "running",
          ...(conversation.codexThreadId
            ? { codexThreadId: conversation.codexThreadId }
            : {}),
        },
      });
      if (running > 0) throw new AppError("CONFLICT");
      if (input.goal) {
        if (pendingId || regeneration) throw new AppError("CONFLICT");
        const existingGoal = await this.prisma.conversationGoal.findFirst({
          where: { conversationId, ownerId },
        });
        if (input.goal.resumeExisting) {
          if (
            !existingGoal ||
            existingGoal.objective !== input.goal.objective ||
            ![
              "paused",
              "blocked",
              "usageLimited",
              "budgetLimited",
            ].includes(existingGoal.status)
          ) {
            throw new AppError("CONFLICT");
          }
        } else if (existingGoal && existingGoal.status !== "complete") {
          throw new AppError("CONFLICT");
        }
      }

      const files = preservesStagedAttachments
        ? []
        : await this.prisma.conversationFile.findMany({
            where: regeneration
              ? {
                  conversationId,
                  turnId: regeneration.turnId,
                  kind: "attachment",
                  status: "bound",
                }
              : pendingId
                ? {
                    conversationId,
                    pendingRequestId: pendingId,
                    turnId: null,
                    kind: "attachment",
                    status: "pending",
                  }
                : {
                    conversationId,
                    pendingRequestId: null,
                    turnId: null,
                    kind: "attachment",
                    status: "staged",
                  },
          });
      if (input.inputText.trim().length === 0 && files.length === 0) {
        throw new AppError("VALIDATION_ERROR");
      }

      try {
        await this.tokenLimits?.assertCanStartTask(ownerId);
      } catch (error) {
        await this.recordPendingStartBlock(conversationId, pendingId, error);
        throw error;
      }

      const projectionTurnId = pendingId
        ? deterministicUuid(conversationId, `pending-start:${pendingId}`)
        : input.idempotencyKey
          ? deterministicUuid(
              conversationId,
              `${input.goal ? "goal" : "turn"}-start:${input.idempotencyKey}`,
            )
          : crypto.randomUUID();
      const activeStartIntent =
        await this.prisma.conversationTurnStartIntent.findUnique({
          where: { conversationId },
        });
      if (activeStartIntent) {
        const active = parseTurnStartIntent(activeStartIntent);
        if (
          active.projectionTurnId === projectionTurnId &&
          matchesStartIntentSubmission(active, {
            ownerId,
            conversationId,
            input,
            preservesStagedAttachments,
            files,
            ...(pendingId ? { pendingId } : {}),
            ...(regeneration ? { regeneration } : {}),
            ...(planReviewAction ? { planReviewAction } : {}),
          })
        ) {
          if (
            active.runnerStatus === "runner_succeeded" &&
            active.codexThreadId &&
            active.codexTurnId
          ) {
            const projection = await this.publishStartProjection(
              active,
              await this.startedTurnForSucceededIntent(active),
            );
            return returnWhenAccepted
              ? startReceipt(projection.created.id, "running")
              : projectTurn(projection.created);
          }
          if (returnWhenAccepted && active.runnerStatus === "prepared") {
            const operation = await this.runner.inspectStartOperation(
              conversationId,
              projectionTurnId,
              ownerId,
            );
            assertMatchingStartOperation(active, operation);
            if (
              operation?.status === "starting" ||
              operation?.status === "succeeded"
            ) {
              this.trackAcceptedStartRecovery(projectionTurnId);
              return startReceipt(projectionTurnId, "starting");
            }
          }
          throw new RunnerStartOperationUncertainError();
        }
        throw new AppError("CONFLICT");
      }

      let runtime: Awaited<ReturnType<RunnerClient["prepareRuntime"]>>;
      let resolved: Awaited<ReturnType<ConversationPreflight["resolve"]>>;
      let modelRuntime: ResolvedModelRuntime;
      try {
        const authorizationPromise = this.preflight.resolve({
          userId: ownerId,
          priorityCapabilityIds: input.priorityCapabilityIds,
          ...(applicationRuntime?.kind === "standard"
            ? {
                capabilityScope: {
                  applicationId: applicationRuntime.applicationId,
                  sourceOwnerId: applicationRuntime.applicationOwnerId,
                  capabilityIds: applicationRuntime.capabilityIds,
                  mcpServerIds: applicationRuntime.mcpServerIds,
                },
              }
            : {}),
        });
        // Dynamic Worker creation must happen after the API has atomically
        // published managed/agents. Keeping the dependency in this promise
        // preserves parallel attachment/model checks without racing Subpath.
        const runtimeInspectionPromise = this.runner.inspectRuntime(
          conversationId,
          ownerId,
        );
        const runtimePromise = Promise.all([
          authorizationPromise,
          runtimeInspectionPromise,
        ]).then(async ([, inspected]) => {
          if (
            inspected &&
            inspected.runtimeGeneration === conversation.runtimeGeneration &&
            inspected.agentsTemplateVersion ===
              conversation.agentsTemplateVersion
          ) {
            return inspected;
          }
          return this.runner.prepareRuntime(conversationId, ownerId);
        });
        const [
          runtimeResult,
          authorizationResult,
          attachmentsResult,
          modelRuntimeResult,
        ] = await Promise.allSettled([
          runtimePromise,
          authorizationPromise,
          Promise.all(
            files.map(async (file) => {
              if (!file.workspaceRelativePath) {
                throw new AppError("ATTACHMENT_UPLOAD_INVALID");
              }
              let candidate: string;
              try {
                candidate = resolveConversationWorkspaceEntry(
                  this.workspaceRoot,
                  ownerId,
                  conversationId,
                  file.workspaceRelativePath,
                );
              } catch {
                throw new AppError("ATTACHMENT_UPLOAD_INVALID");
              }
              await access(candidate, constants.R_OK).catch(() => {
                throw new AppError("ATTACHMENT_UPLOAD_INVALID");
              });
            }),
          ),
          applicationRuntime !== null &&
          applicationRuntime.model !== null &&
          applicationRuntime.reasoningEffort !== null
            ? this.modelRuntimeForSelection(
                ownerId,
                conversationId,
                applicationRuntime.model,
                applicationRuntime.reasoningEffort,
              )
            : submission.modelPreference
              ? this.modelRuntimeForSelection(
                  ownerId,
                  conversationId,
                  submission.modelPreference.modelId,
                  submission.modelPreference.reasoningEffort,
                )
              : this.modelRuntimeForUser(ownerId, conversationId),
        ]);
        if (runtimeResult.status === "rejected") throw runtimeResult.reason;
        if (authorizationResult.status === "rejected") {
          await this.runner
            .closeRuntimeProcess(conversationId, ownerId)
            .catch(() => undefined);
          throw authorizationResult.reason;
        }
        if (attachmentsResult.status === "rejected") {
          throw attachmentsResult.reason;
        }
        if (modelRuntimeResult.status === "rejected") {
          throw modelRuntimeResult.reason;
        }
        runtime = runtimeResult.value;
        resolved = authorizationResult.value;
        modelRuntime = modelRuntimeResult.value;
        const refreshed = await this.prisma.conversation.updateMany({
          where: { id: conversationId, ownerId },
          data: {
            agentsTemplateVersion: runtime.agentsTemplateVersion,
            runtimeGeneration: runtime.runtimeGeneration,
          },
        });
        if (refreshed.count !== 1) {
          throw new AppError("CONVERSATION_NOT_FOUND");
        }
      } catch (error) {
        await this.recordPendingStartBlock(conversationId, pendingId, error);
        throw error;
      }

      const executionConcurrency = await this.executionConcurrencyForStart();
      let startIntent = await this.preflight.withCapabilityStartBarrier(
        {
          userId: ownerId,
          priorityCapabilityIds: input.priorityCapabilityIds,
          capabilities: resolved.capabilities,
          capabilityGeneration: resolved.capabilityGeneration,
          capabilityVerification: resolved.capabilityVerification,
          mcpServers: resolved.mcpServers ?? [],
          mcpGeneration: resolved.mcpGeneration ?? EMPTY_MCP_GENERATION,
          environment: resolved.environment ?? {},
          credentialUsageReceipts: resolved.credentialUsageReceipts ?? [],
          mcpCredentialUsageReceipts: resolved.mcpCredentialUsageReceipts ?? [],
          ...(applicationRuntime?.kind === "standard"
            ? {
                capabilityScope: {
                  applicationId: applicationRuntime.applicationId,
                  sourceOwnerId: applicationRuntime.applicationOwnerId,
                  capabilityIds: applicationRuntime.capabilityIds,
                  mcpServerIds: applicationRuntime.mcpServerIds,
                },
              }
            : {}),
        },
        () =>
          this.createStartIntentWithResourceLease({
            projectionTurnId,
            ownerId,
            conversationId,
            expectedRuntimeGeneration: runtime.runtimeGeneration,
            capabilityGeneration: resolved.capabilityGeneration,
            mcpGeneration: resolved.mcpGeneration ?? EMPTY_MCP_GENERATION,
            modelRuntime,
            applicationRuntime,
            expectedCodexThreadId: conversation.codexThreadId,
            prepared: input,
            preservesStagedAttachments,
            pendingRequestId: pendingId ?? null,
            regeneration: regeneration ?? null,
            attachments: files.map(snapshotTurnStartAttachment),
            capabilities: snapshotStartIntentCapabilities(
              resolved.capabilities,
            ),
            mcpServers: resolved.mcpServers ?? [],
            credentialUsageReceipts: snapshotCredentialUsageReceipts(
              resolved.credentialUsageReceipts ?? [],
              ownerId,
            ),
            mcpCredentialUsageReceipts:
              resolved.mcpCredentialUsageReceipts ?? [],
            audit: context,
            planReviewAction: planReviewAction ?? null,
          }),
      );
      const acquired = await this.redis.acquireTurnSlot(
        conversationId,
        projectionTurnId,
        ownerId,
        executionConcurrency.max_concurrent_conversations,
      );
      if (!acquired.capacityReady) {
        const released =
          await this.deleteUnacquiredMissingStartIntent(startIntent);
        if (!released) throw new RunnerStartOperationUncertainError();
        const unavailable = new AppError("RUNNER_UNAVAILABLE");
        throw unavailable;
      }
      if (!acquired.acquired) {
        await this.prisma.conversationTurnStartIntent.deleteMany({
          where: {
            projectionTurnId,
            ownerId,
            conversationId,
            runtimeGeneration: startIntent.runtimeGeneration,
            runnerStatus: "slot_pending",
          },
        });
        if (pendingId) {
          const update = await this.prisma.$transaction(async (tx) => {
            const pending = await tx.pendingRequest.update({
              where: { id: pendingId },
              data: {
                status: "blocked_overload",
                blockCode: null,
                lastStartCheckedAt: new Date(),
              },
            });
            const sequenceNo = await nextConversationEventSequence(
              tx,
              conversationId,
            );
            const event = await tx.conversationEvent.create({
              data: {
                conversationId,
                sequenceNo,
                eventType: "conversation.pending_request.updated",
                visibility: "user_visible",
                payloadJson: {
                  schema_version: 1,
                  pending_request_id: pending.id,
                  status: pending.status,
                  block_code: null,
                  queue_no: Number(pending.queueNo),
                  last_start_checked_at:
                    pending.lastStartCheckedAt?.toISOString() ?? null,
                },
                sseEventId: `${conversationId}:${sequenceNo}`,
              },
            });
            return event;
          });
          await this.redis
            .publishConversationEvent(
              conversationId,
              projectStoredEvent(update),
            )
            .catch(() => undefined);
        } else if (!regeneration && !preservesStagedAttachments) {
          await this.audit.write({
            ...context,
            actorId: ownerId,
            action: "conversation_run_rejected_overload",
            targetType: "conversation",
            targetId: conversationId,
            result: "rejected",
            metadata: {
              conversation_id: conversationId,
              current_running_count: acquired.count,
              max_concurrent_conversations:
                executionConcurrency.max_concurrent_conversations,
            },
          });
        } else {
          throw new AppError("CONVERSATION_OVERLOADED");
        }
        throw new AppError("CONVERSATION_OVERLOADED");
      }

      try {
        startIntent = await this.markStartIntentSlotAcquired(startIntent);
      } catch {
        await this.audit
          .write({
            ...context,
            actorId: ownerId,
            action: "codex_turn_projection_recovery_failed",
            targetType: "conversation",
            targetId: conversationId,
            result: "failed",
            metadata: { reason_code: "TURN_PROJECTION_UNAVAILABLE" },
          })
          .catch(() => undefined);
        throw new RunnerStartOperationUncertainError();
      }

      let runnerTurn: StartedRunnerTurn | undefined;
      const modelTransitionSource = await this.modelTransitionSourceForIntent(
        startIntent,
        modelRuntime.model,
        conversation.codexThreadId,
      );
      const runnerStartInput = buildRunnerStartInputFromIntent(
        startIntent,
        conversation.codexThreadId,
        resolved.capabilities,
        resolved.environment ?? {},
        modelRuntime,
        modelTransitionSource,
        executionConcurrency,
      );
      try {
        if (returnWhenAccepted) {
          await this.runner.acceptStartTurn(runnerStartInput);
          this.trackAcceptedStartRecovery(projectionTurnId);
          return startReceipt(projectionTurnId, "starting");
        }

        const startedTurn = await this.runner.startTurn(runnerStartInput);
        runnerTurn = startedTurn;
        startIntent = await this.recordSucceededStartIntent(
          startIntent,
          startedTurn,
        );

        let projection;
        try {
          projection = await this.persistStartProjection(
            startIntent,
            startedTurn,
          );
        } catch {
          await this.runner.reconcile({
            conversationId,
            ownerId,
            expectedRuntimeGeneration: runtime.runtimeGeneration,
            capabilityGeneration: resolved.capabilityGeneration,
            mcpGeneration: resolved.mcpGeneration ?? EMPTY_MCP_GENERATION,
            mcpServers: resolved.mcpServers ?? [],
            codexThreadId: startedTurn.codexThreadId,
            codexTurnId: startedTurn.codexTurnId,
            projectionTurnId,
            taskKind: startIntent.taskKind,
            collaborationMode: runnerStartInput.collaborationMode,
            capabilities: projectRunnerCapabilities(resolved.capabilities),
            environment: resolved.environment ?? {},
            model: modelRuntime.model,
            ...(runnerStartInput.modelTransitionSource
              ? {
                  modelTransitionSource:
                    runnerStartInput.modelTransitionSource,
                }
              : {}),
            reasoningEffort: modelRuntime.reasoningEffort,
            modelProvider: modelRuntime.provider,
          });
          projection = await this.persistStartProjection(
            startIntent,
            startedTurn,
          );
        }
        const turn = projection.created;
        await this.publishAttachedStartEvents(conversationId, projection);
        return projectTurn(turn);
      } catch (error) {
        if (
          !runnerTurn &&
          !(error instanceof RunnerStartOperationUncertainError)
        ) {
          let releasing: TurnStartIntent;
          try {
            releasing = await this.markStartIntentForRelease(startIntent);
          } catch {
            const uncertain = new RunnerStartOperationUncertainError();
            await this.audit
              .write({
                ...context,
                actorId: ownerId,
                action: "codex_turn_projection_recovery_failed",
                targetType: "conversation",
                targetId: conversationId,
                result: "failed",
                metadata: { reason_code: "TURN_PROJECTION_UNAVAILABLE" },
              })
              .catch(() => undefined);
            await this.recordPendingStartBlock(
              conversationId,
              pendingId,
              uncertain,
            );
            throw uncertain;
          }
          await this.finishReleasePendingStartIntent(releasing).catch(
            () => undefined,
          );
        } else {
          await this.audit
            .write({
              ...context,
              actorId: ownerId,
              action: "codex_turn_projection_recovery_failed",
              targetType: "conversation",
              targetId: conversationId,
              result: "failed",
              metadata: { reason_code: "TURN_PROJECTION_UNAVAILABLE" },
            })
            .catch(() => undefined);
        }
        await this.recordPendingStartBlock(conversationId, pendingId, error);
        throw error;
      }
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, lock)
        .catch(() => undefined);
    }
  }

  private async withActiveUserLifecycleLock<T>(
    userId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    let token: string | null = null;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      token = await this.redis.acquireUserLifecycleLock(userId, 120_000);
      if (token) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!token) throw new AppError("CONFLICT");
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });
      if (!user || user.status !== "active")
        throw new AppError("USER_DISABLED");
      return await action();
    } finally {
      await this.redis
        .releaseUserLifecycleLock(userId, token)
        .catch(() => undefined);
    }
  }

  private async acquireConversationLock(
    conversationId: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const token = await this.redis.acquireConversationLock(
        conversationId,
        120_000,
      );
      if (token) return token;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new AppError("CONFLICT");
  }
}

async function copyForkWorkspaceFiles(input: {
  workspaceRoot: string;
  ownerId: string;
  sourceConversationId: string;
  targetConversationId: string;
  relativePaths: readonly string[];
}): Promise<void> {
  const targetWorkspace = resolveConversationWorkspaceRoot(
    input.workspaceRoot,
    input.ownerId,
    input.targetConversationId,
  );
  const uniqueRelativePaths = [...new Set(input.relativePaths)].sort();
  for (const relativePath of uniqueRelativePaths) {
    const sourcePath = resolveConversationWorkspaceEntry(
      input.workspaceRoot,
      input.ownerId,
      input.sourceConversationId,
      relativePath,
    );
    const destinationPath = resolveConversationWorkspaceEntry(
      input.workspaceRoot,
      input.ownerId,
      input.targetConversationId,
      relativePath,
    );
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new AppError("CONFLICT");
    }
    await access(sourcePath, constants.R_OK);
    if (dirname(destinationPath) !== targetWorkspace) {
      await ensureSharedWorkspaceDirectory(
        targetWorkspace,
        dirname(destinationPath),
      );
    }
    await copyFile(sourcePath, destinationPath);
    await chmod(
      destinationPath,
      sourceInfo.mode & 0o111
        ? workspacePermissionPolicy.sharedExecutableFile
        : workspacePermissionPolicy.sharedWritableFile,
    );
  }
}

function mergeConversationDetailEvents(
  recentEvents: ConversationDetailEventRow[],
  supplementalEvents: ConversationDetailEventRow[],
): ConversationDetailEventRow[] {
  const eventsById = new Map<string, ConversationDetailEventRow>();
  for (const event of [...recentEvents, ...supplementalEvents]) {
    eventsById.set(event.id, event);
  }
  return [...eventsById.values()].sort((left, right) => {
    if (left.sequenceNo === right.sequenceNo) {
      return left.id.localeCompare(right.id);
    }
    return left.sequenceNo < right.sequenceNo ? -1 : 1;
  });
}

function isSupersededPlanOutputMissingEvent(
  event: ConversationDetailEventRow,
  planReviewTurnIds: ReadonlySet<string>,
): boolean {
  return (
    event.eventType === "conversation.error" &&
    event.turnId !== null &&
    planReviewTurnIds.has(event.turnId) &&
    asRecord(event.payloadJson).error_code ===
      PLAN_OUTPUT_MISSING_ERROR_CODE
  );
}

type NativeTerminalTurnStatus = {
  status: (typeof TERMINAL_TURN_STATUSES)[number];
  completedAt: Date;
};

function indexNativeTerminalTurnStatuses(
  detailEvents: readonly ConversationDetailEventRow[],
): ReadonlyMap<string, NativeTerminalTurnStatus> {
  const statuses = new Map<string, NativeTerminalTurnStatus>();
  for (const event of detailEvents) {
    if (event.eventType !== "turn/completed" || !event.turnId) continue;
    const payload = asRecord(event.payloadJson);
    if (
      payload.source !== "codex_app_server" ||
      payload.method !== "turn/completed"
    ) {
      continue;
    }
    const status = asRecord(asRecord(payload.params).turn).status;
    if (
      status !== "completed" &&
      status !== "failed" &&
      status !== "interrupted"
    ) {
      continue;
    }
    statuses.set(event.turnId, { status, completedAt: event.createdAt });
  }
  return statuses;
}

function selectTerminalResumeCursor(
  conversationId: string,
  detailEvents: readonly ConversationDetailEventRow[],
  projectedMessageIds: ReadonlySet<string>,
): string | undefined {
  for (const event of detailEvents) {
    if (event.eventType !== "item/completed") continue;
    const payload = asRecord(event.payloadJson);
    if (
      payload.source !== "codex_app_server" ||
      payload.method !== "item/completed"
    ) {
      continue;
    }
    const item = asRecord(asRecord(payload.params).item);
    if (item.type !== "agentMessage" && item.type !== "plan") continue;
    const messageId = asRecord(payload.local).message_id;
    if (
      typeof messageId !== "string" ||
      projectedMessageIds.has(messageId)
    ) {
      continue;
    }
    const beforeMissingProjection =
      event.sequenceNo > 0n ? event.sequenceNo - 1n : 0n;
    return `${conversationId}:${beforeMissingProjection}`;
  }
  return detailEvents.at(-1)?.sseEventId;
}

function selectRunningResumeAnchor(
  detailEvents: ConversationDetailEventRow[],
  runningTurnId: string,
): ConversationDetailEventRow | undefined {
  const turnEvents = detailEvents.filter(
    (event) => event.turnId === runningTurnId,
  );
  const startedMessages = new Map<string, ConversationDetailEventRow>();
  const completedMessages = new Set<string>();

  for (const event of turnEvents) {
    const lifecycle = nativeMessageLifecycle(event);
    if (!lifecycle) continue;
    if (lifecycle.method === "item/started") {
      startedMessages.set(lifecycle.itemId, event);
    }
    if (lifecycle.method === "item/completed") {
      completedMessages.add(lifecycle.itemId);
    }
  }

  const latestOpenMessageStart = [...startedMessages.entries()]
    .filter(([itemId]) => !completedMessages.has(itemId))
    .map(([, event]) => event)
    .sort((left, right) => {
      if (left.sequenceNo === right.sequenceNo) {
        return left.id.localeCompare(right.id);
      }
      return left.sequenceNo < right.sequenceNo ? 1 : -1;
    })[0];

  // Running detail snapshots intentionally exclude high-frequency delta rows.
  // If an agent message is still open, resume immediately after its start so
  // the client replays every text delta and never rebuilds a message from the
  // middle of a streamed HTML preview.
  return latestOpenMessageStart ?? [...turnEvents].reverse()[0];
}

function nativeMessageLifecycle(
  event: ConversationDetailEventRow,
): { method: "item/started" | "item/completed"; itemId: string } | null {
  if (event.eventType !== "item/started" && event.eventType !== "item/completed")
    return null;
  const payload = asRecord(event.payloadJson);
  if (payload.method !== event.eventType) return null;
  const params = asRecord(payload.params);
  const item = asRecord(params.item);
  if (
    (item.type !== "agentMessage" && item.type !== "plan") ||
    typeof item.id !== "string"
  ) {
    return null;
  }
  return { method: event.eventType, itemId: item.id };
}

type ConversationProjection = {
  id: string;
  ownerId: string;
  title: string;
  titleSource: string;
  archiveStatus: string;
  archivedAt: Date | null;
  pinnedAt: Date | null;
  sortOrder: number | null;
  codexThreadId: string | null;
  agentsTemplateVersion: string | null;
  collaborationMode: string;
  lastTurnStatus: string | null;
  lastRunAt: Date | null;
  completionUnread: boolean;
  selectedKnowledgeBaseIdsJson: unknown;
  applicationId: string | null;
  applicationNameSnapshot: string | null;
  interactiveApplicationPackageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ConversationCursor = {
  updatedAt: Date;
  id: string;
};

export function parseConversationCursor(
  value: string,
): ConversationCursor | null {
  const separator = value.indexOf("|");
  const updatedAtValue = separator >= 0 ? value.slice(0, separator) : value;
  const id = separator >= 0 ? value.slice(separator + 1) : "";
  const updatedAt = new Date(updatedAtValue);
  if (Number.isNaN(updatedAt.getTime()) || (separator >= 0 && !isUuid(id)))
    return null;
  return {
    updatedAt,
    id: separator >= 0 ? id : "ffffffff-ffff-ffff-ffff-ffffffffffff",
  };
}

function encodeConversationCursor(row: {
  updatedAt: Date;
  id: string;
}): string {
  return `${row.updatedAt.toISOString()}|${row.id}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function projectModelContextUsage(row: ModelContextUsageCursorRow | null) {
  if (!row || row.lastTotalTokens === null) return null;
  return {
    used_tokens: safeTokenCount(row.lastTotalTokens),
    model_context_window:
      row.modelContextWindow === null
        ? null
        : safeTokenCount(row.modelContextWindow),
    updated_at: row.lastObservedAt.toISOString(),
  };
}

function safeTokenCount(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

export function projectConversation(
  row: ConversationProjection,
  executionStatus: string,
  applicationIcon?: ApplicationIcon,
  hasAutomation = false,
) {
  return {
    id: row.id,
    owner_id: row.ownerId,
    title: projectTaskTitle(row.title, row.titleSource),
    title_source: row.titleSource,
    archive_status: row.archiveStatus,
    archived_at: row.archivedAt?.toISOString() ?? null,
    pinned_at: row.pinnedAt?.toISOString() ?? null,
    sort_order: row.sortOrder,
    codex_thread_id: row.codexThreadId,
    agents_template_version: row.agentsTemplateVersion,
    collaboration_mode: conversationCollaborationModeSchema.parse(
      row.collaborationMode,
    ),
    last_turn_status: row.lastTurnStatus,
    execution_status: executionStatus,
    last_run_at: row.lastRunAt?.toISOString() ?? null,
    has_unread_completion: row.completionUnread,
    has_automation: hasAutomation,
    selected_knowledge_base_ids: jsonStringArray(
      row.selectedKnowledgeBaseIdsJson,
    ),
    application:
      row.applicationId && row.applicationNameSnapshot
        ? {
            id: row.applicationId,
            name: row.applicationNameSnapshot,
            kind: row.interactiveApplicationPackageId
              ? ("interactive" as const)
              : ("standard" as const),
            package_id: row.interactiveApplicationPackageId ?? null,
            ...(applicationIcon ? { icon: applicationIcon } : {}),
          }
        : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function projectTaskTitle(
  title: string,
  titleSource: ConversationProjection["titleSource"],
): string {
  if (titleSource !== "fallback") return title;
  if (title === "未命名对话") return "未命名任务";
  if (title === "Untitled conversation") return "Untitled task";
  const annotation = inspectOfficeAnnotationPrompt(title);
  if (annotation.suspected) {
    return annotation.request?.trim()
      ? fallbackTitle(annotation.request)
      : "未命名任务";
  }
  return title;
}

function projectPending(row: {
  id: string;
  conversationId: string;
  queueNo: bigint;
  submittedBy: string;
  inputText: string;
  priorityCapabilityIdsJson: unknown;
  knowledgeBaseIdsJson: unknown;
  collaborationMode: string;
  status: string;
  blockCode: string | null;
  idempotencyKey: string | null;
  lastStartCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const inspected = inspectOfficeAnnotationPrompt(row.inputText);
  return {
    id: row.id,
    conversation_id: row.conversationId,
    queue_no: Number(row.queueNo),
    submitted_by: row.submittedBy,
    input_text: inspected.suspected ? (inspected.request ?? "") : row.inputText,
    ...(inspected.display ? { display: inspected.display } : {}),
    priority_capability_ids: jsonStringArray(row.priorityCapabilityIdsJson),
    knowledge_base_ids: jsonStringArray(row.knowledgeBaseIdsJson),
    collaboration_mode: conversationCollaborationModeSchema.parse(
      row.collaborationMode,
    ),
    status: row.status,
    block_code: row.blockCode,
    idempotency_key: row.idempotencyKey,
    last_start_checked_at: row.lastStartCheckedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function projectUserInputRequest(row: {
  id: string;
  conversationId: string;
  turnId: string;
  codexItemId: string;
  requestKind: string;
  questionsJson: unknown;
  serverName: string | null;
  messageText: string | null;
  formSchemaJson: unknown;
  formUiHintsJson: unknown;
  formResponseSemanticsJson: unknown;
  responseContentJson: unknown;
  status: string;
  autoResolveAt: Date | null;
  resolvedAction: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const common = {
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    item_id: row.codexItemId,
    status: z
      .enum(["pending", "answering", "answered", "expired", "cancelled"])
      .parse(row.status),
    auto_resolve_at: row.autoResolveAt?.toISOString() ?? null,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    resolved_action: z
      .enum(["accept", "decline", "cancel"])
      .nullable()
      .parse(row.resolvedAction),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
  if (row.requestKind === "questions") {
    return {
      ...common,
      kind: "questions" as const,
      questions: z.array(conversationUserInputQuestionSchema).parse(
        row.questionsJson,
      ),
    };
  }
  if (
    row.requestKind !== "form" ||
    row.serverName === null ||
    row.messageText === null
  ) {
    throw new AppError("INTERNAL_ERROR");
  }
  return {
    ...common,
    kind: "form" as const,
    server_name: row.serverName,
    message: row.messageText,
    requested_schema: conversationFormRequestedSchema.parse(
      row.formSchemaJson,
    ),
    ui_hints: conversationFormUiHintsSchema.parse(row.formUiHintsJson),
    response_semantics: conversationFormResponseSemanticsSchema.parse(
      row.formResponseSemanticsJson,
    ),
    response_content: conversationFormResponseContentSchema
      .nullable()
      .parse(row.responseContentJson),
  };
}

function projectPlanReview(row: {
  id: string;
  conversationId: string;
  sourceTurnId: string;
  planMessageId: string;
  status: string;
  decision: string | null;
  followUpTurnId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    source_turn_id: row.sourceTurnId,
    plan_message_id: row.planMessageId,
    status: conversationPlanReviewStatusSchema.parse(row.status),
    decision: conversationPlanReviewActionSchema.nullable().parse(row.decision),
    follow_up_turn_id: row.followUpTurnId,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function validateConversationUserInputResponse(
  stored: {
    requestKind: string;
    questionsJson: unknown;
    formSchemaJson: unknown;
  },
  response: ConversationUserInputResponse,
): void {
  if (response.action !== "accept") return;
  if (stored.requestKind === "form") {
    const schema = conversationFormRequestedSchema.parse(stored.formSchemaJson);
    if (!conversationFormResponseMatchesSchema(schema, response.content)) {
      throw new AppError("VALIDATION_ERROR");
    }
    return;
  }
  if (stored.requestKind !== "questions") {
    throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
  }
  const answers = Object.fromEntries(
    Object.entries(response.content).map(([fieldId, value]) => [
      fieldId,
      typeof value === "string" ? [value] : [],
    ]),
  );
  const questions = z
    .array(conversationUserInputQuestionSchema)
    .min(1)
    .max(3)
    .parse(stored.questionsJson);
  const ids = questions.map((question) => question.id);
  if (
    new Set(ids).size !== ids.length ||
    JSON.stringify([...ids].sort()) !== JSON.stringify(Object.keys(answers).sort())
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  for (const question of questions) {
    const values = answers[question.id];
    const answer = values?.[0];
    if (!values || values.length !== 1 || !answer || !answer.trim()) {
      throw new AppError("VALIDATION_ERROR");
    }
    const labels = new Set(question.options?.map((option) => option.label) ?? []);
    if (!labels.has(answer) && !question.is_other) {
      throw new AppError("VALIDATION_ERROR");
    }
  }
}

function projectTurn(row: {
  id: string;
  conversationId: string;
  sequenceNo: number;
  submittedBy: string;
  codexThreadId: string;
  codexTurnId: string;
  status: string;
  taskKind?: string;
  collaborationMode: string;
  submitMode: string;
  idempotencyKey: string | null;
  knowledgeBaseIdsJson: unknown;
  model: string | null;
  reasoningEffort: string | null;
  startedAt: Date;
  completedAt: Date | null;
  interruptRequestedAt: Date | null;
  interruptedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    sequence_no: row.sequenceNo,
    submitted_by: row.submittedBy,
    codex_thread_id: row.codexThreadId,
    codex_turn_id: row.codexTurnId,
    status: row.status,
    task_kind: row.taskKind ?? "turn",
    collaboration_mode: conversationCollaborationModeSchema.parse(
      row.collaborationMode,
    ),
    submit_mode: row.submitMode,
    idempotency_key: row.idempotencyKey,
    knowledge_base_ids: jsonStringArray(row.knowledgeBaseIdsJson),
    model: row.model,
    reasoning_effort: row.reasoningEffort,
    started_at: row.startedAt.toISOString(),
    completed_at: row.completedAt?.toISOString() ?? null,
    interrupt_requested_at: row.interruptRequestedAt?.toISOString() ?? null,
    interrupted_at: row.interruptedAt?.toISOString() ?? null,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function startReceipt(
  turnId: string,
  status: TurnStartReceipt["status"],
): TurnStartReceipt {
  return { turn_id: turnId, accepted: true, status };
}

const MAXIMUM_PRESENTATION_SELECTED_TEXT_LENGTH = 4_000;

function formatPresentationCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function quotePresentationValue(value: string): string {
  return JSON.stringify(value);
}

function buildPresentationAnnotationSection(
  annotation: PresentationAnnotation,
  fileId: string,
  fileName: string,
  annotationIndex: number,
): string {
  const selectedContent = annotation.elements
    .flatMap((element) => (element.text ? [element.text] : []))
    .join("\n\n")
    .slice(0, MAXIMUM_PRESENTATION_SELECTED_TEXT_LENGTH)
    .trim();
  const elementLines = annotation.elements.map((element, index) => {
    const fields = [
      `type=${quotePresentationValue(element.type)}`,
      `elementId=${quotePresentationValue(element.element_id)}`,
      ...(element.shape_id
        ? [`shapeId=${quotePresentationValue(element.shape_id)}`]
        : []),
      ...(element.name ? [`name=${quotePresentationValue(element.name)}`] : []),
      `bounds=(${formatPresentationCoordinate(element.bounds.x)},${formatPresentationCoordinate(element.bounds.y)},${formatPresentationCoordinate(element.bounds.width)},${formatPresentationCoordinate(element.bounds.height)})`,
    ];
    return `${index + 1}. ${fields.join("; ")}`;
  });
  const locator = [
    `fileId=${quotePresentationValue(fileId)}`,
    `slide=${annotation.slide_number}`,
    ...elementLines,
  ].join("\n");
  const selectedContentSection = selectedContent
    ? `\n\nSelected content:\n${selectedContent}`
    : "";

  return `Annotation ${annotationIndex + 1}:\nUser request:\n${annotation.request}\n\nApply this request to the selected elements in presentation ${quotePresentationValue(fileName)}, slide ${annotation.slide_number}.\n\nElement locator:\n${locator}${selectedContentSection}`;
}

const MAXIMUM_OFFICE_SELECTED_TEXT_LENGTH = 4_000;
const MAXIMUM_OFFICE_CONTEXT_LENGTH = 1_000;
const MAXIMUM_OFFICE_FORMULA_LENGTH = 2_000;

function matchesAnnotationFile(
  kind: OfficeAnnotationInput["kind"] | UserMessageDisplay["kind"],
  file: { filename: string; mimeType: string | null },
): boolean {
  const lowerName = file.filename.toLocaleLowerCase("en-US");
  switch (kind) {
    case "presentation_annotation":
      return file.mimeType === PPTX_MIME_TYPE && lowerName.endsWith(".pptx");
    case "word_annotation":
      return file.mimeType === DOCX_MIME_TYPE && lowerName.endsWith(".docx");
    case "spreadsheet_annotation":
      return file.mimeType === XLSX_MIME_TYPE && lowerName.endsWith(".xlsx");
    case "html_annotation":
      return (
        file.mimeType === HTML_MIME_TYPE &&
        (lowerName.endsWith(".html") || lowerName.endsWith(".htm"))
      );
  }
}

function assertOfficeAnnotationSemantics(annotation: OfficeAnnotationInput) {
  if (annotation.kind === "word_annotation") {
    for (const item of annotation.annotations) {
      const selection = item.selection;
      const hasInvalidParagraphOrder =
        selection.end_paragraph_index < selection.start_paragraph_index;
      const hasInvalidPositionOrder =
        selection.position_from !== undefined &&
        selection.position_to !== undefined &&
        selection.position_to < selection.position_from;
      if (hasInvalidParagraphOrder || hasInvalidPositionOrder) {
        throw new AppError("VALIDATION_ERROR");
      }
    }
    return;
  }
  if (annotation.kind === "spreadsheet_annotation") {
    for (const item of annotation.annotations) {
      const selection = item.selection;
      if (
        selection.type === "range" &&
        (selection.end_row < selection.start_row ||
          selection.end_column < selection.start_column)
      ) {
        throw new AppError("VALIDATION_ERROR");
      }
    }
  }
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForFingerprint);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, entry]) => [key, canonicalizeForFingerprint(entry)]),
    );
  }
  return value;
}

function officeAnnotationFingerprint(
  annotation: OfficeAnnotationInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalizeForFingerprint({ schema_version: 1, ...annotation }),
      ),
    )
    .digest("hex");
}

function buildWordAnnotationSection(
  annotation: WordAnnotation,
  fileId: string,
  fileName: string,
  annotationIndex: number,
): string {
  const selection = annotation.selection;
  const locator = [
    `fileId=${quotePresentationValue(fileId)}`,
    `paragraphIndex=${selection.start_paragraph_index}`,
    `endParagraphIndex=${selection.end_paragraph_index}`,
    ...(selection.para_id
      ? [`paragraphId=${quotePresentationValue(selection.para_id)}`]
      : []),
    ...(selection.page_number ? [`page=${selection.page_number}`] : []),
    ...(selection.position_from !== undefined
      ? [`positionFrom=${selection.position_from}`]
      : []),
    ...(selection.position_to !== undefined
      ? [`positionTo=${selection.position_to}`]
      : []),
  ].join("\n");
  const selectedContent = selection.selected_text
    .slice(0, MAXIMUM_OFFICE_SELECTED_TEXT_LENGTH)
    .trim();
  const before = selection.before?.slice(-MAXIMUM_OFFICE_CONTEXT_LENGTH).trim();
  const after = selection.after?.slice(0, MAXIMUM_OFFICE_CONTEXT_LENGTH).trim();
  const contextSections = [
    ...(before ? [`Before selection:\n${before}`] : []),
    ...(after ? [`After selection:\n${after}`] : []),
  ];

  return `Annotation ${annotationIndex + 1}:\nUser request:\n${annotation.request}\n\nApply this request to the selected text in Word document ${quotePresentationValue(fileName)}.\n\nSelection locator:\n${locator}\n\nSelected content:\n${selectedContent}${contextSections.length > 0 ? `\n\nNearby context:\n${contextSections.join("\n")}` : ""}`;
}

function formatSpreadsheetChartElement(
  element: SpreadsheetChartElementSelection,
): string {
  const fields = [`kind=${quotePresentationValue(element.kind)}`];
  if (element.kind !== "chart") {
    fields.push(`seriesId=${quotePresentationValue(element.series_id)}`);
    fields.push(`seriesIndex=${element.series_index}`);
  }
  if (element.kind === "point") {
    fields.push(`pointIndex=${element.point_index}`);
  }
  return fields.join("; ");
}

function buildSpreadsheetAnnotationSection(
  annotation: SpreadsheetAnnotation,
  fileId: string,
  fileName: string,
  annotationIndex: number,
): string {
  const selection = annotation.selection;
  const locator = [
    `fileId=${quotePresentationValue(fileId)}`,
    `sheet=${quotePresentationValue(annotation.sheet_name)}`,
    `sheetIndex=${annotation.sheet_index}`,
    `selectionType=${quotePresentationValue(selection.type)}`,
  ];
  const contentSections: string[] = [];
  if (selection.type === "range") {
    locator.push(`range=${quotePresentationValue(selection.range_address)}`);
    locator.push(
      `bounds=(${selection.start_row},${selection.start_column},${selection.end_row},${selection.end_column})`,
    );
    if (selection.active_cell_address) {
      locator.push(
        `activeCell=${quotePresentationValue(selection.active_cell_address)}`,
      );
    }
    const selectedText = selection.selected_text
      ?.slice(0, MAXIMUM_OFFICE_SELECTED_TEXT_LENGTH)
      .trim();
    const selectedFormula = selection.selected_formula
      ?.slice(0, MAXIMUM_OFFICE_FORMULA_LENGTH)
      .trim();
    if (selectedText)
      contentSections.push(`Selected content:\n${selectedText}`);
    if (selectedFormula) {
      contentSections.push(`Selected formula:\n${selectedFormula}`);
    }
  } else {
    locator.push(`objectId=${quotePresentationValue(selection.object_id)}`);
    if (selection.name) {
      locator.push(`name=${quotePresentationValue(selection.name)}`);
    }
    if (selection.type === "image") {
      const description = selection.description
        ?.slice(0, MAXIMUM_OFFICE_CONTEXT_LENGTH)
        .trim();
      if (description) {
        contentSections.push(`Image description:\n${description}`);
      }
    } else {
      locator.push(`chartType=${quotePresentationValue(selection.chart_type)}`);
      if (selection.title) {
        locator.push(`title=${quotePresentationValue(selection.title)}`);
      }
      if (selection.element) {
        locator.push(
          `chartElement=${formatSpreadsheetChartElement(selection.element)}`,
        );
      }
      const formula = selection.formula
        ?.slice(0, MAXIMUM_OFFICE_FORMULA_LENGTH)
        .trim();
      if (formula) contentSections.push(`Selected formula:\n${formula}`);
    }
  }

  return `Annotation ${annotationIndex + 1}:\nUser request:\n${annotation.request}\n\nApply this request to the selected ${selection.type} in Excel workbook ${quotePresentationValue(fileName)}, sheet ${quotePresentationValue(annotation.sheet_name)}.\n\nSelection locator:\n${locator.join("\n")}${contentSections.length > 0 ? `\n\n${contentSections.join("\n\n")}` : ""}`;
}

function buildHtmlAnnotationSection(
  annotation: HtmlAnnotation,
  fileId: string,
  fileName: string,
  annotationIndex: number,
): string {
  const selectedText = annotation.elements
    .flatMap((element) => (element.text ? [element.text] : []))
    .join("\n\n")
    .slice(0, MAXIMUM_OFFICE_SELECTED_TEXT_LENGTH)
    .trim();
  const selectedHtml = annotation.elements
    .flatMap((element) => (element.outer_html ? [element.outer_html] : []))
    .join("\n\n")
    .slice(0, 12_000)
    .trim();
  const locator = [
    `fileId=${quotePresentationValue(fileId)}`,
    ...annotation.elements.map((element, index) => {
      const fields = [
        `tag=${quotePresentationValue(element.tag_name)}`,
        `selector=${quotePresentationValue(element.selector)}`,
        `domPath=${quotePresentationValue(element.dom_path.join("/"))}`,
        ...(element.id ? [`id=${quotePresentationValue(element.id)}`] : []),
        ...(element.class_names.length > 0
          ? [`classes=${quotePresentationValue(element.class_names.join(" "))}`]
          : []),
        `bounds=(${formatPresentationCoordinate(element.bounds.x)},${formatPresentationCoordinate(element.bounds.y)},${formatPresentationCoordinate(element.bounds.width)},${formatPresentationCoordinate(element.bounds.height)})`,
        ...(Object.keys(element.attributes).length > 0
          ? [
              `attributes=${quotePresentationValue(JSON.stringify(element.attributes).slice(0, 2_000))}`,
            ]
          : []),
      ];
      return `${index + 1}. ${fields.join("; ")}`;
    }),
  ].join("\n");
  const contentSections = [
    ...(selectedText ? [`Selected text:\n${selectedText}`] : []),
    ...(selectedHtml ? [`Selected HTML:\n${selectedHtml}`] : []),
  ];

  return `Annotation ${annotationIndex + 1}:\nUser request:\n${annotation.request}\n\nApply this request only to the selected elements in static HTML document ${quotePresentationValue(fileName)}. Preserve all unselected content and do not add executable scripts.\n\nSelection locator:\n${locator}${contentSections.length > 0 ? `\n\n${contentSections.join("\n\n")}` : ""}`;
}

function buildOfficeAnnotationPrompt(
  annotation: OfficeAnnotationInput,
  display: UserMessageDisplay,
): string {
  if (annotation.kind !== display.kind) throw new AppError("VALIDATION_ERROR");

  const sections =
    annotation.kind === "presentation_annotation"
      ? annotation.annotations.map((item, index) =>
          buildPresentationAnnotationSection(
            item,
            annotation.file_id,
            display.file_name,
            index,
          ),
        )
      : annotation.kind === "word_annotation"
        ? annotation.annotations.map((item, index) =>
            buildWordAnnotationSection(
              item,
              annotation.file_id,
              display.file_name,
              index,
            ),
          )
        : annotation.kind === "spreadsheet_annotation"
          ? annotation.annotations.map((item, index) =>
              buildSpreadsheetAnnotationSection(
                item,
                annotation.file_id,
                display.file_name,
                index,
              ),
            )
          : annotation.annotations.map((item, index) =>
              buildHtmlAnnotationSection(
                item,
                annotation.file_id,
                display.file_name,
                index,
              ),
            );
  const fingerprint = officeAnnotationFingerprint(annotation);
  const requestText = officeAnnotationRequestText(annotation);

  return `${OFFICE_ANNOTATION_PROMPT_MARKER}\nDisplay metadata:\n${JSON.stringify(display)}\n\nAnnotation fingerprint:\n${fingerprint}\n\nUser request:\n${requestText}\n\nApply each numbered user request only to its corresponding numbered annotation in ${quotePresentationValue(display.file_name)}.\n\nAnnotations:\n\n${sections.join("\n\n")}
`;
}

type UserMessageDisplayIndex = {
  displays: Map<string, UserMessageDisplay>;
  invalidMessageIds: Set<string>;
  invalidTurnIds: Set<string>;
};

type StoredConversationEvent = {
  id: string;
  conversationId: string;
  turnId: string | null;
  sequenceNo: bigint;
  eventType: string;
  visibility: string;
  payloadJson: unknown;
  sseEventId: string;
  createdAt: Date;
};

function indexStopHookSupersededAssistantMessageIds(
  rows: Array<{ turnId: string | null; payloadJson: unknown }>,
  planReviewTurnIds: ReadonlySet<string>,
): Set<string> {
  const messageIds = new Set<string>();
  for (const row of rows) {
    if (!row.turnId || !planReviewTurnIds.has(row.turnId)) continue;
    const payload = asRecord(row.payloadJson);
    const params = asRecord(payload.params);
    const run = asRecord(params.run);
    const local = asRecord(payload.local);
    if (
      payload.method === "hook/completed" &&
      run.eventName === "stop" &&
      run.status === "blocked" &&
      typeof params.supersededItemId === "string" &&
      typeof local.superseded_item_id === "string" &&
      params.supersededItemId === local.superseded_item_id &&
      typeof local.superseded_message_id === "string" &&
      isUuid(local.superseded_message_id)
    ) {
      messageIds.add(local.superseded_message_id);
    }
  }
  return messageIds;
}

type UserMessageProjection = {
  contentText: string;
  display: UserMessageDisplay | null;
  selectedCapabilities: UserMessageCapability[];
};

function indexUserMessageDisplays(
  rows: Array<{ turnId: string | null; payloadJson: unknown }>,
): UserMessageDisplayIndex {
  const displays = new Map<string, UserMessageDisplay>();
  const invalidMessageIds = new Set<string>();
  const invalidTurnIds = new Set<string>();
  for (const row of rows) {
    const parsed = userMessageDisplayEventPayloadSchema.safeParse(
      row.payloadJson,
    );
    if (parsed.success) {
      displays.set(parsed.data.message_id, parsed.data.display);
    } else if (
      typeof row.payloadJson === "object" &&
      row.payloadJson !== null &&
      "message_id" in row.payloadJson &&
      typeof row.payloadJson.message_id === "string" &&
      isUuid(row.payloadJson.message_id)
    ) {
      invalidMessageIds.add(row.payloadJson.message_id);
    } else if (row.turnId) {
      invalidTurnIds.add(row.turnId);
    }
  }
  return { displays, invalidMessageIds, invalidTurnIds };
}

function indexPriorityUserMessageCapabilities(
  rows: StoredConversationEvent[],
): Map<string, UserMessageCapability[]> {
  const capabilitiesByTurn = new Map<string, UserMessageCapability[]>();
  for (const row of rows) {
    const parsed = capabilityAttachedEventSchema.safeParse(
      toConversationEventRecord(row),
    );
    if (
      !parsed.success ||
      !parsed.data.payload.priority_requested ||
      parsed.data.turn_id === null
    ) {
      continue;
    }
    const capabilities = capabilitiesByTurn.get(parsed.data.turn_id) ?? [];
    if (
      capabilities.some(
        (capability) => capability.id === parsed.data.payload.capability_id,
      )
    ) {
      continue;
    }
    capabilities.push({
      id: parsed.data.payload.capability_id,
      name: parsed.data.payload.name,
      type: parsed.data.payload.capability_type,
    });
    capabilitiesByTurn.set(parsed.data.turn_id, capabilities);
  }
  return capabilitiesByTurn;
}

function indexFirstUserMessageIds(
  messages: Array<{ id: string; turnId: string | null; role: string }>,
): Set<string> {
  const firstIds = new Set<string>();
  const seenTurnIds = new Set<string>();
  for (const message of messages) {
    if (
      message.role !== "user" ||
      message.turnId === null ||
      seenTurnIds.has(message.turnId)
    ) {
      continue;
    }
    seenTurnIds.add(message.turnId);
    firstIds.add(message.id);
  }
  return firstIds;
}

function resolveUserMessageProjection(
  row: {
    id: string;
    turnId: string | null;
    role: string;
    contentText: string;
  },
  index: UserMessageDisplayIndex,
  files: Array<{ id: string; filename: string; mimeType: string | null }>,
  isFirstUserMessageInTurn: boolean,
  selectedCapabilitiesByTurn: Map<string, UserMessageCapability[]>,
): UserMessageProjection {
  const selectedCapabilities =
    isFirstUserMessageInTurn && row.turnId !== null
      ? (selectedCapabilitiesByTurn.get(row.turnId) ?? [])
      : [];
  if (row.role !== "user") {
    return {
      contentText: row.contentText,
      display: null,
      selectedCapabilities,
    };
  }
  const storedDisplay = index.displays.get(row.id) ?? null;
  const inspected = inspectOfficeAnnotationPrompt(row.contentText);
  if (storedDisplay && !inspected.suspected) {
    return { contentText: "", display: null, selectedCapabilities };
  }
  if (inspected.display) {
    const canonicalFile = files.find(
      (file) =>
        file.id === inspected.display?.file_id &&
        matchesAnnotationFile(inspected.display.kind, file),
    );
    if (canonicalFile) {
      const display = {
        ...inspected.display,
        file_name: canonicalFile.filename,
      };
      return {
        contentText: officeAnnotationRequestText(display),
        display,
        selectedCapabilities,
      };
    }
    return {
      contentText: inspected.request ?? "",
      display: null,
      selectedCapabilities,
    };
  }
  if (
    inspected.suspected ||
    index.invalidMessageIds.has(row.id) ||
    (isFirstUserMessageInTurn &&
      row.turnId !== null &&
      index.invalidTurnIds.has(row.turnId))
  ) {
    return {
      contentText: inspected.request ?? "",
      display: null,
      selectedCapabilities,
    };
  }
  return { contentText: row.contentText, display: null, selectedCapabilities };
}

function projectMessage(
  row: {
    id: string;
    conversationId: string;
    turnId: string | null;
    sequenceNo: number;
    role: string;
    contentText: string;
    createdAt: Date;
    updatedAt: Date;
  },
  projection: UserMessageProjection = {
    contentText: row.contentText,
    display: null,
    selectedCapabilities: [],
  },
  selectedKnowledgeBaseIds: string[] = [],
  knowledgeCitations: PublicKnowledgeCitation[] = [],
  steerMetadata?: {
    usageType: "steer_current_turn";
    eventSequenceNo: number;
  },
) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    sequence_no: row.sequenceNo,
    role: row.role,
    content_text: projection.contentText,
    ...(steerMetadata
      ? {
          usage_type: steerMetadata.usageType,
          event_sequence_no: steerMetadata.eventSequenceNo,
        }
      : {}),
    display: projection.display,
    selected_capabilities: projection.selectedCapabilities,
    ...(row.role === "user"
      ? { selected_knowledge_base_ids: selectedKnowledgeBaseIds }
      : {}),
    ...(row.role === "assistant"
      ? { knowledge_citations: knowledgeCitations }
      : {}),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function projectFile(row: {
  id: string;
  conversationId: string;
  pendingRequestId: string | null;
  turnId: string | null;
  kind: string;
  source: string;
  status: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: bigint;
  checksumSha256: string | null;
  storageBackend: string;
  workspaceRelativePath: string | null;
  downloadable: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    pending_request_id: row.pendingRequestId,
    turn_id: row.turnId,
    kind: row.kind,
    source: row.source,
    status: row.status,
    filename: row.filename,
    mime_type: row.mimeType,
    size_bytes: Number(row.sizeBytes),
    checksum_sha256: row.checksumSha256,
    storage_backend: row.storageBackend,
    workspace_relative_path: row.workspaceRelativePath,
    downloadable: row.downloadable,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toConversationEventRecord(row: StoredConversationEvent) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    sequence_no: Number(row.sequenceNo),
    event_type: row.eventType,
    visibility: row.visibility,
    payload: asRecord(row.payloadJson),
    sse_event_id: row.sseEventId,
    created_at: row.createdAt.toISOString(),
  };
}

function projectStoredEvent(row: StoredConversationEvent) {
  return conversationEventSchema.parse(toConversationEventRecord(row));
}

function projectActivity(row: {
  id: string;
  turnId: string | null;
  eventType: string;
  payloadJson: unknown;
  createdAt: Date;
}) {
  if (row.eventType === "conversation.error" && row.turnId === null) {
    return null;
  }
  if (
    !row.eventType.includes(".step.") &&
    !row.eventType.includes(".tool.") &&
    !row.eventType.includes(".capability.") &&
    row.eventType !== "conversation.system_capability.used" &&
    row.eventType !== "conversation.reconnect" &&
    row.eventType !== "conversation.error"
  ) {
    return null;
  }
  const payload = asRecord(row.payloadJson);
  return {
    id: row.id,
    turn_id: row.turnId,
    item_id: typeof payload.item_id === "string" ? payload.item_id : undefined,
    type: row.eventType,
    action: typeof payload.action === "string" ? payload.action : undefined,
    message_key:
      typeof payload.message_key === "string" ? payload.message_key : undefined,
    capability_name:
      typeof payload.name === "string"
        ? payload.name
        : typeof payload.capability_name === "string"
          ? payload.capability_name
          : undefined,
    status: typeof payload.status === "string" ? payload.status : undefined,
    created_at: row.createdAt.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseTurnStartIntent(value: unknown): TurnStartIntent {
  return turnStartIntentSchema.parse(value);
}

function goalSnapshotForStart(
  intent: TurnStartIntent,
  startedTurn: StartedRunnerTurn,
): RunnerCodexGoal | null {
  if (intent.taskKind !== "goal") return null;
  if (!intent.goalObjective) throw new AppError("INTERNAL_ERROR");
  if (!startedTurn.goal) throw new RunnerStartOperationUncertainError();
  if (
    startedTurn.goal.threadId !== startedTurn.codexThreadId ||
    startedTurn.goal.objective !== intent.goalObjective
  ) {
    throw new AppError("CONFLICT");
  }
  return startedTurn.goal;
}

function turnProjectionUnavailableError(): AppError {
  return new AppError("INTERNAL_ERROR", {
    reason_code: "TURN_PROJECTION_UNAVAILABLE",
  });
}

function snapshotStartIntentCapabilities(
  capabilities: ExecutionCapability[],
): TurnStartIntent["capabilitiesJson"] {
  return capabilities.map(
    ({
      id,
      type,
      name,
      revision,
      credentialEnvironment,
      description,
      sourceType,
      sourceOwnerId,
    }) => ({
      id,
      type,
      name,
      revision,
      ...(credentialEnvironment ? { credentialEnvironment } : {}),
      description,
      sourceType:
        sourceType === "url" ||
        sourceType === "marketplace" ||
        sourceType === "clawhub"
          ? sourceType
          : "local",
      ...(sourceOwnerId ? { sourceOwnerId } : {}),
    }),
  );
}

function buildRunnerStartInputFromIntent(
  intent: TurnStartIntent,
  codexThreadId: string | null,
  capabilities: Array<{
    id: string;
    name: string;
    type: "plugin" | "skill";
    revision: string;
    credentialEnvironment?: Record<string, string> | undefined;
    description: string | null;
  }>,
  environment: Record<string, string>,
  modelRuntime: ResolvedModelRuntime,
  modelTransitionSource: ResolvedModelTransitionRuntime | null,
  executionConcurrency: ResolvedExecutionConcurrencySettings,
): RunnerStartInput {
  const runnerContext = buildOfficeAnnotationRunnerContext(intent.inputText);
  const isCompact = intent.taskKind === "compact";
  return {
    conversationId: intent.conversationId,
    appServerProcessLimit:
      executionConcurrency.runner_app_server_process_limit,
    collaborationMode: intent.collaborationMode,
    projectionTurnId: intent.projectionTurnId,
    ...(isCompact ? { operationKind: "compact" as const } : {}),
    ownerId: intent.ownerId,
    expectedRuntimeGeneration: intent.runtimeGeneration,
    capabilityGeneration: isCompact
      ? EMPTY_MCP_GENERATION
      : intent.capabilityGeneration,
    mcpGeneration: isCompact ? EMPTY_MCP_GENERATION : intent.mcpGeneration,
    mcpServers: isCompact ? [] : intent.mcpServersJson,
    codexThreadId,
    ...(intent.regenerationJson
      ? { forkFromCodexTurnId: intent.regenerationJson.codexTurnId }
      : {}),
    ...(!isCompact && modelTransitionSource ? { modelTransitionSource } : {}),
    ...(intent.taskKind === "goal" && intent.goalObjective
      ? {
          goal: {
            objective: intent.goalObjective,
            tokenBudget:
              intent.goalTokenBudget === null
                ? null
                : Number(intent.goalTokenBudget),
          },
        }
      : {}),
    context: {
      userInput: isCompact ? "" : runnerContext.userInput,
      ...(!isCompact && intent.planReviewAction === "implement"
        ? { approvedPlanImplementation: true as const }
        : {}),
      ...(!isCompact && intent.idempotencyKey?.startsWith("automation:")
        ? { requireFinalResponse: true }
        : {}),
      ...(!isCompact && intent.applicationInstructions
        ? { applicationInstructions: intent.applicationInstructions }
        : {}),
      selectedKnowledgeBaseCount: isCompact
        ? 0
        : intent.knowledgeBaseIdsJson.length,
      ...(!isCompact && runnerContext.officeSelectionContext
        ? {
            officeSelectionContext: runnerContext.officeSelectionContext,
          }
        : {}),
      attachments: isCompact
        ? []
        : intent.attachmentsJson.flatMap((file) =>
            file.workspaceRelativePath
              ? [
                  {
                    filename: basename(file.filename),
                    relativePath: file.workspaceRelativePath,
                  },
                ]
              : [],
          ),
      priorityPlugins: isCompact
        ? []
        : runnerPriorityCapabilities(
            intent.priorityCapabilityIdsJson,
            capabilities,
            "plugin",
          ),
      prioritySkills: isCompact
        ? []
        : runnerPriorityCapabilities(
            intent.priorityCapabilityIdsJson,
            capabilities,
            "skill",
          ),
    },
    capabilities: isCompact ? [] : projectRunnerCapabilities(capabilities),
    environment: isCompact ? {} : environment,
    model: modelRuntime.model,
    reasoningEffort: modelRuntime.reasoningEffort,
    modelProvider: modelRuntime.provider,
  };
}

function runnerPriorityCapabilities(
  priorityIds: readonly string[],
  capabilities: Array<{
    id: string;
    name: string;
    type: "plugin" | "skill";
    description: string | null;
  }>,
  type: "plugin" | "skill",
): Array<{ id: string; name: string; description: string | null }> {
  const capabilityById = new Map(
    capabilities.map((capability) => [capability.id, capability] as const),
  );
  return priorityIds.flatMap((id) => {
    const capability = capabilityById.get(id);
    if (capability?.type === type) {
      return [
        {
          id: capability.id,
          name: capability.name,
          description: capability.description,
        },
      ];
    }
    const builtIn = builtInCapabilityDefinitionForId(id);
    return builtIn?.type === type
      ? [{ id, name: builtIn.slug, description: null }]
      : [];
  });
}

function attachedCapabilitiesForStartIntent(intent: TurnStartIntent): Array<{
  id: string;
  type: "plugin" | "skill";
  name: string;
  sourceType: "local" | "url" | "marketplace" | "clawhub" | "builtin";
}> {
  const attached: ReturnType<typeof attachedCapabilitiesForStartIntent> =
    intent.capabilitiesJson.map((capability) => ({
      id: capability.id,
      type: capability.type,
      name: capability.name,
      sourceType: capability.sourceType,
    }));
  const attachedIds = new Set(attached.map((capability) => capability.id));
  for (const id of intent.priorityCapabilityIdsJson) {
    const builtIn = builtInCapabilityDefinitionForId(id);
    if (!builtIn || attachedIds.has(id)) continue;
    attached.push({
      id,
      type: builtIn.type,
      name: builtIn.slug,
      sourceType: "builtin",
    });
    attachedIds.add(id);
  }
  return attached;
}

function snapshotCredentialUsageReceipts(
  receipts: Array<{
    userId: string;
    capabilityId: string;
    credentialIds: string[];
  }>,
  ownerId: string,
): TurnStartIntent["credentialUsageReceiptsJson"] {
  const byCapability = new Map<string, Set<string>>();
  for (const receipt of receipts) {
    const parsed =
      turnStartIntentCredentialUsageReceiptSchema.safeParse(receipt);
    if (!parsed.success || parsed.data.userId !== ownerId) {
      throw new AppError("INTERNAL_ERROR");
    }
    const credentialIds =
      byCapability.get(parsed.data.capabilityId) ?? new Set();
    for (const credentialId of parsed.data.credentialIds) {
      credentialIds.add(credentialId);
    }
    byCapability.set(parsed.data.capabilityId, credentialIds);
  }
  return [...byCapability]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capabilityId, credentialIds]) => ({
      userId: ownerId,
      capabilityId,
      credentialIds: [...credentialIds].sort(),
    }));
}

function snapshotTurnStartAttachment(file: {
  id: string;
  kind: string;
  source: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: bigint;
  checksumSha256: string | null;
  storageBackend: string;
  workspaceRelativePath: string | null;
  minioObjectKey: string | null;
  downloadable: boolean;
  createdBy: string | null;
}): TurnStartIntentAttachment {
  return turnStartIntentAttachmentSchema.parse({
    id: file.id,
    kind: file.kind,
    source: file.source,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes.toString(),
    checksumSha256: file.checksumSha256,
    storageBackend: file.storageBackend,
    workspaceRelativePath: file.workspaceRelativePath,
    minioObjectKey: file.minioObjectKey,
    downloadable: file.downloadable,
    createdBy: file.createdBy,
  });
}

function turnIdempotencyRequestHash(input: {
  inputText: string;
  messageDisplay: UserMessageDisplay | null;
  submitMode: PreparedTurnSubmission["submitMode"];
  priorityCapabilityIds: string[];
  knowledgeBaseIds: string[];
  preservesStagedAttachments: boolean;
  pendingRequestId: string | null;
  regenerationMessageId: string | null;
  taskKind: "turn" | "goal" | "compact";
  collaborationMode: ConversationCollaborationMode;
  goalObjective: string | null;
  goalTokenBudget: number | null;
  planReviewId?: string | null;
  planReviewAction?: "implement" | "revise" | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 3,
        input_text: input.inputText,
        message_display: input.messageDisplay,
        submit_mode: input.submitMode,
        priority_capability_ids: input.priorityCapabilityIds,
        ...(input.knowledgeBaseIds.length > 0
          ? { knowledge_base_ids: input.knowledgeBaseIds }
          : {}),
        preserves_staged_attachments: input.preservesStagedAttachments,
        pending_request_id: input.pendingRequestId,
        regeneration_message_id: input.regenerationMessageId,
        task_kind: input.taskKind,
        collaboration_mode: input.collaborationMode,
        ...(input.planReviewId
          ? {
              plan_review_id: input.planReviewId,
              plan_review_action: input.planReviewAction,
            }
          : {}),
        ...(input.taskKind === "goal"
          ? {
              goal_objective: input.goalObjective,
              goal_token_budget: input.goalTokenBudget,
            }
          : {}),
      }),
    )
    .digest("hex");
}

function planReviewIdempotencyKey(
  reviewId: string,
  action: "implement" | "revise",
  clientIdempotencyKey: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 1,
        plan_review_id: reviewId,
        action,
        client_idempotency_key: clientIdempotencyKey,
      }),
    )
    .digest("hex");
  return `plan-review:${action}:${digest}`;
}

function turnStartIntentIdempotencyRequestHash(
  intent: Pick<
    TurnStartIntent,
    | "inputText"
    | "messageDisplayJson"
    | "submitMode"
    | "priorityCapabilityIdsJson"
    | "knowledgeBaseIdsJson"
    | "preservesStagedAttachments"
    | "pendingRequestId"
    | "regenerationJson"
    | "taskKind"
    | "collaborationMode"
    | "goalObjective"
    | "goalTokenBudget"
    | "planReviewId"
    | "planReviewAction"
  >,
): string {
  return turnIdempotencyRequestHash({
    inputText: intent.inputText,
    messageDisplay: intent.messageDisplayJson,
    submitMode: intent.submitMode,
    priorityCapabilityIds: intent.priorityCapabilityIdsJson,
    knowledgeBaseIds: intent.knowledgeBaseIdsJson,
    preservesStagedAttachments: intent.preservesStagedAttachments,
    pendingRequestId: intent.pendingRequestId,
    regenerationMessageId: intent.regenerationJson?.messageId ?? null,
    taskKind: intent.taskKind,
    collaborationMode: intent.collaborationMode,
    goalObjective: intent.goalObjective,
    goalTokenBudget:
      intent.goalTokenBudget === null ? null : Number(intent.goalTokenBudget),
    planReviewId: intent.planReviewId,
    planReviewAction: intent.planReviewAction,
  });
}

function matchesAttachmentSnapshot(
  expected: TurnStartIntentAttachment[],
  current: Array<{
    id: string;
    kind: string;
    source: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: bigint;
    checksumSha256: string | null;
    storageBackend: string;
    workspaceRelativePath: string | null;
    minioObjectKey: string | null;
    downloadable: boolean;
    createdBy: string | null;
  }>,
): boolean {
  const expectedSorted = [...expected].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const currentSorted = current
    .map(snapshotTurnStartAttachment)
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(expectedSorted) === JSON.stringify(currentSorted);
}

function assertMatchingStartOperation(
  intent: TurnStartIntent,
  operation: RunnerStartOperation | null,
): void {
  if (
    operation &&
    (operation.conversationId !== intent.conversationId ||
      operation.projectionTurnId !== intent.projectionTurnId)
  ) {
    throw new AppError("CONFLICT");
  }
}

function matchesStartIntentSubmission(
  intent: TurnStartIntent,
  input: {
    ownerId: string;
    conversationId: string;
    input: PreparedTurnSubmission;
    preservesStagedAttachments: boolean;
    pendingId?: string;
    regeneration?: RegenerationSource;
    planReviewAction?: PlanReviewTurnAction;
    files: Array<{ id: string }>;
  },
): boolean {
  return (
    intent.ownerId === input.ownerId &&
    intent.conversationId === input.conversationId &&
    intent.inputText === input.input.inputText &&
    intent.taskKind === (input.input.goal ? "goal" : "turn") &&
    intent.collaborationMode === input.input.collaborationMode &&
    intent.goalObjective === (input.input.goal?.objective ?? null) &&
    (intent.goalTokenBudget === null
      ? null
      : Number(intent.goalTokenBudget)) ===
      (input.input.goal?.tokenBudget ?? null) &&
    intent.submitMode === input.input.submitMode &&
    intent.idempotencyKey === (input.input.idempotencyKey ?? null) &&
    intent.preservesStagedAttachments === input.preservesStagedAttachments &&
    intent.pendingRequestId === (input.pendingId ?? null) &&
    intent.planReviewId === (input.planReviewAction?.reviewId ?? null) &&
    intent.planReviewAction === (input.planReviewAction?.action ?? null) &&
    JSON.stringify(intent.priorityCapabilityIdsJson) ===
      JSON.stringify(input.input.priorityCapabilityIds) &&
    JSON.stringify(intent.knowledgeBaseIdsJson) ===
      JSON.stringify(input.input.knowledgeBaseIds) &&
    JSON.stringify(intent.attachmentsJson.map((file) => file.id)) ===
      JSON.stringify(input.files.map((file) => file.id)) &&
    intent.regenerationJson?.messageId === input.regeneration?.messageId &&
    intent.regenerationJson?.turnId === input.regeneration?.turnId &&
    intent.regenerationJson?.codexTurnId === input.regeneration?.codexTurnId
  );
}

function priorityCapabilityIdsFromEvents(payloads: unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of payloads) {
    const payload = asRecord(value);
    if (
      payload.priority_requested === true &&
      typeof payload.capability_id === "string"
    ) {
      ids.add(payload.capability_id);
    }
  }
  return [...ids];
}

async function deleteConversationGraph(
  tx: Prisma.TransactionClient,
  conversationId: string,
) {
  const turnIds = (
    await tx.conversationTurn.findMany({
      where: { conversationId },
      select: { id: true },
    })
  ).map((turn) => turn.id);
  const citations = await tx.conversationMessageKnowledgeCitation.findMany({
    where: { conversationId },
    select: { id: true, documentVersionId: true },
  });
  const citationIds = citations.map((citation) => citation.id);
  const citedVersionIds = [
    ...new Set(citations.map((citation) => citation.documentVersionId)),
  ];
  await tx.conversationShare.deleteMany({ where: { conversationId } });
  await tx.weixinOutboundDelivery.deleteMany({ where: { conversationId } });
  await tx.weixinInboundMessage.deleteMany({ where: { conversationId } });
  await tx.weixinPeerSession.deleteMany({ where: { conversationId } });
  await tx.conversationFile.deleteMany({ where: { conversationId } });
  if (citationIds.length > 0) {
    await tx.conversationMessageKnowledgeCitationAnchor.deleteMany({
      where: { citationId: { in: citationIds } },
    });
  }
  await tx.conversationMessageKnowledgeCitation.deleteMany({
    where: { conversationId },
  });
  await restoreUnreferencedVersionCleanupEligibility(tx, citedVersionIds);
  await tx.conversationEvent.deleteMany({ where: { conversationId } });
  await tx.conversationPlanReview.deleteMany({ where: { conversationId } });
  await tx.conversationMessage.deleteMany({ where: { conversationId } });
  await tx.conversationTurnKnowledgeBase.deleteMany({
    where: { turnId: { in: turnIds } },
  });
  await tx.conversationTurnAttempt.deleteMany({
    where: { turnId: { in: turnIds } },
  });
  await tx.conversationUserInputRequest.deleteMany({
    where: { conversationId },
  });
  await tx.conversationGoal.deleteMany({ where: { conversationId } });
  await tx.conversationTurn.deleteMany({ where: { conversationId } });
  await tx.conversationTurnStartIntent.deleteMany({
    where: { conversationId },
  });
  await tx.pendingRequest.deleteMany({ where: { conversationId } });
  await tx.conversation.delete({ where: { id: conversationId } });
}

async function recordTurnStartedActivity(
  tx: Prisma.TransactionClient,
  turn: {
    id: string;
    conversationId: string;
    submittedBy: string;
    model: string | null;
    startedAt: Date;
  },
) {
  const application = await tx.conversation.findUnique({
    where: { id: turn.conversationId },
    select: {
      applicationId: true,
      applicationNameSnapshot: true,
    },
  });
  await tx.usageActivityRecord.upsert({
    where: {
      activityType_sourceId: {
        activityType: "turn_started",
        sourceId: turn.id,
      },
    },
    create: {
      activityType: "turn_started",
      sourceId: turn.id,
      ownerId: turn.submittedBy,
      conversationId: turn.conversationId,
      applicationId: application?.applicationId ?? null,
      applicationNameSnapshot: application?.applicationNameSnapshot ?? null,
      turnId: turn.id,
      model: turn.model,
      occurredAt: turn.startedAt,
    },
    update: {},
  });
}

async function recordSelectedSkillUsageActivity(
  tx: Prisma.TransactionClient,
  intent: TurnStartIntent,
  turn: {
    id: string;
    startedAt: Date;
  },
) {
  const selectedSkills = selectedSkillsForStartIntent(intent);
  if (selectedSkills.length === 0) return;

  await tx.usageActivityRecord.createMany({
    data: selectedSkills.map((skill) => ({
      activityType: "skill_used",
      sourceId: skillUsageSourceId(turn.id, skill.id),
      ownerId: intent.ownerId,
      conversationId: intent.conversationId,
      turnId: turn.id,
      capabilityId: skill.id,
      capabilityName: skill.name,
      occurredAt: turn.startedAt,
    })),
    skipDuplicates: true,
  });
}

function selectedSkillsForStartIntent(
  intent: TurnStartIntent,
): Array<{ id: string; name: string }> {
  const capabilityById = new Map(
    intent.capabilitiesJson.map((capability) => [capability.id, capability]),
  );
  const selected: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const id of intent.priorityCapabilityIdsJson) {
    if (seen.has(id)) continue;
    const capability = capabilityById.get(id);
    if (capability?.type === "skill") {
      selected.push({ id, name: capability.name });
      seen.add(id);
      continue;
    }
    const builtIn = builtInCapabilityDefinitionForId(id);
    if (builtIn?.type === "skill") {
      selected.push({ id, name: builtIn.slug });
      seen.add(id);
    }
  }

  return selected;
}

function skillUsageSourceId(turnId: string, skillId: string): string {
  return uuidv5(`${turnId}:${skillId}`, SKILL_USAGE_SOURCE_NAMESPACE);
}

function fallbackTitle(input: string): string {
  return truncateConversationTitle(input.replaceAll(/\s+/gu, " ").trim());
}

function jsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mapPreflightBlockCode(code: string): string | null {
  if (
    code === "RUNNER_UNAVAILABLE" ||
    code === "EXECUTION_SERVICE_INCOMPATIBLE" ||
    code === "CAPABILITY_HOME_SYNC_FAILED"
  ) {
    return "runner_unavailable";
  }
  if (code === "CREDENTIAL_BINDING_REQUIRED")
    return "required_credential_unavailable";
  if (code === "CREDENTIAL_BINDING_CONFLICT")
    return "credential_binding_ambiguous";
  if (code === "CAPABILITY_NOT_FOUND") return "priority_capability_unavailable";
  if (code === "ATTACHMENT_UPLOAD_INVALID") return "attachment_unavailable";
  if (code === "TOKEN_LIMIT_EXCEEDED") return "token_limit_exceeded";
  if (code === "VALIDATION_ERROR" || code === "EXECUTION_ENVIRONMENT_INVALID") {
    return "execution_environment_invalid";
  }
  return null;
}

function deterministicUuid(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  if (namespaceBytes.length !== 16) throw new AppError("VALIDATION_ERROR");
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
