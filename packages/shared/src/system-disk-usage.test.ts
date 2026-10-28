import { describe, expect, it } from "vitest";
import { diskUsageSchema, unavailableDiskUsage } from "./system-disk-usage.js";

describe("disk usage contract", () => {
  const usage = {
    status: "available",
    checked_at: "2026-10-28T08:00:00.000Z",
    total_bytes: 4096,
    refreshing: false,
    categories: [{ key: "user_data", status: "available", used_bytes: 4096 }],
  };
  it("accepts complete samples and an explicit unavailable result", () => {
    expect(diskUsageSchema.parse(usage)).toEqual(usage);
    expect(
      diskUsageSchema.parse(unavailableDiskUsage()).total_bytes,
    ).toBeNull();
  });
  it.each([
    { ...usage, total_bytes: -1 },
    { ...usage, total_bytes: 1.5 },
    { ...usage, total_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...usage, total_bytes: 8192 },
    { ...usage, status: "collecting" },
    {
      ...usage,
      categories: [{ key: "user_data", status: "available", used_bytes: null }],
      total_bytes: 0,
    },
    {
      ...usage,
      categories: [
        { key: "user_data", status: "not_present", used_bytes: 4096 },
      ],
    },
    { ...usage, categories: [...usage.categories, ...usage.categories] },
    {
      ...usage,
      categories: [
        { key: "user_data", status: "unavailable", used_bytes: null },
      ],
      total_bytes: 0,
    },
    { ...usage, internal_path: "/private/storage" },
  ])(
    "rejects invalid totals, duplicate categories and private fields",
    (input) => {
      expect(diskUsageSchema.safeParse(input).success).toBe(false);
    },
  );
  it("retains a known subtotal while clearly identifying missing storage", () => {
    expect(
      diskUsageSchema.parse({
        ...usage,
        status: "partial",
        categories: [
          ...usage.categories,
          { key: "images", status: "unavailable", used_bytes: null },
        ],
      }).status,
    ).toBe("partial");
  });
});
