import {
  browserUseToolName,
  computerActToolName,
  conversationFormToolTimeoutSeconds,
  coreMcpServerKey,
  managedBrowserMcpServerKey,
  modelAutoCompactTokenLimitFor,
  workspaceProviderSchema,
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

export const desktopPermissionProfiles = { default: "linksense-workspace", plan: "linksense-read-only" } as const;

export function desktopPermissionConfigOverrides(input: { control: string; codex: string }): string[] {
  const systemRead = [
    // Codex retains the workspace sandbox for approved commands when the root is explicitly denied.
    `":root"="deny"`,
    `":minimal"="read"`,
    `${JSON.stringify(input.codex)}="read"`,
    `${JSON.stringify(input.control)}="deny"`,
    `":slash_tmp"="deny"`,
    `"/private/var/tmp"="deny"`,
  ].join(",");
  return [
    `default_permissions="${desktopPermissionProfiles.default}"`,
    ...Object.entries(desktopPermissionProfiles).flatMap(([mode, profile]) => {
      const prefix = `permissions.${profile}`;
      return [
        `${prefix}.network.enabled=false`,
        `${prefix}.filesystem={${systemRead},":workspace_roots"="${mode === "default" ? "write" : "read"}"}`,
      ];
    }),
  ];
}

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

/**
 * Text-only provider models must not receive the native `view_image` tool:
 * screenshot tool results become base64 image parts in the model context.
 */
export function linkSenseImageCapabilityConfigOverrides(
  supportsImageInput: boolean | undefined,
): string[] {
  return supportsImageInput === true ? [] : ["features.view_image=false"];
}

export const coreMcpEnvironmentVariables = [
  "LINKSENSE_COLLABORATION_MODE",
  "LINKSENSE_CONVERSATION_ID",
  "LINKSENSE_CURRENT_USER_ENDPOINT",
  "LINKSENSE_CURRENT_USER_TOKEN",
  "LINKSENSE_CONVERSATION_REFERENCES_ENDPOINT",
  "LINKSENSE_AUTOMATION_STOP_ENDPOINT",
  "LINKSENSE_WEB_SEARCH_ENDPOINT",
  "LINKSENSE_WEB_SEARCH_TOKEN",
  "LINKSENSE_AUTOMATION_ENDPOINT",
  "LINKSENSE_AUTOMATION_TOKEN",
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
  "LINKSENSE_SKILL_MANAGEMENT_ENDPOINT",
  "LINKSENSE_SKILL_MANAGEMENT_TOKEN",
  "LINKSENSE_APPLICATION_BUILDER_ENDPOINT",
  "LINKSENSE_APPLICATION_BUILDER_TOKEN",
  "LINKSENSE_WEB_SITE_ENDPOINT",
  "LINKSENSE_WEB_SITE_TOKEN",
] as const;

/**
 * Only a desktop process whose supervisor callback was actually provisioned
 * may allow these into the Core MCP stdio environment. The persistent owner
 * template never includes them, and neither does an unnegotiated worker.
 */
const computerRelayEnvironmentVariables = [
  "LINKSENSE_COMPUTER_ENDPOINT",
  "LINKSENSE_COMPUTER_TOKEN",
] as const;

const managedBrowserEnvironmentVariables = [
  "HOME",
  "CODEX_HOME",
  "LINKSENSE_WORKSPACE_PATH",
  "LINKSENSE_CONVERSATION_ID",
  "LINKSENSE_BROWSER_READ_ONLY",
] as const;

const coreMcpInteractiveFormToolTimeoutSeconds =
  conversationFormToolTimeoutSeconds;

export function linkSenseModelProviderConfigOverrides(input: {
  baseUrl: string;
  protocolMode: ModelProviderProtocolMode;
  allowWebSockets?: boolean;
  modelContextWindow?: number;
  modelAutoCompactTokenLimit?: number;
  /** Catalog file that lets Codex resolve the configured window instead of clamping it. */
  modelCatalogPath?: string;
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
    ...(input.modelCatalogPath === undefined
      ? []
      : [`model_catalog_json=${JSON.stringify(input.modelCatalogPath)}`]),
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
  disableBrowserUse?: boolean;
  disableArtifactRegistration?: boolean;
  promptForBrowserUse?: boolean;
  computerActApproval?: boolean;
  /** The process received the trusted desktop computer relay endpoint/token. */
  computerRelay?: boolean;
}): string[] {
  const knowledgeSearchTimeouts = deriveKnowledgeSearchTimeouts(
    input.knowledgeSearchTimeoutMs ?? DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  );
  const coreToolTimeoutSeconds = Math.max(
    coreMcpInteractiveFormToolTimeoutSeconds,
    knowledgeSearchTimeouts.codexToolSeconds,
  );
  const corePrefix = `mcp_servers.${coreMcpServerKey}`;
  const disabledTools = [
    ...(input.disableBrowserUse ? [browserUseToolName] : []),
    ...(input.disableArtifactRegistration ? ["register_artifact"] : []),
  ];
  const managedBrowserPrefix = `mcp_servers.${managedBrowserMcpServerKey}`;

  return [
    `${corePrefix}.command=${JSON.stringify(input.command)}`,
    `${corePrefix}.args=${JSON.stringify(input.args)}`,
    `${corePrefix}.env_vars=${JSON.stringify([
      ...coreMcpEnvironmentVariables,
      ...(input.computerRelay === true ? computerRelayEnvironmentVariables : []),
    ])}`,
    `${corePrefix}.enabled=true`,
    `${corePrefix}.required=false`,
    `${corePrefix}.startup_timeout_sec=10`,
    `${corePrefix}.tool_timeout_sec=${String(coreToolTimeoutSeconds)}`,
    ...(disabledTools.length ? [`${corePrefix}.disabled_tools=${JSON.stringify(disabledTools)}`] : []),
    ...(input.promptForBrowserUse ? [`${corePrefix}.tools.${browserUseToolName}.approval_mode="prompt"`] : []),
    // Prompt always requires the native exact one-shot Allow/Cancel card;
    // Approve resolves without one (rust-v0.170.0 mcp_tool_call.rs:2808-2819),
    // so the relay gate could never observe a user decision.
    ...(input.computerActApproval ? [`${corePrefix}.tools.${computerActToolName}.approval_mode="prompt"`] : []),
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

/** Reuse the shipped connector handlers without loading cloud capability snapshots on the Mac. */
export function desktopConnectionMcpConfigOverrides(input: { command: string; args: string[] }): string[] {
  return ["microsoft-files", ...workspaceProviderSchema.options].flatMap(provider => {
    const prefix = `mcp_servers.linksense_${provider.replaceAll("-", "_")}`;
    return [
      `${prefix}.command=${JSON.stringify(input.command)}`,
      `${prefix}.args=${JSON.stringify([...input.args, "--desktop-read-only", provider])}`,
      `${prefix}.env_vars=${JSON.stringify(["LINKSENSE_CONNECTION_ENDPOINT", "LINKSENSE_CONNECTION_TOKEN", "LINKSENSE_COLLABORATION_MODE"])}`,
      `${prefix}.startup_timeout_sec=10`,
      `${prefix}.tool_timeout_sec=120`,
    ];
  });
}
