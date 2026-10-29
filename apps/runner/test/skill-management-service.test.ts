import { builtInCapabilityId } from "@linksense/shared";
import { describe, expect, it, vi } from "vitest";

import { coreMcpToolNamesFor } from "../src/mcp/core-service-registry.js";
import { skillManagementReadCoreMcpModule, skillManagementWriteCoreMcpModule } from "../src/mcp/core-services/skill-management-service.js";

const id = "10000000-0000-4000-8000-000000000001";
const token = "skill-management-test-token-".repeat(3);
function fixture(response: unknown, status = 200, write = false) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(response), { status }));
  const module = (write ? skillManagementWriteCoreMcpModule : skillManagementReadCoreMcpModule).create({
    workspaceRoot: "/unused",
    environment: { LINKSENSE_SKILL_MANAGEMENT_ENDPOINT: "https://runner.example.test/skills/execute", LINKSENSE_SKILL_MANAGEMENT_TOKEN: token },
    fetch,
  });
  const call = (toolName: string, argumentsValue: unknown = {}, signal = new AbortController().signal) => module.callTool({ toolName, argumentsValue, signal });
  return { module, fetch, call };
}

describe("Core Skill management tools", () => {
  it("exposes a read-only list in both modes and a destructive uninstall only in Default", () => {
    for (const mode of ["default", "plan"] as const) expect(coreMcpToolNamesFor(mode)).toContain("list_skills");
    expect(coreMcpToolNamesFor("default")).toContain("uninstall_skill");
    expect(coreMcpToolNamesFor("plan")).not.toContain("uninstall_skill");
    expect(fixture(null).module.tools[0]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const uninstall = fixture(null, 200, true).module.tools[0];
    expect(uninstall?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(uninstall?.description).toContain("human explicitly requests");
    expect(uninstall?.description).toContain("another confirmation");
    expect(uninstall?.description).toContain("inspect the current state before any retry");
  });

  it("returns every enabled Skill and forwards no owner, selection, limit or conversation override", async () => {
    const result = { success: true, operation: "list", items: [
      { id: builtInCapabilityId("linksense-docs"), name: "linksense-docs", display_name: null, description: null, source_type: "builtin", is_builtin: true, can_uninstall: false },
    ] };
    const f = fixture(result);
    expect(await f.call("list_skills")).toEqual({ isError: false, content: [{ type: "text", text: JSON.stringify(result) }] });
    expect(f.fetch).toHaveBeenCalledWith("https://runner.example.test/skills/execute", expect.objectContaining({ method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ operation: "list" }), signal: expect.any(AbortSignal) }));
  });

  it("uninstalls exactly the identified Skill", async () => {
    const result = { success: true, operation: "uninstall", skill_id: id, name: "notes" };
    const f = fixture(result, 200, true);
    expect(await f.call("uninstall_skill", { skill_id: id })).toMatchObject({ isError: false });
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toEqual({ operation: "uninstall", skill_id: id });
  });

  it.each([{ owner_id: id }, { limit: 200 }, { conversation_id: id }])("rejects list overrides %j before sending", async args => {
    const f = fixture(null);
    expect(await f.call("list_skills", args)).toMatchObject({ isError: true });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("rejects uninstallation through the read module and malformed target IDs", async () => {
    const read = fixture(null);
    expect(await read.call("uninstall_skill", { skill_id: id })).toMatchObject({ isError: true });
    expect(read.fetch).not.toHaveBeenCalled();
    const write = fixture(null, 200, true);
    expect(await write.call("uninstall_skill", { skill_id: "../notes" })).toMatchObject({ isError: true });
    expect(write.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { success: true, operation: "uninstall", skill_id: id, name: "notes" },
    { success: true, operation: "list", items: [], secret: "private-value" },
    { success: true, operation: "list", items: [{ id, name: "notes", storage_path: "/private" }] },
  ])("rejects invalid list responses without exposing their contents %j", async body => {
    const result = await fixture(body).call("list_skills");
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects an uninstall response for a different Skill", async () => {
    const f = fixture({ success: true, operation: "uninstall", skill_id: "20000000-0000-4000-8000-000000000001", name: "other" }, 200, true);
    expect(await f.call("uninstall_skill", { skill_id: id })).toMatchObject({ isError: true });
  });

  it("returns a safe synchronization failure without retrying deletion", async () => {
    const failure = { code: "CAPABILITY_HOME_SYNC_FAILED", retryable: false };
    const f = fixture(failure, 503, true);
    expect(await f.call("uninstall_skill", { skill_id: id })).toEqual({ isError: true, content: [{ type: "text", text: JSON.stringify(failure) }] });
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it("redacts unknown upstream errors and propagates cancellation", async () => {
    const f = fixture({ error: "private backend stack" }, 500);
    const result = await f.call("list_skills");
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");
    const controller = new AbortController();
    controller.abort();
    f.fetch.mockRejectedValueOnce(controller.signal.reason);
    await expect(f.call("list_skills", {}, controller.signal)).rejects.toBe(controller.signal.reason);
  });
});
