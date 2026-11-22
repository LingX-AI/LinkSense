import { describe, expect, it } from "vitest";

import {
  builtInMcpConfigOverrides,
  desktopPermissionConfigOverrides,
  linkSenseImageCapabilityConfigOverrides,
  linkSenseModelProviderConfigOverrides,
  linkSenseSkillConfigOverrides,
} from "../src/codex/runtime-config-overrides.js";

describe("Codex process-level runtime config", () => {
  it("retains a root denial for approved local commands while preserving the two workspace modes", () => {
    const overrides = desktopPermissionConfigOverrides({ control: "/fixture/control", codex: "/fixture/codex" });
    expect(overrides).toEqual(expect.arrayContaining([
      expect.stringMatching(/^permissions\.linksense-workspace\.filesystem=.*":root"="deny".*":workspace_roots"="write"/u),
      expect.stringMatching(/^permissions\.linksense-read-only\.filesystem=.*":root"="deny".*":workspace_roots"="read"/u),
      "permissions.linksense-workspace.network.enabled=false",
      "permissions.linksense-read-only.network.enabled=false",
    ]));
  });
  it("disables the native view_image tool unless the model declares image support", () => {
    expect(linkSenseImageCapabilityConfigOverrides(undefined)).toEqual([
      "features.view_image=false",
    ]);
    expect(linkSenseImageCapabilityConfigOverrides(false)).toEqual([
      "features.view_image=false",
    ]);
    expect(linkSenseImageCapabilityConfigOverrides(true)).toEqual([]);
  });

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
        modelCatalogPath: "/home/.codex/linksense-models.json",
      }),
    ).toEqual(
      expect.arrayContaining([
        "model_providers.link-sense.supports_websockets=false",
        "model_auto_compact_token_limit=123456",
        'model_auto_compact_token_limit_scope="total"',
        'model_catalog_json="/home/.codex/linksense-models.json"',
      ]),
    );
  });

  it("asks for the native computer_act approval and relay environment only for an admitted worker", () => {
    const base = { command: "/usr/local/bin/node", args: ["/app/dist/mcp/core-service-server.js"] };
    expect(builtInMcpConfigOverrides(base)).not.toContain(
      'mcp_servers.linksense_core.tools.computer_act.approval_mode="prompt"',
    );
    expect(builtInMcpConfigOverrides({ ...base, computerActApproval: true })).toContain(
      'mcp_servers.linksense_core.tools.computer_act.approval_mode="prompt"',
    );
    const envLineFor = (overrides: string[]) => overrides.find(value =>
      value.startsWith("mcp_servers.linksense_core.env_vars="));
    // The persistent template and every unnegotiated/cloud process keep the
    // original allowlist; the callback names exist only where it was actually
    // provisioned.
    const baseEnvLine = envLineFor(builtInMcpConfigOverrides(base));
    for (const variable of [
      "LINKSENSE_COMPUTER_ENDPOINT",
      "LINKSENSE_COMPUTER_TOKEN",
    ]) {
      expect(baseEnvLine).not.toContain(variable);
      expect(envLineFor(builtInMcpConfigOverrides({ ...base, computerRelay: true })))
        .toContain(variable);
    }
    // Production raster stays unavailable, and the stdio MCP process never
    // receives the worker/supervisor secret.
    const relayEnvLine = envLineFor(builtInMcpConfigOverrides({ ...base, computerRelay: true }));
    expect(relayEnvLine).not.toContain("LINKSENSE_COMPUTER_SCREENSHOTS_ENABLED");
    expect(relayEnvLine).not.toContain("LINKSENSE_RUNNER_SHARED_SECRET");
    // Browser prompting keeps its existing independent template semantic.
    expect(builtInMcpConfigOverrides({ ...base, promptForBrowserUse: true })).toContain(
      'mcp_servers.linksense_core.tools.browser_use.approval_mode="prompt"',
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
        "mcp_servers.linksense_core.required=false",
        "mcp_servers.linksense_core.startup_timeout_sec=10",
        "mcp_servers.linksense_core.tool_timeout_sec=3153600000",
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
    for (const variable of ["LINKSENSE_APPLICATION_BUILDER_ENDPOINT", "LINKSENSE_APPLICATION_BUILDER_TOKEN"]) {
      expect(overrides.find(value => value.startsWith("mcp_servers.linksense_core.env_vars="))).toContain(variable);
    }
    expect(
      overrides.find((value) =>
        value.startsWith("mcp_servers.linksense_managed_browser.env_vars="),
      ),
    ).toContain("LINKSENSE_BROWSER_READ_ONLY");
  });
});
