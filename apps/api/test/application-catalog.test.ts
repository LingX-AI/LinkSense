import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { projectApplicationCatalogPage, readOwnedApplicationCatalog, type ApplicationCatalogRow } from "../src/modules/applications/catalog-repository.js";

const owner = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const nextId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000001";
const draft: ApplicationCatalogRow = {
  key: `development:${id}`, application_id: null, development_id: id,
  conversation_id: conversationId, development_name: "Draft",
  development_dependencies: null,
  development_updated_at: new Date("2026-09-17T00:00:00.000Z"), has_changes: true,
  sort_timestamp: "2026-09-17T00:00:00.123456Z",
};

describe("owned application catalog projection", () => {
  it("projects resource counts from the draft package without exposing resource identities", () => {
    const row = { ...draft, development_dependencies: {
      plugins: [{ id, name: "Private plugin" }], skills: [{ id: nextId, name: "Private skill" }],
      knowledge_bases: [{ id, name: "Private knowledge" }], mcp_servers: [{ id, name: "Private MCP" }],
    } };
    const page = projectApplicationCatalogPage([row], [], 100);
    expect(page.items[0]?.development).toMatchObject({ capability_count: 2, knowledge_base_count: 1, mcp_server_count: 1 });
    expect(JSON.stringify(page)).not.toContain("Private");
  });
  it("searches draft descriptions and paginates developing apps using the same draft modification timestamp as their sort order", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const cursor = Buffer.from(JSON.stringify({ at: draft.sort_timestamp, key: draft.key })).toString("base64url");
    await readOwnedApplicationCatalog(db as unknown as PrismaClient, owner, { state: "developing", search: "Draft description", limit: 1, cursor });
    const sql = db.$queryRaw.mock.calls[0]?.[0];
    expect(sql.text).toContain("coalesce(development_description, '')");
    expect(sql.text).toContain("to_char(development_updated_at AT TIME ZONE");
    expect(sql.text).toContain("AND (development_updated_at, key) <");
    expect(sql.text).toContain("ORDER BY development_updated_at DESC, key DESC");
    expect(sql.values).toContain(draft.sort_timestamp);
    expect(sql.values).toContain(draft.key);
    expect(sql.values).toContain("Draft description");
  });
  it("projects a draft's current icon and description without exposing its storage key", () => {
    const page = projectApplicationCatalogPage([{ ...draft, development_description: "Draft description", development_icon_preset: "book-open", development_icon_object_key: "private/storage/key" }], [], 100, new Map([[id, { type: "custom", url: "https://icons.example.test/logo.png", fallback_preset: "book-open" }]]));
    expect(page.items[0]).toMatchObject({ type: "development", development: { description: "Draft description", icon: { type: "custom", url: "https://icons.example.test/logo.png" } } });
    expect(JSON.stringify(page)).not.toContain("private/storage/key");
  });
  it("keeps a draft in the catalog after its development conversation is deleted", async () => {
    const detached = { ...draft, conversation_id: null };
    const db = { $queryRaw: vi.fn().mockResolvedValue([detached]) };
    const rows = await readOwnedApplicationCatalog(db as unknown as PrismaClient, owner, { state: "developing", limit: 100 });
    expect(projectApplicationCatalogPage(rows, [], 100).items).toEqual([
      { type: "development", development: { id, conversation_id: null, name: "Draft", capability_count: 0, knowledge_base_count: 0, mcp_server_count: 0, has_changes: true, updated_at: "2026-09-17T00:00:00.000Z" } },
    ]);
    expect(db.$queryRaw.mock.calls[0]?.[0].text).not.toContain("FROM conversations");
  });
  it("exposes a draft before any preview package exists and paginates without losing timestamp precision", () => {
    const page = projectApplicationCatalogPage([draft, { ...draft, key: `development:${nextId}`, development_id: nextId }], [], 1);
    expect(page.items).toEqual([{ type: "development", development: {
      id, conversation_id: conversationId, name: "Draft", capability_count: 0, knowledge_base_count: 0, mcp_server_count: 0, has_changes: true,
      updated_at: "2026-09-17T00:00:00.000Z",
    } }]);
    expect(JSON.parse(Buffer.from(page.next_cursor!, "base64url").toString())).toEqual({ at: draft.sort_timestamp, key: draft.key });
    expect(projectApplicationCatalogPage([draft], [], 1).next_cursor).toBeNull();
  });

  it("does not expose a concurrently removed installed application as a draft", () => {
    const page = projectApplicationCatalogPage([{ ...draft, key: `application:${id}`, application_id: id }], [], 100);
    expect(page).toEqual({ items: [], next_cursor: null });
  });

  it.each(["not-json", Buffer.from(JSON.stringify({ at: "yesterday", key: draft.key })).toString("base64url"), Buffer.from(JSON.stringify({ at: draft.sort_timestamp, key: "other:private" })).toString("base64url")])("rejects invalid cursors before accessing the database: %s", async cursor => {
    const db = { $queryRaw: vi.fn() };
    await expect(readOwnedApplicationCatalog(db as unknown as PrismaClient, owner, { state: "all", limit: 10, cursor })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(["standard", "interactive"] as const)("filters %s entries in SQL before paginating while retaining owner and preview boundaries", async state => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await readOwnedApplicationCatalog(db as unknown as PrismaClient, owner, { state, search: "Report", limit: 10 });
    const sql = db.$queryRaw.mock.calls[0]?.[0];
    expect(sql.text).toContain("a.kind");
    expect(sql.text).toContain("'interactive'::text");
    expect(sql.text).toMatch(/AND kind = \$\d+/u);
    expect(sql.values).toContain(state);
    expect(sql.text.indexOf("AND kind =")).toBeLessThan(sql.text.indexOf("ORDER BY"));
    expect(sql.text).toContain("a.development_only = false");
    expect(sql.text).toContain("a.owner_id =");
    expect(sql.text).toContain("d.owner_id =");
    expect(sql.text).not.toContain("AND has_changes = true");
    expect(sql.values).toContain(owner);
    expect(sql.values).toContain("Report");
    expect(sql.values.at(-1)).toBe(11);
  });

  it("binds owner and literal search as SQL parameters and validates database results", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([draft]) };
    const query = { state: "developing" as const, limit: 10, search: "O'Reilly%" };
    await expect(readOwnedApplicationCatalog(db as unknown as PrismaClient, owner, query)).resolves.toEqual([draft]);
    const sql = db.$queryRaw.mock.calls[0]?.[0];
    expect(sql.values).toContain(owner);
    expect(sql.values).toContain(query.search);
    expect(sql.text).not.toContain(query.search);
    db.$queryRaw.mockResolvedValueOnce([{ ...draft, conversation_id: "private" }]);
    await expect(readOwnedApplicationCatalog(db as unknown as PrismaClient, owner, query)).rejects.toThrow();
  });
});
