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
// and GHSA-2x7j-588g-ccc2. Check every resolution, including transitive copies.
for (const [name, minimum] of [
  ["@xmldom/xmldom", "0.9.12"],
  ["sharp", "0.35.4"],
  ["nodemailer", "9.1.0"],
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
      const patched =
        name === "@xmldom/xmldom"
          ? satisfies(version, "~0.8.15 || >=0.9.12")
          : gte(version, minimum);
      assert.ok(patched, `${name}@${version} must be security-patched`);
    }
  });
}

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
