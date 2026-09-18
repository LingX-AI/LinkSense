import { describe, expect, it } from "vitest";
import { webBundleManifestSchema, webBundlePathSchema, webSiteCreateSchema, webSiteSlugSchema, webSiteUpdateSchema } from "../src/web-sites.js";

describe("website contracts", () => {
  it("normalizes readable slugs and accepts UUID addresses", () => {
    expect(webSiteSlugSchema.parse(" My-Page ")).toBe("my-page");
    expect(webSiteSlugSchema.safeParse("10000000-0000-4000-8000-000000000001").success).toBe(true);
  });
  it.each(["a", "../admin", "name/path", "name?query", "a--b", "-abc", "abc-", "a".repeat(81)])("rejects malformed slug %s", slug => {
    expect(webSiteSlugSchema.safeParse(slug).success).toBe(false);
  });
  it.each(["../secret", "/etc/passwd", "a/../secret", ".env", "node_modules/app.js", "a\\b", "a%2fb", "a?b", "a#b", "a\u0000b"])("rejects unsafe package paths %s", path => {
    expect(webBundlePathSchema.safeParse(path).success).toBe(false);
  });
  it("accepts nested and non-English resource names", () => {
    expect(webBundlePathSchema.parse("images/山海 图.png")).toBe("images/山海 图.png");
  });
  it("rejects privilege fields and empty updates", () => {
    expect(webSiteUpdateSchema.safeParse({}).success).toBe(false);
    expect(webSiteUpdateSchema.safeParse({ owner_id: "another-owner" }).success).toBe(false);
    expect(webSiteCreateSchema.safeParse({ conversation_id: "10000000-0000-4000-8000-000000000001", file_id: "20000000-0000-4000-8000-000000000001", name: "Page", owner_id: "another-owner" }).success).toBe(false);
  });
  it("requires a unique complete manifest with a present entry and bounded total size", () => {
    const file = { path: "index.html", object_key: "objects/index.html", mime_type: "text/html", size_bytes: 10, checksum_sha256: "a".repeat(64) };
    expect(webBundleManifestSchema.safeParse({ entry_path: "index.html", files: [file] }).success).toBe(true);
    expect(webBundleManifestSchema.safeParse({ entry_path: "missing.html", files: [file] }).success).toBe(false);
    expect(webBundleManifestSchema.safeParse({ entry_path: "index.html", files: [file, file] }).success).toBe(false);
    expect(webBundleManifestSchema.safeParse({ entry_path: "index.html", files: [file, ...[1, 2, 3].map(i => ({ ...file, path: `${i}.html`, size_bytes: 20 * 1024 * 1024 }))] }).success).toBe(false);
  });
});
