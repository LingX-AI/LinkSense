import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(new URL("../apps/api/package.json", import.meta.url))
const { parse } = require("yaml")
const { gte } = require("semver")
const lockfile = parse(
  readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
)

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
      .map((key) => key.slice(name.length + 1))
    assert.ok(
      versions.length > 0,
      `${name} must be present in the release dependencies`,
    )
    for (const version of versions) {
      assert.ok(gte(version, minimum), `${name}@${version} must be >=${minimum}`)
    }
  })
}
