import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  connectionResultSchema,
  knowledgeDocumentListSuccessSchema,
  knowledgeDocumentMarkdownSuccessSchema,
  knowledgeSearchSuccessSchema,
  RUNNER_TURN_INTERRUPT_REQUESTED,
} from "@linksense/shared";
import Fastify from "fastify";
import { z } from "zod";

import type { LinkSenseRedis } from "../../src/adapters/redis.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
import type { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import type { ConversationEventService } from "../../src/modules/events/service.js";
import type { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";

const fixtureModel = "desktop-fixture";
const readPrompt = "Read the local fixture file";
const interruptPrompt = "Wait for the local interruption";
const answer = "The packaged Mac read the workspace.";

export async function verifyPackagedDesktopGateway(input: {
  runtimeRoot: string;
  scratch: string;
  address: string;
  prisma: PrismaClient;
  redis: LinkSenseRedis;
  coordinator: RedisDesktopDeviceCoordinator;
  conversations: ConversationService;
  events: ConversationEventService;
  modelProviderSettings: ModelProviderSettingsService;
  ownerId: string;
  deviceId: string;
  token: string;
  previousConnectionId: string;
  serverSecrets: string[];
  searchMarker: string;
  connector: { driveName: string; documentName: string; documentText: string };
  knowledge: { baseId: string; baseName: string; documentName: string; content: string };
}): Promise<void> {
  assert(process.platform === "darwin" && process.arch === "arm64" && isAbsolute(input.runtimeRoot),
    "the package regression requires a local Mac arm64 app runtime");
  z.object({ target: z.literal("darwin/arm64") }).parse(
    JSON.parse(await readFile(join(input.runtimeRoot, "manifest.json"), "utf8")),
  );
  const { ownerId, deviceId, prisma, conversations, events, coordinator, redis } = input;
  await mkdir(input.scratch, { recursive: true, mode: 0o700 });
  const scratch = await realpath(input.scratch);
  const dataRoot = join(scratch, "native-runtime");
  const binary = join(scratch, "bridge-test");
  const go = promisify(execFile);
  await go("go", [
    "test", "-c", "-tags", "desktop_runtime_package", "-o", binary, ".",
  ], {
    cwd: fileURLToPath(new URL("../../../desktop/", import.meta.url)),
    env: { ...process.env, GOPROXY: "off" },
    timeout: 60_000,
  });
  const providerKey = randomUUID();
  const secrets = [...input.serverSecrets, providerKey];
  const marker = `workspace-marker-${randomUUID()}`;
  const model = Fastify();
  const modelRequests = { read: 0, interrupt: 0, aborted: false };
  let closeModelStream: (() => void) | undefined;
  let modelFailure: string | undefined;
  let citation: string | undefined;
  let documentRef: string | undefined;
  let connectorText = "";
  let connectorPages = 0;
  model.setErrorHandler((error, _request, reply) => {
    modelFailure = error instanceof assert.AssertionError
      ? `Synthetic provider: ${error.message}`
      : error instanceof z.ZodError
        ? `Synthetic provider schema: ${error.issues.map(issue => `${issue.path.join(".")}:${issue.code}`).join(",")}`
        : "Synthetic provider received an invalid tool result";
    void reply.code(400).send({ error: { code: "invalid_fixture_request" } });
  });
  model.post("/v1/responses", async (request, reply) => {
    assert(request.headers.authorization === `Bearer ${providerKey}`, "provider authorization mismatch");
    const body = z.object({
      model: z.literal(fixtureModel), input: z.unknown(), stream: z.literal(true),
      tools: z.array(z.object({
        name: z.string().optional(), type: z.string(),
        tools: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
      })).optional(),
    }).parse(request.body);
    const text = JSON.stringify(body.input);
    assert(!secrets.some(secret => text.includes(secret)), "server secret in model input");
    if (text.includes(interruptPrompt)) {
      modelRequests.interrupt++;
      assert(modelRequests.interrupt === 1, "interrupted turn replayed");
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream" });
      reply.raw.flushHeaders();
      closeModelStream = () => { reply.raw.destroy(); };
      reply.raw.once("close", () => { modelRequests.aborted = true; });
      return;
    }
    assert(text.includes(readPrompt), "unexpected input");
    const call = ++modelRequests.read;
    const functions = body.tools?.find(tool => tool.type === "namespace" &&
      tool.tools?.some(member => member.type === "function" && member.name === "search_web"));
    const callTool = (name: string, args: object, group = functions) => {
      assert(group?.name && group.tools?.some(member => member.type === "function" && member.name === name),
        `Fixture tool unavailable: ${name}`);
      return reply.type("text/event-stream").send(responseStream({
        id: `fixture-tool-${call}`, type: "function_call", call_id: `fixture-call-${call}`, name,
        namespace: group.name, arguments: JSON.stringify(args), status: "completed",
      }));
    };
    if (call === 1) {
      assert(text.includes(input.knowledge.baseName), "selected knowledge base did not reach Codex");
      assert(body.tools?.some(tool => tool.type === "function" && tool.name === "exec_command"));
      return reply.type("text/event-stream").send(responseStream({
        id: "fixture-tool", type: "function_call", call_id: "fixture-call", name: "exec_command",
        arguments: JSON.stringify({ cmd: "cat fixture.txt", yield_time_ms: 1000 }), status: "completed",
      }));
    }
    if (call === 2) {
      assert(text.includes(marker), "native shell did not return the local file");
      return callTool("search_web", { query: "packaged mac fixture search" });
    }
    if (call === 3) {
      assert(text.includes(input.searchMarker), "native web search did not return the server result");
      return callTool("search_knowledge_base", { query: "fixture reference" });
    }
    if (call === 4) {
      const result = knowledgeSearchSuccessSchema.parse(toolOutput(body.input, "fixture-call-3"));
      const [match] = result.results;
      assert(
        result.results.length === 1 && match?.content === input.knowledge.content &&
        match.knowledge_base_name === input.knowledge.baseName && match.document_name === input.knowledge.documentName,
        "native knowledge search did not return only the authorized fixture document",
      );
      citation = match.citation_marker;
      return callTool("list_knowledge_documents", {});
    }
    if (call === 5) {
      const list = knowledgeDocumentListSuccessSchema.parse(toolOutput(body.input, "fixture-call-4"));
      const [listed] = list.documents;
      assert(
        list.documents.length === 1 && list.next_cursor === null &&
        listed?.document_name === input.knowledge.documentName && listed.knowledge_base_name === input.knowledge.baseName,
        "native knowledge listing did not return only the authorized fixture document",
      );
      documentRef = listed.document_ref;
      return callTool("get_knowledge_document_markdown", { document_ref: documentRef });
    }
    if (call === 6) {
      const markdown = knowledgeDocumentMarkdownSuccessSchema.parse(toolOutput(body.input, "fixture-call-5"));
      assert(
        markdown.document_ref === documentRef && markdown.markdown === input.knowledge.content &&
        markdown.complete && markdown.next_cursor === null,
        "native knowledge reader did not return the complete document",
      );
      const microsoft = body.tools?.find(tool => tool.name?.endsWith("linksense_microsoft_files"));
      assert(microsoft?.type === "namespace" && microsoft.tools?.map(tool => tool.name).join() === "read_files",
        "native Mac turn did not load the read-only Microsoft connector");
      return callTool("read_files", { operation: "list_drives", provider: "onedrive" }, microsoft);
    }
    if (call === 7) {
      const page = connectionResultSchema.parse(toolOutput(body.input, "fixture-call-6"));
      assert(page.kind === "page" && page.items.length === 1 && page.items[0]?.name === input.connector.driveName,
        "native Microsoft connector did not return the owner's drive");
      const docs = body.tools?.find(tool => tool.name?.endsWith("linksense_google_docs"));
      assert(docs?.type === "namespace" && docs.tools?.map(tool => tool.name).join() === "read",
        "native Mac turn did not load the read-only Google Docs connector");
      return callTool("read", { request: { provider: "google_docs", operation: "search_documents", query: "fixture" } }, docs);
    }
    const docs = body.tools?.find(tool => tool.name?.endsWith("linksense_google_docs"));
    const documentRequest = { provider: "google_docs", operation: "read_document", document_id: "fixture-doc" };
    if (call === 8) {
      const search = z.object({ data: z.string(), complete: z.literal(true) }).parse(toolOutput(body.input, "fixture-call-7"));
      assert.deepEqual(JSON.parse(search.data), [{ name: input.connector.documentName }]);
      return callTool("read", { request: documentRequest }, docs);
    }
    assert(call <= 14, "the connector issued too many pages for the fixture");
    const page = z.object({
      data: z.string(), complete: z.boolean(), sha256: z.string(), next_byte_offset: z.number().nullable(),
    }).parse(toolOutput(body.input, `fixture-call-${call - 1}`));
    connectorPages++;
    connectorText += page.data;
    if (!page.complete) {
      assert.equal(page.next_byte_offset, Buffer.byteLength(connectorText), "native output was truncated before the byte offset");
      return callTool("read", { request: documentRequest, byte_offset: page.next_byte_offset, expected_sha256: page.sha256 }, docs);
    }
    assert(connectorPages > 1, "fixture must exercise connector continuation through Codex");
    assert.deepEqual(JSON.parse(connectorText), {
      documentId: "fixture-doc", title: input.connector.documentName, text: input.connector.documentText,
    });
    assert(citation, "native knowledge search did not return a citation");
    return reply.type("text/event-stream").send(responseStream({
      id: "fixture-answer", type: "message", role: "assistant", status: "completed", phase: "final_answer",
      content: [{ type: "output_text", text: `${answer} ${citation}`, annotations: [] }],
    }));
  });

  let child: ReturnType<typeof spawn> | undefined;
  let childExit: Promise<number | null> | undefined;
  let serverSecretInNativeOutput = false;
  let nativeExited = false;
  try {
    const modelOrigin = await model.listen({ host: "127.0.0.1", port: 0 });
    await input.modelProviderSettings.update(ownerId, {
      expected_revision: 0, default_model: fixtureModel, title_model: null,
      providers: [{
        id: "desktop-fixture", base_url: `${modelOrigin}/v1`, protocol_mode: "native_responses", api_key: providerKey,
        models: [{
          kind: "chat", id: fixtureModel, display_name: "Desktop fixture", enabled: true,
          context_window: 32768, supported_reasoning_efforts: ["low"], default_reasoning_effort: "low",
        }],
      }],
    }, {});
    const task = async (title: string) => {
      const id = randomUUID();
      const home = join(dataRoot, ownerId, "services", id, "home");
      const workspace = join(home, "workspace");
      const rules = join(home, ".codex", "rules");
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      await mkdir(rules, { recursive: true, mode: 0o700 });
      await writeFile(join(workspace, "fixture.txt"), `${marker}\n`, { mode: 0o600 });
      await writeFile(join(rules, "default.rules"), 'prefix_rule(pattern=["cat", "fixture.txt"], decision="allow")\n', { mode: 0o600 });
      return prisma.conversation.create({
        data: {
          id, ownerId, title, titleSource: "manual", archiveStatus: "active", executionTarget: "local", desktopDeviceId: deviceId,
          workspaceRelPath: `${ownerId}/services/${id}/home/workspace`, runtimeGeneration: randomUUID(),
        },
      });
    };
    const read = await task("Packaged Mac workspace read");
    const stop = await task("Packaged Mac interruption");
    child = spawn(binary, ["-test.run=^TestPackagedDesktopGateway$", "-test.timeout=85s"], {
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        LINKSENSE_DESKTOP_RUNTIME_DIST: input.runtimeRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert(child.stdin && child.stdout && child.stderr);
    childExit = once(child, "close").then(([code]) => typeof code === "number" ? code : null);
    void childExit.then(() => { nativeExited = true; }, () => { nativeExited = true; });
    const scanOutput = () => {
      let tail = "";
      const maxSecretLength = Math.max(...secrets.map(secret => secret.length));
      return (chunk: Buffer) => {
        const output = tail + chunk.toString();
        serverSecretInNativeOutput ||= secrets.some(secret => output.includes(secret));
        tail = output.slice(-maxSecretLength);
      };
    };
    child.stdout.on("data", scanOutput());
    child.stderr.on("data", scanOutput());
    child.stdin.on("error", () => { nativeExited = true; });
    child.stdin.write(`${JSON.stringify({
      origin: input.address, dataRoot, credential: { token: input.token, ownerId, deviceId, name: "Mac fixture" },
    })}\n`);
    const waitFor = async (description: string, check: () => Promise<boolean>, timeout = 15_000) => {
      const deadline = Date.now() + timeout;
      do {
        if (modelFailure) throw new Error(modelFailure);
        if (nativeExited) throw new Error(`Mac bridge exited while waiting for ${description}`);
        if (await check()) return;
        await delay(60);
      } while (Date.now() < deadline);
      throw new Error(`Mac gateway timed out waiting for ${description}`);
    };
    await waitFor("a new negotiated Mac connection", async () => {
      const current = await coordinator.executionConnection(deviceId);
      return current !== null && current.connectionId !== input.previousConnectionId;
    }, 25_000);
    const submission = (inputText: string, idempotencyKey: string) =>
      ({ inputText, idempotencyKey, submitMode: "normal" as const, priorityCapabilityIds: [] });
    const completed = await conversations.acceptTurn(ownerId, read.id, {
      ...submission(readPrompt, "desktop-read"), knowledgeBaseIds: [input.knowledge.baseId],
    }, {});
    const status = async (id: string) =>
      (await prisma.conversationTurn.findUnique({ where: { id }, select: { status: true } }))?.status;
    try {
      await waitFor("completed workspace read and slot release", async () =>
        await status(completed.turn_id) === "completed" && !await redis.hasTurnSlot(read.id, completed.turn_id, ownerId),
      );
    } catch (error) {
      const intent = await prisma.conversationTurnStartIntent.findUnique({
        where: { projectionTurnId: completed.turn_id }, select: { runnerStatus: true },
      });
      const events = await prisma.conversationEvent.findMany({
        where: { conversationId: read.id }, select: { eventType: true, payloadJson: true },
        orderBy: { sequenceNo: "desc" }, take: 8,
      });
      const toolAudits = await prisma.auditLog.findMany({
        where: { action: "desktop_tool_requested", metadataJson: { path: ["turn_id"], equals: completed.turn_id } },
        select: { result: true, metadataJson: true }, orderBy: { createdAt: "asc" },
      });
      const itemType = z.object({ params: z.object({ item: z.object({ type: z.string() }) }) });
      const auditOutcome = z.object({ operation: z.string(), reason_code: z.string().optional() });
      throw new Error(
        `Packaged turn status=${await status(completed.turn_id) ?? "none"} intent=${intent?.runnerStatus ?? "none"} modelCalls=${modelRequests.read} events=${events.map(row => `${row.eventType}/${itemType.safeParse(row.payloadJson).data?.params.item.type ?? "-"}`).join(",")} toolAudits=${JSON.stringify(toolAudits.map(row => ({ result: row.result, ...auditOutcome.safeParse(row.metadataJson).data })))}`,
        { cause: error },
      );
    }
    assert.equal(modelRequests.read, 8 + connectorPages);
    const readHistory = await events.historyPage(ownerId, read.id, { afterSequence: 0n, limit: 50 });
    assert(readHistory.items.some(event => event.event_type === "item/completed" &&
      JSON.stringify(event.payload).includes("commandExecution") && event.turn_id === completed.turn_id));
    const message = await prisma.conversationMessage.findFirst({
      where: { conversationId: read.id, turnId: completed.turn_id, role: "assistant" },
      select: { id: true, contentText: true },
    });
    assert(message);
    assert(message.contentText.trimEnd() === answer, "the projected answer retained a private citation marker");
    const citations = await prisma.conversationMessageKnowledgeCitation.findMany({
      where: { messageId: message.id },
      select: { knowledgeBaseId: true, documentNameSnapshot: true, citationNo: true },
    });
    assert.deepEqual(citations, [{
      knowledgeBaseId: input.knowledge.baseId, documentNameSnapshot: input.knowledge.documentName, citationNo: 1,
    }]);

    const stopRequest = submission(interruptPrompt, "desktop-interrupt");
    const pending = await conversations.acceptTurn(ownerId, stop.id, stopRequest, {});
    await waitFor("in-flight inference and its projected turn", async () =>
      modelRequests.interrupt === 1 && await status(pending.turn_id) === "running",
    );
    const interrupt = await conversations.interrupt(ownerId, stop.id, pending.turn_id, {});
    assert.equal(interrupt.code, RUNNER_TURN_INTERRUPT_REQUESTED);
    await waitFor("native interruption and provider stream closure", async () =>
      modelRequests.aborted && await status(pending.turn_id) === "interrupted" &&
      !await redis.hasTurnSlot(stop.id, pending.turn_id, ownerId),
    );
    const retry = await conversations.acceptTurn(ownerId, stop.id, stopRequest, {});
    assert.equal(retry.turn_id, pending.turn_id);
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: stop.id } }), 1);
    const stopHistory = await events.historyPage(ownerId, stop.id, { afterSequence: 0n, limit: 50 });
    assert.equal(stopHistory.items.filter(event =>
      event.event_type === "turn/completed" && event.turn_id === pending.turn_id,
    ).length, 1);

    child.stdin.end();
    assert.equal(await childExit, 0, "native bridge failed to stop cleanly");
    assert.equal(modelRequests.interrupt, 1);
    assert(!modelFailure, "synthetic provider rejected the round trip");
    assert(!serverSecretInNativeOutput, "server credential reached native logs");
    await assertNoServerSecrets(dataRoot, secrets);
    console.log("Packaged Mac gateway passed: local Shell, scoped web, knowledge, and connector tools, citations, interrupt, and start idempotency.");
  } finally {
    closeModelStream?.();
    if (child?.stdin && !child.stdin.destroyed) child.stdin.end();
    if (childExit) await Promise.race([childExit.catch(() => null), delay(8_000, null, { ref: false })]);
    if (child?.exitCode === null && child.signalCode === null) {
      child.kill();
      await childExit?.catch(() => null);
    }
    await model.close();
  }
}

function toolOutput(input: unknown, callId: string): unknown {
  const item = z.looseObject({ type: z.string(), call_id: z.string().optional(), output: z.unknown().optional() });
  const match = z.array(item).parse(input).find(entry =>
    entry.type === "function_call_output" && entry.call_id === callId,
  );
  assert(match, "native tool output missing");
  const textItem = z.object({ type: z.literal("input_text"), text: z.string() });
  const [, payload] = z.tuple([
    textItem.extend({ text: z.string().regex(/^Wall time: \d+(?:\.\d+)? seconds\nOutput:$/u) }),
    textItem,
  ]).parse(match.output);
  return JSON.parse(payload.text);
}

function responseStream(item: Record<string, unknown>): string {
  const id = randomUUID();
  return [
    { type: "response.created", response: { id, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: "completed", output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

async function assertNoServerSecrets(dataRoot: string, secrets: string[]): Promise<void> {
  for (const entry of await readdir(dataRoot, { withFileTypes: true })) {
    const path = join(dataRoot, entry.name);
    if (entry.isDirectory()) await assertNoServerSecrets(path, secrets);
    if (!entry.isFile()) continue;
    const bytes = await readFile(path);
    assert(!secrets.some(secret => bytes.includes(secret)), "server credential persisted on device");
  }
}
