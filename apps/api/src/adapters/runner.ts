import { runtimePlacementSchema, runtimeServiceSessionHeader, runtimeCleanupEnvironmentHeader, type RuntimePlacement } from "@linksense/shared";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import {
  runtimeWorkspaceHeader,
  codexModelReasoningCatalogSchema,
  personalizationSettingsSchema,
  resetMemoriesResultSchema,
  runnerTurnInterruptResultSchema,
  RUNNER_TURN_START_CONTRACT_VERSION,
  type ModelProviderProtocolMode,
  type ModelTokenPricing,
  type CodexModelReasoningCatalog,
  type ConversationUserInputResponse,
  runnerCodexSubAgentDetailSchema,
  runnerCodexSubAgentSummariesSchema,
  runnerCodexGoalSchema,
  updatePersonalizationSettingsSchema,
  type ReasoningEffort,
  type PersonalizationSettings,
  type UpdatePersonalizationSettings,
  type RunnerCodexSubAgentDetail,
  type RunnerCodexSubAgentSummaries,
  type RunnerTurnInterruptResult,
  type RuntimeMcpServer,
  type RunnerCodexGoal,
  type RunnerKnowledgeBaseSelection,
} from "@linksense/shared";
import { z } from "zod";
import pRetry from "p-retry";

const START_OPERATION_WAIT_LIMIT_MS = 60_000;
const RUNNER_REQUEST_TIMEOUT_MS = 15_000;
const RUNNER_RECONCILE_TIMEOUT_MS = 100_000;
const OWNER_ID_HEADER = "x-linksense-owner-id";
const CAPABILITY_GENERATION_PATTERN = /^[a-f0-9]{64}$/u;

const runnerComponentSchema = z.strictObject({
  status: z.enum(["available", "unavailable"]),
  reason_code: z.string().nullable(),
  checked_at: z.string(),
});
const runnerDockerResourceStatusSchema = z.enum([
  "available",
  "unavailable",
  "not_observed",
]);
const runnerDockerResourceServiceSchema = z.strictObject({
  key: z.string().min(1).max(80),
  service_type: z.enum(["compose", "worker_pool"]),
  status: runnerDockerResourceStatusSchema,
  container_count: z.number().int().nonnegative(),
  running_container_count: z.number().int().nonnegative(),
  cpu_percent: z.number().nonnegative().nullable(),
  memory_used_bytes: z.number().int().nonnegative().nullable(),
  memory_limit_bytes: z.number().int().nonnegative().nullable(),
  memory_percent: z.number().nonnegative().nullable(),
  pids: z.number().int().nonnegative().nullable(),
  state: z.string().max(120).nullable(),
});
const runnerDockerResourceUsageSchema = z.strictObject({
  status: runnerDockerResourceStatusSchema,
  checked_at: z.string(),
  reason_code: z.string().nullable(),
  services: z.array(runnerDockerResourceServiceSchema),
});
const runnerWorkerProviderSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("docker"),
    isolation: z.literal("container"),
  }),
  z.strictObject({
    kind: z.literal("local-process"),
    isolation: z.literal("none"),
  }),
]);

const runnerHealthSchema = z.strictObject({
  status: z.enum(["available", "unavailable"]),
  checked_at: z.string(),
  workspace: runnerComponentSchema,
  codex_home: runnerComponentSchema,
  codex_app_server: runnerComponentSchema.extend({ cached: z.boolean() }),
  running_turns: z.number().int().nonnegative(),
  app_server_processes: z.number().int().nonnegative(),
  concurrency_limit: z.number().int().positive(),
  app_server_process_limit: z.number().int().positive(),
  process_limit: z.number().int().positive(),
  turn_start_contract_version: z.literal(RUNNER_TURN_START_CONTRACT_VERSION),
  runner_instance_id: z.uuid().optional(),
  docker_resource_usage: runnerDockerResourceUsageSchema.optional(),
  worker_provider: runnerWorkerProviderSchema.optional(),
});

const runnerRuntimeSchema = z.strictObject({
  agentsTemplateVersion: z.string().min(1).max(80),
  runtimeGeneration: z.uuid(),
});
const runnerPrewarmedRuntimeSchema = runnerRuntimeSchema.extend({
  codexThreadId: z.string().min(1),
});
const runnerRecoveryConfirmationSchema = z.strictObject({
  confirmed: z.literal(true),
});
const runnerGoalResponseSchema = z.strictObject({
  goal: runnerCodexGoalSchema.nullable(),
});
const runnerGoalSetResponseSchema = z.strictObject({
  goal: runnerCodexGoalSchema,
});
const runnerGoalClearResponseSchema = z.strictObject({ cleared: z.boolean() });
const runnerReconcileResponseSchema = z.strictObject({
  thread: z.unknown(),
  goal: runnerCodexGoalSchema.nullable(),
});
const runnerForkResponseSchema = z.strictObject({
  codexThreadId: z.string().min(1),
  codexTurnIds: z.array(z.string().min(1)),
});
const runnerMcpStdioProbeResultSchema = z.strictObject({
  serverName: z.string().min(1).max(160),
  protocolVersion: z.string().min(1).max(80),
  toolCount: z.number().int().nonnegative(),
});
const runtimeCleanupStageSchema = z.enum([
  "reconcile",
  "stop_runtime",
  "delete_workspace",
  "delete_control",
  "verify_absent",
]);
const runtimeCleanupReasonCodeSchema = z.enum([
  "CLEANUP_RUNNER_UNAVAILABLE",
  "CLEANUP_RUNTIME_ACTIVE",
  "CLEANUP_RUNTIME_STATE_UNCERTAIN",
  "CLEANUP_PERMISSION_DENIED",
  "CLEANUP_PATH_BOUNDARY_INVALID",
  "CLEANUP_DIRECTORY_REMOVE_FAILED",
  "CLEANUP_VERIFICATION_FAILED",
]);
const runtimeCleanupFailureSchema = z.strictObject({
  error_code: runtimeCleanupReasonCodeSchema,
  cleanup_stage: runtimeCleanupStageSchema,
});
const runtimeCleanupSuccessSchema = z.object({ success: z.literal(true) });
export type RuntimeCleanupStage = z.infer<typeof runtimeCleanupStageSchema>;
export type RuntimeCleanupReasonCode = z.infer<
  typeof runtimeCleanupReasonCodeSchema
>;
export type RunnerInterruptResult = RunnerTurnInterruptResult;

const runnerStartOperationBaseSchema = z.strictObject({
  conversationId: z.uuid(),
  projectionTurnId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const runnerStartOperationSchema = z.discriminatedUnion("status", [
  runnerStartOperationBaseSchema.extend({ status: z.literal("starting") }),
  runnerStartOperationBaseSchema.extend({
    status: z.literal("succeeded"),
    result: z.strictObject({
      codexThreadId: z.string().min(1),
      codexTurnId: z.string().min(1),
      goal: runnerCodexGoalSchema.optional(),
    }),
  }),
  runnerStartOperationBaseSchema.extend({
    status: z.literal("failed"),
    errorCode: z.enum(["RUNNER_TURN_START_FAILED", "RUNNER_TURN_START_SEALED"]),
  }),
  runnerStartOperationBaseSchema.extend({
    status: z.literal("uncertain"),
    errorCode: z.literal("RUNNER_TURN_START_RESULT_UNCERTAIN"),
  }),
]);

const runnerSteerOperationBaseSchema = z.strictObject({
  operationId: z.uuid(),
  conversationId: z.uuid(),
  projectionTurnId: z.uuid(),
  expectedCodexTurnId: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const runnerSteerOperationSchema = z.discriminatedUnion("status", [
  runnerSteerOperationBaseSchema.extend({ status: z.literal("starting") }),
  runnerSteerOperationBaseSchema.extend({
    status: z.literal("succeeded"),
    result: z.strictObject({ codexTurnId: z.string().min(1) }),
  }),
  runnerSteerOperationBaseSchema.extend({
    status: z.literal("failed"),
    errorCode: z.literal("RUNNER_TURN_STEER_FAILED"),
  }),
  runnerSteerOperationBaseSchema.extend({
    status: z.literal("uncertain"),
    errorCode: z.literal("RUNNER_TURN_STEER_RESULT_UNCERTAIN"),
  }),
]);

export type RunnerStartOperation = z.infer<typeof runnerStartOperationSchema>;
type RunnerSteerOperation = z.infer<typeof runnerSteerOperationSchema>;

export type RunnerCapability = {
  id: string;
  name: string;
  type: "plugin" | "skill";
  revision: string;
  credentialEnvironment?: Record<string, string>;
};

export type RunnerModelProviderRuntime = {
  revision: number;
  baseUrl: string;
  protocolMode: ModelProviderProtocolMode;
  apiKey: string;
  pricing?: ModelTokenPricing;
  modelContextWindow?: number;
  modelAutoCompactTokenLimit?: number;
};

export type RunnerStartInput = {
  conversationId: string;
  projectionTurnId: string;
  appServerProcessLimit: number;
  operationKind?: "turn" | "compact";
  eventProjectionTurnId?: string;
  ownerId: string;
  expectedRuntimeGeneration: string;
  capabilityGeneration: string;
  mcpGeneration: string;
  mcpServers: RuntimeMcpServer[];
  codexThreadId?: string | null;
  forkFromCodexTurnId?: string;
  /** Exact source runtime used to compact the native thread before switching. */
  modelTransitionSource?: {
    model: string;
    provider: RunnerModelProviderRuntime;
  };
  goal?: {
    objective: string;
    tokenBudget?: number | null;
  };
  collaborationMode: "default" | "plan";
  context: {
    userInput: string;
    approvedPlanImplementation?: true;
    requireFinalResponse?: boolean;
    applicationInstructions?: string;
    selectedKnowledgeBases?: RunnerKnowledgeBaseSelection;
    officeSelectionContext?: string;
    attachments: Array<{ filename: string; homeRelativePath: string }>;
    priorityPlugins: Array<{
      id: string;
      name: string;
      description?: string | null;
    }>;
    prioritySkills: Array<{
      id: string;
      name: string;
      description?: string | null;
    }>;
  };
  capabilities: RunnerCapability[];
  environment: Record<string, string>;
  model: string;
  reasoningEffort: ReasoningEffort;
  modelProvider: RunnerModelProviderRuntime;
};

export type RunnerSteerInput = {
  conversationId: string;
  operationId: string;
  projectionTurnId: string;
  ownerId: string;
  expectedCodexTurnId: string;
  text: string;
};

export type RunnerReconcileInput = {
  conversationId: string;
  ownerId: string;
  expectedRuntimeGeneration: string;
  capabilityGeneration: string;
  mcpGeneration: string;
  mcpServers: RuntimeMcpServer[];
  codexThreadId: string;
  codexTurnId: string;
  projectionTurnId: string;
  taskKind: "turn" | "goal" | "compact";
  collaborationMode: "default" | "plan";
  capabilities: RunnerCapability[];
  environment: Record<string, string>;
  model: string;
  modelTransitionSource?: RunnerStartInput["modelTransitionSource"];
  reasoningEffort: ReasoningEffort;
  modelProvider: RunnerModelProviderRuntime;
};

export type RunnerGoalRuntimeInput = Omit<
  RunnerReconcileInput,
  "codexTurnId" | "taskKind" | "collaborationMode"
>;

export type RunnerGoalSetInput = RunnerGoalRuntimeInput & {
  objective?: string;
  status?: RunnerCodexGoal["status"];
  tokenBudget?: number | null;
};

export type RunnerGoalClearInput = Pick<
  RunnerGoalRuntimeInput,
  | "conversationId"
  | "ownerId"
  | "expectedRuntimeGeneration"
  | "codexThreadId"
  | "projectionTurnId"
  | "model"
  | "reasoningEffort"
  | "modelProvider"
>;

export type RunnerForkInput = Omit<RunnerGoalClearInput, "codexThreadId"> & {
  sourceConversationId: string;
  sourceCodexThreadId: string;
  throughCodexTurnId: string;
};

export type RunnerSubAgentReadRuntimeInput = RunnerGoalClearInput & {
  codexTurnId: string;
  authorizedAgentKeys: string[];
};

export type RunnerSubAgentDetailReadInput = RunnerSubAgentReadRuntimeInput & {
  agentKey: string;
};

export type RunnerRecoveryConfirmationInput = {
  conversationId: string;
  ownerId: string;
  projectionTurnId: string;
  capabilityGeneration: string;
};

export class RunnerStartOperationUncertainError extends AppError {
  constructor() {
    super("RUNNER_UNAVAILABLE");
    this.name = "RunnerStartOperationUncertainError";
  }
}

export class RunnerSteerOperationUncertainError extends AppError {
  constructor() {
    super("TURN_STEER_REQUEST_UNCERTAIN");
    this.name = "RunnerSteerOperationUncertainError";
  }
}

export class RunnerRuntimeCleanupError extends Error {
  constructor(
    readonly reasonCode: RuntimeCleanupReasonCode,
    readonly stage: RuntimeCleanupStage,
  ) {
    super(reasonCode);
    this.name = "RunnerRuntimeCleanupError";
  }
}

class RunnerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(`runner returned ${status}`);
    this.name = "RunnerHttpError";
  }
}

class RunnerTransportError extends Error {
  constructor() {
    super("runner transport failed");
    this.name = "RunnerTransportError";
  }
}

export class RunnerClient {
  constructor(
    private readonly config: AppConfig,
    private readonly resolveWorkspace?: (ownerId: string, conversationId: string) => Promise<RuntimePlacement | null>,
  ) {}

  private async workspaceHeaders(pathname: string, ownerId?: string, workspacePath?: string, serviceSessionId?: string): Promise<Record<string, string>> {
    const conversationId = /^\/conversations\/([0-9a-f-]{36})(?:\/|$)/iu.exec(pathname)?.[1];
    if (!ownerId || !conversationId) return {};
    const selected = workspacePath === undefined ? await this.resolveWorkspace?.(ownerId, conversationId) : { workspacePath, ...(serviceSessionId ? { serviceSessionId } : {}) };
    if (selected == null) return {};
    const placement = runtimePlacementSchema.parse(selected);
    return { [runtimeWorkspaceHeader]: placement.workspacePath, ...(placement.serviceSessionId ? { [runtimeServiceSessionHeader]: placement.serviceSessionId } : {}) };
  }

  /**
   * Submits one durable runner start operation and returns as soon as the
   * runner proves that exact operation was accepted. It never waits for the
   * native Codex turn to finish starting and never replays the POST.
   */
  async acceptStartTurn(
    input: RunnerStartInput,
  ): Promise<RunnerStartOperation> {
    assertCapabilityGeneration(input.capabilityGeneration);
    assertCapabilityGeneration(input.mcpGeneration);
    const { conversationId, ...startBody } = input;
    const startPath = `/conversations/${conversationId}/turns/start`;
    const operationPath = `${startPath}/${input.projectionTurnId}`;
    let operation: RunnerStartOperation;
    try {
      operation = await this.requestStartOperation(
        startPath,
        "POST",
        input.ownerId,
        startBody,
      );
    } catch (error) {
      if (
        error instanceof RunnerHttpError &&
        error.status === 409 &&
        error.errorCode === "RUNNER_START_OPERATION_CONFLICT"
      ) {
        // A conflicting fingerprint can point at a different already accepted
        // operation, so it must never be treated as this request's receipt.
        throw new RunnerStartOperationUncertainError();
      }
      if (
        error instanceof RunnerHttpError &&
        (error.errorCode === "RUNNER_TURN_START_INVALID" ||
          error.errorCode === "RUNNER_CONTRACT_MISMATCH")
      ) {
        throw new AppError("EXECUTION_SERVICE_INCOMPATIBLE");
      }
      if (
        error instanceof RunnerHttpError &&
        [400, 401, 403, 404, 422].includes(error.status)
      ) {
        throw new AppError("RUNNER_UNAVAILABLE");
      }
      try {
        const queried = await this.queryStartOperation(
          operationPath,
          input.ownerId,
        );
        if (!queried) {
          throw new RunnerStartOperationUncertainError();
        }
        operation = queried;
      } catch (queryError) {
        if (queryError instanceof AppError) throw queryError;
        throw new RunnerStartOperationUncertainError();
      }
    }

    if (operation.status === "starting" || operation.status === "succeeded") {
      return operation;
    }
    if (operation.status === "uncertain") {
      throw new RunnerStartOperationUncertainError();
    }
    if (operation.errorCode === "RUNNER_TURN_START_SEALED") {
      throw new AppError("TURN_START_CLOSED");
    }
    throw new AppError("RUNNER_UNAVAILABLE");
  }

  async startTurn(input: RunnerStartInput): Promise<{
    codexThreadId: string;
    codexTurnId: string;
  }> {
    const waitDeadline = Date.now() + START_OPERATION_WAIT_LIMIT_MS;
    const { conversationId } = input;
    const startPath = `/conversations/${conversationId}/turns/start`;
    const operationPath = `${startPath}/${input.projectionTurnId}`;
    let operation = await this.acceptStartTurn(input);

    let consecutiveQueryFailures = 0;
    while (operation.status === "starting") {
      if (Date.now() >= waitDeadline) {
        throw new RunnerStartOperationUncertainError();
      }
      await wait(100);
      try {
        const queried = await this.queryStartOperation(
          operationPath,
          input.ownerId,
        );
        if (!queried) {
          throw new RunnerStartOperationUncertainError();
        }
        operation = queried;
        consecutiveQueryFailures = 0;
      } catch (error) {
        if (
          error instanceof AppError ||
          error instanceof RunnerStartOperationUncertainError
        ) {
          throw error;
        }
        consecutiveQueryFailures += 1;
        if (consecutiveQueryFailures >= 3) {
          throw new RunnerStartOperationUncertainError();
        }
      }
    }

    if (operation.status === "succeeded") return operation.result;
    if (operation.status === "uncertain") {
      throw new RunnerStartOperationUncertainError();
    }
    if (operation.errorCode === "RUNNER_TURN_START_SEALED") {
      throw new AppError("TURN_START_CLOSED");
    }
    throw new AppError("RUNNER_UNAVAILABLE");
  }

  inspectStartOperation(
    conversationId: string,
    projectionTurnId: string,
    ownerId: string,
  ): Promise<RunnerStartOperation | null> {
    return this.queryStartOperation(
      `/conversations/${conversationId}/turns/start/${projectionTurnId}`,
      ownerId,
    );
  }

  async sealStartOperation(
    conversationId: string,
    projectionTurnId: string,
    ownerId: string,
    expectedRuntimeGeneration: string,
  ): Promise<RunnerStartOperation> {
    try {
      return await this.requestStartOperation(
        `/conversations/${conversationId}/turns/start/${projectionTurnId}/seal`,
        "POST",
        ownerId,
        { ownerId, expectedRuntimeGeneration },
      );
    } catch {
      // A generation/owner conflict, an unavailable seal store, or a lost
      // response cannot prove that the runner did not accept a concurrent
      // start. Every seal failure therefore remains fail-closed.
      throw new RunnerStartOperationUncertainError();
    }
  }

  prepareRuntime(conversationId: string, ownerId: string, workspacePath?: string, serviceSessionId?: string) {
    return this.request<unknown>(
      `/conversations/${conversationId}/runtime`,
      "PUT",
      {},
      { ownerId, ...(workspacePath ? { workspacePath } : {}), ...(serviceSessionId ? { serviceSessionId } : {}) },
    ).then((result) => runnerRuntimeSchema.parse(result));
  }

  async forkThread(input: RunnerForkInput & { serviceSessionId?: string }): Promise<{
    codexThreadId: string;
    codexTurnIds: string[];
  }> {
    const { conversationId, serviceSessionId, ...body } = input;
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/fork`,
      "POST",
      body,
      { ownerId: input.ownerId, timeoutMs: RUNNER_RECONCILE_TIMEOUT_MS, ...(serviceSessionId ? { serviceSessionId } : {}) },
    );
    return runnerForkResponseSchema.parse(result);
  }

  async prewarmWorker(ownerId: string): Promise<void> {
    try {
      const response = await fetch(
        new URL("/workers/prewarm", this.config.runnerUrl),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: ownerId,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status !== 204) throw new Error("runner prewarm failed");
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  prewarmConversation(input: RunnerStartInput) {
    const { conversationId, ...body } = input;
    return this.request<unknown>(
      `/conversations/${conversationId}/runtime/prewarm`,
      "POST",
      body,
      { ownerId: input.ownerId, timeoutMs: RUNNER_RECONCILE_TIMEOUT_MS },
    ).then((result) => runnerPrewarmedRuntimeSchema.parse(result));
  }

  async inspectPrewarmedConversation(conversationId: string, ownerId: string) {
    try {
      const response = await fetch(
        new URL(
          `/conversations/${conversationId}/runtime/prewarm`,
          this.config.runnerUrl,
        ),
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: ownerId,
            ...await this.workspaceHeaders(`/conversations/${conversationId}`, ownerId),
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new RunnerTransportError();
      return runnerPrewarmedRuntimeSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  async inspectRuntime(conversationId: string, ownerId: string) {
    try {
      const response = await fetch(
        new URL(
          `/conversations/${conversationId}/runtime`,
          this.config.runnerUrl,
        ),
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: ownerId,
            ...await this.workspaceHeaders(`/conversations/${conversationId}`, ownerId),
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new RunnerTransportError();
      return runnerRuntimeSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  async steer(input: RunnerSteerInput): Promise<{ turnId: string }> {
    const waitDeadline = Date.now() + START_OPERATION_WAIT_LIMIT_MS;
    const { conversationId, ...steerBody } = input;
    const startPath = `/conversations/${conversationId}/turns/steer`;
    const operationPath = `${startPath}/${input.operationId}`;
    let operation: RunnerSteerOperation;
    try {
      operation = await this.requestSteerOperation(
        startPath,
        "POST",
        input.ownerId,
        steerBody,
      );
    } catch (error) {
      if (
        error instanceof RunnerHttpError &&
        error.status === 409 &&
        error.errorCode === "RUNNER_STEER_OPERATION_CONFLICT"
      ) {
        throw new AppError("CONFLICT");
      }
      if (
        error instanceof RunnerHttpError &&
        [400, 401, 403, 404, 409, 422].includes(error.status)
      ) {
        throw new AppError("TURN_STEER_REQUEST_FAILED");
      }
      try {
        const queried = await this.querySteerOperation(
          operationPath,
          input.ownerId,
        );
        if (!queried) throw new AppError("TURN_STEER_REQUEST_FAILED");
        operation = queried;
      } catch (queryError) {
        if (queryError instanceof AppError) throw queryError;
        throw new RunnerSteerOperationUncertainError();
      }
    }

    let consecutiveQueryFailures = 0;
    while (operation.status === "starting") {
      if (Date.now() >= waitDeadline) {
        throw new RunnerSteerOperationUncertainError();
      }
      await wait(100);
      try {
        const queried = await this.querySteerOperation(
          operationPath,
          input.ownerId,
        );
        if (!queried) throw new RunnerSteerOperationUncertainError();
        operation = queried;
        consecutiveQueryFailures = 0;
      } catch (error) {
        if (
          error instanceof AppError ||
          error instanceof RunnerSteerOperationUncertainError
        ) {
          throw error;
        }
        consecutiveQueryFailures += 1;
        if (consecutiveQueryFailures >= 3) {
          throw new RunnerSteerOperationUncertainError();
        }
      }
    }

    if (operation.status === "succeeded") {
      return { turnId: operation.result.codexTurnId };
    }
    if (operation.status === "uncertain") {
      throw new RunnerSteerOperationUncertainError();
    }
    throw new AppError("TURN_STEER_REQUEST_FAILED");
  }

  async interrupt(
    conversationId: string,
    ownerId: string,
    turnId: string,
    goalProjectionTurnId?: string,
  ): Promise<RunnerTurnInterruptResult> {
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/turns/interrupt`,
      "POST",
      { turnId, ...(goalProjectionTurnId ? { goalProjectionTurnId } : {}) },
      { ownerId },
    );
    const parsed = runnerTurnInterruptResultSchema.safeParse(result);
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    return parsed.data;
  }

  async interruptStartOperation(
    conversationId: string,
    projectionTurnId: string,
    ownerId: string,
    expectedRuntimeGeneration: string,
  ): Promise<RunnerTurnInterruptResult> {
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/turns/start/${projectionTurnId}/interrupt`,
      "POST",
      { ownerId, expectedRuntimeGeneration },
      { ownerId },
    );
    const parsed = runnerTurnInterruptResultSchema.safeParse(result);
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    return parsed.data;
  }

  async respondUserInputRequest(input: {
    conversationId: string;
    ownerId: string;
    requestId: number;
    codexThreadId: string;
    codexTurnId: string;
    itemId: string;
    response: ConversationUserInputResponse;
  }): Promise<{ accepted: true }> {
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/conversations/${input.conversationId}/user-input/respond`,
          this.config.runnerUrl,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: input.ownerId,
            ...await this.workspaceHeaders(`/conversations/${input.conversationId}`, input.ownerId),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ownerId: input.ownerId,
            requestId: input.requestId,
            codexThreadId: input.codexThreadId,
            codexTurnId: input.codexTurnId,
            itemId: input.itemId,
            response: input.response,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    if (response.status === 409) {
      throw new AppError("USER_INPUT_REQUEST_UNAVAILABLE");
    }
    if (!response.ok) throw new AppError("RUNNER_UNAVAILABLE");
    const parsed = z
      .strictObject({ accepted: z.literal(true) })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    return parsed.data;
  }

  async reconcile(input: RunnerReconcileInput) {
    assertCapabilityGeneration(input.capabilityGeneration);
    assertCapabilityGeneration(input.mcpGeneration);
    const { conversationId, ...body } = input;
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/reconcile`,
      "POST",
      body,
      {
        ownerId: input.ownerId,
        timeoutMs: RUNNER_RECONCILE_TIMEOUT_MS,
      },
    );
    return runnerReconcileResponseSchema.parse(result);
  }

  async getGoal(input: RunnerGoalRuntimeInput): Promise<RunnerCodexGoal | null> {
    const { conversationId, ...body } = input;
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/goal/get`,
      "POST",
      body,
      { ownerId: input.ownerId, timeoutMs: RUNNER_RECONCILE_TIMEOUT_MS },
    );
    return runnerGoalResponseSchema.parse(result).goal;
  }

  async setGoal(input: RunnerGoalSetInput): Promise<RunnerCodexGoal> {
    const { conversationId, ...body } = input;
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/goal`,
      "PATCH",
      body,
      { ownerId: input.ownerId, timeoutMs: RUNNER_RECONCILE_TIMEOUT_MS },
    );
    return runnerGoalSetResponseSchema.parse(result).goal;
  }

  async clearGoal(input: RunnerGoalClearInput): Promise<boolean> {
    const { conversationId, ...body } = input;
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/goal`,
      "DELETE",
      body,
      { ownerId: input.ownerId, timeoutMs: RUNNER_RECONCILE_TIMEOUT_MS },
    );
    return runnerGoalClearResponseSchema.parse(result).cleared;
  }

  async getPersonalization(ownerId: string): Promise<PersonalizationSettings> {
    const result = await this.request<unknown>(
      "/personalization",
      "GET",
      undefined,
      { ownerId },
    );
    const parsed = personalizationSettingsSchema.safeParse(result);
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    return parsed.data;
  }

  async updatePersonalization(
    ownerId: string,
    input: UpdatePersonalizationSettings,
  ): Promise<PersonalizationSettings> {
    const update = updatePersonalizationSettingsSchema.parse(input);
    const result = await this.request<unknown>(
      "/personalization",
      "PATCH",
      update,
      { ownerId },
    );
    const parsed = personalizationSettingsSchema.safeParse(result);
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    return parsed.data;
  }

  async resetMemories(ownerId: string): Promise<{ reset: true }> {
    const result = await this.request<unknown>(
      "/personalization/memories/reset",
      "POST",
      {},
      { ownerId, timeoutMs: 30_000 },
    );
    const parsed = resetMemoriesResultSchema.safeParse(result);
    if (!parsed.success) throw new AppError("RUNNER_UNAVAILABLE");
    return parsed.data;
  }

  async confirmRecovery(
    input: RunnerRecoveryConfirmationInput,
  ): Promise<{ confirmed: true }> {
    assertCapabilityGeneration(input.capabilityGeneration);
    const { conversationId, ...body } = input;
    const result = await this.request<unknown>(
      `/conversations/${conversationId}/reconcile/confirm`,
      "POST",
      body,
      { ownerId: input.ownerId },
    );
    try {
      return runnerRecoveryConfirmationSchema.parse(result);
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  async readSubAgentDetail(
    input: RunnerSubAgentDetailReadInput,
  ): Promise<RunnerCodexSubAgentDetail> {
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/conversations/${input.conversationId}/subagents/read`,
          this.config.runnerUrl,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: input.ownerId,
            ...await this.workspaceHeaders(`/conversations/${input.conversationId}`, input.ownerId),
            "content-type": "application/json",
          },
          body: JSON.stringify(
            subAgentReadRequestBody(input, { agentKey: input.agentKey }),
          ),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    if (response.status === 404) throw new AppError("NOT_FOUND");
    if (!response.ok) throw new AppError("RUNNER_UNAVAILABLE");
    try {
      return runnerCodexSubAgentDetailSchema.parse(await response.json());
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  async readSubAgentSummaries(
    input: RunnerSubAgentReadRuntimeInput,
  ): Promise<RunnerCodexSubAgentSummaries> {
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/conversations/${input.conversationId}/subagents/summaries`,
          this.config.runnerUrl,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: input.ownerId,
            ...await this.workspaceHeaders(`/conversations/${input.conversationId}`, input.ownerId),
            "content-type": "application/json",
          },
          body: JSON.stringify(subAgentReadRequestBody(input)),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    if (response.status === 404) throw new AppError("NOT_FOUND");
    if (!response.ok) throw new AppError("RUNNER_UNAVAILABLE");
    try {
      return runnerCodexSubAgentSummariesSchema.parse(await response.json());
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  async cleanupRuntime(conversationId: string, ownerId: string, serviceSessionId?: string, removeServiceEnvironment = false) {
    if (removeServiceEnvironment && !serviceSessionId) throw new RunnerRuntimeCleanupError("CLEANUP_PATH_BOUNDARY_INVALID", "reconcile");
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/conversations/${conversationId}/runtime`,
          this.config.runnerUrl,
        ),
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${this.config.runnerSharedSecret}`,
            [OWNER_ID_HEADER]: ownerId,
            ...await this.workspaceHeaders(`/conversations/${conversationId}`, ownerId, serviceSessionId ? "workspace" : undefined, serviceSessionId),
            ...(removeServiceEnvironment ? { [runtimeCleanupEnvironmentHeader]: "true" } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new RunnerRuntimeCleanupError(
        "CLEANUP_RUNNER_UNAVAILABLE",
        "reconcile",
      );
    }
    if (!response.ok) {
      const failure = runtimeCleanupFailureSchema.safeParse(
        await response.json().catch(() => null),
      );
      throw failure.success
        ? new RunnerRuntimeCleanupError(
            failure.data.error_code,
            failure.data.cleanup_stage,
          )
        : new RunnerRuntimeCleanupError(
            "CLEANUP_RUNNER_UNAVAILABLE",
            "reconcile",
          );
    }
    const result = (removeServiceEnvironment
      ? runtimeCleanupSuccessSchema.extend({ environment: z.enum(["deleted", "absent"]) })
      : runtimeCleanupSuccessSchema).safeParse(
      await response.json().catch(() => null),
    );
    if (!result.success) {
      throw new RunnerRuntimeCleanupError(
        "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        "verify_absent",
      );
    }
    return result.data;
  }

  closeRuntimeProcess(conversationId: string, ownerId: string) {
    return this.request<{ success: boolean }>(
      `/conversations/${conversationId}/runtime/close`,
      "POST",
      {},
      { ownerId },
    );
  }

  listCodexModels(): Promise<CodexModelReasoningCatalog> {
    return this.request<unknown>("/model-catalog", "GET").then((result) =>
      codexModelReasoningCatalogSchema.parse(result),
    );
  }

  probeStdioMcp(input: {
    ownerId: string;
    command: string;
    args: string[];
    environment: Record<string, string>;
    timeoutMs: number;
  }) {
    return this.request<unknown>("/mcp/stdio/probe", "POST", input, {
      ownerId: input.ownerId,
      timeoutMs: Math.min(input.timeoutMs + 15_000, 135_000),
    }).then((result) => runnerMcpStdioProbeResultSchema.parse(result));
  }

  health(options: { includeResourceUsage?: boolean } = {}) {
    const pathname = options.includeResourceUsage === false
      ? "/health/ready"
      : "/health/ready?include_resource_usage=true";
    return this.request<unknown>(pathname, "GET", undefined, {
      acceptErrorResponse: true,
    }).then((result) => runnerHealthSchema.parse(result));
  }

  async waitUntilReady(): Promise<void> {
    // Startup and source reload can bring the API up before the controller.
    // Retry only readiness probes; task recovery must still execute once.
    await pRetry(async () => {
      const health = await this.health({ includeResourceUsage: false });
      if (health.status !== "available") throw new AppError("RUNNER_UNAVAILABLE");
    }, {
      retries: 60,
      factor: 1,
      minTimeout: 1_000,
      maxRetryTime: 60_000,
      shouldRetry: (error) => error instanceof AppError && error.code === "RUNNER_UNAVAILABLE",
    });
  }

  private async queryStartOperation(
    pathname: string,
    ownerId: string,
  ): Promise<RunnerStartOperation | null> {
    try {
      return await this.requestStartOperation(pathname, "GET", ownerId);
    } catch (error) {
      if (error instanceof RunnerHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private async requestStartOperation(
    pathname: string,
    method: "GET" | "POST",
    ownerId: string,
    body?: unknown,
  ): Promise<RunnerStartOperation> {
    const workspaceHeaders = await this.workspaceHeaders(pathname, ownerId);
    let response: Response;
    try {
      response = await fetch(new URL(pathname, this.config.runnerUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.config.runnerSharedSecret}`,
          [OWNER_ID_HEADER]: ownerId,
          ...workspaceHeaders,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RunnerTransportError();
    }
    if (!response.ok) throw await runnerHttpError(response);
    try {
      return runnerStartOperationSchema.parse(await response.json());
    } catch {
      throw new RunnerTransportError();
    }
  }

  private async querySteerOperation(
    pathname: string,
    ownerId: string,
  ): Promise<RunnerSteerOperation | null> {
    try {
      return await this.requestSteerOperation(pathname, "GET", ownerId);
    } catch (error) {
      if (error instanceof RunnerHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private async requestSteerOperation(
    pathname: string,
    method: "GET" | "POST",
    ownerId: string,
    body?: unknown,
  ): Promise<RunnerSteerOperation> {
    const workspaceHeaders = await this.workspaceHeaders(pathname, ownerId);
    let response: Response;
    try {
      response = await fetch(new URL(pathname, this.config.runnerUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.config.runnerSharedSecret}`,
          [OWNER_ID_HEADER]: ownerId,
          ...workspaceHeaders,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RunnerTransportError();
    }
    if (!response.ok) throw await runnerHttpError(response);
    try {
      return runnerSteerOperationSchema.parse(await response.json());
    } catch {
      throw new RunnerTransportError();
    }
  }

  private async request<T>(
    pathname: string,
    method: string,
    body?: unknown,
    options: {
      ownerId?: string;
      workspacePath?: string;
      serviceSessionId?: string;
      acceptErrorResponse?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const workspaceHeaders = await this.workspaceHeaders(pathname, options.ownerId, options.workspacePath, options.serviceSessionId);
    try {
      const response = await fetch(new URL(pathname, this.config.runnerUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.config.runnerSharedSecret}`,
          ...(options.ownerId ? { [OWNER_ID_HEADER]: options.ownerId } : {}),
          ...workspaceHeaders,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(
          options.timeoutMs ?? RUNNER_REQUEST_TIMEOUT_MS,
        ),
      });
      if (!response.ok && !options.acceptErrorResponse) {
        throw new Error(`runner returned ${response.status}`);
      }
      return (await response.json()) as T;
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }
}

function subAgentReadRequestBody(
  input: RunnerSubAgentReadRuntimeInput,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ownerId: input.ownerId,
    expectedRuntimeGeneration: input.expectedRuntimeGeneration,
    codexThreadId: input.codexThreadId,
    codexTurnId: input.codexTurnId,
    authorizedAgentKeys: input.authorizedAgentKeys,
    projectionTurnId: input.projectionTurnId,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    modelProvider: input.modelProvider,
    ...extra,
  };
}

function assertCapabilityGeneration(generation: string): void {
  if (!CAPABILITY_GENERATION_PATTERN.test(generation)) {
    throw new AppError("EXECUTION_SERVICE_INCOMPATIBLE");
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runnerHttpError(response: Response): Promise<RunnerHttpError> {
  let errorCode: string | undefined;
  try {
    const parsed = z
      .object({ error_code: z.string().min(1) })
      .safeParse(await response.json());
    if (parsed.success) errorCode = parsed.data.error_code;
  } catch {
    // The status still carries the transport-level failure classification.
  }
  return new RunnerHttpError(response.status, errorCode);
}
