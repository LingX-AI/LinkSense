import { describe, expect, it } from "vitest";

import {
  builtInMcpConfigOverrides,
  linkSenseModelProviderConfigOverrides,
  linkSenseSkillConfigOverrides,
} from "../src/codex/runtime-config-overrides.js";

describe("Codex process-level runtime config", () => {
  it("exposes authorized native Skill instructions for execution and keeps Plan reference-only", () => {
    expect(linkSenseSkillConfigOverrides("default")).toEqual([
      "skills.include_instructions=true",
      "skills.bundled.enabled=false",
    ]);
    expect(linkSenseSkillConfigOverrides("plan")).toEqual([
      "skills.include_instructions=false",
      "skills.bundled.enabled=false",
    ]);
  });
  it("projects the complete LinkSense model provider without persisting it", () => {
    expect(
      linkSenseModelProviderConfigOverrides({
        baseUrl: "http://127.0.0.1:4011/v1",
        protocolMode: "native_responses",
        modelContextWindow: 200_000,
      }),
    ).toEqual([
      'model_providers.link-sense.name="LinkSense"',
      'model_providers.link-sense.base_url="http://127.0.0.1:4011/v1"',
      'model_providers.link-sense.wire_api="responses"',
      'model_providers.link-sense.env_key="LINKSENSE_MODEL_GATEWAY_TOKEN"',
      "model_providers.link-sense.supports_websockets=true",
      "model_providers.link-sense.stream_max_retries=2",
      "model_providers.link-sense.websocket_connect_timeout_ms=12000",
      "model_providers.link-sense.requires_openai_auth=false",
      "model_context_window=200000",
      "model_auto_compact_token_limit=170000",
      'model_auto_compact_token_limit_scope="total"',
    ]);
  });

  it("honors explicit compaction and protocol-specific WebSocket policy", () => {
    expect(
      linkSenseModelProviderConfigOverrides({
        baseUrl: "http://127.0.0.1:4011/v1",
        protocolMode: "chat_completions_bridge",
        allowWebSockets: true,
        modelAutoCompactTokenLimit: 123_456,
      }),
    ).toEqual(
      expect.arrayContaining([
        "model_providers.link-sense.supports_websockets=false",
        "model_auto_compact_token_limit=123456",
        'model_auto_compact_token_limit_scope="total"',
      ]),
    );
  });

  it("projects all built-in MCP settings and keeps Plan overrides able to win", () => {
    const overrides = builtInMcpConfigOverrides({
      command: "/usr/local/bin/node",
      args: ["/app/dist/mcp/core-service-server.js"],
      managedBrowserArgs: [
        "/app/dist/mcp/managed-browser-service-server.js",
      ],
      knowledgeSearchTimeoutMs: 700_000,
    });

    expect(overrides).toEqual(
      expect.arrayContaining([
        'mcp_servers.linksense_core.command="/usr/local/bin/node"',
        'mcp_servers.linksense_core.args=["/app/dist/mcp/core-service-server.js"]',
        "mcp_servers.linksense_core.enabled=true",
        "mcp_servers.linksense_core.required=true",
        "mcp_servers.linksense_core.startup_timeout_sec=10",
        "mcp_servers.linksense_core.tool_timeout_sec=715",
        'mcp_servers.linksense_managed_browser.command="/usr/local/bin/node"',
        'mcp_servers.linksense_managed_browser.args=["/app/dist/mcp/managed-browser-service-server.js"]',
        "mcp_servers.linksense_managed_browser.enabled=false",
        "mcp_servers.linksense_managed_browser.required=false",
        "mcp_servers.linksense_managed_browser.startup_timeout_sec=10",
        "mcp_servers.linksense_managed_browser.tool_timeout_sec=130",
      ]),
    );
    expect(
      overrides.find((value) =>
        value.startsWith("mcp_servers.linksense_core.env_vars="),
      ),
    ).toContain("LINKSENSE_CURRENT_USER_TOKEN");
    expect(
      overrides.find((value) =>
        value.startsWith("mcp_servers.linksense_managed_browser.env_vars="),
      ),
    ).toContain("LINKSENSE_BROWSER_READ_ONLY");
  });
});
