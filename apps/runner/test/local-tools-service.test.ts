import { describe, expect, it, vi } from "vitest";

import { localToolsCoreMcpModules } from "../src/mcp/core-services/local-tools-service.js";

const environment = {
  LINKSENSE_LOCAL_TOOLS_ENDPOINT: "https://runner.example.test/mcp-local-tools/execute",
  LINKSENSE_LOCAL_TOOLS_TOKEN: "local-tools-token-000000000000000000",
};

describe("local tools core MCP module", () => {
  it("registers only when the task supplied the local-tools lane", () => {
    expect(localToolsCoreMcpModules({ environment: {} })).toEqual([]);
    expect(localToolsCoreMcpModules({ environment })).toHaveLength(1);
  });

  it("calls the lane and returns the typed ping", async () => {
    const response = { message: "hello", platform: "darwin", app_version: "1.2.3" };
    const fetch = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const definition = localToolsCoreMcpModules({ environment })[0]!;
    const module = definition.create({ environment, workspaceRoot: "/tmp", fetch });
    const result = await module.callTool({
      toolName: "local_tools_ping",
      argumentsValue: { message: "hello" },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(String(result.content[0]?.type === "text" ? result.content[0].text : ""))).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(environment.LINKSENSE_LOCAL_TOOLS_ENDPOINT, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ input: { message: "hello" } }),
    }));
  });

  it("turns a denied or unavailable lane into a bounded tool failure", async () => {
    const definition = localToolsCoreMcpModules({ environment })[0]!;
    for (const status of [403, 503]) {
      const fetch = vi.fn(async () => new Response(JSON.stringify({ error_code: "FORBIDDEN" }), { status }));
      const module = definition.create({ environment, workspaceRoot: "/tmp", fetch });
      const result = await module.callTool({
        toolName: "local_tools_ping",
        argumentsValue: { message: "hello" },
        signal: new AbortController().signal,
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(String(result.content[0]?.type === "text" ? result.content[0].text : ""))).toMatchObject({
        code: status === 403 ? "DESKTOP_TOOL_ACCESS_DENIED" : "DESKTOP_TOOL_UNAVAILABLE",
      });
    }
  });
});
