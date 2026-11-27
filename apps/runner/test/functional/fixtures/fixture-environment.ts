/**
 * Synthetic environment for fixture-only Core MCP registries.
 *
 * The production modules still construct their clients, so every endpoint they
 * would read must parse. All values are loopback-inert or clearly synthetic;
 * no fixture tool calls any of these services except the computer executor.
 */
export function computerFixtureEnvironment(collaborationMode: "default" | "plan"): NodeJS.ProcessEnv {
  const token = "turn-token-00000000000000000000000000000000";
  return {
    LINKSENSE_COLLABORATION_MODE: collaborationMode,
    LINKSENSE_CONVERSATION_ID: "01900000-0000-7000-8000-000000000001",
    LINKSENSE_FILE_SERVICE_ENDPOINT: "http://127.0.0.1:9/register-artifact",
    LINKSENSE_FILE_SERVICE_TOKEN: token,
    LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:9/form",
    LINKSENSE_FORM_SERVICE_TOKEN: token,
    LINKSENSE_IMAGE_GENERATION_ENDPOINT: "http://127.0.0.1:9/generate",
    LINKSENSE_IMAGE_GENERATION_TOKEN: token,
    LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:9/search",
    LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
    LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
    LINKSENSE_SKILL_CREATOR_ENDPOINT: "http://127.0.0.1:9/skill",
    LINKSENSE_SKILL_CREATOR_TOKEN: token,
    LINKSENSE_WEB_SEARCH_ENDPOINT: "http://127.0.0.1:9/web-search",
    LINKSENSE_WEB_SEARCH_TOKEN: "synthetic-web-search-token-000000000000000000000",
    LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:9/current-user",
    LINKSENSE_CURRENT_USER_TOKEN: token,
  };
}
