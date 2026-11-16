import { describe, expect, it, vi } from "vitest";
import { webSiteCoreMcpModule } from "../src/mcp/core-services/web-site-service.js";
import { coreMcpToolNamesFor } from "../src/mcp/core-service-registry.js";
import { webSiteErrorFromApi } from "../src/web-site-error.js";

const token = "test-token-".repeat(5);
const site = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Water reminder",
  description: "",
  slug: "water-reminder",
  status: "published",
  url_path: "/web/water-reminder",
  url: "https://linksense.example.test/web/water-reminder",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  source_task_title: "Build a water reminder",
  source_file_id: "30000000-0000-4000-8000-000000000001",
  release_id: "40000000-0000-4000-8000-000000000001",
  file_count: 3,
  size_bytes: 4096,
  published_at: "2026-11-13T00:00:00.000Z",
  created_at: "2026-11-13T00:00:00.000Z",
  updated_at: "2026-11-13T00:00:00.000Z",
};

function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json(site));
  const module = webSiteCoreMcpModule.create({
    workspaceRoot: "/unused",
    fetch,
    environment: {
      LINKSENSE_WEB_SITE_ENDPOINT: "https://runner.example.test/web-site",
      LINKSENSE_WEB_SITE_TOKEN: token,
    },
  });
  const call = (toolName: string, argumentsValue: unknown) =>
    module.callTool({ toolName, argumentsValue, signal: new AbortController().signal });
  return { fetch, call };
}

describe("public site Core MCP tools", () => {
  it("registers publishing tools only in default mode", () => {
    for (const name of ["publish_web_site", "list_web_sites", "update_web_site", "prepare_web_site_backend", "configure_web_site_backend", "inspect_web_site_backend"]) {
      expect(coreMcpToolNamesFor("default")).toContain(name);
      expect(coreMcpToolNamesFor("plan")).not.toContain(name);
    }
  });

  it("forwards backend configuration through the existing scoped publication boundary", async () => {
    const f = fixture();
    const backend = {
      id: site.id, name: "App", project_id: "ls-app", status: "ready",
      origin: "https://app.example.test", endpoint: "https://app.example.test/appwrite/v1", database_id: "app",
    };
    f.fetch.mockResolvedValueOnce(Response.json(backend));
    expect((await f.call("prepare_web_site_backend", { name: "App" })).isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toEqual({ operation: "prepare_backend", name: "App" });
    f.fetch.mockResolvedValueOnce(Response.json({ $id: "appointments" }));
    expect((await f.call("configure_web_site_backend", {
      backend_id: site.id, change: { action: "create_table", id: "appointments", name: "Appointments" },
    })).isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ operation: "configure_backend", backend_id: site.id });
  });
  it("forwards a validated publish request with the scoped credential", async () => {
    const f = fixture();
    const result = await f.call("publish_web_site", {
      name: "Water reminder",
      slug: "water-reminder",
      file_id: site.source_file_id,
    });
    expect(result.isError).toBe(false);
    const call = f.fetch.mock.calls[0];
    expect(call?.[0]).toBe("https://runner.example.test/web-site");
    expect(call?.[1]?.headers).toMatchObject({ authorization: `Bearer ${token}` });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      operation: "publish",
      name: "Water reminder",
      slug: "water-reminder",
      file_id: site.source_file_id,
    });
    expect(JSON.stringify(result)).toContain("https://linksense.example.test/web/water-reminder");
  });

  it("forwards list and update requests and validates the returned page", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ items: [site], next_cursor: null }));
    const listed = await f.call("list_web_sites", { search: "water" });
    expect(listed.isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      operation: "list", search: "water", limit: 20,
    });
    expect((await f.call("publish_web_site", { site_id: site.id, file_id: site.source_file_id })).isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[1]?.[1]?.body))).toEqual({
      operation: "publish", site_id: site.id, file_id: site.source_file_id,
    });
    expect((await f.call("update_web_site", { site_id: site.id, status: "disabled" })).isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[2]?.[1]?.body))).toEqual({
      operation: "update", site_id: site.id, status: "disabled",
    });
  });

  it("rejects unsafe input without a network request", async () => {
    const f = fixture();
    expect((await f.call("publish_web_site", { name: "App", slug: "Not A Slug", file_id: site.source_file_id })).isError).toBe(true);
    expect((await f.call("publish_web_site", { name: "App", file_id: site.source_file_id, site_id: "other" })).isError).toBe(true);
    expect((await f.call("publish_web_site", { name: "App", file_id: site.source_file_id, extra: true })).isError).toBe(true);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("preserves actionable API failures and hides raw details", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ code: "WEB_SITE_SLUG_TAKEN", retryable: false }, { status: 409 }));
    const result = await f.call("publish_web_site", { name: "App", file_id: site.source_file_id });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("WEB_SITE_SLUG_TAKEN");
    expect(webSiteErrorFromApi(403, { error_code: "FORBIDDEN", message: "private" })).toMatchObject({ code: "WEB_SITE_FORBIDDEN", retryable: false });
    expect(webSiteErrorFromApi(503, { error_code: "INTERNAL_ERROR", message: "private" })).toMatchObject({ code: "WEB_SITE_UNAVAILABLE", retryable: true });
  });
});
