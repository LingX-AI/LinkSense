// Isolated Docker integration check; does not use the developer's Compose
// project, ports, credentials, or persistent volumes.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { applyDevelopmentChanges, developmentWatchRules, startDevelopmentWatcher } from "./dev-watch.mjs";
import { waitForWatchEnabled } from "./dev.mjs";

const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "linksense-watch-smoke-"));
const project = `linksense-watch-smoke-${process.pid}`;
const services = ["api", "runner", "web", "docs"];
const composeArgs = ["compose", "-p", project, "-f", join(directory, "compose.json")];
const compose = async (args) => (await execute("docker", [...composeArgs, ...args], {
  timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
})).stdout;
const snapshot = async () => (await compose(["ps", "-a", "--format", "{{json .}}"])).trim().split("\n").map((line) => JSON.parse(line));
let watcher;
let nativeWatch;
try {
  const config = { services: {} };
  for (const service of services) {
    await mkdir(join(directory, service));
    await writeFile(join(directory, service, "Dockerfile"), 'FROM alpine:3.22\nCOPY trigger.txt /trigger.txt\nCMD ["sleep", "600"]\n');
    await writeFile(join(directory, service, "trigger.txt"), service);
    config.services[service] = {
      image: `${project}-${service}`,
      build: { context: `./${service}` },
      stop_grace_period: "1s",
      develop: { watch: [{ path: `./${service}/trigger.txt`, action: "rebuild" }] },
    };
  }
  await writeFile(join(directory, "compose.json"), JSON.stringify(config));
  await compose(["up", "-d", "--build"]);
  const initial = await snapshot();
  // An unrelated service differs from the Watch session's desired model,
  // as after an independent worker/image refresh. It must stay untouched.
  config.services.runner.environment = { TEST_REVISION: "changed" };
  await writeFile(join(directory, "compose.json"), JSON.stringify(config));
  if (process.argv.includes("--native-watch")) {
    nativeWatch = spawn("docker", [...composeArgs, "watch", "--no-up", ...services], { stdio: ["ignore", "pipe", "pipe"] });
    const ready = waitForWatchEnabled(nativeWatch);
    nativeWatch.stdout.resume();
    nativeWatch.stderr.resume();
    await ready;
  } else {
    const rules = developmentWatchRules(JSON.parse(await compose(["config", "--format", "json"])));
    watcher = startDevelopmentWatcher(rules, {
      apply: (plan) => applyDevelopmentChanges(plan, {
        compose,
        synchronize: async () => { assert.fail("docs has no source synchronization"); },
        waitUntilReady: async () => {
          const containers = await snapshot();
          for (const service of services) assert.equal(containers.find(({ Service }) => Service === service)?.State, "running");
        },
      }),
    });
    await watcher.ready;
  }
  let previous = initial;
  for (let iteration = 1; iteration <= 3; iteration++) {
    await writeFile(join(directory, "docs", "trigger.txt"), `revision ${iteration}`);
    const deadline = Date.now() + 180_000;
    let current;
    do {
      await Promise.race([
        delay(200),
        ...(watcher ? [watcher.completion.then(() => { throw new Error("Watcher stopped during rebuild"); })] : []),
      ]);
      current = await snapshot();
      const docs = current.find(({ Service }) => Service === "docs");
      if (docs?.State === "running" && docs.ID !== previous.find(({ Service }) => Service === "docs").ID) break;
    } while (Date.now() < deadline);
    for (const service of services) {
      const actual = current.find(({ Service }) => Service === service);
      assert.equal(actual?.State, "running", `${service} after docs rebuild ${iteration}`);
      if (service === "docs") {
        assert.notEqual(actual.ID, previous.find(({ Service }) => Service === service).ID);
      } else {
        assert.equal(actual.ID, initial.find(({ Service }) => Service === service).ID, `${service} must not be recreated`);
      }
    }
    previous = current;
    console.log(`docs rebuild ${iteration}: API, runner and Web remain running with unchanged container IDs`);
  }
} finally {
  if (nativeWatch && nativeWatch.exitCode === null) {
    const closed = new Promise((resolve) => nativeWatch.once("close", resolve));
    nativeWatch.kill("SIGTERM");
    await closed;
  }
  await watcher?.close().catch(() => undefined);
  await compose(["down"]);
  await execute("docker", ["image", "rm", ...services.map((service) => `${project}-${service}`)], { timeout: 30_000 });
  await rm(directory, { recursive: true, force: true });
}
