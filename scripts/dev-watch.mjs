import { execFile, spawn } from "node:child_process";
import { dirname, isAbsolute, matchesGlob, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import chokidar from "chokidar";
import { z } from "zod";
import { buildDevelopmentEnvironment, developmentComposeArguments, developmentImageBuildEnvironment, dockerImageLabel, waitForDevelopmentApplicationReadiness } from "./dev.mjs";
import { buildDevelopmentImageGroups, planDevelopmentImageBuilds, reportDevelopmentImageCleanup } from "./dev-images.mjs";
import { trustDevelopmentCertificate } from "./dev-tls.mjs";
import { developmentSourcePaths } from "./dev-source.mjs";

const applicationServices = ["api", "runner", "web", "docs", "dev-gateway"];
const priority = { sync: 0, restart: 1, "sync+restart": 1, rebuild: 2 };
const ruleSchema = z.object({
  action: z.enum(["sync", "restart", "sync+restart", "rebuild"]),
  path: z.string().refine(isAbsolute),
  ignore: z.array(z.string()).default([]),
});

export function developmentWatchRules(config) {
  const parsed = z.object({ services: z.record(z.string(), z.object({
    develop: z.object({ watch: z.array(ruleSchema) }).optional(),
  })) }).parse(config);
  return applicationServices.flatMap((service) =>
    (parsed.services[service]?.develop?.watch ?? []).map((rule) => ({ ...rule, service })),
  );
}

function matchesRule(rule, file) {
  const path = relative(rule.path, file).split(sep).join("/");
  if (path === ".." || path.startsWith("../") || isAbsolute(path)) return false;
  return !rule.ignore.some((pattern) => {
    const normalized = pattern.replace(/\/$/u, "");
    return matchesGlob(path, normalized) || matchesGlob(path, `${normalized}/**`);
  });
}

function ignoreWatchPath(rules, file) {
  if (/(?:^|[/\\])(?:node_modules|\.git|\.DS_Store)(?:[/\\]|$)/u.test(file)) return true;
  const enclosing = rules.filter((rule) => {
    const path = relative(rule.path, file);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  });
  return enclosing.length > 0 && enclosing.every((rule) => !matchesRule(rule, file));
}

export function planDevelopmentChanges(rules, files) {
  const actions = new Map();
  for (const rule of rules) {
    if (!files.some((file) => matchesRule(rule, file))) continue;
    if (!actions.has(rule.service) || priority[rule.action] > priority[actions.get(rule.service)]) {
      actions.set(rule.service, rule.action);
    }
  }
  return [...actions].map(([service, action]) => ({ service, action }));
}

export async function applyDevelopmentChanges(plan, { rebuild, compose, synchronize, waitUntilReady }) {
  const requested = plan.filter(({ action }) => action === "rebuild").map(({ service }) => service);
  if (requested.length > 0) {
    // Build with fresh fingerprints, once per shared dependency group. Do not
    // replace any service until every build in this batch has succeeded.
    const rebuilt = await rebuild(requested);
    // Native Watch converges the entire selected project, then starts only
    // changed services. Explicit up --no-deps confines both steps to this batch.
    await compose(["up", "-d", "--no-build", "--no-deps", ...rebuilt]);
    const actions = new Map(plan.map(({ service, action }) => [service, action]));
    for (const service of rebuilt) actions.set(service, "rebuild");
    plan = [...actions].map(([service, action]) => ({ service, action }));
  }
  const restarts = await Promise.all(plan.map(async ({ service, action }) => {
    if (action === "restart") return service;
    if (!(service in developmentSourcePaths)) return null;
    // Reconcile again after a build: edits made during image creation must
    // reach the new container even if they were synced into its predecessor.
    const { changed } = z.object({ changed: z.boolean() }).parse(await synchronize(service));
    return changed && action !== "sync" ? service : null;
  }));
  const services = restarts.filter(Boolean);
  if (services.length > 0) await compose(["restart", "--no-deps", ...services]);
  await waitUntilReady();
}

export function startDevelopmentWatcher(rules, { apply, onUpdateError, watch = chokidar.watch, debounceMs = 200 }) {
  const watcher = watch([...new Set(rules.map(({ path }) => path))], {
    ignoreInitial: true,
    followSymlinks: false,
    atomic: true,
    ignored: (file) => ignoreWatchPath(rules, file),
  });
  const ready = Promise.withResolvers();
  const completion = Promise.withResolvers();
  const pending = new Set();
  let timer;
  let active = null;
  let closing = null;
  let scanned = false;
  const close = (error) => {
    if (closing) return closing;
    clearTimeout(timer);
    pending.clear();
    if (!scanned) ready.reject(error ?? new Error("Development watch stopped before it was ready"));
    closing = Promise.resolve().then(async () => {
      await watcher.close();
      await active;
    });
    void closing.then(() => error ? completion.reject(error) : completion.resolve(), completion.reject);
    return closing;
  };
  const flush = () => {
    if (closing || active || pending.size === 0) return;
    const files = [...pending];
    const plan = planDevelopmentChanges(rules, files);
    pending.clear();
    active = Promise.resolve().then(() => apply(plan));
    void active.then(() => {
      active = null;
      if (pending.size > 0 && !closing) timer = setTimeout(flush, debounceMs);
    }, (error) => {
      active = null;
      if (!onUpdateError) { void close(error); return; }
      try { onUpdateError(error); } catch (reportError) { void close(reportError); return; }
      // A failed build or readiness check is visible, but must not discard a
      // correcting edit or other services in this batch. Keep the failed inputs
      // pending, and retry only when a new edit arrives (including queued edits).
      const hasNewEdits = pending.size > 0;
      if (!closing) {
        for (const file of files) pending.add(file);
        if (hasNewEdits) timer = setTimeout(flush, debounceMs);
      }
    });
  };
  watcher.on("all", (_event, file) => {
    if (closing || planDevelopmentChanges(rules, [file]).length === 0) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });
  watcher.once("ready", () => { scanned = true; ready.resolve(); });
  watcher.on("error", (error) => { void close(error); });
  // A caller may still be waiting for initial scan when the session fails.
  void ready.promise.catch(() => undefined);
  void completion.promise.catch(() => undefined);
  return { ready: ready.promise, completion: completion.promise, close: () => close() };
}

async function main(environmentFile) {
  trustDevelopmentCertificate(buildDevelopmentEnvironment(process.env));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let composeEnvironment = process.env;
  const controller = new AbortController();
  const capture = async (command, args) => (await promisify(execFile)(command, args, {
    cwd: root, env: composeEnvironment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, signal: controller.signal,
  })).stdout;
  const composeArgs = (args) => developmentComposeArguments(environmentFile, args);
  const rules = developmentWatchRules(JSON.parse(await capture("docker", composeArgs(["config", "--format", "json"]))));
  const compose = (args) => new Promise((resolveCommand, rejectCommand) => {
    const child = spawn("docker", composeArgs(args), {
      cwd: root, env: composeEnvironment, stdio: "inherit", signal: controller.signal,
      timeout: 600_000, killSignal: "SIGTERM",
    });
    child.once("error", rejectCommand);
    child.once("close", (code) => code === 0 ? resolveCommand() : rejectCommand(new Error(`Development ${args[0]} failed (exit ${code})`)));
  });
  const session = startDevelopmentWatcher(rules, {
    onUpdateError: (error) => {
      if (!controller.signal.aborted) console.error(`[dev] update failed: ${error instanceof Error ? error.message : "unknown error"}. Watching for the next edit.`);
    },
    apply: async (plan) => {
      if (plan.length === 0) return;
      console.log(`[dev] updating ${plan.map(({ service, action }) => `${service} (${action})`).join(", ")}`);
      await applyDevelopmentChanges(plan, {
        rebuild: async (services) => {
          composeEnvironment = developmentImageBuildEnvironment(environmentFile, composeEnvironment);
          const groups = planDevelopmentImageBuilds(composeEnvironment, services, dockerImageLabel);
          return buildDevelopmentImageGroups(groups, (group) => compose(["build", ...group]));
        },
        compose,
        waitUntilReady: () => waitForDevelopmentApplicationReadiness(buildDevelopmentEnvironment(process.env), {
          signal: controller.signal, timeoutMs: 60_000, intervalMs: 1_000, requestTimeoutMs: 2_000,
        }),
        synchronize: async (service) => {
          const container = z.string().regex(/^[a-f0-9]{12,64}$/u).parse((await capture("docker", composeArgs(["ps", "--status", "running", "--format", "{{.ID}}", service]))).trim());
          return JSON.parse(await capture(process.execPath, [resolve(root, "scripts/dev-source.mjs"), service, container]));
        },
      });
      if (plan.some(({ action }) => action === "rebuild")) await reportDevelopmentImageCleanup(composeEnvironment);
      console.log("[dev] update complete");
    },
  });
  const stop = () => {
    controller.abort();
    void session.close().catch(() => undefined);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await session.ready;
    console.log("Watch enabled");
    await session.completion;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await session.close().catch((error) => {
      if (!controller.signal.aborted) throw error;
    });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main(z.string().min(1).parse(process.argv[2])).catch((error) => {
    console.error(`Development source watch failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
