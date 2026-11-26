import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  browserUseApprovalSchema,
  browserUseFailure,
  browserUseResultSchema,
  codexTurnMetadataFromClientMetadata,
  connectionResultSchema,
  conversationStartFailurePayloadSchema,
  conversationUserInputQuestionSchema,
  DESKTOP_MODEL_PROXY_PATH,
  DESKTOP_MODEL_PURPOSE_HEADER,
  desktopApprovalDetailsSchema,
  desktopArtifactReceiptSchema,
  desktopAttachmentDownloadPath,
  desktopConversationReferenceReadOperation,
  desktopModelPurposeSchema,
  desktopModelTokenSchema,
  knowledgeDocumentListSuccessSchema,
  knowledgeDocumentMarkdownSuccessSchema,
  knowledgeSearchSuccessSchema,
  readConversationReferenceResultSchema,
  RUNNER_TURN_INTERRUPT_REQUESTED,
  type BrowserUseRequest,
  type DesktopArtifactReceipt,
  type DesktopModelPurpose,
} from "@linksense/shared";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { LinkSenseRedis } from "../../src/adapters/redis.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
import { isDesktopRunActive } from "../../src/modules/desktop-credentials/run-authority.js";
import { desktopRunLeaseKey, desktopRunScopeSchema } from "../../src/modules/desktop-credentials/run-leases.js";
import type { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import type { ConversationEventService } from "../../src/modules/events/service.js";
import type { FileService } from "../../src/modules/files/service.js";
import type { HtmlPreviewService } from "../../src/modules/html-preview/service.js";
import type { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";
import type { WebSiteService } from "../../src/modules/web-sites/service.js";

// Opt-in Chromium fixture contract shared with the Web E2E helper; the API never imports the helper.
export type DesktopBrowserExtensionFixture = {
  title: string;
  button: string;
  url: string;
  assertClickCounts: (shared: number) => Promise<void>;
  revoke: () => Promise<void>;
  close: () => Promise<void>;
};

export type AttachDesktopBrowserExtension = (input: {
  address: string;
  ownerId: string;
  scratch: string;
}) => Promise<DesktopBrowserExtensionFixture>;

const fixtureModel = "desktop-fixture";
const readPrompt = "Read the local fixture file";
const interruptPrompt = "Wait for the local interruption";
const interruptApprovalPrompt = "Wait for interruption during browser approval";
const nativeApprovalPrompt = "Wait for the local native approval";
const joinedBrowserPrompt = "Click the button on the shared Chromium fixture";
const approvalShell = "printf 'approved\\n' > approved.txt";
const stoppedAttachmentPrompt = "Never run this attachment transfer";
const answer = "The packaged Mac read the workspace.";
const memoryFixtureModel = "desktop-memory-fixture";
const memoryExtractionModel = "desktop-memory-extractor";
const memorySeedPrompt = "Remember this fixture preference: write short answers.";
const memoryForegroundPrompt = "Start a fresh Mac memory fixture turn.";
const continuationRequest = `Continue the selected task using its recorded result (${randomUUID()}).`;
const continuationMarker = `continuation-history-${randomUUID()}`;
const continuationUserText = `Fixture question containing ${continuationMarker}`;
const continuationAssistantText = `Fixture recorded answer containing ${continuationMarker}`;
const continuationWrongMarker = `unselected-history-${randomUUID()}`;
const continuationIdempotencyKey = `desktop-continuation-${randomUUID()}`;

export async function verifyPackagedDesktopGateway(input: {
  runtimeRoot: string;
  scratch: string;
  address: string;
  attachmentTransfer: ReturnType<typeof installPackagedAttachmentTransferGate>;
  prisma: PrismaClient;
  redis: LinkSenseRedis;
  coordinator: RedisDesktopDeviceCoordinator;
  observeModelRequests: (observer: ((request: FastifyRequest) => Promise<void>) | undefined) => void;
  conversations: ConversationService;
  events: ConversationEventService;
  files: Pick<FileService, "uploadAttachment" | "readArtifactDownload" | "listTaskArtifacts">;
  websites: Pick<WebSiteService, "create" | "resource">;
  htmlPreviews: Pick<HtmlPreviewService, "open" | "resource">;
  modelProviderSettings: ModelProviderSettingsService;
  ownerId: string;
  otherOwnerId: string;
  deviceId: string;
  token: string;
  previousConnectionId: string;
  revokeAttachmentRun: (turnId: string) => Promise<void>;
  disconnectAttachmentSocket: (connectionId: string) => Promise<void>;
  attachmentSizeBytes: number;
  artifactSizeBytes?: number;
  multipartWebsite: boolean;
  serverSecrets: string[];
  searchMarker: string;
  connector: { driveName: string; documentName: string; documentText: string };
  browser: { title: string; tabId: number; image: Buffer; ref: string; observed: readonly string[] };
  attachBrowserExtension?: () => Promise<DesktopBrowserExtensionFixture>;
  knowledge: { baseId: string; baseName: string; documentName: string; content: string };
}): Promise<{
  id: string; turnId: string; conversationId: string; sizeBytes: number; websiteArtifactId: string;
  websiteAssets: string[]; model: string; modelCalls: number;
}> {
  assert(process.platform === "darwin" && process.arch === "arm64" && isAbsolute(input.runtimeRoot),
    "the package regression requires a local Mac arm64 app runtime");
  z.object({ target: z.literal("darwin/arm64") }).parse(
    JSON.parse(await readFile(join(input.runtimeRoot, "manifest.json"), "utf8")),
  );
  const { ownerId, deviceId, prisma, conversations, events, coordinator, redis, observeModelRequests } = input;
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
  const attachmentName = "fixture.txt";
  const attachmentData = Buffer.alloc(input.attachmentSizeBytes, "a");
  attachmentData.write(`${marker}\n`);
  const attachmentChecksum = createHash("sha256").update(attachmentData).digest("hex");
  const artifactDisplayName = "packaged-artifact.txt";
  const artifactRelativePath = `artifacts/${artifactDisplayName}`;
  const artifactMarker = `packaged artifact ${randomUUID()}\n`;
  const artifactSizeBytes = input.artifactSizeBytes ?? Buffer.byteLength(artifactMarker);
  let artifactChecksum: string | undefined;
  let artifactWorkspace: string | undefined;
  let artifactReceipt: DesktopArtifactReceipt | undefined;
  let websiteReceipt: DesktopArtifactReceipt | undefined;
  let nativeApprovalReceipt: DesktopArtifactReceipt | undefined;
  const websiteRoot = "artifacts/site";
  const websiteHtml = '<!doctype html><link rel="stylesheet" href="/assets/theme.css"><h1>Packaged Mac site</h1>';
  const websiteCss = "h1{color:rebeccapurple}";
  const websiteAssets = ["assets/theme.css", "index.html"];
  const model = Fastify();
  const modelRequests = { read: 0, artifact: 0, interrupt: 0, interruptApproval: 0, nativeApproval: 0, browser: 0, continuation: 0, aborted: false };
  const foreground = new AbortController();
  const foregroundReleased = new Promise<void>(resolve =>
    foreground.signal.addEventListener("abort", () => resolve(), { once: true }));
  let memoryForegroundStarted = false;
  let closeModelStream: (() => void) | undefined;
  let modelFailure: string | undefined;
  let citation: string | undefined;
  let documentRef: string | undefined;
  let connectorText = "";
  let connectorPages = 0;
  let browserStep = 0;
  let extension: DesktopBrowserExtensionFixture | undefined;
  let sharedTab: number | undefined;
  let sharedClick: Extract<BrowserUseRequest, { action: "click" }> | undefined;
  let continuationSourceId: string | undefined;
  let continuationWrongSourceId: string | undefined;
  let continuationSourceThreadId: string | undefined;
  let continuationDestinationId: string | undefined;
  const continuationToolReads: string[] = [];
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
      model: z.enum([fixtureModel, memoryFixtureModel, memoryExtractionModel]),
      input: z.unknown(), stream: z.literal(true),
      reasoning: z.object({ effort: z.string().nullish() }).nullish(),
      tools: z.array(z.object({
        name: z.string().optional(), type: z.string(),
        tools: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
      })).optional(),
    }).parse(request.body);
    const text = JSON.stringify(body.input);
    const providerBody = JSON.stringify(request.body);
    assert(!providerBody.includes(dataRoot), "desktop data path in model request");
    assert(!secrets.some(secret => text.includes(secret)), "server secret in model input");
    assert(!text.includes(stoppedAttachmentPrompt), "a stopped attachment transfer reached native inference");
    if (body.model !== fixtureModel) {
      let output = "Mac memory fixture response.";
      const hold = body.model === memoryFixtureModel && text.includes(memoryForegroundPrompt);
      if (body.model === memoryExtractionModel) {
        assert(text.includes(memorySeedPrompt) && !text.includes(memoryForegroundPrompt),
          "memory extraction did not read the completed native source rollout");
        assert(body.tools === undefined && body.reasoning?.effort === "low",
          "memory extraction did not use the server's restricted grant");
        assert(!providerBody.includes('"client_metadata"') && !secrets.some(secret => providerBody.includes(secret)),
          "native metadata or server credentials in upstream memory body");
        // A valid v2 no-output result exercises extraction without requiring consolidation.
        output = JSON.stringify({ rollout_summary: "", rollout_slug: "" });
      }
      const stream = responseStream({
        id: "fixture-memory-answer", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: output, annotations: [] }],
      });
      reply.type("text/event-stream");
      if (!hold) return reply.send(stream);
      return reply.send(Readable.from((async function* () {
        const firstFrameEnd = stream.indexOf("\n\n") + 2;
        memoryForegroundStarted = true;
        yield stream.slice(0, firstFrameEnd);
        await foregroundReleased;
        yield stream.slice(firstFrameEnd);
      })()));
    }
    const continuation = text.includes(continuationRequest);
    if (continuation) {
      const sourceId = continuationSourceId;
      const wrongSourceId = continuationWrongSourceId;
      const sourceThreadId = continuationSourceThreadId;
      assert(sourceId && wrongSourceId && sourceThreadId, "the continuation fixture source was not seeded");
      const call = ++modelRequests.continuation;
      const group = body.tools?.find(tool => tool.type === "namespace" &&
        tool.tools?.some(member => member.type === "function" && member.name === "read_referenced_conversation"));
      const callTool = (name: string, args: object) => {
        assert(group?.name && group.tools?.some(member => member.type === "function" && member.name === name),
          `Continuation tool unavailable: ${name}`);
        return reply.type("text/event-stream").send(responseStream({
          id: `fixture-continuation-${call}`, type: "function_call", call_id: `fixture-continuation-${call}`, name,
          namespace: group.name, arguments: JSON.stringify(args), status: "completed",
        }));
      };
      if (call === 1) {
        assert(text.includes(sourceId), "the continuation prompt did not carry the referenced source id");
        assert(!text.includes(continuationMarker), "source history leaked into the first native request");
        assert(!text.includes(continuationWrongMarker), "an unselected source leaked into the first native request");
        assert(!text.includes(wrongSourceId), "the first native request named an unselected source");
        assert(!text.includes(sourceThreadId), "the source native thread leaked into the continuation prompt");
        const destinationId = continuationDestinationId;
        assert(destinationId, "the continuation destination was not recorded");
        // Do not race the device lane's start projection: the reference endpoint
        // authorizes a running turn against the projected destination thread.
        const projectionDeadline = Date.now() + 25_000;
        for (;;) {
          const destination = await prisma.conversation.findUnique({
            where: { id: destinationId }, select: { codexThreadId: true },
          });
          const turn = destination?.codexThreadId
            ? await prisma.conversationTurn.findFirst({
                where: { conversationId: destinationId, status: "running" }, select: { codexThreadId: true },
              })
            : null;
          if (destination?.codexThreadId && turn?.codexThreadId === destination.codexThreadId) break;
          if (modelFailure) throw new Error(modelFailure);
          if (nativeExited) throw new Error("Mac bridge exited while waiting for the continuation start projection");
          if (Date.now() >= projectionDeadline) throw new Error("timed out waiting for the continuation start projection");
          await delay(60);
        }
        continuationToolReads.push(sourceId);
        return callTool("read_referenced_conversation", { conversation_id: sourceId, mode: "history" });
      }
      if (call === 2) {
        const history = readConversationReferenceResultSchema.parse(toolOutput(body.input, "fixture-continuation-1"));
        assert.equal(history.conversation_id, sourceId);
        assert.deepEqual(history.messages.map(message => ({ role: message.role, text: message.text })), [
          { role: "user", text: continuationUserText },
          { role: "assistant", text: continuationAssistantText },
        ], "the referenced history did not return the canonical visible user/assistant source messages");
        assert.equal(history.next_cursor, null);
        assert.equal(history.next_offset, 0);
        assert(text.includes(continuationMarker), "the next native request did not contain the returned source history");
        continuationToolReads.push(wrongSourceId);
        return callTool("read_referenced_conversation", { conversation_id: wrongSourceId, mode: "history" });
      }
      assert.equal(call, 3, "the continuation turn made an unexpected model request");
      const failure = z.object({ code: z.string(), retryable: z.boolean() })
        .parse(toolOutput(body.input, "fixture-continuation-2"));
      assert.equal(failure.code, "CONVERSATION_REFERENCE_UNAVAILABLE");
      assert.equal(failure.retryable, false);
      assert(!JSON.stringify(failure).includes(continuationWrongMarker),
        "the unselected source history was returned");
      assert(!text.includes(continuationWrongMarker),
        "the unselected source history reached native inference");
      return reply.type("text/event-stream").send(responseStream({
        id: "fixture-continuation-answer", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: "The referenced history was read and the unselected source was denied.", annotations: [] }],
      }));
    }
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
    const interruptApproval = text.includes(interruptApprovalPrompt);
    const nativeApproval = text.includes(nativeApprovalPrompt);
    const joinedBrowser = text.includes(joinedBrowserPrompt);
    assert(interruptApproval || nativeApproval || joinedBrowser || text.includes(readPrompt), "unexpected input");
    const call = interruptApproval ? ++modelRequests.interruptApproval
      : nativeApproval ? ++modelRequests.nativeApproval
        : joinedBrowser ? ++modelRequests.browser : ++modelRequests.read;
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
    if (joinedBrowser) {
      assert(extension, "the real Chromium extension fixture was not started");
      if (call === 1) return callTool("browser_use", { action: "status" });
      const result = browserUseResultSchema.parse(toolOutput(body.input, `fixture-call-${call - 1}`));
      if (call === 2) {
        assert(result.ok && result.data.connected && result.data.browser === "chrome", "Mac did not see the real Chromium extension");
        return callTool("browser_use", { action: "tabs" });
      }
      if (call === 3) {
        assert(result.ok && result.data.tabs?.length === 1, "only the shared fixture tab may be visible");
        const [tab] = result.data.tabs;
        assert(tab && tab.title === extension.title && tab.url === extension.url);
        sharedTab = tab.tab_id;
        return callTool("browser_use", { action: "snapshot", tab_id: sharedTab });
      }
      if (call === 4) {
        assert(result.ok && result.data.tab_id === sharedTab && result.data.title === extension.title && sharedTab);
        const button = result.data.elements?.find(element => element.role === "button" && element.name === extension?.button);
        assert(button, "Chromium did not return the fixture button's ref");
        sharedClick = { action: "click", tab_id: sharedTab, ref: button.ref };
        return callTool("browser_use", sharedClick);
      }
      if (call === 5) {
        assert(sharedClick && result.ok && result.data.tab_id === sharedTab, "the approved Chromium click failed");
        await extension.assertClickCounts(1);
        await extension.revoke();
        return callTool("browser_use", sharedClick);
      }
      assert.equal(call, 6, "unexpected Chromium action or replay");
      assert.deepEqual(result, browserUseFailure("BROWSER_USE_NOT_CONNECTED"));
      return reply.type("text/event-stream").send(responseStream({
        id: "fixture-chromium-answer", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: "The Chromium fixture was clicked once and revoked.", annotations: [] }],
      }));
    }
    const fixtureClick = { action: "click", tab_id: input.browser.tabId, ref: input.browser.ref };
    if (interruptApproval) {
      assert.equal(call, 1, "interrupted browser approval replayed the turn");
      return callTool("browser_use", fixtureClick);
    }
    if (nativeApproval) {
      if (call <= 3) {
        // Codex recognizes this harmless heredoc as a patch and asks for a native file approval.
        return reply.type("text/event-stream").send(responseStream({
          id: `fixture-tool-${call}`, type: "function_call", call_id: `fixture-call-${call}`, name: "exec_command",
          arguments: JSON.stringify({
            cmd: call === 1 ? approvalShell :
              "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: p107-note.txt\n+fixture\n*** End Patch\nPATCH",
            yield_time_ms: 1000,
          }),
          status: "completed",
        }));
      }
      if (call === 4) {
        const artifactTool = body.tools?.find(tool => tool.type === "namespace" &&
          tool.tools?.some(member => member.type === "function" && member.name === "register_artifact"));
        return callTool("register_artifact", {
          workspace_relative_path: "p107-note.txt", display_name: "p107-note.txt",
        }, artifactTool);
      }
      assert.equal(call, 5);
      nativeApprovalReceipt = desktopArtifactReceiptSchema.parse(toolOutput(body.input, "fixture-call-4"));
      return reply.type("text/event-stream").send(responseStream({
        id: "fixture-approval-answer", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: answer, annotations: [] }],
      }));
    }
    if (call === 1) {
      assert(text.includes(input.knowledge.baseName), "selected knowledge base did not reach Codex");
      assert(body.tools?.some(tool => tool.type === "function" && tool.name === "exec_command"));
      const attachment = /~\/workspace\/(attachments\/attachments-[a-f0-9-]+-[A-Za-z0-9]{6}\/[a-f0-9-]+\/fixture\.txt)/u.exec(text)?.[1];
      assert(attachment, "the uploaded attachment did not reach native turn context");
      assert(!text.includes(marker), "the attachment should arrive as a file, not injected content");
      return reply.type("text/event-stream").send(responseStream({
        id: "fixture-tool", type: "function_call", call_id: "fixture-call", name: "exec_command",
        arguments: JSON.stringify({ cmd: `head -n 1 ${attachment}`, yield_time_ms: 1000 }), status: "completed",
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
    if (browserStep === 1) {
      const status = browserUseResultSchema.parse(toolOutput(body.input, `fixture-call-${call - 1}`));
      assert(status.ok && status.data.connected && status.data.browser === "chrome", "Mac did not see the paired browser");
      browserStep++;
      return callTool("browser_use", { action: "snapshot", tab_id: input.browser.tabId });
    }
    if (browserStep === 2) {
      const snapshot = browserUseResultSchema.parse(toolOutput(body.input, `fixture-call-${call - 1}`));
      assert(snapshot.ok && snapshot.data.title === input.browser.title && snapshot.data.elements?.[0]?.ref === input.browser.ref);
      browserStep++;
      return callTool("browser_use", fixtureClick);
    }
    if (browserStep === 3) {
      assert.match(JSON.stringify(nativeToolOutput(body.input, `fixture-call-${call - 1}`)),
        /user cancelled MCP tool call/u, "the refused click did not return native cancellation");
      browserStep++;
      return callTool("browser_use", fixtureClick);
    }
    if (browserStep === 4) {
      const click = browserUseResultSchema.parse(toolOutput(body.input, `fixture-call-${call - 1}`));
      assert(click.ok && click.data.tab_id === input.browser.tabId, "the fixture click failed");
      browserStep++;
      return callTool("browser_use", { action: "screenshot", tab_id: input.browser.tabId });
    }
    if (browserStep === 5) {
      const output = nativeToolOutput(body.input, `fixture-call-${call - 1}`);
      const metadata = browserUseResultSchema.parse(toolOutput(body.input, `fixture-call-${call - 1}`));
      assert(metadata.ok && metadata.data.tab_id === input.browser.tabId && !metadata.data.image);
      const image = z.array(z.looseObject({ type: z.string(), image_url: z.string().optional() })).parse(output)
        .find(item => item.type === "input_image");
      assert(image?.image_url === `data:image/jpeg;base64,${input.browser.image.toString("base64")}`,
        "Codex did not receive the binary screenshot through the scoped result channel");
      browserStep++;
      return reply.type("text/event-stream").send(responseStream({
        id: `fixture-tool-${call}`, type: "function_call", call_id: `fixture-call-${call}`,
        name: "exec_command", arguments: JSON.stringify({ cmd: `cp artifact-seed.txt ${artifactRelativePath}`, yield_time_ms: 1000 }),
        status: "completed",
      }));
    }
    if (browserStep === 6) {
      assert(artifactWorkspace);
      const copied = join(artifactWorkspace, artifactRelativePath);
      assert.equal((await stat(copied)).size, artifactSizeBytes, "native cp did not create the workspace artifact");
      assert.equal(await checksum(createReadStream(copied)), artifactChecksum);
      modelRequests.artifact++;
      assert.equal(modelRequests.artifact, 1, "native artifact registration was replayed");
      const artifactTool = body.tools?.find(tool => tool.type === "namespace" &&
        tool.tools?.some(member => member.type === "function" && member.name === "register_artifact"));
      browserStep++;
      return callTool("register_artifact", {
        workspace_relative_path: artifactRelativePath,
        display_name: artifactDisplayName,
      }, artifactTool);
    }
    if (browserStep === 7) {
      const result = toolOutput(body.input, `fixture-call-${call - 1}`);
      const failure = z.object({
        code: z.string().regex(/^[A-Z_]{1,80}$/u),
      }).safeParse(result);
      assert(!failure.success, `native artifact registration failed: ${failure.data?.code}`);
      const receipt = desktopArtifactReceiptSchema.parse(result);
      assert.equal(receipt.artifact_id, receipt.file_id, "the artifact result must identify one file");
      assert.equal(receipt.display_name, artifactDisplayName,
        "the artifact result did not retain the simple basename");
      artifactReceipt = receipt;
      const artifactTool = body.tools?.find(tool => tool.type === "namespace" &&
        tool.tools?.some(member => member.type === "function" && member.name === "register_artifact"));
      browserStep++;
      return callTool("register_artifact", {
        workspace_relative_path: `${websiteRoot}/index.html`,
        display_name: "packaged-website.html",
        web_root_relative_path: websiteRoot,
      }, artifactTool);
    }
    if (browserStep === 8) {
      const result = toolOutput(body.input, `fixture-call-${call - 1}`);
      const failure = z.object({ code: z.string().regex(/^[A-Z_]{1,80}$/u) }).safeParse(result);
      assert(!failure.success, `native website artifact registration failed: ${failure.data?.code}`);
      websiteReceipt = desktopArtifactReceiptSchema.parse(result);
      assert(citation, "native knowledge search did not return a citation");
      return reply.type("text/event-stream").send(responseStream({
        id: "fixture-answer", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: `${answer} ${citation}`, annotations: [] }],
      }));
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
    browserStep++;
    return callTool("browser_use", { action: "status" });
  });

  let child: ReturnType<typeof spawn> | undefined;
  let childExit: Promise<number | null> | undefined;
  let serverSecretInNativeOutput = false;
  let nativeExited = false;
  try {
    const modelOrigin = await model.listen({ host: "127.0.0.1", port: 0 });
    await input.modelProviderSettings.update(ownerId, {
      expected_revision: 0, default_model: fixtureModel, title_model: null, memory_extraction_model: memoryExtractionModel,
      providers: [{
        id: "desktop-fixture", base_url: `${modelOrigin}/v1`, protocol_mode: "native_responses", api_key: providerKey,
        models: [fixtureModel, memoryFixtureModel, memoryExtractionModel].map(id => ({
          kind: "chat", id, display_name: id === fixtureModel ? "Desktop fixture" : id, enabled: true,
          context_window: 32768, supported_reasoning_efforts: ["low"], default_reasoning_effort: "low", supports_image_input: true,
          input_price_per_million: "10", cached_input_price_per_million: "2", output_price_per_million: "20",
        })),
      }],
    }, {});
    const task = async (title: string) => {
      const id = randomUUID();
      const home = join(dataRoot, ownerId, "services", id, "home");
      const workspace = join(home, "workspace");
      const rules = join(home, ".codex", "rules");
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      await mkdir(rules, { recursive: true, mode: 0o700 });
      await writeFile(join(rules, "default.rules"),
        'prefix_rule(pattern=["head"], decision="allow")\n' +
        'prefix_rule(pattern=["cp"], decision="allow")\n',
        { mode: 0o600 });
      await mkdir(join(scratch, ownerId, "services", id, "home", "workspace", "attachments"), { recursive: true, mode: 0o700 });
      return prisma.conversation.create({
        data: {
          id, ownerId, title, titleSource: "manual", archiveStatus: "active", executionTarget: "local", desktopDeviceId: deviceId,
          workspaceRelPath: `${ownerId}/services/${id}/home/workspace`, runtimeGeneration: randomUUID(),
        },
      });
    };
    const read = await task("Packaged Mac workspace read");
    artifactWorkspace = join(dataRoot, ownerId, "services", read.id, "home", "workspace");
    await mkdir(join(artifactWorkspace, websiteRoot, "assets"), { recursive: true, mode: 0o700 });
    await writeFile(join(artifactWorkspace, websiteRoot, "index.html"), websiteHtml, { mode: 0o600 });
    await writeFile(join(artifactWorkspace, websiteRoot, "assets/theme.css"), websiteCss, { mode: 0o600 });
    if (input.multipartWebsite) {
      const data = Buffer.alloc(17 * 1024 * 1024, "x");
      for (const asset of ["assets/extra-1.txt", "assets/extra-2.txt"]) {
        await writeFile(join(artifactWorkspace, websiteRoot, asset), data, { mode: 0o600 });
        websiteAssets.push(asset);
      }
    }
    const seed = join(artifactWorkspace, "artifact-seed.txt");
    {
      await using file = await open(seed, "wx", 0o600);
      const hash = createHash("sha256");
      const chunk = Buffer.alloc(Math.min(artifactSizeBytes, 1024 * 1024), artifactMarker);
      for (let offset = 0; offset < artifactSizeBytes; offset += chunk.length) {
        const bytes = chunk.subarray(0, Math.min(chunk.length, artifactSizeBytes - offset));
        if (offset > 0) bytes.write(`${offset}:`);
        await file.writeFile(bytes);
        hash.update(bytes);
      }
      artifactChecksum = hash.digest("hex");
    }
    const uploaded = await input.files.uploadAttachment(ownerId, read.id, {
      filename: attachmentName, reportedMimeType: "text/plain", data: attachmentData,
    }, {});
    const stop = await task("Packaged Mac interruption");
    const stopApproval = await task("Packaged Mac browser approval interruption");
    const scanOutput = () => {
      let tail = "";
      const maxSecretLength = Math.max(...secrets.map(secret => secret.length));
      return (chunk: Buffer) => {
        const output = tail + chunk.toString();
        serverSecretInNativeOutput ||= secrets.some(secret => output.includes(secret));
        tail = output.slice(-maxSecretLength);
      };
    };
    const startBridge = () => {
      nativeExited = false;
      const bridge = spawn(binary, ["-test.run=^TestPackagedDesktopGateway$", "-test.timeout=160s"], {
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          LINKSENSE_DESKTOP_RUNTIME_DIST: input.runtimeRoot,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child = bridge;
      const exited = once(bridge, "close").then(([code]) => typeof code === "number" ? code : null);
      childExit = exited;
      void exited.then(() => { nativeExited = true; }, () => { nativeExited = true; });
      assert(bridge.stdin && bridge.stdout && bridge.stderr);
      bridge.stdout.on("data", scanOutput());
      bridge.stderr.on("data", scanOutput());
      bridge.stdin.on("error", () => { nativeExited = true; });
      bridge.stdin.write(`${JSON.stringify({
        origin: input.address, dataRoot, credential: { token: input.token, ownerId, deviceId, name: "Mac fixture" },
      })}\n`);
      return async () => {
        bridge.stdin?.end();
        assert.equal(await exited, 0, "native bridge failed to stop cleanly");
      };
    };
    const stopBridge = startBridge();
    const waitFor = async <T>(description: string, check: () => Promise<T | null | false>, timeout = 15_000): Promise<T> => {
      const deadline = Date.now() + timeout;
      do {
        if (modelFailure) throw new Error(modelFailure);
        if (nativeExited) throw new Error(`Mac bridge exited while waiting for ${description}`);
        const value = await check();
        if (value !== null && value !== false) return value;
        await delay(60);
      } while (Date.now() < deadline);
      throw new Error(`Mac gateway timed out waiting for ${description}`);
    };
    const waitForConnection = (previousConnectionId: string) =>
      waitFor("a new negotiated Mac connection", async () => {
        const current = await coordinator.executionConnection(deviceId);
        return current && current.connectionId !== previousConnectionId && await coordinator.supportsAttachments(current)
          ? current.connectionId : false;
      }, 25_000);
    const connectionId = await waitForConnection(input.previousConnectionId);
    const submission = (inputText: string, idempotencyKey: string) =>
      ({ inputText, idempotencyKey, submitMode: "normal" as const, priorityCapabilityIds: [] });
    const waitForMcpApproval = async (conversationId: string, turnId: string, tool: string) => {
      const request = await waitFor(`the pending native approval for ${tool}`, () =>
        prisma.conversationUserInputRequest.findFirst({
          where: { ownerId, conversationId, turnId, requestKind: "questions", status: "pending" },
          select: { id: true, codexItemId: true, questionsJson: true },
        }));
      const [question] = z.tuple([conversationUserInputQuestionSchema]).parse(request.questionsJson);
      assert(question.id.startsWith("mcp_tool_call_approval_"), "expected a native MCP tool approval");
      const { options } = question;
      assert(options && options.some(option => option.label === "Allow") && options.some(option => option.label === "Cancel"),
        "native approval must offer Allow and Cancel");
      return { id: request.id, itemId: request.codexItemId, questionId: question.id, options };
    };
    const waitForBrowserApproval = async (conversationId: string, turnId: string, action: z.infer<typeof browserUseApprovalSchema>["action"]) => {
      const request = await waitForMcpApproval(conversationId, turnId, action);
      const { options } = request;
      assert(!options.some(option => option.label === "Allow for this session" || option.label === "Always allow"),
        "native browser approval must apply only to the current action");
      const events = await prisma.conversationEvent.findMany({
        where: { conversationId, turnId, eventType: "item/started" },
        select: { payloadJson: true },
      });
      const approvalItem = z.object({ params: z.object({
        item: z.object({ id: z.literal(request.itemId), browserApproval: browserUseApprovalSchema }),
      }) });
      assert(events.some(({ payloadJson }) =>
        approvalItem.safeParse(payloadJson).data?.params.item.browserApproval.action === action),
      "the native call must identify the action before the answer is requested");
      return request;
    };
    const browserAuditCount = (turnId: string) => prisma.auditLog.count({
      where: { action: "desktop_tool_requested", targetType: "browser_use", metadataJson: { path: ["turn_id"], equals: turnId } },
    });
    const initialBrowserCommands = input.browser.observed.length;
    const attachmentPath = (turnId: string) => `${desktopAttachmentDownloadPath}/${turnId}/${uploaded.id}`;
    const nativeRoot = join(dataRoot, ownerId, "services", read.id);
    const control = join(nativeRoot, "control");
    const published = join(nativeRoot, "home", "workspace", "attachments");
    const delayedSubmission = submission(stoppedAttachmentPrompt, randomUUID());
    const canceled = await conversations.interruptDesktopTurnSubmission(ownerId, read.id, delayedSubmission.idempotencyKey, {});
    assert.equal(canceled.code, RUNNER_TURN_INTERRUPT_REQUESTED);
    assert.deepEqual(
      await conversations.interruptDesktopTurnSubmission(ownerId, read.id, delayedSubmission.idempotencyKey, {}),
      canceled,
    );
    await assert.rejects(conversations.interruptDesktopTurnSubmission(randomUUID(), read.id, delayedSubmission.idempotencyKey, {}));
    await assert.rejects(conversations.acceptTurn(ownerId, read.id, delayedSubmission, {}), { code: "TURN_START_CLOSED" });
    assert.equal(await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: canceled.turn_id } }), 0);
    assert.equal(await redis.hasTurnSlot(read.id, canceled.turn_id, ownerId), false);
    assert.equal(input.attachmentTransfer.requests(attachmentPath(canceled.turn_id)), 0);
    assert.equal(await prisma.conversationFile.count({ where: { id: uploaded.id, status: "staged", turnId: null } }), 1);
    const stopTransfer = input.attachmentTransfer.hold(uploaded.id);
    const stoppedSubmission = submission(stoppedAttachmentPrompt, randomUUID());
    const stopped = await conversations.acceptTurn(ownerId, read.id,
      stoppedSubmission, {});
    assert.equal(stopped.status, "starting");
    const stoppedPath = attachmentPath(stopped.turn_id);
    await waitFor("the first attachment bytes staged on the Mac", async () => {
      if (!stopTransfer.started || stopTransfer.closed) return false;
      return await hasPartialAttachment(control, stopped.turn_id, uploaded.id, attachmentName);
    });
    assert.equal(stopTransfer.path, stoppedPath);
    assert.equal(await redis.hasTurnSlot(read.id, stopped.turn_id, ownerId), true);
    assert.equal(await prisma.conversationTurnStartIntent.count({
      where: { projectionTurnId: stopped.turn_id, conversationId: read.id, runnerStatus: "prepared" },
    }), 1);
    const preflightLock = await redis.acquireConversationLock(read.id);
    if (preflightLock) await redis.releaseConversationLock(read.id, preflightLock);
    assert.equal(preflightLock, null, "conversation unlocked while the file was still arriving");
    assert.deepEqual(await listDirectory(published), []);
    assert.equal(modelRequests.read, 0);

    const stoppedBeforeStart = await conversations.interruptDesktopTurnSubmission(ownerId, read.id, stoppedSubmission.idempotencyKey, {});
    assert.equal(stoppedBeforeStart.code, RUNNER_TURN_INTERRUPT_REQUESTED);
    assert.equal(stoppedBeforeStart.turn_id, stopped.turn_id);
    await waitFor("interrupted attachment response and start cleanup", async () =>
      stopTransfer.closed && !stopTransfer.finished &&
      !await redis.hasTurnSlot(read.id, stopped.turn_id, ownerId) &&
      !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: stopped.turn_id } }) &&
      !(await listDirectory(control)).some(name => name.startsWith(`attachments-${stopped.turn_id}-`))
    );
    const releasedLock = await waitFor("the canceled transfer's conversation lock release", () =>
      redis.acquireConversationLock(read.id)
    );
    await redis.releaseConversationLock(read.id, releasedLock);
    const stoppedHistory = await events.historyPage(ownerId, read.id, { afterSequence: 0n, limit: 50 });
    assert.equal(stoppedHistory.items.filter(event => {
      if (event.event_type !== "conversation.error") return false;
      const result = conversationStartFailurePayloadSchema.safeParse(event.payload);
      return result.success && result.data.error_code === "TURN_START_CLOSED" &&
        result.data.start_failure.turn_id === stopped.turn_id;
    }).length, 1);
    assert.equal(await prisma.conversationTurn.count({ where: { id: stopped.turn_id } }), 0);
    assert.equal(await prisma.conversationFile.count({
      where: { id: uploaded.id, conversationId: read.id, status: "staged", turnId: null },
    }), 1);
    assert.deepEqual(await listDirectory(published), []);
    assert.equal(modelRequests.read, 0);
    assert.equal(input.attachmentTransfer.requests(stoppedPath), 1);

    const abandonedPaths: string[] = [];
    for (const action of ["revocation", "disconnect"] as const) {
      const transfer = input.attachmentTransfer.hold(uploaded.id);
      const unstarted = await conversations.acceptTurn(ownerId, read.id,
        submission(`${stoppedAttachmentPrompt}: ${action}`, randomUUID()), {});
      assert.equal(unstarted.status, "starting");
      const downloadPath = attachmentPath(unstarted.turn_id);
      abandonedPaths.push(downloadPath);
      await waitFor(`one byte on the Mac before ${action}`, async () =>
        transfer.started && !transfer.closed &&
        await hasPartialAttachment(control, unstarted.turn_id, uploaded.id, attachmentName));
      assert.equal(transfer.path, downloadPath);
      assert.equal(await redis.hasTurnSlot(read.id, unstarted.turn_id, ownerId), true);
      assert.deepEqual(await listDirectory(published), []);

      if (action === "revocation") {
        await input.revokeAttachmentRun(unstarted.turn_id);
      } else {
        await input.disconnectAttachmentSocket(connectionId);
      }
      await waitFor(`the attachment response to abort after ${action}`, async () => transfer.closed && !transfer.finished);
      if (action === "disconnect") {
        const reconnected = await waitForConnection(connectionId);
        const outcome = await conversations.recoverStartIntent(unstarted.turn_id, { desktopConnectionId: reconnected });
        assert(outcome === "released" || outcome === "missing", `unexpected reconnect recovery outcome: ${outcome}`);
      }
      await waitFor(`start cleanup after ${action}`, async () =>
        !await redis.hasTurnSlot(read.id, unstarted.turn_id, ownerId) &&
        !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: unstarted.turn_id } }) &&
        !(await listDirectory(control)).some(name => name.startsWith(`attachments-${unstarted.turn_id}-`)));
      assert.equal(await prisma.conversationTurn.count({ where: { id: unstarted.turn_id } }), 0);
      assert.equal(await prisma.conversationFile.count({
        where: { id: uploaded.id, conversationId: read.id, status: "staged", turnId: null, pendingRequestId: null },
      }), 1);
      assert.equal((await stat(join(scratch, read.workspaceRelPath, "attachments", uploaded.id, attachmentName))).size, attachmentData.length);
      assert.deepEqual(await listDirectory(published), []);
      assert.equal(modelRequests.read, 0);
      assert.equal(input.attachmentTransfer.requests(downloadPath), 1);
    }

    const retrySubmission = { ...submission(readPrompt, "desktop-read-retry"), knowledgeBaseIds: [input.knowledge.baseId] };
    const retryTransfer = input.attachmentTransfer.hold(uploaded.id, 70_000 * 1024 ** 2 / attachmentData.length);
    const completed = await conversations.acceptTurn(ownerId, read.id, retrySubmission, {});
    assert.notEqual(completed.turn_id, stopped.turn_id);
    await waitFor("the retry staged partial attachment bytes", async () =>
      retryTransfer.started && !retryTransfer.closed &&
      await hasPartialAttachment(control, completed.turn_id, uploaded.id, attachmentName)
    );
    assert.equal(retryTransfer.path, attachmentPath(completed.turn_id));
    assert.equal(modelRequests.read, 0);
    assert.deepEqual(await listDirectory(published), []);
    const transferStartedAt = Date.now();
    retryTransfer.release();
    const attachmentMiB = attachmentData.length / 1024 ** 2;
    await waitFor(`the throttled ${attachmentMiB} MiB response to finish`, async () => retryTransfer.finished, 95_000);
    assert(Date.now() - transferStartedAt >= 65_000, "download did not exercise the former command deadline");
    const [materialized] = await waitFor("the complete attachment to be published", async () => {
      const directories = await listDirectory(published);
      return directories.length === 1 ? directories : false;
    });
    assert(materialized);
    const localAttachment = join(published, materialized, uploaded.id, attachmentName);
    const downloaded = createHash("sha256");
    for await (const bytes of createReadStream(localAttachment)) downloaded.update(bytes);
    assert.equal(downloaded.digest("hex"), attachmentChecksum);
    const status = async (id: string) =>
      (await prisma.conversationTurn.findUnique({ where: { id }, select: { status: true } }))?.status;
    try {
      const approvals = [
        { action: "status", choice: "Allow", audits: 0, commands: [] },
        { action: "snapshot", choice: "Allow", audits: 1, commands: [] },
        { action: "click", choice: "Cancel", audits: 2, commands: ["snapshot"] },
        { action: "click", choice: "Allow", audits: 2, commands: ["snapshot"] },
        { action: "screenshot", choice: "Allow", audits: 3, commands: ["snapshot", "click"] },
      ] as const;
      for (const [index, { action, choice, audits, commands }] of approvals.entries()) {
        const request = await waitForBrowserApproval(read.id, completed.turn_id, action);
        assert.equal(browserStep, index + 1);
        assert.equal(request.itemId, `fixture-call-${modelRequests.read}`);
        assert.equal(await browserAuditCount(completed.turn_id), audits, `${action} reached the gateway before approval`);
        assert.deepEqual(input.browser.observed.slice(initialBrowserCommands), commands, `${action} reached the extension before approval`);
        const selected = request.options.find(option => option.label === choice);
        assert(selected, `native approval did not offer ${choice}`);
        const response = await conversations.respondToUserInputRequest(ownerId, read.id, request.id, {
          action: "accept", content: { [request.questionId]: selected.label },
        }, {});
        assert.equal(response.status, "answered");
      }
      const pendingArtifact = await waitForMcpApproval(read.id, completed.turn_id, "register_artifact");
      assert.equal(browserStep, 7);
      assert.equal(pendingArtifact.itemId, `fixture-call-${modelRequests.read}`);
      assert.equal(await prisma.auditLog.count({
        where: {
          action: "desktop_tool_requested",
          targetType: "conversation_file",
          metadataJson: { path: ["turn_id"], equals: completed.turn_id },
        },
      }), 0, "the Mac requested an artifact grant before native approval");
      const artifactApproval = await conversations.respondToUserInputRequest(ownerId, read.id, pendingArtifact.id, {
        action: "accept", content: { [pendingArtifact.questionId]: "Allow" },
      }, {});
      assert.equal(artifactApproval.status, "answered");
      const pendingWebsite = await waitForMcpApproval(read.id, completed.turn_id, "register_artifact");
      assert.equal(browserStep, 8);
      assert.equal(pendingWebsite.itemId, `fixture-call-${modelRequests.read}`);
      assert.equal(await prisma.webArtifactBundle.count({ where: { conversationId: read.id } }), 0);
      assert.equal((await conversations.respondToUserInputRequest(ownerId, read.id, pendingWebsite.id, {
        action: "accept", content: { [pendingWebsite.questionId]: "Allow" },
      }, {})).status, "answered");
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
    assert.equal(modelRequests.read, 16 + connectorPages);
    assert.equal(input.attachmentTransfer.requests(stoppedPath), 1);
    for (const downloadPath of abandonedPaths) assert.equal(input.attachmentTransfer.requests(downloadPath), 1);
    assert.equal(input.attachmentTransfer.requests(attachmentPath(completed.turn_id)), 1);
    assert.equal((await conversations.acceptTurn(ownerId, read.id, retrySubmission, {})).turn_id, completed.turn_id);
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: read.id } }), 1);
    assert.equal(await prisma.conversationFile.count({
      where: { id: uploaded.id, conversationId: read.id, filename: attachmentName, status: "bound", turnId: completed.turn_id },
    }), 1);
    assert.equal(await browserAuditCount(completed.turn_id), 4);
    assert.deepEqual(input.browser.observed.slice(initialBrowserCommands), ["snapshot", "click", "screenshot"]);
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

    const artifact = artifactReceipt;
    assert(artifact, "native Mac did not return an artifact registration receipt");
    const website = websiteReceipt;
    assert(website, "native Mac did not return a website artifact registration receipt");
    assert.equal(modelRequests.artifact, 1, "native Mac registered the artifact more than once");
    const artifactFiles = await prisma.conversationFile.findMany({
      where: { conversationId: read.id, kind: "artifact" },
      select: {
        id: true, turnId: true, filename: true, mimeType: true, sizeBytes: true, status: true,
        storageBackend: true, downloadable: true, minioObjectKey: true,
        workspaceRelativePath: true, workspaceRootRelPath: true, desktopSourcePathDigest: true,
      },
    });
    assert.equal(artifactFiles.length, 2, "each approval should create exactly one file row");
    assert(artifactFiles.every(file => file.desktopSourcePathDigest === null),
      "shell-created and pre-existing files must not claim a native file-creation association");
    const artifactFile = artifactFiles.find(file => file.id === artifact.file_id);
    assert(artifactFile);
    const artifactEvents = await prisma.conversationEvent.findMany({
      where: { conversationId: read.id, eventType: "conversation.artifact.created" },
      select: { id: true, turnId: true, visibility: true, payloadJson: true },
    });
    assert.equal(artifactEvents.length, 2, "each approval should publish exactly one download card");
    const artifactEvent = artifactEvents.find(event => event.id === artifact.download_card_event_id);
    assert(artifactEvent);
    assert.equal(artifact.file_id, artifactFile.id);
    assert.equal(artifactFile.turnId, completed.turn_id);
    assert.equal(artifactFile.filename, artifactDisplayName);
    assert.equal(artifactFile.mimeType, "text/plain");
    assert.equal(artifactFile.sizeBytes, BigInt(artifactSizeBytes));
    assert.equal(artifactFile.status, "registered");
    assert.equal(artifactFile.downloadable, true);
    assert.equal(artifactFile.storageBackend, "minio");
    assert.equal(artifactFile.workspaceRelativePath, null);
    assert.equal(artifactFile.workspaceRootRelPath, null);
    assert.equal(artifactEvent.id, artifact.download_card_event_id);
    assert.equal(artifactEvent.turnId, completed.turn_id);
    assert.equal(artifactEvent.visibility, "user_visible");
    assert.deepEqual(artifactEvent.payloadJson, {
      schema_version: 1,
      file_id: artifactFile.id,
      display_name: artifactFile.filename,
      mime_type: "text/plain",
      size_bytes: artifactSizeBytes,
    });
    const artifactAudits = await prisma.auditLog.findMany({
      where: { action: "conversation_artifact_registered", targetType: "conversation_file", targetId: artifactFile.id },
      select: { metadataJson: true },
    });
    assert.equal(artifactAudits.length, 1, "artifact registration wrote more than one audit row");
    const artifactAudit = artifactAudits[0];
    assert(artifactAudit);
    const artifactHistory = (await events.historyPage(ownerId, read.id, { afterSequence: 0n, limit: 100 })).items
      .filter(event => event.event_type === "conversation.artifact.created");
    assert.deepEqual(artifactHistory.map(event => event.id), [artifact.download_card_event_id, website.download_card_event_id]);
    for (const localRoot of [scratch, dataRoot, nativeRoot]) {
      assert(!artifactFile.minioObjectKey?.includes(localRoot), "the artifact object key leaked a local path");
      assert(!JSON.stringify(artifactEvent.payloadJson).includes(localRoot), "the artifact event leaked a local path");
      assert(!JSON.stringify(artifactAudit.metadataJson).includes(localRoot), "the artifact audit leaked a local path");
    }
    const listed = await input.files.listTaskArtifacts(ownerId, { limit: 5, search: artifactDisplayName });
    assert.deepEqual(listed.items.map(({ id }) => id), [artifact.file_id]);
    const download = await input.files.readArtifactDownload(ownerId, read.id, artifactFile.id, {});
    assert.equal(download.filename, artifactDisplayName);
    assert.equal(download.mimeType, "text/plain");
    assert.equal(download.sizeBytes, artifactSizeBytes);
    assert.equal(await checksum(download.data), artifactChecksum,
      "the authenticated artifact download did not return the native file bytes");
    const websiteEntry = await input.files.readArtifactDownload(ownerId, read.id, website.file_id, {});
    assert.equal(websiteEntry.mimeType, "text/html");
    assert.equal(await checksum(websiteEntry.data), createHash("sha256").update(websiteHtml).digest("hex"));
    await assert.rejects(input.htmlPreviews.open(input.otherOwnerId, read.id, website.file_id),
      { code: "WEB_SITE_SOURCE_UNAVAILABLE" });
    const preview = await input.htmlPreviews.open(ownerId, read.id, website.file_id);
    assert.deepEqual(preview.missing_resources, []);
    assert.match(preview.html, /href="\.\/assets\/theme\.css"/u);
    assert.equal((await input.htmlPreviews.resource(preview.session_id, "assets/theme.css")).data.toString(), websiteCss);
    const publishedWebsite = await input.websites.create(ownerId, {
      conversation_id: read.id, file_id: website.file_id, name: "Packaged Mac site",
      description: "", slug: `mac-${randomUUID()}`,
    });
    assert.equal(publishedWebsite.file_count, websiteAssets.length);
    const publishedAddress = { slug: publishedWebsite.slug };
    assert.match((await input.websites.resource(publishedAddress, publishedWebsite.release_id, "index.html", () => {})).data.toString(),
      /href="\.\/assets\/theme\.css"/u);
    assert.equal((await input.websites.resource(publishedAddress, publishedWebsite.release_id, "assets/theme.css", () => {})).data.toString(), websiteCss);

    // Only cloud-to-local is exercised here: this packaged Mac fixture owns one
    // local runtime and no cloud runner. The API DB suite covers both
    // continuation directions; this is not a reverse or production acceptance.
    const seedContinuationSource = async (title: string, userText: string, assistantText: string) => {
      const id = randomUUID();
      const threadId = randomUUID();
      const turnId = randomUUID();
      const codexTurnId = randomUUID();
      await prisma.conversation.create({ data: {
        id, ownerId, title, titleSource: "manual", archiveStatus: "active", executionTarget: "cloud",
        workspaceRelPath: `${ownerId}/services/${id}/home/workspace`, runtimeGeneration: randomUUID(),
        codexThreadId: threadId, lastTurnStatus: "completed", lastRunAt: new Date(),
      } });
      await prisma.conversationTurn.create({ data: {
        id: turnId, conversationId: id, sequenceNo: 1, submittedBy: ownerId, codexThreadId: threadId,
        codexTurnId, status: "completed", submitMode: "normal",
        capabilityGeneration: "0".repeat(64), capabilitiesJson: [],
        startedAt: new Date(Date.now() - 2_000), completedAt: new Date(Date.now() - 1_000),
      } });
      await prisma.conversationMessage.createMany({ data: [
        { conversationId: id, turnId, sequenceNo: 1, role: "user", contentText: userText },
        { conversationId: id, turnId, sequenceNo: 2, role: "assistant", contentText: assistantText },
      ] });
      return { id, threadId, turnId, codexTurnId };
    };
    const continuationSource = await seedContinuationSource(
      "Cloud task with completed history", continuationUserText, continuationAssistantText,
    );
    continuationSourceId = continuationSource.id;
    continuationSourceThreadId = continuationSource.threadId;
    await prisma.conversationFile.create({ data: {
      conversationId: continuationSource.id, turnId: continuationSource.turnId, kind: "artifact",
      source: "agent_generated", status: "registered", filename: "source-only.txt", mimeType: "text/plain",
      sizeBytes: BigInt(Buffer.byteLength("source-only-file")),
      checksumSha256: createHash("sha256").update("source-only-file").digest("hex"),
      storageBackend: "minio", minioObjectKey: `fixtures/${randomUUID()}`, downloadable: true,
      downloadCardEventId: randomUUID(), createdBy: ownerId,
    } });
    const continuationWrongSource = await seedContinuationSource(
      "Cloud task not selected", `Unselected question containing ${continuationWrongMarker}`,
      `Unselected answer containing ${continuationWrongMarker}`,
    );
    continuationWrongSourceId = continuationWrongSource.id;
    const continuationSourceBefore = await prisma.conversation.findUniqueOrThrow({
      where: { id: continuationSource.id },
    });
    const continuationSourceMessagesBefore = await prisma.conversationMessage.findMany({
      where: { conversationId: continuationSource.id }, orderBy: { sequenceNo: "asc" },
    });
    const continuationSourceFilesBefore = await prisma.conversationFile.findMany({
      where: { conversationId: continuationSource.id }, orderBy: { id: "asc" },
    });
    const continuationWrongBefore = await prisma.conversation.findUniqueOrThrow({
      where: { id: continuationWrongSource.id },
    });
    const knownConversationIds = new Set((await prisma.conversation.findMany({
      where: { ownerId }, select: { id: true },
    })).map(row => row.id));
    const knownAuditIds = new Set((await prisma.auditLog.findMany({
      where: { actorId: ownerId }, select: { id: true },
    })).map(row => row.id));
    const continuationRequestId = randomUUID();
    await conversations.continueConversation(ownerId, continuationSource.id, {
      requestId: continuationRequestId, executionTarget: "local", desktopDeviceId: deviceId,
    }, {});
    const destinationRows = (await prisma.conversation.findMany({
      where: { ownerId }, select: { id: true },
    })).filter(row => !knownConversationIds.has(row.id));
    assert.equal(destinationRows.length, 1, "continuation must create exactly one destination row");
    const destinationId = destinationRows[0]!.id;
    continuationDestinationId = destinationId;
    const destination = await prisma.conversation.findUniqueOrThrow({ where: { id: destinationId } });
    assert.equal(destination.ownerId, ownerId);
    assert.equal(destination.executionTarget, "local");
    assert.equal(destination.desktopDeviceId, deviceId);
    assert.equal(destination.archiveStatus, "active");
    assert.equal(destination.codexThreadId, null, "continuation must not create or reuse a native thread");
    assert(destination.workspaceRelPath.length > 0, "continuation did not allocate a destination workspace");
    assert.notEqual(destination.workspaceRelPath, continuationSourceBefore.workspaceRelPath);
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: destinationId } }), 0);
    assert.equal(await prisma.conversationTurnStartIntent.count({ where: { conversationId: destinationId } }), 0);
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId: destinationId } }), 0);
    assert.equal(await prisma.conversationFile.count({ where: { conversationId: destinationId } }), 0);
    assert.equal(modelRequests.continuation, 0, "continuation created a native model call before the explicit turn");
    assert.deepEqual(await prisma.conversation.findUniqueOrThrow({ where: { id: continuationSource.id } }),
      continuationSourceBefore, "continuation mutated the source conversation");
    assert.deepEqual(await prisma.conversationMessage.findMany({
      where: { conversationId: continuationSource.id }, orderBy: { sequenceNo: "asc" },
    }), continuationSourceMessagesBefore, "continuation mutated the source history");
    assert.deepEqual(await prisma.conversationFile.findMany({
      where: { conversationId: continuationSource.id }, orderBy: { id: "asc" },
    }), continuationSourceFilesBefore, "continuation mutated the source files");
    assert.deepEqual(await prisma.conversation.findUniqueOrThrow({ where: { id: continuationWrongSource.id } }),
      continuationWrongBefore, "continuation mutated the unselected source");
    const continuationAudits = (await prisma.auditLog.findMany({
      where: { actorId: ownerId }, orderBy: { createdAt: "asc" },
    })).filter(row => !knownAuditIds.has(row.id));
    assert.equal(continuationAudits.length, 1, "continuation must write exactly one audit row");
    const continuationAudit = continuationAudits[0]!;
    assert.equal(continuationAudit.action, "conversation_continued");
    assert.equal(continuationAudit.targetType, "conversation");
    assert.equal(continuationAudit.targetId, destinationId);
    assert.equal(continuationAudit.result, "success");
    assert.equal(continuationAudit.ipAddress, null);
    assert.equal(continuationAudit.userAgent, null);
    assert.deepEqual(continuationAudit.metadataJson, {
      source_conversation_id: continuationSource.id, source_target: "cloud", execution_target: "local",
    }, "the creation audit must contain only trusted source and target metadata");

    const continuationReceipt = await conversations.acceptTurn(ownerId, destinationId, {
      officeAnnotation: {
        kind: "task_references", request: continuationRequest, conversation_ids: [continuationSource.id],
      },
      submitMode: "normal", idempotencyKey: continuationIdempotencyKey, priorityCapabilityIds: [],
    }, {});
    await waitFor("the continuation turn and slot release", async () =>
      await status(continuationReceipt.turn_id) === "completed" &&
      !await redis.hasTurnSlot(destinationId, continuationReceipt.turn_id, ownerId), 25_000);
    const destinationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: destinationId } });
    assert(destinationAfter.codexThreadId, "the continuation turn did not establish a native thread");
    assert.notEqual(destinationAfter.codexThreadId, continuationSource.threadId,
      "the destination reused the source native thread");
    assert.notEqual(destinationAfter.codexThreadId, continuationWrongSource.threadId,
      "the destination reused an unselected source native thread");
    const destinationTurn = await prisma.conversationTurn.findFirstOrThrow({
      where: { conversationId: destinationId },
    });
    assert.equal(destinationTurn.codexThreadId, destinationAfter.codexThreadId);
    assert.notEqual(destinationTurn.codexTurnId, continuationSource.codexTurnId,
      "the destination reused the source native turn");
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: destinationId } }), 1);
    assert.deepEqual(await prisma.conversation.findUniqueOrThrow({ where: { id: continuationSource.id } }),
      continuationSourceBefore, "the continuation turn mutated the source conversation");
    assert.deepEqual(await prisma.conversationMessage.findMany({
      where: { conversationId: continuationSource.id }, orderBy: { sequenceNo: "asc" },
    }), continuationSourceMessagesBefore, "the continuation turn mutated the source history");
    assert.deepEqual(await prisma.conversationFile.findMany({
      where: { conversationId: continuationSource.id }, orderBy: { id: "asc" },
    }), continuationSourceFilesBefore, "the continuation turn mutated the source files");
    assert.deepEqual(await prisma.conversation.findUniqueOrThrow({ where: { id: continuationWrongSource.id } }),
      continuationWrongBefore, "the continuation turn mutated the unselected source");
    assert.equal(await prisma.conversationFile.count({ where: { conversationId: destinationId } }), 0,
      "continuation copied a source file into the destination");
    const destinationMessages = await prisma.conversationMessage.findMany({
      where: { conversationId: destinationId }, orderBy: { sequenceNo: "asc" },
      select: { role: true, contentText: true },
    });
    assert.deepEqual(destinationMessages.map(message => message.role), ["user", "assistant"]);
    assert(!destinationMessages[0]!.contentText.includes(continuationMarker),
      "the destination user message embedded source history");
    assert.equal(destinationMessages[1]!.contentText.trimEnd(),
      "The referenced history was read and the unselected source was denied.");
    const continuationGrants = await prisma.conversationEvent.findMany({
      where: {
        conversationId: destinationId, turnId: continuationReceipt.turn_id,
        eventType: "conversation.message.display_context",
      },
      select: { payloadJson: true, visibility: true },
    });
    assert.equal(continuationGrants.length, 1, "the continuation turn must write exactly one user grant");
    assert.equal(continuationGrants[0]!.visibility, "internal_sanitized");
    const continuationGrant = z.object({
      schema_version: z.literal(1), message_id: z.uuid(),
      display: z.object({
        kind: z.literal("task_references"), request: z.literal(continuationRequest),
        conversation_ids: z.array(z.uuid()),
      }),
    }).parse(continuationGrants[0]!.payloadJson);
    assert.deepEqual(continuationGrant.display.conversation_ids, [continuationSource.id]);
    assert(!JSON.stringify(continuationGrant).includes(continuationMarker),
      "the user grant embedded source history");
    assert.deepEqual(continuationToolReads, [continuationSource.id, continuationWrongSource.id],
      "the continuation turn attempted an unexpected tool operation");
    assert.equal(modelRequests.continuation, 3, "the continuation turn made an extra model attempt");
    assert.equal(modelRequests.read, 16 + connectorPages);
    assert.equal(await prisma.conversationUserInputRequest.count({ where: { conversationId: destinationId } }), 0);
    assert.equal(await prisma.conversationDesktopApproval.count({ where: { conversationId: destinationId } }), 0);
    const toolAudits = await prisma.auditLog.findMany({
      where: {
        action: "desktop_tool_requested",
        OR: [
          { actorId: ownerId, id: { notIn: [...knownAuditIds] } },
          { metadataJson: { path: ["turn_id"], equals: continuationReceipt.turn_id } },
        ],
      },
      orderBy: { result: "desc" },
      select: {
        actorId: true, targetType: true, targetId: true, result: true, metadataJson: true, ipAddress: true, userAgent: true,
      },
    });
    const readIds = new Set<string>();
    const readAudits = toolAudits.map(({ targetId, ...audit }) => {
      const requestId = z.uuid().parse(targetId);
      assert(requestId !== continuationSource.id && requestId !== continuationWrongSource.id,
        "the read audit must identify the tool request, not the requested source");
      readIds.add(requestId);
      return audit;
    });
    const readAudit = { actorId: ownerId, targetType: "conversation_reference", ipAddress: null, userAgent: null };
    const readMetadata = {
      operation: desktopConversationReferenceReadOperation,
      conversation_id: destinationId, turn_id: continuationReceipt.turn_id, device_id: deviceId,
    };
    assert.deepEqual(readAudits, [
      { ...readAudit, result: "success", metadataJson: readMetadata },
      { ...readAudit, result: "failure", metadataJson: { ...readMetadata, reason_code: "FORBIDDEN" } },
    ], "only the two reference attempts may be audited, with no request or result content");
    assert.equal(readIds.size, 2, "the two attempts must have distinct tool request IDs");
    assert.equal(await prisma.auditLog.count({
      where: { actorId: ownerId, action: "conversation_continued" },
    }), 1, "the continuation wrote more than one continuation audit");
    console.log("Packaged Mac continuation passed: cloud source to local destination, one explicit task-reference grant, one native history read, bounded denial for an unselected source, and no source mutation or file copy.");

    const approvalConversation = await task("Packaged Mac native approvals");
    const approvalTurn = await conversations.acceptTurn(ownerId, approvalConversation.id,
      submission(nativeApprovalPrompt, "desktop-native-approval"), {});
    const pendingDesktopApproval = () => waitFor("the native desktop approval", () =>
      prisma.conversationDesktopApproval.findFirst({
        where: { ownerId, conversationId: approvalConversation.id, turnId: approvalTurn.turn_id, status: "pending" },
        orderBy: { nativeRequestId: "asc" },
      }));
    const notePath = join(dataRoot, approvalConversation.workspaceRelPath, "p107-note.txt");
    const shellPath = join(dataRoot, approvalConversation.workspaceRelPath, "approved.txt");
    const shellApproval = await pendingDesktopApproval();
    const shellDetails = desktopApprovalDetailsSchema.parse(shellApproval.approvalJson);
    assert.equal(shellDetails.method, "item/commandExecution/requestApproval");
    assert.match(shellDetails.command, /printf.*approved\.txt/u);
    assert.deepEqual(shellDetails.decisions, ["accept", "cancel"]);
    await assert.rejects(stat(shellPath), { code: "ENOENT" });
    assert.equal((await conversations.respondToDesktopApprovalRequest(ownerId, approvalConversation.id, shellApproval.id,
      { method: shellDetails.method, decision: "accept" }, {})).status, "answered");
    const deniedApproval = await pendingDesktopApproval();
    assert.equal(await readFile(shellPath, "utf8"), "approved\n");
    const deniedDetails = desktopApprovalDetailsSchema.parse(deniedApproval.approvalJson);
    assert.equal(deniedDetails.method, "item/fileChange/requestApproval");
    assert.deepEqual(deniedDetails.changes, [{ path: "$WORKSPACE/p107-note.txt", kind: { type: "add" } }],
      "the native file approval did not identify the operation and file");
    await assert.rejects(conversations.respondToDesktopApprovalRequest(ownerId, approvalConversation.id, deniedApproval.id,
      { method: "item/commandExecution/requestApproval", decision: "accept" }, {}), { code: "VALIDATION_ERROR" });
    await assert.rejects(conversations.respondToDesktopApprovalRequest(input.otherOwnerId, approvalConversation.id, deniedApproval.id,
      { method: deniedDetails.method, decision: "accept" }, {}), { code: "CONVERSATION_NOT_FOUND" });
    assert.equal((await conversations.respondToDesktopApprovalRequest(ownerId, approvalConversation.id, deniedApproval.id,
      { method: deniedDetails.method, decision: "decline" }, {})).status,
      "cancelled");
    const acceptedApproval = await pendingDesktopApproval();
    assert.notEqual(acceptedApproval.id, deniedApproval.id, "the denied file change was replayed without a new approval");
    await assert.rejects(stat(notePath), { code: "ENOENT" });
    const acceptedDetails = desktopApprovalDetailsSchema.parse(acceptedApproval.approvalJson);
    assert.equal(acceptedDetails.method, "item/fileChange/requestApproval");
    assert.equal((await conversations.respondToDesktopApprovalRequest(ownerId, approvalConversation.id, acceptedApproval.id,
      { method: acceptedDetails.method, decision: "accept" }, {})).status, "answered");
    await assert.rejects(conversations.respondToDesktopApprovalRequest(ownerId, approvalConversation.id, acceptedApproval.id,
      { method: acceptedDetails.method, decision: "accept" }, {}), { code: "USER_INPUT_REQUEST_UNAVAILABLE" });
    const registration = await waitForMcpApproval(approvalConversation.id, approvalTurn.turn_id, "register_artifact");
    assert.equal(await readFile(notePath, "utf8"), "fixture\n", "the approved file change did not create the note");
    assert.equal((await conversations.respondToUserInputRequest(ownerId, approvalConversation.id, registration.id, {
      action: "accept", content: { [registration.questionId]: "Allow" },
    }, {})).status, "answered");
    await waitFor("the native approval artifact and completed turn", async () =>
      Boolean(nativeApprovalReceipt) && await status(approvalTurn.turn_id) === "completed", 25_000);
    const approvalReceipt = nativeApprovalReceipt;
    assert(approvalReceipt, "the native approval turn did not register its artifact");
    const approvalDetail = await conversations.get(ownerId, approvalConversation.id);
    const registered = approvalDetail.files.find(file => file.id === approvalReceipt.file_id);
    assert(registered, "the approval turn did not project the registered file");
    const fileChange = registered.desktop_file_change;
    assert(fileChange, "the registered file lost its native file activity link");
    const changeEvent = await prisma.conversationEvent.findFirstOrThrow({
      where: { conversationId: approvalConversation.id, sseEventId: fileChange.event_id },
      select: { payloadJson: true },
    });
    const changeItem = z.object({ params: z.object({ item: z.object({
      type: z.literal("fileChange"), changes: z.array(z.object({ path: z.string() })),
    }) }) }).parse(changeEvent.payloadJson);
    assert(changeItem.params.item.changes.some(entry => entry.path.endsWith("p107-note.txt")),
      "the registered artifact is not linked to the native file change");
    assert.equal(await checksum((await input.files.readArtifactDownload(
      ownerId, approvalConversation.id, approvalReceipt.file_id, {},
    )).data), createHash("sha256").update("fixture\n").digest("hex"));
    const pendingApproval = await conversations.acceptTurn(ownerId, stopApproval.id,
      submission(interruptApprovalPrompt, "desktop-interrupt-approval"), {});
    const unanswered = await waitForBrowserApproval(stopApproval.id, pendingApproval.turn_id, "click");
    assert.equal(unanswered.itemId, "fixture-call-1");
    assert.equal(await browserAuditCount(pendingApproval.turn_id), 0);
    const stoppedApproval = await conversations.interrupt(ownerId, stopApproval.id, pendingApproval.turn_id, {});
    assert.equal(stoppedApproval.code, RUNNER_TURN_INTERRUPT_REQUESTED);
    await waitFor("native interruption during browser approval and slot release", async () =>
      await status(pendingApproval.turn_id) === "interrupted" &&
      !await redis.hasTurnSlot(stopApproval.id, pendingApproval.turn_id, ownerId));
    const cleared = await prisma.conversationUserInputRequest.findUniqueOrThrow({
      where: { id: unanswered.id }, select: { status: true, resolvedAt: true },
    });
    assert(cleared.resolvedAt && (cleared.status === "cancelled" || cleared.status === "expired"),
      "native interruption left an open approval");
    await assert.rejects(conversations.respondToUserInputRequest(ownerId, stopApproval.id, unanswered.id, {
      action: "accept", content: { [unanswered.questionId]: "Allow" },
    }, {}), { code: "USER_INPUT_REQUEST_UNAVAILABLE" });
    assert.equal(await browserAuditCount(pendingApproval.turn_id), 0);
    assert.deepEqual(input.browser.observed.slice(initialBrowserCommands), ["snapshot", "click", "screenshot"]);
    assert.equal(modelRequests.interruptApproval, 1);

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

    if (input.attachBrowserExtension) {
      extension = await input.attachBrowserExtension();
      const joined = await task("Packaged Mac with real Chromium extension");
      const run = await conversations.acceptTurn(ownerId, joined.id, submission(joinedBrowserPrompt, "desktop-chromium"), {});
      const actions = ["status", "tabs", "snapshot", "click", "click"] as const;
      for (const [index, action] of actions.entries()) {
        const request = await waitForBrowserApproval(joined.id, run.turn_id, action);
        assert.equal(request.itemId, `fixture-call-${index + 1}`);
        assert.equal(await browserAuditCount(run.turn_id), index, `${action} reached the gateway before its approval`);
        await extension.assertClickCounts(index === actions.length - 1 ? 1 : 0);
        assert.equal((await conversations.respondToUserInputRequest(ownerId, joined.id, request.id, {
          action: "accept", content: { [request.questionId]: "Allow" },
        }, {})).status, "answered");
      }
      await waitFor("the completed Chromium turn and slot release", async () =>
        await status(run.turn_id) === "completed" && !await redis.hasTurnSlot(joined.id, run.turn_id, ownerId),
      );
      assert.equal(modelRequests.browser, 6);
      const audit = await prisma.auditLog.findMany({
        where: { action: "desktop_tool_requested", targetType: "browser_use", metadataJson: { path: ["turn_id"], equals: run.turn_id } },
        select: { result: true, metadataJson: true },
        orderBy: { createdAt: "asc" },
      });
      const auditMetadata = z.object({ browser_action: z.string(), reason_code: z.string().optional() });
      assert.deepEqual(audit.map(row => ({ result: row.result, ...auditMetadata.parse(row.metadataJson) })), [
        ...actions.slice(0, -1).map(browser_action => ({ result: "success", browser_action })),
        { result: "failure", browser_action: "click", reason_code: "BROWSER_USE_NOT_CONNECTED" },
      ]);
      await extension.assertClickCounts(1);
      console.log("Joined Mac and Chromium passed: paired via popup, listed only the shared tab, approved snapshot and one click, revoked via HTTP, denied the next approved click (BROWSER_USE_NOT_CONNECTED); shared count = 1, unshared count = 0.");
    }

    const memorySource = await task("Packaged Mac memory source");
    const extraction = await task("Packaged Mac memory extraction");
    const memoryState = join(dataRoot, "memory-state");
    await mkdir(memoryState, { mode: 0o700 });
    for (const conversation of [memorySource, extraction]) {
      const root = join(dataRoot, ownerId, "services", conversation.id);
      const control = join(root, "control");
      await mkdir(control, { mode: 0o700 });
      await writeFile(join(control, "personalization.json"), JSON.stringify({
        version: 1, revision: randomUUID(), custom_instructions: "", memories_enabled: true,
      }), { mode: 0o600, flag: "wx" });
      // Share only the disposable native index; the two tasks retain separate rollouts and runtime scopes.
      await writeFile(join(root, "home", ".codex", "config.toml"),
        `sqlite_home = ${JSON.stringify(memoryState)}\n[memories]\nversion = "v2"\ndual_write = false\nmin_rollout_idle_hours = 1\n`,
        { mode: 0o600, flag: "wx" });
    }
    const currentMemoryConnection = await coordinator.executionConnection(deviceId);
    assert(currentMemoryConnection, "Mac disconnected before the memory fixture");
    let memoryConnectionId = currentMemoryConnection.connectionId;
    let expectedConversation = memorySource;
    const observed: { purpose: DesktopModelPurpose; model: string; turnId: string }[] = [];
    const tokenHash = z.string().regex(/^[0-9a-f]{64}$/u);
    const modelGrant = z.object({
      model: z.string(), protocolMode: z.literal("native_responses"), tokenHash,
    });
    const modelLease = z.object({
      scope: desktopRunScopeSchema, expiresAt: z.number(), runHash: tokenHash,
      models: z.object({ primary: modelGrant, memory_extraction: modelGrant }),
    });
    observeModelRequests(async request => {
      if (request.method !== "POST" || !request.url.startsWith(`${DESKTOP_MODEL_PROXY_PATH}/`)) return;
      try {
        const route = z.tuple([z.uuid(), desktopModelPurposeSchema, z.literal("responses")])
          .safeParse(request.url.slice(DESKTOP_MODEL_PROXY_PATH.length + 1).split("/"));
        assert(route.success, "native model request did not use a scoped Responses route");
        const [turnId, purpose] = route.data;
        assert(purpose === "primary" || purpose === "memory_extraction", "unexpected model purpose in the memory fixture");
        assert(request.headers[DESKTOP_MODEL_PURPOSE_HEADER] === purpose, "native purpose header did not match the route");
        const authorization = request.headers.authorization;
        assert(authorization && authorization.startsWith("Bearer "), "native model request lacked a bearer");
        const bearer = desktopModelTokenSchema.safeParse(authorization.slice(7));
        assert(bearer.success, "native model request used a non-model bearer");
        const raw = await redis.client.get(desktopRunLeaseKey(turnId));
        assert(raw && !secrets.some(secret => raw.includes(secret)), "invalid Redis model lease");
        const lease = modelLease.safeParse(JSON.parse(raw));
        assert(lease.success && lease.data.expiresAt > Date.now(), "native model request lacked a live Redis lease");
        assert.deepEqual(lease.data.scope, {
          ownerId, deviceId, connectionId: memoryConnectionId, conversationId: expectedConversation.id,
          turnId, runtimeGeneration: expectedConversation.runtimeGeneration,
        }, "native model lease was bound to a different run");
        assert(await redis.hasTurnSlot(expectedConversation.id, turnId, ownerId), "native model request lacked the active turn slot");
        assert(await isDesktopRunActive(prisma, coordinator, lease.data.scope, "use"),
          "native model request lacked current run authority");
        const body = z.object({ model: z.string(), client_metadata: z.unknown() }).safeParse(request.body);
        const deviceWire = JSON.stringify([request.headers, request.body]);
        assert(body.success && !deviceWire.includes(dataRoot) && !secrets.some(secret => deviceWire.includes(secret)),
          "invalid native model request or server credential or device path on the Mac wire");
        const grant = lease.data.models[purpose];
        assert(grant.model === body.data.model && grant.tokenHash === createHash("sha256").update(bearer.data).digest("hex"),
          "native model bearer did not match its Redis purpose and model");
        assert(new Set([lease.data.runHash, lease.data.models.primary.tokenHash, lease.data.models.memory_extraction.tokenHash]).size === 3,
          "run and model purposes shared a credential");
        if (purpose === "memory_extraction") {
          // Runner projects native metadata into the purpose; the original marker remains in client_metadata.
          const metadata = codexTurnMetadataFromClientMetadata(body.data.client_metadata);
          const kind = z.object({ request_kind: z.literal("memory") }).safeParse(JSON.parse(metadata ?? "null"));
          assert(kind.success && body.data.model === memoryExtractionModel, "request was not native memory extraction");
        }
        observed.push({ purpose, model: body.data.model, turnId });
      } catch (error) {
        modelFailure = error instanceof assert.AssertionError ? error.message.split("\n")[0] : "Invalid native model request observation";
        throw error;
      }
    });
    const memoryTurn = (id: string) => prisma.conversationTurn.findUnique({
      where: { id }, select: { status: true, codexThreadId: true, model: true },
    });
    const seedTurn = await conversations.acceptTurn(ownerId, memorySource.id, {
      ...submission(memorySeedPrompt, randomUUID()), modelPreference: { modelId: memoryFixtureModel, reasoningEffort: "low" },
    }, {});
    const source = await waitFor("the completed native memory source", async () => {
      const turn = await memoryTurn(seedTurn.turn_id);
      return turn?.status === "completed" && !await redis.hasTurnSlot(memorySource.id, seedTurn.turn_id, ownerId) ? turn : false;
    });
    assert(source.codexThreadId && source.model === memoryFixtureModel && observed.some(request =>
      request.turnId === seedTurn.turn_id && request.purpose === "primary" && request.model === memoryFixtureModel),
    "native source turn did not use the selected source model");

    // Stop the worker before editing the one disposable state index row.
    await stopBridge();
    const { DatabaseSync } = await import("node:sqlite");
    const stateFile = join(memoryState, "state_5.sqlite");
    assert(await realpath(stateFile) === stateFile, "native state must stay inside the disposable fixture");
    const stateDb = new DatabaseSync(stateFile);
    try {
      const nativeRow = stateDb.prepare("SELECT source, memory_mode, archived, updated_at, updated_at_ms FROM threads WHERE id = ?");
      const before = z.object({
        source: z.literal("vscode"), memory_mode: z.literal("enabled"), archived: z.literal(0),
        updated_at: z.number().int(), updated_at_ms: z.number().int(),
      }).safeParse(nativeRow.get(source.codexThreadId));
      const now = Date.now();
      assert(before.success && before.data.updated_at_ms > now - 60 * 60 * 1_000,
        "the completed native source was not in the disposable state DB as a fresh memory candidate");
      // Codex 0.170.0 clamps the idle floor to one hour. Age only the native
      // metadata clock for this test; do not seed history or a memory job.
      const agedSeconds = Math.floor(now / 1000) - 2 * 60 * 60;
      assert.equal(stateDb.prepare("UPDATE threads SET updated_at = ?, updated_at_ms = ? WHERE id = ? AND updated_at_ms = ?")
        .run(agedSeconds, agedSeconds * 1000, source.codexThreadId, before.data.updated_at_ms).changes, 1);
      assert.deepEqual({ ...nativeRow.get(source.codexThreadId) }, {
        ...before.data, updated_at: agedSeconds, updated_at_ms: agedSeconds * 1000,
      });
    } finally {
      stateDb.close();
    }
    expectedConversation = extraction;
    const stopMemoryBridge = startBridge();
    memoryConnectionId = await waitForConnection(memoryConnectionId);
    const extractionTurn = await conversations.acceptTurn(ownerId, extraction.id, {
      ...submission(memoryForegroundPrompt, randomUUID()), modelPreference: { modelId: memoryFixtureModel, reasoningEffort: "low" },
    }, {});
    try {
      const target = await waitFor("a new native foreground thread holding the extraction run", async () => {
        if (!memoryForegroundStarted || !observed.some(request =>
          request.turnId === extractionTurn.turn_id && request.purpose === "primary" && request.model === memoryFixtureModel)) return false;
        const turn = await memoryTurn(extractionTurn.turn_id);
        return turn?.status === "running" ? turn : false;
      });
      assert(target.codexThreadId && target.model === memoryFixtureModel && target.codexThreadId !== source.codexThreadId,
        "extraction turn did not use a distinct foreground thread");
      const usage = await waitFor("native extraction metered on the active turn", () => prisma.modelUsageRecord.findFirst({
        where: { ownerId, conversationId: extraction.id, turnId: extractionTurn.turn_id, workload: "memory_generation",
          model: memoryExtractionModel, measurementMethod: "provider" },
        select: { totalTokens: true, inputTokens: true, outputTokens: true, usedCreditMicros: true },
      }));
      assert.deepEqual(usage, { totalTokens: 2n, inputTokens: 1n, outputTokens: 1n, usedCreditMicros: 3_000n },
        "native extraction must meter the exact provider usage on the foreground turn");
      const memoryDb = new DatabaseSync(join(memoryState, "memories_v2_1.sqlite"), { readOnly: true });
      try {
        const job = memoryDb.prepare("SELECT status FROM jobs WHERE kind = 'memory_stage1' AND job_key = ? AND worker_id = ?");
        await waitFor("Codex to finish its native extraction job", async () =>
          job.get(source.codexThreadId, target.codexThreadId)?.status === "done");
      } finally {
        memoryDb.close();
      }
      assert.equal((await memoryTurn(extractionTurn.turn_id))?.status, "running");
      assert(await redis.hasTurnSlot(extraction.id, extractionTurn.turn_id, ownerId), "foreground lost the slot before extraction completed");
      assert.equal(observed.filter(request => request.turnId === extractionTurn.turn_id && request.purpose === "memory_extraction").length,
        1, "the actual source rollout must be extracted exactly once");
    } finally {
      foreground.abort();
    }
    await waitFor("the extraction foreground turn to complete and release its slot", async () =>
      await status(extractionTurn.turn_id) === "completed" && !await redis.hasTurnSlot(extraction.id, extractionTurn.turn_id, ownerId));

    await stopMemoryBridge();
    assert.equal(modelRequests.interrupt, 1);
    assert(!modelFailure, "synthetic provider rejected the round trip");
    assert(!serverSecretInNativeOutput, "server credential reached native logs");
    await assertNoServerSecrets(dataRoot, secrets);
    console.log("Packaged Mac memory credentials passed: native extraction under its own grant on a live foreground turn, exact provider usage, and no server canaries in the device model request, native output or fixture files.");
    console.log(`Packaged Mac gateway passed: stop before admission and during download, download revocation and reconnect, throttled ${attachmentMiB} MiB retry read by native Codex, scoped tools, approvals, native artifact registration and authenticated download, interruption, and start idempotency.`);
    return {
      id: artifact.file_id, turnId: completed.turn_id, conversationId: read.id, sizeBytes: download.sizeBytes,
      websiteArtifactId: website.file_id, websiteAssets,
      model: fixtureModel, modelCalls: modelRequests.read,
    };
  } finally {
    foreground.abort();
    observeModelRequests(undefined);
    closeModelStream?.();
    if (child?.stdin && !child.stdin.destroyed) child.stdin.end();
    if (childExit) await Promise.race([childExit.catch(() => null), delay(8_000, null, { ref: false })]);
    if (child?.exitCode === null && child.signalCode === null) {
      child.kill();
      await childExit?.catch(() => null);
    }
    await model.close().finally(() => extension?.close());
  }
}

async function checksum(data: Readable): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of data) hash.update(chunk);
  return hash.digest("hex");
}

type AttachmentTransfer = {
  fileId: string;
  path?: string;
  started: boolean;
  closed: boolean;
  finished: boolean;
  chunkDelayMs: number;
  release: () => void;
  released: Promise<void>;
};

export function installPackagedAttachmentTransferGate(app: FastifyInstance) {
  let next: AttachmentTransfer | undefined;
  const requestCounts = new Map<string, number>();
  app.addHook("onRequest", async request => {
    if (request.url.startsWith(`${desktopAttachmentDownloadPath}/`)) {
      requestCounts.set(request.url, (requestCounts.get(request.url) ?? 0) + 1);
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const gate = next;
    if (!gate || reply.statusCode !== 200 || !request.url.startsWith(`${desktopAttachmentDownloadPath}/`) ||
        !request.url.endsWith(`/${gate.fileId}`)) return payload;
    assert(payload instanceof Readable);
    next = undefined;
    gate.path = request.url;
    reply.raw.once("close", () => {
      gate.closed = true;
      gate.release();
    });
    reply.raw.once("finish", () => { gate.finished = true; });
    return Readable.from((async function* () {
      const iterator = payload.iterator();
      try {
        const first = await iterator.next();
        assert(!first.done && Buffer.isBuffer(first.value) && first.value.byteLength > 1);
        gate.started = true;
        yield first.value.subarray(0, 1);
        await gate.released;
        if (gate.closed) return;
        const releasedAt = Date.now();
        let bytesSent = 0;
        const throttle = async function* (chunks: AsyncIterable<Buffer>) {
          for await (const bytes of chunks) {
            bytesSent += bytes.byteLength;
            const elapsed = Date.now() - releasedAt;
            const remaining = Math.ceil(bytesSent / (1024 * 1024) * gate.chunkDelayMs) - elapsed;
            if (remaining > 0) await delay(remaining);
            if (gate.closed) return;
            yield bytes;
          }
        };
        async function* remainingChunks() {
          yield first.value.subarray(1);
          for await (const bytes of iterator) {
            assert(Buffer.isBuffer(bytes));
            yield bytes;
          }
        }
        yield* throttle(remainingChunks());
      } finally {
        await iterator.return?.();
      }
    })(), { objectMode: false });
  });
  return {
    hold(fileId: string, chunkDelayMs = 0): AttachmentTransfer {
      assert.equal(next, undefined);
      const controller = new AbortController();
      const released = new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
      next = { fileId, started: false, closed: false, finished: false, release: () => controller.abort(), released, chunkDelayMs };
      return next;
    },
    requests(path: string) { return requestCounts.get(path) ?? 0; },
  };
}

async function hasPartialAttachment(control: string, turnId: string, fileId: string, filename: string): Promise<boolean> {
  const directory = (await listDirectory(control)).find(name => name.startsWith(`attachments-${turnId}-`));
  if (!directory) return false;
  try {
    return (await stat(join(control, directory, fileId, filename))).size === 1;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return false;
  }
}

async function listDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return [];
  }
}

function nativeToolOutput(input: unknown, callId: string): unknown {
  const item = z.looseObject({ type: z.string(), call_id: z.string().optional(), output: z.unknown().optional() });
  const match = z.array(item).parse(input).find(entry =>
    entry.type === "function_call_output" && entry.call_id === callId,
  );
  assert(match, "native tool output missing");
  return match.output;
}

function toolOutput(input: unknown, callId: string): unknown {
  const textItem = z.object({ type: z.literal("input_text"), text: z.string() });
  const [, payload] = z.tuple([
    textItem.extend({ text: z.string().regex(/^Wall time: \d+(?:\.\d+)? seconds\nOutput:$/u) }),
    textItem,
  ]).rest(z.unknown()).parse(nativeToolOutput(input, callId));
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
