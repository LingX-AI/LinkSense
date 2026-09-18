import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { developmentWatchRules, planDevelopmentChanges, applyDevelopmentChanges, startDevelopmentWatcher } from "./dev-watch.mjs";

const rule = (service, action, path, ignore = []) => ({ service, action, path: resolve(path), ignore });

test("gateway configuration edits restart only the bound gateway and await readiness", async () => {
  const rules = developmentWatchRules({ services: {
    "dev-gateway": { develop: { watch: [{ action: "restart", path: resolve("deploy/development/nginx") }] } },
  } });
  const calls = [];
  await applyDevelopmentChanges(planDevelopmentChanges(rules, [resolve("deploy/development/nginx/default.conf")]), {
    compose: async (args) => { calls.push(args); },
    synchronize: async () => { assert.fail("gateway uses a read-only directory mount"); },
    waitUntilReady: async () => { calls.push(["ready"]); },
  });
  assert.deepEqual(calls, [["restart", "--no-deps", "dev-gateway"], ["ready"]]);
});

test("a docs rebuild only creates and starts docs even when other service configurations differ", async () => {
  const rules = [rule("docs", "rebuild", "apps/docs"), rule("runner", "rebuild", "apps/runner/package.json")];
  const commands = [];
  await applyDevelopmentChanges(planDevelopmentChanges(rules, [resolve("apps/docs/docs/page.md")]), {
    compose: async (args) => { commands.push(args); },
    synchronize: async () => { assert.fail("docs does not use source sync"); },
    waitUntilReady: async () => {},
  });
  assert.deepEqual(commands, [["build", "docs"], ["up", "-d", "--no-build", "--no-deps", "docs"]]);
});

test("shared edits restart all source processes only after every transfer finishes, then await readiness", async () => {
  const rules = [rule("api", "sync+restart", "packages/shared/src"), rule("runner", "sync+restart", "packages/shared/src"), rule("web", "sync+restart", "packages/shared/src")];
  const calls = [];
  await applyDevelopmentChanges(planDevelopmentChanges(rules, [resolve("packages/shared/src/new.ts")]), {
    compose: async (args) => { calls.push(args); },
    synchronize: async (service) => { calls.push(["sync", service]); return { changed: true }; },
    waitUntilReady: async () => { calls.push(["ready"]); },
  });
  assert.deepEqual(calls, [["sync", "api"], ["sync", "runner"], ["sync", "web"], ["restart", "--no-deps", "api", "runner", "web"], ["ready"]]);
});

test("a docs rebuild cannot report success while the API is unavailable", async () => {
  let probes = 0;
  await assert.rejects(applyDevelopmentChanges([{ service: "docs", action: "rebuild" }], {
    compose: async () => {},
    synchronize: async () => { assert.fail("docs has no source sync"); },
    waitUntilReady: async () => { probes++; throw new Error("API unavailable"); },
  }), /API unavailable/);
  assert.equal(probes, 1);
});

test("even an unchanged source batch waits for readiness instead of concealing an exited API", async () => {
  await assert.rejects(applyDevelopmentChanges([{ service: "api", action: "sync+restart" }], {
    compose: async () => { assert.fail("unchanged source does not restart"); },
    synchronize: async () => ({ changed: false }),
    waitUntilReady: async () => { throw new Error("API unavailable"); },
  }), /API unavailable/);
});

test("dependency rebuilds finish sequentially before replacing any running service", async () => {
  const calls = [];
  await assert.rejects(applyDevelopmentChanges([
    { service: "api", action: "rebuild" }, { service: "docs", action: "rebuild" },
  ], {
    compose: async (args) => {
      calls.push(args);
      if (args.includes("docs")) throw new Error("docs build failed");
    },
    synchronize: async () => { assert.fail("build failed"); },
    waitUntilReady: async () => { assert.fail("build failed"); },
  }), /docs build failed/);
  assert.deepEqual(calls, [["build", "api"], ["build", "docs"]]);
});

test("rebuilds coalesce duplicate events and reconcile edits made during a build", async () => {
  const rules = [rule("api", "rebuild", "package.json"), rule("api", "sync+restart", "apps/api/tsconfig.json")];
  const calls = [];
  await applyDevelopmentChanges(planDevelopmentChanges(rules, [resolve("package.json"), resolve("package.json"), resolve("apps/api/tsconfig.json")]), {
    compose: async (args) => { calls.push(args); },
    synchronize: async (service) => { calls.push(["sync", service]); return { changed: true }; },
    waitUntilReady: async () => {},
  });
  assert.deepEqual(calls, [["build", "api"], ["up", "-d", "--no-build", "--no-deps", "api"], ["sync", "api"], ["restart", "--no-deps", "api"]]);
});

test("generated files and similarly named sibling paths never trigger changes", () => {
  const rules = [rule("api", "sync", "apps/api/src", ["generated/"]), rule("docs", "rebuild", "apps/docs", ["node_modules/", "build/", ".docusaurus/"])];
  for (const path of ["apps/api/src/generated/client.ts", "apps/api/src-other/index.ts", "apps/docs/node_modules/pkg/index.js", "apps/docs/build/index.html", "apps/docs/.docusaurus/cache.js"]) {
    assert.deepEqual(planDevelopmentChanges(rules, [resolve(path)]), []);
  }
  assert.equal(planDevelopmentChanges(rules, [resolve("apps/api/src/new.ts")])[0].service, "api");
});

test("watch rules validate actions and only select application services", () => {
  assert.deepEqual(developmentWatchRules({ services: { docs: { develop: { watch: [{ action: "rebuild", path: "/docs" }] } }, migrate: {} } }), [rule("docs", "rebuild", "/docs")]);
  assert.throws(() => developmentWatchRules({ services: { docs: { develop: { watch: [{ action: "unknown", path: "/docs" }] } } } }));
});

test("a failed build never replaces the running service", async () => {
  const calls = [];
  await assert.rejects(applyDevelopmentChanges([{ service: "api", action: "rebuild" }], {
    compose: async (args) => { calls.push(args); throw new Error("build failed"); },
    synchronize: async () => { assert.fail("build failed"); },
  }), /build failed/);
  assert.deepEqual(calls, [["build", "api"]]);
});

test("watch batches serialize and retain edits arriving while a build is in flight", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const watcher = Object.assign(new EventEmitter(), { close: async () => {} });
  const release = Promise.withResolvers();
  const firstStarted = Promise.withResolvers();
  const secondStarted = Promise.withResolvers();
  const started = [];
  const session = startDevelopmentWatcher([rule("docs", "rebuild", "apps/docs")], {
    watch: () => watcher,
    debounceMs: 0,
    apply: async (plan) => {
      started.push(plan);
      if (started.length === 1) {
        firstStarted.resolve();
        await release.promise;
      } else secondStarted.resolve();
    },
  });
  watcher.emit("ready");
  await session.ready;
  watcher.emit("all", "change", resolve("apps/docs/first.md"));
  context.mock.timers.tick(1);
  await firstStarted.promise;
  watcher.emit("all", "unlink", resolve("apps/docs/deleted.md"));
  context.mock.timers.tick(1);
  assert.equal(started.length, 1);
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(1);
  await secondStarted.promise;
  assert.equal(started.length, 2);
  await session.close();
  await session.completion;
});

test("watch errors reject the session and close the watcher", async () => {
  let closed = false;
  const watcher = Object.assign(new EventEmitter(), { close: async () => { closed = true; } });
  const session = startDevelopmentWatcher([], { watch: () => watcher, apply: async () => {} });
  const failed = assert.rejects(session.completion, /watch failed/);
  const notReady = assert.rejects(session.ready, /watch failed/);
  watcher.emit("error", new Error("watch failed"));
  await Promise.all([failed, notReady]);
  assert.equal(closed, true);
});

test("a failed update is reported and a queued correcting edit runs once without automatic retries", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let closed = false;
  const watcher = Object.assign(new EventEmitter(), { close: async () => { closed = true; } });
  const release = Promise.withResolvers();
  const calls = [];
  const failures = [];
  const session = startDevelopmentWatcher([rule("api", "rebuild", "package.json")], {
    watch: () => watcher,
    debounceMs: 0,
    onUpdateError: (error) => { failures.push(error.message); },
    apply: async (plan) => {
      calls.push(plan);
      if (calls.length === 1) { await release.promise; throw new Error("lockfile incomplete"); }
    },
  });
  watcher.emit("ready");
  await session.ready;
  watcher.emit("all", "change", resolve("package.json"));
  context.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  watcher.emit("all", "change", resolve("package.json"));
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, ["lockfile incomplete"]);
  assert.equal(closed, false);
  context.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  context.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  await session.close();
});

test("a correcting docs edit retains every service in a previously failed dependency batch", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const watcher = Object.assign(new EventEmitter(), { close: async () => {} });
  const calls = [];
  const session = startDevelopmentWatcher([
    rule("api", "rebuild", "package.json"), rule("docs", "rebuild", "package.json"), rule("docs", "rebuild", "apps/docs"),
  ], {
    watch: () => watcher, debounceMs: 0, onUpdateError: () => {},
    apply: async (plan) => { calls.push(plan); if (calls.length === 1) throw new Error("docs failed"); },
  });
  watcher.emit("ready");
  await session.ready;
  watcher.emit("all", "change", resolve("package.json"));
  context.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "failure alone must not trigger a retry loop");
  watcher.emit("all", "change", resolve("apps/docs/fix.md"));
  context.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls[1], calls[0], "API's pending dependency update must not be lost");
  await session.close();
});

test("closing source watch cancels pending changes without running another batch", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const watcher = Object.assign(new EventEmitter(), { close: async () => {} });
  const session = startDevelopmentWatcher([rule("docs", "rebuild", "apps/docs")], {
    watch: () => watcher,
    apply: async () => { assert.fail("closed watcher must not rebuild"); },
  });
  watcher.emit("ready");
  await session.ready;
  watcher.emit("all", "change", resolve("apps/docs/page.md"));
  await session.close();
  context.mock.timers.tick(1_000);
  await session.completion;
});
