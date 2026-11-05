import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { z } from "zod";
import { PublicKnowledgeRuntime } from "../../src/public-knowledge/runtime.js";
import { CODEX_SCHEMA_VERSION } from "../../src/codex/protocol.js";

// Real pinned Codex, temporary state and a loopback inference fixture only.
// No workspace .env, business data, external model or paid request is used.
const root = await mkdtemp(join(tmpdir(), "linksense-public-native-"));
const command = process.env.CODEX_BIN ?? "codex";
const version = await promisify(execFile)(command, ["--version"]);
assert.equal(version.stdout.trim(), `codex-cli ${CODEX_SCHEMA_VERSION}`);
const requests: Array<{
  input: unknown[];
  instructions?: string | undefined;
  tools?: unknown[] | undefined;
}> = [];
const failures: unknown[] = [];
let releaseFirstAnswer: () => void = () => undefined;
const firstAnswerGate = new Promise<void>((resolve) => {
  releaseFirstAnswer = resolve;
});
let firstAnswerCompleted = false;
const server = createServer((request, response) => {
  void (async () => {
    let text = "";
    for await (const bytes of request) text += String(bytes);
    const body = z
      .object({
        input: z.array(z.unknown()),
        instructions: z.string().optional(),
        tools: z.array(z.unknown()).optional(),
        tool_choice: z.string().optional(),
      })
      .parse(JSON.parse(text));
    assert.deepEqual(body.tools, []);
    assert.equal(body.tool_choice, "none");
    requests.push(body);
    const id = `response-${requests.length}`;
    const item = {
      id: `message-${requests.length}`,
      type: "message",
      role: "assistant",
      status: "completed",
      phase: "final_answer",
      content: [
        {
          type: "output_text",
          text: `ANSWER_${requests.length} [1]`,
          annotations: [],
        },
      ],
    };
    const result = {
      id,
      object: "response",
      status: "completed",
      model: "gpt-5.4",
      output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    response.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (event: { type: string } & Record<string, unknown>) =>
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    if (requests.length === 1) {
      emit({
        type: "response.created",
        response: { ...result, status: "in_progress", output: [] },
      });
      emit({
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      });
      emit({
        type: "response.content_part.added",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      emit({
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: "ANSWER_1 ",
      });
      await firstAnswerGate;
      firstAnswerCompleted = true;
      emit({
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: "[1]",
      });
      emit({
        type: "response.output_text.done",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        text: "ANSWER_1 [1]",
      });
      emit({ type: "response.output_item.done", output_index: 0, item });
      emit({ type: "response.completed", response: result });
      response.end();
      return;
    }
    for (const event of [
      {
        type: "response.created",
        response: { ...result, status: "in_progress", output: [] },
      },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result },
    ])
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    response.end();
  })().catch((error) => {
    failures.push(error);
    response.destroy();
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const runtime = new PublicKnowledgeRuntime({
  root,
  command,
  logger: pino({ level: process.env.LOG_LEVEL ?? "silent" }),
  timeoutMs: 30_000,
});
const applicationId = randomUUID(),
  a = randomUUID(),
  b = randomUUID();
const input = (
  conversationId: string,
  text: string,
  threadId: string | null = null,
) => ({
  applicationId,
  conversationId,
  operationId: randomUUID(),
  threadId,
  instructions:
    "Answer questions using the supplied website evidence. No tools or shared memory.",
  skills: [],
  inputText: text,
  model: "gpt-5.4",
  reasoningEffort: "minimal" as const,
  provider: {
    revision: 1,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture-private-key",
    protocolMode: "native_responses" as const,
  },
});
try {
  const skill = {
    id: randomUUID(),
    name: "website-answer-style",
    markdown:
      "---\nname: website-answer-style\ndescription: Guide website answers\n---\nSKILL_GUIDANCE_MARKER_789: use short paragraphs and cite website sources.\n",
  };
  const firstInput = { ...input(a, "VISITOR_A_ONLY_123"), skills: [skill] };
  let observedProgress: () => void = () => undefined;
  const observed = new Promise<void>((resolve) => {
    observedProgress = resolve;
  });
  const progress: unknown[] = [];
  const firstTask = runtime.run(firstInput, async (events) => {
    progress.push(...events);
    if (
      events.some(
        ({ params }) =>
          params.notification.method === "item/agentMessage/delta" &&
          params.notification.params.delta.includes("ANSWER_1 "),
      )
    )
      observedProgress();
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      observed,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error("native progress did not arrive before completion"),
            ),
          10_000,
        );
      }),
    ]);
    assert.equal(
      firstAnswerCompleted,
      false,
      "Partial output must reach the observer before inference completes",
    );
    assert(
      !JSON.stringify(progress).includes("VISITOR_A_ONLY_123"),
      "Progress must not include private input or knowledge context",
    );
  } finally {
    clearTimeout(deadline);
    releaseFirstAnswer();
  }
  const first = await firstTask;
  assert.equal(first.status, "completed", JSON.stringify(first));
  assert.equal(first.outputText, "ANSWER_1 [1]");
  assert(first.threadId);
  assert(
    JSON.stringify(requests[0]).includes("SKILL_GUIDANCE_MARKER_789"),
    "Selected native Skill instructions must reach inference",
  );
  const second = await runtime.run(input(b, "VISITOR_B_ONLY_456"));
  assert.equal(second.status, "completed");
  assert.notEqual(first.threadId, second.threadId);
  assert(!JSON.stringify(requests[1]?.input).includes("VISITOR_A_ONLY_123"));
  assert(
    !JSON.stringify(requests[1]).includes("SKILL_GUIDANCE_MARKER_789"),
    "Skill guidance must not leak to another visitor",
  );
  const followup = await runtime.run(
    input(a, "Continue my earlier question", first.threadId),
  );
  assert.equal(followup.status, "completed");
  assert.equal(followup.threadId, first.threadId);
  assert(JSON.stringify(requests[2]?.input).includes("VISITOR_A_ONLY_123"));
  assert(!JSON.stringify(requests[2]?.input).includes("VISITOR_B_ONLY_456"));
  assert.deepEqual(await runtime.run(firstInput), first);
  assert.equal(
    requests.length,
    3,
    "idempotent replay must not perform inference",
  );
  assert.deepEqual(
    await runtime.result(applicationId, a, firstInput.operationId),
    first,
  );
  assert.equal(
    await runtime.result(applicationId, b, firstInput.operationId),
    null,
  );
  const differentRuntime = new PublicKnowledgeRuntime({
    root,
    command,
    logger: pino({ level: "silent" }),
    timeoutMs: 30_000,
  });
  const resumed = await differentRuntime.run(
    input(a, "Resume after process restart", first.threadId),
  );
  assert.equal(resumed.threadId, first.threadId);
  assert.equal(resumed.status, "completed");
  assert(JSON.stringify(requests[3]?.input).includes("VISITOR_A_ONLY_123"));
  const beforeInvalidSkill = requests.length;
  const invalidSkill = await runtime.run({
    ...input(randomUUID(), "Invalid Skill must not reach inference"),
    skills: [
      {
        ...skill,
        markdown: "---\nname: website-answer-style\n---\nMissing description\n",
      },
    ],
  });
  assert.equal(
    invalidSkill.status,
    "failed",
    "Invalid native Skill metadata must fail closed",
  );
  assert.equal(
    requests.length,
    beforeInvalidSkill,
    "Undiscoverable Skills must not silently fall back to an ordinary answer",
  );
  assert.equal(runtime.size, 0);
  const directory = join(root, "public-knowledge", applicationId, a);
  for (const file of await readdir(directory)) {
    if (file.endsWith(".json"))
      assert(
        !(await readFile(join(directory, file), "utf8")).includes(
          "fixture-private-key",
        ),
      );
  }
  assert.deepEqual(failures, []);
  console.log(
    "PASS: live output before inference completion, native selected Skill injection, independent threads, continuation, restart recovery, durable idempotency, tool denial and result isolation",
  );
} finally {
  await runtime.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
