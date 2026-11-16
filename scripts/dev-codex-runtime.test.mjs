import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { baselineInputs, baselineFingerprint } from "../deploy/baselines/tools/baseline-images.mjs";
import { checkBaselineAdoption, baselineDockerfiles } from "./baseline-adoption.mjs";
import { checkDevelopmentBaseline, prepareDevelopmentCodexRuntime } from "./dev-codex-runtime.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "linksense-dev-codex-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const input of baselineInputs) cpSync(resolve(input), join(root, input), { recursive: true, filter: path => !path.split(/[\\/]/u).includes("node_modules") });
  for (const name of [...Object.keys(baselineDockerfiles), "deploy/docker/Dockerfile.dev-codex"]) cpSync(resolve(name), join(root, name));
  const versionPath = join(root, "apps/runner/src/codex/runtime-version.json");
  const recorded = '{\n  "version": "0.154.0"\n}\n';
  writeFileSync(versionPath, recorded);
  const baseline = JSON.parse(readFileSync("deploy/baselines/images.lock.json", "utf8"));
  baseline.recipeFingerprint = baselineFingerprint(root);
  const lock = join(root, "deploy/baselines/images.lock.json");
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify(baseline));
  return { root, baseline, recorded, upgrade: () => writeFileSync(versionPath, '{\n  "version": "0.168.0"\n}\n') };
}

test("unchanged development recipes reuse the verified worker without reading Git history or building", t => {
  const f = fixture(t);
  const calls = [];
  const environment = prepareDevelopmentCodexRuntime({ PATH: "/test" }, f.root, {
    execute: (...args) => { calls.push(args); throw new Error("unexpected process"); },
  });
  assert.equal(environment.BASELINE_WORKER_IMAGE, f.baseline.runtimes.worker);
  assert.deepEqual(calls, []);
});

test("a development-only Codex update builds a cached local runtime while production admission remains strict", t => {
  const f = fixture(t);
  f.upgrade();
  assert.throws(() => checkBaselineAdoption(f.root), /Maintain and verify/u);
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "git") return f.recorded;
    if (args[0] === "image") throw new Error("not built");
    assert.equal(args[0], "build");
    return "";
  };
  const result = prepareDevelopmentCodexRuntime({}, f.root, { execute });
  assert.match(result.BASELINE_WORKER_IMAGE, /^linksense-dev-codex:[a-f0-9]{64}$/u);
  const build = calls.find(call => call.command === "docker" && call.args[0] === "build");
  assert.ok(build);
  assert.ok(build.args.includes(`BASELINE_WORKER_IMAGE=${f.baseline.runtimes.worker}`));
  assert.ok(build.args.includes("deploy/docker/Dockerfile.dev-codex"));
  const cached = prepareDevelopmentCodexRuntime({}, f.root, {
    execute: (command, args) => command === "git" ? f.recorded : args[0] === "image" ? result.BASELINE_WORKER_IMAGE.split(":")[1] : assert.fail("rebuilt cached image"),
  });
  assert.equal(cached.BASELINE_WORKER_IMAGE, result.BASELINE_WORKER_IMAGE);
  assert.throws(() => checkBaselineAdoption(f.root), /Maintain and verify/u);
});

test("development still rejects other changed runtime recipes and never starts a build", t => {
  const f = fixture(t);
  f.upgrade();
  const recipe = join(f.root, "deploy/baselines/Dockerfile.runtime");
  writeFileSync(recipe, readFileSync(recipe, "utf8") + "\n# changed environment\n");
  assert.throws(() => checkDevelopmentBaseline(f.root, () => f.recorded), /Maintain and verify/u);
});

test("development rejects invalid recorded version evidence and unverified Docker defaults", t => {
  const f = fixture(t);
  f.upgrade();
  assert.throws(() => checkDevelopmentBaseline(f.root, () => "not JSON"));
  const worker = join(f.root, "deploy/docker/Dockerfile.runner");
  writeFileSync(worker, readFileSync(worker, "utf8").replace(/^ARG BASELINE_WORKER_IMAGE=.+$/mu, "ARG BASELINE_WORKER_IMAGE=unverified:latest"));
  assert.throws(() => checkDevelopmentBaseline(f.root, () => f.recorded), /Adopt the verified baseline/u);
});

test("a failed local Codex build stops startup instead of reusing an old worker", t => {
  const f = fixture(t);
  f.upgrade();
  assert.throws(() => prepareDevelopmentCodexRuntime({}, f.root, {
    execute: (command, args) => {
      if (command === "git") return f.recorded;
      if (args[0] === "image") throw new Error("not built");
      throw new Error("Codex installation failed");
    },
  }), /Codex installation failed/u);
});
