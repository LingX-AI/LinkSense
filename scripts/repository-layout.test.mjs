import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { checkBaselineAdoption } from "./baseline-adoption.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("the existing verified runtime baseline stays usable after repository organization", () => {
  const baseline = checkBaselineAdoption(root);
  assert.match(baseline.id, /^baseline-\d+-\d+$/u);
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
