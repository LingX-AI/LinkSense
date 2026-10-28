import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { parse } = require("yaml");
const { gte, satisfies } = require("semver");
const lockfile = parse(
  readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
);

// Security floors for GHSA-6mj3-qw4j-hgrw, GHSA-rgj7-g3m4-5g8c,
// GHSA-2x7j-588g-ccc2, and the Fastify validation / not-found advisories
// GHSA-9q9j-q6p8-xq58, GHSA-hwr6-493r-vm6h, GHSA-p68q-wchp-6fh7,
// GHSA-v53p-9fqp-m79j, GHSA-c475-qrg2-pj4r, GHSA-qhr7-859c-m2p7,
// GHSA-xjh9-v7x6-24jw, GHSA-qw65-cvwx-89v3, GHSA-rfgv-xxqx-mfg5,
// GHSA-wq5f-xc86-pv6w, GHSA-6qxp-vccf-f47h, GHSA-22jm-h49p-29qw,
// GHSA-46jr-4wx8-v453, GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c,
// GHSA-587h-7wmj-h5pm, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr,
// GHSA-27r3-jxmh-p828, GHSA-xcx6-jx8p-x3h5, and GHSA-xjj6-f33q-929c.
// Check every resolution, including transitive copies.
for (const [name, minimum] of [
  ["@xmldom/xmldom", "0.9.12"],
  ["sharp", "0.35.5"],
  ["@modelcontextprotocol/sdk", "1.32.0"],
  ["follow-redirects", "1.16.1"],
  ["vite", "8.1.6"],
  ["nodemailer", "10.0.6"],
  ["fastify", "5.12.2"],
  ["@fastify/busboy", "3.2.1"],
  ["basic-ftp", "6.2.1"],
  ["brace-expansion", "5.0.11"],
  ["fast-uri", "3.1.7"],
  ["undici", "6.29.1"],
  ["body-parser", "1.20.9"],
  ["@azure/msal-node", "7.1.0"],
  ["proxy-addr", "2.0.8"],
  ["source-map-js", "1.2.2"],
  ["prosemirror-view", "1.42.3"],
  ["dompurify", "3.4.17"],
]) {
  test(`the lockfile resolves ${name} only to security-patched versions`, () => {
    const versions = Object.keys(lockfile.packages)
      .filter((key) => key.startsWith(`${name}@`))
      .map((key) => key.slice(name.length + 1));
    assert.ok(
      versions.length > 0,
      `${name} must be present in the release dependencies`,
    );
    for (const version of versions) {
      // The maintained 0.8.15 line carries the XML security fixes and is outside
      // GHSA-6mj3-qw4j-hgrw's affected 0.9.x range. Node-SAML requires its API.
      const patchedRanges = {
        "@xmldom/xmldom": "~0.8.15 || >=0.9.12",
        "fast-uri": ">=3.1.7 <4.0.0 || >=4.1.4",
        "undici": ">=6.29.1 <7.0.0 || >=7.30.1 <8.0.0 || >=8.12.2",
        "body-parser": ">=1.20.9 <2.0.0 || >=2.4.0",
        "vite": ">=6.4.4 <7.0.0 || >=7.3.7 <8.0.0 || >=8.1.6 <8.2.0 || >=8.2.4 <8.3.0 || >=8.3.3",
      };
      const patched = name in patchedRanges
        ? satisfies(version, patchedRanges[name])
        : gte(version, minimum);
      assert.ok(patched, `${name}@${version} must be security-patched`);
    }
  });
}

test("application Zod 4 validators include the collection exhaustion fix", () => {
  const versions = Object.keys(lockfile.packages)
    .filter(key => key.startsWith("zod@4."))
    .map(key => key.slice("zod@".length));
  assert.ok(versions.length > 0);
  for (const version of versions) assert.ok(gte(version, "4.6.6"), `zod@${version} must include GHSA-mrhx-c7xc-m3w5's fix`);
});

test("the shared Worker Node runtime also pins the patched SVG decoder", () => {
  const manifest = JSON.parse(readFileSync(new URL("../deploy/runtime/node/package.json", import.meta.url), "utf8"));
  const workerLock = parse(readFileSync(new URL("../deploy/runtime/node/pnpm-lock.yaml", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies.sharp, "0.35.5");
  const versions = Object.keys(workerLock.packages).filter(key => key.startsWith("sharp@"));
  assert.ok(versions.length > 0);
  for (const key of versions) assert.ok(gte(key.slice("sharp@".length), "0.35.5"));
});

test("the component generator is a build dependency rather than a production dependency", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8"),
  );
  assert.ok(manifest.devDependencies.shadcn);
  assert.equal(manifest.dependencies.shadcn, undefined);
  assert.ok(lockfile.importers["apps/web"].devDependencies.shadcn);
  assert.equal(lockfile.importers["apps/web"].dependencies.shadcn, undefined);
});

test("SAML uses the patched supported XML parser without changing other consumers", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.pnpm.overrides["@xmldom/xmldom@<0.9.12"], "0.9.12");
  assert.equal(
    manifest.pnpm.overrides["@node-saml/node-saml>@xmldom/xmldom"],
    "0.8.15",
  );
  assert.equal(manifest.pnpm.overrides["xml-crypto>@xmldom/xmldom"], "0.8.15");
  for (const vulnerable of ["0.8.14", "0.9.0", "0.9.11"]) {
    assert.equal(satisfies(vulnerable, "~0.8.15 || >=0.9.12"), false);
  }
});
