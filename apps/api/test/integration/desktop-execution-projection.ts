import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { buffer } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";

import {
  conversationStartFailurePayloadSchema,
  creditMicrosToDecimal,
  DESKTOP_ATTACHMENT_PROTOCOL_HEADER,
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  desktopArtifactMaxParts,
  desktopArtifactPartBytes,
  desktopArtifactPath,
  desktopArtifactPathDigestHeader,
  desktopArtifactPathDigestInput,
  desktopArtifactReceiptSchema,
  desktopExecutionAckSchema,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopProtocolVersion,
  desktopToolMaxInFlight,
  desktopToolLifetimeFor,
  desktopToolOperationSchema,
  desktopToolProtocolVersion,
  desktopToolRequestLifetimeMs,
  desktopToolResultSchema,
  RUNNER_TURN_INTERRUPT_REQUESTED,
  type DesktopExecutionCallback,
  type DesktopExecutionCommand,
  type DesktopToolRequest,
} from "@linksense/shared";
import { Queue } from "bullmq";
import Fastify from "fastify";
import JSZip from "jszip";
import { WebSocket } from "ws";
import { z } from "zod";

import { BackgroundJobs, type MaintenanceJob } from "../../src/adapters/jobs.js";
import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { LocalFilesystemObjectStorage } from "../../src/adapters/object-storage.js";
import { RunnerClient, type RunnerStartInput } from "../../src/adapters/runner.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { sha256 } from "../../src/lib/crypto.js";
import { sendAppError } from "../../src/lib/http.js";
import { projectWorkspaceRelativePath, runtimePlacementForWorkspace } from "../../src/lib/user-runtime-paths.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { ConversationService } from "../../src/modules/conversations/service.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { registerDesktopExecution } from "../../src/modules/desktop-devices/execution.js";
import { desktopNoticeChannel, type DesktopNotice } from "../../src/modules/desktop-devices/notices.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { DesktopBrowserUse } from "../../src/modules/desktop-devices/browser-use.js";
import { isDesktopRunActive } from "../../src/modules/desktop-credentials/run-authority.js";
import { DesktopRunLeases, desktopRunLeaseKey } from "../../src/modules/desktop-credentials/run-leases.js";
import { registerBrowserUseRoutes } from "../../src/modules/browser-use/routes.js";
import { BrowserUseService } from "../../src/modules/browser-use/service.js";
import { RedisBrowserStore } from "../../src/modules/browser-use/store.js";
import { registerDesktopDeviceRoutes } from "../../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { TaskRecoveryScheduler, type TaskRecoveryQueueControl } from "../../src/modules/events/recovery-scheduler.js";
import { ConversationEventService } from "../../src/modules/events/service.js";
import { FileService } from "../../src/modules/files/service.js";
import { desktopArtifactObjectKey, desktopArtifactPartKey, desktopArtifactStagingKey } from "../../src/modules/files/desktop-artifact-storage.js";
import { HtmlPreviewService, RedisHtmlPreviewSessionStore } from "../../src/modules/html-preview/service.js";
import { PrivacyMaskingSettingsService } from "../../src/modules/privacy-masking/service.js";
import { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";
import { WebSearchSettingsService } from "../../src/modules/system/web-search-settings.js";
import { CreditLimitService } from "../../src/modules/usage/credit-limit.js";
import { UsageAnalyticsService } from "../../src/modules/usage/service.js";
import { webBundleObjectKey } from "../../src/modules/web-sites/bundle.js";
import { WebArtifactResources } from "../../src/modules/web-sites/artifact-resources.js";
import { WebSiteRepository } from "../../src/modules/web-sites/repository.js";
import { WebSiteService } from "../../src/modules/web-sites/service.js";
import { createRedisFixture } from "../fixtures/redis.js";
import { testConfig } from "../test-config.js";
import { createDesktopConnectionFixture } from "./desktop-connection-fixture.js";
import {
  installPackagedAttachmentTransferGate, verifyPackagedDesktopGateway, type AttachDesktopBrowserExtension,
} from "./desktop-package-roundtrip.js";
import { verifyLocalComputerSessions } from "./local-computer-sessions.js";
import { createDesktopKnowledgeFixture, verifyDesktopKnowledgePublication } from "./desktop-knowledge-fixture.js";
import { attachDesktopBrowserFixture } from "./desktop-browser-fixture.js";
import { createDesktopMinioFixture } from "./desktop-minio-fixture.js";

const capabilityGeneration = "0".repeat(64);
type RecoveryJobData = Parameters<TaskRecoveryQueueControl["add"]>[1];
type RecoveryJobName = RecoveryJobData["type"];

export async function verifyDesktopExecutionProjection(input: {
  prisma: PrismaClient;
  ownerId: string;
  deviceId: string;
  token: string;
  databaseUrl: string;
  workspaceRoot: string;
  otherOwnerId: string;
  legacyConversationId: string;
  legacyArtifact: { id: string; contents: Buffer };
  cloudConversationId: string;
}): Promise<void> {
  const { prisma, ownerId, deviceId, token } = input;
  const useMinio = Boolean(process.env.LINKSENSE_TEST_MINIO_BIN);
  const config = testConfig({
    DATABASE_URL: input.databaseUrl,
    LINKSENSE_USER_DATA_ROOT: input.workspaceRoot,
    LINKSENSE_RUNNER_URL: "http://127.0.0.1:1",
    LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED: "true",
    LINKSENSE_DESKTOP_BROWSER_USE_ENABLED: "true",
    LINKSENSE_DESKTOP_ARTIFACTS_ENABLED: "true",
    LINKSENSE_DESKTOP_WEBSITE_ARTIFACTS_ENABLED: "true",
    LINKSENSE_DESKTOP_NATIVE_APPROVALS_ENABLED: "true",
    // Let a website archive within the bundle limit exercise multipart upload.
    ...(useMinio && { LINKSENSE_UPLOAD_MAX_FILE_SIZE_MB: String(desktopArtifactPartBytes / 1024 ** 2) }),
    LINKSENSE_CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
    LINKSENSE_RUNNER_SHARED_SECRET: randomUUID(),
  });
  const fixture = await createRedisFixture();
  const socketPath = fixture.client.options.path;
  assert(socketPath, "fixture Redis must use its private socket");
  const queue = new Queue<RecoveryJobData, void, RecoveryJobName>(
    "desktop-projection-fixture", { connection: { path: socketPath } },
  );
  const maintenance = new Queue<MaintenanceJob, unknown, MaintenanceJob["type"]>(
    "desktop-maintenance-fixture", { connection: { path: socketPath } },
  );
  const app = Fastify();
  const joinBrowserExtension = process.env.LINKSENSE_TEST_DESKTOP_BROWSER_EXTENSION === "1";
  const runtimeRoot = process.env.LINKSENSE_DESKTOP_RUNTIME_DIST;
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  const sockets: WebSocket[] = [];
  const relayUploads = new Set<string>();
  app.addHook("onRequest", async request => {
    if (request.method === "PUT" && request.url.startsWith(`${desktopArtifactPath}/`)) relayUploads.add(request.url);
  });
  let minio: Awaited<ReturnType<typeof createDesktopMinioFixture>> = null;
  try {
    const redis = new LinkSenseRedis(config, fixture.client);
    const knowledge = await createDesktopKnowledgeFixture(prisma, redis.client, ownerId, input.otherOwnerId);
    const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
    const leases = new DesktopRunLeases(redis.client, (scope, phase) => isDesktopRunActive(prisma, coordinator, scope, phase));
    const browserStore = new RedisBrowserStore(redis.client);
    assert(!joinBrowserExtension || runtimeRoot, "the Chromium fixture requires a staged Mac runtime");
    const browser = new BrowserUseService(browserStore, "http://127.0.0.1/api/v1/browser-use", {
      ...config, isActiveRun: scope => leases.isActiveToolScope(scope),
    });
    if (joinBrowserExtension) app.get("/settings/general", (_request, reply) => reply.type("text/html")
      .send("<!doctype html><title>LinkSense pairing fixture</title>"));
    const runner = new RunnerClient(config, async (owner, conversationId) => {
      const row = await prisma.conversation.findFirst({
        where: { id: conversationId, ownerId: owner },
        select: { executionTarget: true },
      });
      return row?.executionTarget === "local" ? "local" : null;
    });
    const outsideFixture = async (): Promise<never> => { throw new Error("Unexpected cloud or user-authentication call"); };
    const modelProviderSettings = new ModelProviderSettingsService(prisma, config);
    const usageAnalytics = new UsageAnalyticsService(prisma, { modelCatalog: modelProviderSettings });
    const creditLimits = new CreditLimitService(prisma, { timeZone: config.billingTimeZone });
    const privacyMaskingSettings = new PrivacyMaskingSettingsService(prisma, config);
    const audit = new AuditService(prisma);
    const connector = await createDesktopConnectionFixture(prisma, config, audit, ownerId, input.otherOwnerId);
    const searchKey = randomUUID();
    const searchCalls: string[] = [];
    const searchMarker = `desktop-search-result-${randomUUID()}`;
    const searchResult = {
      title: searchMarker, url: "https://fixture.example.test/", snippet: "Isolated search result", summary: null, published_at: null,
    };
    let searchAborts = 0;
    const webSearchSettings = new WebSearchSettingsService(prisma, config, async (_runtime, request, signal) => {
      searchCalls.push(request.query);
      if (request.query === "fixture pending search") {
        try { await delay(15_000, null, { signal }); } finally { if (signal?.aborted) searchAborts++; }
      }
      return { success: true, provider: "brave", query: request.query, results: [searchResult] };
    });
    await webSearchSettings.update(ownerId, {
      enabled: true, provider: "brave", base_url: null, search_engine_id: null,
      default_max_results: 1, timeout_ms: 20_000, expected_revision: 0, api_key: searchKey,
    }, {});
    const conversations = new ConversationService(
      prisma, redis, runner, audit,
      {
        ensureUserHome: outsideFixture, resolve: outsideFixture, resolveRecovery: outsideFixture,
        resolveStartIntentRecovery: outsideFixture, withCapabilityStartBarrier: outsideFixture,
      },
      input.workspaceRoot,
      {
        enqueueRuntimeCleanup: outsideFixture, enqueueConversationPrewarm: outsideFixture,
        enqueueFormRecommendation: outsideFixture,
      },
      knowledge.store, modelProviderSettings, undefined, creditLimits,
    );
    const events = new ConversationEventService(prisma, redis, conversations, undefined, knowledge.sources);
    minio = await createDesktopMinioFixture(input.workspaceRoot);
    const storage = minio?.storage ?? new LocalFilesystemObjectStorage({
      ...config, objectStorage: { ...config.objectStorage, provider: "local-filesystem", localRoot: input.workspaceRoot },
    });
    const files = new FileService(prisma, conversations, storage, audit, config, redis, {
      enqueueObjectDelete: outsideFixture, enqueueWorkspaceDirectoryRemoval: outsideFixture,
    });
    const legacyArtifact = input.legacyArtifact;
    const legacyFile = await prisma.conversationFile.findUniqueOrThrow({ where: { id: legacyArtifact.id } });
    assert.equal(legacyFile.desktopSourcePathDigest, null);
    assert(legacyFile.minioObjectKey);
    await storage.putObject(legacyFile.minioObjectKey, legacyArtifact.contents, { "content-type": "text/plain" });
    const legacyDownload = await files.readArtifactDownload(ownerId, input.legacyConversationId, legacyArtifact.id, {});
    assert.equal(legacyDownload.filename, "legacy.txt");
    assert.deepEqual(await buffer(legacyDownload.data), legacyArtifact.contents);
    await assert.rejects(files.readArtifactDownload(input.otherOwnerId, input.legacyConversationId, legacyArtifact.id, {}), { code: "CONVERSATION_NOT_FOUND" });
    const jobs = new BackgroundJobs(config, storage, runner, audit, config.capabilityRoot, maintenance, prisma);
    let beforeArtifactRegistration: (() => Promise<void>) | undefined;
    const local = await verifyLocalComputerSessions({
      ...input, conversations, redis: redis.client, connections: coordinator,
    });
    const recovery = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    events.configureRecoveryScheduler(recovery);
    const execution = await registerDesktopExecution(app, {
      config, prisma, redis, runner, conversations, events, storage, jobs,
      files: { registerVerifiedDesktopArtifact: async (input, fence) => {
        await beforeArtifactRegistration?.();
        return files.registerVerifiedDesktopArtifact(input, fence);
      } },
      modelProviderSettings, creditLimits, privacyMaskingSettings, webSearchSettings, audit,
      usageAnalytics,
      knowledgeSearch: knowledge.service, connections: connector.service,
      browserUse: new DesktopBrowserUse(prisma, browser, browserStore, config),
    }, coordinator, leases);
    assert(execution, "Mac execution must be enabled in this fixture");
    let rejectNextRecovery = false;
    const { authValidAfter } = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { authValidAfter: true } });
    app.decorate("authenticate", async request => {
      request.authUser = {
        id: ownerId, name: "Desktop owner", email: "desktop-owner@example.test",
        role: "user", status: "active", preferredLocale: null, avatarObjectKey: null, authValidAfter,
      };
    });
    await registerBrowserUseRoutes(app, {
      service: browser, prisma, redis: redis.client, intent: { detect: async () => false },
      sharedSecret: config.runnerSharedSecret, rateLimitHmacSecret: config.loginRateLimitHmacSecret,
      socketPath: "/api/v1/browser-use/socket",
    });
    await registerDesktopDeviceRoutes(app, {
      service: new DesktopDeviceService(new PrismaDesktopDeviceRepository(prisma), coordinator),
      redis: redis.client, rateLimitHmacSecret: config.loginRateLimitHmacSecret, execution,
      knowledgeTools: true,
      connectionTools: true,
      browserTools: true,
      artifactTools: true,
      websiteArtifacts: config.desktopWebsiteArtifactsEnabled,
      nativeApprovals: true,
      onExecutionReady: binding => {
        if (!rejectNextRecovery) return events.scheduleDesktopRecovery(binding);
        rejectNextRecovery = false;
        return Promise.reject(new Error("fixture recovery dispatch is unavailable"));
      },
    });
    const attachmentTransfer = installPackagedAttachmentTransferGate(app);
    const attachmentSockets = new Set<Duplex>();
    app.server.on("upgrade", (request, socket) => {
      if (request.url !== "/api/v1/desktop/devices/socket" || !request.headers[DESKTOP_ATTACHMENT_PROTOCOL_HEADER]) return;
      attachmentSockets.add(socket);
      socket.once("close", () => { attachmentSockets.delete(socket); });
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    if (joinBrowserExtension) {
      // Only the real Chromium fixture needs the kernel-assigned pairing origin.
      Object.defineProperty(browser, "endpoint", { value: new URL("/api/v1/browser-use", address).href });
    }
    const browserFixture = await attachDesktopBrowserFixture({ app, address, ownerId });
    sockets.push(browserFixture.socket);
    const connect = async (expectRecovery = true, tools = false, operations = false) => {
      const url = new URL("/api/v1/desktop/devices/socket", address);
      url.protocol = "ws:";
      const socket = new WebSocket(url, {
        headers: {
          [DESKTOP_EXECUTION_PROTOCOL_HEADER]: operations ? String(desktopExecutionProtocolVersion) : "2",
          ...(tools ? { [DESKTOP_TOOL_PROTOCOL_HEADER]: operations ? String(desktopToolProtocolVersion) : "1" } : {}),
          ...(operations ? { [DESKTOP_TOOL_OPERATIONS_HEADER]: desktopToolOperationSchema.options.join(",") } : {}),
        },
      });
      sockets.push(socket);
      await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
      const closed = once(socket, "close");
      const ready = desktopExecutionDeviceReadySchema.parse(await exchange(socket, {
        type: "hello", token, protocol_version: desktopProtocolVersion,
      }));
      assert.equal(ready.device_id, deviceId);
      assert.equal(ready.tool_protocol_version, tools ? desktopToolProtocolVersion : undefined);
      assert.deepEqual(ready.tool_operations, operations ? desktopToolOperationSchema.options : undefined);
      if (!expectRecovery) {
        await Promise.race([closed, delay(5_000, null, { ref: false }).then(() => { throw new Error("socket did not close"); })]);
        return { socket, connectionId: ready.connection_id, recoveryJob: null };
      }
      const deadline = Date.now() + 1_000;
      for (;;) {
        const recoveryJob = await queue.getJob(`desktop-${ready.connection_id}-first`);
        if (recoveryJob) return { socket, connectionId: ready.connection_id, recoveryJob };
        assert(Date.now() < deadline, "execution-ready hook did not enqueue reconnect recovery");
        await delay(10);
      }
    };
    rejectNextRecovery = true;
    await connect(false);
    const legacyTools = await connect(true, true);
    await legacyTools.recoveryJob?.remove();
    const initial = await connect(true, true, true);
    await initial.recoveryJob?.remove();
    await events.recoverRunningTurns();

    // P2-01: with a live Mac attached to the owner, the upgraded cloud
    // conversation still uses only the HTTP runner. A server-internal stale
    // connection hint must fail closed in the production desktop binding before
    // any device command or run lease.
    const cloudConversation = await prisma.conversation.findUniqueOrThrow({ where: { id: input.cloudConversationId } });
    assert.equal(cloudConversation.ownerId, ownerId);
    assert.equal(cloudConversation.archiveStatus, "active");
    assert.equal(cloudConversation.executionTarget, "cloud");
    assert.equal(cloudConversation.desktopDeviceId, null);
    assert(cloudConversation.codexThreadId, "the upgraded cloud conversation must retain its native thread");
    const cloudThreadId = cloudConversation.codexThreadId;
    const cloudTurnId = randomUUID();
    const cloudPlacement = runtimePlacementForWorkspace(ownerId, cloudConversation.workspaceRelPath);
    assert.equal(cloudPlacement.workspacePath, "workspace");
    const cloudInput = {
      ownerId, conversationId: cloudConversation.id, projectionTurnId: cloudTurnId,
      expectedRuntimeGeneration: cloudConversation.runtimeGeneration,
      appServerProcessLimit: 1, capabilityGeneration, mcpGeneration: capabilityGeneration,
      codexThreadId: cloudThreadId, collaborationMode: "default" as const, mcpServers: [], capabilities: [], environment: {},
      context: { userInput: "Run this task in the cloud", attachments: [], priorityPlugins: [], prioritySkills: [] },
      model: "fixture-model", reasoningEffort: "low" as const,
      modelProvider: {
        revision: 1, baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(),
        protocolMode: "native_responses" as const,
      },
    } satisfies RunnerStartInput;
    const originalSend = execution.send;
    let deviceCommands = 0;
    execution.send = async (...args) => {
      deviceCommands += 1;
      return await originalSend.apply(execution, args);
    };
    const originalFetch = globalThis.fetch;
    let cloudStarts = 0;
    const cloudReceipt = {
      conversationId: cloudConversation.id, projectionTurnId: cloudTurnId, status: "starting" as const,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    globalThis.fetch = async (request, init) => {
      cloudStarts += 1;
      const url = new URL(String(request));
      assert.equal(url.pathname, `/conversations/${cloudConversation.id}/turns/start`);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-linksense-owner-id"), ownerId);
      assert.equal(headers.get("x-linksense-workspace"), cloudPlacement.workspacePath);
      return new Response(JSON.stringify(cloudReceipt), { status: 202, headers: { "content-type": "application/json" } });
    };
    try {
      // The stale hint must use the live connection so only the persisted
      // cloud target can reject it.
      assert.equal((await execution.connection(deviceId))?.connectionId, initial.connectionId);
      const cloudStart = await runner.acceptStartTurn(cloudInput, cloudPlacement);
      assert.deepEqual(cloudStart, cloudReceipt);
      assert.equal(cloudStarts, 1);
      assert.equal(deviceCommands, 0, "cloud start must not send a Mac command");
      assert.equal(await redis.client.get(desktopRunLeaseKey(cloudTurnId)), null,
        "cloud start must not issue a desktop run lease");
      const staleTurnId = randomUUID();
      await prisma.conversation.update({
        where: { id: cloudConversation.id }, data: { desktopDeviceId: deviceId },
      });
      try {
        await assert.rejects(runner.acceptStartTurn({
          ...cloudInput, projectionTurnId: staleTurnId,
        }, cloudPlacement, initial.connectionId), { code: "RUNNER_UNAVAILABLE" });
      } finally {
        await prisma.conversation.update({
          where: { id: cloudConversation.id }, data: { desktopDeviceId: null },
        });
      }
      assert.equal((await prisma.conversation.findUniqueOrThrow({
        where: { id: cloudConversation.id }, select: { desktopDeviceId: true },
      })).desktopDeviceId, null);
      assert.equal(cloudStarts, 1, "the stale desktop hint must not fall back to HTTP");
      assert.equal(deviceCommands, 0, "the cloud conversation must reject the desktop hint before a command");
      assert.equal(await redis.client.get(desktopRunLeaseKey(staleTurnId)), null,
        "the stale desktop hint must not issue a run lease");
    } finally {
      globalThis.fetch = originalFetch;
      execution.send = originalSend;
    }

    const threadId = randomUUID(), nativeTurnId = randomUUID(), turnId = randomUUID();
    const conversation = await prisma.conversation.create({ data: {
      ownerId, title: "Desktop execution projection", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${ownerId}/home/workspaces/${randomUUID()}`, runtimeGeneration: randomUUID(),
      executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: threadId,
    } });
    const conversationId = conversation.id;
    const runtimeGeneration = conversation.runtimeGeneration;
    await prisma.conversationTurnStartIntent.create({ data: {
      projectionTurnId: turnId, ownerId, conversationId, runtimeGeneration, capabilityGeneration,
      inputText: "Confirm this Mac can publish", capabilitiesJson: [], attachmentsJson: [],
      knowledgeBaseIdsJson: [knowledge.owned.base.id, knowledge.foreign.base.id],
      submitMode: "normal", runnerStatus: "prepared",
    } });
    assert.equal((await redis.acquireTurnSlot(conversationId, turnId, ownerId)).acquired, true);

    const callbackScope = { conversation_id: conversationId, turn_id: turnId, runtime_generation: runtimeGeneration };
    const receiptBase = {
      conversationId, projectionTurnId: turnId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const commandScope = (command: DesktopExecutionCommand) => {
      assert.equal(command.conversation_id, conversationId);
      assert.equal(command.owner_id, ownerId);
      assert.equal(command.runtime_generation, runtimeGeneration);
      assert.equal(command.turn_id, turnId);
    };
    const [, start] = await Promise.all([
      runner.acceptStartTurn({
        ownerId, conversationId, projectionTurnId: turnId, expectedRuntimeGeneration: runtimeGeneration,
        appServerProcessLimit: 1, capabilityGeneration, mcpGeneration: capabilityGeneration,
        codexThreadId: threadId, collaborationMode: "default", mcpServers: [], capabilities: [], environment: {},
        context: { userInput: "Confirm this Mac can publish", attachments: [], priorityPlugins: [], prioritySkills: [] },
        model: "fixture-model", reasoningEffort: "low",
        modelProvider: {
          revision: 1, baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(),
          protocolMode: "native_responses",
        },
      }),
      readCommand(initial.socket).then(command => {
        commandScope(command);
        assert(command.operation === "turn.start");
        assert.equal(command.body.native_thread_id, threadId);
        send(initial.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: true,
          result: { ...receiptBase, status: "starting" },
        });
        return command;
      }),
    ]);
    // Deliver a tool request before the device starts the settlement handshake.
    const earlyConnector = {
      type: "tool.request", id: randomUUID(), operation: "connection.execute", ...callbackScope,
      expires_at: new Date(Date.now() + desktopToolLifetimeFor("connection.execute")).toISOString(),
      run_token: start.body.credentials.run_token,
      body: { input: { operation: "list_connections" } },
    } as const satisfies DesktopToolRequest;
    const earlyResult = desktopToolResultSchema.parse(await exchange(initial.socket, earlyConnector));
    assert(earlyResult.ok && earlyResult.operation === "connection.execute" && earlyResult.data.kind === "connections",
      "a valid Mac connector read failed while the turn was still prepared");
    const inspect = desktopExecutionCommandSchema.parse(await exchange(initial.socket, {
      type: "execution.callback", id: randomUUID(), operation: "start.settled", ...callbackScope,
      run_token: start.body.credentials.run_token,
      body: { conversationId, projectionTurnId: turnId, runtimeGeneration },
    } satisfies DesktopExecutionCallback));
    commandScope(inspect);
    assert.equal(inspect.operation, "turn.inspect");
    const settlement = desktopExecutionAckSchema.parse(await exchange(initial.socket, {
      type: "command.result", id: inspect.id, operation: inspect.operation, ok: true,
      result: { ...receiptBase, status: "succeeded", result: { codexThreadId: threadId, codexTurnId: nativeTurnId } },
    }));
    assert(settlement.ok && settlement.operation === "start.settled" && settlement.data.settled);

    const tool: DesktopToolRequest = {
      type: "tool.request", id: randomUUID(), operation: "web.search", ...callbackScope,
      expires_at: new Date(Date.now() + desktopToolRequestLifetimeMs).toISOString(),
      run_token: start.body.credentials.run_token, body: { query: "fixture search" },
    };
    const invokeTool = async (frame: DesktopToolRequest = tool) => desktopToolResultSchema.parse(await exchange(initial.socket, frame));
    const unauthorized = await invokeTool({ ...tool, turn_id: randomUUID() });
    assert(!unauthorized.ok && unauthorized.error_code === "FORBIDDEN");
    const expired = await invokeTool({ ...tool, expires_at: new Date(Date.now() - 1).toISOString() });
    assert(!expired.ok && expired.error_code === "RUNNER_UNAVAILABLE");
    assert.equal(searchCalls.length, 0);
    const search = await invokeTool();
    assert(search.ok && search.operation === "web.search" && search.data.results[0]?.title === searchMarker);
    const replay = await invokeTool({ ...tool, id: tool.id.toUpperCase() });
    assert(!replay.ok && replay.error_code === "RUNNER_OPERATION_UNCERTAIN");
    assert.deepEqual(searchCalls, [tool.body.query]);
    const audits = await prisma.auditLog.findMany({
      where: { action: "desktop_tool_requested", targetId: tool.id },
      select: { result: true, actorId: true, metadataJson: true },
    });
    assert.deepEqual(audits, [{
      result: "success", actorId: ownerId,
      metadataJson: { operation: "web.search", conversation_id: conversationId, turn_id: turnId, device_id: deviceId },
    }]);
    const knowledgeScope = {
      type: "tool.request", ...callbackScope, run_token: tool.run_token,
      expires_at: new Date(Date.now() + desktopToolLifetimeFor("knowledge.search")).toISOString(),
    } as const;
    const retrieved = await invokeTool({
      ...knowledgeScope, id: randomUUID(), operation: "knowledge.search",
      body: { query: "fixture reference", final_top_k: 5, candidate_multiplier: 3, min_score: 0.2 },
    });
    assert(retrieved.ok && retrieved.operation === "knowledge.search");
    assert.deepEqual(retrieved.data.results.map(result => result.content), [knowledge.owned.content]);
    assert.equal(retrieved.data.unavailable_knowledge_base_count, 1);
    const documents = await invokeTool({ ...knowledgeScope, id: randomUUID(), operation: "knowledge.documents", body: {} });
    assert(documents.ok && documents.operation === "knowledge.documents");
    assert.deepEqual(documents.data.documents.map(doc => doc.document_name), [knowledge.owned.document.displayName]);
    const documentRef = documents.data.documents[0]!.document_ref;
    const markdown = await invokeTool({
      ...knowledgeScope, id: randomUUID(), operation: "knowledge.markdown", body: { document_ref: documentRef },
    });
    assert(markdown.ok && markdown.operation === "knowledge.markdown" && markdown.data.markdown === knowledge.owned.content);
    const deniedDoc = await invokeTool({
      ...knowledgeScope, id: randomUUID(), operation: "knowledge.markdown", body: { document_ref: documentRef },
      conversation_id: randomUUID(),
    });
    assert(!deniedDoc.ok && deniedDoc.error_code === "FORBIDDEN");
    await verifyDesktopKnowledgePublication(prisma, {
      ownerId, deviceId, connectionId: initial.connectionId, conversationId, turnId, runtimeGeneration,
    }, knowledge.foreign);
    const connectorRequest = {
      ...tool, operation: "connection.execute", id: randomUUID(),
      expires_at: new Date(Date.now() + desktopToolLifetimeFor("connection.execute")).toISOString(),
      body: { input: { operation: "list_connections" } },
    } as const satisfies DesktopToolRequest;
    const accounts = await invokeTool(connectorRequest);
    assert(accounts.ok && accounts.operation === "connection.execute" && accounts.data.kind === "connections");
    assert.deepEqual(accounts.data.items.filter(account => account.status === "connected").map(account => account.provider), ["onedrive", "google_docs"]);
    assert(!JSON.stringify(accounts).includes(connector.foreignAccount));
    const browserRequest = {
      ...tool, id: randomUUID(), operation: "browser.execute",
      expires_at: new Date(Date.now() + desktopToolLifetimeFor("browser.execute")).toISOString(),
      body: { action: "screenshot", tab_id: browserFixture.tabId },
    } as const satisfies DesktopToolRequest;
    const wrongBrowser = await invokeTool({ ...browserRequest, turn_id: randomUUID() });
    assert(!wrongBrowser.ok && wrongBrowser.error_code === "FORBIDDEN");
    const browserReply = await invokeTool(browserRequest);
    assert(browserReply.ok && browserReply.operation === "browser.execute" && browserReply.data.screenshot_id);
    assert(!JSON.stringify(browserReply).includes(browserFixture.image.toString("base64")), "screenshot bytes in device frame");
    assert.equal((await invokeTool(browserRequest)).ok, false);
    assert.equal((await browserFixture.readImage(turnId, browserReply.data.screenshot_id, start.body.credentials.primary.token)).ok, false);
    assert.equal((await browserFixture.readImage(randomUUID(), browserReply.data.screenshot_id, tool.run_token)).ok, false);
    const screenshot = await browserFixture.readImage(turnId, browserReply.data.screenshot_id, tool.run_token);
    assert(screenshot.ok);
    assert.equal(screenshot.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await screenshot.arrayBuffer()), browserFixture.image);
    assert.equal((await browserFixture.readImage(turnId, browserReply.data.screenshot_id, tool.run_token)).ok, false);
    const scroll = { ...browserRequest, id: randomUUID(), body: {
      action: "scroll", tab_id: browserFixture.tabId, x: 10, y: 10, delta_x: 0, delta_y: 100,
    } } as const satisfies DesktopToolRequest;
    send(initial.socket, scroll);
    for (let retry = 0; !browserFixture.observed.includes("scroll") && retry < 150; retry++) await delay(10);
    assert(browserFixture.observed.includes("scroll"), "the accepted command reached the extension");
    send(initial.socket, { type: "tool.cancel", ...callbackScope, id: scroll.id, operation: scroll.operation });
    for (let retry = 0; !browserFixture.cancelled.length && retry < 150; retry++) await delay(10);
    assert.equal(browserFixture.cancelled.length, 1);
    assert.equal((await invokeTool(scroll)).ok, false);
    assert.deepEqual(browserFixture.observed, ["screenshot", "scroll"]);
    const foreignConnector = await invokeTool({
      ...connectorRequest, id: randomUUID(), turn_id: randomUUID(),
      body: { input: { operation: "list_drives", provider: "onedrive" } },
    });
    assert(!foreignConnector.ok && foreignConnector.error_code === "FORBIDDEN");
    assert.equal(connector.stats.graph, 0);
    const pendingConnector = {
      ...connectorRequest, id: randomUUID(),
      body: { input: { operation: "search_documents", provider: "google_docs", query: "fixture pending connector" } },
    } as const satisfies DesktopToolRequest;
    send(initial.socket, pendingConnector);
    for (let retry = 0; connector.stats.started !== 1 && retry < 100; retry++) await delay(10);
    assert.equal(connector.stats.started, 1);
    send(initial.socket, {
      type: "tool.cancel", ...callbackScope, id: pendingConnector.id, operation: pendingConnector.operation,
    });
    for (let retry = 0; connector.stats.aborted !== 1 && retry < 100; retry++) await delay(10);
    assert.equal(connector.stats.aborted, 1);
    const duplicateConnector = await invokeTool({ ...pendingConnector, id: pendingConnector.id.toUpperCase() });
    assert(!duplicateConnector.ok && duplicateConnector.error_code === "RUNNER_OPERATION_UNCERTAIN");
    assert.equal(connector.stats.workspace, 1);
    const pendingTool = { ...tool, id: randomUUID(), body: { query: "fixture pending search" } };
    const searches = [pendingTool, ...Array.from({ length: desktopToolMaxInFlight - 1 }, () =>
      ({ ...pendingTool, id: randomUUID() }))];
    const expectedSearchCalls = searchCalls.length + searches.length;
    for (const request of searches) send(initial.socket, request);
    for (let retry = 0; searchCalls.length < expectedSearchCalls && retry < 100; retry++) await delay(10);
    assert.equal(searchCalls.length, expectedSearchCalls);
    const full = await invokeTool({ ...tool, id: randomUUID() });
    assert(!full.ok && full.error_code === "RUNNER_UNAVAILABLE");

    const answer = {
      deliveryId: randomUUID(),
      event: {
        method: "item/completed", visibility: "user_visible",
        params: {
          threadId, turnId: nativeTurnId,
          item: { id: randomUUID(), type: "agentMessage", phase: "final_answer", text: "Mac output was projected." },
        },
      },
    } satisfies EventDelivery;
    const terminal = {
      deliveryId: randomUUID(),
      event: {
        method: "turn/completed", visibility: "user_visible",
        params: { threadId, turn: { id: nativeTurnId, status: "completed" } },
      },
    } satisfies EventDelivery;
    const sendLive = (socket: WebSocket, entries: EventDelivery[], scope = callbackScope) => sendEvents(socket, {
      type: "execution.callback", operation: "events", id: randomUUID(), ...scope,
      run_token: start.body.credentials.run_token, body: { conversationId, events: entries },
    });
    const foreignNativeTurn = { ...answer, event: { ...answer.event, params: { ...answer.event.params, turnId: randomUUID() } } };
    for (const response of [
      await sendLive(initial.socket, [answer], { ...callbackScope, turn_id: randomUUID() }),
      await sendLive(initial.socket, [answer], { ...callbackScope, runtime_generation: randomUUID() }),
      await sendLive(initial.socket, [foreignNativeTurn]),
    ]) assert(!response.ok && response.error_code === "FORBIDDEN");
    const history = () => events.historyPage(ownerId, conversationId, { afterSequence: 0n, limit: 50 });
    assert.deepEqual((await history()).items, []);
    assertAccepted(await sendLive(initial.socket, [answer]), [answer.deliveryId]);
    for (const request of searches) {
      send(initial.socket, { type: "tool.cancel", ...callbackScope, id: request.id, operation: tool.operation });
    }
    for (let retry = 0; searchAborts < searches.length && retry < 100; retry++) await delay(10);
    assert.equal(searchAborts, searches.length);
    const unsupportedGoal = {
      deliveryId: randomUUID(),
      event: {
        method: "thread/goal/updated", visibility: "user_visible",
        params: {
          threadId, turnId: nativeTurnId, goal: {
            threadId, objective: "Not a supported task mode", status: "active",
            tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
          },
        },
      },
    } satisfies EventDelivery;
    assertAccepted(await sendLive(initial.socket, [unsupportedGoal]), [unsupportedGoal.deliveryId]);
    assert.equal(await prisma.conversationGoal.count({ where: { conversationId } }), 0);

    const websiteEntry = Buffer.from('<!doctype html><link rel="stylesheet" href="./style.css"><h1>Report</h1>');
    const websiteArchive = await new JSZip()
      .file("index.html", websiteEntry).file("style.css", "h1{color:blue}").generateAsync({ type: "nodebuffer" });
    for (const { action, website } of [
      { action: "stop", website: false }, { action: "revoke", website: false },
      { action: "stop", website: true }, { action: "revoke", website: true },
    ] as const) {
      const artifactContents = website ? websiteArchive : Buffer.from("The Mac artifact fence test.\n");
      const operation = website ? "artifact.website" : "artifact.prepare";
      const nativeThread = randomUUID();
      const task = await prisma.conversation.create({ data: {
        ownerId, executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: nativeThread,
        runtimeGeneration: randomUUID(), workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
        title: `Mac artifact ${action}`, titleSource: "manual", archiveStatus: "active",
      } });
      const projectionTurnId = randomUUID();
      const nativeArtifactTurnId = randomUUID();
      await prisma.conversationTurnStartIntent.create({ data: {
        projectionTurnId, ownerId, conversationId: task.id, runtimeGeneration: task.runtimeGeneration,
        capabilityGeneration, inputText: "Publish the fixture file", capabilitiesJson: [], attachmentsJson: [],
        submitMode: "normal", runnerStatus: "prepared",
      } });
      const { run_token: runToken } = await leases.issue({ deviceId, connectionId: initial.connectionId }, {
        ownerId, conversationId: task.id, projectionTurnId, expectedRuntimeGeneration: task.runtimeGeneration,
        model: "fixture-model",
        modelProvider: {
          revision: 1, protocolMode: "native_responses", baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(),
        },
      });
      const artifactRequest = (): DesktopToolRequest => {
        const base = {
          type: "tool.request", id: randomUUID(), conversation_id: task.id, turn_id: projectionTurnId,
          runtime_generation: task.runtimeGeneration, run_token: runToken,
          expires_at: new Date(Date.now() + desktopToolLifetimeFor(operation)).toISOString(),
        } as const;
        const integrity = { size_bytes: artifactContents.length, sha256: sha256(artifactContents) };
        return website
          ? { ...base, operation: "artifact.website", body: { ...integrity, filename: "website.zip", display_name: "Report.html", entry_path: "index.html" } }
          : { ...base, operation: "artifact.prepare", body: { ...integrity, filename: "report.txt", display_name: "Report.txt" } };
      };
      const early = await invokeTool(artifactRequest());
      assert(!early.ok && early.error_code === "FORBIDDEN", "artifact writes require a projected running turn");
      await prisma.$transaction([
        prisma.conversationTurnStartIntent.delete({ where: { projectionTurnId } }),
        prisma.conversationTurn.create({ data: {
          id: projectionTurnId, conversationId: task.id, submittedBy: ownerId, codexThreadId: nativeThread,
          codexTurnId: nativeArtifactTurnId, sequenceNo: 1, status: "running", startedAt: new Date(),
          submitMode: "normal", capabilityGeneration, capabilitiesJson: [],
        } }),
      ]);
      const filePath = "$WORKSPACE/artifacts/report.txt";
      const activityId = randomUUID();
      const showLink = action === "stop" && !website;
      const artifactDetail = () => conversations.get(ownerId, task.id);
      const artifactHistory = () => events.historyPage(ownerId, task.id, { afterSequence: 0n, limit: 20 });
      if (showLink) {
        const entry = {
          deliveryId: randomUUID(),
          event: {
            method: "item/completed", visibility: "user_visible",
            params: {
              threadId: nativeThread, turnId: nativeArtifactTurnId,
              item: { id: activityId, type: "fileChange", status: "completed", changes: [{ path: filePath, kind: { type: "add" } }] },
            },
          },
        } satisfies EventDelivery;
        assertAccepted(await sendEvents(initial.socket, {
          type: "execution.callback", id: randomUUID(), operation: "events",
          conversation_id: task.id, turn_id: projectionTurnId, runtime_generation: task.runtimeGeneration,
          run_token: runToken, body: { conversationId: task.id, events: [entry] },
        }), [entry.deliveryId]);
        assert.deepEqual((await artifactDetail()).files, []);
      }
      const prepare = async () => {
        const result = await invokeTool(artifactRequest());
        assert(result.ok && result.operation === operation);
        const id = result.data.artifact_id;
        const endpoint = `${address}${desktopArtifactPath}/${projectionTurnId}/${id}`;
        const headers = { authorization: `Bearer ${runToken}` };
        const upload = await fetch(`${endpoint}/upload`, {
          method: "PUT", headers: { ...headers, "content-type": "application/octet-stream" },
          body: new Uint8Array(artifactContents), signal: AbortSignal.timeout(5_000),
        });
        assert.equal(upload.status, 204);
        return { id, confirm: (digest?: string) => fetch(`${endpoint}/confirm`, {
          method: "POST",
          headers: { ...headers, ...(digest && { [desktopArtifactPathDigestHeader]: digest }) },
          signal: AbortSignal.timeout(5_000),
        }) };
      };
      const committed = action === "stop" ? await prepare() : undefined;
      if (committed) {
        const confirm = async () => {
          const response = await committed.confirm(showLink
            ? sha256(desktopArtifactPathDigestInput(projectionTurnId, activityId, filePath))
            : undefined);
          assert.equal(response.status, 200);
          return desktopArtifactReceiptSchema.parse(await response.json());
        };
        assert.deepEqual(await confirm(), await confirm(), "repeated confirmation must return the same receipt");
        assert.equal(await prisma.conversationEvent.count({ where: {
          conversationId: task.id, eventType: "conversation.artifact.created",
        } }), 1);
        if (showLink) {
          const detail = await artifactDetail();
          const history = await artifactHistory();
          const file = detail.files.find(candidate => candidate.id === committed.id);
          const completed = history.items.find(event => event.event_type === "item/completed");
          assert(completed?.payload.params.item.type === "fileChange");
          assert.deepEqual(file?.desktop_file_change, { event_id: completed.sse_event_id, change_index: 0 });
          assert.equal(completed.payload.params.item.changes[0]?.path, filePath);
          assert.deepEqual(detail.events.find(event => event.id === completed.id), completed);
          assert.deepEqual(await buffer((await files.readArtifactDownload(ownerId, task.id, committed.id, {})).data), artifactContents);
          await assert.rejects(conversations.get(input.otherOwnerId, task.id), { code: "CONVERSATION_NOT_FOUND" });
        }
      }
      const pending = await prepare();
      let entered = () => {};
      const arrived = new Promise<void>(resolve => { entered = resolve; });
      let release = () => {};
      const readyToCommit = new Promise<void>(resolve => { release = resolve; });
      beforeArtifactRegistration = async () => {
        entered();
        await readyToCommit;
      };
      const confirmation = pending.confirm();
      void confirmation.catch(() => undefined);
      // Keep the native Stop acknowledgement pending until the confirmation has lost the fence.
      try {
        await Promise.race([arrived, confirmation.then(response => {
          throw new Error(`Artifact confirmation ended before the commit gate: ${response.status}`);
        })]);
        if (action === "stop") {
          const nativeInterrupt = readCommand(initial.socket);
          const stop = conversations.interrupt(ownerId, task.id, projectionTurnId, {});
          void stop.catch(() => undefined);
          const command = await nativeInterrupt;
          assert.equal(command.operation, "turn.interrupt");
          assert.equal(command.turn_id, projectionTurnId);
          release();
          const response = await confirmation;
          assert.equal(response.status, 403);
          await response.body?.cancel();
          send(initial.socket, {
            type: "command.result", id: command.id, operation: "turn.interrupt", ok: true,
            result: { code: RUNNER_TURN_INTERRUPT_REQUESTED },
          });
          assert.equal((await stop).code, RUNNER_TURN_INTERRUPT_REQUESTED);
        } else {
          await leases.revoke(projectionTurnId);
          release();
          const response = await confirmation;
          assert.equal(response.status, 401);
          await response.body?.cancel();
        }
      } finally {
        beforeArtifactRegistration = undefined;
        release();
        await confirmation.catch(() => undefined);
      }
      assert.equal(await prisma.conversationFile.count({ where: { id: pending.id } }), 0);
      assert.equal(await prisma.webArtifactBundle.count({ where: { fileId: pending.id } }), 0);
      assert.equal(await prisma.conversationEvent.count({ where: {
        conversationId: task.id, eventType: "conversation.artifact.created",
      } }), committed ? 1 : 0);
      const cleanup = async (id: string) => {
        const job = await maintenance.getJob(`desktop-artifact-${id}`);
        assert(job && (job.opts.delay ?? 0) > 0, "cleanup must be durable and delayed beyond the grant lifetime");
        await jobs["process"](job, { cleanupInvalidTokens: outsideFixture });
        await job.remove();
        await assert.rejects(storage.getObjectSize(desktopArtifactStagingKey(id)));
      };
      // Advance the fixtures to the state where the delayed maintenance jobs would run.
      await leases.revoke(projectionTurnId);
      const interruptedAt = new Date();
      await prisma.conversationTurn.update({
        where: { id: projectionTurnId },
        data: { status: "interrupted", interruptedAt, interruptRequestedAt: interruptedAt },
      });
      await conversations.delete(ownerId, task.id, {});
      if (minio) {
        const staleKey = desktopArtifactStagingKey(pending.id);
        const firstUpload = await minio.storage.client.initiateNewMultipartUpload(minio.bucket, staleKey, {});
        const secondUpload = await minio.storage.client.initiateNewMultipartUpload(minio.bucket, staleKey, {});
        assert.notEqual(firstUpload, secondUpload);
        const neighbor = `${staleKey}/other`;
        const neighborUpload = await minio.storage.client.initiateNewMultipartUpload(minio.bucket, neighbor, {});
        await cleanup(pending.id);
        assert.equal(await minio.storage.client.findUploadId(minio.bucket, staleKey), undefined);
        assert.equal(await minio.storage.client.findUploadId(minio.bucket, neighbor), neighborUpload);
        await minio.storage.client.abortMultipartUpload(minio.bucket, neighbor, neighborUpload);
      } else {
        await cleanup(pending.id);
      }
      await assert.rejects(storage.getObjectSize(desktopArtifactObjectKey(task.id, pending.id)));
      if (website) {
        const job = await maintenance.getJob(`desktop-website-${pending.id}`);
        assert(job?.data.type === "desktop-website-cleanup");
        for (const path of job.data.paths) assert((await storage.getObjectSize(webBundleObjectKey(pending.id, path))) > 0);
        await jobs["process"](job, { cleanupInvalidTokens: outsideFixture });
        await job.remove();
        for (const path of job.data.paths) await assert.rejects(storage.getObjectSize(webBundleObjectKey(pending.id, path)));
      }
      if (committed) {
        const retained = await prisma.retainedArtifact.findUniqueOrThrow({ where: { originalFileId: committed.id } });
        await cleanup(committed.id);
        assert.deepEqual(await buffer(await storage.getObjectStream(retained.minioObjectKey)), website ? websiteEntry : artifactContents);
        if (website) {
          const job = await maintenance.getJob(`desktop-website-${committed.id}`);
          assert(job?.data.type === "desktop-website-cleanup");
          await jobs["process"](job, { cleanupInvalidTokens: outsideFixture });
          await job.remove();
          for (const path of job.data.paths) assert((await storage.getObjectSize(webBundleObjectKey(committed.id, path))) > 0);
        }
      }
    }

    await redis.recordRunnerHeartbeat(ownerId);
    const exit = {
      type: "execution.callback", id: randomUUID(), operation: "turn.exited", ...callbackScope,
      run_token: start.body.credentials.run_token,
    } satisfies DesktopExecutionCallback;
    const wrongExit = desktopExecutionAckSchema.parse(await exchange(initial.socket, { ...exit, turn_id: randomUUID() }));
    assert(!wrongExit.ok && wrongExit.error_code === "FORBIDDEN");
    assert.deepEqual(desktopExecutionAckSchema.parse(await exchange(initial.socket, exit)), {
      type: "execution.ack", ok: true, operation: "turn.exited", id: exit.id,
    });
    const exitJobs = await queue.getJobs(["waiting"]);
    assert.equal(exitJobs.length, 1);
    const [exitJob] = exitJobs;
    assert(exitJob && exitJob.data.type === "desktop-turn");
    assert.equal(exitJob.data.connectionId, initial.connectionId);
    await Promise.all([
      assert.rejects(recovery.process(exitJob), { message: "RUNNING_TURN_RECOVERY_FAILED" }),
      readCommand(initial.socket).then(command => {
        commandScope(command);
        assert.equal(command.operation, "turn.drain");
        send(initial.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: false,
          error_code: "RUNNER_OPERATION_UNCERTAIN",
        });
      }),
    ]);
    await exitJob.remove();

    const [expiryJob] = await queue.getJobs(["delayed"]);
    assert(expiryJob && expiryJob.data.type === "desktop-turn");
    assert.equal(expiryJob.data.projectionTurnId, turnId);
    assert.equal(expiryJob.data.connectionId, initial.connectionId);
    assert((expiryJob.opts.delay ?? 0) > 0);
    // Accelerate Redis expiry; neither the Mac nor its cloud runner disconnects.
    const leaseKey = `linksense:desktop-run:${turnId}`;
    const revokingTool = {
      ...pendingTool, id: randomUUID(),
      expires_at: new Date(Date.now() + desktopToolRequestLifetimeMs).toISOString(),
    };
    send(initial.socket, revokingTool);
    for (let retry = 0; searchCalls.length <= expectedSearchCalls && retry < 100; retry++) await delay(10);
    assert.equal(searchCalls.length, expectedSearchCalls + 1);
    assert.equal(await redis.client.pexpire(leaseKey, 1), 1);
    const expiryDeadline = Date.now() + 1_000;
    while (await redis.client.exists(leaseKey)) {
      assert(Date.now() < expiryDeadline, "fixture lease did not expire");
      await delay(10);
    }
    await redis.client.publish(desktopNoticeChannel, JSON.stringify({ type: "run_revoked", turnId } satisfies DesktopNotice));
    for (let retry = 0; searchAborts <= searches.length && retry < 100; retry++) await delay(10);
    assert.equal(searchAborts, searches.length + 1);
    const expiredAck = await sendLive(initial.socket, [terminal]);
    assert(!expiredAck.ok && expiredAck.error_code === "FORBIDDEN");
    await Promise.all([
      assert.rejects(recovery.process(expiryJob), { message: "RUNNING_TURN_RECOVERY_FAILED" }),
      readCommand(initial.socket).then(async command => {
        commandScope(command);
        assert.equal(command.operation, "turn.drain");
        const ack = await sendEvents(initial.socket, {
          type: "execution.recovery", operation: "events", id: randomUUID(), drain_id: command.id,
          ...callbackScope, body: { conversationId, events: [answer] },
        });
        assertAccepted(ack, [answer.deliveryId]);
        send(initial.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: false,
          error_code: "RUNNER_OPERATION_UNCERTAIN",
        });
      }),
    ]);
    await expiryJob.remove();

    const replacement = await connect(true, true);
    assert.notEqual(replacement.connectionId, initial.connectionId);
    const stale = await sendLive(replacement.socket, [terminal]);
    assert(!stale.ok && stale.error_code === "FORBIDDEN", "Reconnect must not adopt the prior connection's lease");
    const [recovered] = await Promise.all([
      events.reconcileAfterProcessExit(
        { conversationId, projectionTurnId: turnId, capabilityGeneration },
        { desktopConnectionId: replacement.connectionId },
      ),
      readCommand(replacement.socket).then(async command => {
        commandScope(command);
        assert.equal(command.operation, "turn.drain");
        const replay = (entries: EventDelivery[]) => sendEvents(replacement.socket, {
          type: "execution.recovery", operation: "events", id: randomUUID(), drain_id: command.id,
          ...callbackScope, body: { conversationId, events: entries },
        });
        const ids = [answer.deliveryId, terminal.deliveryId];
        assertAccepted(await replay([answer, terminal]), ids);
        assertAccepted(await replay([answer, terminal]), ids);
        const duplicateNativeTerminal = { ...terminal, deliveryId: randomUUID() };
        assertAccepted(await replay([duplicateNativeTerminal]), [duplicateNativeTerminal.deliveryId]);
        send(replacement.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: true,
          result: { drained: true },
        });
      }),
    ]);
    assert.equal(recovered.outcome, "succeeded");
    assert.equal(await redis.hasTurnSlot(conversationId, turnId, ownerId), false);
    const turn = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    assert.equal(turn.status, "completed");
    const projected = (await history()).items.filter(item =>
      item.event_type === "item/completed" || item.event_type === "turn/completed",
    );
    assert.deepEqual(projected.map(({ id, turn_id }) => [id, turn_id]), [
      [answer.deliveryId, turnId], [terminal.deliveryId, turnId],
    ]);
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId, turnId, role: "assistant" } }), 1);
    assert.equal((await redis.acquireTurnSlot(conversationId, turnId, ownerId)).acquired, true);
    const reconnect = replacement.recoveryJob;
    assert(reconnect && reconnect.data.type === "desktop");
    await recovery.process(reconnect);
    const release = (await queue.getJobs(["waiting"])).find(job =>
      job.data.type === "desktop-turn" && job.data.projectionTurnId === turnId,
    );
    assert(release, "reconnect must discover a terminal turn with a surviving slot");
    await recovery.process(release);
    assert.equal(await redis.hasTurnSlot(conversationId, turnId, ownerId), false);

    // A local Stop with an uncertain transport result is the ambiguity the
    // platform actually observes: the command may have crossed the transport,
    // but no native interruption is proven. The running turn and its slot must
    // survive, and the same native turn's later completed terminal must remain
    // authoritative.
    const uncertainStopThread = randomUUID();
    const uncertainStopNativeTurn = randomUUID();
    const uncertainStopTurnId = randomUUID();
    const uncertainStopConversation = await prisma.conversation.create({ data: {
      ownerId, title: "Uncertain Stop projection", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${ownerId}/home/workspaces/${randomUUID()}`, runtimeGeneration: randomUUID(),
      executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: uncertainStopThread,
    } });
    await prisma.conversationTurnStartIntent.create({ data: {
      projectionTurnId: uncertainStopTurnId, ownerId, conversationId: uncertainStopConversation.id,
      runtimeGeneration: uncertainStopConversation.runtimeGeneration, capabilityGeneration,
      inputText: "Uncertain local Stop", capabilitiesJson: [], attachmentsJson: [],
      submitMode: "normal", runnerStatus: "prepared",
    } });
    const uncertainStopCredentials = await leases.issue(
      { deviceId, connectionId: replacement.connectionId },
      {
        ownerId, conversationId: uncertainStopConversation.id, projectionTurnId: uncertainStopTurnId,
        expectedRuntimeGeneration: uncertainStopConversation.runtimeGeneration,
        model: "fixture-model",
        modelProvider: { revision: 1, baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(), protocolMode: "native_responses" },
      },
    );
    await prisma.$transaction([
      prisma.conversationTurnStartIntent.delete({ where: { projectionTurnId: uncertainStopTurnId } }),
      prisma.conversationTurn.create({ data: {
        id: uncertainStopTurnId, conversationId: uncertainStopConversation.id, submittedBy: ownerId,
        codexThreadId: uncertainStopThread, codexTurnId: uncertainStopNativeTurn, sequenceNo: 1,
        status: "running", submitMode: "normal", capabilityGeneration, capabilitiesJson: [], startedAt: new Date(),
      } }),
    ]);
    assert.equal((await redis.acquireTurnSlot(uncertainStopConversation.id, uncertainStopTurnId, ownerId)).acquired, true);
    const originalReleaseTurnSlot = redis.releaseTurnSlot;
    let uncertainStopReleases = 0;
    redis.releaseTurnSlot = async (...args: Parameters<typeof originalReleaseTurnSlot>) => {
      const [releasedConversationId, releasedTurnId] = args;
      if (releasedConversationId === uncertainStopConversation.id && releasedTurnId === uncertainStopTurnId) {
        uncertainStopReleases += 1;
      }
      await originalReleaseTurnSlot.apply(redis, args);
    };
    try {
      const nativeStop = readCommand(replacement.socket);
      const stop = conversations.interrupt(ownerId, uncertainStopConversation.id, uncertainStopTurnId, {});
      const stopCommand = await nativeStop;
      assert.equal(stopCommand.operation, "turn.interrupt");
      assert.equal(stopCommand.turn_id, uncertainStopTurnId);
      assert.equal(stopCommand.conversation_id, uncertainStopConversation.id);
      assert.equal(stopCommand.owner_id, ownerId);
      assert.equal(stopCommand.runtime_generation, uncertainStopConversation.runtimeGeneration);
      // The fixture returns the explicit transport uncertainty reply before
      // any native Stop is proven. It does not discard the socket or simulate
      // a response lost after crossing the transport. The platform observes
      // only an ambiguous command, so it must not invent an interruption or a
      // successful Stop audit.
      send(replacement.socket, {
        type: "command.result", id: stopCommand.id, operation: stopCommand.operation,
        ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
      await assert.rejects(stop, { code: "RUNNER_OPERATION_UNCERTAIN" });
      const heldTurn = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: uncertainStopTurnId } });
      assert.equal(heldTurn.status, "running");
      assert.equal(heldTurn.interruptRequestedAt, null);
      assert.equal(heldTurn.interruptedAt, null);
      assert.equal(await redis.hasTurnSlot(uncertainStopConversation.id, uncertainStopTurnId, ownerId), true);
      assert.equal(await prisma.auditLog.count({
        where: { action: "conversation_turn_interrupt_requested", targetType: "conversation_turn", targetId: uncertainStopTurnId },
      }), 0);
      assert.equal(await prisma.conversationEvent.count({ where: { conversationId: uncertainStopConversation.id } }), 0);

      const completed = {
        deliveryId: randomUUID(),
        event: {
          method: "turn/completed", visibility: "user_visible",
          params: { threadId: uncertainStopThread, turn: { id: uncertainStopNativeTurn, status: "completed" } },
        },
      } satisfies EventDelivery;
      assertAccepted(await sendEvents(replacement.socket, {
        type: "execution.callback", id: randomUUID(), operation: "events",
        conversation_id: uncertainStopConversation.id, turn_id: uncertainStopTurnId,
        runtime_generation: uncertainStopConversation.runtimeGeneration,
        run_token: uncertainStopCredentials.run_token,
        body: { conversationId: uncertainStopConversation.id, events: [completed] },
      }), [completed.deliveryId]);
      const settledTurn = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: uncertainStopTurnId } });
      assert.equal(settledTurn.status, "completed");
      assert.equal(settledTurn.interruptRequestedAt, null);
      assert.equal(settledTurn.interruptedAt, null);
      assert.equal(await prisma.conversationEvent.count({
        where: { conversationId: uncertainStopConversation.id, turnId: uncertainStopTurnId, eventType: "turn/completed" },
      }), 1);
      assert.equal(await prisma.auditLog.count({
        where: { action: "conversation_turn_completed", targetType: "conversation_turn", targetId: uncertainStopTurnId, result: "success" },
      }), 1);
      assert.equal(await prisma.auditLog.count({
        where: { action: "conversation_turn_interrupted", targetType: "conversation_turn", targetId: uncertainStopTurnId },
      }), 0);
      assert.equal(await prisma.conversationTurn.count({ where: { conversationId: uncertainStopConversation.id } }), 1);
      assert.equal(await redis.hasTurnSlot(uncertainStopConversation.id, uncertainStopTurnId, ownerId), false);
      assert.equal(uncertainStopReleases, 1, "the naturally completed turn must release its slot exactly once");
    } finally {
      redis.releaseTurnSlot = originalReleaseTurnSlot;
    }

    const legacyProbe = await prisma.conversation.create({ data: {
      ownerId, title: "Legacy Mac knowledge compatibility", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null), runtimeGeneration: randomUUID(),
      executionTarget: "local", desktopDeviceId: deviceId,
    } });
    const probeId = randomUUID();
    await prisma.conversationTurnStartIntent.create({ data: {
      projectionTurnId: probeId, ownerId, conversationId: legacyProbe.id,
      runtimeGeneration: legacyProbe.runtimeGeneration, capabilityGeneration,
      inputText: "Check the old desktop capability", capabilitiesJson: [], attachmentsJson: [],
      submitMode: "normal", runnerStatus: "prepared",
    } });
    const legacyInput = {
      ownerId, conversationId: legacyProbe.id, projectionTurnId: probeId, expectedRuntimeGeneration: legacyProbe.runtimeGeneration,
      appServerProcessLimit: 1, capabilityGeneration, mcpGeneration: capabilityGeneration,
      collaborationMode: "default", mcpServers: [], capabilities: [], environment: {},
      context: {
        userInput: "Check the old desktop capability", attachments: [], prioritySkills: [], priorityPlugins: [],
        selectedKnowledgeBases: [],
      },
      model: "fixture-model", reasoningEffort: "low",
      modelProvider: { revision: 1, baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(), protocolMode: "native_responses" },
    } satisfies RunnerStartInput;
    await assert.rejects(runner.acceptStartTurn({
      ...legacyInput,
      context: { ...legacyInput.context, selectedKnowledgeBases: [{ id: knowledge.owned.base.id, name: knowledge.owned.base.name }] },
    }), { code: "RUNNER_UNAVAILABLE" });
    assert((await redis.acquireTurnSlot(legacyProbe.id, probeId, ownerId)).acquired);
    const probeStartedAt = new Date().toISOString();
    const probeReceipt = {
      conversationId: legacyProbe.id, projectionTurnId: probeId, createdAt: probeStartedAt, updatedAt: probeStartedAt,
    };
    const [accepted, legacyStart] = await Promise.all([
      runner.acceptStartTurn(legacyInput),
      readCommand(replacement.socket).then(command => {
        assert(command.operation === "turn.start");
        send(replacement.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: true,
          result: { ...probeReceipt, status: "starting" },
        });
        return command;
      }),
    ]);
    assert.equal(accepted.status, "starting");
    assert.equal(legacyStart.conversation_id, legacyProbe.id);
    assert.equal(legacyStart.turn_id, probeId);
    assert.deepEqual(Object.keys(legacyStart.body).sort(), ["credentials", "input", "native_thread_id", "reasoning_effort"]);
    const legacyScope = {
      conversation_id: legacyProbe.id, runtime_generation: legacyProbe.runtimeGeneration, turn_id: probeId,
      run_token: legacyStart.body.credentials.run_token,
    };
    const legacyInspect = desktopExecutionCommandSchema.parse(await exchange(replacement.socket, {
      type: "execution.callback", id: randomUUID(), operation: "start.settled", ...legacyScope,
      body: { conversationId: legacyProbe.id, projectionTurnId: probeId, runtimeGeneration: legacyProbe.runtimeGeneration },
    } satisfies DesktopExecutionCallback));
    assert.equal(legacyInspect.operation, "turn.inspect");
    const legacyThreadId = randomUUID(), legacyNativeTurnId = randomUUID();
    const legacySettlement = desktopExecutionAckSchema.parse(await exchange(replacement.socket, {
      type: "command.result", id: legacyInspect.id, operation: legacyInspect.operation, ok: true,
      result: { ...probeReceipt, status: "succeeded", result: { codexThreadId: legacyThreadId, codexTurnId: legacyNativeTurnId } },
    }));
    assert(legacySettlement.ok && legacySettlement.operation === "start.settled" && legacySettlement.data.settled);
    const legacyTool = {
      type: "tool.request", id: randomUUID(), operation: "web.search", ...legacyScope,
      expires_at: new Date(Date.now() + 62_000).toISOString(),
      body: { query: "legacy fixture search" },
    } satisfies DesktopToolRequest;
    assert.deepEqual(await exchange(replacement.socket, legacyTool), {
      type: "tool.result", id: legacyTool.id, operation: "web.search", ok: true,
      data: { success: true, provider: "brave", query: legacyTool.body.query, results: [searchResult] },
    });
    assert.equal(searchCalls.at(-1), legacyTool.body.query);
    const legacyTerminal = {
      deliveryId: randomUUID(),
      event: {
        ...terminal.event, params: { threadId: legacyThreadId, turn: { id: legacyNativeTurnId, status: "completed" } },
      },
    } satisfies EventDelivery;
    assertAccepted(await sendEvents(replacement.socket, {
      type: "execution.callback", id: randomUUID(), operation: "events", ...legacyScope,
      body: { conversationId: legacyProbe.id, events: [legacyTerminal] },
    }), [legacyTerminal.deliveryId]);
    assert.equal(await redis.hasTurnSlot(legacyProbe.id, probeId, ownerId), false);
    for (const job of await queue.getJobs(["delayed"])) {
      if (job.data.type === "desktop-turn" && job.data.projectionTurnId === probeId) await job.remove();
    }
    await conversations.delete(ownerId, legacyProbe.id, {});

    if (runtimeRoot) {
      replacement.socket.terminate();
      const websiteStore = new WebSiteRepository(prisma);
      const artifact = await verifyPackagedDesktopGateway({
        runtimeRoot, scratch: input.workspaceRoot, address, attachmentTransfer, prisma, redis, coordinator, conversations,
        events, files, modelProviderSettings, ownerId, deviceId, token, previousConnectionId: replacement.connectionId,
        websites: new WebSiteService(websiteStore, storage),
        htmlPreviews: new HtmlPreviewService(new WebArtifactResources(websiteStore, storage),
          new RedisHtmlPreviewSessionStore(redis), async id => Boolean(await prisma.user.count({ where: { id, status: "active" } }))),
        otherOwnerId: input.otherOwnerId,
        attachmentSizeBytes: config.upload.maxFileSizeBytes,
        multipartWebsite: minio !== null,
        ...(minio && { artifactSizeBytes: 100 * 1024 ** 2 + 11 }),
        revokeAttachmentRun: turnId => leases.revoke(turnId),
        disconnectAttachmentSocket: async connectionId => {
          assert.equal((await coordinator.executionConnection(deviceId))?.connectionId, connectionId);
          assert.equal(attachmentSockets.size, 1);
          for (const socket of attachmentSockets) socket.destroy();
        },
        serverSecrets: [config.credentialMasterKey, config.runnerSharedSecret, searchKey, browserFixture.token, ...connector.secrets],
        searchMarker,
        connector,
        browser: browserFixture,
        ...(joinBrowserExtension && {
          attachBrowserExtension: async () => {
            const helper = new URL("../../../web/e2e/support/desktop-browser-extension.ts", import.meta.url);
            const { attachDesktopBrowserExtension } = z.object({
              attachDesktopBrowserExtension: z.custom<AttachDesktopBrowserExtension>(value => typeof value === "function"),
            }).parse(await import(helper.href));
            return attachDesktopBrowserExtension({ address, ownerId, scratch: input.workspaceRoot });
          },
        }),
        knowledge: {
          baseId: knowledge.owned.base.id, baseName: knowledge.owned.base.name,
          documentName: knowledge.owned.document.displayName, content: knowledge.owned.content,
        },
      });
      const providerUsage = await prisma.tokenUsageRecord.findMany({
        where: {
          ownerId, conversationId: artifact.conversationId, turnId: artifact.turnId,
        },
        select: {
          snapshotKey: true, ownerId: true, conversationId: true, turnId: true,
          codexThreadId: true, codexTurnId: true, model: true,
          totalTokens: true, inputTokens: true, cachedInputTokens: true, outputTokens: true,
          reasoningOutputTokens: true, totalCostPicoUsd: true, usedCreditMicros: true,
        },
        orderBy: { observedAt: "asc" },
      });
      const completedTurn = await prisma.conversationTurn.findUniqueOrThrow({
        where: { id: artifact.turnId },
        select: { model: true, codexThreadId: true, codexTurnId: true, status: true },
      });
      assert.equal(completedTurn.status, "completed");
      assert.equal(completedTurn.model, artifact.model);
      // One exact server-observed provider response per proxied model call.
      assert.equal(providerUsage.length, artifact.modelCalls,
        "each proxied model call must persist exactly one provider usage record");
      for (const record of providerUsage) {
        assert.equal(record.ownerId, ownerId);
        assert.equal(record.conversationId, artifact.conversationId);
        assert.equal(record.turnId, artifact.turnId);
        if (record.codexThreadId === null) {
          assert.equal(record.codexTurnId, null,
            "pre-projection provider usage must not invent native ids");
        } else {
          assert.equal(record.codexThreadId, completedTurn.codexThreadId);
          assert.equal(record.codexTurnId, completedTurn.codexTurnId);
        }
        assert.equal(record.model, artifact.model);
        // The fixture response reports 1 input + 1 output token; catalog prices
        // are 10 / 2 / 20 USD per million, so each record costs 30,000,000 pUSD.
        assert.deepEqual([
          record.totalTokens, record.inputTokens, record.cachedInputTokens,
          record.outputTokens, record.reasoningOutputTokens,
        ], [2n, 1n, 0n, 1n, 0n]);
        assert.equal(record.totalCostPicoUsd, 30_000_000n);
        assert.equal(record.usedCreditMicros, 3_000n);
      }
      assert.equal(new Set(providerUsage.map(record => record.snapshotKey)).size, providerUsage.length);
      assert.equal(await prisma.modelUsageRecord.count({
        where: { ownerId, turnId: artifact.turnId },
      }), 0, "primary provider usage must not also write a model usage record");
      assert.equal(await prisma.conversationEvent.count({
        where: {
          conversationId: artifact.conversationId, turnId: artifact.turnId,
          eventType: "thread/tokenUsage/updated",
        },
      }), 0, "client-supplied token events must remain skipped");
      const ownerTokenUsage = await prisma.tokenUsageRecord.aggregate({
        where: { ownerId },
        _sum: {
          totalTokens: true, inputTokens: true, cachedInputTokens: true,
          outputTokens: true, reasoningOutputTokens: true, usedCreditMicros: true,
        },
      });
      const ownerTotalTokens = ownerTokenUsage._sum.totalTokens ?? 0n;
      const profile = await usageAnalytics.personalProfile(ownerId, { time_zone: "UTC" });
      assert.equal(profile.metrics.token_usage.total_tokens, ownerTotalTokens.toString());
      assert.equal(profile.metrics.token_usage.input_tokens,
        (ownerTokenUsage._sum.inputTokens ?? 0n).toString());
      assert.equal(profile.metrics.token_usage.output_tokens,
        (ownerTokenUsage._sum.outputTokens ?? 0n).toString());
      assert.equal(profile.metrics.turn_count, await prisma.usageActivityRecord.count({
        where: { ownerId, activityType: "turn_started" },
      }), "provider usage must not invent a turn");
      const profileModel = profile.models.find(model => model.model_id === artifact.model);
      assert(profileModel);
      assert.equal(profileModel.token_usage.total_tokens,
        (await prisma.tokenUsageRecord.aggregate({
          where: { ownerId, model: artifact.model }, _sum: { totalTokens: true },
        }))._sum.totalTokens?.toString() ?? "0");
      const report = await usageAnalytics.report({ range: "all", time_zone: "UTC" });
      assert.equal(report.totals.token_usage.total_tokens, ownerTotalTokens.toString());
      const assistantWorkload = report.workloads.find(
        workload => workload.workload === "assistant_response",
      );
      assert.equal(assistantWorkload?.token_usage.total_tokens, ownerTotalTokens.toString());
      assert.deepEqual(assistantWorkload?.measurement_methods, ["provider"]);
      assert.equal(report.models.find(model => model.model_id === artifact.model)
        ?.token_usage.total_tokens, profileModel.token_usage.total_tokens);
      const quota = await usageAnalytics.personalQuota(ownerId, { range: "7d", time_zone: "UTC" });
      const readTask = quota.tasks.find(task => task.id === artifact.conversationId);
      assert(readTask, "the packaged conversation must appear in personal quota");
      assert.deepEqual(readTask.breakdown, [{
        model: artifact.model, workload: "assistant_response", credits: "0.057",
      }]);
      assert.equal(readTask.credits, "0.057");
      const creditOverview = await creditLimits.personalOverview(ownerId);
      assert.equal(creditOverview.used,
        creditMicrosToDecimal(ownerTokenUsage._sum.usedCreditMicros ?? 0n));
      const websiteCleanup = await maintenance.getJob(`desktop-website-${artifact.websiteArtifactId}`);
      assert(websiteCleanup?.data.type === "desktop-website-cleanup");
      assert.deepEqual([...websiteCleanup.data.paths].sort(), [...artifact.websiteAssets].sort());
      await jobs["process"](websiteCleanup, { cleanupInvalidTokens: outsideFixture });
      await websiteCleanup.remove();
      for (const path of websiteCleanup.data.paths) {
        assert((await storage.getObjectSize(webBundleObjectKey(artifact.websiteArtifactId, path))) > 0,
          "cleanup must leave published assets intact");
      }
      console.log("Packaged Mac website passed: native approval, HTML download, owner-only preview, CSS publication, and retention by the cleanup worker.");
      if (minio) {
        const one = desktopArtifactPartKey(artifact.id, desktopArtifactMaxParts - 1);
        const copy = `${desktopArtifactStagingKey(artifact.id)}/single-part-test`;
        const sample = Buffer.from("Small fixture above a deployment's configured threshold");
        const signal = AbortSignal.timeout(3_000);
        try {
          await minio.storage.putObject(one, sample, {}, signal);
          await minio.storage.composeObject(copy, [one], signal);
          assert.deepEqual(await buffer(await minio.storage.getObjectStream(copy, signal)), sample);
        } finally {
          await minio.storage.removeObject(one, AbortSignal.timeout(3_000));
          await minio.storage.removeObject(copy, AbortSignal.timeout(3_000));
        }
        const websiteArchiveBytes = await minio.storage.getObjectSize(desktopArtifactStagingKey(artifact.websiteArtifactId));
        assert(websiteArchiveBytes > 34 * 1024 * 1024, "the ZIP must include both large web resources");
        for (const [id, sizeBytes] of [[artifact.id, artifact.sizeBytes], [artifact.websiteArtifactId, websiteArchiveBytes]] as const) {
          assert(!relayUploads.has(`${desktopArtifactPath}/${artifact.turnId}/${id}/upload`),
            "the native artifact used the API fallback instead of the presigned form");
          const partKeys = Array.from({ length: Math.ceil(sizeBytes / desktopArtifactPartBytes) },
            (_, index) => desktopArtifactPartKey(id, index));
          assert(partKeys.length > 1, "the packaged fixture must cross a part boundary");
          for (const [index, key] of partKeys.entries()) {
            assert.equal(await minio.storage.getObjectSize(key),
              Math.min(desktopArtifactPartBytes, sizeBytes - index * desktopArtifactPartBytes));
          }
          assert.equal(await minio.storage.getObjectSize(desktopArtifactStagingKey(id)), sizeBytes);
          const delayed = (await maintenance.getJobs(["delayed"])).filter(job =>
            job.data.type === "object-delete" && partKeys.includes(job.data.objectKey));
          assert.equal(delayed.length, partKeys.length);
          for (const job of delayed) {
            await jobs["process"](job, { cleanupInvalidTokens: outsideFixture });
            await job.remove();
          }
          for (const key of partKeys) await assert.rejects(minio.storage.getObjectSize(key));
        }
        console.log("Packaged Mac used presigned MinIO parts for the file and website archives, verified both, and cleaned the exact staging keys.");
      }
      assert.deepEqual({
        graph: connector.stats.graph, workspace: connector.stats.workspace,
        started: connector.stats.started, aborted: connector.stats.aborted,
      }, { graph: 1, workspace: 2, started: 1, aborted: 1 });
      assert(connector.stats.documentPages > 1);
    }
    const revokedThread = randomUUID();
    const running = await prisma.conversation.create({ data: {
      ownerId, title: "Mac task awaiting a native outcome", titleSource: "manual", archiveStatus: "archived",
      archivedAt: new Date(),
      workspaceRelPath: `${ownerId}/services/${randomUUID()}/home/workspace`,
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: revokedThread,
    } });
    const runningTurn = await prisma.conversationTurn.create({ data: {
      conversationId: running.id, submittedBy: ownerId, sequenceNo: 1, status: "running",
      codexThreadId: revokedThread, codexTurnId: randomUUID(), startedAt: new Date(), submitMode: "normal",
      capabilityGeneration, capabilitiesJson: [],
    } });
    const partial = await prisma.conversationMessage.create({ data: {
      conversationId: running.id, turnId: runningTurn.id, sequenceNo: 1,
      role: "assistant", contentText: "Already delivered output",
    } });
    const completeItem = "completed-mac-item";
    const streamingItem = "streaming-mac-item";
    const nativeParams = { threadId: revokedThread, turnId: runningTurn.codexTurnId };
    for (const [index, [method, params]] of ([
      ["item/agentMessage/delta", { ...nativeParams, itemId: completeItem, delta: partial.contentText }],
      ["item/completed", { ...nativeParams, item: { type: "agentMessage", id: completeItem, text: partial.contentText, phase: "commentary" } }],
      ["item/agentMessage/delta", { ...nativeParams, itemId: streamingItem, delta: "Streamed " }],
      ["item/agentMessage/delta", { ...nativeParams, itemId: streamingItem, delta: "before revocation" }],
    ] as const).entries()) {
      await prisma.conversationEvent.create({ data: {
        conversationId: running.id, turnId: runningTurn.id, sequenceNo: index + 1,
        sseEventId: `${running.id}:${index + 1}`, eventType: method, visibility: "user_visible",
        payloadJson: { schema_version: 2, source: "codex_app_server", method, params },
      } });
    }
    const starting = await prisma.conversation.create({ data: {
      ownerId, title: "Mac task waiting for a receipt", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${ownerId}/services/${randomUUID()}/home/workspace`,
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId,
    } });
    const intent = await prisma.conversationTurnStartIntent.create({ data: {
      projectionTurnId: randomUUID(), ownerId, conversationId: starting.id, runtimeGeneration: starting.runtimeGeneration,
      capabilityGeneration, inputText: "Preserve this input", capabilitiesJson: [], attachmentsJson: [],
      submitMode: "normal", runnerStatus: "prepared", idempotencyKey: "mac-revoked-before-projection",
    } });
    const queuedIds = Array.from({ length: 5 }, () => randomUUID());
    await prisma.pendingRequest.createMany({ data: queuedIds.map((id, index) => ({
      id, conversationId: starting.id, submittedBy: ownerId, queueNo: index + 1,
      inputText: `Queued request ${index + 1}`, status: "waiting_previous_turn",
    })) });
    const discardedThread = randomUUID();
    const discarded = await prisma.conversation.create({ data: {
      ownerId, title: "Mac task deleted after settlement", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: discardedThread,
    } });
    const discardedTurn = await prisma.conversationTurn.create({ data: {
      conversationId: discarded.id, submittedBy: ownerId, sequenceNo: 1, status: "running",
      codexThreadId: discardedThread, codexTurnId: randomUUID(), startedAt: new Date(), submitMode: "normal",
      capabilityGeneration, capabilitiesJson: [],
    } });
    const cloudThread = randomUUID();
    const cloud = await prisma.conversation.create({ data: {
      ownerId, title: "Unrelated cloud task", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
      runtimeGeneration: randomUUID(), codexThreadId: cloudThread,
    } });
    const cloudTurn = await prisma.conversationTurn.create({ data: {
      conversationId: cloud.id, submittedBy: ownerId, sequenceNo: 1, status: "running",
      codexThreadId: cloudThread, codexTurnId: randomUUID(), startedAt: new Date(), submitMode: "normal",
      capabilityGeneration, capabilitiesJson: [],
    } });
    const legacy = await prisma.conversation.create({ data: {
      ownerId, title: "Legacy terminal Mac task", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId,
    } });
    const legacyTurn = await prisma.conversationTurn.create({ data: {
      conversationId: legacy.id, submittedBy: ownerId, sequenceNo: 1, status: "completed",
      codexThreadId: randomUUID(), codexTurnId: randomUUID(), startedAt: new Date(),
      completedAt: new Date(), submitMode: "normal", capabilityGeneration, capabilitiesJson: [],
    } });
    // The start intent has no reservation: PostgreSQL must still discover it.
    for (const [id, turn] of [[running.id, runningTurn.id], [discarded.id, discardedTurn.id], [conversationId, turnId], [cloud.id, cloudTurn.id], [legacy.id, legacyTurn.id]] as const) {
      assert.equal((await redis.acquireTurnSlot(id, turn, ownerId, 10)).acquired, true);
    }
    // Drop every queued wake-up and fail the Redis notification after the DB commit.
    await queue.drain(true);
    const revoke = coordinator.revoke;
    coordinator.revoke = async () => { throw new Error("fixture notification unavailable"); };
    try {
      const [revocation] = await Promise.all([
        app.inject({ method: "DELETE", url: `/api/v1/desktop/devices/${deviceId}` }),
        conversations.patch(ownerId, local.conversationId, { archiveStatus: "archived" }),
      ]);
      assert.equal(revocation.statusCode, 500);
    } finally {
      coordinator.revoke = revoke;
    }
    assert((await prisma.desktopDevice.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt);
    assert.equal((await prisma.localComputerSession.findUniqueOrThrow({ where: { id: local.sessionId } })).status, "ended");
    assert((await prisma.computerPermissionGrant.findUniqueOrThrow({ where: { id: local.grantId } })).revokedAt);
    await conversations.delete(ownerId, legacy.id, {});
    assert.equal(await redis.hasTurnSlot(legacy.id, legacyTurn.id, ownerId), true);
    // A new scheduler can finish without any in-memory state, retry, or current socket.
    const restartedRecovery = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    const releaseTurnSlot = redis.releaseTurnSlot;
    redis.releaseTurnSlot = async (id, turn, options) => {
      if (turn === discardedTurn.id) throw new Error("fixture Redis release unavailable after commit");
      await releaseTurnSlot.call(redis, id, turn, options);
    };
    try {
      await restartedRecovery.process({ data: { type: "maintenance" } });
    } finally {
      redis.releaseTurnSlot = releaseTurnSlot;
    }
    assert.equal((await prisma.conversationTurn.findUniqueOrThrow({ where: { id: discardedTurn.id } })).status, "failed");
    assert.equal(await redis.hasTurnSlot(discarded.id, discardedTurn.id, ownerId), true);
    await conversations.delete(ownerId, discarded.id, {});
    await queue.drain(true);
    const afterDeletion = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    await afterDeletion.process({ data: { type: "maintenance" } });
    await restartedRecovery.process({ data: { type: "maintenance" } });
    assert.equal(await redis.hasTurnSlot(legacy.id, legacyTurn.id, ownerId), false);
    assert.equal(await redis.hasTurnSlot(discarded.id, discardedTurn.id, ownerId), false);
    assert.equal(await redis.hasTurnSlot(running.id, runningTurn.id, ownerId), false);
    assert.equal(await redis.hasTurnSlot(starting.id, intent.projectionTurnId, ownerId), false);
    assert.equal(await redis.hasTurnSlot(conversationId, turnId, ownerId), false);
    assert.equal(await redis.hasTurnSlot(cloud.id, cloudTurn.id, ownerId), true);
    assert.equal((await prisma.conversationTurn.findUniqueOrThrow({ where: { id: cloudTurn.id } })).status, "running");
    const failed = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: runningTurn.id } });
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "DESKTOP_DEVICE_REVOKED");
    assert.equal((await prisma.conversationMessage.findUniqueOrThrow({ where: { id: partial.id } })).contentText, partial.contentText);
    const reloaded = await conversations.get(ownerId, running.id);
    assert.deepEqual(reloaded.messages.map(message => message.content_text), [partial.contentText, "Streamed before revocation"]);
    assert.equal(await prisma.conversationTurnStartIntent.findUnique({ where: { projectionTurnId: intent.projectionTurnId } }), null);
    const draft = await prisma.pendingRequest.findUniqueOrThrow({ where: { id: intent.projectionTurnId } });
    assert.equal(draft.status, "blocked_preflight");
    assert.equal(draft.inputText, intent.inputText);
    assert.equal((await conversations.get(ownerId, starting.id)).pending_requests.find(row => row.id === draft.id)?.block_code, "desktop_device_revoked");
    const draftEvents = (await events.historyPage(ownerId, starting.id, { afterSequence: 0n, limit: 50 })).items;
    assert.deepEqual(draftEvents.map(event => event.event_type), [
      "conversation.pending_request.updated", "conversation.error", "conversation.error",
    ]);
    assert.deepEqual(conversationStartFailurePayloadSchema.parse(draftEvents[1]?.payload), {
      schema_version: 1, error_code: "RUNNER_UNAVAILABLE", message_key: "errors.runnerUnavailable", retryable: true,
      start_failure: { turn_id: intent.projectionTurnId, idempotency_key: intent.idempotencyKey },
    });
    const reordered = [draft.id, ...[...queuedIds].reverse()];
    assert.deepEqual((await conversations.reorderPending(ownerId, starting.id, reordered, {})).items.map(item => item.id), reordered);
    assert.equal((await conversations.restorePendingToInput(ownerId, starting.id, draft.id, {})).input_text, intent.inputText);
    const revokedEvents = (await events.historyPage(ownerId, running.id, { afterSequence: 0n, limit: 50 })).items;
    assert.deepEqual(revokedEvents.slice(4).map(event => event.event_type), [
      "conversation.message.completed", "conversation.status.changed", "conversation.error",
    ]);
    assert.equal((await prisma.conversationTurn.findUniqueOrThrow({ where: { id: turnId } })).status, "completed");
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close().finally(() => Promise.all([queue.close(), maintenance.close()]))
      .finally(() => fixture.close()).finally(() => minio?.close());
  }
}

type EventCallback = Extract<DesktopExecutionCallback, { operation: "events" }>;
type EventDelivery = EventCallback["body"]["events"][number];

function send(socket: WebSocket, frame: unknown): void {
  socket.send(JSON.stringify(frame));
}

function readFrame(socket: WebSocket): Promise<unknown> {
  return once(socket, "message", { signal: AbortSignal.timeout(5_000) })
    .then(([data]) => JSON.parse(String(data)));
}

function readCommand(socket: WebSocket): Promise<DesktopExecutionCommand> {
  return readFrame(socket).then(frame => desktopExecutionCommandSchema.parse(frame));
}

function exchange(socket: WebSocket, frame: unknown): Promise<unknown> {
  const response = readFrame(socket);
  send(socket, frame);
  return response;
}

async function sendEvents(socket: WebSocket, frame: EventCallback) {
  const ack = desktopExecutionAckSchema.parse(await exchange(socket, frame));
  assert.equal(ack.id, frame.id);
  assert(ack.operation === "events");
  return ack;
}

function assertAccepted(ack: Awaited<ReturnType<typeof sendEvents>>, ids: string[]): void {
  assert(ack.ok, `Desktop event batch rejected: ${ack.ok ? "" : ack.error_code}`);
  assert.deepEqual(ack.data.accepted_delivery_ids, ids);
}
