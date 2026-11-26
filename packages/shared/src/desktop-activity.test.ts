import { describe, expect, it } from "vitest";

import {
  desktopActivityItemSchema,
  desktopActivityLimit,
  desktopActivityListSchema,
} from "./desktop-activity.js";

const item = {
  id: "2b8f4c3a-7d1e-4a9b-8c2d-5e6f7a8b9c0d",
  created_at: "2026-11-26T08:00:00.000Z",
  action: "desktop_approval_responded",
  result: "success",
  delivery: "confirmed",
  approval_decision: "accept",
} as const;

describe("desktop activity response contract", () => {
  it("accepts the bounded projection and no extra raw audit fields", () => {
    expect(
      desktopActivityListSchema.parse({ items: [item] }).items,
    ).toEqual([item]);
    for (const extra of [
      { target_id: "secret" },
      { actor_id: "secret" },
      { metadata: { command: "secret" } },
      { ip_address: "192.0.2.10" },
    ]) {
      expect(
        desktopActivityItemSchema.safeParse({ ...item, ...extra }).success,
      ).toBe(false);
    }
  });

  it("rejects an unbounded page and an unknown action or decision", () => {
    expect(
      desktopActivityListSchema.safeParse({
        items: Array.from({ length: desktopActivityLimit + 1 }, () => item),
      }).success,
    ).toBe(false);
    expect(
      desktopActivityItemSchema.safeParse({
        ...item,
        action: "browser_navigated",
      }).success,
    ).toBe(false);
    expect(
      desktopActivityItemSchema.safeParse({
        ...item,
        approval_decision: "approve",
      }).success,
    ).toBe(false);
  });
});
