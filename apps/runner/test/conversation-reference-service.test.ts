import { describe, expect, it, vi } from "vitest";
import { conversationReferenceCoreMcpModule } from "../src/mcp/core-services/conversation-reference-service.js";

const id = "11111111-1111-4111-8111-111111111111";
describe("read referenced conversation MCP", () => {
  it.each([0, 1_008_000])("uses the trusted current-task endpoint with a valid continuation offset of %s", async offset => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation_id: id, title: "Research", messages: [], next_cursor: null, next_offset: 0 })));
    const module = conversationReferenceCoreMcpModule.create({ environment: { LINKSENSE_CONVERSATION_REFERENCES_ENDPOINT: "http://localhost/current-task/references", LINKSENSE_CURRENT_USER_TOKEN: "x".repeat(32) }, workspaceRoot: "/tmp", fetch: fetcher });
    expect(await module.callTool({ toolName: "read_referenced_conversation", argumentsValue: { conversation_id: id, offset }, signal: new AbortController().signal })).toMatchObject({ isError: false });
    expect(fetcher).toHaveBeenCalledWith("http://localhost/current-task/references", expect.objectContaining({ body: JSON.stringify({ conversation_id: id, cursor: "0", offset }), headers: expect.objectContaining({ authorization: `Bearer ${"x".repeat(32)}` }) }));
  });
  it("rejects model-supplied owner/turn fields before fetching", async () => {
    const fetcher = vi.fn();
    const module = conversationReferenceCoreMcpModule.create({ environment: {}, workspaceRoot: "/tmp", fetch: fetcher });
    expect(await module.callTool({ toolName: "read_referenced_conversation", argumentsValue: { conversation_id: id, owner_id: id }, signal: new AbortController().signal })).toMatchObject({ isError: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("maps permission errors without exposing an internal response", async () => {
    const module = conversationReferenceCoreMcpModule.create({ environment: { LINKSENSE_CONVERSATION_REFERENCES_ENDPOINT: "http://localhost/references", LINKSENSE_CURRENT_USER_TOKEN: "x".repeat(32) }, workspaceRoot: "/tmp", fetch: vi.fn().mockResolvedValue(new Response("private response", { status: 403 })) });
    const result = await module.callTool({ toolName: "read_referenced_conversation", argumentsValue: { conversation_id: id }, signal: new AbortController().signal });
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain("private response");
  });
});
