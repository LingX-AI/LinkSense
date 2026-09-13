import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

import pino from "pino";
import { EnvHttpProxyAgent, fetch as upstreamFetch } from "undici";
import { z } from "zod";

import { CodexJsonRpcClient } from "../../../src/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION, type CodexThread, type JsonRpcNotification } from "../../../src/codex/protocol.js";
import { buildTurnAdditionalContext, buildTurnCollaborationMode, type TurnContextInput } from "../../../src/context.js";
import { ModelGateway, modelGatewayEnvironmentKey } from "../../../src/model-gateway/model-gateway.js";
import { parseSseStream } from "../../../src/model-gateway/sse.js";
import { makeDirectoryTreeRemovable } from "../../../src/workspace/filesystem.js";
import { WorkspaceManager } from "../../../src/workspace/workspace-manager.js";
import {
  cacheBenchmarkArms, comparablePrompt, commonPrefixCharacters, estimateCost, experimentCacheKey,
  isObject, observeResponseEvent, partitionPlatformInstructions, readResponsesUsage, summarizeSamples,
  type CacheBenchmarkArm, type CacheSample, type ResponseObservation,
} from "./metrics.js";

const args = parseArgs({ options: {
  live: { type: "boolean", default: false },
  rounds: { type: "string", default: "3" },
  output: { type: "string" },
} }).values;
const rounds = z.coerce.number().int().min(2).max(10).parse(args.rounds);
const protocolMode = z.enum(["native_responses", "responses_tool_compat"]).parse(
  process.env.LINKSENSE_CODEX_PROTOCOL_MODE ?? "native_responses",
);
const liveConfig = args.live ? z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }),
  apiKey: z.string().min(1),
  model: z.string().min(1),
}).safeParse({
  baseUrl: process.env.LINKSENSE_CODEX_BASE_URL,
  apiKey: process.env.LINK_SENSE_API_KEY,
  model: process.env.LINKSENSE_CODEX_MODEL,
}) : null;
if (liveConfig && !liveConfig.success) {
  throw new Error("Live mode requires HTTPS LINKSENSE_CODEX_BASE_URL, LINK_SENSE_API_KEY and LINKSENSE_CODEX_MODEL");
}
const upstream = liveConfig?.success ? liveConfig.data : null;
const pricingSchema = z.object({
  input: z.number().nonnegative(), read: z.number().nonnegative(),
  write: z.number().nonnegative().nullable(), output: z.number().nonnegative(),
});
const pricing = process.env.LINKSENSE_CACHE_BENCHMARK_PRICING
  ? pricingSchema.parse(JSON.parse(process.env.LINKSENSE_CACHE_BENCHMARK_PRICING)) : null;
const model = upstream?.model ?? "gpt-5.6-luna";
const codexCommand = process.env.CODEX_BIN?.trim() || "codex";
const version = (await promisify(execFile)(codexCommand, ["--version"], { timeout: 10_000 })).stdout.match(/codex-cli\s+(\d+\.\d+\.\d+)/u)?.[1];
if (version !== CODEX_SCHEMA_VERSION) throw new Error(`Expected Codex ${CODEX_SCHEMA_VERSION}, received ${version ?? "unknown"}`);

const logger = pino({ level: "silent" });
const runId = randomUUID();
const ownerId = randomUUID();
const root = await mkdtemp(path.join(tmpdir(), "linksense-cache-benchmark-"));
const manager = new WorkspaceManager(path.join(root, "users"), undefined, { codexModel: model });
const dispatcher = new EnvHttpProxyAgent();
type Capture = { arm: CacheBenchmarkArm; round: number; body: Record<string, unknown> };
type Sample = CacheSample & { arm: CacheBenchmarkArm; round: number; elapsedMs: number; status: string; responseModel: string | null };
const captures: Capture[] = [];
const samples: Sample[] = [];
let outputFile: FileHandle | null = null;
let activeCase: { arm: CacheBenchmarkArm; round: number; count: number } | null = null;
const gateway = new ModelGateway({ logger, fetch: async (_url, init) => {
  if (!activeCase || ++activeCase.count !== 1) throw new Error("Expected exactly one native request per synthetic task");
  if (typeof init?.body !== "string") throw new Error("Expected a JSON model request");
  const body = z.record(z.string(), z.unknown()).parse(JSON.parse(init.body));
  if (typeof body.prompt_cache_key !== "string") throw new Error("Native cache key is absent; recheck Codex protocol");
  body.prompt_cache_key = experimentCacheKey({
    runId, ownerId, arm: activeCase.arm, model,
    providerId: `${protocolMode}:${upstream?.baseUrl ?? "fixture"}`,
    nativeKey: body.prompt_cache_key,
  });
  // Every arm uses the same one-generation envelope. Replayed requests cannot execute tools.
  body.tool_choice = "none";
  body.max_output_tokens = 256;
  captures.push({ arm: activeCase.arm, round: activeCase.round, body });
  return syntheticResponse();
} });

try {
  // Refuse an existing output path before any billable request.
  if (args.output) outputFile = await open(path.resolve(args.output), "wx", 0o600);
  let structure: ReturnType<typeof verifyStructure> = [];
  let liveRequestCount = 0;
  let phase = "capture";
  let failure: { phase: string; message: string } | null = null;
  try {
    await gateway.start();
    for (let round = 0; round < rounds; round++) {
      // Rotate arm order to reduce systematic time-of-run bias.
      for (let offset = 0; offset < cacheBenchmarkArms.length; offset++) {
        const arm = cacheBenchmarkArms[(round + offset) % cacheBenchmarkArms.length];
        if (!arm) throw new Error("Invalid experiment schedule");
        await captureNativeRequest(arm, round);
      }
    }
    structure = verifyStructure();
    if (upstream) {
      phase = "live";
      for (const capture of captures) {
        liveRequestCount++;
        const sample = await measure(capture);
        samples.push(sample);
        process.stderr.write(`${JSON.stringify({ phase: "live", arm: sample.arm, round: sample.round, status: sample.status, cacheReadTokens: sample.usage.read, firstTextMs: sample.firstTextMs })}\n`);
      }
    }
  } catch (error) {
    // Preserve measured/billable samples without logging upstream payloads or credentials.
    failure = { phase, message: error instanceof Error && /^Benchmark upstream returned HTTP \d+$/u.test(error.message)
      ? error.message : "Experiment failed; inspect protocol and runtime prerequisites" };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
  const report = {
    version: 1, mode: upstream ? "live" : "fixture", codexVersion: version, model, protocolMode, rounds, pricing,
    failure, liveRequestCount, unmeasuredRequestCount: liveRequestCount - samples.length, maxOutputTokensPerRequest: 256,
    structure,
    samples,
    summary: cacheBenchmarkArms.map((arm) => ({
      arm,
      includingWarmup: summarizeSamples(samples.filter((sample) => sample.arm === arm)),
      afterFirstSample: summarizeSamples(samples.filter((sample) => sample.arm === arm && sample.round > 0)),
    })),
    limitations: [
      "Synthetic first-turn requests; no production user data, memories, business MCP tools or skills.",
      "Different task paths, fixed model, tool catalogue and Default collaboration mode.",
      "Prompt lengths are JSON characters after excluding native message IDs, not provider-rendered tokens.",
      "Run- and arm-scoped keys request separate cache groups; effective grouping and physical placement remain provider-controlled.",
      "First-text latency is measured at the model HTTP boundary, excluding native process startup and UI rendering.",
      "Estimated cost requires explicit read/write token counts and configured prices (write price may be unknown only for zero writes); it is not an invoice.",
      "Few repetitions establish feasibility only; deployment needs representative per-provider and per-tool-set validation.",
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (outputFile) await outputFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await outputFile?.close();
  await gateway.close();
  await dispatcher.close();
  await makeDirectoryTreeRemovable(root);
  await rm(root, { recursive: true, force: true });
}

async function captureNativeRequest(arm: CacheBenchmarkArm, round: number): Promise<void> {
  const conversationId = randomUUID();
  manager.bindOwner(conversationId, ownerId);
  const paths = await manager.ensureConversation(conversationId, "prompt-cache-experiment");
  const context: TurnContextInput = {
    userInput: "Reply with exactly OK. Do not call tools.",
    applicationInstructions: `Synthetic task ${conversationId}. No external action is authorized.`,
    attachments: [], priorityPlugins: [], prioritySkills: [],
  };
  const additionalContext = buildTurnAdditionalContext(context, [], "default");
  if (!additionalContext) throw new Error("Expected LinkSense additional context");
  const agentsPath = path.join(paths.workspace, "AGENTS.md");
  const partition = partitionPlatformInstructions(
    await readFile(agentsPath, "utf8"), [paths.workspace, paths.home, paths.codexHome], additionalContext,
  );
  const movePrefix = arm === "prefix" || arm === "combined";
  if (movePrefix) {
    await chmod(agentsPath, 0o600);
    await writeFile(agentsPath, partition.agents);
  }
  await writeFile(path.join(paths.codexHome, "config.toml"), "", { mode: 0o600 });
  const lease = gateway.issueLease({
    conversationId, ownerId, revision: 1, upstreamBaseUrl: "http://127.0.0.1:1/v1",
    apiKey: "synthetic-upstream-key", protocolMode, model,
    pricing: { input_price_per_million: "0", cached_input_price_per_million: "0", output_price_per_million: "0" },
  });
  const client = new CodexJsonRpcClient({
    command: codexCommand, userHome: paths.home, codexHome: paths.codexHome, logger,
    requestTimeoutMs: 30_000,
    extraEnvironment: { [modelGatewayEnvironmentKey]: lease.token },
    configOverrides: [
      "check_for_update_on_startup=false", 'forced_login_method="api"',
      'model_provider="link-sense"', `model=${JSON.stringify(model)}`,
      'model_providers.link-sense.name="LinkSense cache experiment"',
      `model_providers.link-sense.base_url=${JSON.stringify(gateway.baseUrl)}`,
      'model_providers.link-sense.wire_api="responses"',
      `model_providers.link-sense.env_key=${JSON.stringify(modelGatewayEnvironmentKey)}`,
      "model_providers.link-sense.requires_openai_auth=false",
      "model_providers.link-sense.supports_websockets=false",
      "model_providers.link-sense.request_max_retries=0", "model_providers.link-sense.stream_max_retries=0",
      "features.memories=false", "features.plugins=false", "features.apps=false",
      "features.multi_agent=false", "features.hooks=false", "features.shell_snapshot=false",
      "skills.bundled.enabled=false", 'web_search="disabled"',
    ],
  });
  try {
    activeCase = { arm, round, count: 0 };
    await client.initialize();
    const started = await client.request<{ thread: CodexThread }>("thread/start", {
      model, modelProvider: "link-sense", cwd: paths.workspace, runtimeWorkspaceRoots: [paths.workspace],
      approvalPolicy: "never", sandbox: "danger-full-access", ephemeral: true,
      ...(movePrefix ? { developerInstructions: partition.developerInstructions } : {}),
    });
    await completeSyntheticTurn(client, started.thread.id, paths.workspace, context,
      movePrefix ? partition.additionalContext : additionalContext);
    if (activeCase.count !== 1) throw new Error("Synthetic task did not generate exactly one request");
    process.stderr.write(`${JSON.stringify({ phase: "capture", arm, round })}\n`);
  } finally {
    activeCase = null;
    await client.close();
    lease.release();
  }
}

async function completeSyntheticTurn(
  client: CodexJsonRpcClient, threadId: string, workspace: string, context: TurnContextInput,
  additionalContext: NonNullable<ReturnType<typeof buildTurnAdditionalContext>>,
): Promise<void> {
  let listener: (notification: JsonRpcNotification) => void = () => undefined;
  let timer: NodeJS.Timeout | undefined;
  const completion = new Promise<void>((resolve, reject) => {
    listener = (notification) => {
      if (notification.method !== "turn/completed" || !isObject(notification.params)) return;
      if (notification.params.threadId !== threadId) return;
      const turn = notification.params.turn;
      if (isObject(turn) && turn.status === "completed") resolve();
      else reject(new Error("Synthetic native turn failed"));
    };
    client.on("notification", listener);
    timer = setTimeout(() => reject(new Error("Synthetic turn timed out")), 30_000);
  });
  try {
    await Promise.all([
      completion,
      client.request("turn/start", {
        threadId, model, effort: "low", summary: "auto", cwd: workspace, runtimeWorkspaceRoots: [workspace],
        approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" },
        input: [{ type: "text", text: context.userInput, text_elements: [] }], additionalContext,
        collaborationMode: buildTurnCollaborationMode(context, model, "low", "default"),
      }),
    ]);
  } finally {
    clearTimeout(timer);
    client.off("notification", listener);
  }
}

function verifyStructure(): Array<{ arm: CacheBenchmarkArm; commonPrefixCharacters: number; requestCharacters: number; keyGroups: number; toolCatalogueHash: string }> {
  const toolHashes = new Set(captures.map(({ body }) => toolCatalogueHash(body)));
  if (toolHashes.size !== 1) throw new Error("Tool catalogue changed between tasks");
  const result = cacheBenchmarkArms.map((arm) => {
    const group = captures.filter((capture) => capture.arm === arm);
    const first = group[0];
    if (!first || group.length !== rounds) throw new Error("Incomplete capture set");
    const prompt = comparablePrompt(first.body);
    const keys = new Set(group.map((capture) => capture.body.prompt_cache_key));
    if (keys.size !== (arm === "key" || arm === "combined" ? 1 : rounds)) throw new Error("Unexpected cache key grouping");
    return {
      arm, keyGroups: keys.size, requestCharacters: prompt.length,
      commonPrefixCharacters: Math.min(...group.slice(1).map((capture) => commonPrefixCharacters(prompt, comparablePrompt(capture.body)))),
      toolCatalogueHash: toolCatalogueHash(first.body),
    };
  });
  const baseline = result.find((row) => row.arm === "baseline");
  const combined = result.find((row) => row.arm === "combined");
  if (!baseline || !combined || combined.commonPrefixCharacters <= baseline.commonPrefixCharacters) {
    throw new Error("Moving platform instructions did not extend the common native request prefix");
  }
  return result;
}

async function measure(capture: Capture): Promise<Sample> {
  if (!upstream) throw new Error("Live configuration is absent");
  const started = performance.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  let observation: ResponseObservation = { firstTextMs: null, terminal: null };
  try {
    const response = await upstreamFetch(`${upstream.baseUrl.replace(/\/+$/u, "")}/responses`, {
      method: "POST", redirect: "error", signal: abort.signal, dispatcher,
      headers: { authorization: `Bearer ${upstream.apiKey}`, "content-type": "application/json", accept: "text/event-stream",
        "user-agent": "LinkSense-Model-Gateway/1.0", "x-linksense-request-id": randomUUID() },
      body: JSON.stringify(capture.body),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Benchmark upstream returned HTTP ${response.status}`);
    }
    const upstreamBody = response.body;
    // Undici's web-stream type differs structurally from Node's DOM declaration.
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of upstreamBody) controller.enqueue(chunk);
          controller.close();
        } catch (error) { controller.error(error); }
      },
      cancel() { abort.abort(); },
    });
    for await (const event of parseSseStream(body)) {
      if (event.data === "[DONE]") continue;
      observation = observeResponseEvent(observation, JSON.parse(event.data), performance.now() - started);
    }
    const { terminal, firstTextMs } = observation;
    if (!terminal) throw new Error("Upstream ended without a terminal response");
    const usage = readResponsesUsage(terminal.usage);
    return { arm: capture.arm, round: capture.round, usage, estimatedCost: estimateCost(usage, pricing),
      firstTextMs, elapsedMs: performance.now() - started, status: String(terminal.status),
      responseModel: typeof terminal.model === "string" ? terminal.model : null };
  } finally { clearTimeout(timer); }
}

function syntheticResponse(): Response {
  const id = `resp_${randomUUID()}`;
  const item = { id: `msg_${randomUUID()}`, type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "OK", annotations: [] }] };
  const events = [
    { type: "response.created", response: { id, object: "response", status: "in_progress", output: [] } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, object: "response", status: "completed", output: [item] } },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function toolCatalogueHash(body: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({
    tools: body.tools,
    inlineTools: Array.isArray(body.input) ? body.input.filter((item: unknown) => isObject(item) && item.type === "additional_tools") : [],
  })).digest("hex").slice(0, 16);
}
