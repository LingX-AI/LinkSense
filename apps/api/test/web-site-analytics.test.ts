import { describe, expect, it, vi } from "vitest";
import { WebSiteAnalytics, analyticsDomain } from "../src/modules/web-sites/analytics.js";

const config = { baseUrl: "http://stats.example.test", apiKey: "tt_test_key_1234567890" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

describe("tinytraffic analytics", () => {
  it("reuses an existing site and keeps its dashboard name and public access current", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json([{ id: 7, domain: "site.example.test", aliases: [] }]))
      .mockResolvedValueOnce(json({ id: 7, domain: "site.example.test" }));
    const analytics = new WebSiteAnalytics(config, fetcher);
    await expect(analytics.ensureSite({ name: "My site", domain: "site.example.test" }))
      .resolves.toEqual({ id: 7, domain: "site.example.test" });
    expect(fetcher).toHaveBeenNthCalledWith(1, new URL("/api/v1/sites", config.baseUrl), expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, new URL("/api/v1/sites/7", config.baseUrl), expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "My site", public: true }),
    }));
  });

  it("creates a missing site and resolves a concurrent duplicate", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 9, domain: "new.example.test" }, 201))
      .mockResolvedValueOnce(json({ id: 9, domain: "new.example.test" }));
    const analytics = new WebSiteAnalytics(config, fetcher);
    await expect(analytics.ensureSite({ name: "New", domain: "new.example.test" }))
      .resolves.toEqual({ id: 9, domain: "new.example.test" });
    expect(fetcher).toHaveBeenNthCalledWith(2, new URL("/api/v1/sites", config.baseUrl), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ domain: "new.example.test", timezone: "UTC" }),
    }));

    const duplicate = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ error: "a site already uses this domain" }, 409))
      .mockResolvedValueOnce(json([{ id: 9, domain: "new.example.test", aliases: [] }]))
      .mockResolvedValueOnce(json({ id: 9, domain: "new.example.test" }));
    await expect(new WebSiteAnalytics(config, duplicate).ensureSite({ name: "New", domain: "new.example.test" }))
      .resolves.toEqual({ id: 9, domain: "new.example.test" });
  });

  it("truncates long site names and exposes a public dashboard URL and tracker tag", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json([{ id: 3, domain: "sample.linksense.invalid", aliases: [] }]))
      .mockResolvedValueOnce(json({ id: 3 }));
    const analytics = new WebSiteAnalytics(config, fetcher);
    await analytics.ensureSite({ name: "x".repeat(140), domain: "sample.linksense.invalid" });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ name: "x".repeat(100) });
    expect(analytics.dashboardUrl(3)).toBe("http://stats.example.test/sites/3");
    expect(analytics.scriptTag("sample.linksense.invalid")).toContain('data-domain="sample.linksense.invalid"');
    expect(analytics.scriptTag("sample.linksense.invalid")).toContain('src="http://stats.example.test/js/script.js"');
  });

  it("uses a stable synthetic domain and maps upstream failures to a stable error", async () => {
    expect(analyticsDomain("40000000-0000-4000-8000-000000000001"))
      .toBe("40000000-0000-4000-8000-000000000001.linksense.invalid");
    const analytics = new WebSiteAnalytics(config, vi.fn<typeof fetch>(async () => json({ error: "down" }, 503)));
    await expect(analytics.ensureSite({ name: "Sample", domain: "sample.example.test" }))
      .rejects.toMatchObject({ code: "WEB_SITE_ANALYTICS_UNAVAILABLE" });
    const offline = new WebSiteAnalytics(config, vi.fn<typeof fetch>(async () => { throw new Error("offline"); }));
    await expect(offline.ensureSite({ name: "Sample", domain: "sample.example.test" }))
      .rejects.toMatchObject({ code: "WEB_SITE_ANALYTICS_UNAVAILABLE" });
  });
});
