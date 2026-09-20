import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260910100000_replace_token_quotas_with_credits/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const removeMonthlyLimitsSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260920120000_remove_monthly_credit_limits/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const simplifyLimitsSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260920130000_simplify_credit_limits/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("credit quota migration", () => {
  it("adds a nullable internal reset boundary without deleting or rewriting history", () => {
    const resetSql = readFileSync(
      new URL(
        "../../../prisma/migrations/20260910110000_add_credit_quota_reset_at/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(resetSql).toContain(
      'ADD COLUMN "credit_quota_reset_at" timestamptz(6)',
    );
    expect(schema).toContain(
      '@map("credit_quota_reset_at") @db.Timestamptz(6)',
    );
    expect(resetSql).not.toMatch(
      /\b(?:DROP|DELETE|TRUNCATE|UPDATE|NOT NULL|REFERENCES)\b/iu,
    );
  });

  it("removes all old personal limit columns and creates bounded credit columns", () => {
    for (const period of ["total", "weekly", "monthly"]) {
      expect(sql).toContain(`DROP COLUMN "${period}_token_limit"`);
      expect(sql).toContain(
        `ADD COLUMN "${period}_credit_limit_micros" bigint`,
      );
      expect(schema).not.toContain(`@map("${period}_token_limit")`);
      expect(sql).toContain(`"${period}_credit_limit_micros" > 0`);
    }
    expect(sql).toContain("{self_registration,total_token_limit}");
  });
  it("starts historical credit consumption at zero while preserving token and cost facts", () => {
    expect(
      sql.match(/ADD COLUMN "used_credit_micros" bigint NOT NULL DEFAULT 0/gu),
    ).toHaveLength(2);
    expect(sql.match(/"credit_price_micros_cny" > 0/gu)).toHaveLength(2);
    expect(sql).not.toMatch(
      /\b(?:TRUNCATE|DELETE FROM|DROP TABLE|REFERENCES)\b/iu,
    );
    expect(sql).not.toMatch(/SET\s+"used_credit_micros"\s*=/iu);
  });

  it("preserves the already-applied monthly-limit migration exactly", () => {
    expect(
      createHash("sha256").update(removeMonthlyLimitsSql).digest("hex"),
    ).toBe("9d3ae21ade86ad33c93db1b15dfc9bf3b422ecf66fa7af05e181fb3293ff69a0");
    expect(removeMonthlyLimitsSql).toContain(
      'DROP CONSTRAINT IF EXISTS "users_monthly_credit_limit_micros_check"',
    );
    expect(
      removeMonthlyLimitsSql.match(
        /DROP COLUMN "monthly_credit_limit_micros"/gu,
      ),
    ).toHaveLength(2);
  });

  it("keeps one weekly default while removing total limits without deleting usage history", () => {
    for (const period of ["monthly", "total"]) {
      expect(schema).not.toContain(`@map("${period}_credit_limit_micros")`);
    }
    expect(simplifyLimitsSql).toContain(
      'DROP CONSTRAINT IF EXISTS "users_total_credit_limit_micros_check"',
    );
    expect(
      simplifyLimitsSql.match(/DROP COLUMN "total_credit_limit_micros"/gu),
    ).toHaveLength(2);
    expect(simplifyLimitsSql).toContain("'weekly_credit_limit'");
    expect(simplifyLimitsSql).toContain(
      "{quota_settings,organization_members,weekly_credit_limit}",
    );
    expect(simplifyLimitsSql).not.toContain(
      "{quota_settings,self_registered_users,weekly_credit_limit}",
    );
    for (const migration of [removeMonthlyLimitsSql, simplifyLimitsSql]) {
      expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE)\b/iu);
      expect(migration).not.toMatch(
        /(?:token_usage_records|model_usage_records|billing_statements)/iu,
      );
    }
  });
});
