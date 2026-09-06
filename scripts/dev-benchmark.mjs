import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sampleSchema = z.object({ duration_ms: z.number().nonnegative(), stages: z.record(z.string(), z.number().nonnegative()) });

export function benchmarkOptions(args) {
  const values = {};
  for (const arg of args) {
    const match = /^--(runs|mode|budget-ms)=(.+)$/u.exec(arg);
    if (!match) throw new Error("Use --runs=5 --mode=restart|reattach|recreate --budget-ms=10000");
    values[match[1]] = match[2];
  }
  return z.object({
    runs: z.coerce.number().int().min(1).max(30).default(5),
    mode: z.enum(["restart", "reattach", "recreate"]).default("restart"),
    "budget-ms": z.coerce.number().int().min(1).default(10_000),
  }).parse(values);
}

export function summarizeStartup(samples, budgetMs) {
  const parsed = z.array(sampleSchema.extend({ wall_ms: z.number().nonnegative() })).min(1).parse(samples);
  const values = parsed.map((sample) => sample.wall_ms).sort((a, b) => a - b);
  return {
    runs: values.length,
    budget_ms: budgetMs,
    p50_ms: values[Math.ceil(values.length * 0.5) - 1],
    p95_ms: values[Math.ceil(values.length * 0.95) - 1],
    max_ms: values.at(-1),
    passed: values.every((value) => value <= budgetMs),
    samples: parsed,
  };
}

export function measureDevelopmentStartup({ launch = spawn, now = () => performance.now(), timeoutMs = 300_000, stopGraceMs = 5_000 } = {}) {
  return new Promise((resolveSample, rejectSample) => {
    const started = now();
    const detached = process.platform !== "win32";
    const child = launch("pnpm", ["dev"], { cwd: root, env: process.env, detached, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let sample;
    let failure;
    let stopped = false;
    let closed = false;
    let killTimer;
    const signal = (name) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (error.code !== "ESRCH") failure ??= error;
      }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      signal("SIGTERM");
      if (!closed) killTimer = setTimeout(() => signal("SIGKILL"), stopGraceMs);
    };
    const timer = setTimeout(() => {
      failure = new Error("Development startup benchmark timed out");
      stop();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      if (buffer.length > 65_536) {
        failure = new Error("Development startup returned an oversized output line");
        buffer = "";
        stop();
      }
      for (const line of lines) {
        if (line.startsWith("[dev]")) console.log(line);
        if (!line.startsWith("LINKSENSE_DEV_READY ") || sample) continue;
        try {
          sample = { ...sampleSchema.parse(JSON.parse(line.slice("LINKSENSE_DEV_READY ".length))), wall_ms: Math.round(now() - started) };
        } catch {
          failure = new Error("Development startup returned an invalid timing report");
        }
        stop();
      }
    });
    child.stderr.resume();
    child.once("error", (error) => { clearTimeout(timer); clearTimeout(killTimer); rejectSample(error); });
    child.once("close", () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (failure) rejectSample(failure);
      else if (sample) resolveSample(sample);
      else rejectSample(new Error("pnpm dev exited before all services became ready"));
    });
  });
}

async function main() {
  const options = benchmarkOptions(process.argv.slice(2));
  const run = (script) => {
    const result = spawnSync("pnpm", [script], { cwd: root, env: process.env, stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error(`${script} failed`);
  };
  run("dev:prepare");
  const samples = [];
  for (let index = 0; index < options.runs; index++) {
    if (options.mode === "restart") run("dev:stop");
    if (options.mode === "recreate") run("dev:down");
    console.log(`[benchmark] ${options.mode} ${index + 1}/${options.runs}`);
    samples.push(await measureDevelopmentStartup());
  }
  const report = { mode: options.mode, ...summarizeStartup(samples, options["budget-ms"]) };
  mkdirSync(resolve(root, ".data/dev"), { recursive: true });
  writeFileSync(resolve(root, `.data/dev/startup-benchmark-${options.mode}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
