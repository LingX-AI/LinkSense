/** Real pinned Codex, real gateway and shell execution, deterministic local provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { WebSocketServer } from "ws";
import { z } from "zod";
import type { ModelProviderProtocolMode } from "@linksense/shared";
import { CodexJsonRpcClient } from "../../src/codex/json-rpc-client.js";
import { mapCodexNotification } from "../../src/codex/event-mapper.js";
import {
  CODEX_SCHEMA_VERSION,
  type CodexThread,
  type CodexTurn,
  type JsonRpcNotification,
} from "../../src/codex/protocol.js";
import { linkSenseModelProviderConfigOverrides } from "../../src/codex/runtime-config-overrides.js";
import { assertCodexRuntimeVersion } from "../../src/codex/runtime-version.js";
import {
  ModelGateway,
  modelGatewayEnvironmentKey,
} from "../../src/model-gateway/model-gateway.js";

type Json = Record<string, unknown>;
const object = z.record(z.string(), z.unknown());
const command = process.env.CODEX_BIN?.trim() || "codex";
await assertCodexRuntimeVersion({ command });
const version = `codex-cli ${CODEX_SCHEMA_VERSION}`;
const model = "gpt-6-astra";
const answer = "> Which scope?\n\nAll features";
const asyncQuestionItem = z.object({
  type: z.literal("agentMessage"),
  questions: z.array(z.object({ title: z.string() })),
});
const userMessageItem = z.object({
  type: z.literal("userMessage"),
  content: z.array(z.unknown()),
});
const textInput = z.object({ type: z.literal("text"), text: z.string() });
const logger = pino({ enabled: false });
const modes: ModelProviderProtocolMode[] = [
  "native_responses",
  "responses_tool_compat",
  "chat_completions_bridge",
];
const results: Json[] = [];
for (const mode of modes) {
  for (const answerDuringTurn of [true, false])
    results.push(await run(mode, answerDuringTurn));
}
console.log(JSON.stringify({ status: "ok", version, model, results }));

async function run(
  mode: ModelProviderProtocolMode,
  answerDuringTurn: boolean,
): Promise<Json> {
  const root = await mkdtemp(
    path.join(tmpdir(), "linksense-codex-functional-"),
  );
  const userHome = path.join(root, "home");
  const codexHome = path.join(userHome, ".codex");
  const workspace = path.join(userHome, "workspace");
  await mkdir(codexHome, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(codexHome, "config.toml"),
    await readFile(
      process.env.LINKSENSE_CODEX_HOME_TEMPLATE
        ? path.join(process.env.LINKSENSE_CODEX_HOME_TEMPLATE, "config.toml")
        : new URL(
        "../../../../deploy/codex-home-template/config.toml",
        import.meta.url,
      ),
    ),
  );
  const notifications: JsonRpcNotification[] = [];
  const requests: Json[] = [];
  const tools = new Map<
    string,
    { name: string; namespace?: string; type: string }
  >();
  let generation = 0;
  let responseSequence = 0;
  let releaseModel: (() => void) | undefined;
  const modelGate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  const failures: unknown[] = [];
  const upstream = createServer((request, response) => {
    void (async () => {
      assert.equal(
        request.headers.authorization,
        "Bearer functional-provider-key",
      );
      let text = "";
      for await (const chunk of request) text += String(chunk);
      const body = object.parse(JSON.parse(text));
      const output = await respond(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (mode === "chat_completions_bridge") {
        const item = output[0];
        const delta =
          item?.type === "function_call"
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: item.call_id,
                    type: "function",
                    function: { name: item.name, arguments: item.arguments },
                  },
                ],
              }
            : { content: "FUNCTIONAL_OK" };
        response.end(
          `data: ${JSON.stringify({ id: `chat-${responseSequence++}`, model, choices: [{ index: 0, delta }] })}\n\ndata: [DONE]\n\n`,
        );
      } else {
        for (const event of responseEvents(output))
          response.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        response.end();
      }
    })().catch((error: unknown) => {
      failures.push(error);
      response.destroy();
    });
  });
  const sockets = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (request, socket, head) => {
    if (request.headers.authorization !== "Bearer functional-provider-key") {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.on("message", (data) => {
        void (async () => {
          const output = await respond(
            object.parse(JSON.parse(data.toString())),
          );
          for (const event of responseEvents(output))
            ws.send(JSON.stringify(event));
        })().catch((error: unknown) => {
          failures.push(error);
          ws.terminate();
        });
      });
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert(address && typeof address !== "string");
  const gateway = new ModelGateway({ logger });
  await gateway.start();
  const lease = gateway.issueLease({
    conversationId: randomUUID(),
    ownerId: randomUUID(),
    revision: 1,
    upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "functional-provider-key",
    protocolMode: mode,
    model,
    pricing: {
      input_price_per_million: "0",
      cached_input_price_per_million: "0",
      output_price_per_million: "0",
    },
  });
  const connect = async () => {
    const client = new CodexJsonRpcClient({
      command,
      userHome,
      codexHome,
      logger,
      requestTimeoutMs: 30_000,
      extraEnvironment: { [modelGatewayEnvironmentKey]: lease.token },
      configOverrides: [
        ...linkSenseModelProviderConfigOverrides({
          baseUrl: gateway.baseUrl,
          protocolMode: mode,
        }),
        "features.memories=false",
      ],
    });
    client.on("notification", (event: JsonRpcNotification) =>
      notifications.push(event),
    );
    await client.initialize();
    return client;
  };
  let client = await connect();
  const threadParams = {
    model,
    modelProvider: "link-sense",
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    ephemeral: false,
  };
  try {
    const { thread } = await client.request<{ thread: CodexThread }>(
      "thread/start",
      threadParams,
    );
    const { turn } = await client.request<{ turn: CodexTurn }>("turn/start", {
      threadId: thread.id,
      model,
      input: [
        {
          type: "text",
          text: "Ask which scope, keep working, and use my answer.",
          text_elements: [],
        },
      ],
      cwd: workspace,
      runtimeWorkspaceRoots: [workspace],
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    const questionEvent = await waitFor(client, (event) =>
      mapCodexNotification(event).some(
        (mapped) =>
          mapped.method === "item/completed" &&
          mapped.params.item.type === "agentMessage" &&
          mapped.params.item.questions?.length === 1,
      ),
    );
    const projected = mapCodexNotification(questionEvent);
    assert(
      projected.some(
        (event) =>
          event.method === "item/completed" &&
          event.params.item.type === "agentMessage" &&
          event.params.item.delivery === "async",
      ),
    );
    let answerTurnId = turn.id;
    if (answerDuringTurn) {
      const steered = await client.request<{ turnId: string }>("turn/steer", {
        threadId: thread.id,
        expectedTurnId: turn.id,
        input: [{ type: "text", text: answer, text_elements: [] }],
      });
      assert.equal(steered.turnId, turn.id);
      releaseModel?.();
    } else {
      await completed(client, turn.id);
      const beforeResume = generation;
      await client.close();
      client = await connect();
      const resumed = await client.request<{ thread: CodexThread }>(
        "thread/resume",
        { ...threadParams, threadId: thread.id },
      );
      assert(
        resumed.thread.turns
          ?.flatMap((entry) => entry.items)
          .some(
            (item) =>
              asyncQuestionItem.safeParse(item).data?.questions[0]?.title ===
              "Which scope?",
          ),
      );
      assert.equal(
        generation,
        beforeResume,
        "resuming questions must not replay model requests",
      );
      const next = await client.request<{ turn: CodexTurn }>("turn/start", {
        threadId: thread.id,
        model,
        input: [{ type: "text", text: answer, text_elements: [] }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
      answerTurnId = next.turn.id;
      assert.notEqual(answerTurnId, turn.id);
    }
    await completed(client, answerTurnId);
    assert.equal(
      await readFile(path.join(workspace, "functional-result.txt"), "utf8"),
      "All features\n",
    );
    assert(
      notifications.some((event) => event.method === "turn/plan/updated"),
      "update_plan must remain callable",
    );
    const history = (
      await client.request<{ thread: CodexThread }>("thread/read", {
        threadId: thread.id,
        includeTurns: true,
      })
    ).thread;
    const turns = history.turns ?? [];
    assert.equal(
      turns.length,
      answerDuringTurn ? 1 : 2,
      "answer delivery must not create an extra turn",
    );
    assert.equal(
      turns
        .flatMap((entry) => entry.items)
        .filter((item) =>
          userMessageItem
            .safeParse(item)
            .data?.content.some(
              (content) => textInput.safeParse(content).data?.text === answer,
            ),
        ).length,
      1,
    );
    assert.equal(failures.length, 0);
    return {
      mode,
      answerDuringTurn,
      nativeTurns: turns.length,
      modelRequests: generation,
      codeExecuted: true,
      planUpdated: true,
      questionsPersisted: true,
    };
  } catch (error) {
    throw new Error(
      `${mode}, answerDuringTurn=${answerDuringTurn}: ${String(error)}; fixture failures=${failures.map(String).join("; ")}; generation=${generation}`,
      { cause: error },
    );
  } finally {
    releaseModel?.();
    await client.close();
    lease.release();
    await gateway.close();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }

  async function respond(body: Json): Promise<Json[]> {
    requests.push(body);
    const definitions = [
      ...(Array.isArray(body.tools) ? body.tools : []),
      ...(Array.isArray(body.input)
        ? body.input.flatMap((value) => {
            const item = object.parse(value);
            return item.type === "additional_tools" && Array.isArray(item.tools)
              ? item.tools
              : [];
          })
        : []),
    ];
    for (const value of definitions) {
      const tool = object.parse(value);
      if (tool.type === "namespace" && Array.isArray(tool.tools)) {
        for (const value of tool.tools) {
          const child = object.parse(value);
          tools.set(String(child.name), {
            name: String(child.name),
            namespace: String(tool.name),
            type: String(child.type),
          });
        }
      } else {
        const definition =
          tool.type === "function" && tool.function
            ? object.parse(tool.function)
            : tool;
        const name = String(definition.name);
        tools.set(name.replace(/^functions__/, ""), {
          name,
          type: String(tool.type),
        });
      }
    }
    if (body.generate === false) return [];
    generation++;
    if (generation === 1)
      return [
        toolCall("request_user_input_async", {
          questions: [
            { title: "Which scope?", options: ["All features", "Minimal"] },
          ],
        }),
      ];
    if (answerDuringTurn && generation === 2) await modelGate;
    const executionRequest = answerDuringTurn ? 2 : 3;
    if (generation === executionRequest) {
      const code =
        'text(await tools.update_plan({plan:[{step:"Verify upgrade",status:"in_progress"}]})); text(await tools.exec_command({cmd:"printf \'All features\\n\' > functional-result.txt",yield_time_ms:1000}));';
      return [toolCall("exec", code)];
    }
    if (generation > executionRequest) {
      assert(
        requests.some((request) =>
          JSON.stringify(request.input ?? request.messages).includes(
            JSON.stringify(answer).slice(1, -1),
          ),
        ),
        "answer was not sent to the provider",
      );
    }
    return [
      {
        id: `msg-${generation}`,
        type: "message",
        role: "assistant",
        phase: "final_answer",
        status: "completed",
        content: [
          { type: "output_text", text: "FUNCTIONAL_OK", annotations: [] },
        ],
      },
    ];
  }

  function toolCall(name: string, args: Json | string): Json {
    const definition = tools.get(name);
    assert(definition, `native catalog did not expose ${name}`);
    const common = {
      id: `item-${generation}`,
      call_id: `call-${generation}`,
      name: definition.name,
      status: "completed",
      ...(definition.namespace ? { namespace: definition.namespace } : {}),
    };
    return definition.type === "custom"
      ? { ...common, type: "custom_tool_call", input: args }
      : {
          ...common,
          type: "function_call",
          arguments: JSON.stringify(
            typeof args === "string" ? { input: args } : args,
          ),
        };
  }

  function responseEvents(output: Json[]): Json[] {
    const response = {
      id: `resp-${responseSequence++}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1_000),
      status: "completed",
      model,
      output,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    return [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      ...output.flatMap((item, output_index) => [
        { type: "response.output_item.added", output_index, item },
        { type: "response.output_item.done", output_index, item },
      ]),
      { type: "response.completed", response },
    ];
  }

  function waitFor(
    active: CodexJsonRpcClient,
    predicate: (event: JsonRpcNotification) => boolean,
  ): Promise<JsonRpcNotification> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        active.off("notification", inspect);
        reject(new Error("native event timeout"));
      }, 30_000);
      function inspect(event: JsonRpcNotification) {
        if (!predicate(event)) return;
        clearTimeout(timeout);
        active.off("notification", inspect);
        resolve(event);
      }
      active.on("notification", inspect);
      for (const event of notifications) inspect(event);
    });
  }

  async function completed(
    active: CodexJsonRpcClient,
    turnId: string,
  ): Promise<void> {
    const event = await waitFor(
      active,
      (event) =>
        event.method === "turn/completed" &&
        object.parse(object.parse(event.params).turn).id === turnId,
    );
    const turn = object.parse(object.parse(event.params).turn);
    assert.equal(turn.status, "completed", JSON.stringify(turn.error));
  }
}
