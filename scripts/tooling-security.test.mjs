import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { patchToolingLibraries } from "../deploy/docker/patch-tooling-libraries.mjs";
import { validateHeaderInventory } from "../deploy/docker/verify-kernel-headers.mjs";

function fixture(t, version = "4.2.0") {
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-tooling-security-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const root = path.join(directory, "pnpm");
  const from = path.join(source, "node_modules/http-cache-semantics");
  const to = path.join(root, "dist/node_modules/http-cache-semantics");
  mkdirSync(from, { recursive: true }); mkdirSync(to, { recursive: true });
  writeFileSync(path.join(source, "package.json"), JSON.stringify({ dependencies: { "http-cache-semantics": "4.3.0" } }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "pnpm", version: "10.34.6" }));
  writeFileSync(path.join(from, "package.json"), JSON.stringify({ name: "http-cache-semantics", version: "4.3.0" }));
  writeFileSync(path.join(to, "package.json"), JSON.stringify({ name: "http-cache-semantics", version }));
  writeFileSync(path.join(from, "index.js"), "complete-upstream-code");
  writeFileSync(path.join(from, "LICENSE"), "upstream-license");
  writeFileSync(path.join(to, "obsolete.js"), "old-code");
  return { source, root, from, to };
}

test("tooling replacement installs real code and licenses, removes obsolete files and preserves CLI identity", (t) => {
  const { source, root, to } = fixture(t);
  patchToolingLibraries(source, root, "pnpm");
  assert.equal(readFileSync(path.join(to, "index.js"), "utf8"), "complete-upstream-code");
  assert.equal(readFileSync(path.join(to, "LICENSE"), "utf8"), "upstream-license");
  assert.equal(existsSync(path.join(to, "obsolete.js")), false);
  assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"))).version, "10.34.6");
});
test("unexpected vendor versions fail before altering installed dependencies", (t) => {
  const { source, root, to } = fixture(t, "0.0.0");
  assert.throws(() => patchToolingLibraries(source, root, "pnpm"));
  assert.ok(existsSync(path.join(to, "obsolete.js")));
});
test("symlinked vendor libraries cannot redirect replacement outside the verified package", (t) => {
  const { source, root, to, from } = fixture(t);
  rmSync(to, { recursive: true }); symlinkSync(from, to);
  assert.throws(() => patchToolingLibraries(source, root, "pnpm"));
  assert.ok(existsSync(path.join(from, "index.js")));
});

const files = Array.from({ length: 600 }, (_, index) => `/usr/include/linux/header-${index}.h`);
const regular = { mode: 0o644, isDirectory: () => false, isFile: () => true };
test("header-only evidence permits only a complete non-executable userspace header inventory", () => {
  assert.equal(validateHeaderInventory(files, () => regular, ["linux-libc-dev:amd64", "gcc"]), 600);
  for (const packages of [["linux-image-6.8.0"], ["linux-modules-6.8.0"], ["linux-headers-6.8.0"]]) {
    assert.throws(() => validateHeaderInventory(files, () => regular, packages));
  }
  assert.throws(() => validateHeaderInventory([...files, "/boot/vmlinuz"], () => regular, []));
  assert.throws(() => validateHeaderInventory(files, () => ({ ...regular, mode: 0o755 }), []));
  assert.throws(() => validateHeaderInventory(files.slice(0, 5), () => regular, []));
});

test("migration and worker inherit baselines with pinned real library replacements and verified headers", () => {
  const api = readFileSync("Dockerfile.api", "utf8");
  const runner = readFileSync("Dockerfile.runner", "utf8");
  const baseline = readFileSync("deploy/baselines/Dockerfile.runtime", "utf8");
  assert.match(api, /FROM \$\{BASELINE_NODE_IMAGE\} AS migration/u);
  assert.match(runner, /FROM \$\{BASELINE_WORKER_IMAGE\} AS worker/u);
  assert.match(baseline, /FROM toolchain AS tooling-security-dependencies/u);
  assert.match(baseline, /patch-tooling-libraries\.mjs[^\n]+pnpm/u);
  assert.equal((baseline.match(/patch-tooling-libraries\.mjs[^\n]+ npm \\/gu) ?? []).length, 1);
  assert.equal((baseline.match(/node \/opt\/linksense\/tooling\/verify-kernel-headers\.mjs > \/opt\/linksense\/tooling\/kernel-headers\.evidence\.json/gu) ?? []).length, 1);
});
