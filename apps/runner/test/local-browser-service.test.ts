import { expect, it, vi } from "vitest";
import { localBrowserCoreMcpModule } from "../src/mcp/core-services/local-browser-service.js";
const environment = {
  LINKSENSE_CURRENT_USER_ENDPOINT:
    "http://127.0.0.1/mcp-current-user/task/info",
  LINKSENSE_CURRENT_USER_TOKEN: "x".repeat(32),
};
it("directs ordinal same-name DOM controls to fresh refs instead of estimated coordinates", () => {
  const module = localBrowserCoreMcpModule.create({
    environment,
    workspaceRoot: "/tmp",
    fetch: vi.fn(),
  });
  const tool = module.tools[0];
  expect(tool?.description).toMatch(/ordinal.*fresh snapshot.*ref/u);
  expect(tool?.description).toContain("Do not estimate");
  expect(tool?.inputSchema.properties?.ref).toMatchObject({
    description: expect.stringContaining("DOM controls"),
  });
  for (const key of ["x", "y"])
    expect(tool?.inputSchema.properties?.[key]).toMatchObject({
      description: expect.stringContaining("canvas"),
    });
});
it("binds requests to the native task endpoint and returns screenshots as MCP images", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          browser: "local",
          data: { tab_id: 1, image: "AQID", mime_type: "image/jpeg" },
        }),
      ),
    );
  const module = localBrowserCoreMcpModule.create({
    environment,
    workspaceRoot: "/tmp",
    fetch: fetcher,
  });
  const response = await module.callTool({
    toolName: "local_browser",
    argumentsValue: { action: "screenshot", tab_id: 1 },
    signal: new AbortController().signal,
  });
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    "http://127.0.0.1/mcp-current-user/task/local-browser",
  );
  expect(response.content[1]).toMatchObject({
    type: "image",
    mimeType: "image/jpeg",
    data: "AQID",
  });
});
it("rejects Plan mutations and malformed inputs before contacting the browser", async () => {
  const fetcher = vi.fn();
  const module = localBrowserCoreMcpModule.create({
    environment: { ...environment, LINKSENSE_COLLABORATION_MODE: "plan" },
    workspaceRoot: "/tmp",
    fetch: fetcher,
  });
  for (const input of [
    { action: "type", tab_id: 1, text: "text" },
    { action: "evaluate", code: "document.cookie" },
  ]) {
    expect(
      (
        await module.callTool({
          toolName: "local_browser",
          argumentsValue: input,
          signal: new AbortController().signal,
        })
      ).isError,
    ).toBe(true);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
