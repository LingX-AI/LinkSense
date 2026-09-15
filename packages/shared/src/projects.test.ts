import { describe, expect, it } from "vitest";
import { projectInputSchema, projectSchema, projectOrderSchema } from "./projects.js";
import { conversationOrderUpdateSchema } from "./conversations.js";

describe("task category contracts", () => {
  it("accepts a complete ordered list and rejects duplicates, invalid IDs, and ownership injection", () => {
    const first = "10000000-0000-4000-8000-000000000001";
    const second = "10000000-0000-4000-8000-000000000002";
    expect(projectOrderSchema.parse({ project_ids: [second, first] })).toEqual({ project_ids: [second, first] });
    for (const input of [
      { project_ids: [] }, { project_ids: [first] },
      { project_ids: [first, first] }, { project_ids: [first, "bad"] },
      { project_ids: [second, first], owner_id: first },
      { project_ids: Array.from({ length: 10_001 }, () => first) },
    ]) expect(projectOrderSchema.safeParse(input).success).toBe(false);
  });
  it("normalizes names and rejects empty, oversized, and unexpected input", () => {
    expect(projectInputSchema.parse({ name: " 工作 " })).toEqual({ name: "工作" });
    for (const input of [{ name: " " }, { name: "x".repeat(81) }, { name: "Work", owner_id: "other" }]) {
      expect(projectInputSchema.safeParse(input).success).toBe(false);
    }
    expect(projectInputSchema.safeParse({ name: "x".repeat(80) }).success).toBe(true);
  });
  it("validates IDs at public category and reorder boundaries", () => {
    expect(projectSchema.safeParse({ id: "bad", name: "Work" }).success).toBe(false);
    expect(conversationOrderUpdateSchema.safeParse({ group: "recent", project_id: "bad", conversation_ids: [] }).success).toBe(false);
  });
});
