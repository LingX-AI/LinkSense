import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { baselineSchema, baselineInputs, baselineFingerprint, readBaseline, runtimeNames, serviceNames, vendorComponents, runtimeEnvironment, serviceEnvironment, parseServiceEnvironment, validateMaintenanceProof, writeScanInputs } from "../deploy/baselines/tools/baseline-images.mjs";
const { parse } = createRequire(new URL("../apps/api/package.json", import.meta.url))("yaml");

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "linksense-baseline-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const input of baselineInputs) cpSync(resolve(input), join(directory, input), { recursive: true, filter: source => !source.split(/[\\/]/u).includes("node_modules") });
  mkdirSync(join(directory, "apps/api/src"), { recursive: true });
  writeFileSync(join(directory, "apps/api/src/example.ts"), "initial business source");
  const reference = name => `ghcr.io/lingx-ai/linksense-${name}@sha256:${"a".repeat(64)}`;
  const baseline = { schemaVersion: 1, id: "baseline-123-1", recipeFingerprint: baselineFingerprint(directory), sourceCommit: "b".repeat(40), workflowUrl: "https://github.com/LingX-AI/LinkSense/actions/runs/123", builtAt: "2026-10-06T00:00:00Z", runtimes: Object.fromEntries(runtimeNames.map(name => [name, reference(`runtime-${name}`)])), services: Object.fromEntries(serviceNames.map(name => [name, reference(vendorComponents[name] ?? name.toLowerCase())])) };
  baseline.services.MINIO = `docker.io/pgsty/silo@sha256:${"a".repeat(64)}`;
  baseline.services.BUSYBOX = `docker.io/library/busybox@sha256:${"a".repeat(64)}`;
  const file = join(directory, "images.lock.json");
  writeFileSync(file, JSON.stringify(baseline));
  return { directory, file, baseline };
}
test("business-only edits reuse the exact verified runtime and vendor baseline", t => {
  const { directory, file, baseline } = fixture(t);
  writeFileSync(join(directory, "apps/api/src/example.ts"), "updated business source");
  writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "99.0.0" }));
  assert.equal(readBaseline(file, directory).recipeFingerprint, baseline.recipeFingerprint);
});
test("Codex, dependency locks and runtime recipes must be maintained before an application build", t => {
  for (const input of ["apps/runner/src/codex/runtime-version.json", "deploy/runtime/python/uv.lock", "deploy/runtime/node/pnpm-lock.yaml", "deploy/baselines/Dockerfile.runtime"]) {
    const { directory, file } = fixture(t);
    writeFileSync(join(directory, input), readFileSync(join(directory, input), "utf8") + "\nchanged");
    assert.throws(() => readBaseline(file, directory), /Maintain and verify a new baseline/u);
  }
});
test("missing roles, mutable references, extra roles and foreign runtime packages fail closed", t => {
  const { baseline } = fixture(t);
  for (const mutate of [data => delete data.runtimes.worker, data => { data.runtimes.node = "ghcr.io/lingx-ai/linksense-runtime-node:latest"; }, data => { data.runtimes.extra = data.runtimes.node; }, data => { data.runtimes.api = data.runtimes.node; }, data => { data.services.POSTGRES = "postgres:16"; }]) {
    const data = structuredClone(baseline); mutate(data);
    assert.throws(() => baselineSchema.parse(data));
  }
});
test("a vendor role cannot resolve to an unverified original image", t => {
  const { directory, file, baseline } = fixture(t);
  baseline.services.POSTGRES = `docker.io/library/postgres@sha256:${"c".repeat(64)}`;
  writeFileSync(file, JSON.stringify(baseline));
  assert.throws(() => readBaseline(file, directory), /Unverified vendor baseline/u);
});
test("the maintenance scan reuses the full architecture-aware release gate without hiding any service", t => {
  const { directory, baseline } = fixture(t);
  const output = join(directory, "scan-inputs"); writeScanInputs(baseline, output);
  for (const [name, runtime] of Object.entries({ api: "api", web: "web", migrate: "node", runner: "node", worker: "worker" })) assert.equal(readFileSync(join(output, "image-references", name), "utf8").trim(), baseline.runtimes[runtime]);
  assert.equal(readFileSync(join(output, "release-inputs/upstream-images.env"), "utf8").trim().split("\n").length, 8);
  assert.match(runtimeEnvironment(baseline), /BASELINE_WORKER_IMAGE=ghcr\.io\/lingx-ai\/linksense-runtime-worker@sha256:/u);
});
test("runtime baseline builds contain no application server payload or product Release publication", () => {
  const dockerfile = readFileSync("deploy/baselines/Dockerfile.runtime", "utf8");
  assert.doesNotMatch(dockerfile, /COPY apps\/api|COPY apps\/web|COPY apps\/runner apps\/runner|dist\/index\.js/u);
  const workflow = readFileSync(".github/workflows/maintain-baselines.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /publish-release\.mjs|gh release create|refs\/tags\/v/u);
  assert.match(workflow, /needs: \[assemble, security, storage-upgrade\]/u);
});
test("baseline maintenance builds all components natively and only accepts scanned, publicly readable images", () => {
  const workflow = parse(readFileSync(".github/workflows/maintain-baselines.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.jobs), ["prepare", "build", "assemble", "security", "storage-upgrade", "verified"]);
  assert.equal(workflow.jobs.build.strategy.matrix.component.length, 10);
  const build = workflow.jobs.build.steps.find(s => s.id === "build");
  assert.match(build.with["build-args"], /matrix\.component\.name == 'runtime-web' && format\('NGINX_IMAGE=\{0\}', env\.UPSTREAM_IMAGE\)/u);
  assert.doesNotMatch(build.with["build-args"], /^\s*NGINX_IMAGE=\$\{\{ env\.UPSTREAM_IMAGE \}\}$/mu);
  assert.deepEqual(workflow.jobs.build.strategy.matrix.platform.map(p => p.runner), ["ubuntu-24.04", "ubuntu-24.04-arm"]);
  assert.deepEqual(workflow.jobs.security.strategy.matrix.architecture, ["amd64", "arm64"]);
  assert.deepEqual(workflow.jobs.verified.needs, ["assemble", "security", "storage-upgrade"]);
  assert.deepEqual(workflow.jobs.verified.permissions, { contents: "read" });
  assert.match(workflow.jobs.verified.steps.find(s => s.run?.includes("anonymous") || s.name?.includes("anonymous")).run, /docker logout ghcr\.io/u);
  assert.match(workflow.jobs.prepare.steps.find(s => s.id === "identity").run, /CodeQL must pass/u);
  assert.doesNotMatch(JSON.stringify(workflow), /continue-on-error/u);
});
test("frozen service inputs reject duplicates, omitted roles and mutable references", t => {
  const { baseline } = fixture(t);
  const valid = serviceEnvironment(baseline);
  assert.deepEqual(parseServiceEnvironment(valid), baseline.services);
  for (const contents of [valid + valid.split("\n")[0] + "\n", valid.replace(/^IMAGE_POSTGRES=.+\n/u, ""), valid.replace(/@sha256:[a-f0-9]{64}/u, ":latest")]) assert.throws(() => parseServiceEnvironment(contents));
});
test("only successful maintenance of the exact main source can prove a baseline", t => {
  const { baseline } = fixture(t);
  const proof = { id: 123, run_attempt: 1, head_sha: baseline.sourceCommit, head_branch: "main", event: "workflow_dispatch", conclusion: "success", path: ".github/workflows/maintain-baselines.yml", repository: { full_name: "LingX-AI/LinkSense" } };
  assert.equal(validateMaintenanceProof(baseline, proof).id, 123);
  for (const override of [{ id: 124 }, { run_attempt: 0 }, { head_sha: "c".repeat(40) }, { head_branch: "develop" }, { conclusion: "failure" }, { conclusion: null }, { path: ".github/workflows/release.yml" }, { repository: { full_name: "other/repo" } }]) assert.throws(() => validateMaintenanceProof(baseline, { ...proof, ...override }));
});
test("the baseline CLI still validates inputs when invoked through a symlink", t => {
  const { directory } = fixture(t);
  const link = join(directory, "baseline-cli.mjs");
  symlinkSync(resolve("deploy/baselines/tools/baseline-images.mjs"), link);
  const result = spawnSync(process.execPath, [link, "verify", join(directory, "missing-lock.json")], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/u);
});
