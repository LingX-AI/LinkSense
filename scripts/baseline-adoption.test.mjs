import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import * as adoption from "./baseline-adoption.mjs";
import { baselineInputs, baselineFingerprint } from "../deploy/baselines/tools/baseline-images.mjs";
const { baselineDockerfileDefaults, checkBaselineAdoption } = adoption;

test("source checks keep Docker defaults aligned with the recorded baseline while maintenance is pending", () => {
  const baseline = adoption.checkBaselineDockerDefaults();
  assert.match(baseline.runtimes.worker, /^ghcr\.io\/lingx-ai\/linksense-runtime-worker@sha256:/u);
});

test("recipe changes can be checked before maintenance but still block application builds until the verified baseline is adopted", t => {
  const directory = mkdtempSync(join(tmpdir(), "linksense-baseline-adoption-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const input of baselineInputs) cpSync(resolve(input), join(directory, input), {
    recursive: true, filter: source => !source.split(/[\\/]/u).includes("node_modules"),
  });
  for (const name of Object.keys(adoption.baselineDockerfiles)) cpSync(resolve(name), join(directory, name));
  const lock = join(directory, "deploy/baselines/images.lock.json");
  const baseline = JSON.parse(readFileSync("deploy/baselines/images.lock.json", "utf8"));
  baseline.recipeFingerprint = baselineFingerprint(directory);
  mkdirSync(join(directory, "deploy/baselines"), { recursive: true });
  writeFileSync(lock, JSON.stringify(baseline));
  assert.equal(checkBaselineAdoption(directory).id, baseline.id);
  const recipe = join(directory, "deploy/baselines/Dockerfile.runtime");
  writeFileSync(recipe, readFileSync(recipe, "utf8") + "\n# pending security maintenance\n");
  assert.equal(adoption.checkBaselineDockerDefaults(directory).id, baseline.id);
  assert.throws(() => checkBaselineAdoption(directory), /Maintain and verify a new baseline/u);
  const worker = join(directory, "Dockerfile.runner");
  const original = readFileSync(worker, "utf8");
  writeFileSync(worker, original.replace(/^ARG BASELINE_WORKER_IMAGE=.+$/mu, "ARG BASELINE_WORKER_IMAGE=unverified:latest"));
  assert.throws(() => adoption.checkBaselineDockerDefaults(directory), /Adopt the verified baseline/u);
});
test("baseline adoption mechanically updates only Docker defaults and rejects missing or duplicate arguments", () => {
  const baseline = { runtimes: { node: "registry/node@sha256:fixed", worker: "registry/worker@sha256:fixed" } };
  const source = "ARG BASELINE_NODE_IMAGE=old\nARG BASELINE_WORKER_IMAGE\nFROM ${BASELINE_NODE_IMAGE} AS toolchain\n";
  const expected = "ARG BASELINE_NODE_IMAGE=registry/node@sha256:fixed\nARG BASELINE_WORKER_IMAGE=registry/worker@sha256:fixed\nFROM ${BASELINE_NODE_IMAGE} AS toolchain\n";
  assert.equal(baselineDockerfileDefaults(baseline, "Dockerfile.runner", source), expected);
  assert.equal(baselineDockerfileDefaults(baseline, "Dockerfile.runner", expected), expected);
  for (const invalid of [source.replace("ARG BASELINE_WORKER_IMAGE\n", ""), source + "ARG BASELINE_NODE_IMAGE=duplicate\n"]) assert.throws(() => baselineDockerfileDefaults(baseline, "Dockerfile.runner", invalid));
});
test("daily application images contain no environment installation or cached-browser fallback", () => {
  for (const name of ["Dockerfile.api", "Dockerfile.web", "Dockerfile.runner"]) {
    const source = readFileSync(name, "utf8");
    assert.doesNotMatch(source, /apt-get|apk upgrade|uv sync|pip install|pnpm add --global|corepack prepare|install-browser|worker-cached-browser|SECURITY_REBUILD_ID/u);
    assert.match(source, /FROM \$\{BASELINE_NODE_IMAGE\}/u);
  }
  const worker = readFileSync("Dockerfile.runner", "utf8");
  assert.match(worker, /FROM \$\{BASELINE_WORKER_IMAGE\} AS worker/u);
  assert.match(worker, /linksense-browser open-workspace-html/u);
  assert.match(worker, /\/opt\/linksense\/runtime\/fonts\/verify\.sh/u);
  assert.match(worker, /--reuid=1001 --regid=1000/u);
});
