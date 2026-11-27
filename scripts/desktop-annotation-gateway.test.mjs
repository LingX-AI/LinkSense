import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const nginxConfigPath = resolve("deploy/nginx/default.conf.template");
const apiAppPath = resolve("apps/api/src/app.ts");
const runtimePrefix = "/api/v1/interactive-app-runtime";

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function locationBody(config, header) {
  const startIndex = config.indexOf(header);
  assert.notEqual(startIndex, -1, `missing location: ${header}`);
  const endIndex = config.indexOf("\n  }", startIndex + header.length);
  assert.notEqual(endIndex, -1, `unterminated location: ${header}`);
  return config.slice(startIndex, endIndex);
}

function parsePolicy(value) {
  return value
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/u);
      return { name, sources };
    });
}

function contentSecurityPolicy(body) {
  const value =
    /add_header Content-Security-Policy "([^"]+)" always;/u.exec(body)?.[1];
  assert.ok(value, "missing Content-Security-Policy header");
  return parsePolicy(value);
}

test("ordinary Web proxy routes keep the portal frame policy", async () => {
  const config = await readFile(nginxConfigPath, "utf8");
  const serverHeaders = between(config, "server {", "\n  location ");
  const frameAncestors = contentSecurityPolicy(serverHeaders).find(
    ({ name }) => name === "frame-ancestors",
  );

  assert.deepEqual(frameAncestors?.sources, [
    "'self'",
    "https://teams.microsoft.com",
    "https://*.teams.microsoft.com",
  ]);

  // No location-level add_header, so /api/ inherits the server-level policy.
  const apiLocation = locationBody(config, "  location /api/ {");
  assert.match(apiLocation, /proxy_pass http:\/\/api:4000;/u);
  assert.doesNotMatch(apiLocation, /Content-Security-Policy/u);
  assert.doesNotMatch(apiLocation, /access_log off;/u);
});

test("the interactive runtime proxy is scoped to the API prefix and admits only the annotation frame origin", async () => {
  const [config, apiApp] = await Promise.all([
    readFile(nginxConfigPath, "utf8"),
    readFile(apiAppPath, "utf8"),
  ]);
  assert.ok(
    apiApp.includes(`prefix: "${runtimePrefix}"`),
    "API runtime route prefix moved",
  );

  const runtimeLocations =
    config.match(/^ {2}location [^\n]*interactive-app-runtime[^\n]*$/gmu) ?? [];
  const header = `  location ^~ ${runtimePrefix}/ {`;
  assert.deepEqual(runtimeLocations, [header]);

  const body = locationBody(config, header);
  assert.match(body, /proxy_pass http:\/\/api:4000;/u);
  // Runtime URLs carry a scoped ticket in the path.
  assert.match(body, /access_log off;/u);
  // ^~ keeps proxied *.mjs assets out of the local ES module regex location.
  assert.match(config, /^ {2}location ~ \\\.mjs\$ \{/mu);

  assert.deepEqual(contentSecurityPolicy(body), [
    {
      name: "frame-ancestors",
      sources: [
        "'self'",
        "https://teams.microsoft.com",
        "https://*.teams.microsoft.com",
        "mygo://localhost",
      ],
    },
  ]);

  // The API owns ticket validation, content headers, and cache lifetime.
  assert.doesNotMatch(body, /add_header (?:Cache-Control|Expires|Pragma)/u);
  assert.doesNotMatch(body, /proxy_hide_header (?:Cache-Control|Content-Security-Policy)/u);
});
