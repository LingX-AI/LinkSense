import { describe, expect, it } from "vitest";
import { interactiveApplicationTaskStateSchema } from "../src/interactive-applications.js";
const state = { status: "idle", turn_id: null, file_ids: [], can_submit: true, interrupt_requested: false };
describe("interactive task state public contract", () => {
  it.each(interactiveApplicationTaskStateSchema.shape.status.options)("validates the documented %s state", status => {
    expect(interactiveApplicationTaskStateSchema.parse({ ...state, status }).status).toBe(status);
  });
  it("rejects invalid IDs, private fields and unsupported execution states", () => {
    for (const extra of [{ turn_id: "invalid" }, { file_ids: ["invalid"] }, { prompt: "private" }, { storage_path: "/private" }, { status: "retrying" }]) {
      expect(interactiveApplicationTaskStateSchema.safeParse({ ...state, ...extra }).success).toBe(false);
    }
  });
});
