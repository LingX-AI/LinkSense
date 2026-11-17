import { describe, expect, it } from "vitest";
import { testConfig } from "./test-config.js";
import { backendFixture } from "./web-site-backends.fixture.js";
import { WebSiteBackendService, appHostLabel } from "../src/modules/web-site-backends/service.js";

describe("optional dynamic application configuration", () => {
  it("preserves installations without Appwrite", () => {
    expect(testConfig().appwrite).toBeNull();
    expect(testConfig({ LINKSENSE_APPWRITE_ORGANIZATION_ID: "retained-setting" }).appwrite).toBeNull();
    expect(testConfig({ LINKSENSE_APPWRITE_ENDPOINT: "", LINKSENSE_DYNAMIC_APPS_BASE_URL: "" }).appwrite).toBeNull();
  });
  it("rejects partially configured, credential-bearing and unsafe application origins", () => {
    expect(() => testConfig({ LINKSENSE_APPWRITE_ENDPOINT: "https://backend.example.test/v1" })).toThrow();
    const valid = {
      LINKSENSE_APPWRITE_ENDPOINT: "https://backend.example.test/v1",
      LINKSENSE_APPWRITE_ADMIN_EMAIL: "operator@example.test",
      LINKSENSE_APPWRITE_ADMIN_PASSWORD: "test-operator-password",
      LINKSENSE_DYNAMIC_APPS_BASE_URL: "https://apps.example.test",
    };
    for (const value of ["https://operator:password@apps.example.test", "https://apps.example.test/path", "http://apps.example.test", "https://127.0.0.1"]) {
      expect(() => testConfig({ ...valid, LINKSENSE_DYNAMIC_APPS_BASE_URL: value })).toThrow();
    }
    expect(() => testConfig({ ...valid, LINKSENSE_APPWRITE_ENDPOINT: "https://operator:password@backend.example.test/v1" })).toThrow();
  });
  it("compares parsed hosts and prevents namespace spoofing and platform exposure", () => {
    const { service } = backendFixture();
    const id = "60000000-0000-4000-8000-000000000001";
    expect(service.matchHost(`${appHostLabel(id)}.apps.example.net:443`)).toBe(appHostLabel(id));
    expect(service.matchHost(`${id}.apps.example.net:443`)).toBeUndefined();
    expect(service.matchHost(`${appHostLabel(id)}.apps.example.net.evil.test`)).toBeUndefined();
    expect(service.matchHost(`${appHostLabel(id)}.apps.example.net:444`)).toBeUndefined();
    expect(service.isAppHost(`not-a-backend.apps.example.net`)).toBe(true);
    expect(service.isAppHost(`not-a-backend.apps.example.net.evil.test`)).toBe(false);
  });

  it.each([
    ["https://apps.example.test", "https://linksense.example.test", "https://backend.internal/v1"],
    ["https://apps.example.net", "https://linksense.example.test", "https://backend.example.net/v1"],
    ["https://apps.product.co.uk", "https://console.product.co.uk", "https://backend.internal/v1"],
  ])("rejects shared cookie domains between applications and trusted services: %s", (appsBaseUrl, publicBaseUrl, endpoint) => {
    const fixture = backendFixture();
    expect(() => new WebSiteBackendService(fixture.store, fixture.site.storage, {
      ...fixture.config, publicBaseUrl,
      appwrite: { ...fixture.config.appwrite!, appsBaseUrl, endpoint },
    })).toThrow("separate registrable domains");
  });

  it("accepts independent registrable domains under the same multi-label public suffix", () => {
    const fixture = backendFixture();
    expect(() => new WebSiteBackendService(fixture.store, fixture.site.storage, {
      ...fixture.config, publicBaseUrl: "https://console.business.co.uk",
      appwrite: { ...fixture.config.appwrite!, appsBaseUrl: "https://apps.product.co.uk", endpoint: "http://backend.internal/v1" },
    })).not.toThrow();
  });
});
