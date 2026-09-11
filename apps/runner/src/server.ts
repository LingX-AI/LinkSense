import { timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import {
  builtInCapabilityDefinitionForId,
  capabilitySelectionIdSchema,
  conversationFormRequestedSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormUiHintsSchema,
  conversationUserInputResponseSchema,
  emitInteractiveApplicationCustomEventInputSchema,
  getKnowledgeDocumentMarkdownInputSchema,
  imageGenerationRequestSchema,
  listKnowledgeDocumentsInputSchema,
  modelContextWindowSchema,
  modelIdentifierSchema,
  modelProviderBaseUrlSchema,
  modelProviderProtocolModeSchema,
  modelTokenPricingSchema,
  personalizationSettingsSchema,
  reasoningEffortSchema,
  runnerKnowledgeBaseSelectionSchema,
  runnerCodexAgentKeySchema,
  runnerCodexAgentKeysSchema,
  runtimeMcpServerSchema,
  RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
  RUNNER_TURN_INTERRUPT_REQUESTED,
  searchKnowledgeBaseInputSchema,
  updatePersonalizationSettingsSchema,
} from "@linksense/shared";

import type { RunnerConfig } from "./config.js";
import { CurrentUserInfoRequestError } from "./current-user-error.js";
import { FileServiceRequestError } from "./file-service-error.js";
import { ImageGenerationRequestError } from "./image-generation-error.js";
import { InteractiveFormRequestError } from "./interactive-form-error.js";
import { KnowledgeSearchRequestError } from "./knowledge-search-error.js";
import { KnowledgeServiceRequestError } from "./knowledge-service-error.js";
import { SkillCreatorRequestError } from "./skill-creator-error.js";
import {
  ConversationOwnerMismatchError,
  ConversationOwnerRegistry,
} from "./owner-binding.js";
import {
  StartOperationIdempotencyConflictError,
  StartOperationRuntimeGenerationMismatchError,
  SteerOperationIdempotencyConflictError,
  SubAgentDetailNotFoundError,
  UserInputRequestUnavailableError,
  ConversationRuntimeActiveError,
  type AppServerProcessPool,
  type StartTurnInput,
  type SubAgentDetailReadInput,
  type SubAgentReadRuntimeInput,
} from "./process-pool.js";
import { RuntimeCleanupError } from "./runtime-cleanup.js";
import type { StartOperationState } from "./start-operation.js";
import type { SteerOperationState } from "./steer-operation.js";
import {
  sanitizeZodIssues,
  TURN_START_CONTRACT_VERSION,
} from "./turn-start-contract.js";
import type { WorkspaceManager } from "./workspace/workspace-manager.js";
import {
  proxyUserMcpHttpRequest,
  UserMcpProxyRequestError,
} from "./mcp/http-egress-proxy.js";

const uuid = z.uuid();
const environmentKey = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
  .max(120);
const credentialSource = z
  .string()
  .regex(/^LINKSENSE_CREDENTIAL_[A-F0-9]{32}$/u);
const capabilityGeneration = z.string().regex(/^[0-9a-f]{64}$/u);
const emptyMcpGeneration =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const mcpArtifactBodySchema = z.strictObject({
  workspaceRelativePath: z.string().min(1).max(2_000),
  displayName: z.string().min(1).max(260),
  mimeType: z.string().max(160).optional(),
  artifactKind: z.string().max(80).optional(),
});
const mcpInteractiveFormBodySchema = z.strictObject({
  message: z.string().trim().min(1).max(4_000),
  requestedSchema: conversationFormRequestedSchema,
  uiHints: conversationFormUiHintsSchema,
  responseSemantics: conversationFormResponseSemanticsSchema,
});
const mcpInteractiveApplicationEventBodySchema =
  emitInteractiveApplicationCustomEventInputSchema;
const mcpImageGenerationBodySchema = imageGenerationRequestSchema;
const mcpKnowledgeSearchBodySchema = searchKnowledgeBaseInputSchema;
const mcpKnowledgeDocumentListBodySchema = listKnowledgeDocumentsInputSchema;
const mcpKnowledgeDocumentMarkdownBodySchema =
  getKnowledgeDocumentMarkdownInputSchema;
const mcpSkillCreatorPreviewBodySchema = z.strictObject({
  workspaceRelativePath: z.string().min(1).max(2_000),
});
const mcpSkillCreatorConfirmBodySchema = z.strictObject({
  installToken: z.string().min(64).max(2_048),
});

const turnStartPriorityCapabilitySchema = z.strictObject({
  id: capabilitySelectionIdSchema,
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

const runnerCapabilitySchema = z.strictObject({
  id: uuid,
  name: z.string().min(1).max(256),
  type: z.enum(["plugin", "skill"]),
  revision: z.iso.datetime(),
  credentialEnvironment: z.record(environmentKey, credentialSource).optional(),
});

const runnerEnvironmentSchema = z
  .record(
    z.union([
      credentialSource,
      z.string().regex(/^LINKSENSE_MCP_CREDENTIAL_[A-F0-9]{32}$/u),
      z.string().regex(/^LINKSENSE_MCP_STDIO_[A-F0-9]{32}$/u),
    ]),
    z.string().max(64 * 1024),
  )
  .default({});

const modelProviderRuntimeSchema = z.strictObject({
  revision: z.number().int().positive(),
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384),
  pricing: modelTokenPricingSchema.optional(),
  modelContextWindow: modelContextWindowSchema.optional(),
  modelAutoCompactTokenLimit: modelContextWindowSchema.optional(),
});

const modelTransitionSourceSchema = z.strictObject({
  model: modelIdentifierSchema,
  provider: modelProviderRuntimeSchema,
});

function validateModelTransitionSource(
  body: {
    model: string;
    modelTransitionSource?:
      | z.infer<typeof modelTransitionSourceSchema>
      | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (body.modelTransitionSource?.model === body.model) {
    context.addIssue({
      code: "custom",
      path: ["modelTransitionSource", "model"],
      message: "model_transition_source_must_differ",
    });
  }
}

type AuthorizedRuntimeBody = {
  capabilities: Array<z.infer<typeof runnerCapabilitySchema>>;
  mcpServers: Array<z.infer<typeof runtimeMcpServerSchema>>;
  environment: Record<string, string>;
};

function validateAuthorizedRuntime(
  body: AuthorizedRuntimeBody,
  context: z.RefinementCtx,
): void {
  const mappedSources: string[] = [];
  for (const [index, capability] of body.capabilities.entries()) {
    if (
      capability.name.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capability.name)
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities", index, "name"],
        message:
          capability.type === "skill"
            ? "skill_name_invalid"
            : "plugin_name_invalid",
      });
    }
    const mappings = Object.entries(capability.credentialEnvironment ?? {});
    if (mappings.length > 0 && capability.type !== "plugin") {
      context.addIssue({
        code: "custom",
        path: ["capabilities", index, "credentialEnvironment"],
        message: "credential_environment_requires_plugin",
      });
    }
    for (const [name, source] of mappings) {
      if (isReservedPluginEnvironmentKey(name)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "credentialEnvironment", name],
          message: "credential_environment_target_is_reserved",
        });
      }
      mappedSources.push(source);
    }
  }
  for (const server of body.mcpServers) {
    if (server.transport === "streamable_http") {
      if (server.credential) mappedSources.push(server.credential.source);
      mappedSources.push(
        ...(server.requestHeaders ?? []).map(({ source }) => source),
      );
    } else {
      mappedSources.push(
        ...server.environmentVariables.map(({ source }) => source),
      );
    }
  }
  if (new Set(mappedSources).size !== mappedSources.length) {
    context.addIssue({
      code: "custom",
      path: ["capabilities"],
      message: "credential_environment_source_must_be_capability_scoped",
    });
  }
  const suppliedSources = Object.keys(body.environment).sort();
  const requiredSources = [...mappedSources].sort();
  if (JSON.stringify(suppliedSources) !== JSON.stringify(requiredSources)) {
    context.addIssue({
      code: "custom",
      path: ["environment"],
      message: "credential_environment_sources_do_not_match",
    });
  }
}

export const startTurnBodySchema = z
  .strictObject({
    ownerId: uuid,
    projectionTurnId: uuid,
    appServerProcessLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    operationKind: z.enum(["turn", "compact"]).default("turn"),
    eventProjectionTurnId: uuid.optional(),
    expectedRuntimeGeneration: uuid,
    capabilityGeneration,
    mcpGeneration: capabilityGeneration.default(emptyMcpGeneration),
    codexThreadId: z.string().min(1).nullable().optional(),
    forkFromCodexTurnId: z.string().min(1).optional(),
    goal: z
      .strictObject({
        objective: z.string().trim().min(1).max(4_000),
        tokenBudget: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable()
          .optional(),
      })
      .optional(),
    collaborationMode: z.enum(["default", "plan"]).default("default"),
    modelTransitionSource: modelTransitionSourceSchema.optional(),
    context: z.strictObject({
      userInput: z.string(),
      approvedPlanImplementation: z.literal(true).optional(),
      requireFinalResponse: z.boolean().optional(),
      applicationInstructions: z.string().min(1).max(20_000).optional(),
      selectedKnowledgeBases: runnerKnowledgeBaseSelectionSchema.optional(),
      officeSelectionContext: z.string().min(1).max(1_000_000).optional(),
      attachments: z.array(
        z.strictObject({
          filename: z.string().min(1),
          relativePath: z.string().min(1),
        }),
      ),
      priorityPlugins: z.array(turnStartPriorityCapabilitySchema),
      prioritySkills: z.array(turnStartPriorityCapabilitySchema),
    }),
    capabilities: z.array(runnerCapabilitySchema),
    mcpServers: z.array(runtimeMcpServerSchema).max(30).default([]),
    environment: runnerEnvironmentSchema,
    model: modelIdentifierSchema,
    reasoningEffort: reasoningEffortSchema,
    modelProvider: modelProviderRuntimeSchema,
  })
  .superRefine((body, context) => {
    validateAuthorizedRuntime(body, context);
    validateModelTransitionSource(body, context);
    if (body.modelTransitionSource && !body.codexThreadId) {
      context.addIssue({
        code: "custom",
        path: ["modelTransitionSource"],
        message: "model_transition_requires_codex_thread",
      });
    }
    if (body.operationKind === "compact") {
      if (body.modelTransitionSource) {
        context.addIssue({
          code: "custom",
          path: ["modelTransitionSource"],
          message: "compact_cannot_transition_model",
        });
      }
      if (!body.codexThreadId) {
        context.addIssue({
          code: "custom",
          path: ["codexThreadId"],
          message: "compact_requires_codex_thread",
        });
      }
      if (body.goal) {
        context.addIssue({
          code: "custom",
          path: ["goal"],
          message: "compact_cannot_start_goal",
        });
      }
      if (body.forkFromCodexTurnId) {
        context.addIssue({
          code: "custom",
          path: ["forkFromCodexTurnId"],
          message: "compact_cannot_fork",
        });
      }
      if (
        body.context.userInput !== "" ||
        body.context.attachments.length > 0 ||
        body.context.priorityPlugins.length > 0 ||
        body.context.prioritySkills.length > 0 ||
        body.context.approvedPlanImplementation ||
        body.context.requireFinalResponse ||
        body.context.applicationInstructions ||
        body.context.officeSelectionContext ||
        (body.context.selectedKnowledgeBases?.length ?? 0) !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["context"],
          message: "compact_requires_empty_context",
        });
      }
    }
    if (body.context.approvedPlanImplementation) {
      if (body.collaborationMode !== "default") {
        context.addIssue({
          code: "custom",
          path: ["collaborationMode"],
          message: "approved_plan_implementation_requires_default_mode",
        });
      }
      if (body.context.userInput !== "Implement the plan.") {
        context.addIssue({
          code: "custom",
          path: ["context", "userInput"],
          message: "approved_plan_implementation_requires_canonical_input",
        });
      }
      if (body.goal) {
        context.addIssue({
          code: "custom",
          path: ["goal"],
          message: "approved_plan_implementation_cannot_start_goal",
        });
      }
      if (!body.codexThreadId) {
        context.addIssue({
          code: "custom",
          path: ["codexThreadId"],
          message: "approved_plan_implementation_requires_codex_thread",
        });
      }
    }
    if (body.forkFromCodexTurnId && !body.codexThreadId) {
      context.addIssue({
        code: "custom",
        path: ["forkFromCodexTurnId"],
        message: "fork_requires_codex_thread",
      });
    }
    const capabilityById = new Map(
      body.capabilities.map((capability) => [capability.id, capability]),
    );
    const priority = [
      ...body.context.priorityPlugins.map((capability) => ({
        ...capability,
        type: "plugin" as const,
      })),
      ...body.context.prioritySkills.map((capability) => ({
        ...capability,
        type: "skill" as const,
      })),
    ];
    if (
      new Set(priority.map((capability) => capability.id)).size !==
      priority.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["context"],
        message: "priority_capability_is_duplicated",
      });
    }
    for (const [index, requested] of priority.entries()) {
      const builtIn = builtInCapabilityDefinitionForId(requested.id);
      if (builtIn) {
        if (
          builtIn.type !== requested.type ||
          builtIn.slug !== requested.name
        ) {
          context.addIssue({
            code: "custom",
            path: ["context", index],
            message: "priority_capability_is_unavailable",
          });
        }
        continue;
      }
      const capability = capabilityById.get(requested.id);
      if (
        !capability ||
        capability.type !== requested.type ||
        capability.name !== requested.name
      ) {
        context.addIssue({
          code: "custom",
          path: ["context", index],
          message: "priority_capability_is_unavailable",
        });
      }
    }
  });

function prewarmInput(
  conversationId: string,
  body: z.infer<typeof startTurnBodySchema>,
): StartTurnInput {
  return {
    conversationId,
    projectionTurnId: body.projectionTurnId,
    appServerProcessLimit: body.appServerProcessLimit,
    operationKind: body.operationKind,
    ...(body.eventProjectionTurnId !== undefined
      ? { eventProjectionTurnId: body.eventProjectionTurnId }
      : {}),
    ownerId: body.ownerId,
    collaborationMode: body.collaborationMode,
    expectedRuntimeGeneration: body.expectedRuntimeGeneration,
    capabilityGeneration: body.capabilityGeneration,
    mcpGeneration: body.mcpGeneration,
    mcpServers: body.mcpServers,
    context: {
      userInput: body.context.userInput,
      attachments: body.context.attachments,
      priorityPlugins: body.context.priorityPlugins.map((capability) => ({
        id: capability.id,
        name: capability.name,
        ...(capability.description !== undefined
          ? { description: capability.description }
          : {}),
      })),
      prioritySkills: body.context.prioritySkills.map((capability) => ({
        id: capability.id,
        name: capability.name,
        ...(capability.description !== undefined
          ? { description: capability.description }
          : {}),
      })),
    },
    capabilities: body.capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      type: capability.type,
      revision: capability.revision,
      ...(capability.credentialEnvironment
        ? { credentialEnvironment: capability.credentialEnvironment }
        : {}),
    })),
    environment: body.environment,
    model: body.model,
    reasoningEffort: body.reasoningEffort,
    modelProvider: {
      revision: body.modelProvider.revision,
      baseUrl: body.modelProvider.baseUrl,
      protocolMode: body.modelProvider.protocolMode,
      apiKey: body.modelProvider.apiKey,
      ...(body.modelProvider.pricing
        ? { pricing: body.modelProvider.pricing }
        : {}),
      ...(body.modelProvider.modelContextWindow !== undefined
        ? { modelContextWindow: body.modelProvider.modelContextWindow }
        : {}),
      ...(body.modelProvider.modelAutoCompactTokenLimit !== undefined
        ? {
            modelAutoCompactTokenLimit:
              body.modelProvider.modelAutoCompactTokenLimit,
          }
        : {}),
    },
    ...(body.codexThreadId !== undefined
      ? { codexThreadId: body.codexThreadId }
      : {}),
    ...(body.modelTransitionSource !== undefined
      ? {
          modelTransitionSource: {
            model: body.modelTransitionSource.model,
            provider: {
              revision: body.modelTransitionSource.provider.revision,
              baseUrl: body.modelTransitionSource.provider.baseUrl,
              protocolMode: body.modelTransitionSource.provider.protocolMode,
              apiKey: body.modelTransitionSource.provider.apiKey,
              ...(body.modelTransitionSource.provider.pricing
                ? { pricing: body.modelTransitionSource.provider.pricing }
                : {}),
              ...(body.modelTransitionSource.provider.modelContextWindow !==
              undefined
                ? {
                    modelContextWindow:
                      body.modelTransitionSource.provider.modelContextWindow,
                  }
                : {}),
              ...(body.modelTransitionSource.provider
                .modelAutoCompactTokenLimit !== undefined
                ? {
                    modelAutoCompactTokenLimit:
                      body.modelTransitionSource.provider
                        .modelAutoCompactTokenLimit,
                  }
                : {}),
            },
          },
        }
      : {}),
  };
}

const userInputResponseBodySchema = z.strictObject({
  ownerId: uuid,
  codexThreadId: z.string().min(1).max(240),
  codexTurnId: z.string().min(1).max(240),
  itemId: z.string().min(1).max(240),
  requestId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  response: conversationUserInputResponseSchema,
});

export const reconcileBodySchema = z
  .strictObject({
    ownerId: uuid,
    expectedRuntimeGeneration: uuid,
    capabilityGeneration,
    mcpGeneration: capabilityGeneration.default(emptyMcpGeneration),
    codexThreadId: z.string().min(1),
    codexTurnId: z.string().min(1),
    projectionTurnId: uuid,
    taskKind: z.enum(["turn", "goal", "compact"]),
    collaborationMode: z.enum(["default", "plan"]),
    capabilities: z.array(runnerCapabilitySchema),
    mcpServers: z.array(runtimeMcpServerSchema).max(30).default([]),
    environment: runnerEnvironmentSchema,
    model: modelIdentifierSchema,
    modelTransitionSource: modelTransitionSourceSchema.optional(),
    reasoningEffort: reasoningEffortSchema,
    modelProvider: modelProviderRuntimeSchema,
  })
  .superRefine((body, context) => {
    validateAuthorizedRuntime(body, context);
    validateModelTransitionSource(body, context);
  });

const goalRuntimeFields = {
  ownerId: uuid,
  expectedRuntimeGeneration: uuid,
  capabilityGeneration,
  mcpGeneration: capabilityGeneration.default(emptyMcpGeneration),
  codexThreadId: z.string().min(1),
  projectionTurnId: uuid,
  capabilities: z.array(runnerCapabilitySchema),
  mcpServers: z.array(runtimeMcpServerSchema).max(30).default([]),
  environment: runnerEnvironmentSchema,
  model: modelIdentifierSchema,
  reasoningEffort: reasoningEffortSchema,
  modelProvider: modelProviderRuntimeSchema,
};
export const goalRuntimeBodySchema = z
  .strictObject(goalRuntimeFields)
  .superRefine(validateAuthorizedRuntime);
export const goalClearBodySchema = z.strictObject({
  ownerId: uuid,
  expectedRuntimeGeneration: uuid,
  codexThreadId: z.string().min(1),
  projectionTurnId: uuid,
  model: modelIdentifierSchema,
  reasoningEffort: reasoningEffortSchema,
  modelProvider: modelProviderRuntimeSchema,
});
export const forkThreadBodySchema = z.strictObject({
  ...goalClearBodySchema.omit({ codexThreadId: true }).shape,
  sourceConversationId: uuid,
  sourceCodexThreadId: z.string().min(1).max(240),
  throughCodexTurnId: z.string().min(1).max(240),
});
export const goalSetBodySchema = z
  .strictObject({
    ...goalRuntimeFields,
    objective: z.string().trim().min(1).max(4_000).optional(),
    status: z
      .enum([
        "active",
        "paused",
        "blocked",
        "usageLimited",
        "budgetLimited",
        "complete",
      ])
      .optional(),
    tokenBudget: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
  })
  .superRefine((body, context) => {
    validateAuthorizedRuntime(body, context);
    if (
      body.objective === undefined &&
      body.status === undefined &&
      body.tokenBudget === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "goal_update_is_empty",
      });
    }
  });

export const confirmRecoveryProjectionBodySchema = z.strictObject({
  ownerId: uuid,
  projectionTurnId: uuid,
  capabilityGeneration,
});

export const steerTurnBodySchema = z.strictObject({
  operationId: uuid,
  projectionTurnId: uuid,
  ownerId: uuid,
  expectedCodexTurnId: z.string().min(1),
  text: z.string().min(1).max(1_000_000),
});

export const sealStartOperationBodySchema = z.strictObject({
  ownerId: uuid,
  expectedRuntimeGeneration: uuid,
});

export const subAgentDetailBodySchema = z.strictObject({
  ...goalClearBodySchema.shape,
  codexThreadId: z.string().min(1).max(240),
  codexTurnId: z.string().min(1).max(240),
  authorizedAgentKeys: runnerCodexAgentKeysSchema,
  agentKey: runnerCodexAgentKeySchema,
});

export const subAgentSummariesBodySchema = subAgentDetailBodySchema.omit({
  agentKey: true,
});

export const stdioMcpProbeBodySchema = z.strictObject({
  ownerId: uuid,
  command: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((value) => !value.includes("\0")),
  args: z
    .array(
      z
        .string()
        .max(4_096)
        .refine((value) => !value.includes("\0")),
    )
    .max(128),
  environment: z
    .record(
      environmentKey,
      z
        .string()
        .max(64 * 1_024)
        .refine((value) => !value.includes("\0")),
    )
    .refine(
      (value) =>
        Object.keys(value).length <= 64 &&
        Object.keys(value).every((key) => !isReservedStdioEnvironmentKey(key)),
    ),
  timeoutMs: z.number().int().min(1_000).max(120_000),
});

function isReservedStdioEnvironmentKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    [
      "PATH",
      "HOME",
      "LOGNAME",
      "USER",
      "SHELL",
      "BASH_ENV",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "AZURE_OPENAI_API_KEY",
    ].includes(upper) ||
    upper.startsWith("LINKSENSE_") ||
    upper.startsWith("CODEX_") ||
    upper.startsWith("DYLD_") ||
    upper.startsWith("NPM_CONFIG_") ||
    upper.startsWith("PNPM_") ||
    upper.startsWith("COREPACK_")
  );
}

function isReservedPluginEnvironmentKey(key: string): boolean {
  return (
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "USER",
      "SHELL",
      "BASH_ENV",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "AZURE_OPENAI_API_KEY",
    ].includes(key) ||
    key.startsWith("LINKSENSE_") ||
    key.startsWith("CODEX_") ||
    key.startsWith("DYLD_")
  );
}

export const runnerServerTesting = {
  confirmRecoveryProjectionBodySchema,
  reconcileBodySchema,
  goalRuntimeBodySchema,
  goalClearBodySchema,
  goalSetBodySchema,
  resolveHealthRoots,
  sealStartOperationBodySchema,
  startTurnBodySchema,
  stdioMcpProbeBodySchema,
  subAgentDetailBodySchema,
  subAgentSummariesBodySchema,
};

export function buildRunnerServer(
  config: RunnerConfig,
  pool: AppServerProcessPool,
  workspaceManager: WorkspaceManager,
  ownerRegistry = new ConversationOwnerRegistry(
    config.LINKSENSE_RUNNER_MODE === "worker"
      ? config.LINKSENSE_WORKER_OWNER_ID
      : undefined,
  ),
  ensureUserRuntime?: (ownerId: string) => Promise<void>,
) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const healthRoots = resolveHealthRoots(config);

  app.addHook("onRequest", async (request, reply) => {
    if (
      request.url === "/health/live" ||
      request.url.startsWith("/mcp-file-service/") ||
      request.url.startsWith("/mcp-interactive-form/") ||
      request.url.startsWith("/mcp-image-generation/") ||
      request.url.startsWith("/mcp-knowledge-service/") ||
      request.url.startsWith("/mcp-skill-creator/") ||
      request.url.startsWith("/mcp-current-user/") ||
      request.url.startsWith("/mcp-user/")
    )
      return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token || !safeEqual(token, config.LINKSENSE_RUNNER_SHARED_SECRET)) {
      return reply.code(401).send({ error_code: "RUNNER_UNAUTHORIZED" });
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    const match = request.url.match(
      /^\/conversations\/([0-9a-f-]{36})(?:\/|$)/iu,
    );
    if (!match) return;
    const conversationId = uuid.safeParse(match[1]);
    const ownerHeader = request.headers["x-linksense-owner-id"];
    const ownerId = uuid.safeParse(
      Array.isArray(ownerHeader) ? ownerHeader[0] : ownerHeader,
    );
    if (!conversationId.success || !ownerId.success) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_REQUIRED" });
    }
    const bodyOwner =
      request.body &&
      typeof request.body === "object" &&
      "ownerId" in request.body
        ? uuid.safeParse((request.body as { ownerId?: unknown }).ownerId)
        : null;
    if (bodyOwner && (!bodyOwner.success || bodyOwner.data !== ownerId.data)) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_MISMATCH" });
    }
    try {
      ownerRegistry.assertAndBind(conversationId.data, ownerId.data);
      workspaceManager.bindOwner(conversationId.data, ownerId.data);
    } catch (error) {
      if (
        error instanceof ConversationOwnerMismatchError ||
        (error instanceof Error && error.message.includes("owner"))
      ) {
        return reply.code(403).send({ error_code: "RUNNER_OWNER_MISMATCH" });
      }
      throw error;
    }
  });

  app.get(
    "/health/live",
    { logLevel: "warn" },
    async () => ({ status: "available" }),
  );

  app.get("/personalization", async (request, reply) => {
    const ownerId = parseOwnerIdHeader(request.headers["x-linksense-owner-id"]);
    if (!ownerId) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_REQUIRED" });
    }
    try {
      await ensureUserRuntime?.(ownerId);
      const settings = await workspaceManager.getPersonalization(ownerId);
      return personalizationSettingsSchema.parse({
        custom_instructions: settings.custom_instructions,
        memories_enabled: settings.memories_enabled,
        task_auto_naming: settings.task_auto_naming,
      });
    } catch (error) {
      request.log.error(
        { errorClass: error instanceof Error ? error.name : "unknown" },
        "personalization read failed",
      );
      return reply
        .code(503)
        .send({ error_code: "RUNNER_PERSONALIZATION_UNAVAILABLE" });
    }
  });

  app.patch("/personalization", async (request, reply) => {
    const ownerId = parseOwnerIdHeader(request.headers["x-linksense-owner-id"]);
    const update = updatePersonalizationSettingsSchema.safeParse(request.body);
    if (!ownerId) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_REQUIRED" });
    }
    if (!update.success) {
      return reply
        .code(400)
        .send({ error_code: "RUNNER_PERSONALIZATION_INVALID" });
    }
    try {
      await ensureUserRuntime?.(ownerId);
      const settings = await workspaceManager.updatePersonalization(
        ownerId,
        update.data,
      );
      if (
        update.data.custom_instructions !== undefined ||
        update.data.memories_enabled !== undefined
      ) {
        await pool.refreshOwnerPersonalization(
          ownerId,
          settings.memories_enabled,
        );
      }
      return personalizationSettingsSchema.parse({
        custom_instructions: settings.custom_instructions,
        memories_enabled: settings.memories_enabled,
        task_auto_naming: settings.task_auto_naming,
      });
    } catch (error) {
      request.log.error(
        { errorClass: error instanceof Error ? error.name : "unknown" },
        "personalization update failed",
      );
      return reply
        .code(503)
        .send({ error_code: "RUNNER_PERSONALIZATION_UNAVAILABLE" });
    }
  });

  app.post("/personalization/memories/reset", async (request, reply) => {
    const ownerId = parseOwnerIdHeader(request.headers["x-linksense-owner-id"]);
    if (!ownerId) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_REQUIRED" });
    }
    try {
      await ensureUserRuntime?.(ownerId);
      await pool.resetOwnerMemories(ownerId);
      return { reset: true };
    } catch (error) {
      request.log.error(
        { errorClass: error instanceof Error ? error.name : "unknown" },
        "native memory reset failed",
      );
      return reply
        .code(503)
        .send({ error_code: "RUNNER_MEMORY_RESET_UNAVAILABLE" });
    }
  });

  app.route<{
    Params: { conversationId: string; serverId: string };
  }>({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp-user/:conversationId/:serverId",
    handler: async (request, reply) => {
      const conversationId = uuid.safeParse(request.params.conversationId);
      const serverId = uuid.safeParse(request.params.serverId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!conversationId.success || !serverId.success || !token) {
        return reply.code(403).send({ error_code: "MCP_PROXY_FORBIDDEN" });
      }
      const target = pool.resolveUserMcpProxyTarget(
        conversationId.data,
        serverId.data,
        token,
      );
      if (!target) {
        return reply.code(403).send({ error_code: "MCP_PROXY_FORBIDDEN" });
      }
      try {
        await proxyUserMcpHttpRequest(target, request, reply);
        return reply;
      } catch (error) {
        if (reply.sent) return reply;
        const code =
          error instanceof UserMcpProxyRequestError
            ? error.code
            : "UPSTREAM_UNAVAILABLE";
        return reply.code(502).send({
          error_code:
            code === "DESTINATION_FORBIDDEN"
              ? "MCP_DESTINATION_FORBIDDEN"
              : "MCP_UPSTREAM_UNAVAILABLE",
        });
      }
    },
  });

  app.get("/model-catalog", async (_request, reply) => {
    try {
      return await pool.listCodexModels(healthRoots.home);
    } catch {
      return reply
        .code(503)
        .send({ error_code: "CODEX_MODEL_CATALOG_UNAVAILABLE" });
    }
  });

  app.post("/mcp/stdio/probe", async (request, reply) => {
    const parsed = stdioMcpProbeBodySchema.safeParse(request.body);
    const ownerHeader = request.headers["x-linksense-owner-id"];
    const ownerId = uuid.safeParse(
      Array.isArray(ownerHeader) ? ownerHeader[0] : ownerHeader,
    );
    if (
      !parsed.success ||
      !ownerId.success ||
      parsed.data.ownerId !== ownerId.data
    ) {
      return reply.code(400).send({ error_code: "MCP_STDIO_PROBE_INVALID" });
    }
    try {
      return await pool.probeStdioMcp(parsed.data);
    } catch (error) {
      request.log.warn(
        { errorClass: error instanceof Error ? error.name : "unknown" },
        "personal STDIO MCP connection test failed",
      );
      return reply
        .code(502)
        .send({ error_code: "MCP_STDIO_CONNECTION_FAILED" });
    }
  });

  app.get("/health/state", { logLevel: "warn" }, async (_request, reply) => {
    const checkedAt = new Date().toISOString();
    const [workspace, codexHome] = await Promise.all([
      probeDirectories(
        [healthRoots.workspace, healthRoots.control],
        "WORKSPACE_ROOT_UNAVAILABLE",
      ),
      probeDirectory(healthRoots.codexHome, "CODEX_HOME_ROOT_UNAVAILABLE"),
    ]);
    const available =
      workspace.status === "available" && codexHome.status === "available";
    const response = {
      status: available ? ("available" as const) : ("unavailable" as const),
      checked_at: checkedAt,
      workspace: { ...workspace, checked_at: checkedAt },
      codex_home: { ...codexHome, checked_at: checkedAt },
      turn_start_contract_version: TURN_START_CONTRACT_VERSION,
      running_turns: pool.runningCount,
      app_server_processes: pool.size,
    };
    return available ? response : reply.code(503).send(response);
  });

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-file-service/:conversationId/register-artifact",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token)
        return reply.code(401).send({ code: "FILE_SERVICE_FORBIDDEN" });
      const body = mcpArtifactBodySchema.parse(request.body);
      try {
        return await pool.registerArtifact(conversationId, token, {
          workspaceRelativePath: body.workspaceRelativePath,
          displayName: body.displayName,
          ...(body.mimeType ? { mimeType: body.mimeType } : {}),
          ...(body.artifactKind ? { artifactKind: body.artifactKind } : {}),
        });
      } catch (error) {
        const failure =
          error instanceof FileServiceRequestError
            ? error
            : new FileServiceRequestError(
                "ARTIFACT_REGISTRATION_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
          },
          "artifact registration request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
        });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-interactive-form/:conversationId/request",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "INTERACTIVE_FORM_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpInteractiveFormBodySchema.parse(request.body);
      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      const abortDisconnectedReply = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", abortRequest);
      reply.raw.once("close", abortDisconnectedReply);
      try {
        return await pool.requestUserForm(
          conversationId,
          token,
          body,
          controller.signal,
        );
      } catch (error) {
        const failure =
          error instanceof InteractiveFormRequestError
            ? error
            : new InteractiveFormRequestError(
                "INTERACTIVE_FORM_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
          },
          "interactive form request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
        });
      } finally {
        request.raw.off("aborted", abortRequest);
        reply.raw.off("close", abortDisconnectedReply);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-interactive-form/:conversationId/event",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "APPLICATION_CUSTOM_EVENT_FORBIDDEN",
          retryable: false,
        });
      }
      try {
        return await pool.emitInteractiveApplicationEvent(
          conversationId,
          token,
          mcpInteractiveApplicationEventBodySchema.parse(request.body),
        );
      } catch {
        return reply.code(400).send({
          code: "APPLICATION_CUSTOM_EVENT_INVALID",
          retryable: true,
        });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-image-generation/:conversationId/generate",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "IMAGE_GENERATION_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpImageGenerationBodySchema.parse(request.body);
      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      const abortDisconnectedReply = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", abortRequest);
      reply.raw.once("close", abortDisconnectedReply);
      try {
        return await pool.generateImage(
          conversationId,
          token,
          body,
          controller.signal,
        );
      } catch (error) {
        const failure =
          error instanceof ImageGenerationRequestError
            ? error
            : new ImageGenerationRequestError(
                "IMAGE_GENERATION_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
            providerCode: failure.providerDetails.provider_code,
            providerRequestId: failure.providerDetails.provider_request_id,
          },
          "image generation request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
          ...failure.providerDetails,
        });
      } finally {
        request.raw.off("aborted", abortRequest);
        reply.raw.off("close", abortDisconnectedReply);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-skill-creator/:conversationId/preview",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "SKILL_CREATOR_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpSkillCreatorPreviewBodySchema.parse(request.body);
      try {
        return await pool.previewSkillZip(conversationId, token, body);
      } catch (error) {
        return sendSkillCreatorFailure(request, reply, conversationId, error);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-skill-creator/:conversationId/confirm",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "SKILL_CREATOR_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpSkillCreatorConfirmBodySchema.parse(request.body);
      try {
        return await pool.confirmSkillInstall(conversationId, token, body);
      } catch (error) {
        return sendSkillCreatorFailure(request, reply, conversationId, error);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-current-user/:conversationId/info",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "CURRENT_USER_FORBIDDEN",
          retryable: false,
        });
      }
      try {
        return await pool.getCurrentUserInfo(conversationId, token);
      } catch (error) {
        const failure =
          error instanceof CurrentUserInfoRequestError
            ? error
            : new CurrentUserInfoRequestError(
                "CURRENT_USER_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
          },
          "current user info request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
        });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-knowledge-service/:conversationId/search",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "KNOWLEDGE_SEARCH_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpKnowledgeSearchBodySchema.parse(request.body);
      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      const abortDisconnectedReply = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", abortRequest);
      reply.raw.once("close", abortDisconnectedReply);
      try {
        return await pool.searchKnowledge(
          conversationId,
          token,
          {
            query: body.query,
            finalTopK: body.final_top_k,
            candidateMultiplier: body.candidate_multiplier,
            ...(body.num_candidates === undefined
              ? {}
              : { numCandidates: body.num_candidates }),
            minScore: body.min_score,
          },
          controller.signal,
        );
      } catch (error) {
        const failure =
          error instanceof KnowledgeSearchRequestError
            ? error
            : new KnowledgeSearchRequestError(
                "KNOWLEDGE_SEARCH_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
          },
          "knowledge search request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
        });
      } finally {
        request.raw.off("aborted", abortRequest);
        reply.raw.off("close", abortDisconnectedReply);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-knowledge-service/:conversationId/documents",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "KNOWLEDGE_DOCUMENT_LIST_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpKnowledgeDocumentListBodySchema.parse(request.body);
      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      const abortDisconnectedReply = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", abortRequest);
      reply.raw.once("close", abortDisconnectedReply);
      try {
        return await pool.listKnowledgeDocuments(
          conversationId,
          token,
          body.cursor === undefined ? {} : { cursor: body.cursor },
          controller.signal,
        );
      } catch (error) {
        const failure =
          error instanceof KnowledgeServiceRequestError
            ? error
            : new KnowledgeServiceRequestError(
                "KNOWLEDGE_DOCUMENT_LIST_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
          },
          "knowledge document list request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
        });
      } finally {
        request.raw.off("aborted", abortRequest);
        reply.raw.off("close", abortDisconnectedReply);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/mcp-knowledge-service/:conversationId/document-markdown",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "");
      if (!token) {
        return reply.code(401).send({
          code: "KNOWLEDGE_DOCUMENT_MARKDOWN_FORBIDDEN",
          retryable: false,
        });
      }
      const body = mcpKnowledgeDocumentMarkdownBodySchema.parse(request.body);
      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      const abortDisconnectedReply = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", abortRequest);
      reply.raw.once("close", abortDisconnectedReply);
      try {
        return await pool.getKnowledgeDocumentMarkdown(
          conversationId,
          token,
          {
            documentRef: body.document_ref,
            ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
          },
          controller.signal,
        );
      } catch (error) {
        const failure =
          error instanceof KnowledgeServiceRequestError
            ? error
            : new KnowledgeServiceRequestError(
                "KNOWLEDGE_DOCUMENT_MARKDOWN_UNAVAILABLE",
                true,
                503,
              );
        request.log.warn(
          {
            conversationId,
            reasonCode: failure.code,
            retryable: failure.retryable,
          },
          "knowledge document Markdown request rejected",
        );
        return reply.code(failure.statusCode).send({
          code: failure.code,
          retryable: failure.retryable,
        });
      } finally {
        request.raw.off("aborted", abortRequest);
        reply.raw.off("close", abortDisconnectedReply);
      }
    },
  );

  app.get("/health/ready", { logLevel: "warn" }, async (_request, reply) => {
    const checkedAt = new Date().toISOString();
    const [workspace, codexHome] = await Promise.all([
      probeDirectories(
        [healthRoots.workspace, healthRoots.control],
        "WORKSPACE_ROOT_UNAVAILABLE",
      ),
      probeDirectory(healthRoots.codexHome, "CODEX_HOME_ROOT_UNAVAILABLE"),
    ]);
    const codexAppServer =
      codexHome.status === "available"
        ? await pool.probeCodexAppServer(healthRoots.home)
        : {
            status: "unavailable" as const,
            reason_code: "CODEX_APP_SERVER_HANDSHAKE_FAILED" as const,
            checked_at: checkedAt,
            cached: false,
          };
    const modelCatalog =
      codexAppServer.status === "available"
        ? await pool.listCodexModels(healthRoots.home).catch(() => undefined)
        : undefined;
    const available =
      workspace.status === "available" &&
      codexHome.status === "available" &&
      codexAppServer.status === "available";
    const response = {
      status: available ? ("available" as const) : ("unavailable" as const),
      checked_at: checkedAt,
      workspace: { ...workspace, checked_at: checkedAt },
      codex_home: { ...codexHome, checked_at: checkedAt },
      codex_app_server: codexAppServer,
      ...(modelCatalog ? { model_catalog: modelCatalog } : {}),
      turn_start_contract_version: TURN_START_CONTRACT_VERSION,
      running_turns: pool.runningCount,
      app_server_processes: pool.size,
      concurrency_limit: config.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS,
      app_server_process_limit:
        config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
      process_limit: config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
      ...(config.LINKSENSE_RUNNER_INSTANCE_ID
        ? { runner_instance_id: config.LINKSENSE_RUNNER_INSTANCE_ID }
        : {}),
    };
    return available ? response : reply.code(503).send(response);
  });

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/turns/start",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = startTurnBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        request.log.warn(
          {
            requestId: request.id,
            conversationId,
            phase: "worker-input",
            issues: sanitizeZodIssues(parsedBody.error),
          },
          "runner turn-start validation failed",
        );
        return reply
          .code(400)
          .send({ error_code: "RUNNER_TURN_START_INVALID" });
      }
      const body = parsedBody.data;
      try {
        const operation = await pool.beginStartOperation({
          conversationId,
          projectionTurnId: body.projectionTurnId,
          appServerProcessLimit: body.appServerProcessLimit,
          operationKind: body.operationKind,
          ...(body.eventProjectionTurnId !== undefined
            ? { eventProjectionTurnId: body.eventProjectionTurnId }
            : {}),
          ownerId: body.ownerId,
          collaborationMode: body.collaborationMode,
          expectedRuntimeGeneration: body.expectedRuntimeGeneration,
          capabilityGeneration: body.capabilityGeneration,
          mcpGeneration: body.mcpGeneration,
          mcpServers: body.mcpServers,
          context: {
            userInput: body.context.userInput,
            ...(body.context.approvedPlanImplementation !== undefined
              ? {
                  approvedPlanImplementation:
                    body.context.approvedPlanImplementation,
                }
              : {}),
            ...(body.context.requireFinalResponse !== undefined
              ? {
                  requireFinalResponse: body.context.requireFinalResponse,
                }
              : {}),
            ...(body.context.applicationInstructions !== undefined
              ? {
                  applicationInstructions: body.context.applicationInstructions,
                }
              : {}),
            ...(body.context.selectedKnowledgeBases !== undefined
              ? {
                  selectedKnowledgeBases: body.context.selectedKnowledgeBases,
                }
              : {}),
            ...(body.context.officeSelectionContext !== undefined
              ? {
                  officeSelectionContext: body.context.officeSelectionContext,
                }
              : {}),
            attachments: body.context.attachments,
            priorityPlugins: body.context.priorityPlugins.map((capability) => ({
              id: capability.id,
              name: capability.name,
              ...(capability.description !== undefined
                ? { description: capability.description }
                : {}),
            })),
            prioritySkills: body.context.prioritySkills.map((capability) => ({
              id: capability.id,
              name: capability.name,
              ...(capability.description !== undefined
                ? { description: capability.description }
                : {}),
            })),
          },
          capabilities: body.capabilities.map((capability) => ({
            id: capability.id,
            name: capability.name,
            type: capability.type,
            revision: capability.revision,
            ...(capability.credentialEnvironment
              ? { credentialEnvironment: capability.credentialEnvironment }
              : {}),
          })),
          environment: body.environment,
          model: body.model,
          reasoningEffort: body.reasoningEffort,
          modelProvider: {
            revision: body.modelProvider.revision,
            baseUrl: body.modelProvider.baseUrl,
            protocolMode: body.modelProvider.protocolMode,
            apiKey: body.modelProvider.apiKey,
            ...(body.modelProvider.pricing
              ? { pricing: body.modelProvider.pricing }
              : {}),
            ...(body.modelProvider.modelContextWindow === undefined
              ? {}
              : { modelContextWindow: body.modelProvider.modelContextWindow }),
            ...(body.modelProvider.modelAutoCompactTokenLimit === undefined
              ? {}
              : {
                  modelAutoCompactTokenLimit:
                    body.modelProvider.modelAutoCompactTokenLimit,
                }),
          },
          ...(body.codexThreadId !== undefined
            ? { codexThreadId: body.codexThreadId }
            : {}),
          ...(body.forkFromCodexTurnId !== undefined
            ? { forkFromCodexTurnId: body.forkFromCodexTurnId }
            : {}),
          ...(body.modelTransitionSource !== undefined
            ? {
                modelTransitionSource: {
                  model: body.modelTransitionSource.model,
                  provider: {
                    revision: body.modelTransitionSource.provider.revision,
                    baseUrl: body.modelTransitionSource.provider.baseUrl,
                    protocolMode:
                      body.modelTransitionSource.provider.protocolMode,
                    apiKey: body.modelTransitionSource.provider.apiKey,
                    ...(body.modelTransitionSource.provider.pricing
                      ? {
                          pricing:
                            body.modelTransitionSource.provider.pricing,
                        }
                      : {}),
                    ...(body.modelTransitionSource.provider
                      .modelContextWindow === undefined
                      ? {}
                      : {
                          modelContextWindow:
                            body.modelTransitionSource.provider
                              .modelContextWindow,
                        }),
                    ...(body.modelTransitionSource.provider
                      .modelAutoCompactTokenLimit === undefined
                      ? {}
                      : {
                          modelAutoCompactTokenLimit:
                            body.modelTransitionSource.provider
                              .modelAutoCompactTokenLimit,
                        }),
                  },
                },
              }
            : {}),
          ...(body.goal !== undefined
            ? {
                goal: {
                  objective: body.goal.objective,
                  ...(body.goal.tokenBudget !== undefined
                    ? { tokenBudget: body.goal.tokenBudget }
                    : {}),
                },
              }
            : {}),
        });
        return reply
          .code(operation.status === "starting" ? 202 : 200)
          .send(projectStartOperation(operation));
      } catch (error) {
        if (error instanceof StartOperationIdempotencyConflictError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_START_OPERATION_CONFLICT" });
        }
        request.log.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "runner start failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_START_OPERATION_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/user-input/respond",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsed = userInputResponseBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error_code: "RUNNER_USER_INPUT_RESPONSE_INVALID" });
      }
      try {
        const result = await pool.respondUserInputRequest({
          conversationId,
          ownerId: parsed.data.ownerId,
          requestId: parsed.data.requestId,
          codexThreadId: parsed.data.codexThreadId,
          codexTurnId: parsed.data.codexTurnId,
          itemId: parsed.data.itemId,
          response: parsed.data.response,
        });
        return reply.send(result);
      } catch (error) {
        if (error instanceof UserInputRequestUnavailableError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_USER_INPUT_REQUEST_UNAVAILABLE" });
        }
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner user-input response failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_USER_INPUT_RESPONSE_UNAVAILABLE" });
      }
    },
  );

  app.get<{
    Params: { conversationId: string; projectionTurnId: string };
  }>(
    "/conversations/:conversationId/turns/start/:projectionTurnId",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const projectionTurnId = uuid.parse(request.params.projectionTurnId);
      try {
        const operation = await pool.getStartOperation(
          conversationId,
          projectionTurnId,
        );
        if (!operation) {
          return reply
            .code(404)
            .send({ error_code: "RUNNER_START_OPERATION_NOT_FOUND" });
        }
        return projectStartOperation(operation);
      } catch (error) {
        request.log.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "runner start operation query failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_START_OPERATION_UNAVAILABLE" });
      }
    },
  );

  app.post<{
    Params: { conversationId: string; projectionTurnId: string };
  }>(
    "/conversations/:conversationId/turns/start/:projectionTurnId/seal",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const projectionTurnId = uuid.parse(request.params.projectionTurnId);
      const body = sealStartOperationBodySchema.parse(request.body);
      try {
        const operation = await pool.sealStartOperation({
          conversationId,
          projectionTurnId,
          ownerId: body.ownerId,
          expectedRuntimeGeneration: body.expectedRuntimeGeneration,
        });
        return reply
          .code(operation.status === "starting" ? 202 : 200)
          .send(projectStartOperation(operation));
      } catch (error) {
        if (error instanceof StartOperationIdempotencyConflictError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_START_OPERATION_CONFLICT" });
        }
        if (error instanceof StartOperationRuntimeGenerationMismatchError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_RUNTIME_GENERATION_MISMATCH" });
        }
        request.log.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "runner start operation seal failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_START_OPERATION_SEAL_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/turns/steer",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const body = steerTurnBodySchema.parse(request.body);
      try {
        const operation = await pool.beginSteerOperation({
          conversationId,
          operationId: body.operationId,
          projectionTurnId: body.projectionTurnId,
          ownerId: body.ownerId,
          expectedCodexTurnId: body.expectedCodexTurnId,
          text: body.text,
        });
        return reply
          .code(operation.status === "starting" ? 202 : 200)
          .send(projectSteerOperation(operation));
      } catch (error) {
        if (error instanceof SteerOperationIdempotencyConflictError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_STEER_OPERATION_CONFLICT" });
        }
        request.log.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "runner steer failed",
        );
        return reply
          .code(409)
          .send({ error_code: "TURN_STEER_REQUEST_FAILED" });
      }
    },
  );

  app.get<{
    Params: { conversationId: string; operationId: string };
  }>(
    "/conversations/:conversationId/turns/steer/:operationId",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const operationId = uuid.parse(request.params.operationId);
      try {
        const operation = await pool.getSteerOperation(
          conversationId,
          operationId,
        );
        if (!operation) {
          return reply
            .code(404)
            .send({ error_code: "RUNNER_STEER_OPERATION_NOT_FOUND" });
        }
        return projectSteerOperation(operation);
      } catch (error) {
        request.log.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "runner steer operation query failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_STEER_OPERATION_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/turns/interrupt",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const body = z.object({ turnId: z.string().min(1) }).parse(request.body);
      try {
        const outcome = await pool.interrupt(conversationId, body.turnId);
        return {
          code:
            outcome === "requested"
              ? RUNNER_TURN_INTERRUPT_REQUESTED
              : RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
        };
      } catch (error) {
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner turn interrupt request failed",
        );
        return reply
          .code(409)
          .send({ error_code: "TURN_INTERRUPT_REQUEST_FAILED" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/fork",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = forkThreadBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        request.log.warn(
          {
            requestId: request.id,
            conversationId,
            phase: "fork-input",
            issues: sanitizeZodIssues(parsedBody.error),
          },
          "runner thread-fork validation failed",
        );
        return reply.code(400).send({ error_code: "RUNNER_FORK_INVALID" });
      }
      const body = parsedBody.data;
      try {
        return await pool.forkThread({
          conversationId,
          ownerId: body.ownerId,
          expectedRuntimeGeneration: body.expectedRuntimeGeneration,
          sourceConversationId: body.sourceConversationId,
          sourceCodexThreadId: body.sourceCodexThreadId,
          throughCodexTurnId: body.throughCodexTurnId,
          projectionTurnId: body.projectionTurnId,
          model: body.model,
          reasoningEffort: body.reasoningEffort,
          modelProvider: {
            revision: body.modelProvider.revision,
            baseUrl: body.modelProvider.baseUrl,
            protocolMode: body.modelProvider.protocolMode,
            apiKey: body.modelProvider.apiKey,
            ...(body.modelProvider.pricing
              ? { pricing: body.modelProvider.pricing }
              : {}),
            ...(body.modelProvider.modelContextWindow === undefined
              ? {}
              : { modelContextWindow: body.modelProvider.modelContextWindow }),
            ...(body.modelProvider.modelAutoCompactTokenLimit === undefined
              ? {}
              : {
                  modelAutoCompactTokenLimit:
                    body.modelProvider.modelAutoCompactTokenLimit,
                }),
          },
        });
      } catch (error) {
        request.log.warn(
          {
            requestId: request.id,
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner thread fork failed",
        );
        if (error instanceof StartOperationRuntimeGenerationMismatchError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_RUNTIME_GENERATION_MISMATCH" });
        }
        return reply.code(503).send({ error_code: "RUNNER_FORK_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/reconcile",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = reconcileBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        request.log.warn(
          {
            requestId: request.id,
            conversationId,
            phase: "reconcile-input",
            issues: sanitizeZodIssues(parsedBody.error),
          },
          "runner recovery validation failed",
        );
        return reply.code(400).send({ error_code: "RUNNER_RECOVERY_INVALID" });
      }
      const body = parsedBody.data;
      try {
        return await pool.reconcile({
          conversationId,
          ownerId: body.ownerId,
          expectedRuntimeGeneration: body.expectedRuntimeGeneration,
          capabilityGeneration: body.capabilityGeneration,
          mcpGeneration: body.mcpGeneration,
          mcpServers: body.mcpServers,
          codexThreadId: body.codexThreadId,
          codexTurnId: body.codexTurnId,
          projectionTurnId: body.projectionTurnId,
          taskKind: body.taskKind,
          collaborationMode: body.collaborationMode,
          capabilities: body.capabilities.map((capability) => ({
            id: capability.id,
            name: capability.name,
            type: capability.type,
            revision: capability.revision,
            ...(capability.credentialEnvironment
              ? {
                  credentialEnvironment: capability.credentialEnvironment,
                }
              : {}),
          })),
          environment: body.environment,
          model: body.model,
          ...(body.modelTransitionSource !== undefined
            ? {
                modelTransitionSource: {
                  model: body.modelTransitionSource.model,
                  provider: {
                    revision: body.modelTransitionSource.provider.revision,
                    baseUrl: body.modelTransitionSource.provider.baseUrl,
                    protocolMode:
                      body.modelTransitionSource.provider.protocolMode,
                    apiKey: body.modelTransitionSource.provider.apiKey,
                    ...(body.modelTransitionSource.provider.pricing
                      ? {
                          pricing:
                            body.modelTransitionSource.provider.pricing,
                        }
                      : {}),
                    ...(body.modelTransitionSource.provider
                      .modelContextWindow === undefined
                      ? {}
                      : {
                          modelContextWindow:
                            body.modelTransitionSource.provider
                              .modelContextWindow,
                        }),
                    ...(body.modelTransitionSource.provider
                      .modelAutoCompactTokenLimit === undefined
                      ? {}
                      : {
                          modelAutoCompactTokenLimit:
                            body.modelTransitionSource.provider
                              .modelAutoCompactTokenLimit,
                        }),
                  },
                },
              }
            : {}),
          reasoningEffort: body.reasoningEffort,
          modelProvider: {
            revision: body.modelProvider.revision,
            baseUrl: body.modelProvider.baseUrl,
            protocolMode: body.modelProvider.protocolMode,
            apiKey: body.modelProvider.apiKey,
            ...(body.modelProvider.pricing
              ? { pricing: body.modelProvider.pricing }
              : {}),
            ...(body.modelProvider.modelContextWindow === undefined
              ? {}
              : { modelContextWindow: body.modelProvider.modelContextWindow }),
            ...(body.modelProvider.modelAutoCompactTokenLimit === undefined
              ? {}
              : {
                  modelAutoCompactTokenLimit:
                    body.modelProvider.modelAutoCompactTokenLimit,
                }),
          },
        });
      } catch (error) {
        if (error instanceof StartOperationRuntimeGenerationMismatchError) {
          return reply
            .code(409)
            .send({ error_code: "RUNNER_RUNTIME_GENERATION_MISMATCH" });
        }
        return reply
          .code(503)
          .send({ error_code: "CODEX_THREAD_RECOVERY_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/goal/get",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const body = goalRuntimeBodySchema.parse(request.body);
      try {
        return {
          goal: await pool.getGoal(goalRuntimeInput(conversationId, body)),
        };
      } catch (error) {
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner goal read failed",
        );
        return reply.code(503).send({ error_code: "RUNNER_GOAL_UNAVAILABLE" });
      }
    },
  );

  app.patch<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/goal",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const body = goalSetBodySchema.parse(request.body);
      try {
        return {
          goal: await pool.setGoal({
            ...goalRuntimeInput(conversationId, body),
            ...(body.objective !== undefined
              ? { objective: body.objective }
              : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.tokenBudget !== undefined
              ? { tokenBudget: body.tokenBudget }
              : {}),
          }),
        };
      } catch (error) {
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner goal update failed",
        );
        return reply.code(503).send({ error_code: "RUNNER_GOAL_UNAVAILABLE" });
      }
    },
  );

  app.delete<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/goal",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const body = goalClearBodySchema.parse(request.body);
      try {
        return {
          cleared: await pool.clearGoal({
            conversationId,
            ownerId: body.ownerId,
            expectedRuntimeGeneration: body.expectedRuntimeGeneration,
            codexThreadId: body.codexThreadId,
            projectionTurnId: body.projectionTurnId,
            model: body.model,
            reasoningEffort: body.reasoningEffort,
            modelProvider: {
              revision: body.modelProvider.revision,
              baseUrl: body.modelProvider.baseUrl,
              protocolMode: body.modelProvider.protocolMode,
              apiKey: body.modelProvider.apiKey,
              ...(body.modelProvider.pricing
                ? { pricing: body.modelProvider.pricing }
                : {}),
              ...(body.modelProvider.modelContextWindow === undefined
                ? {}
                : {
                    modelContextWindow:
                      body.modelProvider.modelContextWindow,
                  }),
              ...(body.modelProvider.modelAutoCompactTokenLimit === undefined
                ? {}
                : {
                    modelAutoCompactTokenLimit:
                      body.modelProvider.modelAutoCompactTokenLimit,
                  }),
            },
          }),
        };
      } catch (error) {
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner goal clear failed",
        );
        return reply.code(503).send({ error_code: "RUNNER_GOAL_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/reconcile/confirm",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = confirmRecoveryProjectionBodySchema.safeParse(
        request.body,
      );
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ error_code: "RUNNER_RECOVERY_CONFIRMATION_INVALID" });
      }
      try {
        await pool.confirmRecoveryProjection({
          conversationId,
          ...parsedBody.data,
        });
        return { confirmed: true };
      } catch {
        return reply
          .code(409)
          .send({ error_code: "RUNNER_RECOVERY_CONFIRMATION_REJECTED" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/subagents/summaries",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = subAgentSummariesBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ error_code: "RUNNER_SUBAGENT_SUMMARIES_INVALID" });
      }
      try {
        return await pool.readSubAgentSummaries(
          subAgentReadInput(conversationId, parsedBody.data),
        );
      } catch (error) {
        if (error instanceof SubAgentDetailNotFoundError) {
          return reply
            .code(404)
            .send({ error_code: "RUNNER_SUBAGENT_SUMMARIES_NOT_FOUND" });
        }
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner subagent summaries read failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_SUBAGENT_SUMMARIES_UNAVAILABLE" });
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/subagents/read",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = subAgentDetailBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ error_code: "RUNNER_SUBAGENT_DETAIL_INVALID" });
      }
      try {
        return await pool.readSubAgentDetail(
          subAgentReadInput(conversationId, parsedBody.data),
        );
      } catch (error) {
        if (error instanceof SubAgentDetailNotFoundError) {
          return reply
            .code(404)
            .send({ error_code: "RUNNER_SUBAGENT_DETAIL_NOT_FOUND" });
        }
        request.log.warn(
          {
            conversationId,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "runner subagent detail read failed",
        );
        return reply
          .code(503)
          .send({ error_code: "RUNNER_SUBAGENT_DETAIL_UNAVAILABLE" });
      }
    },
  );

  app.put<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime",
    async (request) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const ownerHeader = request.headers["x-linksense-owner-id"];
      const ownerId = uuid.parse(
        Array.isArray(ownerHeader) ? ownerHeader[0] : ownerHeader,
      );
      await ensureUserRuntime?.(ownerId);
      const runtime = await pool.prepareRuntime(conversationId, ownerId);
      return {
        agentsTemplateVersion: config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
        runtimeGeneration: runtime.runtimeGeneration,
      };
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime/prewarm",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const parsedBody = startTurnBodySchema.safeParse(request.body);
      const ownerId = parseOwnerIdHeader(
        request.headers["x-linksense-owner-id"],
      );
      if (
        !parsedBody.success ||
        !ownerId ||
        parsedBody.data.ownerId !== ownerId ||
        parsedBody.data.operationKind !== "turn" ||
        parsedBody.data.goal !== undefined ||
        parsedBody.data.forkFromCodexTurnId !== undefined ||
        parsedBody.data.context.userInput !== "" ||
        parsedBody.data.context.attachments.length > 0 ||
        parsedBody.data.context.priorityPlugins.length > 0 ||
        parsedBody.data.context.prioritySkills.length > 0 ||
        parsedBody.data.context.approvedPlanImplementation !== undefined ||
        parsedBody.data.context.requireFinalResponse !== undefined ||
        parsedBody.data.context.applicationInstructions !== undefined ||
        parsedBody.data.context.officeSelectionContext !== undefined ||
        (parsedBody.data.context.selectedKnowledgeBases?.length ?? 0) !== 0
      ) {
        return reply.code(400).send({ error_code: "RUNNER_PREWARM_INVALID" });
      }
      await ensureUserRuntime?.(parsedBody.data.ownerId);
      return pool.prewarmConversation(
        prewarmInput(conversationId, parsedBody.data),
      );
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime/prewarm",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const ownerHeader = request.headers["x-linksense-owner-id"];
      const ownerId = uuid.parse(
        Array.isArray(ownerHeader) ? ownerHeader[0] : ownerHeader,
      );
      const runtime = await pool.inspectPrewarmedConversation(
        conversationId,
        ownerId,
      );
      return (
        runtime ??
        reply.code(404).send({ error_code: "RUNNER_PREWARM_NOT_FOUND" })
      );
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      const runtimeGeneration =
        await workspaceManager.readRuntimeGeneration(conversationId);
      if (!runtimeGeneration) {
        return reply.code(404).send({ error_code: "RUNNER_RUNTIME_NOT_FOUND" });
      }
      return {
        agentsTemplateVersion: config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
        runtimeGeneration,
      };
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime/close",
    async (request) => {
      const conversationId = uuid.parse(request.params.conversationId);
      await pool.closeConversation(conversationId);
      return { success: true };
    },
  );

  app.delete<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime",
    async (request, reply) => {
      const conversationId = uuid.parse(request.params.conversationId);
      try {
        await pool.closeConversation(conversationId);
      } catch (error) {
        if (error instanceof ConversationRuntimeActiveError) {
          return reply.code(409).send({
            error_code: "CLEANUP_RUNTIME_ACTIVE",
            cleanup_stage: "stop_runtime",
          });
        }
        return reply.code(503).send({
          error_code: "CLEANUP_RUNTIME_STATE_UNCERTAIN",
          cleanup_stage: "stop_runtime",
        });
      }
      try {
        await workspaceManager.removeConversation(conversationId);
      } catch (error) {
        const cleanupError =
          error instanceof RuntimeCleanupError
            ? error
            : new RuntimeCleanupError(
                "verify_absent",
                "CLEANUP_VERIFICATION_FAILED",
              );
        return reply.code(503).send({
          error_code: cleanupError.reasonCode,
          cleanup_stage: cleanupError.stage,
        });
      }
      const ownerHeader = request.headers["x-linksense-owner-id"];
      const ownerId = uuid.parse(
        Array.isArray(ownerHeader) ? ownerHeader[0] : ownerHeader,
      );
      ownerRegistry.remove(conversationId, ownerId);
      return { success: true };
    },
  );

  return app;
}

function sendSkillCreatorFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  conversationId: string,
  error: unknown,
) {
  const failure =
    error instanceof SkillCreatorRequestError
      ? error
      : new SkillCreatorRequestError("SKILL_CREATOR_UNAVAILABLE", true, 503);
  request.log.warn(
    {
      conversationId,
      reasonCode: failure.code,
      retryable: failure.retryable,
    },
    "skill creator request rejected",
  );
  return reply.code(failure.statusCode).send({
    code: failure.code,
    retryable: failure.retryable,
  });
}

async function probeDirectory(
  directory: string,
  reasonCode: "WORKSPACE_ROOT_UNAVAILABLE" | "CODEX_HOME_ROOT_UNAVAILABLE",
): Promise<{
  status: "available" | "unavailable";
  reason_code: typeof reasonCode | null;
}> {
  try {
    await mkdir(directory, { recursive: true });
    await access(directory, constants.R_OK | constants.W_OK);
    return { status: "available", reason_code: null };
  } catch {
    return { status: "unavailable", reason_code: reasonCode };
  }
}

async function probeDirectories(
  directories: string[],
  reasonCode: "WORKSPACE_ROOT_UNAVAILABLE" | "CODEX_HOME_ROOT_UNAVAILABLE",
): Promise<{
  status: "available" | "unavailable";
  reason_code: typeof reasonCode | null;
}> {
  const results = await Promise.all(
    directories.map((directory) => probeDirectory(directory, reasonCode)),
  );
  return results.every((result) => result.status === "available")
    ? { status: "available", reason_code: null }
    : { status: "unavailable", reason_code: reasonCode };
}

function resolveHealthRoots(config: RunnerConfig): {
  home: string;
  control: string;
  workspace: string;
  codexHome: string;
} {
  const home =
    config.LINKSENSE_RUNNER_MODE === "worker"
      ? config.LINKSENSE_USER_DATA_ROOT
      : path.join(config.LINKSENSE_USER_DATA_ROOT, ".runner-health", "home");
  const control =
    config.LINKSENSE_RUNNER_MODE === "worker"
      ? config.LINKSENSE_WORKER_CONTROL_ROOT ?? "/run/linksense-control"
      : path.join(config.LINKSENSE_USER_DATA_ROOT, ".runner-health", "control");
  return {
    home,
    control,
    workspace: path.join(home, "workspaces"),
    codexHome: path.join(home, "task-homes"),
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseOwnerIdHeader(
  value: string | string[] | undefined,
): string | null {
  const parsed = uuid.safeParse(Array.isArray(value) ? value[0] : value);
  return parsed.success ? parsed.data : null;
}

function goalRuntimeInput(
  conversationId: string,
  body: z.infer<typeof goalRuntimeBodySchema>,
) {
  return {
    conversationId,
    ownerId: body.ownerId,
    expectedRuntimeGeneration: body.expectedRuntimeGeneration,
    capabilityGeneration: body.capabilityGeneration,
    mcpGeneration: body.mcpGeneration,
    mcpServers: body.mcpServers,
    codexThreadId: body.codexThreadId,
    projectionTurnId: body.projectionTurnId,
    capabilities: body.capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      type: capability.type,
      revision: capability.revision,
      ...(capability.credentialEnvironment
        ? { credentialEnvironment: capability.credentialEnvironment }
        : {}),
    })),
    environment: body.environment,
    model: body.model,
    reasoningEffort: body.reasoningEffort,
    modelProvider: {
      revision: body.modelProvider.revision,
      baseUrl: body.modelProvider.baseUrl,
      protocolMode: body.modelProvider.protocolMode,
      apiKey: body.modelProvider.apiKey,
      ...(body.modelProvider.pricing
        ? { pricing: body.modelProvider.pricing }
        : {}),
      ...(body.modelProvider.modelContextWindow === undefined
        ? {}
        : { modelContextWindow: body.modelProvider.modelContextWindow }),
      ...(body.modelProvider.modelAutoCompactTokenLimit === undefined
        ? {}
        : {
            modelAutoCompactTokenLimit:
              body.modelProvider.modelAutoCompactTokenLimit,
          }),
    },
  };
}

function subAgentReadInput(
  conversationId: string,
  body: z.infer<typeof subAgentDetailBodySchema>,
): SubAgentDetailReadInput;
function subAgentReadInput(
  conversationId: string,
  body: z.infer<typeof subAgentSummariesBodySchema>,
): SubAgentReadRuntimeInput;
function subAgentReadInput(
  conversationId: string,
  body:
    | z.infer<typeof subAgentDetailBodySchema>
    | z.infer<typeof subAgentSummariesBodySchema>,
): SubAgentDetailReadInput | SubAgentReadRuntimeInput {
  return {
    conversationId,
    ownerId: body.ownerId,
    expectedRuntimeGeneration: body.expectedRuntimeGeneration,
    codexThreadId: body.codexThreadId,
    codexTurnId: body.codexTurnId,
    authorizedAgentKeys: body.authorizedAgentKeys,
    projectionTurnId: body.projectionTurnId,
    model: body.model,
    reasoningEffort: body.reasoningEffort,
    modelProvider: {
      revision: body.modelProvider.revision,
      baseUrl: body.modelProvider.baseUrl,
      protocolMode: body.modelProvider.protocolMode,
      apiKey: body.modelProvider.apiKey,
      ...(body.modelProvider.pricing
        ? { pricing: body.modelProvider.pricing }
        : {}),
      ...(body.modelProvider.modelContextWindow === undefined
        ? {}
        : { modelContextWindow: body.modelProvider.modelContextWindow }),
      ...(body.modelProvider.modelAutoCompactTokenLimit === undefined
        ? {}
        : {
            modelAutoCompactTokenLimit:
              body.modelProvider.modelAutoCompactTokenLimit,
          }),
    },
    ...("agentKey" in body ? { agentKey: body.agentKey } : {}),
  };
}

function projectStartOperation(state: StartOperationState) {
  return {
    conversationId: state.conversationId,
    projectionTurnId: state.projectionTurnId,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    ...(state.result ? { result: state.result } : {}),
    ...(state.errorCode ? { errorCode: state.errorCode } : {}),
  };
}

function projectSteerOperation(state: SteerOperationState) {
  return {
    operationId: state.operationId,
    conversationId: state.conversationId,
    projectionTurnId: state.projectionTurnId,
    expectedCodexTurnId: state.expectedCodexTurnId,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    ...(state.result ? { result: state.result } : {}),
    ...(state.errorCode ? { errorCode: state.errorCode } : {}),
  };
}
