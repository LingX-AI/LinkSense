import { expect, it, vi } from "vitest";
import { computerUseFailure } from "@linksense/shared";
import { computerUseCoreMcpModule } from "../src/mcp/core-services/computer-use-service.js";
const environment = {
  LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1/mcp-current-user/task/info",
  LINKSENSE_CURRENT_USER_TOKEN: "x".repeat(32),
};
const device = "10000000-0000-4000-8000-000000000001";
it("exposes a strict native tool and binds the existing task token and screenshot result", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    ok: true, data: { image: "AQID", mime_type: "image/png" },
  })));
  const module = computerUseCoreMcpModule.create({ environment, workspaceRoot: "/tmp", fetch: fetcher });
  expect(module.tools[0]?.name).toBe("computer_use");
  expect(module.tools[0]?.description).toContain("available_actions");
  expect(module.tools[0]?.description).toContain("no arbitrary coordinate fallback");
  expect(module.tools[0]?.inputSchema.properties?.action).toMatchObject({ enum: expect.arrayContaining(["status", "apps", "click", "release"]) });
  const result = await module.callTool({
    toolName: "computer_use",
    argumentsValue: { action: "screenshot", device_id: device, app: "Notes", window_id: "1" },
    signal: new AbortController().signal,
  });
  expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://127.0.0.1/mcp-current-user/task/computer-use");
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${environment.LINKSENSE_CURRENT_USER_TOKEN}` });
  expect(result.content[1]).toEqual({ type: "image", data: "AQID", mimeType: "image/png" });
});
it("denies Plan writes and arbitrary commands before any network request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const module = computerUseCoreMcpModule.create({
    environment: { ...environment, LINKSENSE_COLLABORATION_MODE: "plan" }, workspaceRoot: "/tmp", fetch: fetcher,
  });
  for (const argumentsValue of [
    { action: "click", device_id: device, ref: "@snap:e1" },
    { action: "shell", command: "bad" }, { action: "status", device_id: device },
  ]) {
    expect((await module.callTool({ toolName: "computer_use", argumentsValue, signal: new AbortController().signal })).isError).toBe(true);
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { status: 503, body: JSON.stringify(computerUseFailure("COMPUTER_USE_COMMAND_FAILED", "unknown")), code: "COMPUTER_USE_COMMAND_FAILED", delivery: "unknown" },
  { status: 502, body: "<html>private upstream error</html>", code: "COMPUTER_USE_COMMAND_FAILED", delivery: "unknown" },
  { status: 403, body: "Forbidden", code: "COMPUTER_USE_ACCESS_DENIED", delivery: "not_delivered" },
])("preserves delivery uncertainty for HTTP $status", async ({ status, body, code, delivery }) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
  const module = computerUseCoreMcpModule.create({ environment, workspaceRoot: "/tmp", fetch: fetcher });
  const result = await module.callTool({
    toolName: "computer_use",
    argumentsValue: { action: "click", device_id: device, ref: "@snap:e1" },
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: "text", text: JSON.stringify({
      ok: false, code, retryable: false, delivery, help_path: "/settings/general#computer-use",
    }) }],
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
