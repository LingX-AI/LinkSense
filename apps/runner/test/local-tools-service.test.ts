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
      body: JSON.stringify({ operation: "local_tools.ping", input: { message: "hello" } }),
    }));
  });

  it("registers the file tools and preserves a conflict failure code", async () => {
    const definition = localToolsCoreMcpModules({ environment })[0]!;
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ error_code: "DESKTOP_FILE_CONFLICT" }), {
        status: 409, headers: { "content-type": "application/json" },
      }));
    const module = definition.create({ environment, workspaceRoot: "/tmp", fetch: fetchMock });
    expect(module.tools.map(tool => tool.name)).toEqual([
      "local_tools_ping", "local_files_roots", "local_files_list", "local_files_read",
      "local_files_search", "local_files_write", "local_files_create",
      "local_files_delete", "local_computer_status", "local_computer_select",
      "local_computer_observe", "local_computer_act", "local_computer_wait",
      "local_computer_pause", "local_computer_resume", "local_computer_stop",
      "local_computer_extended",
    ]);
    const result = await module.callTool({
      toolName: "local_files_write",
      argumentsValue: {
        root_id: "50000000-0000-4000-8000-000000000001",
        path: "notes.txt", content: "hello",
        expected_digest: "0".repeat(64),
      },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(String(result.content[0]?.type === "text" ? result.content[0].text : ""))).toMatchObject({
      code: "DESKTOP_FILE_CONFLICT", retryable: false,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      operation: "local_files.write",
      input: { path: "notes.txt", content: "hello" },
    });
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
