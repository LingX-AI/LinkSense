import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { prepareUat } from "../deploy/uat/prepare.mjs";

const { parse } = createRequire(new URL("../apps/api/package.json", import.meta.url))("yaml");
const revision = "a".repeat(40);
const deployScript = new URL("../deploy/uat/deploy-uat.sh", import.meta.url);
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "linksense-uat-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, "deploy/baselines"), { recursive: true });
  writeFileSync(resolve(root, "deploy/baselines/images.lock.json"), readFileSync(new URL("../deploy/baselines/images.lock.json", import.meta.url)));
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ version: "0.3.11" }));
  return root;
}
test("UAT updates preserve credentials and data identities while advancing source images", t => {
  const root = fixture(t);
  const first = prepareUat(root, { revision, publicUrl: "http://192.0.2.5:19090" });
  const second = prepareUat(root, { revision: "b".repeat(40), publicUrl: "http://192.0.2.5:19090" });
  for (const key of ["POSTGRES_PASSWORD", "REDIS_PASSWORD", "LINKSENSE_CREDENTIAL_MASTER_KEY", "LINKSENSE_JWT_SECRET", "LINKSENSE_INITIALIZATION_TOKEN", "LINKSENSE_POSTGRES_VOLUME", "LINKSENSE_USER_DATA_VOLUME"]) assert.equal(first[key], second[key], key);
  assert.notEqual(first.LINKSENSE_API_IMAGE, second.LINKSENSE_API_IMAGE);
  assert.equal(second.LINKSENSE_EDITION, "core");
  assert.equal(second.LINKSENSE_USER_DATA_VOLUME, "linksense-uat-user-data");
  assert.equal(second.LINKSENSE_VERSION, "v0.3.11");
  assert.equal(second.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS, "4");
  assert.equal(second.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT, "4");
  assert.equal(Buffer.from(second.LINKSENSE_CREDENTIAL_MASTER_KEY, "base64").length, 32);
  for (const file of ["runtime.env", "initialization.txt"]) assert.equal(statSync(resolve(root, ".data/uat", file)).mode & 0o777, 0o600);
  assert(!("ELASTICSEARCH_PASSWORD" in second));
});
test("UAT updates preserve configured concurrency limits", t => {
  const root = fixture(t);
  prepareUat(root, { revision, publicUrl: "http://localhost:19090" });
  const file = resolve(root, ".data/uat/runtime.env");
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/^LINKSENSE_MAX_CONCURRENT_CONVERSATIONS=.*$/mu, 'LINKSENSE_MAX_CONCURRENT_CONVERSATIONS="6"')
    .replace(/^LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT=.*$/mu, 'LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT="5"'));
  const updated = prepareUat(root, { revision: "b".repeat(40), publicUrl: "http://localhost:19090" });
  assert.equal(updated.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS, "6");
  assert.equal(updated.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT, "5");
});
test("UAT rejects invalid origins and cross-project credential reuse", t => {
  const root = fixture(t);
  for (const publicUrl of ["file:///tmp/config", "http://user:secret@example.test", "https://example.test/path", "https://example.test/?token=secret"]) assert.throws(() => prepareUat(root, { revision, publicUrl }));
  assert.throws(() => prepareUat(root, { revision, project: "../production", publicUrl: "http://localhost:19090" }));
  assert.throws(() => prepareUat(root, { revision: "main", publicUrl: "http://localhost:19090" }));
  prepareUat(root, { revision, publicUrl: "http://localhost:19090" });
  assert.throws(() => prepareUat(root, { revision, project: "other-uat", publicUrl: "http://localhost:19090" }), /another project/u);
});
test("proxy-loaded baseline aliases keep the frozen image digests in their identity", t => {
  const root = fixture(t);
  const original = prepareUat(root, { revision, publicUrl: "http://localhost:19090" });
  const cached = prepareUat(root, { revision, publicUrl: "http://localhost:19090", cachedBaselines: true });
  for (const role of ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY"]) assert.equal(cached[`${role}_IMAGE`], `linksense-uat-cache/${role.toLowerCase()}:${original[`${role}_IMAGE`].split("sha256:")[1]}`);
  assert.equal(cached.POSTGRES_PASSWORD, original.POSTGRES_PASSWORD);
});

test("UAT builds use relocated Dockerfiles without changing source roots or build targets", () => {
  const compose = parse(readFileSync(new URL("../deploy/uat/compose.yml", import.meta.url), "utf8"));
  for (const [service, dockerfile, target] of [
    ["migrate", "api", "migration"],
    ["worker-image", "runner", "worker"],
    ["runner", "runner", "controller"],
    ["api", "api", "runtime"],
    ["web", "web", "runtime"],
  ]) {
    const build = compose.services[service].build;
    assert.equal(build.context, "${LINKSENSE_SOURCE_ROOT}", service);
    assert.equal(build.dockerfile, `deploy/docker/Dockerfile.${dockerfile}`, service);
    assert.equal(build.target, target, service);
    assert.ok(statSync(new URL(`../${build.dockerfile}`, import.meta.url)).isFile(), service);
  }
});

function deploymentFixture(t, options = {}) {
  const root = fixture(t);
  const environment = prepareUat(root, { revision, publicUrl: "http://localhost:19090" });
  const preparedEnvironment = readFileSync(resolve(root, ".data/uat/runtime.env"), "utf8");
  if (options.schema === false) rmSync(resolve(root, ".data/uat/runtime.env"));
  const bin = resolve(root, "bin");
  mkdirSync(bin);
  mkdirSync(resolve(root, "deploy/uat"));
  copyFileSync(deployScript, resolve(root, "deploy/uat/deploy-uat.sh"));
  const stateFile = resolve(root, "state.json");
  writeFileSync(stateFile, JSON.stringify({ events: [], apiRunning: options.schema !== false, runnerRunning: options.schema !== false, checks: 0 }));
  const mock = `#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.UAT_TEST_STATE, "utf8"));
const options = JSON.parse(process.env.UAT_TEST_OPTIONS);
const save = event => { state.events.push(event); fs.writeFileSync(process.env.UAT_TEST_STATE, JSON.stringify(state)); };
if (path.basename(process.argv[1]) === "python3") {
  if (args[1].includes("runtimes")) process.stdout.write(JSON.parse(fs.readFileSync("deploy/baselines/images.lock.json", "utf8")).runtimes.node);
  else process.stdout.write(require("node:util").parseEnv(fs.readFileSync(".data/uat/runtime.env", "utf8"))["LINKSENSE_" + args.at(-1) + "_VOLUME"]);
} else if (args[0] === "info") process.stdout.write(process.cwd());
else if (args[0] === "volume") {
  if (options.schema === false && !fs.existsSync(".data/uat/runtime.env")) process.exit(1);
  if (args.includes("--format")) process.stdout.write(args.join(" ").includes("com.linksense.uat-project") ? "linksense-uat" : "local|null|linksense-production|critical|user-data");
} else if (args[0] === "run") {
  if (options.schema === false) {
    assert.equal(fs.existsSync(".data/uat/runtime.env"), false);
    save("prepare");
  }
  fs.writeFileSync(".data/uat/runtime.env", process.env.UAT_TEST_ENVIRONMENT, { mode: 0o600 });
} else if (args[0] === "pull" || args[0] === "buildx") {}
else if (args[0] === "compose") {
  const source = args.join(" ");
  if (args.includes("version") || args.includes("config")) {}
  else if (args.includes("build")) save("build");
  else if (args.includes("exec")) {
    if (source.includes("to_regclass")) process.stdout.write(options.schema === false ? "f" : "t");
    else if (source.includes("SELECT") && source.includes("conversation_turns")) {
      state.checks++;
      const count = (options.running ?? 0) +
        (source.includes("conversation_turn_start_intents") ? options.intents ?? 0 : 0) +
        (source.includes("automation_runs") && source.includes("dispatching") ? options.dispatching ?? 0 : 0) +
        (options.newTurnAfterCheck && state.checks > 1 ? 1 : 0);
      save("active:" + count);
      process.stdout.write(String(count));
    } else if (source.includes("pg_dump")) {
      save("backup");
      process.stdout.write("synthetic backup");
    } else if (source.includes("pg_restore")) save("verify-backup");
    else throw new Error("Unexpected exec: " + source);
  } else if (args.includes("stop")) {
    const services = args.slice(args.indexOf("stop") + 1).filter(value => ["api", "runner"].includes(value));
    for (const service of services) {
      save("stop:" + service);
      if (options.stopFailure === service) process.exit(1);
      state[service + "Running"] = false;
      save("stopped:" + service);
    }
  } else if (args.includes("ps")) {
    if (args.includes("--status")) {
      assert.equal(args[args.indexOf("--status") + 1], "running");
      process.stdout.write(options.stillRunning ? "api" : ["api", "runner"].filter(service => state[service + "Running"]).join("\\n"));
    }
  } else if (args.includes("up")) save(args.includes("redis") ? "infrastructure" : "activate");
  else throw new Error("Unexpected compose: " + source);
} else throw new Error("Unexpected command: " + args.join(" "));
`;
  for (const command of ["docker", "python3"]) writeFileSync(resolve(bin, command), mock, { mode: 0o755 });
  for (const [command, source] of Object.entries({
    git: `case "$1" in status) ;; rev-parse) printf '%s' '${revision}' ;; *) exit 1 ;; esac`,
    df: "printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 40000000 0 40000000 0%% /\\n'",
    timeout: 'shift\nexec "$@"',
    flock: "exit 0",
    curl: "exit 0",
  })) writeFileSync(resolve(bin, command), `#!/bin/sh\nset -eu\n${source}\n`, { mode: 0o755 });
  const result = spawnSync("sh", [resolve(root, "deploy/uat/deploy-uat.sh")], {
    cwd: root,
    env: { ...process.env, COMPOSE_PROJECT_NAME: "linksense-uat", LINKSENSE_HTTP_PORT: "19090", LINKSENSE_PUBLIC_BASE_URL: environment.LINKSENSE_PUBLIC_BASE_URL, LINKSENSE_UAT_BUILD_PROXY: "", LINKSENSE_UAT_CACHED_BASELINES: "0", PATH: `${bin}:${resolve(process.execPath, "..")}:${process.env.PATH}`, UAT_TEST_STATE: stateFile, UAT_TEST_OPTIONS: JSON.stringify(options), UAT_TEST_ENVIRONMENT: preparedEnvironment },
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.ifError(result.error);
  return { ...result, events: JSON.parse(readFileSync(stateFile, "utf8")).events };
}

test("UAT stops both database writers before rechecking active work and creating the backup", t => {
  const result = deploymentFixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ["build", "infrastructure", "active:0", "stop:api", "stopped:api", "stop:runner", "stopped:runner", "active:0", "backup", "verify-backup", "activate"]);
});

for (const options of [{ running: 1 }, { intents: 1 }, { dispatching: 1 }]) {
  test(`UAT refuses active work before stopping services: ${JSON.stringify(options)}`, t => {
    const result = deploymentFixture(t, options);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.events, ["build", "infrastructure", "active:1"]);
  });
}

test("UAT refuses work accepted after the first check before any backup or migration", t => {
  const result = deploymentFixture(t, { newTurnAfterCheck: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.events, ["build", "infrastructure", "active:0", "stop:api", "stopped:api", "stop:runner", "stopped:runner", "active:1"]);
});

for (const service of ["api", "runner"]) {
  test(`UAT never backs up or migrates when stopping ${service} fails`, t => {
    const result = deploymentFixture(t, { stopFailure: service });
    assert.notEqual(result.status, 0);
    assert.ok(result.events.includes(`stop:${service}`));
    assert.ok(!result.events.includes("backup") && !result.events.includes("activate"));
  });
}

test("UAT refuses a supposedly stopped runtime that still reports a running writer", t => {
  const result = deploymentFixture(t, { stillRunning: true });
  assert.notEqual(result.status, 0);
  assert.ok(!result.events.includes("backup") && !result.events.includes("activate"));
});

test("UAT first installation skips existing-runtime checks and backups", t => {
  const result = deploymentFixture(t, { schema: false });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ["prepare", "build", "infrastructure", "activate"]);
});
