import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { performance } from "node:perf_hooks";

import {
  assertSafeBenchmarkUrl,
  evaluateLatencyTargets,
  findProjectedTurn,
  percentile,
  isAssistantTextDelta,
  observeFirstText,
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
          { sample: 1, acceptance_ms: 100, projection_ms: 2_000, first_text_ms: 900, final_status: "completed" },
          { sample: 2, acceptance_ms: 350, projection_ms: 1_001, first_text_ms: 900, final_status: "completed" },
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

test("first text targets reject every breach, missing text, and unsuccessful turn", () => {
  const turns = [
    { sample: 1, kind: "new_task", first_text_ms: 3001, final_status: "completed" },
    { sample: 2, kind: "follow_up", first_text_ms: 1001, final_status: "completed" },
    { sample: 3, kind: "follow_up", first_text_ms: null, final_status: "completed" },
    { sample: 4, kind: "follow_up", first_text_ms: 50, final_status: "failed" },
  ];
  assert.deepEqual(evaluateLatencyTargets({ turns }, {}), [
    "turn 1 new_task first text 3001ms exceeds 3000ms",
    "turn 2 follow_up first text 1001ms exceeds 1000ms",
    "turn 3 has no valid first text measurement",
    "turn 4 ended with failed",
  ]);
  assert.deepEqual(evaluateLatencyTargets({ turns: [
    { sample: 1, kind: "new_task", first_text_ms: 3000, final_status: "completed" },
    { sample: 2, kind: "follow_up", first_text_ms: 1000, final_status: "completed" },
  ] }, {}), []);
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
    assert.equal(calls.length, 1);
    assert.equal(result.prewarm.boundary, "prewarm_enqueue_receipt");
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


test("first text ignores other turns, reasoning, tools and empty deltas", () => {
  const event = { turn_id: "turn-a", event_type: "item/agentMessage/delta", payload: { params: { delta: "hello" } } };
  assert.equal(isAssistantTextDelta(event, "turn-a"), true);
  assert.equal(isAssistantTextDelta(event, "turn-b"), false);
  assert.equal(isAssistantTextDelta({ ...event, event_type: "item/reasoning/summaryTextDelta" }, "turn-a"), false);
  assert.equal(isAssistantTextDelta({ ...event, payload: { params: { delta: "" } } }, "turn-a"), false);
  assert.equal(isAssistantTextDelta({ ...event, payload: { params: { delta: " \n " } } }, "turn-a"), false);
  assert.equal(isAssistantTextDelta({ ...event, event_type: "conversation.message.delta", payload: { delta: "hello", role: "user" } }, "turn-a"), false);
});

test("first text is measured from fragmented SSE and closes the stream", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  const event = { turn_id: "turn-a", event_type: "item/agentMessage/delta", payload: { params: { delta: "你好" } } };
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoded.slice(0, 70)); controller.enqueue(encoded.slice(70)); },
    cancel() { cancelled = true; },
  }));
  try {
    const result = await observeFirstText(new URL("http://127.0.0.1/events"), {}, "turn-a", performance.now(), new AbortController().signal);
    assert.equal(typeof result, "number");
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = originalFetch; }
});

for (const prewarm of [true, false]) test(`turn benchmark includes creation and drains terminal SSE (${prewarm ? "prewarm" : "cold project"})`, async () => {
  let clock = 0;
  const now = mock.method(performance, "now", () => clock);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ path: url.pathname, ...options });
    const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status });
    if (url.pathname.endsWith('/prewarm')) return json({ accepted: true, conversation_id: 'reserved-task' }, 202);
    if (url.pathname.endsWith('/conversations/')) {
      clock += 400;
      assert.deepEqual(JSON.parse(options.body), prewarm
        ? { prewarmed_conversation_id: 'reserved-task', collaboration_mode: 'default' }
        : { project_id: 'project-id', collaboration_mode: 'plan' });
      return json({ id: 'reserved-task' }, 201);
    }
    if (url.pathname.endsWith('/turns')) {
      assert.equal('draft_policy' in JSON.parse(options.body), false);
      return json({ accepted: true, status: 'starting', turn_id: 'test-turn' }, 202);
    }
    if (url.pathname.endsWith('/events')) {
      clock += 200;
      const data = new TextEncoder().encode(`data: ${JSON.stringify({ turn_id: 'test-turn', event_type: 'item/agentMessage/delta', payload: { params: { delta: 'OK' } } })}\n\n`);
      return new Response(new ReadableStream({ start(controller) { setTimeout(() => { controller.enqueue(data); controller.close(); }, 10); } }));
    }
    if (options.method === 'DELETE') {
      assert.equal(options.headers['content-type'], undefined);
      assert.equal(options.body, undefined);
      return new Response(null, { status: 204 });
    }
    return json({ turns: [{ id: 'test-turn', status: 'completed' }] });
  };
  try {
    const { result } = await runLatencySmoke({ LINKSENSE_LATENCY_ACCESS_TOKEN: 'test-token', LINKSENSE_LATENCY_ALLOW_TURN: '1', LINKSENSE_LATENCY_TURN_SAMPLES: '1',
      ...(prewarm ? {} : { LINKSENSE_LATENCY_SKIP_PREWARM: '1', LINKSENSE_LATENCY_PROJECT_ID: 'project-id', LINKSENSE_LATENCY_COLLABORATION_MODE: 'plan' }),
    });
    assert.equal(result.ephemeral_conversation_id, null);
    assert.equal(typeof result.creation_ms, 'number');
    assert.equal(result.turns[0].final_status, 'completed');
    assert.equal(result.turns[0].kind, 'new_task');
    assert.equal(result.turns[0].first_text_ms, 600);
    assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1);
    assert.equal(calls.filter((call) => call.path.endsWith('/prewarm')).length, prewarm ? 1 : 0);
  } finally { globalThis.fetch = originalFetch; now.mock.restore(); }
});

test("an empty cold benchmark cannot report a passing latency result", async () => {
  await assert.rejects(runLatencySmoke({ LINKSENSE_LATENCY_ACCESS_TOKEN: "test-token", LINKSENSE_LATENCY_SKIP_PREWARM: "1" }), /requires LINKSENSE_LATENCY_ALLOW_TURN=1/u);
});
