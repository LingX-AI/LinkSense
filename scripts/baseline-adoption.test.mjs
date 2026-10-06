import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { baselineDockerfileDefaults, checkBaselineAdoption } from "./baseline-adoption.mjs";

test("every direct source build uses the exact same verified baselines as the release workflow", () => {
  const baseline = checkBaselineAdoption();
  assert.match(baseline.runtimes.worker, /^ghcr\.io\/lingx-ai\/linksense-runtime-worker@sha256:/u);
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
