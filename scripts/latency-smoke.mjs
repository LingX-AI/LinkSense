import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4000/api/v1/";
const DEFAULT_RUNNER_BASE_URL = "http://127.0.0.1:4010/";
const PREWARM_RELATIVE_PATH = "conversations/prewarm";
const { createParser } = createRequire(new URL("../apps/runner/package.json", import.meta.url))("eventsource-parser");

export function isAssistantTextDelta(event, turnId) {
  if (!event || event.turn_id !== turnId) return false;
  const text = event.event_type === "item/agentMessage/delta"
    ? event.payload?.params?.delta
    : event.event_type === "conversation.message.delta" && event.payload?.role !== "user"
      ? event.payload?.delta : null;
  return typeof text === "string" && text.length > 0;
}

export async function observeFirstText(url, headers, turnId, submittedAt, signal) {
  try {
    const response = await fetch(url, { headers, signal });
    if (!response.ok || !response.body) throw new Error(`event stream returned HTTP ${response.status}`);
    let firstTextMs = null;
    const parser = createParser({ maxBufferSize: 2 * 1024 * 1024, onEvent: ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      if (firstTextMs === null && isAssistantTextDelta(event, turnId)) firstTextMs = round(performance.now() - submittedAt);
    } });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (firstTextMs === null) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      return firstTextMs;
    } finally { await reader.cancel(); reader.releaseLock(); }
  } catch (error) { if (signal.aborted) return null; throw error; }
}

export function percentile(values, percentage) {
  if (values.length === 0) return null;
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 1) {
    throw new TypeError("percentage must be between 0 and 1");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentage * sorted.length) - 1);
  return sorted[index];
}

export function summarizeDurations(values) {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    min_ms: round(Math.min(...values)),
    mean_ms: round(total / values.length),
    p50_ms: round(percentile(values, 0.5)),
    p95_ms: round(percentile(values, 0.95)),
    max_ms: round(Math.max(...values)),
  };
}

export function assertSafeBenchmarkUrl(rawValue, variableName) {
  const url = new URL(rawValue);
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error(
      `${variableName} must use HTTPS, except for an HTTP loopback address.`,
    );
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function unwrapData(body) {
  return body && typeof body === "object" && "data" in body
    ? body.data
    : body;
}

export function findProjectedTurn(body, turnId) {
  const data = unwrapData(body);
  if (!data || typeof data !== "object") return null;
  const candidates = [
    Array.isArray(data.turns) ? data.turns : [],
    data.conversation &&
    typeof data.conversation === "object" &&
    Array.isArray(data.conversation.turns)
      ? data.conversation.turns
      : [],
  ];
  for (const turns of candidates) {
    const turn = turns.find(
      (candidate) =>
        candidate && typeof candidate === "object" && candidate.id === turnId,
    );
    if (turn) return turn;
  }
  return null;
}

export function evaluateLatencyTargets(result, targets) {
  const failures = [];
  if (
    result.prewarm?.first_observed_ms !== undefined &&
    result.prewarm.first_observed_ms > targets.workerPrewarmMs
  ) {
    failures.push(
      `first observed worker prewarm ${result.prewarm.first_observed_ms}ms exceeds ${targets.workerPrewarmMs}ms`,
    );
  }
  if (
    result.prewarm?.warm?.p95_ms !== undefined &&
    result.prewarm.warm.p95_ms > targets.warmPrewarmMs
  ) {
    failures.push(
      `warm prewarm p95 ${result.prewarm.warm.p95_ms}ms exceeds ${targets.warmPrewarmMs}ms`,
    );
  }
  const acceptance = summarizeDurations(
    (result.turns ?? []).map((turn) => turn.acceptance_ms),
  );
  if (
    acceptance?.p95_ms !== undefined &&
    acceptance.p95_ms > targets.turnAcceptanceMs
  ) {
    failures.push(
      `turn acceptance p95 ${acceptance.p95_ms}ms exceeds ${targets.turnAcceptanceMs}ms`,
    );
  }
  const warmProjections = (result.turns ?? [])
    .slice(1)
    .map((turn) => turn.projection_ms)
    .filter((value) => typeof value === "number");
  const projection = summarizeDurations(warmProjections);
  if (
    projection?.p95_ms !== undefined &&
    projection.p95_ms > targets.warmProjectionMs
  ) {
    failures.push(
      `warm native projection p95 ${projection.p95_ms}ms exceeds ${targets.warmProjectionMs}ms`,
    );
  }
  return failures;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function positiveInteger(value, fallback, variableName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }
  return parsed;
}

function optionalUuidList(value) {
  if (!value?.trim()) return [];
  const values = value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  for (const candidate of values) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        candidate,
      )
    ) {
      throw new Error(
        "LINKSENSE_LATENCY_CAPABILITY_IDS must contain comma-separated UUIDs.",
      );
    }
  }
  return values;
}

async function requestJson(url, options, timeoutMs) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    throw new Error(`${options.method ?? "GET"} ${url.pathname} failed: ${message}`);
  }
  const durationMs = performance.now() - startedAt;
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { non_json_response: true };
    }
  }
  return { response, body, durationMs };
}

function authenticatedHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

function endpoint(baseUrl, relativePath) {
  return new URL(relativePath.replace(/^\//u, ""), baseUrl);
}

async function measurePrewarm(config) {
  const measurements = [];
  let reservationId = null;
  // Do not create several unclaimed task HOMEs just to time an enqueue receipt.
  const samples = config.conversationId ? config.prewarmSamples : 1;
  for (let index = 0; index < samples; index += 1) {
    const { response, body, durationMs } = await requestJson(
      endpoint(config.apiBaseUrl, PREWARM_RELATIVE_PATH),
      {
        method: "POST",
        headers: authenticatedHeaders(config.accessToken),
        body: JSON.stringify(config.conversationId ? { conversation_id: config.conversationId } : {}),
      },
      config.requestTimeoutMs,
    );
    const data = unwrapData(body);
    if (response.status !== 202 || data?.accepted !== true) {
      throw new Error(
        `conversation prewarm returned HTTP ${response.status} instead of an accepted 202 receipt.`,
      );
    }
    measurements.push(durationMs);
    reservationId = data.conversation_id ?? null;
  }
  return {
    first_observed_ms: round(measurements[0]),
    warm: summarizeDurations(measurements.slice(1)),
    samples_ms: measurements.map(round),
    cold_start_verified: false,
    boundary: "prewarm_enqueue_receipt",
    conversation_id: reservationId,
  };
}

async function runnerHealth(config) {
  if (!config.runnerSecret) return null;
  const { response, body, durationMs } = await requestJson(
    endpoint(config.runnerBaseUrl, "health/ready"),
    {
      method: "GET",
      headers: { authorization: `Bearer ${config.runnerSecret}` },
    },
    config.requestTimeoutMs,
  );
  return {
    http_status: response.status,
    duration_ms: round(durationMs),
    status: body?.status ?? null,
    running_turns: body?.running_turns ?? null,
    app_server_processes: body?.app_server_processes ?? null,
  };
}

async function createEphemeralConversation(config, reservationId) {
  const { response, body, durationMs } = await requestJson(
    endpoint(config.apiBaseUrl, "conversations/"),
    {
      method: "POST",
      headers: authenticatedHeaders(config.accessToken),
      body: JSON.stringify({
        ...(reservationId ? { prewarmed_conversation_id: reservationId } : {}),
      }),
    },
    config.requestTimeoutMs,
  );
  const data = unwrapData(body);
  const conversationId = data?.conversation?.id ?? data?.id;
  if (response.status !== 201 || typeof conversationId !== "string") {
    throw new Error(
      `ephemeral conversation creation returned HTTP ${response.status} without a conversation id.`,
    );
  }
  return { conversationId, durationMs: round(durationMs) };
}

async function readConversation(config, conversationId) {
  const { response, body } = await requestJson(
    endpoint(config.apiBaseUrl, `conversations/${conversationId}`),
    {
      method: "GET",
      headers: authenticatedHeaders(config.accessToken),
    },
    config.requestTimeoutMs,
  );
  if (response.status !== 200) {
    throw new Error(`conversation read returned HTTP ${response.status}.`);
  }
  return body;
}

async function waitForTurn(config, conversationId, turnId, acceptedAt) {
  let projectedAt = null;
  const deadline = Date.now() + config.turnCompletionTimeoutMs;
  while (Date.now() < deadline) {
    const body = await readConversation(config, conversationId);
    const turn = findProjectedTurn(body, turnId);
    if (turn) {
      projectedAt ??= performance.now();
      if (["completed", "failed", "interrupted"].includes(turn.status)) {
        return {
          projection_ms: round(projectedAt - acceptedAt),
          completion_ms: round(performance.now() - acceptedAt),
          final_status: turn.status,
          error_code: turn.error_code ?? null,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
  throw new Error(
    `turn ${turnId} did not reach a terminal state within ${config.turnCompletionTimeoutMs}ms.`,
  );
}

async function measureTurns(config, conversationId) {
  const turns = [];
  for (let index = 0; index < config.turnSamples; index += 1) {
    const idempotencyKey = randomUUID();
    const submittedAt = performance.now();
    const { response, body, durationMs } = await requestJson(
      endpoint(config.apiBaseUrl, `conversations/${conversationId}/turns`),
      {
        method: "POST",
        headers: authenticatedHeaders(config.accessToken),
        body: JSON.stringify({
          input_text: `${config.turnMessage} (${index + 1}/${config.turnSamples}, ${idempotencyKey})`,
          priority_capability_ids: config.capabilityIds,
          idempotency_key: idempotencyKey,
          submit_mode: "normal",
        }),
      },
      config.requestTimeoutMs,
    );
    const receipt = unwrapData(body);
    if (
      response.status !== 202 ||
      receipt?.accepted !== true ||
      receipt?.status !== "starting" ||
      typeof receipt?.turn_id !== "string"
    ) {
      throw new Error(
        `turn submission returned HTTP ${response.status} without a starting receipt.`,
      );
    }
    const streamAbort = new AbortController();
    let streamError;
    const firstText = observeFirstText(endpoint(config.apiBaseUrl, `conversations/${conversationId}/events`),
      authenticatedHeaders(config.accessToken), receipt.turn_id, submittedAt,
      AbortSignal.any([streamAbort.signal, AbortSignal.timeout(config.turnCompletionTimeoutMs)])
    ).catch((error) => { streamError = error; return null; });
    let terminal;
    try { terminal = await waitForTurn(
      config,
      conversationId,
      receipt.turn_id,
      submittedAt,
    ); } finally { streamAbort.abort(); }
    const firstTextMs = await firstText;
    if (streamError) throw streamError;
    turns.push({
      sample: index + 1,
      turn_id: receipt.turn_id,
      acceptance_ms: round(durationMs),
      first_text_ms: firstTextMs,
      ...terminal,
    });
  }
  return turns;
}

async function deleteEphemeralConversation(config, conversationId) {
  const { response } = await requestJson(
    endpoint(config.apiBaseUrl, `conversations/${conversationId}`),
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${config.accessToken}` },
    },
    config.requestTimeoutMs,
  );
  if (response.status !== 204) {
    throw new Error(
      `ephemeral conversation cleanup returned HTTP ${response.status}.`,
    );
  }
}

function configuration(environment) {
  const accessToken = environment.LINKSENSE_LATENCY_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error("LINKSENSE_LATENCY_ACCESS_TOKEN is required.");
  }
  const allowTurn = environment.LINKSENSE_LATENCY_ALLOW_TURN === "1";
  const turnSamples = allowTurn
    ? positiveInteger(
        environment.LINKSENSE_LATENCY_TURN_SAMPLES,
        2,
        "LINKSENSE_LATENCY_TURN_SAMPLES",
      )
    : 0;
  return {
    accessToken,
    apiBaseUrl: assertSafeBenchmarkUrl(
      environment.LINKSENSE_LATENCY_API_URL ?? DEFAULT_API_BASE_URL,
      "LINKSENSE_LATENCY_API_URL",
    ),
    runnerBaseUrl: assertSafeBenchmarkUrl(
      environment.LINKSENSE_LATENCY_RUNNER_URL ?? DEFAULT_RUNNER_BASE_URL,
      "LINKSENSE_LATENCY_RUNNER_URL",
    ),
    runnerSecret: environment.LINKSENSE_LATENCY_RUNNER_SECRET?.trim() || null,
    prewarmSamples: positiveInteger(
      environment.LINKSENSE_LATENCY_PREWARM_SAMPLES,
      5,
      "LINKSENSE_LATENCY_PREWARM_SAMPLES",
    ),
    requestTimeoutMs: positiveInteger(
      environment.LINKSENSE_LATENCY_REQUEST_TIMEOUT_MS,
      15_000,
      "LINKSENSE_LATENCY_REQUEST_TIMEOUT_MS",
    ),
    pollIntervalMs: positiveInteger(
      environment.LINKSENSE_LATENCY_POLL_INTERVAL_MS,
      200,
      "LINKSENSE_LATENCY_POLL_INTERVAL_MS",
    ),
    turnCompletionTimeoutMs: positiveInteger(
      environment.LINKSENSE_LATENCY_TURN_TIMEOUT_MS,
      600_000,
      "LINKSENSE_LATENCY_TURN_TIMEOUT_MS",
    ),
    allowTurn,
    turnSamples,
    turnMessage:
      environment.LINKSENSE_LATENCY_TURN_MESSAGE?.trim() ||
      "LinkSense latency probe. Reply with OK only",
    conversationId:
      environment.LINKSENSE_LATENCY_CONVERSATION_ID?.trim() || null,
    capabilityIds: optionalUuidList(
      environment.LINKSENSE_LATENCY_CAPABILITY_IDS,
    ),
    cleanupEphemeral:
      environment.LINKSENSE_LATENCY_CLEANUP_EPHEMERAL !== "0",
    enforce: environment.LINKSENSE_LATENCY_ENFORCE === "1",
    json: environment.LINKSENSE_LATENCY_JSON === "1",
    targets: {
      workerPrewarmMs: positiveInteger(
        environment.LINKSENSE_LATENCY_TARGET_WORKER_PREWARM_MS,
        2_000,
        "LINKSENSE_LATENCY_TARGET_WORKER_PREWARM_MS",
      ),
      warmPrewarmMs: positiveInteger(
        environment.LINKSENSE_LATENCY_TARGET_WARM_PREWARM_MS,
        300,
        "LINKSENSE_LATENCY_TARGET_WARM_PREWARM_MS",
      ),
      turnAcceptanceMs: positiveInteger(
        environment.LINKSENSE_LATENCY_TARGET_TURN_ACCEPTANCE_MS,
        300,
        "LINKSENSE_LATENCY_TARGET_TURN_ACCEPTANCE_MS",
      ),
      warmProjectionMs: positiveInteger(
        environment.LINKSENSE_LATENCY_TARGET_WARM_PROJECTION_MS,
        1_000,
        "LINKSENSE_LATENCY_TARGET_WARM_PROJECTION_MS",
      ),
    },
  };
}

function printHelp() {
  process.stdout.write(`LinkSense runner latency smoke

Default behavior is non-destructive: it measures authenticated worker prewarm
requests only. It never stops workers, containers, or application services.

Required:
  LINKSENSE_LATENCY_ACCESS_TOKEN       User access token (never printed)

Optional read/prewarm settings:
  LINKSENSE_LATENCY_API_URL            Default: ${DEFAULT_API_BASE_URL}
  LINKSENSE_LATENCY_PREWARM_SAMPLES    Default: 5
  LINKSENSE_LATENCY_RUNNER_SECRET      Enables aggregate runner health snapshots
  LINKSENSE_LATENCY_JSON=1             Emit JSON instead of the human summary
  LINKSENSE_LATENCY_ENFORCE=1          Exit non-zero when a target is missed

Explicit mutating turn benchmark:
  LINKSENSE_LATENCY_ALLOW_TURN=1       Required before any test turn is sent
  LINKSENSE_LATENCY_CONVERSATION_ID    Existing test conversation; omit to create
                                       and clean up an ephemeral conversation
  LINKSENSE_LATENCY_TURN_SAMPLES       Default: 2 (sequential, same conversation)
  LINKSENSE_LATENCY_CAPABILITY_IDS     Comma-separated capability UUIDs

For a verified cold-worker sample, use a dedicated benchmark user with no
existing worker. The script deliberately has no stop-all or worker-delete path.
`);
}

export async function runLatencySmoke(environment = process.env) {
  const config = configuration(environment);
  const result = {
    measured_at: new Date().toISOString(),
    note: "Prewarm measures queue acceptance, not native readiness. First text measures SSE arrival, not browser paint or pure provider latency.",
    runner_before: await runnerHealth(config),
    prewarm: await measurePrewarm(config),
    turns: [],
    runner_after: null,
    ephemeral_conversation_id: null,
    creation_ms: null,
  };

  let ephemeralConversationId = null;
  if (config.allowTurn) {
    let conversationId = config.conversationId;
    if (!conversationId) {
      const created = await createEphemeralConversation(config, result.prewarm.conversation_id);
      conversationId = ephemeralConversationId = created.conversationId;
      result.creation_ms = created.durationMs;
    }
    result.ephemeral_conversation_id = ephemeralConversationId;
    try {
      result.turns = await measureTurns(config, conversationId);
      if (ephemeralConversationId && config.cleanupEphemeral) {
        await deleteEphemeralConversation(config, ephemeralConversationId);
        result.ephemeral_conversation_id = null;
      }
    } catch (error) {
      if (ephemeralConversationId) {
        process.stderr.write(
          `Ephemeral benchmark conversation was retained for inspection: ${ephemeralConversationId}\n`,
        );
      }
      throw error;
    }
  }
  result.runner_after = await runnerHealth(config);
  const failures = evaluateLatencyTargets(result, config.targets);
  return { result, failures, config };
}

function printHuman(result, failures) {
  process.stdout.write("LinkSense latency measurement\n");
  process.stdout.write(`${result.note}\n\n`);
  process.stdout.write(
    `Prewarm enqueue: first=${result.prewarm.first_observed_ms}ms, repeated=${JSON.stringify(result.prewarm.warm)}; create=${result.creation_ms}ms\n`,
  );
  for (const turn of result.turns) {
    process.stdout.write(
      `Turn ${turn.sample}: accept=${turn.acceptance_ms}ms, project=${turn.projection_ms}ms, first_text=${turn.first_text_ms}ms, complete=${turn.completion_ms}ms, status=${turn.final_status}\n`,
    );
  }
  if (result.runner_before || result.runner_after) {
    process.stdout.write(
      `Runner snapshots: before=${JSON.stringify(result.runner_before)}, after=${JSON.stringify(result.runner_after)}\n`,
    );
  }
  if (failures.length === 0) {
    process.stdout.write("Targets: passed for every measured boundary.\n");
  } else {
    process.stdout.write(`Targets: ${failures.join("; ")}\n`);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const { result, failures, config } = await runLatencySmoke();
  if (config.json) {
    process.stdout.write(`${JSON.stringify({ ...result, failures }, null, 2)}\n`);
  } else {
    printHuman(result, failures);
  }
  if (config.enforce && failures.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : "";
if (invokedPath === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Latency measurement failed."}\n`,
    );
    process.exitCode = 1;
  });
}
