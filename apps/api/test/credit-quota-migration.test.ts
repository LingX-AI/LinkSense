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
});
