import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("GitHub migration widens both checks without losing historical provider or login values", () => {
  const read = (name) => readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
  const social = read("20260921120000_add_social_authentication");
  const saml = read("20260922090000_add_saml_login_method");
  const github = read("20260922150000_add_github_login_method");
  for (const [constraint, previous] of [
    ["social_accounts_provider_check", social],
    ["users_last_login_method_check", saml],
  ]) {
    const check = (sql) => sql.slice(sql.lastIndexOf(constraint)).split(";")[0];
    const current = check(github);
    for (const [, value] of check(previous).matchAll(/'([^']+)'/gu))
      assert.ok(current.includes(`'${value}'`));
    assert.ok(current.includes("'github'"));
  }
  assert.match(github, /"last_login_method" IS NULL/u);
  assert.match(github, /BEGIN;[\s\S]*COMMIT;/u);
  assert.doesNotMatch(github, /DELETE|TRUNCATE|DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN/iu);
});
