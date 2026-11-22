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
import { computerScreenshotMaxBytes, computerScreenshotMaxEncodedBytes } from "@linksense/shared";
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
const typedText = "你好，LinkSense 👋";
const results: Array<Record<string, unknown>> = [];

for (const mode of ["default", "plan"] as const) {
  const root = await mkdtemp(join(tmpdir(), `linksense-computer-${mode}-`));
  const codexHome = join(root, ".codex");
  const workspace = join(root, "workspace");
  const auditPath = join(root, "audit.jsonl");
  await mkdir(codexHome);
  await mkdir(workspace);

  const checks: Array<{ name: string; passed: boolean; details?: unknown }> = [];
  const captures: Array<Record<string, unknown>> = [];
  const check = (name: string, passed: boolean, details?: unknown) => {
    checks.push({ name, passed, ...(details === undefined ? {} : { details }) });
  };

  let step = 0;
  let observationId: string | undefined;
  let secondObservationId: string | undefined;
  let imageChecked = false;

  const provider = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as Record<string, unknown>;
    captures.push(body);
    step += 1;
    let item: Record<string, unknown>;
    try {
      item = await script(body, step);
    } catch (error) {
      check("fixture script", false, String(error));
      item = message(`fixture error: ${String(error)}`);
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: object) =>
      response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const id = `resp_${step}`;
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
      check("click effect reaches the next model input", effect?.ok === true && effect?.effect === "done", effect);
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
      check("UTF-8 type effect reaches the next model input", effect?.ok === true && effect?.effect === "done", effect);
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
      const serialized = JSON.stringify(body);
      imageChecked = serialized.includes('"type":"input_image"') && serialized.includes(tinyJpeg);
      check("existing MCP image content reaches the next model input", imageChecked);
      return toolCall(body, "computer_observe", {}, "call_observe_fallback") ?? message("missing fallback observe");
    }
    if (current === 10) {
      const metadata = output(body, "call_observe_fallback");
      const image = outputImage(body, "call_observe_fallback");
      const metadataText = JSON.stringify(metadata);
      check(
        "an unusable tree carries a bounded PNG fallback",
        metadata?.tree_quality === "unusable" &&
          metadata?.screenshot?.mime_type === "image/png" &&
          metadata?.screenshot?.width === 2 &&
          metadata?.screenshot?.height === 3 &&
          image?.mimeType === "image/png" &&
          image.data === fallbackPng &&
          metadataText !== undefined &&
          !metadataText.includes(fallbackPng) &&
          !metadataText.includes("capture") &&
          Buffer.byteLength(image.data, "base64") <= computerScreenshotMaxBytes &&
          image.data.length <= computerScreenshotMaxEncodedBytes,
        { metadata, image: image ? { mimeType: image.mimeType, encodedBytes: image.data.length } : undefined },
      );
      return toolCall(body, "computer_observe", {}, "call_observe_healthy") ?? message("missing healthy observe");
    }
    if (current === 11) {
      const metadata = output(body, "call_observe_healthy");
      check(
        "a healthy tree rejects its screenshot",
        metadata?.code === "COMPUTER_INVALID" &&
          outputImage(body, "call_observe_healthy") === undefined,
        metadata,
      );
      return toolCall(body, "computer_observe", {}, "call_observe_truncated") ?? message("missing truncated observe");
    }
    if (current === 12) {
      const metadata = output(body, "call_observe_truncated");
      check(
        "a truncated image with valid metadata is rejected",
        metadata?.code === "COMPUTER_INVALID" &&
          outputImage(body, "call_observe_truncated") === undefined,
        metadata,
      );
      return toolCall(body, "computer_observe", {}, "call_observe_partial") ?? message("missing partial observe");
    }
    if (current === 13) {
      const metadata = output(body, "call_observe_partial");
      const image = outputImage(body, "call_observe_partial");
      check(
        "a partial tree carries a bounded JPEG fallback",
        metadata?.tree_quality === "partial" &&
          metadata?.truncated === true &&
          metadata?.screenshot?.mime_type === "image/jpeg" &&
          image?.mimeType === "image/jpeg" &&
          image.data === tinyJpeg,
        { metadata, image: image ? { mimeType: image.mimeType, encodedBytes: image.data.length } : undefined },
      );
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
        ...(mode === "default"
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
      tools,
    );

    const turn = z.object({ turn: z.object({ id: z.string() }) }).parse(
      await client.request("turn/start", {
        threadId: started.thread.id,
        input: [{ type: "text", text: "Exercise the computer fixture.", text_elements: [] }],
        collaborationMode: {
          mode,
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
            mode,
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
      check("Plan mode never called the executor for act", acts.length === 0, audit);
      check("Plan mode executed status and observe", audit.some((entry) => entry.tool === "status") && audit.some((entry) => entry.tool === "observe"));
    } else {
      const click = acts.find((entry) => entry.action === "click" && entry.ref === "e1" && entry.nativeCallId === "call_click");
      const type = acts.find((entry) => entry.action === "type" && entry.nativeCallId === "call_type");
      check("act received the actual native call id",
        click?.nativeCallId === "call_click" && type?.nativeCallId === "call_type", acts);
      check("act received the latest observation id without a model-supplied target",
        click?.observationId === observationId && !acts.some((entry) => "target" in entry), acts);
      check("UTF-8 text reached the executor exactly", type?.text === typedText, acts);
      check("the rejected selector never reached the executor", !acts.some((entry) => entry.nativeCallId === "call_reject"), acts);
      const outputText = captures.flatMap(toolOutputText).join("\n");
      const effectPresent = outputText.includes('"effect":"done"');
      const observationPresent = outputText.includes(observationId ?? "missing-observation");
      check("observation and action effect were in the actual next model inputs",
        effectPresent && observationPresent,
        { observationId, effectPresent, observationPresent, captureCount: captures.length });
    }
    check("all model fixture checks passed", checks.every((entry) => entry.passed), checks);
    assert.deepEqual(checks.filter((entry) => !entry.passed), []);
    results.push({
      mode,
      modelRequests: captures.length,
      tools: tools.length,
      auditEntries: audit.length,
      checks: checks.map((entry) => ({ name: entry.name, passed: entry.passed })),
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

function toolOutputText(body: Record<string, unknown>): string[] {
  const inputs = Array.isArray(body.input) ? body.input : [];
  return inputs.flatMap((candidate) => {
    const item = candidate as {
      type?: string;
      output?: Array<{ type?: string; text?: string }>;
    };
    if (item.type !== "function_call_output") return [];
    return (item.output ?? []).flatMap((part) =>
      part.type === "input_text" && typeof part.text === "string" ? [part.text] : [],
    );
  });
}

function output(body: Record<string, unknown>, callId: string): ToolResult | undefined {
  const inputs = Array.isArray(body.input) ? body.input : [];
  const item = inputs.find((candidate) => {
    const record = candidate as { type?: string; call_id?: string };
    return record.type === "function_call_output" && record.call_id === callId;
  }) as { output?: Array<{ type?: string; text?: string }> } | undefined;
  for (const part of item?.output ?? []) {
    if (part.type !== "input_text" || typeof part.text !== "string") continue;
    try {
      return JSON.parse(part.text) as ToolResult;
    } catch {
      // Codex adds a "Wall time..." text part before the MCP content.
    }
  }
  return undefined;
}

function outputImage(
  body: Record<string, unknown>,
  callId: string,
): { mimeType: string; data: string } | undefined {
  const inputs = Array.isArray(body.input) ? body.input : [];
  const item = inputs.find((candidate) => {
    const record = candidate as { type?: string; call_id?: string };
    return record.type === "function_call_output" && record.call_id === callId;
  }) as { output?: Array<{ type?: string; image_url?: string }> } | undefined;
  for (const part of item?.output ?? []) {
    if (part.type !== "input_image" || typeof part.image_url !== "string") continue;
    const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/u.exec(part.image_url);
    if (match?.[1] && match[2]) return { mimeType: match[1], data: match[2] };
  }
  return undefined;
}

async function readAudit(path: string): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await readFile(path, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}
