import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { benchmarkOptions, measureDevelopmentStartup, summarizeStartup } from "./dev-benchmark.mjs";

test("benchmark validates its mode, sample count and startup budget", () => {
  assert.deepEqual(benchmarkOptions([]), { runs: 5, mode: "restart", "budget-ms": 10_000 });
  assert.equal(benchmarkOptions(["--mode=reattach", "--runs=2"]).runs, 2);
  for (const args of [["--runs=0"], ["--runs=31"], ["--mode=invalid"], ["--budget-ms=0"], ["--unknown=true"]]) assert.throws(() => benchmarkOptions(args));
});

test("startup budget uses command wall time and fails if any sample exceeds ten seconds", () => {
  const report = summarizeStartup([9_000, 6_000, 7_000, 10_001, 8_000].map((wall_ms) => ({ wall_ms, duration_ms: wall_ms - 100, stages: {} })), 10_000);
  assert.equal(report.p50_ms, 8_000);
  assert.equal(report.p95_ms, 10_001);
  assert.equal(report.max_ms, 10_001);
  assert.equal(report.passed, false);
  assert.throws(() => summarizeStartup([], 10_000));
});

test("benchmark waits for a complete readiness report and stops its own command", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit("close", 0) });
  let clock = 100;
  const result = measureDevelopmentStartup({ launch: () => child, now: () => clock, timeoutMs: 1_000 });
  child.stdout.write('LINKSENSE_DEV_READY {"duration_ms":700,"stages":');
  clock = 950;
  child.stdout.write('{"readiness":300}}\n');
  assert.deepEqual(await result, { wall_ms: 850, duration_ms: 700, stages: { readiness: 300 } });
});

test("benchmark fails when startup exits without becoming ready", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => undefined });
  const result = measureDevelopmentStartup({ launch: () => child, timeoutMs: 1_000 });
  child.emit("close", 1);
  await assert.rejects(result, /before all services/u);
});

test("benchmark forcibly stops an unresponsive command after its startup deadline", async () => {
  const signals = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    kill: (signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") child.emit("close", null);
    },
  });
  await assert.rejects(measureDevelopmentStartup({ launch: () => child, timeoutMs: 10, stopGraceMs: 10 }), /timed out/u);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("benchmark rejects invalid readiness data instead of reporting success", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit("close", 0) });
  const result = measureDevelopmentStartup({ launch: () => child });
  child.stdout.write('LINKSENSE_DEV_READY {"duration_ms":-1,"stages":{}}\n');
  await assert.rejects(result, /invalid timing report/u);
});
