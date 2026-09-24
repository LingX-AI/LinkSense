import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runnerEventBatchSchema } from "@linksense/shared";

import { HttpRunnerEventSink } from "../src/event-sink.js";
import type {
  LinkSenseCodexEvent,
  LinkSensePublishedEvent,
} from "../src/codex/event-mapper.js";
import { FileServiceRequestError } from "../src/file-service-error.js";
import { deriveKnowledgeSearchTimeouts } from "../src/knowledge-search-timeout.js";
import { skillCreatorErrorFromApi } from "../src/skill-creator-error.js";
import { RunnerEventOutboxStore } from "../src/workspace/event-outbox.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

const roots: string[] = [];
const conversationId = "01900000-0000-7000-8000-000000000001";
const ownerId = "01900000-0000-7000-8000-000000000002";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("HttpRunnerEventSink", () => {
  it("relays connection operations with the task owner and redacts provider failures", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ kind: "connections", items: [] }));
    const sink = new HttpRunnerEventSink("http://api:4000", "runner-secret", workspaceManager, { fetch: fetchMock });
    const abort = new AbortController();
    const body = { conversationId, turnId: ownerId, input: { operation: "list_connections" as const } };
    try {
      expect(await sink.accessConnection({ ...body, signal: abort.signal })).toEqual({ kind: "connections", items: [] });
      expect(fetchMock).toHaveBeenCalledWith(new URL("http://api:4000/internal/connections/execute"), expect.objectContaining({
        body: JSON.stringify(body), headers: expect.objectContaining({ "x-linksense-owner-id": ownerId }),
      }));
      abort.abort();
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      fetchMock.mockResolvedValueOnce(Response.json({ error_code: "CONNECTION_REQUIRED", message: "private-token-detail" }, { status: 409 }));
      await expect(sink.accessConnection(body)).rejects.toMatchObject({ code: "CONNECTION_REQUIRED", message: "CONNECTION_REQUIRED", retryable: false });
    } finally { await sink.close(); }
  });
  it("projects a settled start outside the blocked event queue and wakes delivery immediately", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    let projected = false;
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/runner/start-settled")) {
        projected = true;
        return jsonResponse({ data: { settled: true } });
      }
      return projected ? acknowledgeRequest(url, init) : jsonResponse({ data: { accepted_delivery_ids: [] } });
    });
    const sink = new HttpRunnerEventSink("http://127.0.0.1:4000", "runner-secret", workspaceManager,
      { fetch: fetchMock, retryBaseMs: 10_000 });
    try {
      await sink.publish(conversationId, statusEvent());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      await sink.reportStartSettled({ conversationId, projectionTurnId: "01900000-0000-7000-8000-000000000099", runtimeGeneration: "01900000-0000-7000-8000-000000000098" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 500 });
      expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "x-linksense-owner-id": ownerId });
    } finally { await sink.close(0); }
  });
  it("retains queued and delayed preparation compaction across native thread alignment", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    const outbox = new RunnerEventOutboxStore(workspaceManager);
    const started: LinkSenseCodexEvent = {
      method: "item/started", visibility: "user_collapsed",
      preparation: { turnId: "01900000-0000-7000-8000-000000000099" },
      params: { threadId: "source-thread", turnId: "compact-turn", item: { id: "compact", type: "contextCompaction" } },
    };
    await outbox.append(conversationId, started);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(acknowledgeRequest);
    const sink = new HttpRunnerEventSink("http://127.0.0.1:4000/internal", "runner-shared-secret-value", workspaceManager, { fetch: fetchMock });
    await sink.alignConversationThread(conversationId, "target-thread");
    expect(await outboxFiles(root)).toHaveLength(1);
    await sink.publish(conversationId, { ...started, method: "item/completed" });
    await sink.flushConversation(conversationId);
    expect(fetchMock.mock.calls.flatMap(([, init]) => runnerEventBatchSchema.parse(JSON.parse(String(init?.body))).events.map(entry => entry.event))).toEqual([
      started, { ...started, method: "item/completed" },
    ]);
    expect(await outboxFiles(root)).toHaveLength(0);
    await sink.close();
  });
  it("reports owner-scoped heartbeats without accessing or draining conversation outboxes", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { confirmed: true } })));
    const sink = new HttpRunnerEventSink("http://127.0.0.1:4000", "runner-shared-secret-value", workspaceManager, { fetch: fetchMock });
    const input = { bootId: "01900000-0000-7000-8000-000000000003", startup: true };
    await sink.reportHeartbeat(ownerId, input);
    expect(fetchMock).toHaveBeenCalledWith(new URL("http://127.0.0.1:4000/internal/runner/heartbeat"), expect.objectContaining({
      method: "POST", body: JSON.stringify(input),
      headers: expect.objectContaining({ "x-linksense-owner-id": ownerId }),
    }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { confirmed: false } })));
    await expect(sink.reportHeartbeat(ownerId, input)).rejects.toThrow("not confirmed");
    await sink.close();
  });

  it("durably retries memory usage with the owner-scoped identity", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    await workspaceManager.ensureOwner(ownerId);
    const deferredFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    const first = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: deferredFetch, retryBaseMs: 10_000 },
    );
    const capture = {
      request_id: "01900000-0000-7000-8000-000000000010",
      owner_id: ownerId,
      conversation_id: conversationId,
      operation: "extract" as const,
      model: "gpt-5.2",
      measurement_method: "provider" as const,
      token_usage: {
        total_tokens: 15,
        input_tokens: 10,
        cached_input_tokens: 2,
        output_tokens: 5,
        reasoning_output_tokens: 1,
      },
      pricing: {
        input_price_per_million: "1",
        cached_input_price_per_million: "0.1",
        output_price_per_million: "8",
      },
      observed_at: "2026-07-31T08:00:00.000Z",
    };

    await first.recordMemoryUsage(capture);
    await vi.waitFor(() => expect(deferredFetch).toHaveBeenCalled());
    await first.close(0);
    expect(await memoryUsageOutboxFiles(root)).toHaveLength(1);

    const deliveredFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { recorded: true } }),
      );
    const recovered = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: deliveredFetch },
    );
    await recovered.restore();
    await vi.waitFor(async () => {
      expect(await memoryUsageOutboxFiles(root)).toEqual([]);
    });
    expect(String(deliveredFetch.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:4000/internal/runner/memory-usage",
    );
    expect(
      new Headers(deliveredFetch.mock.calls[0]?.[1]?.headers).get(
        "x-linksense-owner-id",
      ),
    ).toBe(ownerId);
    expect(
      JSON.parse(String(deliveredFetch.mock.calls[0]?.[1]?.body)),
    ).toEqual(capture);
    await recovered.close();
  });

  it("reads only the oldest durable outbox record when selecting the next event", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const outbox = new RunnerEventOutboxStore(workspaceManager);
    const first = await outbox.append(conversationId, statusEvent());
    const second = await outbox.append(
      conversationId,
      statusEventFor("thread-1", "turn-2"),
    );
    await writeFile(second.path, "not-json", "utf8");

    await expect(outbox.peek(conversationId)).resolves.toMatchObject({
      deliveryId: first.deliveryId,
      sequence: first.sequence,
    });

    await outbox.remove(first);
    await expect(outbox.peek(conversationId)).rejects.toThrow();
  });

  it("persists and restores LinkSense form requests as v3 outbox records", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    const outbox = new RunnerEventOutboxStore(workspaceManager);
    const event = formRequestEvent();

    const appended = await outbox.append(conversationId, event);
    const persisted = JSON.parse(
      await readFile(appended.path, "utf8"),
    ) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      schema_version: 3,
      event,
    });
    await expect(outbox.peek(conversationId)).resolves.toMatchObject({
      event,
    });
    expect(await outboxFiles(root)).toHaveLength(1);
  });

  it("maps the enforced follow-up confirmation boundary to a stable MCP error", () => {
    expect(
      skillCreatorErrorFromApi(409, {
        error_code: "SKILL_CREATOR_CONFIRMATION_REQUIRED",
      }),
    ).toMatchObject({
      code: "SKILL_INSTALL_CONFIRMATION_REQUIRED",
      retryable: false,
      statusCode: 409,
    });
  });

  it("gives the knowledge relay an outer budget derived from deployment config", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        results: [],
        unavailable_knowledge_base_count: 0,
      }),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const configuredTimeoutMs = 181_234;
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      {
        fetch: fetchMock,
        knowledgeSearchTimeoutMs: configuredTimeoutMs,
      },
    );

    await sink.searchKnowledge({
      conversationId,
      turnId: "turn-native-1",
      query: "recovery procedure",
      finalTopK: 5,
      candidateMultiplier: 3,
      minScore: 0.2,
    });
    await sink.listKnowledgeDocuments({
      conversationId,
      turnId: "turn-native-1",
      cursor: "list-cursor-000000000000000001",
    });
    await sink.getKnowledgeDocumentMarkdown({
      conversationId,
      turnId: "turn-native-1",
      documentRef: "document-ref-0000000000000001",
      cursor: "markdown-cursor-00000000000001",
    });

    expect(timeoutSpy).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenLastCalledWith(
      deriveKnowledgeSearchTimeouts(configuredTimeoutMs).workerRelayMs,
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4000/internal/knowledge/search",
      "http://127.0.0.1:4000/internal/knowledge/documents",
      "http://127.0.0.1:4000/internal/knowledge/document-markdown",
    ]);
    await sink.close();
  });

  it("gives process-exit recovery a 150 second budget without changing ordinary requests", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { confirmed: true, outcome: "succeeded" },
      }),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock, requestTimeoutMs: 12_345 },
    );

    const processExitReport = {
      conversationId,
      projectionTurnId: "01900000-0000-7000-8000-000000000003",
      capabilityGeneration: "a".repeat(64),
    };
    await sink.reportProcessExit(processExitReport);
    expect(timeoutSpy).toHaveBeenLastCalledWith(150_000);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      processExitReport,
    );

    await sink.registerArtifact({
      conversationId,
      turnId: "turn-native-1",
      workspaceRelativePath: "artifacts/report.txt",
      displayName: "report.txt",
      webRootRelativePath: "artifacts/site",
    });
    expect(timeoutSpy).toHaveBeenLastCalledWith(12_345);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ webRootRelativePath: "artifacts/site" });
    await sink.close();
  });

  it("drains earlier native events before reporting process-exit recovery", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    let finishEventDelivery: (response: Response) => void = () => undefined;
    const eventDelivery = new Promise<Response>((resolve) => {
      finishEventDelivery = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>((url) =>
      String(url).endsWith("/runner/events")
        ? eventDelivery
        : Promise.resolve(
            jsonResponse({
              success: true,
              data: { confirmed: true, outcome: "succeeded" },
            }),
          ),
    );
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock, processExitTimeoutMs: 1_000 },
    );

    await sink.publish(conversationId, statusEvent());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const recovery = sink.reportProcessExit({
      conversationId,
      projectionTurnId: "01900000-0000-7000-8000-000000000003",
      capabilityGeneration: "a".repeat(64),
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledOnce();

    finishEventDelivery(
      acknowledgement(fetchMock.mock.calls[0]?.[1]),
    );
    await recovery;

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4000/internal/runner/events",
      "http://127.0.0.1:4000/internal/runner/process-exit",
    ]);
    expect(await outboxFiles(root)).toEqual([]);
    await sink.close();
  });

  it("forwards application development with the current owner and preserves safe rejection codes", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(null)).mockResolvedValueOnce(jsonResponse({ error_code: "APPLICATION_PACKAGE_INVALID", message: "private details" }, 422));
    const sink = new HttpRunnerEventSink("http://127.0.0.1:4000/internal", "runner-shared-secret-value", workspaceManager, { fetch: fetchMock });
    const input = { conversationId, turnId: "01900000-0000-7000-8000-000000000003", request: { operation: "inspect" as const } };
    await expect(sink.applicationBuilder(input)).resolves.toBeNull();
    await expect(sink.applicationBuilder(input)).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID", retryable: false, message: "APPLICATION_PACKAGE_INVALID" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ "x-linksense-owner-id": ownerId }), body: JSON.stringify({ ...input, workspacePath: "workspace" }) });
    await sink.close();
  });

  it("forwards Skill creator operations with owner identity and maps safe API failures", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({ error_code: "SKILL_CREATOR_PREVIEW_INVALID" }, 409),
      );
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock },
    );

    await expect(
      sink.previewSkillZip({
        conversationId,
        turnId: "turn-native-1",
        workspaceRelativePath: "artifacts/my-skill.zip",
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      sink.confirmSkillInstall({
        conversationId,
        turnId: "turn-native-2",
        installToken: "opaque-token-" + "x".repeat(80),
      }),
    ).rejects.toMatchObject({
      code: "SKILL_INSTALL_PREVIEW_INVALID",
      retryable: false,
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4000/internal/skill-creator/preview",
      "http://127.0.0.1:4000/internal/skill-creator/confirm",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-linksense-owner-id": ownerId,
    });
    await sink.close();
  });

  it.each([
    { success: true },
    { success: true, data: null },
    { success: true, data: { confirmed: false, outcome: "succeeded" } },
    { success: true, data: { confirmed: true, outcome: "failed" } },
  ])(
    "rejects a 2xx process-exit response that does not explicitly confirm recovery: $response",
    async (response) => {
      const { workspaceManager } = await createWorkspaceManager();
      const sink = new HttpRunnerEventSink(
        "http://127.0.0.1:4000/internal",
        "runner-shared-secret-value",
        workspaceManager,
        {
          fetch: vi
            .fn<typeof fetch>()
            .mockResolvedValue(jsonResponse(response)),
        },
      );

      await expect(
        sink.reportProcessExit({
          conversationId,
          projectionTurnId: "01900000-0000-7000-8000-000000000003",
          capabilityGeneration: "a".repeat(64),
        }),
      ).rejects.toThrow("process-exit recovery was not confirmed");
      await sink.close();
    },
  );

  it("forwards artifact registration and preserves only a safe API failure code", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error_code: "FORBIDDEN",
          message: "internal turn lookup included /private/secret-path",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock },
    );

    let failure: unknown;
    try {
      await sink.registerArtifact({
        conversationId,
        turnId: "turn-native-1",
        workspaceRelativePath: "artifacts/report.txt",
        displayName: "report.txt",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(FileServiceRequestError);
    expect(failure).toMatchObject({
      code: "FILE_SERVICE_TURN_INACTIVE",
      retryable: false,
      statusCode: 409,
    });
    expect(JSON.stringify(failure)).not.toContain("private");
    expect(JSON.stringify(failure)).not.toContain("secret-path");
    const request = requestBody(fetchMock, 0);
    expect(request).toMatchObject({
      conversationId,
      turnId: "turn-native-1",
      workspaceRelativePath: "artifacts/report.txt",
    });
    await sink.close();
  });

  it("classifies an unknown server failure as retryable without returning its body", async () => {
    const { workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("database stack and secret", { status: 500 }),
      );
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock },
    );

    const failure = await sink
      .registerArtifact({
        conversationId,
        turnId: "turn-native-1",
        workspaceRelativePath: "artifacts/report.txt",
        displayName: "report.txt",
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "ARTIFACT_REGISTRATION_UNAVAILABLE",
      retryable: true,
      statusCode: 503,
    });
    expect(String(failure)).not.toContain("database");
    expect(String(failure)).not.toContain("secret");
    await sink.close();
  });

  it("uses one stable delivery id until the API acknowledges the event", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { accepted_delivery_ids: [] },
        }),
      )
      .mockImplementationOnce(acknowledgeRequest);
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock, retryBaseMs: 1, retryMaxMs: 1 },
    );

    await sink.publish(conversationId, statusEvent());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await sink.flushConversation(conversationId, 500);

    const firstBody = runnerEventBatchSchema.parse(requestBody(fetchMock, 0)).events[0]!;
    const secondBody = runnerEventBatchSchema.parse(requestBody(fetchMock, 1)).events[0]!;
    expect(firstBody.deliveryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(secondBody.deliveryId).toBe(firstBody.deliveryId);
    expect(await outboxFiles(root)).toEqual([]);
    await sink.close();
  });

  it("prunes queued child-thread events and ignores later child-thread events after alignment", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    let finishFirstRequest: (response: Response) => void = () => undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      finishFirstRequest = resolve;
    });
    let markFirstRequestStarted: () => void = () => undefined;
    const firstRequestStarted = new Promise<void>((resolve) => {
      markFirstRequestStarted = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        markFirstRequestStarted();
        return firstResponse;
      })
      .mockImplementation(acknowledgeRequest);
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock, retryBaseMs: 1, retryMaxMs: 1 },
    );

    await sink.publish(
      conversationId,
      statusEventFor("thread-child-1", "turn-child-1"),
    );
    await firstRequestStarted;
    await sink.publish(conversationId, statusEvent());
    expect(await outboxFiles(root)).toHaveLength(2);

    await sink.alignConversationThread(conversationId, "thread-1");
    expect(await outboxFiles(root)).toHaveLength(1);
    finishFirstRequest(
      jsonResponse({
        success: true,
        data: { accepted_delivery_ids: [] },
      }),
    );

    await vi.waitFor(async () => {
      expect(await outboxFiles(root)).toEqual([]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (
        runnerEventBatchSchema.parse(requestBody(fetchMock, 0)).events[0]!.event as {
          params: { threadId: string };
        }
      ).params.threadId,
    ).toBe("thread-child-1");
    expect(
      (
        runnerEventBatchSchema.parse(requestBody(fetchMock, 1)).events[0]!.event as {
          params: { threadId: string };
        }
      ).params.threadId,
    ).toBe("thread-1");

    await sink.publish(
      conversationId,
      statusEventFor("thread-child-2", "turn-child-2"),
    );
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await outboxFiles(root)).toEqual([]);
    await sink.close();
  });

  it("persists a sanitized event before returning while its network request is blocked", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    let finishRequest: (response: Response) => void = () => undefined;
    const blockedResponse = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    let markRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        markRequestStarted();
        return blockedResponse;
      })
      .mockImplementation(acknowledgeRequest);
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock, retryBaseMs: 1, retryMaxMs: 1 },
    );

    let publishesSettled = false;
    const publish = sink
      .publish(conversationId, messageCompletedEvent())
      .then(() => {
        publishesSettled = true;
      });

    try {
      await requestStarted;
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(publishesSettled).toBe(true);
      await publish;

      const files = await outboxFiles(root);
      expect(files).toHaveLength(1);
      for (const file of files) {
        const filePath = join(outboxDirectory(root), file);
        expect((await stat(filePath)).mode & 0o777).toBe(0o600);
        const persisted = JSON.parse(
          await readFile(filePath, "utf8"),
        ) as Record<string, unknown>;
        expect(Object.keys(persisted).sort()).toEqual([
          "delivery_id",
          "event",
          "schema_version",
        ]);
        expect(persisted.schema_version).toBe(2);
        expect(JSON.stringify(persisted)).not.toContain("raw_notification");
        expect(JSON.stringify(persisted)).not.toContain("secret-field");
      }
    } finally {
      finishRequest(acknowledgement(fetchMock.mock.calls[0]?.[1]));
      await sink.close(500);
    }
  });

  it("rejects new legacy lifecycle writes while retaining v1 restore support", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    const fetchMock = vi.fn<typeof fetch>();
    const sink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: fetchMock },
    );

    await expect(
      sink.publish(conversationId, {
        eventType: "conversation.message.completed",
        visibility: "user_visible",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          schema_version: 1,
          item_id: "item-1",
          text: "legacy response",
        },
      } as never),
    ).rejects.toThrow();

    expect(await outboxFiles(root)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await sink.close();
  });

  it("restores legacy v1 and native v2 outbox records in order after an outage", async () => {
    const { root, workspaceManager } = await createWorkspaceManager();
    const unavailableFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const firstSink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: unavailableFetch, retryBaseMs: 1, retryMaxMs: 2 },
    );

    const legacyDeliveryId = "60000000-0000-4000-8000-000000000001";
    await mkdir(outboxDirectory(root), { recursive: true });
    await writeFile(
      join(outboxDirectory(root), `0000000000000001-${legacyDeliveryId}.json`),
      JSON.stringify({
        schema_version: 1,
        delivery_id: legacyDeliveryId,
        event: {
          eventType: "conversation.message.completed",
          visibility: "user_visible",
          threadId: "thread-1",
          turnId: "turn-1",
          payload: {
            schema_version: 1,
            item_id: "item-1",
            text: "legacy sanitized assistant body",
          },
        },
      }),
      { mode: 0o600 },
    );
    await firstSink.publish(conversationId, terminalEvent());
    await vi.waitFor(() =>
      expect(unavailableFetch.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    const persistedFiles = await outboxFiles(root);
    expect(persistedFiles).toHaveLength(2);
    const persistedRecords = await Promise.all(
      persistedFiles.map(async (file) => {
        const value = JSON.parse(
          await readFile(join(outboxDirectory(root), file), "utf8"),
        ) as { delivery_id: string; schema_version: number };
        return value;
      }),
    );
    expect(persistedRecords.map((record) => record.schema_version)).toEqual([
      1, 2,
    ]);
    await firstSink.close(1);

    const recoveredBodies: Record<string, unknown>[] = [];
    const recoveredFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        recoveredBodies.push(...runnerEventBatchSchema.parse(JSON.parse(String(init?.body))).events);
        return acknowledgement(init);
      });
    const recoveredSink = new HttpRunnerEventSink(
      "http://127.0.0.1:4000/internal",
      "runner-shared-secret-value",
      workspaceManager,
      { fetch: recoveredFetch, retryBaseMs: 1, retryMaxMs: 1 },
    );

    await recoveredSink.restore();
    await vi.waitFor(async () => {
      expect(await outboxFiles(root)).toEqual([]);
    });
    expect(
      recoveredBodies.map((body) =>
        "method" in (body.event as Record<string, unknown>)
          ? (body.event as { method: string }).method
          : (body.event as { eventType: string }).eventType,
      ),
    ).toEqual(["conversation.message.completed", "turn/completed"]);
    expect(recoveredBodies.map((body) => body.deliveryId)).toEqual(
      persistedRecords.map((record) => record.delivery_id),
    );
    await recoveredSink.close();
  });
});

async function createWorkspaceManager() {
  const root = await mkdtemp(join(tmpdir(), "linksense-event-outbox-"));
  roots.push(root);
  return {
    root,
    workspaceManager: new WorkspaceManager(root, undefined, {
      fixedOwnerId: ownerId,
    }),
  };
}

function outboxDirectory(root: string) {
  return join(root, ownerId, "control", "workspaces", conversationId, "outbox");
}

async function outboxFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(outboxDirectory(root)))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

async function memoryUsageOutboxFiles(root: string): Promise<string[]> {
  try {
    return (
      await readdir(join(root, ownerId, "control", "memory-usage-outbox"))
    )
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

function statusEvent(): LinkSenseCodexEvent {
  return statusEventFor("thread-1", "turn-1");
}

function statusEventFor(threadId: string, turnId: string): LinkSenseCodexEvent {
  return {
    method: "turn/started" as const,
    visibility: "user_visible" as const,
    params: {
      threadId,
      turn: { id: turnId, status: "inProgress" as const },
    },
  };
}

function messageCompletedEvent(): LinkSenseCodexEvent {
  return {
    method: "item/completed" as const,
    visibility: "user_visible" as const,
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "agentMessage" as const,
        id: "item-1",
        text: "sanitized assistant body",
        phase: "final_answer" as const,
      },
    },
  };
}

function terminalEvent(): LinkSenseCodexEvent {
  return {
    method: "turn/completed" as const,
    visibility: "user_visible" as const,
    params: {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed" as const },
    },
  };
}

function formRequestEvent(): LinkSensePublishedEvent {
  return {
    method: "linksense/form/request",
    visibility: "user_visible",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "linksense-form-42",
      requestId: 42,
      serverName: "linksense_core",
      message: "请确认是否创建草稿",
      requestedSchema: {
        type: "object",
        properties: {
          approval_decision: {
            type: "string",
            title: "审批决定",
            oneOf: [
              { const: "approve", title: "批准" },
              { const: "reject", title: "拒绝" },
            ],
          },
        },
        required: ["approval_decision"],
      },
      uiHints: {},
      responseSemantics: {
        kind: "approval",
        decision_field_id: "approval_decision",
        approve_value: "approve",
        reject_value: "reject",
      },
      autoResolutionMs: 600_000,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number,
): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body)) as Record<
    string,
    unknown
  >;
}

function acknowledgement(init: RequestInit | undefined): Response {
  const batch = runnerEventBatchSchema.parse(JSON.parse(String(init?.body)));
  return jsonResponse({ success: true, data: { accepted_delivery_ids: batch.events.map(entry => entry.deliveryId) } });
}
async function acknowledgeRequest(_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  return acknowledgement(init);
}
