import { describe, expect, it } from "vitest";
import { htmlPreviewOpenSchema, htmlPreviewSourceSchema, interactiveHtmlPreviewSandbox } from "../src/html-preview.js";
import { htmlPreviewShellDocument } from "../src/html-preview-shell-document.js";

describe("HTML preview contracts", () => {
  it("accepts only bounded scoped sessions and rejects external or malformed entry responses", () => {
    const source = { session_id: "a".repeat(64), entry_url: `/html-preview/${"a".repeat(64)}/index.html`, html: "<h1>Hello</h1>", expires_at: "2026-10-29T10:00:00.000Z", missing_resources: [] };
    expect(htmlPreviewSourceSchema.safeParse(source).success).toBe(true);
    expect(htmlPreviewSourceSchema.safeParse({ ...source, entry_url: "https://example.test/" }).success).toBe(false);
    expect(htmlPreviewSourceSchema.safeParse({ ...source, missing_resources: Array(51).fill("missing.css") }).success).toBe(false);
    expect(htmlPreviewOpenSchema.safeParse({ session_id: "../private" }).success).toBe(false);
    expect(htmlPreviewOpenSchema.safeParse({ file_id: "other" }).success).toBe(false);
  });
  it("keeps scripts enabled within the existing opaque-origin boundary and authenticates shell initialization", () => {
    expect(interactiveHtmlPreviewSandbox.split(" ")).toContain("allow-scripts");
    expect(interactiveHtmlPreviewSandbox.split(" ")).not.toContain("allow-same-origin");
    expect(htmlPreviewShellDocument).toContain("event.source !== parent");
    expect(htmlPreviewShellDocument).toContain("event.origin !== window.location.origin");
    expect(htmlPreviewShellDocument).toContain("message.previewId !== previewId");
  });
});
