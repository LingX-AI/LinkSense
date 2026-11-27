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
    assert.doesNotMatch(block, /add_header (?:Content-Security-Policy|X-Frame-Options)/u);
    assert.doesNotMatch(block, /try_files/u);
    const protectedLocation = block.indexOf("location ^~ /web/_protected/");
    const protectedProxy = block.indexOf("proxy_pass http:", protectedLocation);
    assert(protectedLocation >= 0 && protectedProxy > protectedLocation);
    const protectedOptions = block.slice(protectedLocation, protectedProxy);
    assert.match(protectedOptions, /access_log off;/u);
    assert.match(protectedOptions, /error_log \/dev\/null;/u);
    const target = block.slice(protectedProxy).match(/^proxy_pass (http:[^;]+);/u)?.[1];
    assert(target);
    assert(block.indexOf(`proxy_pass ${target};`, protectedProxy + 1) > protectedProxy);
    if (file.endsWith("production-gateway.conf.template")) assert.match(protectedOptions, /return 503;/u);
    const preview = config.slice(config.indexOf("location ^~ /html-preview/"), begin);
    assert.match(preview, /access_log off;/u);
    assert.match(preview, /proxy_pass http:/u);
    assert.match(preview, /add_header Cache-Control "no-store" always;/u);
    assert.doesNotMatch(preview, /try_files|add_header (?:Content-Security-Policy|X-Frame-Options)/u);
    const appBegin = config.indexOf("location ^~ /app/");
    assert(appBegin >= 0 && appBegin < begin);
    const applications = config.slice(appBegin, begin);
    assert.match(applications, /proxy_pass http:/u);
    assert.match(applications, /proxy_set_header Host \$http_host;/u);
    assert.match(applications, /add_header Cache-Control "no-store" always;/u);
    assert.doesNotMatch(applications, /try_files|add_header (?:Content-Security-Policy|X-Frame-Options)/u);
  });
}
test("website storage migration only adds isolated tables without foreign keys", async () => {
  const sql = await readFile("prisma/migrations/20260917180000_add_web_sites/migration.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|ALTER|REFERENCES)\b/iu);
  assert.equal([...sql.matchAll(/CREATE TABLE/gu)].length, 4);
  assert.match(sql, /CREATE UNIQUE INDEX "web_sites_slug_key"/u);
  assert.match(sql, /web_sites_owner_updated_idx/u);
});
test("sandbox runtime migration preserves existing application modes", async () => {
  const sql = await readFile("prisma/migrations/20261117180000_add_web_site_backend_runtime_mode/migration.sql", "utf8");
  assert.match(sql, /ADD COLUMN "runtime_mode" VARCHAR\(16\)/u);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|NOT NULL|DEFAULT)\b/iu);
  assert.match(sql, /"runtime_mode" IS NULL OR "runtime_mode" = 'sandbox'/u);
});
