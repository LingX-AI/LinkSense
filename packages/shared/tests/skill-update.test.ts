import { describe, expect, it } from "vitest";
import { skillEditDetailSchema, skillEditInputSchema, skillUpdatePreviewSchema } from "../src/skill-update.js";

const input = { base_revision: "a".repeat(64), display_name: "报告助手", description: "说明", content: "# Instructions\n" };

describe("skill update contracts", () => {
  it("normalizes optional metadata without trimming the instructions", () => {
    expect(skillEditInputSchema.parse({ ...input, display_name: " ", description: " ", content: "\n# Instructions\n\n" })).toEqual({ ...input, display_name: null, description: null, content: "\n# Instructions\n\n" });
  });
  it.each([
    { base_revision: "bad" }, { base_revision: undefined }, { name: "renamed" },
    { content: "  \n" }, { content: "x".repeat(1_000_001) }, { display_name: "x".repeat(65) },
  ])("rejects invalid changes (case %#)", (changes) => {
    expect(skillEditInputSchema.safeParse({ ...input, ...changes }).success).toBe(false);
  });
  it("supports a complete file listing even when the body cannot be edited online", () => {
    expect(skillEditDetailSchema.parse({ name: "reports", display_name: null, description: null, content: null, revision: input.base_revision, files: [{ path: "scripts/report.py", size_bytes: 100 }] }).content).toBeNull();
  });
  it("requires a revision and bounded file changes for update previews", () => {
    expect(skillUpdatePreviewSchema.safeParse({ mode: "replace", base_revision: input.base_revision, changes: { added: [], modified: ["SKILL.md"], deleted: ["assets/template.txt"], unchanged_count: 0 } }).success).toBe(true);
    expect(skillUpdatePreviewSchema.safeParse({ mode: "replace", changes: { deleted: [] } }).success).toBe(false);
  });
});
