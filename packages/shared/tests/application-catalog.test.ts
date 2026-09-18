import { describe, expect, it } from "vitest";
import { applicationCatalogQuerySchema, applicationCatalogPageSchema, applicationDevelopmentSummarySchema } from "../src/application-catalog.js";

describe("application catalog contracts", () => {
  it("requires bounded draft resource counts independent of published application metadata", () => {
    const draft = { id: "20000000-0000-4000-8000-000000000001", conversation_id: null, name: "Draft", capability_count: 2, knowledge_base_count: 1, mcp_server_count: 0, has_changes: true, updated_at: "2026-09-17T00:00:00Z" };
    expect(applicationDevelopmentSummarySchema.parse(draft)).toEqual(draft);
    for (const invalid of [undefined, -1, 1.5, 51]) expect(applicationDevelopmentSummarySchema.safeParse({ ...draft, capability_count: invalid }).success).toBe(false);
    expect(applicationDevelopmentSummarySchema.safeParse({ ...draft, mcp_server_count: 21 }).success).toBe(false);
    expect(applicationDevelopmentSummarySchema.safeParse({ ...draft, knowledge_base_count: 21 }).success).toBe(false);
  });
  it("defaults to all applications and supports combined search and development filtering", () => {
    expect(applicationCatalogQuerySchema.parse({})).toEqual({ state: "all", limit: 100 });
    expect(applicationCatalogQuerySchema.parse({ state: "developing", search: " Draft ", limit: "10" })).toEqual({ state: "developing", search: "Draft", limit: 10 });
  });
  it.each(["standard", "interactive"])("accepts the %s type filter with search and pagination", state => {
    expect(applicationCatalogQuerySchema.parse({ state, search: " report ", cursor: "next-page", limit: "10" })).toEqual({ state, search: "report", cursor: "next-page", limit: 10 });
  });
  it.each([{ owner_id: "other" }, { state: "shared" }, { limit: 201 }, { cursor: "" }])("rejects invalid filters and identities: %o", input => {
    expect(applicationCatalogQuerySchema.safeParse(input).success).toBe(false);
  });
  it("represents a draft without manufacturing installed application fields", () => {
    const development = { id: "20000000-0000-4000-8000-000000000001", conversation_id: "30000000-0000-4000-8000-000000000001", name: "Draft", capability_count: 2, knowledge_base_count: 1, mcp_server_count: 3, has_changes: true, updated_at: "2026-09-17T00:00:00Z" };
    expect(applicationCatalogPageSchema.parse({ items: [{ type: "development", development }], next_cursor: null }).items).toEqual([{ type: "development", development }]);
    expect(applicationCatalogPageSchema.safeParse({ items: [{ type: "application", development }], next_cursor: null }).success).toBe(false);
  });
});
