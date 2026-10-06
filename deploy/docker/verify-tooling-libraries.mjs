import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [source, root, tool] = process.argv.slice(2);
assert.ok(["pnpm", "npm"].includes(tool));
const require = createRequire(join(root, "package.json"));
const directory = join(root, tool === "pnpm" ? "dist/node_modules" : "node_modules");
const pins = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).dependencies;
const names = tool === "pnpm" ? ["http-cache-semantics"] : Object.keys(pins);
for (const name of names) {
  assert.equal(JSON.parse(readFileSync(join(directory, name, "package.json"), "utf8")).version, pins[name]);
}
const Policy = require(join(directory, "http-cache-semantics"));
class FrozenPolicy extends Policy { now() { return 1000; } }
const request = { url: "https://example.test/private", method: "GET", headers: { host: "example.test" } };
const policy = new FrozenPolicy(request, { status: 200, headers: { "cache-control": "private, max-age=3600", "set-cookie": "session=synthetic" } });
// The documented API requires storable() BEFORE insertion. Never manufacture
// a private cache entry and use the freshness API as a storage admission check.
assert.equal(policy.storable(), false);
// This is an actual v1 object emitted by http-cache-semantics 4.2.0. Native
// deserialization must retain an existing package-manager cache's usability.
const existing = FrozenPolicy.fromObject({ v: 1, t: 1000, sh: true, ch: 0.1, imm: 86400000, icc: false, st: 200, resh: { "cache-control": "public, max-age=3600" }, rescc: { public: true, "max-age": "3600" }, m: "GET", u: "https://example.test/public", h: "example.test", a: true, reqh: null, reqcc: {} });
assert.ok(existing.storable());
assert.ok(existing.satisfiesWithoutRevalidation({ ...request, url: "https://example.test/public" }));
if (tool === "npm") {
  assert.deepEqual(require(join(directory, "brace-expansion")).expand("{a,b}"), ["a", "b"]);
  assert.equal(typeof require(join(directory, "undici")).WebSocket, "function");
}
console.log(`${tool}: pinned libraries, public/private cache admission and existing v1 cache records verified`);
