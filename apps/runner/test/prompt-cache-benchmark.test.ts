import assert from "node:assert/strict";
import { test } from "vitest";
import type { TurnAdditionalContext } from "../src/context.js";
import {
  comparablePrompt, commonPrefixCharacters, estimateCost, experimentCacheKey,
  partitionPlatformInstructions, readResponsesUsage, summarizeSamples, observeResponseEvent,
  type CacheSample, type CacheBenchmarkArm, type ResponseObservation,
} from "./fixtures/prompt-cache-benchmark/metrics.js";

const context: TurnAdditionalContext = {
  "linksense.runtime-identity": { kind: "application", value: "Identity" },
  "linksense.interactive-forms": { kind: "application", value: "Forms" },
  "linksense.local-web-server-policy": { kind: "application", value: "Servers" },
  "linksense.inline-html-preview": { kind: "application", value: "Preview" },
  "linksense.application-instructions": { kind: "application", value: "Task-specific" },
  "linksense.office-selection": { kind: "untrusted", value: "Untrusted document" },
};
const agents = "<!-- linksense-template:test -->\n# Rules\n\n- Static platform rule\n- Workspace /tasks/one\n- Shared HOME /user\n- Codex /native/one\n";
test("partition moves static platform rules once while retaining all dynamic paths and untrusted data", () => {
  const snapshot = structuredClone(context);
  const result = partitionPlatformInstructions(agents, ["/tasks/one", "/user", "/native/one"], context);
  assert.match(result.developerInstructions, /Static platform rule/);
  assert.doesNotMatch(result.developerInstructions, /\/tasks|\/user|\/native|Task-specific|Untrusted/);
  assert.doesNotMatch(result.agents, /Static platform rule/);
  for (const line of agents.split("\n").filter((line) => line.startsWith("- "))) {
    assert.equal(Number(result.agents.includes(line)) + Number(result.developerInstructions.includes(line)), 1);
  }
  assert.deepEqual(result.additionalContext, {
    "linksense.application-instructions": context["linksense.application-instructions"],
    "linksense.office-selection": context["linksense.office-selection"],
  });
  assert.deepEqual(context, snapshot);
});
test("partition rejects user files, unexpected template syntax, and untrusted common context", () => {
  const paths = ["/tasks/one", "/user", "/native/one"];
  assert.throws(() => partitionPlatformInstructions("User instructions", paths, context));
  assert.throws(() => partitionPlatformInstructions(agents + "Unexpected paragraph", paths, context));
  assert.throws(() => partitionPlatformInstructions(agents, paths, { ...context, "linksense.runtime-identity": { kind: "untrusted", value: "x" } }));
});
test("shared key is stable across tasks and isolated across users, providers, models, arms and runs", () => {
  const scope = { runId: "run", arm: "key" as const, ownerId: "owner", providerId: "channel", model: "model", nativeKey: "thread-a" };
  const key = experimentCacheKey(scope);
  assert.equal(key, experimentCacheKey({ ...scope, nativeKey: "thread-b" }));
  for (const field of ["runId", "ownerId", "providerId", "model"]) {
    assert.notEqual(key, experimentCacheKey({ ...scope, [field]: "other" }));
  }
  assert.notEqual(key, experimentCacheKey({ ...scope, arm: "combined" }));
  for (const arm of ["baseline", "prefix"] satisfies CacheBenchmarkArm[]) {
    assert.notEqual(experimentCacheKey({ ...scope, arm }), experimentCacheKey({ ...scope, arm, nativeKey: "thread-b" }));
  }
  assert.ok(key.length <= 64);
  assert.throws(() => experimentCacheKey({ ...scope, ownerId: "" }));
});
test("prefix comparison ignores only message identifiers and detects changed tools, roles and paths", () => {
  const request = { model: "model", tools: [{ name: "read" }], input: [{ type: "message", id: "one", role: "user", content: "same" }] };
  const next = structuredClone(request);
  assert.ok(next.input[0]);
  next.input[0].id = "two";
  assert.equal(comparablePrompt(request), comparablePrompt(next));
  for (const changed of [
    { ...next, tools: [{ name: "write" }] },
    { ...next, input: [{ ...next.input[0], role: "developer" }] },
    { ...next, input: [{ type: "function_call", id: "new", call_id: "call" }] },
  ]) assert.notEqual(comparablePrompt(request), comparablePrompt(changed));
  assert.equal(commonPrefixCharacters("abc/task1", "abc/task2"), 8);
  assert.equal(commonPrefixCharacters("same", "same"), 4);
});
test("usage distinguishes unknown values from explicit zero and rejects impossible counts", () => {
  assert.deepEqual(readResponsesUsage(undefined), { input: null, read: null, write: null, output: null });
  assert.deepEqual(readResponsesUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2 }), { input: 100, read: 0, write: null, output: 2 });
  assert.throws(() => readResponsesUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 70, cache_write_tokens: 50 } }));
  assert.equal(readResponsesUsage({ input_tokens: -1 }).input, null);
});
test("cost accounts for cache writes exactly once and never estimates from missing fields", () => {
  const usage = { input: 1000, read: 400, write: 300, output: 10 };
  const rates = { input: 2, read: 0.2, write: 2.5, output: 8 };
  assert.equal(estimateCost(usage, rates), 0.00151);
  assert.equal(estimateCost({ ...usage, write: null }, rates), null);
  assert.equal(estimateCost(usage, { ...rates, write: Number.NaN }), null);
  assert.equal(estimateCost(usage, null), null);
  assert.equal(estimateCost({ ...usage, write: 0 }, { ...rates, write: null }), 0.00136);
  assert.equal(estimateCost(usage, { ...rates, write: null }), null);
});

test("SSE measurement ignores reasoning and cumulative usage, and records only the first text delta", () => {
  let state: ResponseObservation = { firstTextMs: null, terminal: null };
  state = observeResponseEvent(state, { type: "response.reasoning_text.delta", delta: "thinking" }, 10);
  state = observeResponseEvent(state, { type: "response.output_text.delta", delta: "" }, 20);
  assert.equal(state.firstTextMs, null);
  state = observeResponseEvent(state, { type: "response.output_text.delta", delta: "O" }, 30);
  state = observeResponseEvent(state, { type: "response.output_text.delta", delta: "K" }, 40);
  state = observeResponseEvent(state, { type: "response.in_progress", response: { usage: { input_tokens: 999 } } }, 50);
  assert.equal(state.firstTextMs, 30);
  assert.equal(state.terminal, null);
  state = observeResponseEvent(state, { type: "response.completed", response: { status: "completed", usage: { input_tokens: 100 } } }, 60);
  assert.equal(readResponsesUsage(state.terminal?.usage).input, 100);
  assert.throws(() => observeResponseEvent(state, { type: "response.completed", response: {} }, 70));
});

test("SSE measurement distinguishes incomplete responses and rejects failures or malformed terminal events", () => {
  const state: ResponseObservation = { firstTextMs: null, terminal: null };
  assert.equal(observeResponseEvent(state, { type: "response.incomplete", response: { status: "incomplete" } }, 10).terminal?.status, "incomplete");
  for (const event of [null, { type: "error" }, { type: "response.failed" }, { type: "response.completed" }, { type: "response.completed", response: { status: "incomplete" } }]) {
    assert.throws(() => observeResponseEvent(state, event, 10));
  }
});
test("summary uses token weighting and carries missing usage through aggregates", () => {
  const rows: CacheSample[] = [
    { usage: { input: 100, read: 0, write: 100, output: 10 }, firstTextMs: 50, estimatedCost: 1 },
    { usage: { input: 900, read: 900, write: 0, output: 10 }, firstTextMs: 30, estimatedCost: 2 },
  ];
  assert.deepEqual(summarizeSamples(rows), { count: 2, inputTokens: 1000, cacheReadTokens: 900, cacheWriteTokens: 100, outputTokens: 20, tokenWeightedHitRate: 0.9, estimatedCost: 3, firstTextSamples: 2, medianFirstTextMs: 40 });
  const missing = structuredClone(rows);
  assert.ok(missing[1]);
  missing[1].usage.write = null;
  missing[1].estimatedCost = null;
  missing[1].firstTextMs = null;
  assert.equal(summarizeSamples(missing).cacheWriteTokens, null);
  assert.equal(summarizeSamples(missing).estimatedCost, null);
  assert.equal(summarizeSamples(missing).firstTextSamples, 1);
  assert.equal(summarizeSamples([]).estimatedCost, null);
  assert.equal(summarizeSamples([]).cacheReadTokens, null);
});
