import {
  conversationFormAutoResolutionMs,
  coreMcpServerKey,
  managedBrowserMcpServerKey,
  modelAutoCompactTokenLimitFor,
  type ModelProviderProtocolMode,
} from "@linksense/shared";

import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  deriveKnowledgeSearchTimeouts,
} from "../knowledge-search-timeout.js";
import {
  modelGatewayEnvironmentKey,
  modelGatewaySupportsWebSockets,
} from "../model-gateway/model-gateway.js";

export const linkSenseModelProviderId = "link-sense" as const;

/**
 * Native discovery must reach the model as well as skills/list. CLI overrides
 * also cover existing task homes, without rewriting Codex-owned config files.
 * Plan supplies selected Skills as read-only references through additionalContext.
 */
export function linkSenseSkillConfigOverrides(
  mode: "default" | "plan",
): string[] {
  return [
    `skills.include_instructions=${mode === "default"}`,
    "skills.bundled.enabled=false",
  ];
}

export const coreMcpEnvironmentVariables = [
  "LINKSENSE_COLLABORATION_MODE",
  "LINKSENSE_CONVERSATION_ID",
  "LINKSENSE_CURRENT_USER_ENDPOINT",
  "LINKSENSE_CURRENT_USER_TOKEN",
  "LINKSENSE_FILE_SERVICE_ENDPOINT",
  "LINKSENSE_FILE_SERVICE_TOKEN",
  "LINKSENSE_FORM_SERVICE_ENDPOINT",
  "LINKSENSE_FORM_SERVICE_TOKEN",
  "LINKSENSE_IMAGE_GENERATION_ENDPOINT",
  "LINKSENSE_IMAGE_GENERATION_TOKEN",
  "LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT",
  "LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS",
  "LINKSENSE_KNOWLEDGE_SERVICE_TOKEN",
  "LINKSENSE_SKILL_CREATOR_ENDPOINT",
  "LINKSENSE_SKILL_CREATOR_TOKEN",
  "LINKSENSE_APPLICATION_BUILDER_ENDPOINT",
  "LINKSENSE_APPLICATION_BUILDER_TOKEN",
] as const;

const managedBrowserEnvironmentVariables = [
  "HOME",
  "CODEX_HOME",
  "LINKSENSE_WORKSPACE_PATH",
  "LINKSENSE_CONVERSATION_ID",
  "LINKSENSE_BROWSER_READ_ONLY",
] as const;

const coreMcpInteractiveFormToolTimeoutSeconds =
  Math.ceil(conversationFormAutoResolutionMs / 1_000) + 30;

export function linkSenseModelProviderConfigOverrides(input: {
  baseUrl: string;
  protocolMode: ModelProviderProtocolMode;
  allowWebSockets?: boolean;
  modelContextWindow?: number;
  modelAutoCompactTokenLimit?: number;
}): string[] {
  const autoCompactTokenLimit =
    input.modelAutoCompactTokenLimit ??
    (input.modelContextWindow === undefined
      ? undefined
      : modelAutoCompactTokenLimitFor(input.modelContextWindow));
  const providerPrefix = `model_providers.${linkSenseModelProviderId}`;

  return [
    `${providerPrefix}.name="LinkSense"`,
    `${providerPrefix}.base_url=${JSON.stringify(input.baseUrl)}`,
    `${providerPrefix}.wire_api="responses"`,
    `${providerPrefix}.env_key=${JSON.stringify(modelGatewayEnvironmentKey)}`,
    `${providerPrefix}.supports_websockets=${String(
      input.allowWebSockets !== false &&
        modelGatewaySupportsWebSockets(input.protocolMode),
    )}`,
    `${providerPrefix}.stream_max_retries=2`,
    `${providerPrefix}.websocket_connect_timeout_ms=12000`,
    `${providerPrefix}.requires_openai_auth=false`,
    ...(input.modelContextWindow === undefined
      ? []
      : [`model_context_window=${String(input.modelContextWindow)}`]),
    ...(autoCompactTokenLimit === undefined
      ? []
      : [
          `model_auto_compact_token_limit=${String(autoCompactTokenLimit)}`,
          'model_auto_compact_token_limit_scope="total"',
        ]),
  ];
}

export function builtInMcpConfigOverrides(input: {
  command: string;
  args: string[];
  managedBrowserArgs?: string[];
  knowledgeSearchTimeoutMs?: number;
}): string[] {
  const knowledgeSearchTimeouts = deriveKnowledgeSearchTimeouts(
    input.knowledgeSearchTimeoutMs ?? DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );
  const coreToolTimeoutSeconds = Math.max(
    coreMcpInteractiveFormToolTimeoutSeconds,
    knowledgeSearchTimeouts.codexToolSeconds,
  );
  const corePrefix = `mcp_servers.${coreMcpServerKey}`;
  const managedBrowserPrefix = `mcp_servers.${managedBrowserMcpServerKey}`;

  return [
    `${corePrefix}.command=${JSON.stringify(input.command)}`,
    `${corePrefix}.args=${JSON.stringify(input.args)}`,
    `${corePrefix}.env_vars=${JSON.stringify(coreMcpEnvironmentVariables)}`,
    `${corePrefix}.enabled=true`,
    `${corePrefix}.required=false`,
    `${corePrefix}.startup_timeout_sec=10`,
    `${corePrefix}.tool_timeout_sec=${String(coreToolTimeoutSeconds)}`,
    ...(input.managedBrowserArgs
      ? [
          `${managedBrowserPrefix}.command=${JSON.stringify(input.command)}`,
          `${managedBrowserPrefix}.args=${JSON.stringify(
            input.managedBrowserArgs,
          )}`,
          `${managedBrowserPrefix}.env_vars=${JSON.stringify(
            managedBrowserEnvironmentVariables,
          )}`,
          `${managedBrowserPrefix}.enabled=false`,
          `${managedBrowserPrefix}.required=false`,
          `${managedBrowserPrefix}.startup_timeout_sec=10`,
          `${managedBrowserPrefix}.tool_timeout_sec=130`,
        ]
      : []),
  ];
}
