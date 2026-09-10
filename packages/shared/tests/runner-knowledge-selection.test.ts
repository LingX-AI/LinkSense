import { describe, expect, it } from "vitest";
import { runnerKnowledgeBaseSelectionSchema } from "../src/runner.js";

const id = "10000000-0000-4000-8000-000000000001";
describe("runner knowledge selection boundary", () => {
  it("accepts empty selections, unavailable entries and localized names", () => {
    for (const selection of [[], [{ id, name: null }], [{ id, name: "政策资料" }], [{ id, name: "Policy library" }]]) {
      expect(runnerKnowledgeBaseSelectionSchema.parse(selection)).toEqual(selection);
    }
  });
  it("rejects duplicates, invalid IDs, missing names and unexpected properties", () => {
    for (const selection of [
      [{ id, name: "a" }, { id, name: "b" }], [{ id: "bad", name: "a" }],
      [{ id }], [{ id, name: "" }], [{ id, name: "a".repeat(161) }],
      [{ id, name: "a", instructions: "untrusted" }],
    ]) expect(runnerKnowledgeBaseSelectionSchema.safeParse(selection).success).toBe(false);
  });
});
