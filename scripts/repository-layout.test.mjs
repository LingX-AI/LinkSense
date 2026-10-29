import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { checkBaselineAdoption } from "./baseline-adoption.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { parse: parseYaml } = createRequire(new URL("../apps/api/package.json", import.meta.url))("yaml");

test("the existing verified runtime baseline stays usable after repository organization", () => {
  const baseline = checkBaselineAdoption(root);
  assert.match(baseline.id, /^baseline-\d+-\d+$/u);
});

test("release and verification workflows resolve every application Dockerfile from the repository context", () => {
  const expected = ["deploy/docker/Dockerfile.api", "deploy/docker/Dockerfile.runner", "deploy/docker/Dockerfile.web"];
  for (const file of [".github/workflows/release.yml", ".github/workflows/verify-application-images.yml"]) {
    const workflow = parseYaml(readFileSync(path.join(root, file), "utf8"));
    const dockerfiles = new Set();
    for (const job of Object.values(workflow.jobs)) {
      const matrix = job.strategy?.matrix;
      for (const entry of [...(matrix?.include ?? []), ...(matrix?.application ?? [])]) {
        if (entry.dockerfile) dockerfiles.add(entry.dockerfile);
      }
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith("docker/build-push-action@")) continue;
        assert.equal(step.with.context, ".");
        if (!step.with.file.startsWith("${{")) dockerfiles.add(step.with.file);
      }
    }
    assert.deepEqual([...dockerfiles].sort(), expected, file);
    for (const dockerfile of dockerfiles) accessSync(path.join(root, dockerfile));
  }
});

test("relocated Compose entrypoints keep build contexts and production mounts at the repository root", () => {
  const environmentFile = path.join(root, ".env.example");
  const environment = { ...process.env, PWD: root, LINKSENSE_COMPOSE_ENV_FILE: environmentFile };
  for (const files of [
    ["docker-compose.yml", "deploy/compose/docker-compose.dev.yml"],
    ["deploy/compose/docker-compose.production-stack.yml"],
  ]) {
    const model = JSON.parse(execFileSync("docker", [
      "compose", "--env-file", environmentFile,
      ...files.flatMap(file => ["-f", file]), "config", "--format", "json",
    ], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }));
    for (const service of Object.values(model.services)) {
      if (service.build) {
        assert.equal(service.build.context, root);
        assert.ok(service.build.dockerfile.startsWith("deploy/docker/"));
      }
    }
    if (model.services["postgres-backup"]) {
      for (const [service, filename] of [
        ["gateway", "deploy/nginx/production-gateway.conf.template"],
        ["postgres-backup", "deploy/production/postgres-backup.sh"],
      ]) {
        assert.ok(model.services[service].volumes.some(volume => volume.source === path.join(root, filename)));
      }
    }
  }
});
