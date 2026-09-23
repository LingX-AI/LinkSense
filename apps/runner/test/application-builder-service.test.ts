import { describe, expect, it, vi } from "vitest";
import { applicationBuilderCoreMcpModule } from "../src/mcp/core-services/application-builder-service.js";
import { coreMcpToolNamesFor } from "../src/mcp/core-service-registry.js";
import { applicationBuilderErrorFromApi } from "../src/application-builder-error.js";

function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json(null));
  const module = applicationBuilderCoreMcpModule.create({ workspaceRoot: "/unused", fetch, environment: { LINKSENSE_APPLICATION_BUILDER_ENDPOINT: "https://runner.example.test/builder", LINKSENSE_APPLICATION_BUILDER_TOKEN: "test-token-".repeat(5) } });
  const call = (toolName: string, argumentsValue: unknown) => module.callTool({ toolName, argumentsValue, signal: new AbortController().signal });
  return { fetch, call };
}
describe("application builder Core MCP tools", () => {
  it.each(["workspace", "projects/60000000-0000-4000-8000-000000000001"])("returns the explicit source location for %s instead of assuming the active cwd", async workspace => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({
      id: "10000000-0000-4000-8000-000000000001", conversation_id: "20000000-0000-4000-8000-000000000001",
      name: "App", directory: "applications/example", workspace_path: workspace,
      application_id: null, preview_application_id: null, preview_conversation_id: null,
      preview_current: false, revision: 0, source_hash: null, installed_source_hash: null,
      source_error: null, manifest: null, diagnostics: [], updated_at: "2026-09-23T00:00:00Z",
    }));
    const result = await f.call("open_application_development", { name: "App" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining(`"source_directory":"~/${workspace}/applications/example"`) })]);
  });
  it("offers metadata editing only in default mode and forwards only scoped metadata", async () => {
    const f = fixture();
    expect(coreMcpToolNamesFor("default")).toContain("update_application_metadata");
    expect(coreMcpToolNamesFor("plan")).not.toContain("update_application_metadata");
    const input = { source_hash: "a".repeat(64), name: "Renamed", icon: { type: "file", path: "uploads/logo.png" } };
    expect((await f.call("update_application_metadata", input)).isError).toBe(false);
    expect(f.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ ...input, operation: "metadata" }) }));
    expect((await f.call("update_application_metadata", { ...input, application_id: "other" })).isError).toBe(true);
    expect((await f.call("update_application_metadata", { icon: { type: "preset", preset: "unknown" } })).isError).toBe(true);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(applicationBuilderErrorFromApi(422, { error_code: "APPLICATION_ICON_UPLOAD_INVALID" })).toMatchObject({ code: "APPLICATION_ICON_UPLOAD_INVALID", retryable: false });
  });
  it("registers open and inspect only in normal mode and forwards validated requests with a scoped token", async () => {
    const f = fixture();
    expect(coreMcpToolNamesFor("default")).toContain("open_application_development");
    expect(coreMcpToolNamesFor("plan")).not.toContain("open_application_development");
    expect((await f.call("open_application_development", { name: "App", directory: "applications/example" })).isError).toBe(false);
    expect(f.fetch).toHaveBeenCalledWith("https://runner.example.test/builder", expect.objectContaining({ headers: expect.objectContaining({ authorization: `Bearer ${"test-token-".repeat(5)}` }), body: JSON.stringify({ name: "App", directory: "applications/example", operation: "open" }) }));
    expect((await f.call("inspect_application_development", {})).isError).toBe(false);
  });
  it("exposes bounded test inspection in default mode and validates the returned contract", async () => {
    const f = fixture();
    expect(coreMcpToolNamesFor("default")).toContain("inspect_application_tests");
    expect(coreMcpToolNamesFor("plan")).not.toContain("inspect_application_tests");
    f.fetch.mockResolvedValueOnce(Response.json({ sessions: { items: [], next_cursor: null }, detail: null }));
    expect((await f.call("inspect_application_tests", {})).isError).toBe(false);
    expect(f.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ operation: "tests" }) }));
    expect((await f.call("inspect_application_tests", { conversation_id: "invalid" })).isError).toBe(true);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unsafe paths and cross-task arguments without making a network request", async () => {
    const f = fixture();
    expect((await f.call("open_application_development", { name: "App", directory: "../../private" })).isError).toBe(true);
    expect((await f.call("inspect_application_development", { conversation_id: "other" })).isError).toBe(true);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("preserves actionable validation errors while removing raw service details", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ code: "APPLICATION_PACKAGE_INVALID", retryable: false, message: "private path" }, { status: 422 }));
    const result = await f.call("inspect_application_development", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("APPLICATION_PACKAGE_INVALID");
    expect(JSON.stringify(result)).not.toContain("private path");
    expect(applicationBuilderErrorFromApi(403, { error_code: "FORBIDDEN", message: "private" })).toMatchObject({ code: "APPLICATION_DEVELOPMENT_FORBIDDEN", retryable: false });
  });
});
