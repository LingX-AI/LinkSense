import { describe, expect, it } from "vitest";
import {
  updateWebSearchSettingsSchema, webSearchEndpointSchema,
  webSearchProviderDefinitions, webSearchProviders, webSearchRequestSchema,
  webSearchSettingsSchema, webSearchSuccessSchema,
} from "../src/web-search.js";

const settings = {
  expected_revision: 0, enabled: true, provider: "deepseek", base_url: null,
  search_engine_id: null, default_max_results: 5, timeout_ms: 15_000,
};
describe("web search contracts", () => {
  it("defines one endpoint descriptor for every supported provider", () => {
    expect(webSearchProviderDefinitions.map((value) => value.key)).toEqual(webSearchProviders);
  });
  it("preserves a saved credential when omitted and explicitly accepts clearing it", () => {
    expect(updateWebSearchSettingsSchema.parse(settings)).not.toHaveProperty("api_key");
    expect(updateWebSearchSettingsSchema.parse({ ...settings, api_key: null }).api_key).toBeNull();
    expect(webSearchSettingsSchema.safeParse({ ...settings, revision: 0, api_key_configured: false, api_key: "secret" }).success).toBe(false);
  });
  it.each(["invalid-url", "http://example.com/search", "https://user:password@example.com/search", "https://example.com/search?api_key=secret", "https://example.com:8080/search", "https://example.com/search#fragment"])("rejects unsafe service address %s", (endpoint) => {
    expect(webSearchEndpointSchema.safeParse(endpoint).success).toBe(false);
  });
  it("requires provider-specific configuration before enabling", () => {
    for (const value of [{ provider: null }, { provider: "google" }, { provider: "searxng" }]) {
      expect(updateWebSearchSettingsSchema.safeParse({ ...settings, ...value }).success).toBe(false);
    }
    expect(updateWebSearchSettingsSchema.safeParse({ ...settings, provider: "google", search_engine_id: "engine" }).success).toBe(true);
  });
  it("bounds queries and result counts and excludes caller-provided credentials or endpoints", () => {
    expect(webSearchRequestSchema.parse({ query: "  search  " }).query).toBe("search");
    expect(webSearchRequestSchema.parse({ query: "🌍".repeat(128) }).query).toBe("🌍".repeat(128));
    for (const value of [{ query: " " }, { query: "x".repeat(129) }, { query: "test", max_results: 21 }, { query: "test", api_key: "secret" }, { query: "test", base_url: "https://example.com" }]) {
      expect(webSearchRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  it("accepts empty results and rejects executable source links", () => {
    expect(webSearchSuccessSchema.parse({ success: true, provider: "deepseek", query: "test", results: [] }).results).toEqual([]);
    expect(webSearchSuccessSchema.safeParse({ success: true, provider: "deepseek", query: "test", results: [{ title: "test", url: "javascript:alert(1)", snippet: "", summary: null, published_at: null }] }).success).toBe(false);
    expect(webSearchSuccessSchema.safeParse({ success: true, provider: "deepseek", query: "test", results: [{ title: "test", url: "invalid-url", snippet: "", summary: null, published_at: null }] }).success).toBe(false);
  });
});
