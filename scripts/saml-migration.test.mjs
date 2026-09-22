import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("SAML migration widens the login method check while preserving every historical value and field", () => {
  const read = (name) =>
    readFileSync(
      new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
      "utf8",
    );
  const before = read("20260921120000_add_social_authentication");
  const after = read("20260922090000_add_saml_login_method");
  for (const [, method] of before.matchAll(/'([^']+)'/gu))
    assert.ok(after.includes(`'${method}'`));
  assert.ok(after.includes("'saml'"));
  assert.match(after, /"last_login_method" IS NULL/u);
  assert.doesNotMatch(
    after,
    /DELETE|TRUNCATE|DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN/iu,
  );
});
