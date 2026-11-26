import { describe, expect, it, vi } from "vitest";
import { webSiteCoreMcpModule } from "../src/mcp/core-services/web-site-service.js";
import { coreMcpToolNamesFor } from "../src/mcp/core-service-registry.js";

const token = "test-token-".repeat(5);
const site = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Water reminder",
  description: "",
  slug: "water-reminder",
  status: "published",
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
      LINKSENSE_WEB_SITE_ENDPOINT: "https://runner.example.test/web-sites",
      LINKSENSE_WEB_SITE_TOKEN: token,
    },
  });
  const call = (toolName: string, argumentsValue: unknown) =>
    module.callTool({ toolName, argumentsValue, signal: new AbortController().signal });
  return { fetch, call };
}

describe("public site Core MCP tools", () => {
  it("registers site management tools only in default mode", () => {
    for (const name of ["list_sites", "publish_site", "update_site", "unpublish_site", "delete_site"]) {
      expect(coreMcpToolNamesFor("default")).toContain(name);
      expect(coreMcpToolNamesFor("plan")).not.toContain(name);
    }
  });

  it("forwards a validated publish request with the scoped credential", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ tool: "publish_site", outcome: "published", site }));
    const result = await f.call("publish_site", {
      site: { file_id: site.source_file_id, name: "Water reminder", slug: "water-reminder" },
    });
    expect(result.isError).toBe(false);
    const call = f.fetch.mock.calls[0];
    expect(call?.[0]).toBe("https://runner.example.test/web-sites");
    expect(call?.[1]?.headers).toMatchObject({ authorization: `Bearer ${token}` });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      tool: "publish_site",
      site: { file_id: site.source_file_id, name: "Water reminder", slug: "water-reminder", description: "" },
    });
    expect(JSON.stringify(result)).toContain("https://linksense.example.test/web/water-reminder");
  });

  it("forwards list and update requests and validates the returned page", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ tool: "list_sites", items: [site], next_cursor: null }));
    const listed = await f.call("list_sites", { search: "water" });
    expect(listed.isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      tool: "list_sites", search: "water", limit: 30,
    });
    f.fetch.mockResolvedValueOnce(Response.json({ tool: "update_site", site: { ...site, slug: "renamed" } }));
    expect((await f.call("update_site", { site_id: site.id, changes: { slug: "renamed" } })).isError).toBe(false);
    expect(JSON.parse(String(f.fetch.mock.calls[1]?.[1]?.body))).toEqual({
      tool: "update_site", site_id: site.id, changes: { slug: "renamed" },
    });
  });

  it("rejects unsafe input without a network request", async () => {
    const f = fixture();
    expect((await f.call("publish_site", {
      site: { file_id: site.source_file_id, name: "App", slug: "Not A Slug" },
    })).isError).toBe(true);
    expect((await f.call("delete_site", { site_id: "other" })).isError).toBe(true);
    expect((await f.call("update_site", { site_id: site.id, changes: {} })).isError).toBe(true);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("preserves actionable API failures and hides raw details", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ code: "WEB_SITE_SLUG_TAKEN", retryable: false }, { status: 409 }));
    const result = await f.call("publish_site", {
      site: { file_id: site.source_file_id, name: "App" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("WEB_SITE_SLUG_TAKEN");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
