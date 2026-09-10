import { describe, expect, it } from "vitest";
import { taskCategoryInputSchema, taskCategorySchema, taskCategoryOrderSchema } from "./task-categories.js";
import { conversationOrderUpdateSchema } from "./conversations.js";

describe("task category contracts", () => {
  it("accepts a complete ordered list and rejects duplicates, invalid IDs, and ownership injection", () => {
    const first = "10000000-0000-4000-8000-000000000001";
    const second = "10000000-0000-4000-8000-000000000002";
    expect(taskCategoryOrderSchema.parse({ category_ids: [second, first] })).toEqual({ category_ids: [second, first] });
    for (const input of [
      { category_ids: [] }, { category_ids: [first] },
      { category_ids: [first, first] }, { category_ids: [first, "bad"] },
      { category_ids: [second, first], owner_id: first },
      { category_ids: Array.from({ length: 10_001 }, () => first) },
    ]) expect(taskCategoryOrderSchema.safeParse(input).success).toBe(false);
  });
  it("normalizes names and rejects empty, oversized, and unexpected input", () => {
    expect(taskCategoryInputSchema.parse({ name: " 工作 " })).toEqual({ name: "工作" });
    for (const input of [{ name: " " }, { name: "x".repeat(81) }, { name: "Work", owner_id: "other" }]) {
      expect(taskCategoryInputSchema.safeParse(input).success).toBe(false);
    }
    expect(taskCategoryInputSchema.safeParse({ name: "x".repeat(80) }).success).toBe(true);
  });
  it("validates IDs at public category and reorder boundaries", () => {
    expect(taskCategorySchema.safeParse({ id: "bad", name: "Work" }).success).toBe(false);
    expect(conversationOrderUpdateSchema.safeParse({ group: "recent", category_id: "bad", conversation_ids: [] }).success).toBe(false);
  });
});
