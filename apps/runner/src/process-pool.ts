import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  open,
  realpath,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { interruptNativeExecutionForShutdown } from "./codex/native-shutdown.js";

import type { Logger } from "pino";
import { z } from "zod";

import type {
  CodexModelReasoningCatalog,
  ConversationFormRequestedSchema,
  ConversationUserInputResponse,
  ImageGenerationRequest,
  ReasoningEffort,
  ModelProviderProtocolMode,
  ModelTokenPricing,
  RunnerCodexSubAgentDetail,
  RunnerCodexSubAgentSummaries,
  RunnerCodexSubAgentSummary,
  RuntimeMcpServer,
} from "@linksense/shared";
import {
  builtInSkillNames,
  codexModelReasoningCatalogSchema,
  conversationFormAutoResolutionMs,
  conversationFormRequestsSensitiveValue,
  conversationFormResponseSemanticsMatchesSchema,
  conversationFormResponseMatchesSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormUiHintsSchema,
  coreMcpServerKey,
  managedBrowserMcpServerKey,
  modelIdentifierSchema,
  reasoningEffortSchema,
  runnerCodexPreviewLimits,
  skillCreatorArchivePathSchema,
} from "@linksense/shared";

import {
  buildTurnCollaborationMode,
  buildTurnAdditionalContext,
  buildTurnInput,
  type AuthorizedTurnSkill,
  type PlanSkillReference,
  type TurnContextInput,
} from "./context.js";
import { prepareCodexAdditionalContext } from "./codex/additional-context.js";
import {
  blockUnresolvedLocalMarkdownImages,
  projectAssistantMessageAssets,
  projectImageViewAsset,
  type RegisterInlineImageArtifact,
} from "./codex/assistant-message-assets.js";
import {
  CodexJsonRpcClient,
  CodexProtocolError,
  type ChildProcessFactory,
  type CodexClientUnhealthyReason,
} from "./codex/json-rpc-client.js";
import {
  builtInMcpConfigOverrides,
  linkSenseModelProviderConfigOverrides,
  linkSenseSkillConfigOverrides,
  linkSenseModelProviderId,
} from "./codex/runtime-config-overrides.js";
import {
  NativePluginManager,
  type NativePluginActivation,
} from "./codex/native-plugin-manager.js";
import {
  deriveLogicalSubAgentPathLabel,
  deriveSubAgentThreadLabel,
  filterChildOwnedCodexTurns,
  mapCodexNotification,
  mapCodexServerRequest,
  opaqueAgentKey,
  projectCodexSubAgentThread,
  type CodexNotificationProjectionContext,
  type LinkSenseCodexEvent,
} from "./codex/event-mapper.js";
import type {
  CodexThread,
  CodexThreadStatus,
  CodexTurn,
  JsonRpcNotification,
  JsonRpcRequest,
  CollaborationModeListResponse,
  ModelListResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadCompactStartParams,
  ThreadCompactStartResponse,
  ThreadGoal,
  ThreadGoalGetResponse,
  ThreadGoalSetParams,
  ThreadGoalSetResponse,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadRollbackParams,
  ThreadRollbackResponse,
  ThreadStartResponse,
  TurnStartParams,
  AskForApproval,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputResponse,
} from "./codex/protocol.js";
import type { RunnerEventSink } from "./event-sink.js";
import { CurrentUserInfoRequestError } from "./current-user-error.js";
import { FileServiceRequestError } from "./file-service-error.js";
import { ImageGenerationRequestError } from "./image-generation-error.js";
import { InteractiveFormRequestError } from "./interactive-form-error.js";
import { KnowledgeSearchRequestError } from "./knowledge-search-error.js";
import { KnowledgeServiceRequestError } from "./knowledge-service-error.js";
import { SkillCreatorRequestError } from "./skill-creator-error.js";
import { DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS } from "./knowledge-search-timeout.js";
import { coreMcpToolNamesFor } from "./mcp/core-service-registry.js";
import type { UserMcpProxyTarget } from "./mcp/http-egress-proxy.js";
import { encodePersonalStdioDescriptor } from "./mcp/personal-stdio-launcher.js";
import { probePersonalStdioMcp } from "./mcp/personal-stdio-probe.js";
import {
  modelGatewayEnvironmentKey,
  type ModelGatewayLease,
  type ModelGatewayTransitionSource,
  type ModelGatewayRuntime,
} from "./model-gateway/model-gateway.js";
import {
  CorruptStartOperationError,
  StartOperationStore,
  type StartOperationResult,
  type StartOperationState,
} from "./start-operation.js";
import {
  CorruptSteerOperationError,
  SteerOperationStore,
  type SteerOperationState,
} from "./steer-operation.js";
import {
  CapabilityRuntimeManager,
  type CapabilityRuntimeLease,
  type CapabilityRuntimeInput,
  type PreparedCapabilityRuntime,
} from "./workspace/capability-runtime.js";
import {
  WorkspaceManager,
  type EnsuredConversationPaths,
  type PersonalizationSnapshot,
} from "./workspace/workspace-manager.js";

const zeroModelTokenPricing: ModelTokenPricing = {
  input_price_per_million: "0",
  cached_input_price_per_million: "0",
  output_price_per_million: "0",
};
const EMPTY_MCP_GENERATION =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const MODEL_TRANSITION_NONCE_METADATA_KEY = "linksense_transition_nonce";
const LINKSENSE_APPROVAL_POLICY = "never" as const satisfies AskForApproval;
const PLAN_MUTATION_SERVICE_ENVIRONMENT_NAMES = new Set([
  "LINKSENSE_FILE_SERVICE_ENDPOINT",
  "LINKSENSE_FILE_SERVICE_TOKEN",
  "LINKSENSE_IMAGE_GENERATION_ENDPOINT",
  "LINKSENSE_IMAGE_GENERATION_TOKEN",
  "LINKSENSE_SKILL_CREATOR_ENDPOINT",
  "LINKSENSE_SKILL_CREATOR_TOKEN",
]);

export type StartTurnInput = {
  conversationId: string;
  /** Durable start-operation id. Defaults to the projected logical turn id. */
  projectionTurnId: string;
  /** Effective per-worker app-server process limit for this admission. */
  appServerProcessLimit?: number;
  /** Native start operation to execute. Defaults to a regular model turn. */
  operationKind?: "turn" | "compact";
  /** Starts app-server for a persisted control mutation without loading turn capabilities. */
  runtimePurpose?: "control";
  /** Logical LinkSense turn receiving native events and tool side effects. */
  eventProjectionTurnId?: string;
  ownerId: string;
  expectedRuntimeGeneration: string;
  capabilityGeneration: string;
  mcpGeneration?: string;
  mcpServers?: RuntimeMcpServer[];
  codexThreadId?: string | null;
  forkFromCodexTurnId?: string;
  goal?: {
    objective: string;
    tokenBudget?: number | null;
  };
  collaborationMode: "default" | "plan";
  context: TurnContextInput;
  capabilities: CapabilityRuntimeInput[];
  environment: Record<string, string>;
  model: string;
  /** Exact source runtime used for native compaction before a model switch. */
  modelTransitionSource?: {
    model: string;
    provider: {
      revision: number;
      baseUrl: string;
      protocolMode: ModelProviderProtocolMode;
      apiKey: string;
      pricing?: ModelTokenPricing;
      modelContextWindow?: number;
      modelAutoCompactTokenLimit?: number;
    };
  };
  reasoningEffort: ReasoningEffort;
  modelProvider: {
    revision: number;
    baseUrl: string;
    protocolMode: ModelProviderProtocolMode;
    apiKey: string;
    pricing?: ModelTokenPricing;
    modelContextWindow?: number;
    modelAutoCompactTokenLimit?: number;
  };
};

export type SealStartOperationInput = {
  conversationId: string;
  projectionTurnId: string;
  ownerId: string;
  expectedRuntimeGeneration: string;
};

export type ReconcileInput = {
  conversationId: string;
  projectionTurnId: string;
  ownerId: string;
  expectedRuntimeGeneration: string;
  capabilityGeneration: string;
  mcpGeneration?: string;
  mcpServers?: RuntimeMcpServer[];
  codexThreadId: string;
  codexTurnId: string;
  taskKind: "turn" | "goal" | "compact";
  collaborationMode: "default" | "plan";
  capabilities: CapabilityRuntimeInput[];
  environment: Record<string, string>;
  model: string;
  modelTransitionSource?: StartTurnInput["modelTransitionSource"];
  reasoningEffort: ReasoningEffort;
  modelProvider: {
    revision: number;
    baseUrl: string;
    protocolMode: ModelProviderProtocolMode;
    apiKey: string;
    pricing?: ModelTokenPricing;
    modelContextWindow?: number;
    modelAutoCompactTokenLimit?: number;
  };
};

export type ReconcileResult = {
  thread: CodexThread;
  goal: ThreadGoal | null;
};

export type ConfirmRecoveryProjectionInput = {
  conversationId: string;
  ownerId: string;
  projectionTurnId: string;
  capabilityGeneration: string;
};

export type GoalRuntimeInput = Pick<
  StartTurnInput,
  | "conversationId"
  | "projectionTurnId"
  | "ownerId"
  | "expectedRuntimeGeneration"
  | "capabilityGeneration"
  | "mcpGeneration"
  | "mcpServers"
  | "capabilities"
  | "environment"
  | "model"
  | "reasoningEffort"
  | "modelProvider"
> & {
  codexThreadId: string;
};
type AuthorizedRecoveryInput = Omit<GoalRuntimeInput, "codexThreadId"> & {
  codexThreadId?: string | null;
  collaborationMode?: StartTurnInput["collaborationMode"];
  operationKind?: StartTurnInput["operationKind"];
  modelTransitionSource?: StartTurnInput["modelTransitionSource"];
  runtimePurpose?: StartTurnInput["runtimePurpose"];
};

export type PrewarmedConversationRuntime = {
  codexThreadId: string;
  agentsTemplateVersion: string;
  runtimeGeneration: string;
};

export type GoalSetInput = GoalRuntimeInput & {
  objective?: string;
  status?: ThreadGoal["status"];
  tokenBudget?: number | null;
};

export type GoalClearInput = Pick<
  GoalRuntimeInput,
  | "conversationId"
  | "projectionTurnId"
  | "ownerId"
  | "expectedRuntimeGeneration"
  | "codexThreadId"
  | "model"
  | "reasoningEffort"
  | "modelProvider"
>;

export type ForkThreadInput = Omit<GoalClearInput, "codexThreadId"> & {
  sourceConversationId: string;
  sourceCodexThreadId: string;
  throughCodexTurnId: string;
};

export type ForkThreadResult = {
  codexThreadId: string;
  codexTurnIds: string[];
};

export type SubAgentReadRuntimeInput = GoalClearInput & {
  codexTurnId: string;
  authorizedAgentKeys: string[];
};

export type SubAgentDetailReadInput = SubAgentReadRuntimeInput & {
  agentKey: string;
};

export type SteerTurnInput = {
  conversationId: string;
  operationId: string;
  projectionTurnId: string;
  ownerId: string;
  expectedCodexTurnId: string;
  text: string;
};

export type RespondUserInputRequestInput = {
  conversationId: string;
  ownerId: string;
  requestId: number;
  codexThreadId: string;
  codexTurnId: string;
  itemId: string;
  response: ConversationUserInputResponse;
};

export type InteractiveFormRequestInput = {
  message: string;
  requestedSchema: ConversationFormRequestedSchema;
  uiHints: z.infer<typeof conversationFormUiHintsSchema>;
  responseSemantics: z.infer<typeof conversationFormResponseSemanticsSchema>;
};

const skillsListResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          cwd: z.string().min(1),
          skills: z
            .array(
              z
                .object({
                  name: z.string().min(1).max(256),
                  description: z.string().max(4_000).nullable().optional(),
                  path: z.string().min(1).max(4_096),
                  scope: z.enum(["user", "repo", "system", "admin"]),
                  enabled: z.boolean(),
                })
                .passthrough(),
            )
            .max(128),
          errors: z.array(
            z
              .object({
                path: z.string(),
                message: z.string().min(1),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const missingNativeThreadRolloutPattern =
  /^no rollout found for thread id [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RESERVED_LINKSENSE_SKILL_NAMES = new Set<string>(builtInSkillNames);
const SUB_AGENT_THREAD_PAGE_SIZE = 100;
const MAX_SUB_AGENT_THREAD_PAGES = 100;
const PROCESS_EXIT_RETRY_BASE_MS = 100;
const PROCESS_EXIT_RETRY_MAX_MS = 5_000;
const DEFAULT_CODEX_HEALTH_PROBE_TTL_MS = 60_000;
const NATIVE_TURN_REGISTRATION_TIMEOUT_MS = 5_000;
const MODEL_TRANSITION_COMPACTION_TIMEOUT_MS = 180_000;
const SUB_AGENT_THREAD_SOURCE_KINDS = [
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
] as const;

function isMissingNativeThreadRollout(error: unknown): boolean {
  return (
    error instanceof CodexProtocolError &&
    error.code === -32_600 &&
    missingNativeThreadRolloutPattern.test(error.message)
  );
}

async function isPathInside(root: string, candidate: string): Promise<boolean> {
  return (await relativePathInside(root, candidate)) !== null;
}

async function relativePathInside(
  root: string,
  candidate: string,
): Promise<string | null> {
  if (!isAbsolute(candidate)) return null;
  try {
    const [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    const relativePath = relative(canonicalRoot, canonicalCandidate);
    return (
      relativePath !== "" &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath)
    )
      ? relativePath
      : null;
  } catch {
    return null;
  }
}

async function isSamePath(left: string, right: string): Promise<boolean> {
  try {
    const [canonicalLeft, canonicalRight] = await Promise.all([
      realpath(left),
      realpath(right),
    ]);
    return canonicalLeft === canonicalRight;
  } catch {
    return false;
  }
}

function resolvePrioritySkills(
  context: TurnContextInput,
  authorizedSkills: AuthorizedTurnSkill[],
): AuthorizedTurnSkill[] {
  const byName = new Map(
    authorizedSkills.map((skill) => [skill.name, skill] as const),
  );
  const seen = new Set<string>();
  const skills = context.prioritySkills.map(({ name }) => {
    const skill = byName.get(name);
    if (!skill) {
      throw new CodexProtocolError("priority skill is unavailable");
    }
    if (seen.has(name)) {
      throw new CodexProtocolError("priority skill is duplicated");
    }
    seen.add(name);
    return skill;
  });
  // Knowledge selection already carries a server-authorized scope. Reuse its
  // built-in Skill rather than inventing a knowledge:// protocol or inlining
  // the retrieval workflow into every turn's application instructions.
  if (
    (context.selectedKnowledgeBases?.length ?? 0) > 0 &&
    !seen.has("linksense-knowledge-base")
  ) {
    const knowledgeSkill = byName.get("linksense-knowledge-base");
    if (!knowledgeSkill) {
      throw new CodexProtocolError("knowledge-base skill is unavailable");
    }
    skills.push(knowledgeSkill);
  }
  return skills;
}

const MAX_PLAN_SKILL_REFERENCE_CONTENT_BYTES = 56_000;

async function loadPlanSkillReferences(
  skills: AuthorizedTurnSkill[],
): Promise<PlanSkillReference[]> {
  const references: PlanSkillReference[] = [];
  let totalBytes = 0;
  for (const skill of skills) {
    let handle: FileHandle | undefined;
    try {
      handle = await open(skill.path, "r");
      const fileStats = await handle.stat();
      if (!fileStats.isFile() || fileStats.size === 0) {
        throw new CodexProtocolError(
          "priority skill planning reference is unavailable",
        );
      }
      const remainingBytes =
        MAX_PLAN_SKILL_REFERENCE_CONTENT_BYTES - totalBytes;
      if (fileStats.size > remainingBytes) {
        throw new CodexProtocolError(
          "priority skill planning references exceed the context budget",
        );
      }
      const contents = await handle.readFile();
      if (contents.byteLength === 0 || contents.byteLength > remainingBytes) {
        throw new CodexProtocolError(
          contents.byteLength === 0
            ? "priority skill planning reference is unavailable"
            : "priority skill planning references exceed the context budget",
        );
      }
      const content = contents.toString("utf8");
      if (content.trim().length === 0 || content.includes("\0")) {
        throw new CodexProtocolError(
          "priority skill planning reference is unavailable",
        );
      }
      totalBytes += contents.byteLength;
      references.push({
        name: skill.name,
        ...(skill.description !== undefined
          ? { description: skill.description }
          : {}),
        content,
      });
    } catch (error) {
      if (error instanceof CodexProtocolError) throw error;
      throw new CodexProtocolError(
        "priority skill planning reference is unavailable",
      );
    } finally {
      await handle?.close();
    }
  }
  return references;
}

function resolvePriorityPlugins(
  context: TurnContextInput,
  authorizedPlugins: NativePluginActivation[],
): NativePluginActivation[] {
  const byName = new Map(
    authorizedPlugins.map((plugin) => [plugin.name, plugin] as const),
  );
  const seen = new Set<string>();
  return context.priorityPlugins.map(({ name }) => {
    const plugin = byName.get(name);
    if (!plugin) {
      throw new CodexProtocolError("priority plugin is unavailable");
    }
    if (seen.has(name)) {
      throw new CodexProtocolError("priority plugin is duplicated");
    }
    seen.add(name);
    return plugin;
  });
}

export class NativeTurnStartUncertainError extends Error {
  constructor() {
    super("native turn start result is uncertain");
    this.name = "NativeTurnStartUncertainError";
  }
}

export class NativeTurnSteerUncertainError extends Error {
  constructor() {
    super("native turn steer result is uncertain");
    this.name = "NativeTurnSteerUncertainError";
  }
}

export class StartOperationIdempotencyConflictError extends CodexProtocolError {
  constructor() {
    super("start operation idempotency conflict", -1);
    this.name = "StartOperationIdempotencyConflictError";
  }
}

export class StartOperationRuntimeGenerationMismatchError extends CodexProtocolError {
  constructor() {
    super("start operation runtime generation mismatch", -1);
    this.name = "StartOperationRuntimeGenerationMismatchError";
  }
}

export class SteerOperationIdempotencyConflictError extends CodexProtocolError {
  constructor() {
    super("steer operation idempotency conflict", -1);
    this.name = "SteerOperationIdempotencyConflictError";
  }
}

export class SubAgentDetailNotFoundError extends CodexProtocolError {
  constructor() {
    super("subagent detail not found", -1);
    this.name = "SubAgentDetailNotFoundError";
  }
}

export class UserInputRequestUnavailableError extends CodexProtocolError {
  constructor(message = "user-input request is unavailable") {
    super(message, -32_602);
    this.name = "UserInputRequestUnavailableError";
  }
}

export class ConversationRuntimeActiveError extends CodexProtocolError {
  constructor() {
    super("conversation app-server has an active or uncertain turn")
    this.name = "ConversationRuntimeActiveError"
  }
}

export type CodexAppServerHealth = {
  status: "available" | "unavailable";
  reason_code: "CODEX_APP_SERVER_HANDSHAKE_FAILED" | null;
  checked_at: string;
  cached: boolean;
};

export type CapabilityRuntimeResolver = Pick<
  CapabilityRuntimeManager,
  "acquireLease" | "resolvePublished"
>;

export type NativePluginRuntimeManager = Pick<
  NativePluginManager,
  "reconcileBeforeStart" | "verifyAfterStart"
>;

type ManagedProcess = {
  conversationId: string;
  ownerId: string;
  userHome: string;
  workspace: string;
  codexHome: string;
  client: CodexJsonRpcClient;
  codexThreadId: string | null;
  /** Effective model of the currently loaded native Codex thread. */
  codexThreadModel: string | null;
  modelTransitionActive: boolean;
  modelTransitionNonce: string | null;
  internalModelTransitionCompaction: {
    baselineTurnIds: ReadonlySet<string>;
  } | null;
  knownTurnIds: Set<string>;
  /** Native turn/start notifications observed for this loaded app-server. */
  nativeStartedTurnIds: Map<string, true>;
  nativeTurnStartedWaiters: Map<
    string,
    Set<(observed: boolean) => void>
  >;
  /** Same-thread turns rejected because another native turn is still active. */
  suppressedNativeTurnIds: Map<string, true>;
  activeTurnId: string | null;
  activeProjectionTurnId: string | null;
  activeCollaborationMode: "default" | "plan" | null;
  activeGoal: ThreadGoal | null;
  uncertainStartOperationId: string | null;
  starting: boolean;
  evicting: boolean;
  authorizedSkills: AuthorizedTurnSkill[];
  authorizedPlugins: NativePluginActivation[];
  lastUsedAt: number;
  idleTimer: NodeJS.Timeout | null;
  closing: boolean;
  fileServiceToken: string;
  imageGenerationToken: string;
  knowledgeServiceToken: string;
  skillCreatorToken: string;
  interactiveFormToken: string;
  currentUserToken: string;
  notificationChain: Promise<void>;
  pendingUserInputRequests: Map<number, PendingUserInputRequest>;
  assistantMessageProjections: Map<string, string>;
  imageViewProjections: Map<string, string | null>;
  /** Raw child ids remain Runner-local and only index UI-safe labels. */
  subAgentLabelsByThreadId: Map<string, string>;
  /** Native child lifecycle observed on this app-server; never projected raw. */
  subAgentRuntimeByThreadId: Map<string, CachedSubAgentRuntime>;
  /** Monotonic waterline for accepted child thread-status notifications. */
  subAgentRuntimeNotificationRevision: number;
  lastCompletedFinalAgentMessageByTurn: Map<string, string>;
  pendingStopHooks: Map<string, PendingStopHook>;
  browserCleanupPending: boolean;
  runtimeGeneration: string;
  capabilityGeneration: string;
  mcpGeneration: string;
  mcpProxyRuntimeId: string | null;
  runtimeFingerprint: string | null;
  modelGatewayLease: ModelGatewayLease;
  capabilityLeaseToken: TaskCapabilityLeaseToken | null;
  finalizationPromise: Promise<void> | null;
};

type CachedSubAgentRuntime = {
  threadStatus: CodexThreadStatus | null;
  latestTurn: Pick<
    CodexTurn,
    "id" | "status" | "startedAt" | "completedAt" | "durationMs"
  > | null;
  latestTurnNotificationRevision: number;
  latestNotificationRevision: number;
};

type PendingUserInputRequestBase = {
  threadId: string;
  turnId: string;
  itemId: string;
  timer: NodeJS.Timeout | null;
};

type PendingUserInputRequest =
  | (PendingUserInputRequestBase & {
      kind: "questions";
      questions: ToolRequestUserInputQuestion[];
      resolve: (response: ToolRequestUserInputResponse) => void;
    })
  | (PendingUserInputRequestBase & {
      kind: "form";
      requestedSchema: ConversationFormRequestedSchema;
      resolve: (response: ConversationUserInputResponse) => void;
    });

type PendingStopHook = {
  turnId: string;
  supersededItemId: string | null;
};

type UserMcpProxyRuntime = {
  id: string;
  bindings: Map<string, { token: string; target: UserMcpProxyTarget }>;
};

type PreparedUserMcpProxyRuntime = {
  runtime: UserMcpProxyRuntime | null;
  childEnvironment: Record<string, string>;
  configServers: RuntimeMcpServer[];
};

type TaskCapabilityLeaseState = {
  generation: string;
  capabilityControl: string;
  holders: Set<TaskCapabilityLeaseToken>;
  release: CapabilityRuntimeLease["release"];
};

type TaskCapabilityLeaseToken = {
  ownerId: string;
  conversationId: string;
  projectionTurnId: string;
  lease: TaskCapabilityLeaseState;
  managed: ManagedProcess | null;
  released: boolean;
};

type PreparedCapabilityRuntimeLease = {
  capabilityRuntime: PreparedCapabilityRuntime;
  leaseToken: TaskCapabilityLeaseToken;
};

export class AppServerProcessPool {
  private readonly nativePluginManager: NativePluginRuntimeManager;
  private readonly runtimeFingerprintSecret = randomBytes(32);
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly userMcpProxyRuntimes = new Map<
    string,
    UserMcpProxyRuntime
  >();
  private readonly metadataClients = new Set<CodexJsonRpcClient>();
  private readonly metadataOperations = new Set<Promise<unknown>>();
  private readonly processCreations = new Map<
    string,
    { ownerId: string; promise: Promise<ManagedProcess> }
  >();
  private pendingProcessSlots = 0;
  private processCapacityTail: Promise<void> = Promise.resolve();
  private readonly processLifecycleLocks = new Map<string, Promise<void>>();
  private readonly taskCapabilityLocks = new Map<string, Promise<void>>();
  private readonly taskCapabilityLeases = new Map<
    string,
    TaskCapabilityLeaseState
  >();
  private readonly activeStartOperations = new Map<string, Promise<void>>();
  private readonly startOperationLocks = new Map<string, Promise<void>>();
  private readonly startOperationStore: StartOperationStore;
  private readonly activeSteerOperations = new Map<string, Promise<void>>();
  private shuttingDown = false;
  private readonly processExitRetryAbort = new AbortController();
  private readonly steerOperationLocks = new Map<string, Promise<void>>();
  private readonly steerOperationStore: SteerOperationStore;
  private readonly globalFeatureOverrides: readonly string[];
  private healthProbeCache:
    | { expiresAt: number; result: Omit<CodexAppServerHealth, "cached"> }
    | undefined;
  private healthProbeInFlight:
    Promise<Omit<CodexAppServerHealth, "cached">> | undefined;
  private modelCatalogCache:
    { expiresAt: number; catalog: CodexModelReasoningCatalog } | undefined;
  constructor(
    private readonly options: {
      command: string;
      /** @deprecated Model selection is supplied per turn. */
      model?: string;
      processLimit: number;
      idleTtlMs: number;
      templateVersion: string;
      globalFeatureOverrides: readonly string[];
      workspaceManager: WorkspaceManager;
      modelGateway: ModelGatewayRuntime;
      capabilityRuntimeManager: CapabilityRuntimeResolver;
      nativePluginManager?: NativePluginRuntimeManager;
      eventSink: RunnerEventSink;
      logger: Logger;
      mcpCommand: string;
      mcpArgs: string[];
      managedBrowserMcpArgs?: string[];
      personalStdioLauncherCommand?: string;
      personalStdioLauncherArgs?: string[];
      mcpEndpointBase: string;
      imageGenerationMcpEndpointBase?: string;
      knowledgeMcpEndpointBase?: string;
      skillCreatorMcpEndpointBase?: string;
      interactiveFormMcpEndpointBase?: string;
      currentUserMcpEndpointBase?: string;
      knowledgeSearchTimeoutMs?: number;
      childProcessFactory?: ChildProcessFactory;
      codexRequestTimeoutMs?: number;
      nativeTurnRegistrationTimeoutMs?: number;
      modelTransitionCompactionTimeoutMs?: number;
      healthProbeTtlMs?: number;
      healthProbe?: (codexHome: string) => Promise<void>;
      runtimeEnvironmentForOwner?: (
        ownerId: string,
      ) => Promise<Record<string, string>>;
      codexProcessIdentity?: { uid: number; gid: number };
      browserSessionCleanup?: (input: {
        conversationId: string;
        ownerId: string;
        userHome: string;
        codexHome: string;
        workspace: string;
      }) => Promise<void>;
    },
  ) {
    this.globalFeatureOverrides = [...this.options.globalFeatureOverrides];
    this.nativePluginManager =
      this.options.nativePluginManager ?? new NativePluginManager();
    this.startOperationStore = new StartOperationStore(
      this.options.workspaceManager,
    );
    this.steerOperationStore = new SteerOperationStore(
      this.options.workspaceManager,
    );
  }

  get size(): number {
    return this.processes.size;
  }

  get ownerIds(): string[] {
    return [...new Set([...this.processes.values()].map((entry) => entry.ownerId))];
  }

  get runningCount(): number {
    return [...this.processes.values()].filter(
      (entry) =>
        entry.starting || entry.activeTurnId || entry.uncertainStartOperationId,
    ).length;
  }

  resolveUserMcpProxyTarget(
    conversationId: string,
    serverId: string,
    token: string,
  ): UserMcpProxyTarget | null {
    const runtime = this.userMcpProxyRuntimes.get(conversationId);
    const binding = runtime?.bindings.get(serverId);
    if (!binding || !safeTokenEqual(token, binding.token)) return null;
    return binding.target;
  }

  async probeCodexAppServer(
    codexHomeRoot: string,
  ): Promise<CodexAppServerHealth> {
    const now = Date.now();
    if (this.healthProbeCache && this.healthProbeCache.expiresAt > now) {
      return { ...this.healthProbeCache.result, cached: true };
    }
    if (this.healthProbeInFlight) {
      return { ...(await this.healthProbeInFlight), cached: false };
    }

    this.healthProbeInFlight = this.runCodexHealthProbe(codexHomeRoot);
    try {
      const result = await this.healthProbeInFlight;
      this.healthProbeCache = {
        expiresAt:
          Date.now() +
          (this.options.healthProbeTtlMs ?? DEFAULT_CODEX_HEALTH_PROBE_TTL_MS),
        result,
      };
      return { ...result, cached: false };
    } finally {
      this.healthProbeInFlight = undefined;
    }
  }

  async listCodexModels(
    codexHomeRoot: string,
  ): Promise<CodexModelReasoningCatalog> {
    await this.probeCodexAppServer(codexHomeRoot);
    if (
      !this.modelCatalogCache ||
      this.modelCatalogCache.expiresAt <= Date.now()
    ) {
      throw new CodexProtocolError("Codex model catalog is unavailable");
    }
    return this.modelCatalogCache.catalog;
  }

  async probeStdioMcp(input: {
    ownerId: string;
    command: string;
    args: string[];
    environment: Record<string, string>;
    timeoutMs: number;
  }): Promise<{
    serverName: string;
    protocolVersion: string;
    toolCount: number;
  }> {
    this.assertAcceptingOperations();
    const runtimeEnvironment =
      (await this.options.runtimeEnvironmentForOwner?.(input.ownerId)) ?? {};
    return probePersonalStdioMcp({
      command: input.command,
      args: input.args,
      environment: input.environment,
      runtimeEnvironment,
      timeoutMs: input.timeoutMs,
      ...(this.options.codexProcessIdentity
        ? { processIdentity: this.options.codexProcessIdentity }
        : {}),
    });
  }

  async prepareRuntime(
    conversationId: string,
    ownerId: string,
  ): Promise<EnsuredConversationPaths> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(conversationId, ownerId);
    return this.withProcessLifecycleLock(conversationId, async () => {
      const managed = this.processes.get(conversationId);
      if (managed && !managed.closing && managed.client.isHealthy) {
        const runtimeGeneration =
          await this.options.workspaceManager.readRuntimeGeneration(
            conversationId,
          );
        if (
          runtimeGeneration &&
          runtimeGeneration === managed.runtimeGeneration
        ) {
          return {
            ...this.options.workspaceManager.pathsFor(conversationId),
            runtimeGeneration,
          };
        }
        if (
          managed.starting ||
          managed.activeTurnId ||
          hasContinuingGoal(managed) ||
          managed.uncertainStartOperationId ||
          managed.capabilityLeaseToken
        ) {
          throw new StartOperationRuntimeGenerationMismatchError();
        }
      }
      if (managed) await this.closeManagedProcess(managed);
      return this.options.workspaceManager.ensureConversation(
        conversationId,
        this.options.templateVersion,
      );
    });
  }

  async prewarmConversation(
    input: StartTurnInput,
  ): Promise<PrewarmedConversationRuntime> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    const startedAt = Date.now();
    return this.withTaskCapabilityLock(input.conversationId, () =>
      this.withProcessLifecycleLock(input.conversationId, async () => {
        let managed: ManagedProcess | undefined;
        try {
          const recovered =
            await this.readThreadForAuthorizedRecoveryLocked(input);
          managed = recovered.managed;
          if (!managed.codexThreadId) {
            throw new CodexProtocolError("conversation has no Codex thread");
          }
          this.options.logger.info(
            {
              conversationId: input.conversationId,
              durationMs: Date.now() - startedAt,
            },
            "conversation app-server prewarm completed",
          );
          return {
            codexThreadId: managed.codexThreadId,
            agentsTemplateVersion: this.options.templateVersion,
            runtimeGeneration: managed.runtimeGeneration,
          };
        } finally {
          if (managed && this.processes.get(input.conversationId) === managed) {
            managed.starting = false;
            managed.lastUsedAt = Date.now();
            await this.releaseManagedCapabilityLeaseIfIdle(managed);
            this.scheduleIdleClose(managed);
          }
        }
      }),
    );
  }

  async inspectPrewarmedConversation(
    conversationId: string,
    ownerId: string,
  ): Promise<PrewarmedConversationRuntime | null> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(conversationId, ownerId);
    // Creation must never queue behind an in-flight app-server prewarm. The
    // runtime directory can already be claimed by the API while this method
    // reports "not ready"; a later turn will reuse the finished native thread.
    if (this.processLifecycleLocks.has(conversationId)) return null;
    return this.withProcessLifecycleLock(conversationId, async () => {
      const managed = this.processes.get(conversationId);
      if (
        !managed ||
        managed.ownerId !== ownerId ||
        managed.closing ||
        managed.evicting ||
        !managed.client.isHealthy ||
        !managed.codexThreadId ||
        managed.activeTurnId ||
        managed.uncertainStartOperationId
      ) {
        return null;
      }
      const runtimeGeneration =
        await this.options.workspaceManager.readRuntimeGeneration(
          conversationId,
        );
      if (!runtimeGeneration || runtimeGeneration !== managed.runtimeGeneration) {
        return null;
      }
      return {
        codexThreadId: managed.codexThreadId,
        agentsTemplateVersion: this.options.templateVersion,
        runtimeGeneration,
      };
    });
  }

  async beginStartOperation(
    input: StartTurnInput,
  ): Promise<StartOperationState> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    const key = startOperationKey(input.conversationId, input.projectionTurnId);
    const requestFingerprint = startRequestFingerprint(input);
    return this.withStartOperationLock(key, async () => {
      const existing = await this.readStartOperation(
        input.conversationId,
        input.projectionTurnId,
      );
      if (existing) {
        if (isSealedStartOperation(existing)) {
          assertStartOperationOwner(existing, input.ownerId);
          return existing;
        }
        if (
          input.operationKind === "compact" &&
          isSafelyRetryableStartOperation(existing)
        ) {
          assertStartOperationIdentity(existing, input);
        } else {
          assertStartOperationMatches(existing, input, requestFingerprint);
        }
        if (isSafelyRetryableStartOperation(existing)) {
          const activeStart = this.activeStartOperations.get(key);
          if (activeStart) await activeStart;

          const retryable = activeStart
            ? await this.readStartOperation(
                input.conversationId,
                input.projectionTurnId,
              )
            : existing;
          if (retryable && isSafelyRetryableStartOperation(retryable)) {
            if (input.operationKind === "compact") {
              assertStartOperationIdentity(retryable, input);
            } else {
              assertStartOperationMatches(
                retryable,
                input,
                requestFingerprint,
              );
            }
            const restarted = await this.startOperationStore.restartFailed(
              retryable,
              requestFingerprint,
            );
            this.launchStartOperation(key, input, restarted);
            return restarted;
          }
        }
        return this.resolveExistingStartOperation(key, existing, input);
      }

      const created = await this.startOperationStore.createStarting(
        input.conversationId,
        input.projectionTurnId,
        input.ownerId,
        requestFingerprint,
      );
      if (!created) {
        const raced = await this.readStartOperation(
          input.conversationId,
          input.projectionTurnId,
        );
        if (!raced) {
          throw new CodexProtocolError("start operation state is unavailable");
        }
        if (isSealedStartOperation(raced)) {
          assertStartOperationOwner(raced, input.ownerId);
          return raced;
        }
        assertStartOperationMatches(raced, input, requestFingerprint);
        return this.resolveExistingStartOperation(key, raced, input);
      }

      this.launchStartOperation(key, input, created);
      return created;
    });
  }

  async sealStartOperation(
    input: SealStartOperationInput,
  ): Promise<StartOperationState> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    const key = startOperationKey(input.conversationId, input.projectionTurnId);
    return this.withStartOperationLock(key, async () => {
      const runtimeGeneration =
        await this.options.workspaceManager.readRuntimeGeneration(
          input.conversationId,
        );
      if (runtimeGeneration !== input.expectedRuntimeGeneration) {
        throw new StartOperationRuntimeGenerationMismatchError();
      }

      const existing = await this.readStartOperation(
        input.conversationId,
        input.projectionTurnId,
      );
      if (existing) {
        assertStartOperationOwner(existing, input.ownerId);
        return existing;
      }

      const created = await this.startOperationStore.createSealed(
        input.conversationId,
        input.projectionTurnId,
        input.ownerId,
        input.expectedRuntimeGeneration,
      );
      if (created) return created;

      const raced = await this.readStartOperation(
        input.conversationId,
        input.projectionTurnId,
      );
      if (!raced) {
        throw new CodexProtocolError("start operation state is unavailable");
      }
      assertStartOperationOwner(raced, input.ownerId);
      return raced;
    });
  }

  async getStartOperation(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<StartOperationState | null> {
    this.assertAcceptingOperations();
    const key = startOperationKey(conversationId, projectionTurnId);
    return this.withStartOperationLock(key, async () => {
      const state = await this.readStartOperation(
        conversationId,
        projectionTurnId,
      );
      if (!state) return null;
      return this.resolveExistingStartOperation(key, state);
    });
  }

  async beginSteerOperation(
    input: SteerTurnInput,
  ): Promise<SteerOperationState> {
    this.assertAcceptingOperations();
    const key = steerOperationKey(input.conversationId, input.operationId);
    const inputFingerprint = textFingerprint(input.text);
    return this.withSteerOperationLock(key, async () => {
      const existing = await this.readSteerOperation(
        input.conversationId,
        input.operationId,
      );
      if (existing) {
        assertSteerOperationMatches(existing, input, inputFingerprint);
        return this.resolveExistingSteerOperation(key, existing);
      }

      const managed = this.requireProcess(input.conversationId);
      if (managed.ownerId !== input.ownerId) {
        throw new CodexProtocolError("conversation owner precondition failed");
      }
      if (
        managed.activeTurnId !== input.expectedCodexTurnId ||
        managed.activeProjectionTurnId !== input.projectionTurnId ||
        managed.codexThreadId === null
      ) {
        throw new CodexProtocolError("active turn precondition failed");
      }
      const response = await managed.client.request<{ thread: CodexThread }>(
        "thread/read",
        { threadId: managed.codexThreadId, includeTurns: true },
      );
      assertLinkSenseThreadProvider(response.thread, "read");
      const nativeTurn = response.thread.turns?.find(
        (turn) => turn.id === input.expectedCodexTurnId,
      );
      if (!nativeTurn || nativeTurn.status !== "inProgress") {
        throw new CodexProtocolError("active turn precondition failed");
      }
      const created = await this.steerOperationStore.createStarting({
        operationId: input.operationId,
        conversationId: input.conversationId,
        projectionTurnId: input.projectionTurnId,
        ownerId: input.ownerId,
        codexThreadId: managed.codexThreadId,
        expectedCodexTurnId: input.expectedCodexTurnId,
        inputFingerprint,
        baselineItemIds: (nativeTurn.items ?? []).map((item) => item.id),
        preparedAt: new Date().toISOString(),
      });
      if (!created) {
        const raced = await this.readSteerOperation(
          input.conversationId,
          input.operationId,
        );
        if (!raced) {
          throw new CodexProtocolError("steer operation state is unavailable");
        }
        assertSteerOperationMatches(raced, input, inputFingerprint);
        return this.resolveExistingSteerOperation(key, raced);
      }

      const task = this.executeSteerOperation(managed, input, created);
      this.activeSteerOperations.set(key, task);
      void task.finally(() => {
        if (this.activeSteerOperations.get(key) === task) {
          this.activeSteerOperations.delete(key);
        }
      });
      return created;
    });
  }

  async getSteerOperation(
    conversationId: string,
    operationId: string,
  ): Promise<SteerOperationState | null> {
    this.assertAcceptingOperations();
    const key = steerOperationKey(conversationId, operationId);
    return this.withSteerOperationLock(key, async () => {
      const state = await this.readSteerOperation(conversationId, operationId);
      if (!state) return null;
      return this.resolveExistingSteerOperation(key, state);
    });
  }

  async startTurn(
    input: StartTurnInput,
    onPrepared?: (correlation: {
      codexThreadId: string;
      baselineTurnIds: string[];
      preparedAt: string;
      operationKind: "turn" | "goal" | "compact";
    }) => Promise<void>,
  ): Promise<StartOperationResult> {
    this.assertAcceptingOperations();
    return this.withTaskCapabilityLock(input.conversationId, () =>
      this.withProcessLifecycleLock(input.conversationId, async () => {
        try {
          return await this.startTurnLocked(input, onPrepared);
        } catch (error) {
          const managed = this.processes.get(input.conversationId);
          if (
            managed &&
            !managed.activeTurnId &&
            !managed.uncertainStartOperationId
          ) {
            managed.starting = false;
            this.scheduleIdleClose(managed);
          }
          await this.releaseManagedCapabilityLeaseIfIdle(managed);
          throw error;
        }
      }),
    );
  }

  private async startTurnLocked(
    input: StartTurnInput,
    onPrepared?: (correlation: {
      codexThreadId: string;
      baselineTurnIds: string[];
      preparedAt: string;
      operationKind: "turn" | "goal" | "compact";
    }) => Promise<void>,
  ): Promise<StartOperationResult> {
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    if (input.forkFromCodexTurnId && !input.codexThreadId) {
      throw new CodexProtocolError("fork source thread is required");
    }
    if (
      input.modelTransitionSource &&
      (!input.codexThreadId ||
        input.modelTransitionSource.model.trim() === input.model)
    ) {
      throw new CodexProtocolError("invalid model transition source runtime");
    }
    const operationKind = input.operationKind ?? "turn";
    if (
      operationKind === "compact" &&
      (!input.codexThreadId || input.forkFromCodexTurnId || input.goal)
    ) {
      throw new CodexProtocolError("invalid context compaction request");
    }
    const existing = this.processes.get(input.conversationId);
    if (
      existing?.activeTurnId ||
      (existing && hasContinuingGoal(existing)) ||
      existing?.uncertainStartOperationId
    ) {
      throw new CodexProtocolError("conversation already has an active turn");
    }
    if (existing?.capabilityLeaseToken) {
      throw new CodexProtocolError(
        "terminal projection confirmation is pending",
      );
    }
    if (existing) {
      existing.starting = true;
      this.clearIdleTimer(existing);
    }
    let reservedProcessSlot = false;
    if (!existing) {
      await this.reserveProcessSlot(
        input.appServerProcessLimit ?? this.options.processLimit,
      );
      reservedProcessSlot = true;
    }
    let paths: EnsuredConversationPaths;
    let runtimeWasEnsured = !existing;
    let runtimeEnvironment: Record<string, string>;
    try {
      [paths, runtimeEnvironment] = await Promise.all([
        existing
          ? this.options.workspaceManager
              .readRuntimeGeneration(input.conversationId)
              .then((runtimeGeneration) => {
                if (!runtimeGeneration) {
                  throw new StartOperationRuntimeGenerationMismatchError();
                }
                return {
                  ...this.options.workspaceManager.pathsFor(
                    input.conversationId,
                  ),
                  runtimeGeneration,
                };
              })
          : this.options.workspaceManager.ensureConversation(
              input.conversationId,
              this.options.templateVersion,
            ),
        this.options.runtimeEnvironmentForOwner?.(input.ownerId) ??
          Promise.resolve({}),
      ]);
    } catch (error) {
      if (reservedProcessSlot) await this.releaseReservedProcessSlot();
      this.releaseStartingProcess(existing);
      throw error;
    }
    if (paths.runtimeGeneration !== input.expectedRuntimeGeneration) {
      if (reservedProcessSlot) await this.releaseReservedProcessSlot();
      this.releaseStartingProcess(existing);
      throw new StartOperationRuntimeGenerationMismatchError();
    }
    // A task can be persisted as soon as its reserved runtime exists, before
    // background prewarm has returned the native thread id to the API. Adopt
    // that trusted, owner-bound thread instead of rebuilding the process.
    const expectedThreadId =
      input.codexThreadId ??
      (existing?.ownerId === input.ownerId ? existing.codexThreadId : null);
    const desiredRuntimeFingerprint = this.runtimeFingerprintFor(
      input,
      runtimeEnvironment,
      expectedThreadId,
    );
    const canReuseValidatedProcess =
      existing !== undefined &&
      !existing.closing &&
      !existing.evicting &&
      existing.client.isHealthy &&
      existing.ownerId === input.ownerId &&
      existing.codexThreadId === expectedThreadId &&
      existing.runtimeGeneration === input.expectedRuntimeGeneration &&
      existing.capabilityGeneration === input.capabilityGeneration &&
      existing.mcpGeneration === mcpGenerationFor(input) &&
      existing.runtimeFingerprint === desiredRuntimeFingerprint;
    let capabilityRuntime: PreparedCapabilityRuntime | null = null;
    let leaseToken: TaskCapabilityLeaseToken | null = null;
    if (operationKind !== "compact") {
      try {
        const preparedCapability =
          await this.prepareTaskCapabilityGeneration(
            input,
            paths,
            canReuseValidatedProcess,
          );
        capabilityRuntime = preparedCapability.capabilityRuntime;
        leaseToken = preparedCapability.leaseToken;
      } catch (error) {
        if (reservedProcessSlot) await this.releaseReservedProcessSlot();
        this.releaseStartingProcess(existing);
        throw error;
      }
    }
    let managed = this.processes.get(input.conversationId);
    const canReuse = managed === existing && canReuseValidatedProcess;
    const reusedHealthyProcess = canReuse;
    if (managed && !canReuse) {
      this.options.logger.debug(
        { conversationId: input.conversationId },
        "rebuilding app-server because the authorized runtime changed",
      );
      try {
        await this.closeManagedProcess(managed);
      } catch (error) {
        if (leaseToken) {
          await this.releaseCapabilityLeaseTokenIfDetached(leaseToken);
        }
        throw error;
      }
      managed = undefined;
    }
    if (managed && reservedProcessSlot) {
      await this.releaseReservedProcessSlot();
      reservedProcessSlot = false;
    }
    if (!managed) {
      try {
        if (!runtimeWasEnsured) {
          paths = await this.options.workspaceManager.ensureConversation(
            input.conversationId,
            this.options.templateVersion,
          );
          runtimeWasEnsured = true;
          if (paths.runtimeGeneration !== input.expectedRuntimeGeneration) {
            throw new StartOperationRuntimeGenerationMismatchError();
          }
        }
        await this.reconcileNativePluginsBeforeProcessCreation(
          input,
          paths,
          capabilityRuntime,
        );
        const fileServiceToken = randomBytes(32).toString("base64url");
        const imageGenerationToken = randomBytes(32).toString("base64url");
        const knowledgeServiceToken = randomBytes(32).toString("base64url");
        const skillCreatorToken = randomBytes(32).toString("base64url");
        const interactiveFormToken = randomBytes(32).toString("base64url");
        const currentUserToken = randomBytes(32).toString("base64url");
        const transferredReservation = reservedProcessSlot;
        reservedProcessSlot = false;
        managed = await this.getOrCreate(
          {
            ...input,
            environment: {
              ...input.environment,
              LINKSENSE_FILE_SERVICE_ENDPOINT: `${this.options.mcpEndpointBase}/${input.conversationId}/register-artifact`,
              LINKSENSE_IMAGE_GENERATION_ENDPOINT: `${this.imageGenerationMcpEndpointBase}/${input.conversationId}/generate`,
              LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: `${this.knowledgeMcpEndpointBase}/${input.conversationId}/search`,
              LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: String(
                this.knowledgeSearchTimeoutMs,
              ),
              LINKSENSE_FILE_SERVICE_TOKEN: fileServiceToken,
              LINKSENSE_FORM_SERVICE_ENDPOINT: `${this.interactiveFormMcpEndpointBase}/${input.conversationId}/request`,
              LINKSENSE_FORM_SERVICE_TOKEN: interactiveFormToken,
              LINKSENSE_IMAGE_GENERATION_TOKEN: imageGenerationToken,
              LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: knowledgeServiceToken,
              LINKSENSE_SKILL_CREATOR_ENDPOINT: `${this.skillCreatorMcpEndpointBase}/${input.conversationId}`,
              LINKSENSE_SKILL_CREATOR_TOKEN: skillCreatorToken,
              LINKSENSE_CURRENT_USER_ENDPOINT: `${this.currentUserMcpEndpointBase}/${input.conversationId}/info`,
              LINKSENSE_CURRENT_USER_TOKEN: currentUserToken,
              LINKSENSE_CONVERSATION_ID: input.conversationId,
              LINKSENSE_COLLABORATION_MODE: input.collaborationMode,
              ...(input.collaborationMode === "plan"
                ? { LINKSENSE_BROWSER_READ_ONLY: "1" }
                : {}),
            },
          },
          capabilityRuntime,
          paths,
          {
            runtimeEnvironment,
            runtimeFingerprint: desiredRuntimeFingerprint,
            starting: true,
            reservedProcessSlot: transferredReservation,
            capabilityLeaseToken: leaseToken,
          },
        );
      } catch (error) {
        if (reservedProcessSlot) await this.releaseReservedProcessSlot();
        if (leaseToken) {
          await this.releaseCapabilityLeaseTokenIfDetached(leaseToken);
        }
        throw error;
      }
      if (leaseToken) {
        await this.replaceManagedCapabilityLeaseToken(managed, leaseToken);
      }
      managed.runtimeFingerprint = this.runtimeFingerprintFor(
        input,
        runtimeEnvironment,
        managed.codexThreadId,
      );
    } else {
      if (leaseToken) {
        await this.replaceManagedCapabilityLeaseToken(managed, leaseToken);
      }
      this.options.logger.debug(
        { conversationId: input.conversationId },
        "reusing authorized app-server process",
      );
    }
    managed.ownerId = input.ownerId;
    managed.starting = true;
    this.clearIdleTimer(managed);
    if (managed.browserCleanupPending) {
      await this.cleanupBrowserSession(managed);
      managed.browserCleanupPending = false;
    }
    let nativeRequestIssued = false;
    let turnStartRequestIssued = false;
    let turnStartConfirmed = false;
    try {
      if (!managed.codexThreadId) {
        throw new CodexProtocolError("conversation has no Codex thread");
      }
      managed.modelGatewayLease.setModelTransition(null, null);
      managed.modelGatewayLease.setManualModelTransitionCompaction(false);
      managed.modelTransitionActive = false;
      managed.modelTransitionNonce = null;
      const isResumingExistingNativeThread =
        input.codexThreadId !== undefined &&
        input.codexThreadId !== null &&
        input.codexThreadId === managed.codexThreadId;
      const needsNativeThreadHistory =
        isResumingExistingNativeThread &&
        (!reusedHealthyProcess ||
          input.forkFromCodexTurnId !== undefined ||
          operationKind === "compact");
      const sourceThread = needsNativeThreadHistory
        ? (
            await managed.client.request<ThreadReadResponse>("thread/read", {
              threadId: managed.codexThreadId,
              includeTurns: true,
            } satisfies ThreadReadParams)
          ).thread
        : null;
      if (sourceThread && sourceThread.id !== managed.codexThreadId) {
        throw new CodexProtocolError("Codex read an unexpected thread");
      }
      if (sourceThread) assertLinkSenseThreadProvider(sourceThread, "read");
      let sourceTurns = sourceThread?.turns ?? [];
      for (const sourceTurn of sourceTurns) {
        managed.knownTurnIds.add(sourceTurn.id);
      }
      let baselineTurnIds = [...managed.knownTurnIds];
      const sourceThreadModel = isResumingExistingNativeThread
        ? managed.codexThreadModel
        : null;
      if (isResumingExistingNativeThread && sourceThreadModel === null) {
        throw new CodexProtocolError(
          "Codex did not report the resumed thread model",
        );
      }
      const isModelSwitch =
        isResumingExistingNativeThread &&
        sourceThreadModel !== null &&
        sourceThreadModel !== input.model;
      if (isModelSwitch && operationKind === "compact") {
        throw new CodexProtocolError(
          "context compaction model does not match the native thread",
        );
      }
      const transitionNonce = isModelSwitch
        ? randomBytes(32).toString("base64url")
        : null;
      if (isModelSwitch && sourceThreadModel !== null) {
        managed.modelGatewayLease.setModelTransition(
          modelGatewayTransitionSourceFor(input, sourceThreadModel),
          transitionNonce,
        );
        managed.modelTransitionActive = true;
        managed.modelTransitionNonce = transitionNonce;
      }

      if (input.forkFromCodexTurnId) {
        const targetIndex = sourceTurns.findIndex(
          (turn) => turn.id === input.forkFromCodexTurnId,
        );
        if (targetIndex < 0) {
          throw new CodexProtocolError("fork source turn was not found");
        }
        if (!isTerminalTurn(sourceTurns[targetIndex]!)) {
          throw new CodexProtocolError("fork source turn is not terminal");
        }

        nativeRequestIssued = true;
        await this.forkManagedThread(
          managed,
          isModelSwitch ? sourceThreadModel! : input.model,
          paths.workspace,
        );
        if (!isModelSwitch) {
          await this.options.eventSink.alignConversationThread?.(
            managed.conversationId,
            managed.codexThreadId!,
          );
        }

        const rolledBack = await managed.client.request<ThreadRollbackResponse>(
          "thread/rollback",
          {
            threadId: managed.codexThreadId,
            numTurns: sourceTurns.length - targetIndex,
          } satisfies ThreadRollbackParams,
        );
        if (rolledBack.thread.id !== managed.codexThreadId) {
          throw new CodexProtocolError(
            "Codex returned an invalid rollback thread",
          );
        }
        assertLinkSenseThreadProvider(rolledBack.thread, "rollback");
        baselineTurnIds = rolledBack.thread.turns?.map((turn) => turn.id) ?? [];
        const expectedBaselineTurnIds = sourceTurns
          .slice(0, targetIndex)
          .map((turn) => turn.id);
        if (!sameStringSequence(baselineTurnIds, expectedBaselineTurnIds)) {
          throw new CodexProtocolError("fork rollback verification failed");
        }
        managed.knownTurnIds = new Set(baselineTurnIds);
        sourceTurns = rolledBack.thread.turns ?? [];
        if (isModelSwitch) {
          if (sourceTurns.length > 0) {
            sourceTurns = await this.runModelTransitionCompaction(
              managed,
              baselineTurnIds,
            );
            baselineTurnIds = sourceTurns.map((turn) => turn.id);
          }
          const targetFork = await this.forkManagedThread(
            managed,
            input.model,
            paths.workspace,
          );
          await this.options.eventSink.alignConversationThread?.(
            managed.conversationId,
            managed.codexThreadId!,
          );
          const forkedTurnIds = targetFork.thread.turns?.map(
            (turn) => turn.id,
          );
          baselineTurnIds =
            forkedTurnIds &&
            (forkedTurnIds.length > 0 || sourceTurns.length === 0)
              ? forkedTurnIds
              : sourceTurns.map((turn) => turn.id);
          managed.knownTurnIds = new Set(baselineTurnIds);
        }
      } else if (isModelSwitch) {
        nativeRequestIssued = true;
        if (sourceTurns.length > 0) {
          sourceTurns = await this.runModelTransitionCompaction(
            managed,
            sourceTurns.map((turn) => turn.id),
          );
        }
        const forked = await this.forkManagedThread(
          managed,
          input.model,
          paths.workspace,
        );
        await this.options.eventSink.alignConversationThread?.(
          managed.conversationId,
          managed.codexThreadId!,
        );

        const forkedTurnIds = forked.thread.turns?.map((turn) => turn.id);
        baselineTurnIds =
          forkedTurnIds && (forkedTurnIds.length > 0 || sourceTurns.length === 0)
            ? forkedTurnIds
            : sourceTurns.map((turn) => turn.id);
        managed.knownTurnIds = new Set(baselineTurnIds);
      }

      await onPrepared?.({
        codexThreadId: managed.codexThreadId,
        baselineTurnIds,
        preparedAt: new Date().toISOString(),
        operationKind: input.goal ? "goal" : operationKind,
      });

      if (operationKind === "compact") {
        managed.activeProjectionTurnId = eventProjectionTurnIdFor(input);
        managed.activeCollaborationMode = input.collaborationMode;
        this.syncModelGatewayTurnCorrelation(managed);
        nativeRequestIssued = true;
        turnStartRequestIssued = true;
        await managed.client.request<ThreadCompactStartResponse>(
          "thread/compact/start",
          { threadId: managed.codexThreadId } satisfies ThreadCompactStartParams,
        );
        const compactTurn = await this.confirmCompactTurnRegistration(
          managed,
          baselineTurnIds,
        );
        turnStartConfirmed = true;
        managed.knownTurnIds.add(compactTurn.id);
        managed.codexThreadModel = input.model;
        if (
          managed.activeTurnId !== null &&
          managed.activeTurnId !== compactTurn.id
        ) {
          throw new CodexProtocolError(
            "Codex started an unexpected native turn during context compaction",
          );
        }
        this.applyRecoveredTurnState(
          managed,
          compactTurn,
          eventProjectionTurnIdFor(input),
          input.collaborationMode,
        );
        managed.uncertainStartOperationId = null;
        managed.lastUsedAt = Date.now();
        managed.runtimeFingerprint = this.runtimeFingerprintFor(
          input,
          runtimeEnvironment,
          managed.codexThreadId,
        );
        managed.starting = false;
        return {
          codexThreadId: managed.codexThreadId,
          codexTurnId: compactTurn.id,
        };
      }

      const prioritySkills = resolvePrioritySkills(
        input.context,
        managed.authorizedSkills,
      );
      const priorityPlugins =
        input.collaborationMode === "plan"
          ? []
          : resolvePriorityPlugins(input.context, managed.authorizedPlugins);
      const turnInput = buildTurnInput(
        input.context,
        {
          plugins: priorityPlugins.map((plugin) => ({
            name: plugin.name,
            path: plugin.mentionPath,
          })),
          skills: prioritySkills,
        },
        input.collaborationMode,
      );
      const planSkillReferences =
        input.collaborationMode === "plan"
          ? await loadPlanSkillReferences(prioritySkills)
          : [];
      const turnAdditionalContext = buildTurnAdditionalContext(
        input.context,
        managed.authorizedSkills,
        input.collaborationMode,
        planSkillReferences,
      );
      const additionalContext = turnAdditionalContext
        ? prepareCodexAdditionalContext(turnAdditionalContext)
        : undefined;
      const collaborationMode = buildTurnCollaborationMode(
        input.context,
        input.model,
        input.reasoningEffort,
        input.collaborationMode,
      );
      nativeRequestIssued = true;
      const turnStartParams: TurnStartParams = {
        threadId: managed.codexThreadId,
        model: input.model,
        effort: input.reasoningEffort,
        // Request native readable summaries even when a model defaults to none.
        summary: "auto",
        clientUserMessageId: input.projectionTurnId,
        input: [
          { type: "text", text: turnInput, text_elements: [] },
        ],
        ...(transitionNonce
          ? {
              responsesapiClientMetadata: {
                [MODEL_TRANSITION_NONCE_METADATA_KEY]: transitionNonce,
              },
            }
          : {}),
        ...(additionalContext ? { additionalContext } : {}),
        collaborationMode,
        cwd: this.options.workspaceManager.pathsFor(input.conversationId)
          .workspace,
        runtimeWorkspaceRoots: [
          this.options.workspaceManager.pathsFor(input.conversationId)
            .workspace,
        ],
        approvalPolicy: LINKSENSE_APPROVAL_POLICY,
        sandboxPolicy:
          input.collaborationMode === "plan"
            ? { type: "readOnly", networkAccess: false }
            : { type: "dangerFullAccess" },
      };
      if (input.goal) {
        // Active Goals auto-start a continuation, so establish the Goal paused
        // until the explicit turn carrying native capability references exists.
        const response = await managed.client.request<ThreadGoalSetResponse>(
          "thread/goal/set",
          {
            threadId: managed.codexThreadId,
            objective: input.goal.objective,
            status: "paused",
            ...(input.goal.tokenBudget !== undefined
              ? { tokenBudget: input.goal.tokenBudget }
              : {}),
          } satisfies ThreadGoalSetParams,
        );
        assertGoalMatchesStart(
          response.goal,
          input,
          managed.codexThreadId,
          "paused",
        );
        managed.activeGoal = response.goal;
      }
      managed.activeProjectionTurnId = eventProjectionTurnIdFor(input);
      managed.activeCollaborationMode = input.collaborationMode;
      this.syncModelGatewayTurnCorrelation(managed);
      turnStartRequestIssued = true;
      const response = await managed.client.request<{ turn: CodexTurn }>(
        "turn/start",
        turnStartParams,
      );
      if (!response.turn.id || baselineTurnIds.includes(response.turn.id)) {
        throw new CodexProtocolError("Codex returned an invalid turn");
      }
      turnStartConfirmed = true;
      managed.knownTurnIds.add(response.turn.id);
      managed.codexThreadModel = input.model;
      if (
        managed.activeTurnId !== null &&
        managed.activeTurnId !== response.turn.id
      ) {
        throw new CodexProtocolError(
          "Codex started an unexpected native turn during turn/start",
        );
      }
      managed.activeTurnId = response.turn.id;
      managed.activeProjectionTurnId = eventProjectionTurnIdFor(input);
      managed.activeCollaborationMode = input.collaborationMode;
      this.syncModelGatewayTurnCorrelation(managed);
      let activeGoal: ThreadGoal | undefined;
      if (input.goal) {
        // turn/start can allocate an id before Codex exposes that turn to its
        // scheduler. Activating the Goal in that gap auto-starts a competing
        // continuation. Wait for native lifecycle/read confirmation first.
        await this.confirmNativeTurnRegistration(managed, response.turn.id);
        const goalResponse = await managed.client.request<ThreadGoalSetResponse>(
          "thread/goal/set",
          {
            threadId: managed.codexThreadId,
            status: "active",
          } satisfies ThreadGoalSetParams,
        );
        assertGoalMatchesStart(
          goalResponse.goal,
          input,
          managed.codexThreadId,
          "active",
        );
        managed.activeGoal = goalResponse.goal;
        activeGoal = goalResponse.goal;
      }
      managed.uncertainStartOperationId = null;
      managed.lastUsedAt = Date.now();
      managed.runtimeFingerprint = this.runtimeFingerprintFor(
        input,
        runtimeEnvironment,
        managed.codexThreadId,
      );
      managed.starting = false;
      return {
        codexThreadId: managed.codexThreadId!,
        codexTurnId: response.turn.id,
        ...(activeGoal ? { goal: activeGoal } : {}),
      };
    } catch (error) {
      managed.starting = false;
      if (!nativeRequestIssued) {
        this.scheduleIdleClose(managed);
        throw error;
      }
      if (
        turnStartConfirmed ||
        !(error instanceof CodexProtocolError) ||
        error.code === undefined
      ) {
        managed.activeProjectionTurnId = turnStartRequestIssued
          ? eventProjectionTurnIdFor(input)
          : null;
        managed.activeCollaborationMode = turnStartRequestIssued
          ? input.collaborationMode
          : null;
        managed.uncertainStartOperationId = input.projectionTurnId;
        this.syncModelGatewayTurnCorrelation(managed);
        throw new NativeTurnStartUncertainError();
      }
      if (!managed.activeTurnId) {
        managed.activeProjectionTurnId = null;
        managed.activeCollaborationMode = null;
      }
      this.syncModelGatewayTurnCorrelation(managed);
      this.scheduleIdleClose(managed);
      throw error;
    }
  }

  private async confirmNativeTurnRegistration(
    managed: ManagedProcess,
    turnId: string,
  ): Promise<void> {
    const threadId = managed.codexThreadId;
    if (!threadId) {
      throw new CodexProtocolError("conversation has no Codex thread");
    }
    const timeoutMs =
      this.options.nativeTurnRegistrationTimeoutMs ??
      NATIVE_TURN_REGISTRATION_TIMEOUT_MS;
    if (await this.waitForNativeTurnStarted(managed, turnId, timeoutMs)) return;

    const response: ThreadReadResponse =
      await managed.client.request<ThreadReadResponse>("thread/read", {
        threadId,
        includeTurns: true,
      } satisfies ThreadReadParams);
    if (response.thread.id !== threadId) {
      throw new CodexProtocolError("Codex read an unexpected thread");
    }
    assertLinkSenseThreadProvider(response.thread, "read");
    for (const nativeTurn of response.thread.turns ?? []) {
      managed.knownTurnIds.add(nativeTurn.id);
      if (nativeTurn.id === turnId) {
        rememberBounded(
          managed.nativeStartedTurnIds,
          nativeTurn.id,
          true,
          128,
        );
        return;
      }
    }
    throw new CodexProtocolError(
      "Codex did not register the native turn before Goal activation",
    );
  }

  private async forkManagedThread(
    managed: ManagedProcess,
    model: string,
    workspace: string,
  ): Promise<ThreadForkResponse> {
    const sourceThreadId = managed.codexThreadId;
    if (!sourceThreadId) {
      throw new CodexProtocolError("conversation has no Codex thread");
    }
    const forked = await managed.client.request<ThreadForkResponse>(
      "thread/fork",
      {
        threadId: sourceThreadId,
        deferGoalContinuation: true,
        ...linkSenseThreadRuntimeOverrides(model, workspace),
      } satisfies ThreadForkParams,
    );
    if (!forked.thread.id || forked.thread.id === sourceThreadId) {
      throw new CodexProtocolError("Codex returned an invalid fork thread");
    }
    assertLinkSenseThreadProvider(forked.thread, "fork");
    managed.codexThreadModel = assertLinkSenseThreadRuntime(
      forked,
      "fork",
      model,
    );
    managed.codexThreadId = forked.thread.id;
    return forked;
  }

  private async runModelTransitionCompaction(
    managed: ManagedProcess,
    baselineTurnIds: readonly string[],
  ): Promise<CodexTurn[]> {
    const threadId = managed.codexThreadId;
    if (!threadId) {
      throw new CodexProtocolError("conversation has no Codex thread");
    }
    const baseline = new Set(baselineTurnIds);
    managed.internalModelTransitionCompaction = {
      baselineTurnIds: baseline,
    };
    managed.modelGatewayLease.setManualModelTransitionCompaction(true);
    try {
      await managed.client.request<ThreadCompactStartResponse>(
        "thread/compact/start",
        { threadId } satisfies ThreadCompactStartParams,
      );
      const deadline =
        Date.now() +
        (this.options.modelTransitionCompactionTimeoutMs ??
          MODEL_TRANSITION_COMPACTION_TIMEOUT_MS);
      do {
        const response: ThreadReadResponse =
          await managed.client.request<ThreadReadResponse>(
          "thread/read",
          { threadId, includeTurns: true } satisfies ThreadReadParams,
          );
        if (response.thread.id !== threadId) {
          throw new CodexProtocolError("Codex read an unexpected thread");
        }
        assertLinkSenseThreadProvider(response.thread, "read");
        const turns = response.thread.turns ?? [];
        for (const turn of turns) managed.knownTurnIds.add(turn.id);
        const newTurns = turns.filter((turn) => !baseline.has(turn.id));
        if (newTurns.length > 1) {
          throw new CodexProtocolError(
            "Codex started multiple turns during model transition compaction",
            -32_600,
          );
        }
        const compactTurn = newTurns.find((turn) =>
          (turn.items ?? []).some(
            (item) => item.type === "contextCompaction",
          ),
        );
        if (compactTurn) {
          rememberBounded(
            managed.suppressedNativeTurnIds,
            compactTurn.id,
            true,
            128,
          );
          if (isTerminalTurn(compactTurn)) {
            if (compactTurn.status !== "completed") {
              throw new CodexProtocolError(
                "model transition context compaction failed",
                -32_600,
              );
            }
            return turns;
          }
        }
        if (Date.now() < deadline) {
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
      } while (Date.now() < deadline);
      throw new CodexProtocolError(
        "model transition context compaction result is uncertain",
      );
    } finally {
      managed.modelGatewayLease.setManualModelTransitionCompaction(false);
      managed.internalModelTransitionCompaction = null;
    }
  }

  private async confirmCompactTurnRegistration(
    managed: ManagedProcess,
    baselineTurnIds: readonly string[],
  ): Promise<CodexTurn> {
    const threadId = managed.codexThreadId;
    if (!threadId) {
      throw new CodexProtocolError("conversation has no Codex thread");
    }
    const baseline = new Set(baselineTurnIds);
    const deadline =
      Date.now() +
      (this.options.nativeTurnRegistrationTimeoutMs ??
        NATIVE_TURN_REGISTRATION_TIMEOUT_MS);

    do {
      const response: ThreadReadResponse =
        await managed.client.request<ThreadReadResponse>(
        "thread/read",
        { threadId, includeTurns: true } satisfies ThreadReadParams,
      );
      if (response.thread.id !== threadId) {
        throw new CodexProtocolError("Codex read an unexpected thread");
      }
      assertLinkSenseThreadProvider(response.thread, "read");
      const newTurns: CodexTurn[] = (response.thread.turns ?? []).filter(
        (turn) => !baseline.has(turn.id),
      );
      if (newTurns.length > 1) {
        throw new CodexProtocolError(
          "Codex started multiple turns during context compaction",
        );
      }
      const compactTurn = newTurns.find((turn) =>
        (turn.items ?? []).some((item) => item.type === "contextCompaction"),
      );
      if (compactTurn) return compactTurn;
      if (Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    } while (Date.now() < deadline);

    throw new CodexProtocolError(
      "Codex did not register the context compaction turn",
    );
  }

  private waitForNativeTurnStarted(
    managed: ManagedProcess,
    turnId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (managed.nativeStartedTurnIds.has(turnId)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const waiter = (observed: boolean) => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        const waiters = managed.nativeTurnStartedWaiters.get(turnId);
        waiters?.delete(waiter);
        if (waiters?.size === 0) {
          managed.nativeTurnStartedWaiters.delete(turnId);
        }
        resolve(observed);
      };
      const waiters =
        managed.nativeTurnStartedWaiters.get(turnId) ?? new Set();
      waiters.add(waiter);
      managed.nativeTurnStartedWaiters.set(turnId, waiters);
      timer = setTimeout(() => waiter(false), timeoutMs);
      if (managed.nativeStartedTurnIds.has(turnId)) waiter(true);
    });
  }

  private settleNativeTurnStartedWaiters(
    managed: ManagedProcess,
    turnId: string,
    observed: boolean,
  ): void {
    for (const waiter of [
      ...(managed.nativeTurnStartedWaiters.get(turnId) ?? []),
    ]) {
      waiter(observed);
    }
  }

  async interrupt(
    conversationId: string,
    turnId: string,
  ): Promise<"requested" | "not_active"> {
    this.assertAcceptingOperations();
    const managed = this.processes.get(conversationId);
    if (!managed || managed.activeTurnId !== turnId) return "not_active";
    try {
      await managed.client.request("turn/interrupt", {
        threadId: managed.codexThreadId,
        turnId,
      });
      return "requested";
    } catch (error) {
      if (managed.activeTurnId !== turnId) return "not_active";
      throw error;
    }
  }

  async respondUserInputRequest(
    input: RespondUserInputRequestInput,
  ): Promise<{ accepted: true }> {
    this.assertAcceptingOperations();
    const managed = this.processes.get(input.conversationId);
    const pending = managed?.pendingUserInputRequests.get(input.requestId);
    if (
      !managed ||
      managed.ownerId !== input.ownerId ||
      managed.closing ||
      !pending ||
      pending.threadId !== input.codexThreadId ||
      pending.turnId !== input.codexTurnId ||
      pending.itemId !== input.itemId
    ) {
      throw new UserInputRequestUnavailableError();
    }
    if (pending.kind === "questions") {
      if (input.response.action !== "accept") {
        pending.resolve({ answers: {} });
        return { accepted: true as const };
      }
      const answers = Object.fromEntries(
        Object.entries(input.response.content).map(([fieldId, value]) => [
          fieldId,
          typeof value === "string" ? [value] : [],
        ]),
      );
      pending.resolve({
        answers: validateUserInputAnswers(pending.questions, answers),
      });
      return { accepted: true as const };
    }
    if (
      input.response.action === "accept" &&
      !conversationFormResponseMatchesSchema(
        pending.requestedSchema,
        input.response.content,
      )
    ) {
      throw new UserInputRequestUnavailableError(
        "form response does not match requested schema",
      );
    }
    pending.resolve(input.response);
    return { accepted: true as const };
  }

  async requestUserForm(
    conversationId: string,
    token: string,
    input: InteractiveFormRequestInput,
    signal?: AbortSignal,
  ): Promise<ConversationUserInputResponse> {
    const managed = this.processes.get(conversationId);
    if (
      !managed?.activeTurnId ||
      !managed.codexThreadId ||
      managed.closing
    ) {
      throw new InteractiveFormRequestError(
        "INTERACTIVE_FORM_TURN_INACTIVE",
        false,
        409,
      );
    }
    const threadId = managed.codexThreadId;
    const turnId = managed.activeTurnId;
    if (!safeTokenEqual(token, managed.interactiveFormToken)) {
      throw new InteractiveFormRequestError(
        "INTERACTIVE_FORM_FORBIDDEN",
        false,
        403,
      );
    }
    if (
      conversationFormRequestsSensitiveValue(
        input.message,
        input.requestedSchema,
      ) ||
      !conversationFormResponseSemanticsMatchesSchema(
        input.responseSemantics,
        input.requestedSchema,
      )
    ) {
      throw new InteractiveFormRequestError(
        "INTERACTIVE_FORM_INVALID",
        false,
        400,
      );
    }

    const requestId = allocateInteractiveFormRequestId(managed);
    const itemId = `linksense-form-${requestId}`;
    let pending: PendingUserInputRequest | undefined;
    const response = new Promise<ConversationUserInputResponse>((resolve) => {
      const createdPending: PendingUserInputRequest = {
        kind: "form",
        threadId,
        turnId,
        itemId,
        requestedSchema: input.requestedSchema,
        timer: null,
        resolve: (result) => {
          if (
            managed.pendingUserInputRequests.get(requestId) !== createdPending
          ) {
            return;
          }
          managed.pendingUserInputRequests.delete(requestId);
          if (createdPending.timer) clearTimeout(createdPending.timer);
          signal?.removeEventListener("abort", abortRequest);
          resolve(result);
        },
      };
      pending = createdPending;
      managed.pendingUserInputRequests.set(requestId, createdPending);
    });
    const abortRequest = () => {
      if (pending) cancelPendingUserInputRequest(pending);
    };
    if (signal?.aborted) {
      abortRequest();
      return response;
    }
    signal?.addEventListener("abort", abortRequest, { once: true });
    const pendingRequest = pending;
    if (pendingRequest) {
      pendingRequest.timer = setTimeout(
        () => cancelPendingUserInputRequest(pendingRequest),
        conversationFormAutoResolutionMs,
      );
      pendingRequest.timer.unref();
    }
    try {
      await this.options.eventSink.publish(conversationId, {
        method: "linksense/form/request",
        visibility: "user_visible",
        params: {
          threadId,
          turnId,
          itemId,
          requestId,
          serverName: coreMcpServerKey,
          message: input.message,
          requestedSchema: input.requestedSchema,
          uiHints: input.uiHints,
          responseSemantics: input.responseSemantics,
          autoResolutionMs: conversationFormAutoResolutionMs,
        },
      });
    } catch {
      abortRequest();
      throw new InteractiveFormRequestError(
        "INTERACTIVE_FORM_UNAVAILABLE",
        true,
        503,
      );
    }
    return response;
  }

  async emitInteractiveApplicationEvent(
    conversationId: string,
    token: string,
    input: { name: string; payload: unknown },
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (
      !managed?.activeTurnId ||
      !managed.codexThreadId ||
      managed.closing ||
      !safeTokenEqual(token, managed.interactiveFormToken) ||
      !this.options.eventSink.emitInteractiveApplicationEvent
    ) {
      throw new Error("interactive application event unavailable");
    }
    return this.options.eventSink.emitInteractiveApplicationEvent({
      conversationId,
      codexTurnId: managed.activeTurnId,
      name: input.name,
      payload: input.payload,
    });
  }

  async reconcile(input: ReconcileInput): Promise<ReconcileResult> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    return this.withTaskCapabilityLock(input.conversationId, () =>
      this.withProcessLifecycleLock(input.conversationId, async () => {
        let managed: ManagedProcess | undefined;
        try {
          const recovered =
            await this.readThreadForAuthorizedRecoveryLocked(input);
          managed = recovered.managed;
          const trackedNativeTurn = recovered.thread.turns?.find(
            (turn) => turn.id === input.codexTurnId,
          );
          if (input.taskKind !== "goal" && !trackedNativeTurn) {
            throw new CodexProtocolError("recovery native turn was not found");
          }
          const goalResponse =
            input.taskKind === "goal"
              ? await managed.client.request<ThreadGoalGetResponse>(
                  "thread/goal/get",
                  { threadId: input.codexThreadId },
                )
              : { goal: null };
          if (input.taskKind === "goal" && !goalResponse.goal) {
            throw new CodexProtocolError("recovery Goal was not found");
          }
          if (
            goalResponse.goal &&
            goalResponse.goal.threadId !== input.codexThreadId
          ) {
            throw new CodexProtocolError(
              "Codex returned an unexpected recovery Goal",
            );
          }
          const activeGoalTurn =
            goalResponse.goal?.status === "active"
              ? [...(recovered.thread.turns ?? [])]
                  .reverse()
                  .find((turn) => turn.status === "inProgress")
              : undefined;
          const recoveredNativeTurn =
            activeGoalTurn ??
            trackedNativeTurn ??
            recovered.thread.turns?.at(-1);
          if (recoveredNativeTurn) {
            this.applyRecoveredTurnState(
              managed,
              recoveredNativeTurn,
              input.projectionTurnId,
              input.collaborationMode,
            );
          } else if (goalResponse.goal?.status !== "active") {
            throw new CodexProtocolError(
              "recovery Goal has no observable native turn",
            );
          }
          this.applyRecoveredGoalState(
            managed,
            goalResponse.goal,
            input.projectionTurnId,
            input.collaborationMode,
          );
          return { thread: recovered.thread, goal: goalResponse.goal };
        } finally {
          if (managed && this.processes.get(input.conversationId) === managed) {
            managed.starting = false;
            this.scheduleIdleClose(managed);
          }
        }
      }),
    );
  }

  async forkThread(input: ForkThreadInput): Promise<ForkThreadResult> {
    this.assertAcceptingOperations();
    if (input.conversationId === input.sourceConversationId) {
      throw new CodexProtocolError("fork target must be a different task");
    }
    for (const id of [input.conversationId, input.sourceConversationId]) {
      this.options.workspaceManager.bindOwner(id, input.ownerId);
    }
    const source = await this.withProcessLifecycleLock(input.sourceConversationId, async () => {
      const active = this.processes.get(input.sourceConversationId);
      if (active && active.client.isHealthy && !active.closing) {
        return (await active.client.request<ThreadReadResponse>("thread/read", {
          threadId: input.sourceCodexThreadId, includeTurns: true,
        })).thread;
      }
      return this.withThreadMetadataClient(input.sourceConversationId, input, async (client) =>
        (await client.request<ThreadReadResponse>("thread/read", {
          threadId: input.sourceCodexThreadId, includeTurns: true,
        })).thread,
      );
    });
    if (source.id !== input.sourceCodexThreadId || typeof source.path !== "string") {
      throw new CodexProtocolError("fork source runtime is invalid");
    }
    assertLinkSenseThreadProvider(source, "read");
    const sourceHome = this.options.workspaceManager.pathsFor(input.sourceConversationId).codexHome;
    const [canonicalHome, canonicalRollout] = await Promise.all([realpath(sourceHome), realpath(source.path)]);
    const rolloutRelative = relative(canonicalHome, canonicalRollout);
    if (!rolloutRelative || rolloutRelative.startsWith(`..${sep}`) || rolloutRelative === ".." || isAbsolute(rolloutRelative)) {
      throw new CodexProtocolError("fork source path is outside its task");
    }
    const turns = source.turns ?? [];
    const targetIndex = turns.findIndex((turn) => turn.id === input.throughCodexTurnId);
    if (targetIndex < 0 || !isTerminalTurn(turns[targetIndex]!)) {
      throw new CodexProtocolError("fork source turn is not terminal");
    }
    const expectedTurnIds = turns.slice(0, targetIndex + 1).map((turn) => turn.id);
    return this.withTaskCapabilityLock(input.conversationId, () =>
      this.withProcessLifecycleLock(input.conversationId, async () => {
        if (await this.options.workspaceManager.readRuntimeGeneration(input.conversationId) !== input.expectedRuntimeGeneration) {
          throw new StartOperationRuntimeGenerationMismatchError();
        }
        const workspace = this.options.workspaceManager.pathsFor(input.conversationId).workspace;
        const result = await this.withThreadMetadataClient(input.conversationId, input, async (client) => {
          const forked = await client.request<ThreadForkResponse>("thread/fork", {
            threadId: source.id,
            path: canonicalRollout,
            lastTurnId: input.throughCodexTurnId,
            deferGoalContinuation: true,
            ...linkSenseThreadRuntimeOverrides(input.model, workspace),
          } satisfies ThreadForkParams);
          if (!forked.thread.id || forked.thread.id === source.id) {
            throw new CodexProtocolError("Codex returned an invalid fork thread");
          }
          assertLinkSenseThreadRuntime(forked, "fork", input.model);
          const ids = (forked.thread.turns ?? []).map((turn) => turn.id);
          if (!sameStringSequence(ids, expectedTurnIds)) {
            throw new CodexProtocolError("fork history verification failed");
          }
          await client.request("thread/goal/clear", { threadId: forked.thread.id });
          return { codexThreadId: forked.thread.id, codexTurnIds: ids };
        });
        await this.options.eventSink.alignConversationThread?.(input.conversationId, result.codexThreadId);
        return result;
      }),
    );
  }

  /** Native metadata operations never resume or replay a turn. */
  private async withThreadMetadataClient<T>(
    conversationId: string,
    input: { ownerId: string; modelProvider?: ForkThreadInput["modelProvider"] },
    action: (client: CodexJsonRpcClient) => Promise<T>,
  ): Promise<T> {
    const operation = this.runThreadMetadataClient(conversationId, input, action);
    this.metadataOperations.add(operation);
    try {
      return await operation;
    } finally {
      this.metadataOperations.delete(operation);
    }
  }

  private async runThreadMetadataClient<T>(
    conversationId: string,
    input: { ownerId: string; modelProvider?: ForkThreadInput["modelProvider"] },
    action: (client: CodexJsonRpcClient) => Promise<T>,
  ): Promise<T> {
    const paths = this.options.workspaceManager.pathsFor(conversationId);
    const runtimeEnvironment = (await this.options.runtimeEnvironmentForOwner?.(input.ownerId)) ?? {};
    await this.reserveProcessSlot(this.options.processLimit);
    let client: CodexJsonRpcClient | undefined;
    try {
      client = new CodexJsonRpcClient({
        command: this.options.command,
        userHome: paths.home,
        codexHome: paths.codexHome,
        logger: this.options.logger,
        ...(this.options.childProcessFactory ? { childProcessFactory: this.options.childProcessFactory } : {}),
        ...(this.options.codexRequestTimeoutMs !== undefined ? { requestTimeoutMs: this.options.codexRequestTimeoutMs } : {}),
        ...(this.options.codexProcessIdentity ? { processIdentity: this.options.codexProcessIdentity } : {}),
        runtimeEnvironment,
        configOverrides: [
          ...this.globalFeatureOverrides,
          ...(input.modelProvider ? linkSenseModelProviderConfigOverrides({ baseUrl: this.options.modelGateway.baseUrl, protocolMode: input.modelProvider.protocolMode }) : []),
          "features.plugins=false",
          "features.memories=false",
        ],
      });
      this.metadataClients.add(client);
      await client.initialize();
      return await action(client);
    } finally {
      // Retain failed-to-close children and their reserved capacity so a later
      // shutdown can reap them instead of losing track of a live process.
      if (client) {
        await client.close();
        this.metadataClients.delete(client);
      }
      await this.releaseReservedProcessSlot();
    }
  }

  async getGoal(input: GoalRuntimeInput): Promise<ThreadGoal | null> {
    return this.withGoalRuntime(input, async (managed) => {
      const response = await managed.client.request<ThreadGoalGetResponse>(
        "thread/goal/get",
        { threadId: input.codexThreadId },
      );
      this.applyRecoveredGoalState(
        managed,
        response.goal,
        input.projectionTurnId,
      );
      return response.goal;
    });
  }

  async setGoal(input: GoalSetInput): Promise<ThreadGoal> {
    return this.withGoalRuntime(input, async (managed) => {
      const response = await managed.client.request<ThreadGoalSetResponse>(
        "thread/goal/set",
        {
          threadId: input.codexThreadId,
          ...(input.objective !== undefined
            ? { objective: input.objective }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.tokenBudget !== undefined
            ? { tokenBudget: input.tokenBudget }
            : {}),
        } satisfies ThreadGoalSetParams,
      );
      this.applyRecoveredGoalState(
        managed,
        response.goal,
        input.projectionTurnId,
      );
      return response.goal;
    });
  }

  async clearGoal(input: GoalClearInput): Promise<boolean> {
    return this.withGoalRuntime(
      {
        ...input,
        runtimePurpose: "control",
        capabilityGeneration: EMPTY_MCP_GENERATION,
        mcpGeneration: EMPTY_MCP_GENERATION,
        mcpServers: [],
        capabilities: [],
        environment: {},
      },
      async (managed) => {
        const response = await managed.client.request<{ cleared: boolean }>(
          "thread/goal/clear",
          { threadId: input.codexThreadId },
        );
        if (response.cleared) managed.activeGoal = null;
        return response.cleared;
      },
    );
  }

  private async withGoalRuntime<T>(
    input: AuthorizedRecoveryInput,
    operation: (managed: ManagedProcess) => Promise<T>,
  ): Promise<T> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    return this.withTaskCapabilityLock(input.conversationId, () =>
      this.withProcessLifecycleLock(input.conversationId, async () => {
        let managed: ManagedProcess | undefined;
        try {
          const recovered =
            await this.readThreadForAuthorizedRecoveryLocked(input);
          managed = recovered.managed;
          return await operation(managed);
        } finally {
          if (managed && this.processes.get(input.conversationId) === managed) {
            managed.starting = false;
            managed.lastUsedAt = Date.now();
            await this.releaseManagedCapabilityLeaseIfIdle(managed);
            this.scheduleIdleClose(managed);
          }
        }
      }),
    );
  }

  async confirmRecoveryProjection(
    input: ConfirmRecoveryProjectionInput,
  ): Promise<void> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    await this.withProcessLifecycleLock(input.conversationId, async () => {
      const managed = this.processes.get(input.conversationId);
      if (!managed) return;
      if (managed.ownerId !== input.ownerId) {
        throw new CodexProtocolError(
          "conversation app-server owner does not match recovery confirmation",
        );
      }
      const token = managed.capabilityLeaseToken;
      if (!token) return;
      if (
        token.projectionTurnId !== input.projectionTurnId ||
        token.lease.generation !== input.capabilityGeneration
      ) {
        return;
      }
      if (
        managed.starting ||
        managed.activeTurnId ||
        managed.uncertainStartOperationId
      ) {
        throw new CodexProtocolError("recovered turn is not durably terminal");
      }
      await this.releaseManagedCapabilityLeaseToken(managed);
      this.scheduleIdleClose(managed);
    });
  }

  async readSubAgentDetail(
    input: SubAgentDetailReadInput,
  ): Promise<RunnerCodexSubAgentDetail> {
    return this.withSubAgentReadRuntime(input, async (thread, managed) => {
      const parentTurn = thread.turns?.find(
        (turn) => turn.id === input.codexTurnId,
      );
      if (!parentTurn) throw new SubAgentDetailNotFoundError();

      const agents = await this.resolveSubAgents(
        managed,
        thread,
        parentTurn,
        {
          authorizedAgentKeys: input.authorizedAgentKeys,
          requestedAgentKey: input.agentKey,
        },
      );
      const agent = agents.find(
        (candidate) => candidate.summary.agentKey === input.agentKey,
      );
      if (!agent?.thread) throw new SubAgentDetailNotFoundError();

      return projectCodexSubAgentThread({
        agentKey: input.agentKey,
        ...(agent.summary.agentLabel
          ? { agentLabel: agent.summary.agentLabel }
          : {}),
        status: agent.summary.status,
        thread: agent.thread,
        parentTurns: thread.turns ?? [],
        previewContext: {
          workspace: managed.workspace,
          codexHome: managed.codexHome,
        },
      });
    });
  }

  async readSubAgentSummaries(
    input: SubAgentReadRuntimeInput,
  ): Promise<RunnerCodexSubAgentSummaries> {
    return this.withSubAgentReadRuntime(input, async (thread, managed) => {
      const parentTurn = thread.turns?.find(
        (turn) => turn.id === input.codexTurnId,
      );
      if (!parentTurn) throw new SubAgentDetailNotFoundError();
      const agents = await this.resolveSubAgents(managed, thread, parentTurn, {
        authorizedAgentKeys: input.authorizedAgentKeys,
      });
      return { agents: agents.map((agent) => agent.summary) };
    });
  }

  /**
   * Polling a running parent must reuse its healthy app-server exactly as-is.
   * Only a missing, closing, or unhealthy process is rebuilt as an authorized
   * read-only control runtime from the persisted historical model selection.
   */
  private async withSubAgentReadRuntime<T>(
    input: SubAgentReadRuntimeInput,
    operation: (thread: CodexThread, managed: ManagedProcess) => Promise<T>,
  ): Promise<T> {
    this.assertAcceptingOperations();
    this.options.workspaceManager.bindOwner(
      input.conversationId,
      input.ownerId,
    );
    return this.withTaskCapabilityLock(input.conversationId, () =>
      this.withProcessLifecycleLock(input.conversationId, async () => {
        let managed: ManagedProcess | undefined;
        let usedAuthorizedRecovery = false;
        try {
          const existing = this.processes.get(input.conversationId);
          if (
            existing &&
            !existing.closing &&
            existing.client.isHealthy
          ) {
            if (
              existing.ownerId !== input.ownerId ||
              existing.codexThreadId !== input.codexThreadId
            ) {
              throw new CodexProtocolError(
                "loaded conversation runtime does not match subagent read",
              );
            }
            if (
              existing.runtimeGeneration !== input.expectedRuntimeGeneration
            ) {
              throw new StartOperationRuntimeGenerationMismatchError();
            }
            const recovered = await this.readThreadForRecoveryLocked({
              conversationId: input.conversationId,
              ownerId: input.ownerId,
              codexThreadId: input.codexThreadId,
              projectionTurnId: input.projectionTurnId,
              environment: {},
            });
            managed = recovered.managed;
            return await operation(recovered.thread, recovered.managed);
          }

          usedAuthorizedRecovery = true;
          const recovered = await this.readThreadForAuthorizedRecoveryLocked({
            conversationId: input.conversationId,
            projectionTurnId: input.projectionTurnId,
            ownerId: input.ownerId,
            expectedRuntimeGeneration: input.expectedRuntimeGeneration,
            capabilityGeneration: EMPTY_MCP_GENERATION,
            mcpGeneration: EMPTY_MCP_GENERATION,
            mcpServers: [],
            codexThreadId: input.codexThreadId,
            capabilities: [],
            environment: {},
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            modelProvider: input.modelProvider,
            runtimePurpose: "control",
          });
          managed = recovered.managed;
          return await operation(recovered.thread, recovered.managed);
        } finally {
          if (
            managed &&
            this.processes.get(input.conversationId) === managed
          ) {
            if (usedAuthorizedRecovery) managed.starting = false;
            managed.lastUsedAt = Date.now();
            if (usedAuthorizedRecovery) {
              await this.releaseManagedCapabilityLeaseIfIdle(managed);
            }
            if (!managed.activeTurnId) this.scheduleIdleClose(managed);
          }
        }
      }),
    );
  }

  private async resolveSubAgents(
    managed: ManagedProcess,
    parentThread: CodexThread,
    parentTurn: CodexTurn,
    input: {
      authorizedAgentKeys: readonly string[];
      requestedAgentKey?: string;
    },
  ): Promise<
    Array<{
      summary: RunnerCodexSubAgentSummary;
      thread?: CodexThread;
    }>
  > {
    const authorizedAgentKeys = new Set(input.authorizedAgentKeys);
    if (
      input.requestedAgentKey &&
      !authorizedAgentKeys.has(input.requestedAgentKey)
    ) {
      throw new SubAgentDetailNotFoundError();
    }
    const fallbackStatusByThreadId = new Map<
      string,
      RunnerCodexSubAgentSummary["status"]
    >();
    const nativeThreadIds: string[] = [];
    const seenThreadIds = new Set<string>();
    const directlyReferencedThreadIds = new Set<string>();
    const directLabelByThreadId = new Map<string, string>();
    const previewContext = {
      workspace: managed.workspace,
      codexHome: managed.codexHome,
    };
    const collect = (
      value: unknown,
      status?: RunnerCodexSubAgentSummary["status"] | null,
    ): boolean => {
      if (typeof value !== "string") return false;
      const agentKey = opaqueAgentKey(value);
      if (!agentKey || !authorizedAgentKeys.has(agentKey)) return false;
      if (
        input.requestedAgentKey &&
        agentKey !== input.requestedAgentKey
      ) {
        return false;
      }
      if (!seenThreadIds.has(value)) {
        seenThreadIds.add(value);
        nativeThreadIds.push(value);
      }
      if (status) fallbackStatusByThreadId.set(value, status);
      return true;
    };

    for (const item of parentTurn.items) {
      if (item.type === "collabAgentToolCall") {
        if (Array.isArray(item.receiverThreadIds)) {
          for (const receiverThreadId of item.receiverThreadIds) {
            if (collect(receiverThreadId)) {
              directlyReferencedThreadIds.add(receiverThreadId);
            }
          }
        }
        for (const [agentThreadId, state] of Object.entries(
          objectRecord(item.agentsStates),
        )) {
          if (
            collect(
              agentThreadId,
              parseSubAgentStatus(objectRecord(state).status),
            )
          ) {
            directlyReferencedThreadIds.add(agentThreadId);
          }
        }
        continue;
      }
      if (item.type !== "subAgentActivity") continue;
      const childThreadId = boundedCorrelationId(item.agentThreadId, 240);
      const collected = collect(
        childThreadId,
        item.kind === "interrupted"
          ? "interrupted"
          : item.kind === "completed"
            ? "completed"
          : item.kind === "started"
            ? "pendingInit"
            : null,
      );
      if (childThreadId && collected) {
        directlyReferencedThreadIds.add(childThreadId);
        const directLabel = deriveLogicalSubAgentPathLabel(
          item.agentPath,
          previewContext,
        );
        if (directLabel) {
          directLabelByThreadId.set(childThreadId, directLabel);
          rememberBounded(
            managed.subAgentLabelsByThreadId,
            childThreadId,
            directLabel,
            256,
          );
        }
      }
    }

    // app-server 0.150.1 owns parent/child discovery. Direct references belong
    // to this exact parent turn, so never union them with children from another
    // turn. The native parent filter is a restart fallback only when every
    // durable direct reference is absent.
    if (directlyReferencedThreadIds.size === 0) {
      for (const archived of [false, true]) {
        let cursor: string | null = null;
        for (let page = 0; page < MAX_SUB_AGENT_THREAD_PAGES; page += 1) {
          const listResponse: ThreadListResponse =
            await managed.client.request<ThreadListResponse>(
              "thread/list",
              {
                cursor,
                limit: SUB_AGENT_THREAD_PAGE_SIZE,
                sourceKinds: [...SUB_AGENT_THREAD_SOURCE_KINDS],
                archived,
                parentThreadId: managed.codexThreadId,
              },
            );
          for (const candidate of listResponse.data) {
            if (candidate.parentThreadId === managed.codexThreadId) {
              collect(candidate.id);
            }
          }
          if (
            !listResponse.nextCursor ||
            nativeThreadIds.length >= runnerCodexPreviewLimits.subAgents
          ) {
            break;
          }
          cursor = listResponse.nextCursor;
        }
      }
    }

    const parentTurns = parentThread.turns ?? [];
    const resolved: Array<{
      summary: RunnerCodexSubAgentSummary;
      thread?: CodexThread;
    }> = [];
    const notFoundAgent = (
      nativeThreadId: string,
    ): RunnerCodexSubAgentSummary | null => {
      const agentKey = opaqueAgentKey(nativeThreadId);
      if (!agentKey) return null;
      const agentLabel =
        directLabelByThreadId.get(nativeThreadId) ??
        managed.subAgentLabelsByThreadId.get(nativeThreadId) ??
        null;
      return {
        agentKey,
        ...(agentLabel ? { agentLabel } : {}),
        status: "notFound",
      };
    };
    // A turn-scoped opaque key plus the native parentThreadId relation is
    // sufficient to allow-list child notifications before thread/read ends.
    for (const nativeThreadId of nativeThreadIds) {
      this.ensureCachedSubAgentRuntime(managed, nativeThreadId);
    }
    for (let offset = 0; offset < nativeThreadIds.length; offset += 8) {
      const chunk = nativeThreadIds.slice(offset, offset + 8);
      const responses = await Promise.all(
        chunk.map(async (nativeThreadId) => {
          const notificationRevisionAtRequest =
            managed.subAgentRuntimeNotificationRevision;
          try {
            const response = await managed.client.request<ThreadReadResponse>(
              "thread/read",
              { threadId: nativeThreadId, includeTurns: true },
            );
            return {
              nativeThreadId,
              thread: response.thread,
              notificationRevisionAtRequest,
            };
          } catch (error) {
            this.options.logger.debug(
              {
                conversationId: managed.conversationId,
                errorClass: error instanceof Error ? error.name : "unknown",
              },
              "failed to read native subagent summary",
            );
            if (isMissingNativeThreadRollout(error)) {
              return { nativeThreadId, missing: true as const };
            }
            throw new CodexProtocolError(
              "native subagent snapshot is temporarily unavailable",
            );
          }
        }),
      );
      for (const response of responses) {
        if (!response) continue;
        const { nativeThreadId } = response;
        if ("missing" in response) {
          if (input.requestedAgentKey) {
            throw new SubAgentDetailNotFoundError();
          }
          const summary = notFoundAgent(nativeThreadId);
          if (summary) resolved.push({ summary });
          continue;
        }
        const { thread, notificationRevisionAtRequest } = response;
        if (
          thread.id !== nativeThreadId ||
          thread.parentThreadId !== managed.codexThreadId
        ) {
          if (input.requestedAgentKey) {
            throw new SubAgentDetailNotFoundError();
          }
          const summary = notFoundAgent(nativeThreadId);
          if (summary) resolved.push({ summary });
          continue;
        }
        const nativeChildTurns = thread.turns ?? [];
        const childTurns = filterChildOwnedCodexTurns(
          parentTurns,
          nativeChildTurns,
        );
        const latestChildTurn = childTurns.at(-1);
        const cachedRuntime = this.ensureCachedSubAgentRuntime(
          managed,
          nativeThreadId,
        );
        const readThreadStatus = parseCodexThreadStatus(thread.status);
        if (
          readThreadStatus &&
          cachedRuntime.latestNotificationRevision <=
            notificationRevisionAtRequest
        ) {
          cachedRuntime.threadStatus = readThreadStatus;
        }
        const cachedLatestTurn = cachedRuntime?.latestTurn;
        const authoritativeTurn = selectAuthoritativeSubAgentTurn(
          latestChildTurn,
          cachedLatestTurn,
          {
            cachedNotificationRevision:
              cachedRuntime.latestTurnNotificationRevision,
            readRequestRevision: notificationRevisionAtRequest,
          },
        );
        const fallbackStatus = fallbackStatusByThreadId.get(nativeThreadId);
        const runtimeThreadStatus = cachedRuntime.threadStatus;
        const childStatus =
          (runtimeThreadStatus?.type === "systemError" ? "errored" : null) ??
          (authoritativeTurn && isTerminalTurn(authoritativeTurn)
            ? subAgentStatusForTurn(authoritativeTurn.status)
            : null) ??
          subAgentStatusForThread(runtimeThreadStatus) ??
          (authoritativeTurn
            ? subAgentStatusForTurn(authoritativeTurn.status)
            : null);
        const status =
          childStatus ?? fallbackStatus ?? "pendingInit";
        const agentKey = opaqueAgentKey(nativeThreadId);
        if (!agentKey) continue;
        const agentLabel =
          deriveSubAgentThreadLabel(thread, previewContext) ??
          managed.subAgentLabelsByThreadId.get(nativeThreadId) ??
          null;
        if (agentLabel) {
          rememberBounded(
            managed.subAgentLabelsByThreadId,
            nativeThreadId,
            agentLabel,
            256,
          );
        }
        resolved.push({
          summary: {
            agentKey,
            ...(agentLabel ? { agentLabel } : {}),
            status,
          },
          thread: mergeAuthoritativeSubAgentTurnLifecycle(
            thread,
            authoritativeTurn,
          ),
        });
      }
    }
    const resolvedByAgentKey = new Map(
      resolved.map((agent) => [agent.summary.agentKey, agent]),
    );
    const expectedAgentKeys = input.requestedAgentKey
      ? [input.requestedAgentKey]
      : input.authorizedAgentKeys;
    return expectedAgentKeys
      .slice(0, runnerCodexPreviewLimits.subAgents)
      .map(
        (agentKey) =>
          resolvedByAgentKey.get(agentKey) ?? {
            summary: { agentKey, status: "notFound" as const },
          },
      );
  }

  private async readThreadForAuthorizedRecoveryLocked(
    input: AuthorizedRecoveryInput,
  ): Promise<{ thread: CodexThread; managed: ManagedProcess }> {
    const recoveryStartInput: StartTurnInput = {
      conversationId: input.conversationId,
      projectionTurnId: input.projectionTurnId,
      ownerId: input.ownerId,
      expectedRuntimeGeneration: input.expectedRuntimeGeneration,
      capabilityGeneration: input.capabilityGeneration,
      mcpGeneration: mcpGenerationFor(input),
      mcpServers: mcpServersFor(input),
      ...(input.codexThreadId !== undefined
        ? { codexThreadId: input.codexThreadId }
        : {}),
      ...(input.operationKind ? { operationKind: input.operationKind } : {}),
      ...(input.runtimePurpose ? { runtimePurpose: input.runtimePurpose } : {}),
      collaborationMode: input.collaborationMode ?? "default",
      context: {
        userInput: "",
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: input.capabilities,
      environment: input.environment,
      model: input.model,
      ...(input.modelTransitionSource !== undefined
        ? { modelTransitionSource: input.modelTransitionSource }
        : {}),
      reasoningEffort: input.reasoningEffort,
      modelProvider: input.modelProvider,
    };
    let managed = this.processes.get(input.conversationId);
    if (
      managed?.capabilityLeaseToken &&
      (managed.capabilityLeaseToken.projectionTurnId !==
        input.projectionTurnId ||
        managed.capabilityLeaseToken.lease.generation !==
          input.capabilityGeneration)
    ) {
      throw new CodexProtocolError(
        "another terminal projection confirmation is pending",
      );
    }
    if (managed) {
      managed.starting = true;
      this.clearIdleTimer(managed);
    }
    const runtimeWasEnsured = !managed;
    let preparedCapability: PreparedCapabilityRuntimeLease | undefined;
    try {
      let paths = managed
        ? await this.options.workspaceManager
            .readRuntimeGeneration(input.conversationId)
            .then((runtimeGeneration) => {
              if (!runtimeGeneration) {
                throw new StartOperationRuntimeGenerationMismatchError();
              }
              return {
                ...this.options.workspaceManager.pathsFor(
                  input.conversationId,
                ),
                runtimeGeneration,
              };
            })
        : await this.options.workspaceManager.ensureConversation(
            input.conversationId,
            this.options.templateVersion,
          );
      if (paths.runtimeGeneration !== input.expectedRuntimeGeneration) {
        throw new StartOperationRuntimeGenerationMismatchError();
      }
      // Recovery observes the existing native turn. A settings update must
      // not replace its healthy process; the next start applies new settings.
      if (
        managed &&
        !managed.closing &&
        !managed.evicting &&
        managed.client.isHealthy &&
        managed.activeCollaborationMode ===
          (input.collaborationMode ?? "default") &&
        (managed.activeTurnId !== null || hasContinuingGoal(managed))
      ) {
        if (
          managed.ownerId !== input.ownerId ||
          managed.codexThreadId !== input.codexThreadId ||
          managed.runtimeGeneration !== input.expectedRuntimeGeneration ||
          managed.capabilityGeneration !== input.capabilityGeneration ||
          managed.mcpGeneration !== mcpGenerationFor(input) ||
          managed.activeProjectionTurnId !== input.projectionTurnId
        ) {
          throw new CodexProtocolError(
            "active recovery runtime identity mismatch",
          );
        }
        return {
          thread: await this.readManagedRecoveryThread(managed),
          managed,
        };
      }
      const runtimeEnvironment =
        (await this.options.runtimeEnvironmentForOwner?.(input.ownerId)) ?? {};
      if (
        input.operationKind !== "compact" &&
        input.runtimePurpose !== "control"
      ) {
        preparedCapability = await this.prepareTaskCapabilityGeneration(
          recoveryStartInput,
          paths,
        );
      }
      const capabilityRuntime = preparedCapability?.capabilityRuntime ?? null;
      const leaseToken = preparedCapability?.leaseToken ?? null;
      const desiredRuntimeFingerprint = this.runtimeFingerprintFor(
        recoveryStartInput,
        runtimeEnvironment,
        input.codexThreadId ?? null,
      );
      const canReuse =
        managed !== undefined &&
        !managed.closing &&
        !managed.evicting &&
        managed.client.isHealthy &&
        managed.ownerId === input.ownerId &&
        managed.codexThreadId === input.codexThreadId &&
        managed.runtimeGeneration === input.expectedRuntimeGeneration &&
        managed.capabilityGeneration === input.capabilityGeneration &&
        managed.mcpGeneration === mcpGenerationFor(input) &&
        managed.runtimeFingerprint === desiredRuntimeFingerprint;
      if (managed && !canReuse) {
        this.options.logger.debug(
          { conversationId: input.conversationId },
          "rebuilding app-server for an authorized recovery runtime",
        );
        try {
          await this.closeManagedProcess(managed);
        } catch (error) {
          if (leaseToken) {
            await this.releaseCapabilityLeaseTokenIfDetached(leaseToken);
          }
          throw error;
        }
        managed = undefined;
      }
      if (!managed) {
        if (!runtimeWasEnsured) {
          paths = await this.options.workspaceManager.ensureConversation(
            input.conversationId,
            this.options.templateVersion,
          );
          if (paths.runtimeGeneration !== input.expectedRuntimeGeneration) {
            throw new StartOperationRuntimeGenerationMismatchError();
          }
        }
        await this.reconcileNativePluginsBeforeProcessCreation(
          recoveryStartInput,
          paths,
          capabilityRuntime,
        );
        const fileServiceToken = randomBytes(32).toString("base64url");
        const imageGenerationToken = randomBytes(32).toString("base64url");
        const knowledgeServiceToken = randomBytes(32).toString("base64url");
        const skillCreatorToken = randomBytes(32).toString("base64url");
        const interactiveFormToken = randomBytes(32).toString("base64url");
        const currentUserToken = randomBytes(32).toString("base64url");
        managed = await this.getOrCreate(
          {
            ...recoveryStartInput,
            environment: {
              ...input.environment,
              LINKSENSE_FILE_SERVICE_ENDPOINT: `${this.options.mcpEndpointBase}/${input.conversationId}/register-artifact`,
              LINKSENSE_IMAGE_GENERATION_ENDPOINT: `${this.imageGenerationMcpEndpointBase}/${input.conversationId}/generate`,
              LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: `${this.knowledgeMcpEndpointBase}/${input.conversationId}/search`,
              LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: String(
                this.knowledgeSearchTimeoutMs,
              ),
              LINKSENSE_FILE_SERVICE_TOKEN: fileServiceToken,
              LINKSENSE_FORM_SERVICE_ENDPOINT: `${this.interactiveFormMcpEndpointBase}/${input.conversationId}/request`,
              LINKSENSE_FORM_SERVICE_TOKEN: interactiveFormToken,
              LINKSENSE_IMAGE_GENERATION_TOKEN: imageGenerationToken,
              LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: knowledgeServiceToken,
              LINKSENSE_SKILL_CREATOR_ENDPOINT: `${this.skillCreatorMcpEndpointBase}/${input.conversationId}`,
              LINKSENSE_SKILL_CREATOR_TOKEN: skillCreatorToken,
              LINKSENSE_CURRENT_USER_ENDPOINT: `${this.currentUserMcpEndpointBase}/${input.conversationId}/info`,
              LINKSENSE_CURRENT_USER_TOKEN: currentUserToken,
              LINKSENSE_CONVERSATION_ID: input.conversationId,
              LINKSENSE_COLLABORATION_MODE:
                recoveryStartInput.collaborationMode ?? "default",
              ...(recoveryStartInput.collaborationMode === "plan"
                ? { LINKSENSE_BROWSER_READ_ONLY: "1" }
                : {}),
            },
          },
          capabilityRuntime,
          paths,
          {
            runtimeEnvironment,
            runtimeFingerprint: desiredRuntimeFingerprint,
            starting: true,
            reservedProcessSlot: false,
            allowReplacementThread: false,
            resumeModel: input.model,
            capabilityLeaseToken: leaseToken,
          },
        );
        if (leaseToken) {
          await this.replaceManagedCapabilityLeaseToken(managed, leaseToken);
        }
        managed.runtimeFingerprint = this.runtimeFingerprintFor(
          recoveryStartInput,
          runtimeEnvironment,
          managed.codexThreadId,
        );
      } else {
        if (leaseToken) {
          await this.replaceManagedCapabilityLeaseToken(managed, leaseToken);
        }
        this.options.logger.debug(
          { conversationId: input.conversationId },
          "reusing app-server for an authorized recovery runtime",
        );
      }
      managed.ownerId = input.ownerId;
      managed.starting = true;
      this.clearIdleTimer(managed);
      return {
        thread: await this.readManagedRecoveryThread(managed),
        managed,
      };
    } catch (error) {
      this.releaseStartingProcess(managed);
      if (preparedCapability !== undefined) {
        await this.releaseCapabilityLeaseTokenIfDetached(
          preparedCapability.leaseToken,
        );
      }
      throw error;
    }
  }

  private async readManagedRecoveryThread(
    managed: ManagedProcess,
  ): Promise<CodexThread> {
    if (!managed.codexThreadId) {
      throw new CodexProtocolError("conversation has no Codex thread");
    }
    const response = await managed.client.request<{ thread: CodexThread }>(
      "thread/read",
      { threadId: managed.codexThreadId, includeTurns: true },
    );
    if (response.thread.id !== managed.codexThreadId) {
      throw new CodexProtocolError("Codex read an unexpected thread");
    }
    assertLinkSenseThreadProvider(response.thread, "read");
    for (const turn of response.thread.turns ?? []) {
      managed.knownTurnIds.add(turn.id);
    }
    return response.thread;
  }

  private async readThreadForRecovery(input: {
    conversationId: string;
    ownerId: string;
    codexThreadId: string;
    projectionTurnId: string;
    environment: Record<string, string>;
  }): Promise<{ thread: CodexThread; managed: ManagedProcess }> {
    return this.withProcessLifecycleLock(input.conversationId, () =>
      this.readThreadForRecoveryLocked(input),
    );
  }

  private async readThreadForRecoveryLocked(input: {
    conversationId: string;
    ownerId: string;
    codexThreadId: string;
    projectionTurnId: string;
    environment: Record<string, string>;
  }): Promise<{ thread: CodexThread; managed: ManagedProcess }> {
    const managed = this.processes.get(input.conversationId);
    if (
      !managed ||
      managed.closing ||
      !managed.client.isHealthy ||
      managed.ownerId !== input.ownerId ||
      managed.codexThreadId !== input.codexThreadId
    ) {
      throw new CodexProtocolError(
        "conversation app-server is not loaded for recovery",
      );
    }
    const runtimeGeneration =
      await this.options.workspaceManager.readRuntimeGeneration(
        input.conversationId,
      );
    if (!runtimeGeneration || runtimeGeneration !== managed.runtimeGeneration) {
      throw new StartOperationRuntimeGenerationMismatchError();
    }
    const response = await managed.client.request<{ thread: CodexThread }>(
      "thread/read",
      { threadId: managed.codexThreadId, includeTurns: true },
    );
    if (response.thread.id !== managed.codexThreadId) {
      throw new CodexProtocolError("Codex read an unexpected thread");
    }
    assertLinkSenseThreadProvider(response.thread, "read");
    for (const turn of response.thread.turns ?? []) {
      managed.knownTurnIds.add(turn.id);
    }
    return { thread: response.thread, managed };
  }

  private applyRecoveredTurnState(
    managed: ManagedProcess,
    nativeTurn: CodexTurn,
    projectionTurnId: string,
    collaborationMode?: "default" | "plan",
  ): void {
    managed.knownTurnIds.add(nativeTurn.id);
    managed.activeTurnId =
      nativeTurn.status === "inProgress" ? nativeTurn.id : null;
    managed.activeProjectionTurnId =
      nativeTurn.status === "inProgress" ? projectionTurnId : null;
    managed.activeCollaborationMode =
      nativeTurn.status === "inProgress"
        ? (collaborationMode ?? managed.activeCollaborationMode)
        : null;
    this.syncModelGatewayTurnCorrelation(managed);
    managed.uncertainStartOperationId = null;
    managed.lastUsedAt = Date.now();
    if (!managed.activeTurnId) this.scheduleIdleClose(managed);
  }

  private applyRecoveredGoalState(
    managed: ManagedProcess,
    goal: ThreadGoal | null,
    projectionTurnId: string,
    collaborationMode?: "default" | "plan",
  ): void {
    managed.activeGoal = goal;
    if (goal?.status !== "active" || managed.activeTurnId) return;
    managed.activeProjectionTurnId = projectionTurnId;
    managed.activeCollaborationMode =
      collaborationMode ?? managed.activeCollaborationMode;
    this.syncModelGatewayTurnCorrelation(managed);
    this.clearIdleTimer(managed);
  }

  private syncModelGatewayTurnCorrelation(managed: ManagedProcess): void {
    managed.modelGatewayLease.setTurnCorrelation(
      managed.activeProjectionTurnId
        ? {
            turnId: managed.activeProjectionTurnId,
            codexTurnId: managed.activeTurnId,
            modelTransitionNonce: managed.modelTransitionNonce,
          }
        : null,
    );
  }

  async closeConversation(conversationId: string): Promise<void> {
    await this.withProcessLifecycleLock(conversationId, async () => {
      const managed = this.processes.get(conversationId);
      if (!managed) return;
      if (
        managed.starting ||
        managed.activeTurnId ||
        managed.uncertainStartOperationId ||
        managed.capabilityLeaseToken
      ) {
        throw new ConversationRuntimeActiveError();
      }
      await this.closeManagedProcess(managed);
    });
  }

  async refreshOwnerPersonalization(
    ownerId: string,
    memoriesEnabled: boolean,
  ): Promise<void> {
    this.assertAcceptingOperations();
    const conversationIds = [...this.processes.values()]
      .filter((managed) => managed.ownerId === ownerId)
      .map((managed) => managed.conversationId);
    await Promise.all(
      conversationIds.map((conversationId) =>
        this.withProcessLifecycleLock(conversationId, async () => {
          const managed = this.processes.get(conversationId);
          if (!managed || managed.ownerId !== ownerId || managed.closing) {
            return;
          }
          managed.runtimeFingerprint = null;
          if (managed.client.isHealthy && managed.codexThreadId) {
            await managed.client
              .request("thread/memoryMode/set", {
                threadId: managed.codexThreadId,
                mode:
                  managed.activeCollaborationMode === "plan"
                    ? "disabled"
                    : memoriesEnabled
                      ? "enabled"
                      : "disabled",
              })
              .catch((error: unknown) =>
                this.options.logger.warn(
                  {
                    conversationId,
                    errorClass: error instanceof Error ? error.name : "unknown",
                  },
                  "failed to update native thread memory mode",
                ),
              );
          }
          if (
            !managed.starting &&
            !managed.activeTurnId &&
            !managed.uncertainStartOperationId &&
            !managed.capabilityLeaseToken
          ) {
            await this.closeManagedProcess(managed).catch((error: unknown) =>
              this.options.logger.warn(
                {
                  conversationId,
                  errorClass: error instanceof Error ? error.name : "unknown",
                },
                "failed to close stale personalization runtime",
              ),
            );
          }
        }),
      ),
    );
  }

  async resetOwnerMemories(ownerId: string): Promise<void> {
    this.assertAcceptingOperations();
    const ids = new Set([
      ...await this.options.workspaceManager.listConversationIds(),
      ...this.processes.keys(),
    ]);
    for (const conversationId of ids) {
      if (this.options.workspaceManager.ownerFor(conversationId) !== ownerId) continue;
      await this.withProcessLifecycleLock(conversationId, async () => {
        const managed = this.processes.get(conversationId);
        if (managed && !managed.closing && managed.client.isHealthy) {
          await managed.client.request("memory/reset", undefined);
        } else if (await this.options.workspaceManager.readRuntimeGeneration(conversationId)) {
          await this.withThreadMetadataClient(conversationId, { ownerId }, (client) =>
            client.request("memory/reset", undefined),
          );
        }
      });
    }
  }

  async closeAll(): Promise<void> {
    this.shuttingDown = true;
    this.processExitRetryAbort.abort();
    // Cancel before waiting on requests that may themselves require cancellation.
    const interrupted = new Set(this.processes.values());
    await interruptNativeExecutionForShutdown([...interrupted]);
    for (;;) {
      const pendingOperations = [
        ...this.metadataOperations,
        ...this.activeStartOperations.values(),
        ...this.activeSteerOperations.values(),
        ...[...this.processCreations.values()].map(({ promise }) => promise),
      ];
      if (pendingOperations.length > 0) {
        await Promise.allSettled(pendingOperations);
        await Promise.resolve();
      }
      for (const client of this.metadataClients) {
        await client.close();
        this.metadataClients.delete(client);
        await this.releaseReservedProcessSlot();
      }
      const managedProcesses = [...this.processes.values()];
      await interruptNativeExecutionForShutdown(
        managedProcesses.filter((managed) => !interrupted.has(managed)),
      );
      for (const managed of managedProcesses) interrupted.add(managed);
      await Promise.all(
        managedProcesses.map((managed) =>
          this.withProcessLifecycleLock(managed.conversationId, async () => {
            if (this.processes.get(managed.conversationId) === managed) {
              await this.closeManagedProcess(managed);
            }
          }),
        ),
      );
      if (
        this.activeStartOperations.size === 0 &&
        this.activeSteerOperations.size === 0 &&
        this.processCreations.size === 0 &&
        this.processes.size === 0
      ) {
        return;
      }
    }
  }

  async registerArtifact(
    conversationId: string,
    token: string,
    input: {
      workspaceRelativePath: string;
      displayName: string;
      mimeType?: string;
      artifactKind?: string;
    },
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId) {
      throw new FileServiceRequestError(
        "FILE_SERVICE_TURN_INACTIVE",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.fileServiceToken)) {
      throw new FileServiceRequestError("FILE_SERVICE_FORBIDDEN", false, 403);
    }
    if (managed.activeCollaborationMode === "plan") {
      throw new FileServiceRequestError("FILE_SERVICE_FORBIDDEN", false, 403);
    }
    try {
      this.options.workspaceManager.resolveWorkspacePath(
        conversationId,
        input.workspaceRelativePath,
      );
    } catch {
      throw new FileServiceRequestError(
        "ARTIFACT_REGISTRATION_INVALID",
        false,
        400,
      );
    }
    return this.options.eventSink.registerArtifact({
      conversationId,
      turnId: managed.activeTurnId,
      workspaceRelativePath: input.workspaceRelativePath,
      displayName: input.displayName,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.artifactKind ? { artifactKind: input.artifactKind } : {}),
    });
  }

  async generateImage(
    conversationId: string,
    token: string,
    request: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId || !managed.activeProjectionTurnId) {
      throw new ImageGenerationRequestError(
        "IMAGE_GENERATION_TURN_INACTIVE",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.imageGenerationToken)) {
      throw new ImageGenerationRequestError(
        "IMAGE_GENERATION_FORBIDDEN",
        false,
        403,
      );
    }
    if (managed.activeCollaborationMode === "plan") {
      throw new ImageGenerationRequestError(
        "IMAGE_GENERATION_FORBIDDEN",
        false,
        403,
      );
    }
    if (!this.options.eventSink.generateImage) {
      throw new ImageGenerationRequestError(
        "IMAGE_GENERATION_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.generateImage({
      conversationId,
      turnId: managed.activeProjectionTurnId,
      request,
      ...(signal ? { signal } : {}),
    });
  }

  async previewSkillZip(
    conversationId: string,
    token: string,
    input: { workspaceRelativePath: string },
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId) {
      throw new SkillCreatorRequestError(
        "SKILL_CREATOR_TURN_INACTIVE",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.skillCreatorToken)) {
      throw new SkillCreatorRequestError("SKILL_CREATOR_FORBIDDEN", false, 403);
    }
    const parsedPath = skillCreatorArchivePathSchema.safeParse(
      input.workspaceRelativePath,
    );
    if (!parsedPath.success) {
      throw new SkillCreatorRequestError("SKILL_PACKAGE_INVALID", false, 400);
    }
    try {
      this.options.workspaceManager.resolveWorkspacePath(
        conversationId,
        parsedPath.data,
      );
    } catch {
      throw new SkillCreatorRequestError("SKILL_PACKAGE_INVALID", false, 400);
    }
    if (!this.options.eventSink.previewSkillZip) {
      throw new SkillCreatorRequestError(
        "SKILL_CREATOR_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.previewSkillZip({
      conversationId,
      turnId: managed.activeTurnId,
      workspaceRelativePath: parsedPath.data,
    });
  }

  async confirmSkillInstall(
    conversationId: string,
    token: string,
    input: { installToken: string },
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId) {
      throw new SkillCreatorRequestError(
        "SKILL_CREATOR_TURN_INACTIVE",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.skillCreatorToken)) {
      throw new SkillCreatorRequestError("SKILL_CREATOR_FORBIDDEN", false, 403);
    }
    if (managed.activeCollaborationMode === "plan") {
      throw new SkillCreatorRequestError("SKILL_CREATOR_FORBIDDEN", false, 403);
    }
    if (!this.options.eventSink.confirmSkillInstall) {
      throw new SkillCreatorRequestError(
        "SKILL_CREATOR_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.confirmSkillInstall({
      conversationId,
      turnId: managed.activeTurnId,
      installToken: input.installToken,
    });
  }

  async searchKnowledge(
    conversationId: string,
    token: string,
    input: {
      query: string;
      finalTopK: number;
      candidateMultiplier: number;
      numCandidates?: number;
      minScore: number;
    },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId || !managed.activeProjectionTurnId) {
      throw new KnowledgeSearchRequestError(
        "KNOWLEDGE_SEARCH_FORBIDDEN",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.knowledgeServiceToken)) {
      throw new KnowledgeSearchRequestError(
        "KNOWLEDGE_SEARCH_FORBIDDEN",
        false,
        403,
      );
    }
    if (!this.options.eventSink.searchKnowledge) {
      throw new KnowledgeSearchRequestError(
        "KNOWLEDGE_SEARCH_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.searchKnowledge({
      conversationId,
      turnId: managed.activeProjectionTurnId,
      query: input.query,
      finalTopK: input.finalTopK,
      candidateMultiplier: input.candidateMultiplier,
      ...(input.numCandidates === undefined
        ? {}
        : { numCandidates: input.numCandidates }),
      minScore: input.minScore,
      ...(signal ? { signal } : {}),
    });
  }

  async listKnowledgeDocuments(
    conversationId: string,
    token: string,
    input: { cursor?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId || !managed.activeProjectionTurnId) {
      throw new KnowledgeServiceRequestError(
        "KNOWLEDGE_DOCUMENT_LIST_FORBIDDEN",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.knowledgeServiceToken)) {
      throw new KnowledgeServiceRequestError(
        "KNOWLEDGE_DOCUMENT_LIST_FORBIDDEN",
        false,
        403,
      );
    }
    if (!this.options.eventSink.listKnowledgeDocuments) {
      throw new KnowledgeServiceRequestError(
        "KNOWLEDGE_DOCUMENT_LIST_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.listKnowledgeDocuments({
      conversationId,
      turnId: managed.activeProjectionTurnId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(signal ? { signal } : {}),
    });
  }

  async getKnowledgeDocumentMarkdown(
    conversationId: string,
    token: string,
    input: { documentRef: string; cursor?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId || !managed.activeProjectionTurnId) {
      throw new KnowledgeServiceRequestError(
        "KNOWLEDGE_DOCUMENT_MARKDOWN_FORBIDDEN",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.knowledgeServiceToken)) {
      throw new KnowledgeServiceRequestError(
        "KNOWLEDGE_DOCUMENT_MARKDOWN_FORBIDDEN",
        false,
        403,
      );
    }
    if (!this.options.eventSink.getKnowledgeDocumentMarkdown) {
      throw new KnowledgeServiceRequestError(
        "KNOWLEDGE_DOCUMENT_MARKDOWN_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.getKnowledgeDocumentMarkdown({
      conversationId,
      turnId: managed.activeProjectionTurnId,
      documentRef: input.documentRef,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(signal ? { signal } : {}),
    });
  }

  async getCurrentUserInfo(
    conversationId: string,
    token: string,
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (!managed?.activeTurnId || !managed.activeProjectionTurnId) {
      throw new CurrentUserInfoRequestError(
        "CURRENT_USER_FORBIDDEN",
        false,
        409,
      );
    }
    if (!safeTokenEqual(token, managed.currentUserToken)) {
      throw new CurrentUserInfoRequestError(
        "CURRENT_USER_FORBIDDEN",
        false,
        403,
      );
    }
    if (!this.options.eventSink.getCurrentUserInfo) {
      throw new CurrentUserInfoRequestError(
        "CURRENT_USER_UNAVAILABLE",
        true,
        503,
      );
    }
    return this.options.eventSink.getCurrentUserInfo({
      conversationId,
      turnId: managed.activeProjectionTurnId,
    });
  }

  private get knowledgeMcpEndpointBase(): string {
    return (
      this.options.knowledgeMcpEndpointBase ?? this.options.mcpEndpointBase
    );
  }

  private get imageGenerationMcpEndpointBase(): string {
    return (
      this.options.imageGenerationMcpEndpointBase ??
      this.options.mcpEndpointBase
    );
  }

  private get skillCreatorMcpEndpointBase(): string {
    return (
      this.options.skillCreatorMcpEndpointBase ?? this.options.mcpEndpointBase
    );
  }

  private get interactiveFormMcpEndpointBase(): string {
    return (
      this.options.interactiveFormMcpEndpointBase ??
      `${new URL(this.options.mcpEndpointBase).origin}/mcp-interactive-form`
    );
  }

  private get currentUserMcpEndpointBase(): string {
    return (
      this.options.currentUserMcpEndpointBase ??
      `${new URL(this.options.mcpEndpointBase).origin}/mcp-current-user`
    );
  }

  private get knowledgeSearchTimeoutMs(): number {
    return (
      this.options.knowledgeSearchTimeoutMs ??
      DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS
    );
  }

  private async executeStartOperation(
    input: StartTurnInput,
    starting: StartOperationState,
  ): Promise<void> {
    let result: StartOperationResult;
    let current = starting;
    try {
      result = await this.startTurn(input, async (correlation) => {
        current = await this.startOperationStore.updateCorrelation(
          current,
          correlation,
        );
      });
    } catch (error) {
      const uncertain = error instanceof NativeTurnStartUncertainError;
      this.options.logger.warn(
        {
          conversationId: input.conversationId,
          projectionTurnId: input.projectionTurnId,
          nativeRequestPrepared: current.correlation !== undefined,
          ...sanitizedErrorDetails(error),
        },
        "runner start operation failed",
      );
      try {
        await this.startOperationStore.update(
          current,
          uncertain
            ? {
                status: "uncertain",
                errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN",
              }
            : {
                status: "failed",
                errorCode: "RUNNER_TURN_START_FAILED",
              },
        );
      } catch {
        this.options.logger.error(
          {
            conversationId: input.conversationId,
            projectionTurnId: input.projectionTurnId,
          },
          "failed to persist terminal start operation state",
        );
      }
      return;
    }

    try {
      await this.startOperationStore.update(current, {
        status: "succeeded",
        result,
      });
    } catch {
      this.options.logger.error(
        {
          conversationId: input.conversationId,
          projectionTurnId: input.projectionTurnId,
        },
        "failed to persist successful start operation result",
      );
      await this.startOperationStore
        .update(current, {
          status: "uncertain",
          errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN",
        })
        .catch(() => undefined);
    }
  }

  private launchStartOperation(
    key: string,
    input: StartTurnInput,
    starting: StartOperationState,
  ): void {
    const task = this.executeStartOperation(input, starting);
    this.activeStartOperations.set(key, task);
    void task.finally(() => {
      if (this.activeStartOperations.get(key) === task) {
        this.activeStartOperations.delete(key);
      }
    });
  }

  private async readStartOperation(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<StartOperationState | null> {
    try {
      return await this.startOperationStore.read(
        conversationId,
        projectionTurnId,
      );
    } catch (error) {
      if (!(error instanceof CorruptStartOperationError)) throw error;
      return this.startOperationStore.replaceCorruptWithUncertain(
        conversationId,
        projectionTurnId,
      );
    }
  }

  private async resolveExistingStartOperation(
    key: string,
    state: StartOperationState,
    recoveryInput?: StartTurnInput,
  ): Promise<StartOperationState> {
    if (state.status === "succeeded" || state.status === "failed") {
      return state;
    }
    if (this.activeStartOperations.has(key)) return state;
    // The operation can finish after the caller reads its state but before the
    // in-memory task is removed. Refresh once before attempting restart
    // recovery so a stale `starting` snapshot cannot overwrite a terminal
    // result with `uncertain`.
    const refreshed = await this.readStartOperation(
      state.conversationId,
      state.projectionTurnId,
    );
    if (
      refreshed &&
      (refreshed.status !== state.status ||
        refreshed.updatedAt !== state.updatedAt)
    ) {
      return this.resolveExistingStartOperation(key, refreshed, recoveryInput);
    }
    if (!state.correlation || !state.ownerId) {
      if (state.status === "uncertain") {
        if (state.ownerId && state.requestFingerprint && !state.correlation) {
          return this.startOperationStore.update(state, {
            status: "failed",
            errorCode: "RUNNER_TURN_START_FAILED",
          });
        }
        return state;
      }
      if (!state.ownerId || !state.requestFingerprint) {
        return this.startOperationStore.update(state, {
          status: "uncertain",
          errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN",
        });
      }
      return this.startOperationStore.update(state, {
        status: "failed",
        errorCode: "RUNNER_TURN_START_FAILED",
      });
    }
    return this.recoverStartOperation(state, recoveryInput);
  }

  private async recoverStartOperation(
    state: StartOperationState,
    recoveryInput?: StartTurnInput,
  ): Promise<StartOperationState> {
    if (
      recoveryInput &&
      state.requestFingerprint !== undefined &&
      state.requestFingerprint === startRequestFingerprint(recoveryInput)
    ) {
      return this.withTaskCapabilityLock(recoveryInput.conversationId, () =>
        this.withProcessLifecycleLock(state.conversationId, async () => {
          let managed: ManagedProcess | undefined;
          try {
            const recovered = await this.readThreadForAuthorizedRecoveryLocked({
              conversationId: recoveryInput.conversationId,
              projectionTurnId: eventProjectionTurnIdFor(recoveryInput),
              ownerId: recoveryInput.ownerId,
              expectedRuntimeGeneration:
                recoveryInput.expectedRuntimeGeneration,
              capabilityGeneration: recoveryInput.capabilityGeneration,
              mcpGeneration: mcpGenerationFor(recoveryInput),
              mcpServers: mcpServersFor(recoveryInput),
              codexThreadId: state.correlation!.codexThreadId,
              capabilities: recoveryInput.capabilities,
              environment: recoveryInput.environment,
              model: recoveryInput.model,
              operationKind: recoveryInput.operationKind,
              ...(recoveryInput.modelTransitionSource !== undefined
                ? {
                    modelTransitionSource:
                      recoveryInput.modelTransitionSource,
                  }
                : {}),
              collaborationMode: recoveryInput.collaborationMode,
              reasoningEffort: recoveryInput.reasoningEffort,
              modelProvider: recoveryInput.modelProvider,
            });
            managed = recovered.managed;
            return this.resolveRecoveredStartOperation(
              state,
              recovered.thread,
              managed,
              eventProjectionTurnIdFor(recoveryInput),
              recoveryInput.collaborationMode,
            );
          } catch {
            return this.markStartOperationUncertain(state);
          } finally {
            if (
              managed &&
              this.processes.get(state.conversationId) === managed
            ) {
              managed.starting = false;
              this.scheduleIdleClose(managed);
            }
          }
        }),
      );
    }

    try {
      const { thread, managed } = await this.readThreadForRecovery({
        conversationId: state.conversationId,
        ownerId: state.ownerId!,
        codexThreadId: state.correlation!.codexThreadId,
        projectionTurnId: state.projectionTurnId,
        environment: {},
      });
      return this.resolveRecoveredStartOperation(state, thread, managed);
    } catch {
      return this.markStartOperationUncertain(state);
    }
  }

  private async resolveRecoveredStartOperation(
    state: StartOperationState,
    thread: CodexThread,
    managed: ManagedProcess,
    eventProjectionTurnId = state.projectionTurnId,
    collaborationMode?: StartTurnInput["collaborationMode"],
  ): Promise<StartOperationState> {
    const baseline = new Set(state.correlation!.baselineTurnIds);
    const isGoal = state.correlation!.operationKind === "goal";
    const isCompact = state.correlation!.operationKind === "compact";
    const candidates = (thread.turns ?? []).filter((turn) => {
      if (baseline.has(turn.id)) return false;
      return (
        isGoal ||
        (turn.items ?? []).some((item) =>
          isCompact
            ? item.type === "contextCompaction"
            : item.type === "userMessage" &&
              item.clientId === state.projectionTurnId,
        )
      );
    });
    if (
      (isGoal && candidates.length === 0) ||
      (!isGoal && candidates.length !== 1)
    ) {
      return this.markStartOperationUncertain(state);
    }
    const startedTurn = candidates[0]!;
    this.applyRecoveredTurnState(
      managed,
      candidates.at(-1)!,
      eventProjectionTurnId,
      collaborationMode,
    );
    const goal = isGoal
      ? (
          await managed.client.request<ThreadGoalGetResponse>(
            "thread/goal/get",
            { threadId: state.correlation!.codexThreadId },
          )
        ).goal
      : null;
    if (isGoal && !goal) return this.markStartOperationUncertain(state);
    if (isGoal) {
      this.applyRecoveredGoalState(
        managed,
        goal,
        eventProjectionTurnId,
        collaborationMode,
      );
    }
    return this.startOperationStore.update(state, {
      status: "succeeded",
      result: {
        codexThreadId: state.correlation!.codexThreadId,
        codexTurnId: startedTurn.id,
        ...(goal ? { goal } : {}),
      },
    });
  }

  private markStartOperationUncertain(
    state: StartOperationState,
  ): Promise<StartOperationState> {
    if (state.status === "uncertain") return Promise.resolve(state);
    return this.startOperationStore.update(state, {
      status: "uncertain",
      errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN",
    });
  }

  private async executeSteerOperation(
    managed: ManagedProcess,
    input: SteerTurnInput,
    starting: SteerOperationState,
  ): Promise<void> {
    try {
      if (
        managed.activeTurnId !== input.expectedCodexTurnId ||
        managed.activeProjectionTurnId !== input.projectionTurnId ||
        managed.codexThreadId !== starting.codexThreadId
      ) {
        throw new CodexProtocolError("active turn precondition failed", -1);
      }
      const response = await managed.client.request<{ turnId: string }>(
        "turn/steer",
        {
          threadId: managed.codexThreadId,
          expectedTurnId: input.expectedCodexTurnId,
          clientUserMessageId: input.operationId,
          input: [{ type: "text", text: input.text, text_elements: [] }],
        },
      );
      if (response.turnId !== input.expectedCodexTurnId) {
        throw new NativeTurnSteerUncertainError();
      }
      await this.steerOperationStore.update(starting, {
        status: "succeeded",
        result: { codexTurnId: response.turnId },
      });
    } catch (error) {
      const uncertain =
        error instanceof NativeTurnSteerUncertainError ||
        !(error instanceof CodexProtocolError) ||
        error.code === undefined;
      await this.steerOperationStore
        .update(
          starting,
          uncertain
            ? {
                status: "uncertain",
                errorCode: "RUNNER_TURN_STEER_RESULT_UNCERTAIN",
              }
            : {
                status: "failed",
                errorCode: "RUNNER_TURN_STEER_FAILED",
              },
        )
        .catch(() => undefined);
    }
  }

  private async readSteerOperation(
    conversationId: string,
    operationId: string,
  ): Promise<SteerOperationState | null> {
    try {
      return await this.steerOperationStore.read(conversationId, operationId);
    } catch (error) {
      if (error instanceof CorruptSteerOperationError) {
        throw new CodexProtocolError("steer operation state is corrupt");
      }
      throw error;
    }
  }

  private async resolveExistingSteerOperation(
    key: string,
    state: SteerOperationState,
  ): Promise<SteerOperationState> {
    if (state.status === "succeeded" || state.status === "failed") return state;
    if (this.activeSteerOperations.has(key)) return state;
    try {
      const { thread, managed } = await this.readThreadForRecovery({
        conversationId: state.conversationId,
        ownerId: state.ownerId,
        codexThreadId: state.codexThreadId,
        projectionTurnId: state.projectionTurnId,
        environment: {},
      });
      const nativeTurn = thread.turns?.find(
        (turn) => turn.id === state.expectedCodexTurnId,
      );
      if (!nativeTurn) return this.markSteerOperationUncertain(state);
      this.applyRecoveredTurnState(managed, nativeTurn, state.projectionTurnId);
      const baseline = new Set(state.baselineItemIds);
      const matching = (nativeTurn.items ?? []).filter(
        (item) =>
          !baseline.has(item.id) &&
          item.type === "userMessage" &&
          item.clientId === state.operationId,
      );
      if (matching.length !== 1) return this.markSteerOperationUncertain(state);
      return this.steerOperationStore.update(state, {
        status: "succeeded",
        result: { codexTurnId: state.expectedCodexTurnId },
      });
    } catch {
      return this.markSteerOperationUncertain(state);
    }
  }

  private markSteerOperationUncertain(
    state: SteerOperationState,
  ): Promise<SteerOperationState> {
    if (state.status === "uncertain") return Promise.resolve(state);
    return this.steerOperationStore.update(state, {
      status: "uncertain",
      errorCode: "RUNNER_TURN_STEER_RESULT_UNCERTAIN",
    });
  }

  private async withStartOperationLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.startOperationLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.startOperationLocks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.startOperationLocks.get(key) === tail) {
        this.startOperationLocks.delete(key);
      }
    }
  }

  private async withSteerOperationLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.steerOperationLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.steerOperationLocks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.steerOperationLocks.get(key) === tail) {
        this.steerOperationLocks.delete(key);
      }
    }
  }

  private async withProcessLifecycleLock<T>(
    conversationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.processLifecycleLocks.get(conversationId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.processLifecycleLocks.set(conversationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.processLifecycleLocks.get(conversationId) === tail) {
        this.processLifecycleLocks.delete(conversationId);
      }
    }
  }

  private async withTaskCapabilityLock<T>(
    conversationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.taskCapabilityLocks.get(conversationId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.taskCapabilityLocks.set(conversationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.taskCapabilityLocks.get(conversationId) === tail) {
        this.taskCapabilityLocks.delete(conversationId);
      }
    }
  }

  private async retainTaskCapabilityLease(input: {
    ownerId: string;
    conversationId: string;
    projectionTurnId: string;
    controlRoot: string;
    generation: string;
  }): Promise<TaskCapabilityLeaseToken> {
    let lease = this.taskCapabilityLeases.get(input.conversationId);
    if (lease) {
      if (
        lease.generation !== input.generation ||
        lease.capabilityControl !== join(input.controlRoot, "capabilities")
      ) {
        throw new CodexProtocolError(
          "task capability generation is still in use",
        );
      }
    } else {
      const acquired = await this.options.capabilityRuntimeManager.acquireLease(
        {
          controlRoot: input.controlRoot,
          expectedGeneration: input.generation,
        },
      );
      lease = {
        generation: acquired.generation,
        capabilityControl: acquired.capabilityControl,
        holders: new Set(),
        release: acquired.release,
      };
      this.taskCapabilityLeases.set(input.conversationId, lease);
    }
    const token: TaskCapabilityLeaseToken = {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      projectionTurnId: input.projectionTurnId,
      lease,
      managed: null,
      released: false,
    };
    lease.holders.add(token);
    return token;
  }

  private async releaseTaskCapabilityLeaseToken(
    token: TaskCapabilityLeaseToken,
  ): Promise<void> {
    if (token.released) return;
    token.released = true;
    token.managed = null;
    const { lease } = token;
    if (!lease.holders.delete(token) || lease.holders.size > 0) return;
    if (this.taskCapabilityLeases.get(token.conversationId) === lease) {
      this.taskCapabilityLeases.delete(token.conversationId);
    }
    await lease.release();
  }

  private async replaceManagedCapabilityLeaseToken(
    managed: ManagedProcess,
    token: TaskCapabilityLeaseToken,
  ): Promise<void> {
    const previous = managed.capabilityLeaseToken;
    if (previous === token) return;
    managed.capabilityLeaseToken = token;
    token.managed = managed;
    if (previous) {
      previous.managed = null;
      await this.releaseTaskCapabilityLeaseToken(previous);
    }
  }

  private async releaseManagedCapabilityLeaseToken(
    managed: ManagedProcess,
  ): Promise<void> {
    const token = managed.capabilityLeaseToken;
    if (!token) return;
    managed.capabilityLeaseToken = null;
    token.managed = null;
    await this.releaseTaskCapabilityLeaseToken(token);
  }

  private async releaseCapabilityLeaseTokenIfDetached(
    token: TaskCapabilityLeaseToken,
  ): Promise<void> {
    if (token.managed?.capabilityLeaseToken === token) return;
    await this.releaseTaskCapabilityLeaseToken(token);
  }

  private async releaseManagedCapabilityLeaseIfIdle(
    managed: ManagedProcess | undefined,
  ): Promise<void> {
    if (
      managed &&
      (managed.starting ||
        managed.activeTurnId ||
        hasContinuingGoal(managed) ||
        managed.uncertainStartOperationId)
    ) {
      return;
    }
    if (managed) await this.releaseManagedCapabilityLeaseToken(managed);
  }

  private async prepareTaskCapabilityGeneration(
    input: StartTurnInput,
    paths: EnsuredConversationPaths,
    reuseVerified = false,
  ): Promise<PreparedCapabilityRuntimeLease> {
    const generationAlreadyLoaded =
      this.processes.get(input.conversationId)?.capabilityGeneration ===
      input.capabilityGeneration;

    if (!generationAlreadyLoaded) {
      const managed = this.processes.get(input.conversationId);
      if (managed) {
        if (managed.activeTurnId || managed.uncertainStartOperationId || managed.capabilityLeaseToken || hasContinuingGoal(managed)) {
          throw new CodexProtocolError("task capability generation is still in use");
        }
        await this.closeManagedProcess(managed);
      }
    }

    const leaseToken = await this.retainTaskCapabilityLease({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      projectionTurnId: eventProjectionTurnIdFor(input),
      controlRoot: paths.control,
      generation: input.capabilityGeneration,
    });
    try {
      const capabilityRuntime =
        await this.options.capabilityRuntimeManager.resolvePublished({
          taskHome: paths.taskHome,
          controlRoot: paths.control,
          expectedGeneration: input.capabilityGeneration,
          capabilities: input.capabilities,
          lockHeld: true,
          reuseVerified,
          reuseImmutableSnapshot: true,
        });
      return { capabilityRuntime, leaseToken };
    } catch (error) {
      await this.releaseTaskCapabilityLeaseToken(leaseToken);
      throw error;
    }
  }

  /**
   * Codex owns native plugin state under the task CODEX_HOME. Verify
   * that state immediately before every real app-server creation while the
   * cross-process capability lease is held. Healthy process reuse does not
   * need another check, and the manager's exact-match path is read-only.
   */
  private async reconcileNativePluginsBeforeProcessCreation(
    input: StartTurnInput,
    paths: EnsuredConversationPaths,
    capabilityRuntime: PreparedCapabilityRuntime | null,
  ): Promise<void> {
    if (!capabilityRuntime) return;
    await this.nativePluginManager.reconcileBeforeStart({
      command: this.options.command,
      userHome: paths.home,
      codexHome: paths.codexHome,
      workspace: paths.workspace,
      capabilityControl: join(paths.control, "capabilities"),
      expectedGeneration: input.capabilityGeneration,
      pluginContentDigest: capabilityRuntime.pluginContentDigest,
      pluginNames: input.capabilities
        .filter((capability) => capability.type === "plugin")
        .map((capability) => capability.name),
      lockHeld: true,
      ...(this.options.codexProcessIdentity
        ? { processIdentity: this.options.codexProcessIdentity }
        : {}),
    });
  }

  private async getOrCreate(
    input: StartTurnInput,
    capabilityRuntime: PreparedCapabilityRuntime | null,
    preparedPaths?: EnsuredConversationPaths,
    creationContext?: {
      runtimeEnvironment: Record<string, string>;
      runtimeFingerprint: string | null;
      starting: boolean;
      reservedProcessSlot: boolean;
      allowReplacementThread?: boolean;
      resumeModel?: string;
      capabilityLeaseToken: TaskCapabilityLeaseToken | null;
    },
  ): Promise<ManagedProcess> {
    this.assertAcceptingOperations();
    const pending = this.processCreations.get(input.conversationId);
    if (pending) {
      if (creationContext?.reservedProcessSlot) {
        await this.releaseReservedProcessSlot();
      }
      if (pending.ownerId !== input.ownerId) {
        throw new CodexProtocolError("conversation owner precondition failed");
      }
      return pending.promise;
    }
    const existing = this.processes.get(input.conversationId);
    if (existing) {
      if (creationContext?.reservedProcessSlot) {
        await this.releaseReservedProcessSlot();
      }
      if (existing.ownerId !== input.ownerId) {
        throw new CodexProtocolError("conversation owner precondition failed");
      }
      return existing;
    }
    const creation = this.createManagedProcess(
      input,
      capabilityRuntime,
      preparedPaths,
      creationContext,
    );
    this.processCreations.set(input.conversationId, {
      ownerId: input.ownerId,
      promise: creation,
    });
    try {
      return await creation;
    } finally {
      if (
        this.processCreations.get(input.conversationId)?.promise === creation
      ) {
        this.processCreations.delete(input.conversationId);
      }
    }
  }

  private async createManagedProcess(
    input: StartTurnInput,
    capabilityRuntime: PreparedCapabilityRuntime | null,
    preparedPaths?: EnsuredConversationPaths,
    creationContext?: {
      runtimeEnvironment: Record<string, string>;
      runtimeFingerprint: string | null;
      starting: boolean;
      reservedProcessSlot: boolean;
      allowReplacementThread?: boolean;
      resumeModel?: string;
      capabilityLeaseToken: TaskCapabilityLeaseToken | null;
    },
  ): Promise<ManagedProcess> {
    return this.withReservedProcessSlot(async (commit) => {
      const paths =
        preparedPaths ??
        (await this.options.workspaceManager.ensureConversation(
          input.conversationId,
          this.options.templateVersion,
        ));
      const personalization =
        await this.options.workspaceManager.getPersonalization(input.ownerId);
      await this.options.eventSink.resumeConversation?.(input.conversationId);
      const fileServiceToken = input.environment.LINKSENSE_FILE_SERVICE_TOKEN;
      if (!fileServiceToken) {
        throw new CodexProtocolError("file service token is missing");
      }
      const imageGenerationToken =
        input.environment.LINKSENSE_IMAGE_GENERATION_TOKEN;
      if (!imageGenerationToken) {
        throw new CodexProtocolError("image generation token is missing");
      }
      const knowledgeServiceToken =
        input.environment.LINKSENSE_KNOWLEDGE_SERVICE_TOKEN;
      if (!knowledgeServiceToken) {
        throw new CodexProtocolError("knowledge service token is missing");
      }
      const skillCreatorToken = input.environment.LINKSENSE_SKILL_CREATOR_TOKEN;
      if (!skillCreatorToken) {
        throw new CodexProtocolError("skill creator token is missing");
      }
      const interactiveFormToken =
        input.environment.LINKSENSE_FORM_SERVICE_TOKEN;
      if (!interactiveFormToken) {
        throw new CodexProtocolError("interactive form token is missing");
      }
      const currentUserToken = input.environment.LINKSENSE_CURRENT_USER_TOKEN;
      if (!currentUserToken) {
        throw new CodexProtocolError("current user token is missing");
      }
      const runtimeEnvironment =
        creationContext?.runtimeEnvironment ??
        (await this.options.runtimeEnvironmentForOwner?.(input.ownerId));
      const modelGatewayLease = this.options.modelGateway.issueLease({
        conversationId: input.conversationId,
        ownerId: input.ownerId,
        revision: input.modelProvider.revision,
        upstreamBaseUrl: input.modelProvider.baseUrl,
        apiKey: input.modelProvider.apiKey,
        protocolMode: input.modelProvider.protocolMode,
        model: input.model,
        pricing: input.modelProvider.pricing ?? zeroModelTokenPricing,
      });
      let preparedMcpProxy: PreparedUserMcpProxyRuntime;
      try {
        preparedMcpProxy = this.prepareUserMcpProxyRuntime(input);
      } catch (error) {
        modelGatewayLease.release();
        throw error;
      }
      if (preparedMcpProxy.runtime) {
        this.userMcpProxyRuntimes.set(
          input.conversationId,
          preparedMcpProxy.runtime,
        );
      }
      let client: CodexJsonRpcClient;
      const managedReference: { current: ManagedProcess | null } = {
        current: null,
      };
      try {
        client = new CodexJsonRpcClient({
          command: this.options.command,
          userHome: paths.home,
          codexHome: paths.codexHome,
          logger: this.options.logger,
          ...(this.options.childProcessFactory
            ? { childProcessFactory: this.options.childProcessFactory }
            : {}),
          ...(this.options.codexRequestTimeoutMs !== undefined
            ? { requestTimeoutMs: this.options.codexRequestTimeoutMs }
            : {}),
          extraEnvironment: {
            ...preparedMcpProxy.childEnvironment,
            [modelGatewayEnvironmentKey]: modelGatewayLease.token,
          },
          // Keep task-scoped runtime settings out of the task-scoped
          // config.toml. Codex alone persists native plugin selections there.
          configOverrides: [
            ...this.globalFeatureOverrides,
            ...linkSenseSkillConfigOverrides(input.collaborationMode),
            ...linkSenseModelProviderConfigOverrides({
              baseUrl: this.options.modelGateway.baseUrl,
              protocolMode: input.modelProvider.protocolMode,
              allowWebSockets: input.modelTransitionSource === undefined,
              ...(input.modelProvider.modelContextWindow === undefined
                ? {}
                : {
                    modelContextWindow:
                      input.modelProvider.modelContextWindow,
                  }),
              ...(input.modelProvider.modelAutoCompactTokenLimit === undefined
                ? {}
                : {
                    modelAutoCompactTokenLimit:
                      input.modelProvider.modelAutoCompactTokenLimit,
                  }),
            }),
            ...builtInMcpConfigOverrides({
              command: this.options.mcpCommand,
              args: this.options.mcpArgs,
              ...(this.options.managedBrowserMcpArgs
                ? { managedBrowserArgs: this.options.managedBrowserMcpArgs }
                : {}),
              knowledgeSearchTimeoutMs: this.knowledgeSearchTimeoutMs,
            }),
            ...planRuntimeConfigOverrides(input.collaborationMode),
            ...memoryConfigOverrides(
              {
                memories_enabled:
                  input.collaborationMode === "plan"
                    ? false
                    : personalization.memories_enabled,
              },
              input.model,
            ),
            ...mcpConfigOverrides(
              preparedMcpProxy.configServers,
              this.options.personalStdioLauncherCommand &&
                this.options.personalStdioLauncherArgs
                ? {
                    command: this.options.personalStdioLauncherCommand,
                    args: this.options.personalStdioLauncherArgs,
                    cwd: paths.workspace,
                  }
                : undefined,
            ),
            ...(input.collaborationMode === "plan"
              ? ["features.plugins=false"]
              : []),
          ],
          ...(runtimeEnvironment ? { runtimeEnvironment } : {}),
          ...(this.options.codexProcessIdentity
            ? { processIdentity: this.options.codexProcessIdentity }
            : {}),
          onServerRequest: (request) => {
            const current = managedReference.current;
            if (!current) {
              throw new CodexProtocolError(
                "conversation app-server is not initialized",
              );
            }
            return this.handleServerRequest(current, request);
          },
        });
      } catch (error) {
        this.removeUserMcpProxyRuntime(
          input.conversationId,
          preparedMcpProxy.runtime?.id ?? null,
        );
        modelGatewayLease.release();
        throw error;
      }
      const managed: ManagedProcess = {
        conversationId: input.conversationId,
        ownerId: input.ownerId,
        userHome: paths.home,
        workspace: paths.workspace,
        codexHome: paths.codexHome,
        client,
        codexThreadId: input.codexThreadId ?? null,
        codexThreadModel: null,
        modelTransitionActive: false,
        modelTransitionNonce: null,
        internalModelTransitionCompaction: null,
        knownTurnIds: new Set(),
        nativeStartedTurnIds: new Map(),
        nativeTurnStartedWaiters: new Map(),
        suppressedNativeTurnIds: new Map(),
        activeTurnId: null,
        activeProjectionTurnId: creationContext?.starting
          ? eventProjectionTurnIdFor(input)
          : null,
        activeCollaborationMode: creationContext?.starting
          ? input.collaborationMode
          : null,
        activeGoal: null,
        uncertainStartOperationId: null,
        starting: creationContext?.starting ?? false,
        evicting: false,
        authorizedSkills: [],
        authorizedPlugins: [],
        lastUsedAt: Date.now(),
        idleTimer: null,
        closing: false,
        fileServiceToken,
        imageGenerationToken,
        knowledgeServiceToken,
        skillCreatorToken,
        interactiveFormToken,
        currentUserToken,
        notificationChain: Promise.resolve(),
        pendingUserInputRequests: new Map(),
        assistantMessageProjections: new Map(),
        imageViewProjections: new Map(),
        subAgentLabelsByThreadId: new Map(),
        subAgentRuntimeByThreadId: new Map(),
        subAgentRuntimeNotificationRevision: 0,
        lastCompletedFinalAgentMessageByTurn: new Map(),
        pendingStopHooks: new Map(),
        browserCleanupPending: false,
        runtimeGeneration: paths.runtimeGeneration,
        capabilityGeneration: input.capabilityGeneration,
        mcpGeneration: mcpGenerationFor(input),
        mcpProxyRuntimeId: preparedMcpProxy.runtime?.id ?? null,
        runtimeFingerprint: creationContext?.runtimeFingerprint ?? null,
        modelGatewayLease,
        capabilityLeaseToken: creationContext?.capabilityLeaseToken ?? null,
        finalizationPromise: null,
      };
      managedReference.current = managed;
      if (managed.capabilityLeaseToken) {
        managed.capabilityLeaseToken.managed = managed;
      }
      client.on("notification", (notification: JsonRpcNotification) => {
        // Cache child metadata/lifecycle synchronously in the JSON-RPC receive
        // order. A notification line preceding a request response must advance
        // the read waterline before the awaiting caller observes that response.
        this.rememberSubAgentMetadata(managed, notification);
        this.rememberSubAgentRuntime(managed, notification);
        managed.notificationChain = managed.notificationChain
          .then(() => this.handleNotification(managed, notification))
          .catch(() =>
            this.options.logger.error(
              { conversationId: input.conversationId },
              "failed to process app-server notification",
            ),
          );
      });
      client.once(
        "exit",
        (exit: { code: number | null; signal: NodeJS.Signals | null }) => {
          const closeWasExpected = managed.closing;
          const details = {
            conversationId: input.conversationId,
            code: exit.code,
            signal: exit.signal,
            expected: closeWasExpected,
            activeTurn: managed.activeTurnId !== null,
            starting: managed.starting,
          };
          if (closeWasExpected) {
            this.options.logger.debug(details, "codex app-server exited");
          } else {
            this.options.logger.warn(details, "codex app-server exited");
          }
          for (const turnId of managed.nativeTurnStartedWaiters.keys()) {
            this.settleNativeTurnStartedWaiters(managed, turnId, false);
          }
          const wasCurrent =
            this.processes.get(input.conversationId) === managed;
          if (wasCurrent) {
            this.processes.delete(input.conversationId);
          }
          if (!closeWasExpected) {
            void this.recoverExitedManagedProcess(managed).catch(() =>
              this.options.logger.error(
                { conversationId: input.conversationId },
                "failed to finalize an exited app-server",
              ),
            );
          }
        },
      );
      client.once("unhealthy", (reason: CodexClientUnhealthyReason) => {
        this.options.logger.warn(
          {
            conversationId: managed.conversationId,
            reason: reason.type,
            ...(reason.type === "request_timeout"
              ? { method: reason.method }
              : {}),
            activeTurn: managed.activeTurnId !== null,
            starting: managed.starting,
          },
          "codex app-server became unhealthy",
        );
        void this.withProcessLifecycleLock(managed.conversationId, async () => {
          if (
            this.processes.get(managed.conversationId) !== managed ||
            managed.closing
          ) {
            return;
          }
          try {
            await this.closeManagedProcess(managed, false, {
              preserveCapabilityLease: true,
            });
          } catch (error) {
            if (!managed.client.isExited) throw error;
          }
          await this.recoverExitedManagedProcess(managed);
        }).catch(() =>
          this.options.logger.error(
            { conversationId: managed.conversationId },
            "failed to close unhealthy app-server",
          ),
        );
      });
      try {
        await client.initialize();
        const isCompact = input.operationKind === "compact";
        const isControl = input.runtimePurpose === "control";
        const skipsCapabilityRuntime = isCompact || isControl;
        const pluginNames =
          skipsCapabilityRuntime || input.collaborationMode === "plan"
            ? []
            : input.capabilities
                .filter((capability) => capability.type === "plugin")
                .map((capability) => capability.name);
        if (!skipsCapabilityRuntime && !capabilityRuntime) {
          throw new CodexProtocolError(
            "published capability runtime is unavailable",
          );
        }
        managed.authorizedPlugins =
          skipsCapabilityRuntime || input.collaborationMode === "plan"
            ? []
            : await this.nativePluginManager.verifyAfterStart({
                client,
                workspace: paths.workspace,
                userHome: paths.home,
                codexHome: paths.codexHome,
                pluginNames,
              });
        const startNativeThread = async (): Promise<void> => {
          const response = await client.request<ThreadStartResponse>(
            "thread/start",
            {
              ...linkSenseThreadRuntimeOverrides(input.model, paths.workspace),
              ephemeral: false,
            },
          );
          if (!response.thread.id) {
            throw new CodexProtocolError("Codex returned an invalid thread");
          }
          assertLinkSenseThreadProvider(response.thread, "start");
          managed.codexThreadModel = assertLinkSenseThreadRuntime(
            response,
            "start",
            input.model,
          );
          managed.codexThreadId = response.thread.id;
        };

        const ensureNativeThread = async (): Promise<void> => {
          if (managed.codexThreadId) {
            try {
              const resumeModel =
                creationContext?.resumeModel ??
                (input.operationKind === "compact"
                  ? input.model
                  : (input.modelTransitionSource?.model ?? input.model));
              const resumed = await client.request<ThreadResumeResponse>(
                "thread/resume",
                {
                  threadId: managed.codexThreadId,
                  ...linkSenseThreadRuntimeOverrides(
                    resumeModel,
                    paths.workspace,
                  ),
                  excludeTurns: true,
                },
              );
              if (resumed.thread.id !== managed.codexThreadId) {
                throw new CodexProtocolError(
                  "Codex resumed an unexpected thread",
                );
              }
              assertLinkSenseThreadProvider(resumed.thread, "resume");
              managed.codexThreadModel = assertLinkSenseThreadRuntime(
                resumed,
                "resume",
                resumeModel,
              );
              return;
            } catch (error) {
              if (
                input.forkFromCodexTurnId ||
                creationContext?.allowReplacementThread === false ||
                !isMissingNativeThreadRollout(error)
              ) {
                throw error;
              }
              this.options.logger.warn(
                { conversationId: input.conversationId },
                "native Codex thread rollout is missing; starting a replacement thread",
              );
            }
          }
          await startNativeThread();
        };

        const validateMcpRuntime = async (): Promise<void> => {
          const mcpStatus = await client.request<{
            data: Array<{ name: string; tools: Record<string, unknown> }>;
          }>("mcpServerStatus/list", {
            detail: "toolsAndAuthOnly",
            limit: 100,
          });
          const coreService = mcpStatus.data.find(
            (server) => server.name === coreMcpServerKey,
          );
          const requiredCoreTools = coreMcpToolNamesFor(
            input.collaborationMode,
          );
          if (
            !coreService ||
            requiredCoreTools.some((toolName) => !coreService.tools[toolName])
          ) {
            throw new CodexProtocolError(
              "LinkSense Core MCP is unavailable",
            );
          }
          if (input.collaborationMode === "plan") {
            const managedBrowserService = mcpStatus.data.find(
              (server) => server.name === managedBrowserMcpServerKey,
            );
            if (!managedBrowserService?.tools.run_browser_command) {
              throw new CodexProtocolError(
                "LinkSense Managed Browser MCP is unavailable",
              );
            }
          }
          for (const plugin of managed.authorizedPlugins) {
            for (const serverName of plugin.mcpServers) {
              if (
                !mcpStatus.data.some((server) => server.name === serverName)
              ) {
                throw new CodexProtocolError(
                  "native plugin MCP server is unavailable",
                );
              }
            }
          }
        };

        if (skipsCapabilityRuntime) {
          managed.authorizedSkills = [];
        } else {
          const [authorizedSkills] = await Promise.all([
            this.authorizedSkillCatalog(
              client,
              paths.workspace,
              capabilityRuntime,
              managed.authorizedPlugins,
              new Set(
                input.capabilities
                  .filter((capability) => capability.type === "skill")
                  .map((capability) => capability.name),
              ),
            ),
            validateMcpRuntime(),
          ]);
          managed.authorizedSkills = authorizedSkills;
        }
        if (isControl) {
          if (!managed.codexThreadId) {
            throw new CodexProtocolError(
              "control operation requires a conversation thread",
            );
          }
          await commit(managed);
          return managed;
        }
        await ensureNativeThread();
        if (!managed.codexThreadId) {
          throw new CodexProtocolError(
            "Codex did not return a conversation thread",
          );
        }
        await client.request("thread/memoryMode/set", {
          threadId: managed.codexThreadId,
          mode:
            input.collaborationMode === "plan"
              ? "disabled"
              : personalization.memories_enabled
                ? "enabled"
                : "disabled",
        });
        await this.options.eventSink.alignConversationThread?.(
          managed.conversationId,
          managed.codexThreadId,
        );
        await commit(managed);
        return managed;
      } catch (error) {
        const exitedUnexpectedly = client.isExited;
        managed.closing = true;
        try {
          await client.close();
        } catch (closeError) {
          // A child that survives SIGKILL must remain accounted for. Transfer
          // the reserved slot into the process map so capacity and shutdown
          // cannot treat the still-running process as gone.
          if (!this.processes.has(input.conversationId)) {
            await commit(managed);
          }
          throw closeError;
        }
        if (!exitedUnexpectedly) {
          await this.releaseManagedCapabilityLeaseToken(managed);
        }
        managed.modelGatewayLease.release();
        this.removeUserMcpProxyRuntime(
          managed.conversationId,
          managed.mcpProxyRuntimeId,
        );
        throw error;
      }
    },
      creationContext?.reservedProcessSlot ?? false,
      input.appServerProcessLimit ?? this.options.processLimit,
    );
  }

  private async authorizedSkillCatalog(
    client: CodexJsonRpcClient,
    workspace: string,
    capabilityRuntime: PreparedCapabilityRuntime | null,
    authorizedPlugins: NativePluginActivation[],
    authorizedStandaloneSkillNames: ReadonlySet<string>,
  ): Promise<AuthorizedTurnSkill[]> {
    let rawResponse: unknown;
    try {
      rawResponse = await client.request<unknown>("skills/list", {
        cwds: [workspace],
        forceReload: true,
      });
    } catch {
      throw new CodexProtocolError("Codex skill catalog is unavailable");
    }
    const response = skillsListResponseSchema.safeParse(rawResponse);
    if (!response.success) {
      throw new CodexProtocolError("Codex skill catalog is invalid");
    }
    const [catalog] = response.data.data;
    const hasExpectedWorkspace =
      catalog !== undefined && (await isSamePath(catalog.cwd, workspace));
    if (
      response.data.data.length !== 1 ||
      !catalog ||
      !hasExpectedWorkspace ||
      catalog.skills.some((skill) => skill.scope === "system")
    ) {
      throw new CodexProtocolError("Codex skill catalog is invalid");
    }
    if (catalog.errors.length > 0) {
      this.options.logger.warn(
        { count: catalog.errors.length },
        "Codex reported invalid Skill catalog entries",
      );
    }
    const enabledSkills = catalog.skills.filter((skill) => skill.enabled);
    const enabledNames = new Set<string>();
    const enabledStandaloneSkillNames = new Set<string>();
    const authorizedSkills: AuthorizedTurnSkill[] = [];
    const canonicalSkillsRoot = capabilityRuntime
      ? await realpath(capabilityRuntime.skillsRoot).catch(() => null)
      : null;
    const standaloneSkillPaths = new Map<string, boolean>();
    for (const skill of catalog.skills) {
      const isStandaloneSkillPath =
        capabilityRuntime !== null &&
        (await isPathInside(capabilityRuntime.skillsRoot, skill.path));
      standaloneSkillPaths.set(skill.path, isStandaloneSkillPath);
      if (
        isStandaloneSkillPath &&
        !RESERVED_LINKSENSE_SKILL_NAMES.has(skill.name) &&
        !authorizedStandaloneSkillNames.has(skill.name)
      ) {
        throw new CodexProtocolError(
          "Codex skill catalog violates the LinkSense capability runtime",
        );
      }
    }
    for (const skill of enabledSkills) {
      const isStandaloneSkillPath =
        standaloneSkillPaths.get(skill.path) === true;
      const owningPlugin = authorizedPlugins.find((plugin) =>
        plugin.skills.some((pluginSkill) => pluginSkill.name === skill.name),
      );
      const owningPluginSkill = owningPlugin?.skills.find(
        (pluginSkill) => pluginSkill.name === skill.name,
      );
      const cachedRelativePath =
        owningPlugin && owningPluginSkill
          ? await relativePathInside(owningPlugin.cacheRoot, skill.path)
          : null;
      const isPluginSkillPath =
        owningPluginSkill !== undefined &&
        ((await isSamePath(owningPluginSkill.sourcePath, skill.path)) ||
          cachedRelativePath === owningPluginSkill.relativePath);
      if (
        enabledNames.has(skill.name) ||
        (!isStandaloneSkillPath && !isPluginSkillPath)
      ) {
        throw new CodexProtocolError(
          "Codex skill catalog violates the LinkSense capability runtime",
        );
      }
      enabledNames.add(skill.name);
      let stablePath: string;
      if (isStandaloneSkillPath) {
        if (!capabilityRuntime || !canonicalSkillsRoot) {
          throw new CodexProtocolError(
            "Codex skill catalog violates the LinkSense capability runtime",
          );
        }
        const canonicalSkillPath = await realpath(skill.path);
        const skillRelativePath = relative(
          canonicalSkillsRoot,
          canonicalSkillPath,
        );
        const relativeSegments = skillRelativePath.split(sep);
        if (
          relativeSegments.length !== 2 ||
          relativeSegments[0] !== skill.name ||
          relativeSegments[1] !== "SKILL.md"
        ) {
          throw new CodexProtocolError(
            "Codex skill catalog violates the LinkSense capability runtime",
          );
        }
        stablePath = join(capabilityRuntime.skillsRoot, ...relativeSegments);
        enabledStandaloneSkillNames.add(skill.name);
      } else {
        stablePath = skill.path;
      }
      authorizedSkills.push({
        name: skill.name,
        ...(skill.description !== undefined
          ? { description: skill.description }
          : {}),
        path: stablePath,
      });
    }
    for (const skillName of authorizedStandaloneSkillNames) {
      if (!enabledStandaloneSkillNames.has(skillName)) {
        throw new CodexProtocolError(
          "Codex skill catalog violates the LinkSense capability runtime",
        );
      }
    }
    return authorizedSkills.sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en-US") ||
        left.path.localeCompare(right.path, "en-US"),
    );
  }

  private async handleNotification(
    managed: ManagedProcess,
    notification: JsonRpcNotification,
  ): Promise<void> {
    const params = notification.params as
      { threadId?: unknown; turn?: CodexTurn; turnId?: string } | undefined;
    const notifiedThreadId =
      typeof params?.threadId === "string" ? params.threadId : null;
    if (
      notifiedThreadId &&
      managed.codexThreadId &&
      notifiedThreadId !== managed.codexThreadId
    ) {
      return;
    }
    if (notification.method === "serverRequest/resolved") {
      const requestId = (notification.params as { requestId?: unknown } | undefined)
        ?.requestId;
      if (typeof requestId === "number" && Number.isSafeInteger(requestId)) {
        const pending = managed.pendingUserInputRequests.get(requestId);
        if (pending?.kind === "questions") {
          cancelPendingUserInputRequest(pending);
        }
      }
    }
    const notifiedTurnId = params?.turn?.id ?? params?.turnId;
    // Forking a native thread can emit cumulative token snapshots for turns
    // copied into the child history. Those turns are not an active LinkSense
    // execution and internal Codex-only turns intentionally have no local
    // projection, so publishing their snapshots would permanently block the
    // ordered outbox behind TURN_PROJECTION_PENDING.
    if (
      notification.method === "thread/tokenUsage/updated" &&
      notifiedTurnId !== managed.activeTurnId
    ) {
      return;
    }
    if (notifiedTurnId) managed.knownTurnIds.add(notifiedTurnId);
    if (managed.internalModelTransitionCompaction) {
      if (
        notifiedTurnId &&
        !managed.internalModelTransitionCompaction.baselineTurnIds.has(
          notifiedTurnId,
        )
      ) {
        rememberBounded(
          managed.suppressedNativeTurnIds,
          notifiedTurnId,
          true,
          128,
        );
        if (notification.method === "turn/completed") {
          managed.suppressedNativeTurnIds.delete(notifiedTurnId);
        }
      }
      return;
    }
    if (
      notification.method === "turn/started" &&
      notifiedTurnId &&
      managed.activeTurnId &&
      managed.activeTurnId !== notifiedTurnId
    ) {
      rememberBounded(
        managed.suppressedNativeTurnIds,
        notifiedTurnId,
        true,
        128,
      );
      this.options.logger.warn(
        {
          conversationId: managed.conversationId,
          activeCodexTurnId: managed.activeTurnId,
          suppressedCodexTurnId: notifiedTurnId,
        },
        "interrupting an unexpected concurrent native turn",
      );
      await managed.client
        .request("turn/interrupt", {
          threadId: managed.codexThreadId,
          turnId: notifiedTurnId,
        })
        .catch((error: unknown) =>
          this.options.logger.warn(
            {
              conversationId: managed.conversationId,
              suppressedCodexTurnId: notifiedTurnId,
              errorClass: error instanceof Error ? error.name : "unknown",
            },
            "failed to interrupt an unexpected concurrent native turn",
          ),
        );
      return;
    }
    if (
      notifiedTurnId &&
      managed.suppressedNativeTurnIds.has(notifiedTurnId)
    ) {
      if (notification.method === "turn/completed") {
        managed.suppressedNativeTurnIds.delete(notifiedTurnId);
      }
      return;
    }
    if (notification.method === "turn/started" && notifiedTurnId) {
      rememberBounded(
        managed.nativeStartedTurnIds,
        notifiedTurnId,
        true,
        128,
      );
      this.settleNativeTurnStartedWaiters(managed, notifiedTurnId, true);
    }
    if (
      notifiedTurnId &&
      !managed.activeTurnId &&
      (notification.method === "turn/started" ||
        managed.uncertainStartOperationId)
    ) {
      const recoveredProjectionTurnId =
        managed.activeProjectionTurnId ?? managed.uncertainStartOperationId;
      managed.activeTurnId = notifiedTurnId;
      managed.activeProjectionTurnId =
        recoveredProjectionTurnId ?? managed.activeProjectionTurnId;
      managed.uncertainStartOperationId = null;
      this.syncModelGatewayTurnCorrelation(managed);
    }
    if (notification.method === "thread/goal/updated") {
      const goal = (notification.params as { goal?: ThreadGoal } | undefined)
        ?.goal;
      if (goal?.threadId === managed.codexThreadId) managed.activeGoal = goal;
    } else if (notification.method === "thread/goal/cleared") {
      managed.activeGoal = null;
    }
    await this.hydrateSubAgentLabels(managed, notification);
    const activeTurnId = managed.activeTurnId;
    const projectionContext = {
      ...this.correlateNativeStopHook(managed, notification),
      subAgentLabelsByThreadId: managed.subAgentLabelsByThreadId,
    } satisfies CodexNotificationProjectionContext;
    const events = mapCodexNotification(
      notification,
      {
        workspace: managed.workspace,
        codexHome: managed.codexHome,
      },
      projectionContext,
    );
    const imageViewSourcePath = completedImageViewSourcePath(notification);
    let persistedTerminalTurnStatus: CodexTurn["status"] | null = null;
    for (const event of events) {
      const projectedEvent = await this.projectNativeAssetEvent(
        managed,
        event,
        imageViewSourcePath,
      );
      await this.options.eventSink.publish(
        managed.conversationId,
        projectedEvent,
      );
      if (
        projectedEvent.method === "item/completed" &&
        projectedEvent.params.item.type === "agentMessage" &&
        projectedEvent.params.item.phase === "final_answer"
      ) {
        rememberBounded(
          managed.lastCompletedFinalAgentMessageByTurn,
          projectedEvent.params.turnId,
          projectedEvent.params.item.id,
          64,
        );
      }
      if (
        managed.modelTransitionActive &&
        activeTurnId &&
        projectedEvent.method === "item/completed" &&
        projectedEvent.params.turnId === activeTurnId &&
        projectedEvent.params.item.type === "contextCompaction"
      ) {
        await this.withProcessLifecycleLock(
          managed.conversationId,
          async () => {
            if (
              this.processes.get(managed.conversationId) !== managed ||
              managed.activeTurnId !== activeTurnId ||
              !managed.modelTransitionActive
            ) {
              return;
            }
            managed.modelGatewayLease.setModelTransition(null, null);
            managed.modelTransitionActive = false;
            managed.modelTransitionNonce = null;
            this.syncModelGatewayTurnCorrelation(managed);
          },
        );
      }
      if (
        activeTurnId &&
        projectedEvent.method === "turn/completed" &&
        projectedEvent.params.turn.id === activeTurnId &&
        isTerminalTurn(projectedEvent.params.turn)
      ) {
        persistedTerminalTurnStatus = projectedEvent.params.turn.status;
      }
    }
    if (persistedTerminalTurnStatus) {
      for (const pending of managed.pendingUserInputRequests.values()) {
        if (pending.turnId === activeTurnId) {
          cancelPendingUserInputRequest(pending);
        }
      }
      await this.withProcessLifecycleLock(managed.conversationId, async () => {
        if (
          this.processes.get(managed.conversationId) !== managed ||
          managed.activeTurnId !== activeTurnId ||
          managed.starting
        ) {
          return;
        }
        managed.activeTurnId = null;
        managed.activeCollaborationMode = null;
        const goalWillContinue = managed.activeGoal?.status === "active";
        if (!goalWillContinue) managed.activeProjectionTurnId = null;
        if (persistedTerminalTurnStatus === "completed") {
          managed.modelGatewayLease.setModelTransition(null, null);
          managed.modelTransitionActive = false;
          managed.modelTransitionNonce = null;
        }
        this.syncModelGatewayTurnCorrelation(managed);
        managed.lastUsedAt = Date.now();
        managed.browserCleanupPending = !goalWillContinue;
        if (managed.browserCleanupPending) {
          await this.cleanupBrowserSession(managed);
          managed.browserCleanupPending = false;
        }
        if (!goalWillContinue) this.scheduleIdleClose(managed);
      });
    }
  }

  private rememberSubAgentMetadata(
    managed: ManagedProcess,
    notification: JsonRpcNotification,
  ): void {
    const params = objectRecord(notification.params);
    const previewContext = {
      workspace: managed.workspace,
      codexHome: managed.codexHome,
    };

    if (notification.method === "thread/started") {
      const thread = objectRecord(params.thread);
      const childThreadId = boundedCorrelationId(thread.id, 240);
      if (
        childThreadId &&
        managed.codexThreadId &&
        thread.parentThreadId === managed.codexThreadId
      ) {
        const agentLabel = deriveSubAgentThreadLabel(thread, previewContext);
        if (agentLabel) {
          rememberBounded(
            managed.subAgentLabelsByThreadId,
            childThreadId,
            agentLabel,
            256,
          );
        }
      }
      return;
    }

    if (
      notification.method !== "item/started" &&
      notification.method !== "item/completed"
    ) {
      return;
    }
    const item = objectRecord(params.item);
    if (item.type !== "subAgentActivity") return;
    const childThreadId = boundedCorrelationId(item.agentThreadId, 240);
    const agentLabel = deriveLogicalSubAgentPathLabel(
      item.agentPath,
      previewContext,
    );
    if (!childThreadId || !agentLabel) return;
    rememberBounded(
      managed.subAgentLabelsByThreadId,
      childThreadId,
      agentLabel,
      256,
    );
  }

  /**
   * Child notifications share the parent app-server connection. Keep their
   * native lifecycle Runner-local before the parent-only projection guard so
   * polling can observe a child completion immediately without publishing raw
   * child thread or turn identifiers.
   */
  private rememberSubAgentRuntime(
    managed: ManagedProcess,
    notification: JsonRpcNotification,
  ): void {
    const params = objectRecord(notification.params);
    if (notification.method === "thread/started") {
      const thread = objectRecord(params.thread);
      const childThreadId = boundedCorrelationId(thread.id, 240);
      if (
        !childThreadId ||
        !managed.codexThreadId ||
        thread.parentThreadId !== managed.codexThreadId
      ) {
        return;
      }
      const runtime = this.ensureCachedSubAgentRuntime(
        managed,
        childThreadId,
      );
      const threadStatus = parseCodexThreadStatus(thread.status);
      if (threadStatus) {
        runtime.threadStatus = threadStatus;
        const notificationRevision =
          ++managed.subAgentRuntimeNotificationRevision;
        runtime.latestNotificationRevision = notificationRevision;
      }
      return;
    }

    if (
      notification.method === "item/started" ||
      notification.method === "item/completed"
    ) {
      const item = objectRecord(params.item);
      if (item.type === "subAgentActivity") {
        const childThreadId = boundedCorrelationId(item.agentThreadId, 240);
        if (childThreadId) {
          this.ensureCachedSubAgentRuntime(managed, childThreadId);
        }
      } else if (item.type === "collabAgentToolCall") {
        const collect = (value: unknown) => {
          const childThreadId = boundedCorrelationId(value, 240);
          if (childThreadId) {
            this.ensureCachedSubAgentRuntime(managed, childThreadId);
          }
        };
        if (Array.isArray(item.receiverThreadIds)) {
          for (const childThreadId of item.receiverThreadIds) {
            collect(childThreadId);
          }
        }
        for (const childThreadId of Object.keys(objectRecord(item.agentsStates))) {
          collect(childThreadId);
        }
      }
    }

    const childThreadId = boundedCorrelationId(params.threadId, 240);
    if (
      !childThreadId ||
      !managed.codexThreadId ||
      childThreadId === managed.codexThreadId
    ) {
      return;
    }
    const runtime = managed.subAgentRuntimeByThreadId.get(childThreadId);
    if (!runtime) return;
    if (notification.method === "thread/status/changed") {
      const threadStatus = parseCodexThreadStatus(params.status);
      if (threadStatus) {
        runtime.threadStatus = threadStatus;
        const notificationRevision =
          ++managed.subAgentRuntimeNotificationRevision;
        runtime.latestNotificationRevision = notificationRevision;
      }
      return;
    }
    if (
      notification.method !== "turn/started" &&
      notification.method !== "turn/completed"
    ) {
      return;
    }
    const turn = objectRecord(params.turn);
    const turnId = boundedCorrelationId(turn.id, 240);
    const status = parseCodexTurnStatus(turn.status);
    if (!turnId || !status) return;
    runtime.latestTurn = {
      id: turnId,
      status,
      ...(typeof turn.startedAt === "number"
        ? { startedAt: turn.startedAt }
        : {}),
      ...(typeof turn.completedAt === "number"
        ? { completedAt: turn.completedAt }
        : {}),
      ...(typeof turn.durationMs === "number"
        ? { durationMs: turn.durationMs }
        : {}),
    };
    const notificationRevision = ++managed.subAgentRuntimeNotificationRevision;
    runtime.latestTurnNotificationRevision = notificationRevision;
    runtime.latestNotificationRevision = notificationRevision;
  }

  private ensureCachedSubAgentRuntime(
    managed: ManagedProcess,
    childThreadId: string,
  ): CachedSubAgentRuntime {
    const existing = managed.subAgentRuntimeByThreadId.get(childThreadId);
    if (existing) return existing;
    const created: CachedSubAgentRuntime = {
      threadStatus: null,
      latestTurn: null,
      latestTurnNotificationRevision: 0,
      latestNotificationRevision: 0,
    };
    rememberBounded(
      managed.subAgentRuntimeByThreadId,
      childThreadId,
      created,
      256,
    );
    return created;
  }

  /**
   * A resumed Runner may not have observed the child's thread/started event,
   * and Codex 0.150.1 can represent creation only as subAgentActivity. Read the
   * small thread header before projection so the durable chip receives the
   * semantic AgentPath label on both native shapes.
   */
  private async hydrateSubAgentLabels(
    managed: ManagedProcess,
    notification: JsonRpcNotification,
  ): Promise<void> {
    if (
      notification.method !== "item/started" &&
      notification.method !== "item/completed"
    ) {
      return;
    }
    const item = objectRecord(objectRecord(notification.params).item);
    if (
      (item.type !== "collabAgentToolCall" &&
        item.type !== "subAgentActivity") ||
      !managed.codexThreadId
    ) {
      return;
    }

    const childThreadIds = new Set<string>();
    const collect = (value: unknown) => {
      const childThreadId = boundedCorrelationId(value, 240);
      if (
        !childThreadId ||
        managed.subAgentLabelsByThreadId.has(childThreadId) ||
        childThreadIds.size >= runnerCodexPreviewLimits.subAgents
      ) {
        return;
      }
      childThreadIds.add(childThreadId);
    };
    if (item.type === "subAgentActivity") {
      collect(item.agentThreadId);
    } else {
      if (Array.isArray(item.receiverThreadIds)) {
        for (const childThreadId of item.receiverThreadIds) {
          collect(childThreadId);
        }
      }
      for (const childThreadId of Object.keys(objectRecord(item.agentsStates))) {
        collect(childThreadId);
      }
    }
    if (childThreadIds.size === 0) return;

    const previewContext = {
      workspace: managed.workspace,
      codexHome: managed.codexHome,
    };
    await Promise.all(
      [...childThreadIds].map(async (childThreadId) => {
        try {
          const response = await managed.client.request<ThreadReadResponse>(
            "thread/read",
            { threadId: childThreadId, includeTurns: false },
          );
          const thread = response.thread;
          const agentLabel =
            thread.id === childThreadId &&
            thread.parentThreadId === managed.codexThreadId
              ? deriveSubAgentThreadLabel(thread, previewContext)
              : null;
          if (agentLabel) {
            rememberBounded(
              managed.subAgentLabelsByThreadId,
              childThreadId,
              agentLabel,
              256,
            );
          }
        } catch (error) {
          this.options.logger.debug(
            {
              conversationId: managed.conversationId,
              errorClass: error instanceof Error ? error.name : "unknown",
            },
            "failed to load subagent display metadata",
          );
        }
      }),
    );
  }

  private correlateNativeStopHook(
    managed: ManagedProcess,
    notification: JsonRpcNotification,
  ): CodexNotificationProjectionContext {
    const params = objectRecord(notification.params);

    if (
      notification.method === "hook/started" ||
      notification.method === "hook/completed"
    ) {
      const turnId = boundedCorrelationId(params.turnId, 240);
      const run = objectRecord(params.run);
      const privateRunId = boundedCorrelationId(run.id, 4_096);
      if (notification.method === "hook/started") {
        if (
          turnId &&
          privateRunId &&
          run.eventName === "stop" &&
          run.status === "running"
        ) {
          rememberBounded(
            managed.pendingStopHooks,
            privateRunId,
            {
              turnId,
              supersededItemId:
                managed.lastCompletedFinalAgentMessageByTurn.get(turnId) ??
                null,
            },
            256,
          );
        }
        return {};
      }

      const pending = privateRunId
        ? managed.pendingStopHooks.get(privateRunId)
        : undefined;
      if (privateRunId) managed.pendingStopHooks.delete(privateRunId);
      return turnId &&
        run.eventName === "stop" &&
        run.status === "blocked" &&
        pending?.turnId === turnId &&
        pending.supersededItemId
        ? { supersededItemId: pending.supersededItemId }
        : {};
    }

    if (notification.method === "turn/completed") {
      const turnId = boundedCorrelationId(
        objectRecord(params.turn).id,
        240,
      );
      if (turnId) {
        managed.lastCompletedFinalAgentMessageByTurn.delete(turnId);
        for (const [privateRunId, pending] of managed.pendingStopHooks) {
          if (pending.turnId === turnId) {
            managed.pendingStopHooks.delete(privateRunId);
          }
        }
      }
    }
    return {};
  }

  private async handleServerRequest(
    managed: ManagedProcess,
    request: JsonRpcRequest,
  ): Promise<ToolRequestUserInputResponse> {
    const [mapped] = mapCodexServerRequest(request);
    if (!mapped || mapped.method !== "item/tool/requestUserInput") {
      throw new CodexProtocolError(
        `unsupported server request: ${request.method}`,
        request.method === "item/tool/requestUserInput"
          ? -32_602
          : -32_601,
      );
    }
    const itemId = mapped.params.itemId;
    if (
      managed.closing ||
      this.processes.get(managed.conversationId) !== managed ||
      mapped.params.threadId !== managed.codexThreadId ||
      mapped.params.turnId !== managed.activeTurnId ||
      managed.pendingUserInputRequests.has(request.id)
    ) {
      throw new CodexProtocolError("stale user-input request", -32_602);
    }

    let pending: PendingUserInputRequest | undefined;
    const response = new Promise<ToolRequestUserInputResponse>((resolve) => {
      const createdPending: PendingUserInputRequest = {
        kind: "questions",
        threadId: mapped.params.threadId,
        turnId: mapped.params.turnId,
        itemId,
        questions: mapped.params.questions,
        timer: null,
        resolve: (result) => {
          if (
            managed.pendingUserInputRequests.get(request.id) !== createdPending
          ) {
            return;
          }
          managed.pendingUserInputRequests.delete(request.id);
          if (createdPending.timer) clearTimeout(createdPending.timer);
          resolve(result);
        },
      };
      pending = createdPending;
      managed.pendingUserInputRequests.set(request.id, createdPending);
    });
    if (
      pending &&
      !mapped.params.isBlocking &&
      mapped.params.autoResolutionMs !== null
    ) {
      pending.timer = setTimeout(
        () => {
          if (pending) cancelPendingUserInputRequest(pending);
        },
        mapped.params.autoResolutionMs,
      );
      pending.timer.unref();
    }
    try {
      await this.options.eventSink.publish(managed.conversationId, mapped);
    } catch (error) {
      if (pending && managed.pendingUserInputRequests.get(request.id) === pending) {
        managed.pendingUserInputRequests.delete(request.id);
        if (pending.timer) clearTimeout(pending.timer);
      }
      throw error;
    }
    return response;
  }

  private async projectNativeAssetEvent(
    managed: ManagedProcess,
    event: LinkSenseCodexEvent,
    imageViewSourcePath?: string,
  ): Promise<LinkSenseCodexEvent> {
    if (event.method !== "item/completed") return event;

    if (event.params.item.type === "imageView") {
      // Asset projection needs the original source path for authorized Skill
      // assets that intentionally sanitize to $ABSOLUTE in the persisted event.
      // Only the mapped event is published; the raw path stays process-local.
      const path = imageViewSourcePath ?? event.params.item.path;
      if (!path) return event;
      const cacheKey = `${event.params.turnId}:${event.params.item.id}`;
      let fileId = managed.imageViewProjections.get(cacheKey);
      if (!managed.imageViewProjections.has(cacheKey)) {
        try {
          const projection = await projectImageViewAsset({
            path,
            workspace: managed.workspace,
            codexHome: managed.codexHome,
            authorizedSkills: managed.authorizedSkills,
            turnId: event.params.turnId,
            itemId: event.params.item.id,
            registerArtifact: (artifact) =>
              this.registerInlineImageArtifact(
                managed.conversationId,
                event.params.turnId,
                artifact,
              ),
          });
          fileId = projection.fileId;
        } catch {
          fileId = null;
          this.options.logger.warn(
            {
              conversationId: managed.conversationId,
              turnId: event.params.turnId,
              itemId: event.params.item.id,
            },
            "image view asset projection failed closed",
          );
        }
        if (managed.imageViewProjections.size >= 256) {
          const oldestKey = managed.imageViewProjections.keys().next().value;
          if (oldestKey !== undefined) {
            managed.imageViewProjections.delete(oldestKey);
          }
        }
        managed.imageViewProjections.set(cacheKey, fileId ?? null);
      }
      if (!fileId) return event;
      return {
        ...event,
        params: {
          ...event.params,
          item: { ...event.params.item, fileId },
        },
      };
    }

    if (event.params.item.type !== "agentMessage") return event;

    const cacheKey = `${event.params.turnId}:${event.params.item.id}`;
    const cachedText = managed.assistantMessageProjections.get(cacheKey);
    if (cachedText !== undefined) {
      return {
        ...event,
        params: {
          ...event.params,
          item: { ...event.params.item, text: cachedText },
        },
      };
    }

    let text = blockUnresolvedLocalMarkdownImages(event.params.item.text);
    try {
      const projection = await projectAssistantMessageAssets({
        text: event.params.item.text,
        workspace: managed.workspace,
        codexHome: managed.codexHome,
        authorizedSkills: managed.authorizedSkills,
        turnId: event.params.turnId,
        itemId: event.params.item.id,
        registerArtifact: (artifact) =>
          this.registerInlineImageArtifact(
            managed.conversationId,
            event.params.turnId,
            artifact,
          ),
      });
      text = projection.text;
      if (projection.unavailableImageCount > 0) {
        this.options.logger.warn(
          {
            conversationId: managed.conversationId,
            turnId: event.params.turnId,
            unavailableImageCount: projection.unavailableImageCount,
          },
          "assistant message contained unavailable local images",
        );
      }
    } catch {
      this.options.logger.warn(
        {
          conversationId: managed.conversationId,
          turnId: event.params.turnId,
        },
        "assistant message local image projection failed closed",
      );
    }
    if (managed.assistantMessageProjections.size >= 256) {
      const oldestKey = managed.assistantMessageProjections.keys().next().value;
      if (oldestKey !== undefined) {
        managed.assistantMessageProjections.delete(oldestKey);
      }
    }
    managed.assistantMessageProjections.set(cacheKey, text);

    return {
      ...event,
      params: {
        ...event.params,
        item: {
          ...event.params.item,
          text,
        },
      },
    };
  }

  private async registerInlineImageArtifact(
    conversationId: string,
    turnId: string,
    artifact: Parameters<RegisterInlineImageArtifact>[0],
  ): Promise<unknown> {
    const managed = this.processes.get(conversationId);
    if (
      managed?.activeTurnId === turnId &&
      managed.activeCollaborationMode === "plan"
    ) {
      throw new FileServiceRequestError("FILE_SERVICE_FORBIDDEN", false, 403);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.options.eventSink.registerArtifact({
          conversationId,
          turnId,
          ...artifact,
        });
      } catch (error) {
        if (
          !(error instanceof FileServiceRequestError) ||
          !error.retryable ||
          attempt === 2
        ) {
          throw error;
        }
        await new Promise<void>((resolveRetry) => {
          const timer = setTimeout(resolveRetry, 50 * 2 ** attempt);
          timer.unref();
        });
      }
    }
    throw new Error("inline image artifact registration exhausted");
  }

  private requireProcess(conversationId: string): ManagedProcess {
    const managed = this.processes.get(conversationId);
    if (!managed)
      throw new CodexProtocolError("conversation app-server is not loaded");
    return managed;
  }

  private async reserveProcessSlot(processLimit: number): Promise<void> {
    for (;;) {
      let evictionTarget: ManagedProcess | undefined;
      const reserved = await this.withProcessCapacityLock(async () => {
        if (
          this.processes.size + this.pendingProcessSlots <
          processLimit
        ) {
          this.pendingProcessSlots += 1;
          return true;
        }
        evictionTarget = [...this.processes.values()]
          .filter(
            (entry) =>
              !entry.evicting &&
              !entry.starting &&
              !entry.activeTurnId &&
              !hasContinuingGoal(entry) &&
              !entry.uncertainStartOperationId &&
              !entry.capabilityLeaseToken,
          )
          .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
        if (!evictionTarget) {
          throw new CodexProtocolError(
            "runner app-server process limit reached",
          );
        }
        evictionTarget.evicting = true;
        return false;
      });
      if (reserved) return;

      const target = evictionTarget;
      if (!target) {
        throw new CodexProtocolError("runner app-server process limit reached");
      }
      try {
        await this.withProcessLifecycleLock(target.conversationId, async () => {
          if (
            this.processes.get(target.conversationId) !== target ||
            target.starting ||
            target.activeTurnId ||
            target.uncertainStartOperationId ||
            target.capabilityLeaseToken
          ) {
            return;
          }
          await this.closeManagedProcess(target);
        });
      } finally {
        if (this.processes.get(target.conversationId) === target) {
          target.evicting = false;
        }
      }
    }
  }

  private async withReservedProcessSlot<T>(
    operation: (
      commit: (managed: ManagedProcess) => Promise<void>,
    ) => Promise<T>,
    reservationAlreadyActive = false,
    processLimit = this.options.processLimit,
  ): Promise<T> {
    if (!reservationAlreadyActive) await this.reserveProcessSlot(processLimit);
    let reservationActive = true;
    const commit = async (managed: ManagedProcess): Promise<void> => {
      await this.withProcessCapacityLock(async () => {
        if (!reservationActive) {
          throw new Error("app-server process slot reservation is not active");
        }
        if (this.processes.has(managed.conversationId)) {
          throw new Error("conversation app-server is already registered");
        }
        this.releaseProcessSlot();
        this.processes.set(managed.conversationId, managed);
        reservationActive = false;
      });
    };
    try {
      return await operation(commit);
    } finally {
      if (reservationActive) {
        await this.withProcessCapacityLock(async () => {
          if (!reservationActive) return;
          this.releaseProcessSlot();
          reservationActive = false;
        });
      }
    }
  }

  private releaseProcessSlot(): void {
    if (this.pendingProcessSlots <= 0) {
      throw new Error("app-server process slot reservation underflow");
    }
    this.pendingProcessSlots -= 1;
  }

  private async releaseReservedProcessSlot(): Promise<void> {
    await this.withProcessCapacityLock(async () => {
      this.releaseProcessSlot();
    });
  }

  private async withProcessCapacityLock<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.processCapacityTail;
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.processCapacityTail = tail;
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.processCapacityTail === tail) {
        this.processCapacityTail = Promise.resolve();
      }
    }
  }

  private clearIdleTimer(managed: ManagedProcess): void {
    if (!managed.idleTimer) return;
    clearTimeout(managed.idleTimer);
    managed.idleTimer = null;
  }

  private releaseStartingProcess(managed: ManagedProcess | undefined): void {
    if (!managed || this.processes.get(managed.conversationId) !== managed) {
      return;
    }
    managed.starting = false;
    this.scheduleIdleClose(managed);
  }

  private assertAcceptingOperations(): void {
    if (this.shuttingDown) {
      throw new CodexProtocolError("runner is shutting down");
    }
  }

  private prepareUserMcpProxyRuntime(
    input: StartTurnInput,
  ): PreparedUserMcpProxyRuntime {
    const servers = mcpServersFor(input);
    const capabilityCredentialSources = new Set(
      input.capabilities.flatMap((capability) =>
        Object.values(capability.credentialEnvironment ?? {}),
      ),
    );
    const personalMcpCredentialSources = new Set(
      servers.flatMap((server) =>
        server.transport === "stdio"
          ? server.environmentVariables.map(({ source }) => source)
          : server.credential
            ? [
                server.credential.source,
                ...(server.requestHeaders ?? []).map(({ source }) => source),
              ]
            : (server.requestHeaders ?? []).map(({ source }) => source),
      ),
    );
    const childEnvironment = Object.fromEntries(
      Object.entries(input.environment).filter(
        ([name]) =>
          !name.startsWith("LINKSENSE_MCP_CREDENTIAL_") &&
          !name.startsWith("LINKSENSE_MCP_STDIO_") &&
          (input.collaborationMode !== "plan" ||
            (!name.startsWith("LINKSENSE_CREDENTIAL_") &&
              !capabilityCredentialSources.has(name) &&
              !personalMcpCredentialSources.has(name) &&
              !PLAN_MUTATION_SERVICE_ENVIRONMENT_NAMES.has(name))),
      ),
    );
    if (input.collaborationMode === "plan") {
      return { runtime: null, childEnvironment, configServers: [] };
    }
    if (servers.length === 0) {
      return { runtime: null, childEnvironment, configServers: [] };
    }
    const httpServers = servers.filter(
      (server) => server.transport === "streamable_http",
    );
    const runtime: UserMcpProxyRuntime | null =
      httpServers.length === 0
        ? null
        : {
            id: randomBytes(24).toString("base64url"),
            bindings: new Map(),
          };
    const endpointOrigin = new URL(this.options.mcpEndpointBase).origin;
    const configServers = servers.map((server) => {
      if (server.transport === "stdio") {
        for (const mapping of server.environmentVariables) {
          const value = input.environment[mapping.source];
          if (value === undefined) {
            throw new CodexProtocolError("MCP environment is unavailable");
          }
          childEnvironment[mapping.source] = value;
        }
        return server;
      }
      const token = randomBytes(32).toString("base64url");
      const source = `LINKSENSE_MCP_CREDENTIAL_${createHash("sha256")
        .update(token)
        .digest("hex")
        .slice(0, 32)
        .toUpperCase()}`;
      childEnvironment[source] = token;
      let auth: UserMcpProxyTarget["auth"] = { type: "none" };
      if (server.credential) {
        const value = input.environment[server.credential.source];
        if (!value) {
          throw new CodexProtocolError("MCP credential is unavailable");
        }
        auth =
          server.credential.type === "bearer"
            ? { type: "bearer", value }
            : {
                type: "api_key",
                headerName: server.credential.headerName,
                value,
              };
      }
      const requestHeaders = (server.requestHeaders ?? []).map((header) => {
        const value = input.environment[header.source];
        if (!value) {
          throw new CodexProtocolError("MCP request header is unavailable");
        }
        return { name: header.headerName, value };
      });
      runtime!.bindings.set(server.id, {
        token,
        target: {
          url: server.url,
          startupTimeoutMs: server.startupTimeoutSeconds * 1_000,
          toolTimeoutMs: server.toolTimeoutSeconds * 1_000,
          auth,
          ...(requestHeaders.length > 0 ? { requestHeaders } : {}),
        },
      });
      return {
        id: server.id,
        serverKey: server.serverKey,
        name: server.name,
        transport: "streamable_http" as const,
        revision: server.revision,
        startupTimeoutSeconds: server.startupTimeoutSeconds,
        toolTimeoutSeconds: server.toolTimeoutSeconds,
        url: `${endpointOrigin}/mcp-user/${input.conversationId}/${server.id}`,
        credential: { type: "bearer" as const, source },
      };
    });
    return { runtime, childEnvironment, configServers };
  }

  private removeUserMcpProxyRuntime(
    conversationId: string,
    runtimeId: string | null,
  ): void {
    if (!runtimeId) return;
    if (this.userMcpProxyRuntimes.get(conversationId)?.id === runtimeId) {
      this.userMcpProxyRuntimes.delete(conversationId);
    }
  }

  private runtimeFingerprintFor(
    input: StartTurnInput,
    runtimeEnvironment: Record<string, string>,
    codexThreadId: string | null,
  ): string {
    const capabilities = input.capabilities
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        type: capability.type,
        revision: capability.revision,
        credentialEnvironment: capability.credentialEnvironment ?? {},
      }))
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type, "en-US") ||
          left.id.localeCompare(right.id, "en-US") ||
          left.name.localeCompare(right.name, "en-US"),
      );
    const canonical = canonicalValue({
      ownerId: input.ownerId,
      codexThreadId,
      runtimePurpose: input.runtimePurpose ?? "execution",
      collaborationMode: input.collaborationMode,
      expectedRuntimeGeneration: input.expectedRuntimeGeneration,
      capabilityGeneration: input.capabilityGeneration,
      mcpGeneration: mcpGenerationFor(input),
      modelProviderRevision: input.modelProvider.revision,
      modelProviderBaseUrl: input.modelProvider.baseUrl,
      modelProviderProtocolMode: input.modelProvider.protocolMode,
      modelContextWindow: input.modelProvider.modelContextWindow ?? null,
      modelAutoCompactTokenLimit:
        input.modelProvider.modelAutoCompactTokenLimit ?? null,
      model: input.model,
      modelTransitionSource: input.modelTransitionSource
        ? {
            model: input.modelTransitionSource.model,
            providerRevision: input.modelTransitionSource.provider.revision,
            providerBaseUrl: input.modelTransitionSource.provider.baseUrl,
            providerProtocolMode:
              input.modelTransitionSource.provider.protocolMode,
          }
        : null,
      templateVersion: this.options.templateVersion,
      capabilities,
      mcpServers: mcpServersFor(input),
      environment: input.environment,
      runtimeEnvironment,
    });
    return createHmac("sha256", this.runtimeFingerprintSecret)
      .update(JSON.stringify(canonical), "utf8")
      .digest("hex");
  }

  private scheduleIdleClose(managed: ManagedProcess): void {
    if (
      managed.closing ||
      managed.evicting ||
      managed.starting ||
      hasContinuingGoal(managed) ||
      this.processes.get(managed.conversationId) !== managed
    ) {
      return;
    }
    this.clearIdleTimer(managed);
    managed.idleTimer = setTimeout(() => {
      void this.withProcessLifecycleLock(managed.conversationId, async () => {
        if (
          managed.starting ||
          managed.activeTurnId ||
          hasContinuingGoal(managed) ||
          managed.uncertainStartOperationId
        ) {
          return;
        }
        const protectedExit = managed.capabilityLeaseToken !== null;
        try {
          await this.closeManagedProcess(managed, false, {
            preserveCapabilityLease: protectedExit,
          });
        } catch (error) {
          if (!protectedExit || !managed.client.isExited) throw error;
        }
        if (protectedExit) {
          await this.recoverExitedManagedProcess(managed);
        }
      }).catch(() =>
        this.options.logger.error(
          { conversationId: managed.conversationId },
          "failed to close idle app-server process",
        ),
      );
    }, this.options.idleTtlMs);
    managed.idleTimer.unref();
  }

  private async closeManagedProcess(
    managed: ManagedProcess,
    browserAlreadyClean = false,
    options: { preserveCapabilityLease?: boolean } = {},
  ): Promise<void> {
    if (this.processes.get(managed.conversationId) !== managed) return;
    this.clearIdleTimer(managed);
    managed.closing = true;
    for (const pending of [...managed.pendingUserInputRequests.values()]) {
      cancelPendingUserInputRequest(pending);
    }
    try {
      await managed.client.close();
    } catch (error) {
      if (managed.client.isExited) {
        if (!options.preserveCapabilityLease) {
          await this.releaseManagedCapabilityLeaseToken(managed);
        }
        await this.finalizeManagedProcess(managed, browserAlreadyClean);
      } else {
        managed.closing = false;
      }
      throw error;
    }
    if (!options.preserveCapabilityLease) {
      await this.releaseManagedCapabilityLeaseToken(managed);
    }
    await this.finalizeManagedProcess(managed, browserAlreadyClean);
  }

  private async finalizeManagedProcess(
    managed: ManagedProcess,
    browserAlreadyClean = false,
  ): Promise<void> {
    if (managed.finalizationPromise) return managed.finalizationPromise;
    managed.closing = true;
    managed.finalizationPromise = (async () => {
      this.clearIdleTimer(managed);
      if (this.processes.get(managed.conversationId) === managed) {
        this.processes.delete(managed.conversationId);
      }
      managed.lastCompletedFinalAgentMessageByTurn.clear();
      managed.nativeStartedTurnIds.clear();
      for (const turnId of managed.nativeTurnStartedWaiters.keys()) {
        this.settleNativeTurnStartedWaiters(managed, turnId, false);
      }
      managed.internalModelTransitionCompaction = null;
      managed.suppressedNativeTurnIds.clear();
      managed.pendingStopHooks.clear();
      managed.modelGatewayLease.release();
      this.removeUserMcpProxyRuntime(
        managed.conversationId,
        managed.mcpProxyRuntimeId,
      );
      if (!browserAlreadyClean) await this.cleanupBrowserSession(managed);
      managed.browserCleanupPending = false;
      await this.options.eventSink.flushConversation?.(
        managed.conversationId,
        250,
      );
    })();
    return managed.finalizationPromise;
  }

  private async recoverExitedManagedProcess(
    managed: ManagedProcess,
  ): Promise<void> {
    await this.finalizeManagedProcess(managed).catch(() =>
      this.options.logger.error(
        { conversationId: managed.conversationId },
        "failed to finalize app-server resources after exit",
      ),
    );
    if (!managed.capabilityLeaseToken) {
      return;
    }
    const token = managed.capabilityLeaseToken;
    const confirmed =
      await this.reportProtectedProcessExitUntilConfirmed(token);
    if (!confirmed) return;
    if (managed.capabilityLeaseToken === token) {
      managed.capabilityLeaseToken = null;
    }
    await this.releaseTaskCapabilityLeaseToken(token);
  }

  private async reportProtectedProcessExitUntilConfirmed(
    token: TaskCapabilityLeaseToken,
  ): Promise<boolean> {
    let attempt = 0;
    while (!this.processExitRetryAbort.signal.aborted) {
      try {
        await this.options.eventSink.reportProcessExit({
          conversationId: token.conversationId,
          projectionTurnId: token.projectionTurnId,
          capabilityGeneration: token.lease.generation,
        });
        return true;
      } catch {
        attempt += 1;
        if (attempt === 1 || isPowerOfTwo(attempt)) {
          this.options.logger.error(
            { conversationId: token.conversationId, attempt },
            "failed to confirm protected app-server exit",
          );
        }
      }
      const backoff = Math.min(
        PROCESS_EXIT_RETRY_MAX_MS,
        PROCESS_EXIT_RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 16),
      );
      await abortablePoolDelay(backoff, this.processExitRetryAbort.signal);
    }
    return false;
  }

  private async cleanupBrowserSession(managed: ManagedProcess): Promise<void> {
    if (!this.options.browserSessionCleanup) return;
    try {
      await this.options.browserSessionCleanup({
        conversationId: managed.conversationId,
        ownerId: managed.ownerId,
        userHome: managed.userHome,
        codexHome: managed.codexHome,
        workspace: managed.workspace,
      });
    } catch {
      this.options.logger.error(
        { conversationId: managed.conversationId },
        "managed browser session cleanup failed",
      );
    }
  }

  private async runCodexHealthProbe(
    codexHomeRoot: string,
  ): Promise<Omit<CodexAppServerHealth, "cached">> {
    const checkedAt = new Date().toISOString();
    let probeHome: string | undefined;
    let client: CodexJsonRpcClient | undefined;
    this.modelCatalogCache = undefined;
    try {
      await mkdir(codexHomeRoot, { recursive: true });
      probeHome = await mkdtemp(join(codexHomeRoot, ".health-probe-"));
      if (this.options.codexProcessIdentity) await chmod(probeHome, 0o770);
      const probeCodexHome = join(probeHome, ".codex");
      await mkdir(probeCodexHome, { mode: 0o770 });
      if (this.options.healthProbe) {
        await this.options.healthProbe(probeCodexHome);
      } else {
        client = new CodexJsonRpcClient({
          command: this.options.command,
          userHome: probeHome,
          codexHome: probeCodexHome,
          logger: this.options.logger,
          requestTimeoutMs: 5_000,
          configOverrides: [...this.globalFeatureOverrides],
          ...(this.options.childProcessFactory
            ? { childProcessFactory: this.options.childProcessFactory }
            : {}),
          ...(this.options.codexProcessIdentity
            ? { processIdentity: this.options.codexProcessIdentity }
            : {}),
        });
        await client.initialize();
        await assertCodexCollaborationModes(client);
        try {
          const catalog = await loadCodexModelCatalog(client);
          this.modelCatalogCache = {
            expiresAt:
              Date.now() +
              (this.options.healthProbeTtlMs ??
                DEFAULT_CODEX_HEALTH_PROBE_TTL_MS),
            catalog,
          };
        } catch {
          this.options.logger.warn(
            "Codex model/list failed after app-server initialization",
          );
        }
      }
      return {
        status: "available",
        reason_code: null,
        checked_at: checkedAt,
      };
    } catch {
      return {
        status: "unavailable",
        reason_code: "CODEX_APP_SERVER_HANDSHAKE_FAILED",
        checked_at: checkedAt,
      };
    } finally {
      await client?.close().catch(() => undefined);
      if (probeHome) {
        await rm(probeHome, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  }
}

const codexCollaborationModeListResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          mode: z.enum(["default", "plan"]).nullable(),
          name: z.string().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

async function assertCodexCollaborationModes(
  client: CodexJsonRpcClient,
): Promise<void> {
  const raw = await client.request<CollaborationModeListResponse>(
    "collaborationMode/list",
    {},
  );
  const parsed = codexCollaborationModeListResponseSchema.parse(raw);
  const modes = new Set(
    parsed.data.flatMap((entry) => (entry.mode ? [entry.mode] : [])),
  );
  if (!modes.has("default") || !modes.has("plan")) {
    throw new CodexProtocolError(
      "Codex collaborationMode/list does not expose Default and Plan",
    );
  }
}

const codexModelListResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string(),
          model: z.string(),
          supportedReasoningEfforts: z.array(
            z.object({ reasoningEffort: z.unknown() }).passthrough(),
          ),
          defaultReasoningEffort: z.unknown(),
        })
        .passthrough(),
    ),
    nextCursor: z.string().nullable(),
  })
  .passthrough();

async function loadCodexModelCatalog(
  client: CodexJsonRpcClient,
): Promise<CodexModelReasoningCatalog> {
  const models = new Map<
    string,
    CodexModelReasoningCatalog["models"][number]
  >();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const raw = await client.request<ModelListResponse>("model/list", {
      cursor,
      limit: 100,
      includeHidden: true,
    });
    const response = codexModelListResponseSchema.parse(raw);
    for (const model of response.data) {
      const id = modelIdentifierSchema.safeParse(model.model);
      if (!id.success) continue;
      const efforts = [
        ...new Set(
          model.supportedReasoningEfforts.flatMap(({ reasoningEffort }) => {
            const parsed = reasoningEffortSchema.safeParse(reasoningEffort);
            return parsed.success ? [parsed.data] : [];
          }),
        ),
      ];
      if (efforts.length === 0) continue;
      const parsedDefault = reasoningEffortSchema.safeParse(
        model.defaultReasoningEffort,
      );
      models.set(id.data.toLowerCase(), {
        id: id.data,
        supported_reasoning_efforts: efforts,
        default_reasoning_effort:
          parsedDefault.success && efforts.includes(parsedDefault.data)
            ? parsedDefault.data
            : efforts[0]!,
      });
    }
    if (!response.nextCursor) break;
    if (seenCursors.has(response.nextCursor)) {
      throw new CodexProtocolError("Codex model/list cursor repeated");
    }
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  return codexModelReasoningCatalogSchema.parse({
    models: [...models.values()],
  });
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function abortablePoolDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function startOperationKey(
  conversationId: string,
  projectionTurnId: string,
): string {
  return `${conversationId}:${projectionTurnId}`;
}

function steerOperationKey(
  conversationId: string,
  operationId: string,
): string {
  return `${conversationId}:${operationId}`;
}

function allocateInteractiveFormRequestId(managed: ManagedProcess): number {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const requestId = randomInt(1, 2 ** 48 - 1);
    if (!managed.pendingUserInputRequests.has(requestId)) return requestId;
  }
  throw new InteractiveFormRequestError(
    "INTERACTIVE_FORM_UNAVAILABLE",
    true,
    503,
  );
}

function cancelPendingUserInputRequest(
  pending: PendingUserInputRequest,
): void {
  if (pending.kind === "questions") {
    pending.resolve({ answers: {} });
    return;
  }
  pending.resolve({ action: "cancel" });
}

function validateUserInputAnswers(
  questions: ToolRequestUserInputQuestion[],
  answers: Record<string, string[]>,
): ToolRequestUserInputResponse["answers"] {
  const questionIds = questions.map((question) => question.id).sort();
  if (
    JSON.stringify(Object.keys(answers).sort()) !== JSON.stringify(questionIds)
  ) {
    throw new UserInputRequestUnavailableError(
      "user-input answers do not match questions",
    );
  }
  return Object.fromEntries(
    questions.map((question) => {
      const values = answers[question.id];
      const answer = values?.[0];
      if (
        !values ||
        values.length !== 1 ||
        !answer ||
        !answer.trim() ||
        answer.length > 4_000
      ) {
        throw new UserInputRequestUnavailableError("invalid user-input answer");
      }
      const optionLabels = new Set(
        question.options?.map((option) => option.label) ?? [],
      );
      if (!optionLabels.has(answer) && !question.isOther) {
        throw new UserInputRequestUnavailableError(
          "unsupported user-input answer",
        );
      }
      return [question.id, { answers: [answer] }] as const;
    }),
  );
}

function startRequestFingerprint(input: StartTurnInput): string {
  return hashCanonicalValue({
    ownerId: input.ownerId,
    operationKind: input.operationKind ?? "turn",
    eventProjectionTurnId: eventProjectionTurnIdFor(input),
    expectedRuntimeGeneration: input.expectedRuntimeGeneration,
    capabilityGeneration: input.capabilityGeneration,
    mcpGeneration: mcpGenerationFor(input),
    codexThreadId: input.codexThreadId ?? null,
    forkFromCodexTurnId: input.forkFromCodexTurnId ?? null,
    goal: input.goal ?? null,
    collaborationMode: input.collaborationMode,
    model: input.model,
    modelTransitionSource: input.modelTransitionSource ?? null,
    reasoningEffort: input.reasoningEffort,
    modelProviderRevision: input.modelProvider.revision,
    modelProviderBaseUrl: input.modelProvider.baseUrl,
    modelProviderProtocolMode: input.modelProvider.protocolMode,
    context: input.context,
    capabilities: input.capabilities
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        type: capability.type,
        revision: capability.revision,
        credentialEnvironment: capability.credentialEnvironment ?? {},
      }))
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type, "en-US") ||
          left.id.localeCompare(right.id, "en-US"),
      ),
    mcpServers: mcpServersFor(input),
  });
}

function eventProjectionTurnIdFor(
  input: Pick<StartTurnInput, "projectionTurnId" | "eventProjectionTurnId">,
): string {
  return input.eventProjectionTurnId ?? input.projectionTurnId;
}

function mcpGenerationFor(
  input: Pick<StartTurnInput, "mcpGeneration">,
): string {
  return input.mcpGeneration ?? EMPTY_MCP_GENERATION;
}

function mcpServersFor(
  input: Pick<StartTurnInput, "mcpServers">,
): RuntimeMcpServer[] {
  return input.mcpServers ?? [];
}

function modelGatewayTransitionSourceFor(
  input: StartTurnInput,
  sourceModel: string,
): ModelGatewayTransitionSource {
  const source = input.modelTransitionSource;
  if (!source || source.model.trim() !== sourceModel) {
    throw new CodexProtocolError(
      "model transition source runtime is unavailable",
      -32_600,
    );
  }
  return {
    revision: source.provider.revision,
    upstreamBaseUrl: source.provider.baseUrl,
    apiKey: source.provider.apiKey,
    protocolMode: source.provider.protocolMode,
    model: sourceModel,
    pricing: source.provider.pricing ?? zeroModelTokenPricing,
  };
}

export function memoryConfigOverrides(
  personalization: Pick<PersonalizationSnapshot, "memories_enabled">,
  model?: string,
): string[] {
  return [
    `memories.generate_memories=${String(personalization.memories_enabled)}`,
    `memories.use_memories=${String(personalization.memories_enabled)}`,
    "memories.disable_on_external_context=true",
    ...(model
      ? [
          `memories.extract_model=${JSON.stringify(model)}`,
          `memories.consolidation_model=${JSON.stringify(model)}`,
        ]
      : []),
  ];
}

export function planRuntimeConfigOverrides(
  collaborationMode: StartTurnInput["collaborationMode"],
): string[] {
  return collaborationMode === "plan"
    ? [
        "features.hooks=true",
        "features.use_legacy_landlock=true",
        "mcp_servers.linksense_managed_browser.enabled=true",
        "mcp_servers.linksense_managed_browser.required=true",
      ]
    : [];
}

type LinkSenseThreadRuntimeOverrides = {
  model: string;
  modelProvider: typeof linkSenseModelProviderId;
  cwd: string;
  runtimeWorkspaceRoots: string[];
  approvalPolicy: typeof LINKSENSE_APPROVAL_POLICY;
  sandbox: "danger-full-access";
};

function linkSenseThreadRuntimeOverrides(
  model: string,
  workspace: string,
): LinkSenseThreadRuntimeOverrides {
  return {
    model,
    modelProvider: linkSenseModelProviderId,
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    approvalPolicy: LINKSENSE_APPROVAL_POLICY,
    sandbox: "danger-full-access" as const,
  };
}

function assertLinkSenseThreadProvider(
  thread: CodexThread,
  operation: "start" | "resume" | "fork" | "rollback" | "read",
): void {
  if (thread.modelProvider !== linkSenseModelProviderId) {
    throw new CodexProtocolError(
      `Codex ${operation} returned an unexpected model provider`,
    );
  }
}

function assertLinkSenseThreadRuntime(
  response: Pick<ThreadStartResponse, "model" | "modelProvider">,
  operation: "start" | "resume" | "fork",
  expectedModel?: string,
): string {
  if (response.modelProvider !== linkSenseModelProviderId) {
    throw new CodexProtocolError(
      `Codex ${operation} returned an unexpected model provider`,
    );
  }
  if (typeof response.model !== "string") {
    throw new CodexProtocolError(
      `Codex ${operation} returned an invalid model`,
    );
  }
  const model = response.model.trim();
  if (!model) {
    throw new CodexProtocolError(
      `Codex ${operation} returned an invalid model`,
    );
  }
  if (expectedModel !== undefined && model !== expectedModel) {
    throw new CodexProtocolError(
      `Codex ${operation} returned an unexpected model`,
    );
  }
  return model;
}

export function mcpConfigOverrides(
  servers: RuntimeMcpServer[],
  stdioLauncher?: { command: string; args: string[]; cwd: string },
): string[] {
  return servers.flatMap((server) => {
    const prefix = `mcp_servers.${server.serverKey}`;
    if (server.transport === "stdio") {
      if (!stdioLauncher) {
        throw new CodexProtocolError(
          "personal STDIO MCP launcher is unavailable",
        );
      }
      const descriptor = encodePersonalStdioDescriptor({
        version: 1,
        command: server.command,
        args: server.args,
        environmentVariables: server.environmentVariables,
      });
      return [
        `${prefix}.command=${JSON.stringify(stdioLauncher.command)}`,
        `${prefix}.args=${JSON.stringify([...stdioLauncher.args, descriptor])}`,
        `${prefix}.env_vars=${JSON.stringify(server.environmentVariables.map(({ source }) => source))}`,
        `${prefix}.cwd=${JSON.stringify(stdioLauncher.cwd)}`,
        `${prefix}.enabled=true`,
        `${prefix}.required=false`,
        `${prefix}.startup_timeout_sec=${String(server.startupTimeoutSeconds)}`,
        `${prefix}.tool_timeout_sec=${String(server.toolTimeoutSeconds)}`,
      ];
    }
    return [
      `${prefix}.url=${JSON.stringify(server.url)}`,
      `${prefix}.enabled=true`,
      `${prefix}.required=false`,
      `${prefix}.startup_timeout_sec=${String(server.startupTimeoutSeconds)}`,
      `${prefix}.tool_timeout_sec=${String(server.toolTimeoutSeconds)}`,
      ...(server.credential?.type === "bearer"
        ? [
            `${prefix}.bearer_token_env_var=${JSON.stringify(server.credential.source)}`,
          ]
        : server.credential?.type === "api_key"
          ? [
              `${prefix}.env_http_headers={${JSON.stringify(server.credential.headerName)}=${JSON.stringify(server.credential.source)}}`,
            ]
          : []),
    ];
  });
}

function isTerminalTurn(turn: Pick<CodexTurn, "status">): boolean {
  return (
    turn.status === "completed" ||
    turn.status === "failed" ||
    turn.status === "interrupted"
  );
}

type SubAgentTurnSnapshot = Pick<
  CodexTurn,
  "id" | "status" | "startedAt" | "completedAt" | "durationMs"
>;

/**
 * A thread/read snapshot normally wins, except when receive ordering proves a
 * different cached turn notification arrived during the read or its native
 * startedAt is later than the completed/read snapshot. Same-turn terminal
 * notifications also close the normal notification/read visibility race.
 */
export function selectAuthoritativeSubAgentTurn(
  snapshot: SubAgentTurnSnapshot | undefined,
  cached: SubAgentTurnSnapshot | null | undefined,
  ordering: {
    cachedNotificationRevision?: number;
    readRequestRevision?: number;
  } = {},
): SubAgentTurnSnapshot | null {
  if (!snapshot) return cached ?? null;
  if (!cached) return snapshot;
  if (cached.id === snapshot.id) {
    return snapshot.status === "inProgress" &&
      cached.status !== "inProgress"
      ? cached
      : snapshot;
  }
  if (
    ordering.cachedNotificationRevision !== undefined &&
    ordering.readRequestRevision !== undefined &&
    ordering.cachedNotificationRevision > ordering.readRequestRevision
  ) {
    return cached;
  }
  const snapshotLatestAt =
    typeof snapshot.completedAt === "number"
      ? snapshot.completedAt
      : snapshot.startedAt;
  if (
    typeof cached.startedAt === "number" &&
    typeof snapshotLatestAt === "number" &&
    cached.startedAt > snapshotLatestAt
  ) {
    return cached;
  }
  return snapshot;
}

/**
 * A terminal notification can arrive before thread/read exposes the same
 * lifecycle transition. Merge only native lifecycle fields, preserving the
 * latest thread/read items while preventing detail timers from continuing
 * after the summary has already converged to a terminal state.
 */
function mergeAuthoritativeSubAgentTurnLifecycle(
  thread: CodexThread,
  authoritativeTurn: SubAgentTurnSnapshot | null,
): CodexThread {
  if (!authoritativeTurn) return thread;
  const turns = thread.turns ?? [];
  let mergedExistingTurn = false;
  const mergedTurns = turns.map((turn) => {
    if (turn.id !== authoritativeTurn.id) return turn;
    mergedExistingTurn = true;
    return {
      ...turn,
      status: authoritativeTurn.status,
      ...(authoritativeTurn.startedAt !== undefined
        ? { startedAt: authoritativeTurn.startedAt }
        : {}),
      ...(authoritativeTurn.completedAt !== undefined
        ? { completedAt: authoritativeTurn.completedAt }
        : {}),
      ...(authoritativeTurn.durationMs !== undefined
        ? { durationMs: authoritativeTurn.durationMs }
        : {}),
    };
  });
  if (!mergedExistingTurn) {
    mergedTurns.push({
      id: authoritativeTurn.id,
      status: authoritativeTurn.status,
      items: [],
      error: null,
      ...(authoritativeTurn.startedAt !== undefined
        ? { startedAt: authoritativeTurn.startedAt }
        : {}),
      ...(authoritativeTurn.completedAt !== undefined
        ? { completedAt: authoritativeTurn.completedAt }
        : {}),
      ...(authoritativeTurn.durationMs !== undefined
        ? { durationMs: authoritativeTurn.durationMs }
        : {}),
    });
  }
  return { ...thread, turns: mergedTurns };
}

function parseCodexTurnStatus(value: unknown): CodexTurn["status"] | null {
  return value === "inProgress" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
    ? value
    : null;
}

function parseSubAgentStatus(
  value: unknown,
): RunnerCodexSubAgentSummary["status"] | null {
  return value === "pendingInit" ||
    value === "running" ||
    value === "interrupted" ||
    value === "completed" ||
    value === "errored" ||
    value === "shutdown" ||
    value === "notFound"
    ? value
    : null;
}

function parseCodexThreadStatus(value: unknown): CodexThreadStatus | null {
  const status = objectRecord(value);
  if (
    status.type === "notLoaded" ||
    status.type === "idle" ||
    status.type === "systemError"
  ) {
    return { type: status.type };
  }
  if (status.type !== "active") return null;
  return {
    type: "active",
    activeFlags: Array.isArray(status.activeFlags)
      ? status.activeFlags.filter(
          (flag): flag is string => typeof flag === "string",
        )
      : [],
  };
}

function subAgentStatusForTurn(
  status: CodexTurn["status"],
): RunnerCodexSubAgentSummary["status"] {
  if (status === "inProgress") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "errored";
  return "interrupted";
}

function subAgentStatusForThread(
  status: CodexThreadStatus | null | undefined,
): RunnerCodexSubAgentSummary["status"] | null {
  if (status?.type === "active") return "running";
  if (status?.type === "systemError") return "errored";
  return null;
}

function hasContinuingGoal(managed: ManagedProcess): boolean {
  return managed.activeGoal?.status === "active";
}

function assertGoalMatchesStart(
  goal: ThreadGoal,
  input: StartTurnInput,
  codexThreadId: string,
  expectedStatus: "active" | "paused",
): void {
  if (
    !input.goal ||
    goal.threadId !== codexThreadId ||
    goal.objective !== input.goal.objective ||
    goal.status !== expectedStatus ||
    (input.goal.tokenBudget !== undefined &&
      goal.tokenBudget !== input.goal.tokenBudget)
  ) {
    throw new CodexProtocolError("Codex returned an unexpected goal");
  }
}

function completedImageViewSourcePath(
  notification: JsonRpcNotification,
): string | undefined {
  if (
    notification.method !== "item/completed" ||
    !notification.params ||
    typeof notification.params !== "object" ||
    Array.isArray(notification.params)
  ) {
    return undefined;
  }
  const item = (notification.params as Record<string, unknown>).item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  return record.type === "imageView" && typeof record.path === "string"
    ? record.path
    : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedCorrelationId(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function rememberBounded<TKey, TValue>(
  values: Map<TKey, TValue>,
  key: TKey,
  value: TValue,
  maximum: number,
): void {
  if (!values.has(key) && values.size >= maximum) {
    const oldestKey = values.keys().next().value as TKey | undefined;
    if (oldestKey !== undefined) values.delete(oldestKey);
  }
  values.set(key, value);
}

function sameStringSequence(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function textFingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hashCanonicalValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)), "utf8")
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

function assertStartOperationMatches(
  state: StartOperationState,
  input: StartTurnInput,
  fingerprint: string,
): void {
  assertStartOperationIdentity(state, input);
  if (
    state.requestFingerprint !== undefined &&
    state.requestFingerprint !== fingerprint
  ) {
    throw new StartOperationIdempotencyConflictError();
  }
}

function assertStartOperationIdentity(
  state: StartOperationState,
  input: StartTurnInput,
): void {
  if (
    state.conversationId !== input.conversationId ||
    state.projectionTurnId !== input.projectionTurnId ||
    (state.ownerId !== undefined && state.ownerId !== input.ownerId)
  ) {
    throw new StartOperationIdempotencyConflictError();
  }
}

function isSealedStartOperation(state: StartOperationState): boolean {
  return (
    state.status === "failed" && state.errorCode === "RUNNER_TURN_START_SEALED"
  );
}

function isSafelyRetryableStartOperation(state: StartOperationState): boolean {
  return (
    state.status === "failed" &&
    state.errorCode === "RUNNER_TURN_START_FAILED" &&
    state.correlation === undefined &&
    state.ownerId !== undefined &&
    state.requestFingerprint !== undefined
  );
}

type SanitizedErrorDetails = {
  errorName: string;
  errorCode?: string | number;
  errorErrno?: number;
  errorPath?: string;
  errorStage?: string;
  errorSyscall?: string;
};

function sanitizedErrorDetails(error: unknown): SanitizedErrorDetails {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  if (!error || typeof error !== "object") {
    return { errorName };
  }
  const details: SanitizedErrorDetails = { errorName };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") {
    details.errorCode = code;
  }
  const errno = (error as { errno?: unknown }).errno;
  if (typeof errno === "number" && Number.isFinite(errno)) {
    details.errorErrno = errno;
  }
  const syscall = (error as { syscall?: unknown }).syscall;
  if (typeof syscall === "string" && syscall.trim().length > 0) {
    details.errorSyscall = truncateErrorDiagnostic(syscall);
  }
  const path = (error as { path?: unknown }).path;
  if (typeof path === "string" && path.trim().length > 0) {
    details.errorPath = truncateErrorDiagnostic(path);
  }
  const stage = (error as { stage?: unknown }).stage;
  if (typeof stage === "string" && stage.trim().length > 0) {
    details.errorStage = truncateErrorDiagnostic(stage);
  }
  return details;
}

function truncateErrorDiagnostic(value: string): string {
  const normalized = value.replace(/[\r\n\t]/gu, " ").trim();
  return normalized.length > 512
    ? `${normalized.slice(0, 509)}...`
    : normalized;
}

function assertStartOperationOwner(
  state: StartOperationState,
  ownerId: string,
): void {
  if (state.ownerId !== ownerId) {
    throw new StartOperationIdempotencyConflictError();
  }
}

function assertSteerOperationMatches(
  state: SteerOperationState,
  input: SteerTurnInput,
  fingerprint: string,
): void {
  if (
    state.conversationId !== input.conversationId ||
    state.operationId !== input.operationId ||
    state.projectionTurnId !== input.projectionTurnId ||
    state.ownerId !== input.ownerId ||
    state.expectedCodexTurnId !== input.expectedCodexTurnId ||
    state.inputFingerprint !== fingerprint
  ) {
    throw new SteerOperationIdempotencyConflictError();
  }
}
