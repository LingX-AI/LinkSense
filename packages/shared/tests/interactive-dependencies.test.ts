import { describe, expect, it } from "vitest";
import { interactiveApplicationManifestSchema, interactiveDependenciesSchema, interactiveDependencyBindingsSchema, interactiveDependencyOptionsSchema } from "../src/interactive-applications.js";

const id = "aaaaaaaa-0000-4000-8000-000000000001";
const dependency = { id, name: "Research" };

describe("interactive dependency contracts", () => {
  it("validates the resource page cursor and rejects secrets in declaration options", () => {
    expect(interactiveDependencyOptionsSchema.parse({ items: [dependency], next_cursor: id }).next_cursor).toBe(id);
    expect(interactiveDependencyOptionsSchema.parse({ items: [], next_cursor: null }).items).toEqual([]);
    for (const input of [{ items: [], next_cursor: "invalid" }, { items: [{ ...dependency, token: "forbidden" }], next_cursor: null }, { items: Array(101).fill(dependency), next_cursor: id }]) {
      expect(interactiveDependencyOptionsSchema.safeParse(input).success).toBe(false);
    }
  });
  it("parses existing packages with no declarations without changing their instructions", () => {
    const manifest = interactiveApplicationManifestSchema.parse({ schema_version: 1, id: "research", name: "Research", version: "1.0.0", sdk_version: 1, instructions: "Research." });
    expect(manifest.dependencies).toEqual({ plugins: [], skills: [], knowledge_bases: [], mcp_servers: [] });
    expect(manifest.instructions).toBe("Research.");
  });
  it("normalizes UUID case and rejects unknown fields, malformed UUIDs, duplicate and cross-type capability declarations", () => {
    expect(interactiveDependenciesSchema.parse({ skills: [{ ...dependency, id: id.toUpperCase() }] }).skills[0]?.id).toBe(id);
    for (const input of [
      { skills: [{ ...dependency, id: "research" }] },
      { plugins: [dependency], skills: [dependency] },
      { skills: [dependency, { ...dependency, id: id.toUpperCase() }] },
      { skills: [{ ...dependency, credentials: "not-allowed" }] },
      { other: [] },
    ]) expect(interactiveDependenciesSchema.safeParse(input).success).toBe(false);
  });
  it("limits capabilities to 50 combined and knowledge bases / MCP servers to 20 each", () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({ id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`, name: "Resource" }));
    expect(interactiveDependenciesSchema.safeParse({ plugins: entries.slice(0, 25), skills: entries.slice(25) }).success).toBe(false);
    expect(interactiveDependenciesSchema.safeParse({ mcp_servers: entries.slice(0, 21) }).success).toBe(false);
    expect(interactiveDependenciesSchema.safeParse({ knowledge_bases: entries.slice(0, 21) }).success).toBe(false);
  });
  it("allows explicit unmatched bindings without allowing duplicate binding identities", () => {
    const binding = { type: "skill", id, resource_id: null };
    expect(interactiveDependencyBindingsSchema.parse([binding])).toEqual([binding]);
    expect(interactiveDependencyBindingsSchema.safeParse([binding, binding]).success).toBe(false);
  });
});
