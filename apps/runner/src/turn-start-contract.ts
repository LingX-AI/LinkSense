import { RUNNER_TURN_START_CONTRACT_VERSION } from "@linksense/shared";
import type { ZodError } from "zod";

/**
 * Increment whenever the controller-to-worker turn-start JSON contract changes.
 * Dynamic workers must report this exact value before receiving requests.
 */
export const TURN_START_CONTRACT_VERSION = RUNNER_TURN_START_CONTRACT_VERSION;

export type SanitizedZodIssue = {
  path: string[];
  code: string;
  message: string;
};

const safePathSegments = new Set([
  "ownerId",
  "projectionTurnId",
  "appServerProcessLimit",
  "operationKind",
  "eventProjectionTurnId",
  "capabilityGeneration",
  "mcpGeneration",
  "mcpServers",
  "serverKey",
  "url",
  "required",
  "startupTimeoutSeconds",
  "toolTimeoutSeconds",
  "credential",
  "headerName",
  "source",
  "codexThreadId",
  "forkFromCodexTurnId",
  "modelTransitionSource",
  "provider",
  "collaborationMode",
  "context",
  "userInput",
  "approvedPlanImplementation",
  "requireFinalResponse",
  "applicationInstructions",
  "officeSelectionContext",
  "selectedKnowledgeBases",
  "attachments",
  "filename",
  "relativePath",
  "priorityPlugins",
  "prioritySkills",
  "id",
  "name",
  "description",
  "capabilities",
  "type",
  "revision",
  "credentialEnvironment",
  "environment",
  "model",
  "reasoningEffort",
  "modelProvider",
  "baseUrl",
  "protocolMode",
  "modelContextWindow",
  "modelAutoCompactTokenLimit",
]);

const safeCustomMessages = new Set([
  "knowledge_selection_is_duplicated",
  "fork_requires_codex_thread",
  "skill_name_invalid",
  "plugin_name_invalid",
  "credential_environment_requires_plugin",
  "credential_environment_target_is_reserved",
  "credential_environment_source_must_be_capability_scoped",
  "credential_environment_sources_do_not_match",
  "priority_capability_is_duplicated",
  "priority_capability_is_unavailable",
  "model_transition_source_must_differ",
  "model_transition_requires_codex_thread",
  "approved_plan_implementation_requires_default_mode",
  "approved_plan_implementation_requires_canonical_input",
  "approved_plan_implementation_cannot_start_goal",
  "approved_plan_implementation_requires_codex_thread",
  "compact_requires_codex_thread",
  "compact_requires_empty_context",
  "compact_cannot_start_goal",
  "compact_cannot_fork",
  "compact_cannot_transition_model",
]);

export function sanitizeZodIssues(error: ZodError): SanitizedZodIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => {
      if (typeof segment === "number") return "[]";
      const value = String(segment);
      return safePathSegments.has(value) ? value : "<dynamic>";
    }),
    code: issue.code,
    message:
      issue.code === "custom" && safeCustomMessages.has(issue.message)
        ? issue.message
        : issue.code,
  }));
}
