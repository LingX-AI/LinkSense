import { describe, expect, it } from "vitest";
import { applicationDevelopmentSchema, applicationDevelopmentSummarySchema, applicationDevelopmentCapabilitiesUpdateSchema, applicationDevelopmentMetadataUpdateSchema } from "../src/index.js";
import { applicationBuilderRequestSchema, applicationDevelopmentInstallSchema, applicationSourceDirectorySchema, builtInSkillNames, APPLICATION_BUILDER_SKILL_NAME, sanitizeApplicationDevelopmentDiagnostic } from "../src/index.js";

describe("application development contracts", () => {
  it("defaults development icons to the cube preset and preserves saved icon choices", () => {
    expect(applicationDevelopmentSchema.shape.icon.parse(undefined)).toEqual({ type: "preset", preset: "bot" });
    const saved = { type: "preset", preset: "sparkles" };
    expect(applicationDevelopmentSchema.shape.icon.parse(saved)).toEqual(saved);
  });
  it("validates bounded metadata edits with optional fields and reviewed source hash", () => {
    const schema = applicationDevelopmentMetadataUpdateSchema;
    const base = { source_hash: "a".repeat(64), name: " Example ", description: " Description " };
    expect(schema.parse(base)).toEqual({ ...base, name: "Example", description: "Description" });
    expect(schema.parse({ ...base, description: null }).description).toBeNull();
    expect(schema.parse({ source_hash: base.source_hash, icon: { type: "preset", preset: "book-open" } })).toEqual({ source_hash: base.source_hash, icon: { type: "preset", preset: "book-open" } });
    expect(schema.parse({ source_hash: base.source_hash, name: "Rename" })).toEqual({ source_hash: base.source_hash, name: "Rename" });
    for (const input of [
      { ...base, name: " " }, { ...base, name: "a".repeat(161) },
      { ...base, description: "a".repeat(4001) }, { source_hash: base.source_hash },
      { ...base, source_hash: "invalid" }, { ...base, source_hash: undefined },
      { ...base, owner_id: "other" }, { ...base, permissions: ["tasks:write"] },
    ]) expect(schema.safeParse(input).success).toBe(false);
  });
  it("validates capability replacements, including explicit clearing, source hashes, duplicates and limits", () => {
    const schema = applicationDevelopmentCapabilitiesUpdateSchema;
    const base = { source_hash: "a".repeat(64), dependencies: {} };
    expect(schema.parse(base).dependencies).toEqual({ plugins: [], skills: [], knowledge_bases: [], mcp_servers: [] });
    const resource = { id: "10000000-0000-4000-8000-000000000001", name: "Plugin" };
    const resources = Array.from({ length: 51 }, (_, index) => ({ ...resource, id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    for (const dependencies of [
      { plugins: [resource, resource] }, { plugins: [resource], skills: [resource] },
      { plugins: resources.slice(0, 50), skills: resources.slice(50) },
      { knowledge_bases: resources.slice(0, 21) }, { mcp_servers: resources.slice(0, 21) },
      { plugins: [{ ...resource, id: "../not-a-resource" }] },
      { plugins: [{ ...resource, credential: "not-allowed" }] },
    ]) expect(schema.safeParse({ ...base, dependencies }).success).toBe(false);
    expect(schema.safeParse({ ...base, owner_id: resource.id }).success).toBe(false);
    expect(schema.safeParse({ dependencies: {} }).success).toBe(false);
  });
  it("accepts an explicitly detached conversation while preserving the existing required field and UUID validation", () => {
    for (const schema of [applicationDevelopmentSchema, applicationDevelopmentSummarySchema]) {
      expect(schema.shape.conversation_id.parse(null)).toBeNull();
      expect(schema.shape.conversation_id.parse("10000000-0000-4000-8000-000000000001")).toBe("10000000-0000-4000-8000-000000000001");
      expect(schema.shape.conversation_id.safeParse(undefined).success).toBe(false);
      expect(schema.shape.conversation_id.safeParse("invalid").success).toBe(false);
    }
  });
  it("removes private URLs, credentials and server paths before displaying or storing diagnostics", () => {
    expect(sanitizeApplicationDevelopmentDiagnostic({ message: "token=private Bearer hidden /home/private/app https://example.test/private", file: "https://example.test/private-ticket/app.js?token=private", line: 2 })).toEqual({ message: "token=[redacted] Bearer [redacted] [path] [resource]", file: "app.js", line: 2 });
    expect(sanitizeApplicationDevelopmentDiagnostic({ message: "Error", file: "", line: 0 })).toEqual({ message: "Error", file: "", line: 0 });
  });
  it("reserves the built-in builder and accepts only scoped open/inspect operations", () => {
    expect(builtInSkillNames).toContain(APPLICATION_BUILDER_SKILL_NAME);
    expect(applicationBuilderRequestSchema.parse({ operation: "open", name: " App " })).toEqual({ operation: "open", name: "App" });
    for (const input of [{ operation: "install" }, { operation: "inspect", conversation_id: "other" }, { operation: "open", name: "" }]) expect(applicationBuilderRequestSchema.safeParse(input).success).toBe(false);
  });
  it.each(["/absolute", "../outside", "app/../outside", "app\\outside", "app//empty", ".private", "app/."])("rejects unsafe directory %s", path => {
    expect(applicationSourceDirectorySchema.safeParse(path).success).toBe(false);
  });
  it("requires both the reviewed source digest and a strict release version for installation", () => {
    expect(applicationDevelopmentInstallSchema.safeParse({ source_hash: "a".repeat(64), version_number: "1.0.0" }).success).toBe(true);
    for (const input of [{}, { source_hash: "a".repeat(64) }, { source_hash: "a".repeat(64), version_number: "1.0.0+build.1" }, { source_hash: "a" }, { source_hash: "a".repeat(64), skip_validation: true }]) expect(applicationDevelopmentInstallSchema.safeParse(input).success).toBe(false);
  });
});
