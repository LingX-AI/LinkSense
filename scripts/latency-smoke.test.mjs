import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeBenchmarkUrl,
  evaluateLatencyTargets,
  findProjectedTurn,
  percentile,
  runLatencySmoke,
  summarizeDurations,
  unwrapData,
} from "./latency-smoke.mjs";

test("latency summaries use nearest-rank percentiles without mutating samples", () => {
  const samples = [400, 10, 200, 20, 30];
  assert.equal(percentile(samples, 0.5), 30);
  assert.equal(percentile(samples, 0.95), 400);
  assert.deepEqual(samples, [400, 10, 200, 20, 30]);
  assert.deepEqual(summarizeDurations(samples), {
    count: 5,
    min_ms: 10,
    mean_ms: 132,
    p50_ms: 30,
    p95_ms: 400,
    max_ms: 400,
  });
});

test("benchmark URLs reject plaintext remote token transport", () => {
  assert.equal(
    assertSafeBenchmarkUrl("http://127.0.0.1:4000/api/v1", "API").href,
    "http://127.0.0.1:4000/api/v1/",
  );
  assert.equal(
    assertSafeBenchmarkUrl("https://linksense.example/api/v1", "API").href,
    "https://linksense.example/api/v1/",
  );
  assert.throws(
    () => assertSafeBenchmarkUrl("http://linksense.example/api", "API"),
    /must use HTTPS/u,
  );
});

test("conversation projection lookup accepts both detail envelope shapes", () => {
  const turn = { id: "turn-a", status: "running" };
  assert.equal(
    findProjectedTurn({ data: { turns: [turn] } }, "turn-a"),
    turn,
  );
  assert.equal(
    findProjectedTurn(
      { data: { conversation: { turns: [turn] } } },
      "turn-a",
    ),
    turn,
  );
  assert.equal(findProjectedTurn({ data: { turns: [] } }, "turn-a"), null);
  assert.deepEqual(unwrapData({ data: { accepted: true } }), {
    accepted: true,
  });
});

test("target evaluation separates prewarm, acceptance, and warm projection", () => {
  assert.deepEqual(
    evaluateLatencyTargets(
      {
        prewarm: {
          first_observed_ms: 2_001,
          warm: { p95_ms: 301 },
        },
        turns: [
          { acceptance_ms: 100, projection_ms: 2_000 },
          { acceptance_ms: 350, projection_ms: 1_001 },
        ],
      },
      {
        workerPrewarmMs: 2_000,
        warmPrewarmMs: 300,
        turnAcceptanceMs: 300,
        warmProjectionMs: 1_000,
      },
    ),
    [
      "first observed worker prewarm 2001ms exceeds 2000ms",
      "warm prewarm p95 301ms exceeds 300ms",
      "turn acceptance p95 350ms exceeds 300ms",
      "warm native projection p95 1001ms exceeds 1000ms",
    ],
  );
});

test("default smoke mode only calls the authenticated prewarm endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(
      JSON.stringify({ data: { accepted: true }, request_id: "request-a" }),
      {
        status: 202,
        headers: { "content-type": "application/json" },
      },
    );
  };
  try {
    const { result } = await runLatencySmoke({
      LINKSENSE_LATENCY_ACCESS_TOKEN: "test-token-never-printed",
      LINKSENSE_LATENCY_PREWARM_SAMPLES: "2",
    });
    assert.equal(result.turns.length, 0);
    assert.equal(calls.length, 2);
    assert.ok(
      calls.every(
        (call) =>
          call.url ===
            "http://127.0.0.1:4000/api/v1/conversations/prewarm" &&
          call.options.method === "POST" &&
          call.options.headers.authorization ===
            "Bearer test-token-never-printed",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
