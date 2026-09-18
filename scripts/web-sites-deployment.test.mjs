import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const file of ["deploy/nginx/default.conf.template", "deploy/nginx/production-gateway.conf.template", "deploy/release/gateway.conf.template", "deploy/production/host-nginx.example.conf"]) {
  test(`${file} forwards webpage assets before static-file and SPA fallbacks`, async () => {
    const config = await readFile(file, "utf8");
    const begin = config.indexOf("location ^~ /web/");
    assert(begin >= 0);
    const end = config.indexOf("location /api/", begin);
    const block = config.slice(begin, end);
    assert.match(block, /proxy_pass http:/u);
    // A location-level header also stops inheriting the application shell CSP.
    assert.match(block, /add_header Cache-Control "no-store" always;/u);
    assert.doesNotMatch(block, /add_header Content-Security-Policy/u);
    assert.doesNotMatch(block, /try_files/u);
  });
}
test("website storage migration only adds isolated tables without foreign keys", async () => {
  const sql = await readFile("prisma/migrations/20260917180000_add_web_sites/migration.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|ALTER|REFERENCES)\b/iu);
  assert.equal([...sql.matchAll(/CREATE TABLE/gu)].length, 4);
  assert.match(sql, /CREATE UNIQUE INDEX "web_sites_slug_key"/u);
  assert.match(sql, /web_sites_owner_updated_idx/u);
});
