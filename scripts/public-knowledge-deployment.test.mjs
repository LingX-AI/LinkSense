import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("only the public knowledge frame delegates embedding policy to the API", () => {
  const config = readFileSync(
    new URL("../deploy/nginx/default.conf.template", import.meta.url),
    "utf8",
  );
  const frame = config.match(
    /location \^~ \/api\/v1\/public-knowledge\/frame\/ \{([\s\S]*?)\n  \}/u,
  )?.[1];
  assert(frame);
  assert.match(frame, /add_header Cache-Control "no-store" always;/u);
  assert.match(frame, /proxy_pass http:\/\/api:4000;/u);
  assert.doesNotMatch(
    frame,
    /proxy_hide_header Content-Security-Policy|add_header (?:Content-Security-Policy|X-Frame-Options)/u,
  );
  assert.match(
    config,
    /add_header Content-Security-Policy .*frame-ancestors 'self'/u,
  );
  assert.match(config, /\/assets\/public-knowledge-app\.js "no-cache";/u);
});
