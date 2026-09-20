import { describe, expect, it } from "vitest";
import { personalQuotaQuerySchema, personalQuotaOverviewSchema } from "../src/personal-quota.js";

describe("personal quota contracts", () => {
  it("defaults to seven days and forbids requesting another user's data", () => {
    expect(personalQuotaQuerySchema.parse({})).toEqual({ range: "7d", time_zone: "UTC" });
    expect(personalQuotaQuerySchema.safeParse({ owner_id: "someone-else" }).success).toBe(false);
    expect(personalQuotaQuerySchema.safeParse({ range: "monthly" }).success).toBe(false);
  });
  it("allows unlimited quotas with nonzero consumption and preserves six decimal places", () => {
    expect(personalQuotaOverviewSchema.parse({ limit: null, remaining: null, used: "0.000001", time_zone: "Asia/Shanghai", reset_at: "2026-09-20T16:00:00Z" }).used).toBe("0.000001");
  });
});
