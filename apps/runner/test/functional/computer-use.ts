/**
 * Pinned Codex 0.170.0 proof for the fixture-only computer_use Core MCP module.
 * The model endpoint is a loopback Responses fixture; the executor is fake.
 *
 * Build @linksense/shared first; the fixture imports its runtime output.
 * CODEX_BIN=/path/to/pinned/codex pnpm --filter @linksense/runner exec tsx test/functional/computer-use.ts
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { z } from "zod";

import { CodexJsonRpcClient } from "../../src/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION, type JsonRpcNotification } from "../../src/codex/protocol.js";
import { assertCodexRuntimeVersion } from "../../src/codex/runtime-version.js";

const command = process.env.CODEX_BIN?.trim() || "codex";
await assertCodexRuntimeVersion({ command });
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const fixtureServer = join(import.meta.dirname, "fixtures/computer-use-mcp-server.ts");
const tinyJpeg =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z";
/** Synthetic 2x3 PNG used by the computer_use fallback fixture. */
const fallbackPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D8IMGAwAWwsHY6MDm74AAAAASUVORK5CYII=";
/** Same truncation the fixture applies; the test never reads the fixture's copy. */
const truncatedPng = Buffer.from(fallbackPng, "base64").subarray(0, 50).toString("base64");
/** Raster or private-payload markers that must never appear in tool text. */
const leakMarkers = [
  fallbackPng,
  tinyJpeg,
  truncatedPng,
  "data:image",
  "data_base64",
  "base64,",
  '"capture"',
  '"proof"',
  '"scope"',
  '"user_opt_in"',
  '"screen_recording"',
];
/** Known fixture-only structuredContent marker. */
const structuredMarker = "FIXTURE_STRUCTURED_MARKER";
const typedText = "你好，LinkSense 👋";
const results: Array<Record<string, unknown>> = [];

for (const mode of ["default", "plan", "no-screenshots"] as const) {
  const collaborationMode = mode === "plan" ? "plan" : "default";
  const root = await mkdtemp(join(tmpdir(), `linksense-computer-${mode}-`));
  const codexHome = join(root, ".codex");
  const workspace = join(root, "workspace");
  const auditPath = join(root, "audit.jsonl");
  await mkdir(codexHome);
  await mkdir(workspace);

  const checks: Array<{ name: string; passed: boolean; details?: unknown }> = [];
  const check = (name: string, passed: boolean, details?: unknown) => {
    checks.push({ name, passed, ...(details === undefined ? {} : { details }) });
  };
  /** Healthy and truncated observations must both reject their image with no image parts. */
  const checkRejectedImage = (name: string, callId: string, body: Record<string, unknown>) => {
    const call = callOutput(body, callId);
    const images = call?.images ?? [];
    const codeMatches = call?.result?.code === "COMPUTER_INVALID";
    check(name, call !== undefined && images.length === 0 && codeMatches && textSafe(call), {
      imageCount: images.length,
      codeMatches,
    });
  };

  let step = 0;
  let observationId: string | undefined;
  let secondObservationId: string | undefined;
  let imageChecked = false;
  let scenarioCompleted = false;

  const provider = createServer(async (request, response) => {
    step += 1;
    const current = step;
    let item: Record<string, unknown>;
    try {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      item = script(JSON.parse(raw) as Record<string, unknown>, current);
    } catch {
      // Fixed label and numeric step only; never echo the request or error.
      check("fixture request failed", false, { step: current });
      item = message("fixture error");
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: object) =>
      response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const id = `resp_${current}`;
    emit("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", {
      response: {
        id,
        object: "response",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    response.end();
  });

  function script(body: Record<string, unknown>, current: number): Record<string, unknown> {
    if (mode === "no-screenshots") {
      if (current === 1) {
        return toolCall(body, "computer_observe", {}, "call_observe_noscreens") ??
          message("missing no-screenshots observe");
      }
      if (current === 2) {
        const call = callOutput(body, "call_observe_noscreens");
        const observation = call?.result;
        const images = call?.images ?? [];
        const nodeCount = observation?.nodes?.length ?? 0;
        const screenshotAbsent = observation !== undefined && !("screenshot" in observation);
        check(
          "screenshots:false returns the nonempty tree without a screenshot",
          call !== undefined &&
            images.length === 0 &&
            observation?.observation_id === "obs-noscreens" &&
            observation?.tree_quality === "unusable" &&
            observation?.truncated === false &&
            nodeCount === 1 &&
            screenshotAbsent &&
            textSafe(call),
          { callId: "call_observe_noscreens", imageCount: images.length, nodeCount, screenshotAbsent },
        );
        scenarioCompleted = true;
        return message("COMPUTER_NOSCREENSHOTS_OK");
      }
      return message("COMPUTER_NOSCREENSHOTS_OK");
    }

    if (mode === "plan") {
      if (current === 1) {
      check(
        "native tool schema keeps the strict no-argument shape",
        noArgumentSchema(body, "computer_status") && noArgumentSchema(body, "computer_observe"),
      );
      return toolCall(body, "computer_status", {}, "call_status") ?? message("missing status");
    }
      if (current === 2) {
        check("plan status reaches the model", output(body, "call_status")?.available === true);
        return toolCall(body, "computer_observe", {}, "call_observe") ?? message("missing observe");
      }
      if (current === 3) {
        const observation = output(body, "call_observe");
        check("plan observation reaches the model", Array.isArray(observation?.nodes) && observation.nodes.length === 2);
        observationId = observation?.observation_id;
        return functionCall("mcp__computer_fixture", "computer_act", {
          action: "click",
          observation_id: observationId,
          ref: "e1",
        }, "call_plan_act");
      }
      check("Plan mode rejects the model-originated act", !output(body, "call_plan_act")?.ok);
      scenarioCompleted = true;
      return message("COMPUTER_PLAN_OK");
    }

    if (current === 1) {
      check(
        "native tool schema keeps the strict no-argument shape",
        noArgumentSchema(body, "computer_status") && noArgumentSchema(body, "computer_observe"),
      );
      return toolCall(body, "computer_status", {}, "call_status") ?? message("missing status");
    }
    if (current === 2) {
      check("status reaches the next model input", output(body, "call_status")?.available === true);
      return toolCall(body, "computer_observe", {}, "call_observe") ?? message("missing observe");
    }
    if (current === 3) {
      const observation = output(body, "call_observe");
      observationId = observation?.observation_id;
      check("bounded observation reaches the next model input",
        typeof observationId === "string" && observation?.nodes?.some((node) => node.name === "Continue") === true);
      return toolCall(body, "computer_act", {
        action: "click",
        observation_id: observationId,
        ref: "e1",
      }, "call_click") ?? message("missing click");
    }
    if (current === 4) {
      const effect = output(body, "call_click");
      check("click effect reaches the next model input", effect?.ok === true && effect?.effect === "done");
      return toolCall(body, "computer_observe", {}, "call_observe_2") ?? message("missing observe");
    }
    if (current === 5) {
      const observation = output(body, "call_observe_2");
      secondObservationId = observation?.observation_id;
      return toolCall(body, "computer_act", {
        action: "type",
        observation_id: secondObservationId,
        ref: "e2",
        text: typedText,
      }, "call_type") ?? message("missing type");
    }
    if (current === 6) {
      const effect = output(body, "call_type");
      check("UTF-8 type effect reaches the next model input", effect?.ok === true && effect?.effect === "done");
      return toolCall(body, "computer_act", {
        action: "click",
        observation_id: secondObservationId,
        ref: "e1",
        bundle_id: "com.example.ModelChosen",
      }, "call_reject") ?? message("missing rejected act");
    }
    if (current === 7) {
      check("a model-supplied selector is rejected end to end",
        JSON.stringify(output(body, "call_reject")).includes("COMPUTER_INVALID"));
      return message("COMPUTER_MCP_OK");
    }
    if (current === 8) return toolCall(body, "fixture_image", {}, "call_image") ?? message("missing image");
    if (current === 9) {
      const call = callOutput(body, "call_image");
      const images = call?.images ?? [];
      imageChecked = call !== undefined &&
        images.length === 1 &&
        images[0] === `data:image/jpeg;base64,${tinyJpeg}` &&
        textSafe(call);
      check("existing MCP image content reaches the next model input", imageChecked, { imageCount: images.length });
      return toolCall(body, "computer_observe", {}, "call_observe_fallback") ?? message("missing fallback observe");
    }
    if (current === 10) {
      const call = callOutput(body, "call_observe_fallback");
      const observation = call?.result;
      const images = call?.images ?? [];
      const metadataMatches = observation?.tree_quality === "unusable" &&
        observation?.screenshot?.mime_type === "image/png" &&
        observation?.screenshot?.width === 2 &&
        observation?.screenshot?.height === 3;
      check(
        "an unusable tree carries a bounded PNG fallback",
        call !== undefined &&
          images.length === 1 &&
          images[0] === `data:image/png;base64,${fallbackPng}` &&
          metadataMatches &&
          textSafe(call),
        { imageCount: images.length, metadataMatches },
      );
      return toolCall(body, "computer_observe", {}, "call_observe_healthy") ?? message("missing healthy observe");
    }
    if (current === 11) {
      checkRejectedImage("a healthy tree rejects its screenshot", "call_observe_healthy", body);
      return toolCall(body, "computer_observe", {}, "call_observe_truncated") ?? message("missing truncated observe");
    }
    if (current === 12) {
      checkRejectedImage("a truncated image with valid metadata is rejected", "call_observe_truncated", body);
      return toolCall(body, "computer_observe", {}, "call_observe_partial") ?? message("missing partial observe");
    }
    if (current === 13) {
      const call = callOutput(body, "call_observe_partial");
      const observation = call?.result;
      const images = call?.images ?? [];
      const metadataMatches = observation?.tree_quality === "partial" &&
        observation?.truncated === true &&
        observation?.screenshot?.mime_type === "image/jpeg" &&
        observation?.screenshot?.width === 1 &&
        observation?.screenshot?.height === 1;
      check(
        "a partial tree carries a bounded JPEG fallback",
        call !== undefined &&
          images.length === 1 &&
          images[0] === `data:image/jpeg;base64,${tinyJpeg}` &&
          metadataMatches &&
          textSafe(call),
        { imageCount: images.length, metadataMatches },
      );
      return toolCall(body, "fixture_image", { structured: true }, "call_image_structured") ??
        message("missing structured image");
    }
    if (current === 14) {
      const call = callOutput(body, "call_image_structured");
      const images = call?.images ?? [];
      const markerMatches = call?.result?.marker === structuredMarker;
      check(
        "structuredContent replaces the sibling image in the tool output",
        call !== undefined && markerMatches && images.length === 0 && textSafe(call),
        { imageCount: images.length, markerMatches },
      );
      scenarioCompleted = true;
      return message("COMPUTER_SCREENSHOT_OK");
    }
    return message("COMPUTER_MCP_OK");
  }

  const notifications: JsonRpcNotification[] = [];
  let client: CodexJsonRpcClient | undefined;

  const waitFor = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 25_000;
    while (!condition()) {
      assert(Date.now() < deadline, message);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1", resolve);
    });
    const address = provider.address();
    assert(address && typeof address !== "string");
    client = new CodexJsonRpcClient({
      command,
      userHome: root,
      codexHome,
      logger: pino({ enabled: false }),
      configOverrides: [
        'model_provider="fixture"',
        'model="gpt-5.4"',
        'model_providers.fixture.name="Fixture"',
        'model_providers.fixture.wire_api="responses"',
        `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`,
        "model_providers.fixture.requires_openai_auth=false",
        "features.memories=false",
        `mcp_servers.computer_fixture.command=${JSON.stringify(process.execPath)}`,
        `mcp_servers.computer_fixture.args=${JSON.stringify([tsxCli, fixtureServer, auditPath, mode])}`,
        "mcp_servers.computer_fixture.required=true",
        "mcp_servers.computer_fixture.startup_timeout_sec=20",
        "mcp_servers.computer_fixture.tool_timeout_sec=30",
        ...(mode !== "plan"
          ? ['mcp_servers.computer_fixture.tools.computer_act.approval_mode="approve"']
          : []),
      ],
    });
    client.on("notification", (notification) => notifications.push(notification));
    await client.initialize();
    const started = z.object({ thread: z.object({ id: z.string() }) }).parse(
      await client.request("thread/start", {
        cwd: workspace,
        model: "gpt-5.4",
        modelProvider: "fixture",
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
    );
    await waitFor(
      () =>
        notifications.some((notification) => {
          const parsed = z.object({ name: z.string(), status: z.string() }).safeParse(notification.params);
          return notification.method === "mcpServer/startupStatus/updated" &&
            parsed.success && parsed.data.name === "computer_fixture" && parsed.data.status === "ready";
        }),
      "computer fixture MCP server did not become ready",
    );
    const listed = z.object({
      data: z.array(z.object({ name: z.string(), tools: z.record(z.string(), z.unknown()) })),
    }).parse(await client.request("mcpServerStatus/list", {
      threadId: started.thread.id,
      detail: "toolsAndAuthOnly",
      limit: 100,
    }));
    const tools = Object.keys(listed.data.find((server) => server.name === "computer_fixture")?.tools ?? {});
    check("status and observe are discoverable", tools.includes("computer_status") && tools.includes("computer_observe"));
    check(
      mode === "plan" ? "Plan mode does not expose act" : "Default mode exposes act",
      mode === "plan" ? !tools.includes("computer_act") : tools.includes("computer_act"),
      { toolCount: tools.length },
    );

    const turn = z.object({ turn: z.object({ id: z.string() }) }).parse(
      await client.request("turn/start", {
        threadId: started.thread.id,
        input: [{ type: "text", text: "Exercise the computer fixture.", text_elements: [] }],
        collaborationMode: {
          mode: collaborationMode,
          settings: { model: "gpt-5.4", reasoning_effort: "low", developer_instructions: null },
        },
      }),
    );
    await waitFor(
      () => notifications.some((notification) =>
        notification.method === "turn/completed" &&
        z.object({ turn: z.object({ id: z.string() }) }).safeParse(notification.params).data?.turn.id === turn.turn.id),
      "computer fixture turn did not complete",
    );
    const completed = notifications.find((notification) => notification.method === "turn/completed");
    assert.equal(z.object({ turn: z.object({ status: z.string() }) }).parse(completed?.params).turn.status, "completed");

    if (mode === "default") {
      const imageTurn = z.object({ turn: z.object({ id: z.string() }) }).parse(
        await client.request("turn/start", {
          threadId: started.thread.id,
          input: [{ type: "text", text: "Return the fixture image.", text_elements: [] }],
          collaborationMode: {
            mode: collaborationMode,
            settings: { model: "gpt-5.4", reasoning_effort: "low", developer_instructions: null },
          },
        }),
      );
      await waitFor(
        () => notifications.some((notification) =>
          notification.method === "turn/completed" &&
          z.object({ turn: z.object({ id: z.string() }) }).safeParse(notification.params).data?.turn.id === imageTurn.turn.id),
        "fixture image turn did not complete",
      );
      check("image proof executed in a second turn", imageChecked);
    }

    const audit = await readAudit(auditPath);
    const acts = audit.filter((entry) => entry.tool === "act");
    if (mode === "plan") {
      check("Plan mode never called the executor for act", acts.length === 0, { actCount: acts.length });
      check("Plan mode executed status and observe", audit.some((entry) => entry.tool === "status") && audit.some((entry) => entry.tool === "observe"));
    } else if (mode === "no-screenshots") {
      const observes = audit.filter((entry) => entry.tool === "observe");
      const screenshotSupplied = observes[0]?.screenshot === true;
      check(
        "no-screenshots mode handed eligible fallback bytes to the module",
        observes.length === 1 && screenshotSupplied,
        { observes: observes.length, screenshotSupplied },
      );
      check("no-screenshots mode never called the executor for act", acts.length === 0, { actCount: acts.length });
    } else {
      const click = acts.find((entry) => entry.action === "click" && entry.ref === "e1" && entry.nativeCallId === "call_click");
      const type = acts.find((entry) => entry.action === "type" && entry.nativeCallId === "call_type");
      const clickMatches = click?.nativeCallId === "call_click";
      const typeMatches = type?.nativeCallId === "call_type";
      check("act received the actual native call id", clickMatches && typeMatches, { clickMatches, typeMatches });
      const observationMatches = click?.observationId === observationId;
      const targetFree = !acts.some((entry) => "target" in entry);
      check("act received the latest observation id without a model-supplied target",
        observationMatches && targetFree,
        { observationMatches, targetFree });
      check("UTF-8 text reached the executor exactly", type?.text === typedText,
        { textMatches: type?.text === typedText });
      const rejectedActs = acts.filter((entry) => entry.nativeCallId === "call_reject").length;
      check("the rejected selector never reached the executor", rejectedActs === 0, { rejectedActs });
    }
    const expectedRequests = mode === "plan" ? 4 : mode === "default" ? 14 : 2;
    check(
      "synthetic scenario matrix ran to completion",
      scenarioCompleted && step === expectedRequests,
      { mode, completed: scenarioCompleted, modelRequests: step, expectedRequests },
    );
    assert.deepEqual(checks.filter((entry) => !entry.passed), []);
    results.push({
      mode,
      modelRequests: step,
      tools: tools.length,
      auditEntries: audit.length,
      checks: checks.map(({ name, passed, details }) => ({
        name,
        passed,
        ...(details === undefined ? {} : { details }),
      })),
    });
  } finally {
    await client?.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ version: CODEX_SCHEMA_VERSION, results }));

function message(text: string): Record<string, unknown> {
  return {
    id: `msg_fixture`,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function functionCall(
  namespace: string,
  name: string,
  argumentsValue: unknown,
  callId: string,
): Record<string, unknown> {
  return {
    id: `fc_${callId}`,
    type: "function_call",
    call_id: callId,
    namespace,
    name,
    arguments: JSON.stringify(argumentsValue),
  };
}

function toolCall(
  body: Record<string, unknown>,
  name: string,
  argumentsValue: unknown,
  callId: string,
): Record<string, unknown> | undefined {
  const namespace = namespaceFor(body, name);
  return namespace ? functionCall(namespace, name, argumentsValue, callId) : undefined;
}

function noArgumentSchema(body: Record<string, unknown>, toolName: string): boolean {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const candidate of tools) {
    const namespace = candidate as {
      type?: string;
      tools?: Array<{ name?: string; parameters?: Record<string, unknown> }>;
    };
    if (namespace.type !== "namespace") continue;
    const tool = namespace.tools?.find((entry) => entry.name === toolName);
    if (!tool) continue;
    const parameters = tool.parameters;
    return parameters?.type === "object" &&
      parameters.additionalProperties === false &&
      Object.keys((parameters.properties as Record<string, unknown> | undefined) ?? {}).length === 0;
  }
  return false;
}

function namespaceFor(body: Record<string, unknown>, toolName: string): string | undefined {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const candidate of tools) {
    const namespace = candidate as {
      type?: string;
      name?: string;
      tools?: Array<{ name?: string }>;
    };
    if (namespace.type === "namespace" && namespace.name &&
      namespace.tools?.some((tool) => tool.name === toolName)) {
      return namespace.name;
    }
  }
  return undefined;
}

type ToolResult = {
  ok?: boolean;
  effect?: string;
  observation_id?: string;
  code?: string;
  tree_quality?: string;
  truncated?: boolean;
  nodes?: Array<{ name?: string }>;
  screenshot?: { mime_type?: string; width?: number; height?: number };
  [key: string]: unknown;
};

type ToolOutputPart = {
  type?: string;
  text?: string;
  image_url?: string;
};

type CallOutput = {
  /** First parseable JSON tool result, if any. */
  result: ToolResult | undefined;
  /** Every text block from this exact call, for leakage checks. */
  text: string;
  /** Every input_image URL, including malformed ones, so counts stay honest. */
  images: Array<string | undefined>;
};

/** The exact function_call_output for one call id; never a whole-request search. */
function callOutput(body: Record<string, unknown>, callId: string): CallOutput | undefined {
  const inputs = Array.isArray(body.input) ? body.input : [];
  const item = inputs.find((candidate) => {
    const record = candidate as { type?: string; call_id?: string };
    return record.type === "function_call_output" && record.call_id === callId;
  }) as { output?: string | ToolOutputPart[] } | undefined;
  if (!item) return undefined;
  const parts: ToolOutputPart[] = typeof item.output === "string"
    ? [{ type: "input_text", text: item.output }]
    : Array.isArray(item.output) ? item.output : [];
  const texts = parts.flatMap((part) =>
    part.type === "input_text" && typeof part.text === "string" ? [part.text] : []);
  let result: ToolResult | undefined;
  for (const text of texts) {
    // The pin wraps structuredContent as "Wall time: …\nOutput:\n<json>".
    const wrapper = "\nOutput:\n";
    const offset = text.indexOf(wrapper);
    const json = text.startsWith("Wall time:") && offset >= 0
      ? text.slice(offset + wrapper.length)
      : text;
    try {
      result = JSON.parse(json) as ToolResult;
      break;
    } catch {
      // A non-JSON wall-time block may precede the MCP content.
    }
  }
  return {
    result,
    text: texts.join("\n"),
    images: parts.filter((part) => part.type === "input_image").map((part) => part.image_url),
  };
}

function output(body: Record<string, unknown>, callId: string): ToolResult | undefined {
  return callOutput(body, callId)?.result;
}

function textSafe(call: CallOutput | undefined): boolean {
  const text = call?.text;
  return text !== undefined && !leakMarkers.some((marker) => text.includes(marker));
}

async function readAudit(path: string): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await readFile(path, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}
