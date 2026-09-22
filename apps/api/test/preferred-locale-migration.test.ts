import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260921130000_expand_supported_locales/migration.sql",
  import.meta.url,
);

describe("supported locale migration", () => {
  it("widens every persisted locale constraint without changing stored data", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/\bBEGIN;/u);
    expect(sql).toMatch(/\bCOMMIT;/u);
    expect(sql).toContain('DROP CONSTRAINT "users_preferred_locale_check"');
    expect(sql).toContain(
      'DROP CONSTRAINT "registration_tokens_locale_check"',
    );
    for (const locale of [
      "zh-CN",
      "en-US",
      "es-ES",
      "pt-BR",
      "fr-FR",
      "ja-JP",
    ]) {
      expect(sql.match(new RegExp(`'${locale}'`, "gu"))).toHaveLength(2);
    }
    expect(sql).not.toMatch(
      /\b(?:DELETE|TRUNCATE|DROP\s+TABLE|ALTER\s+COLUMN)\b/iu,
    );
  });
});
