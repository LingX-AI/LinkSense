import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sourceFingerprint } from "./source-fingerprint.mjs";

test("installed runtimes and Python bytecode do not change image source identity", t => {
  const directory = mkdtempSync(join(tmpdir(), "linksense-runtime-fingerprint-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "runtime"));
  writeFileSync(join(directory, "runtime/package.json"), "source");
  const before = sourceFingerprint(directory, ["runtime"]);
  for (const cache of ["node_modules", ".venv", "__pycache__"]) {
    mkdirSync(join(directory, "runtime", cache));
    writeFileSync(join(directory, "runtime", cache, "generated"), "not source");
  }
  assert.equal(sourceFingerprint(directory, ["runtime"]), before);
  writeFileSync(join(directory, "runtime/package.json"), "changed source");
  assert.notEqual(sourceFingerprint(directory, ["runtime"]), before);
});
