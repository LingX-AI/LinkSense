import { EventEmitter } from "node:events";

import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ConversationEvent, Prisma } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import {
  eventRouteTesting,
  internalRunnerRoutes,
  sseRoutes,
} from "../src/modules/events/routes.js";
import { ConversationEventService } from "../src/modules/events/service.js";
import type { AppServices } from "../src/services.js";
import type { RunnerTextDeltaEvent } from "@linksense/shared";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const TURN_ID = "30000000-0000-4000-8000-000000000001";
const PLAN_REVIEW_ID = "32000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "31000000-0000-4000-8000-000000000001";
const RECOVERY_ATTEMPT_ID = "31000000-0000-4000-8000-000000000002";
const CAPABILITY_GENERATION = "d".repeat(64);
const TEST_MODEL_RUNTIME = {
  model: "test-model",
  reasoningEffort: "medium" as const,
  provider: {
    revision: 1,
    baseUrl: "https://models.example.test/v1",
    protocolMode: "native_responses" as const,
    apiKey: "test-provider-key",
  },
};
const NOW = new Date("2026-07-11T08:00:00.000Z");
const apps: Array<ReturnType<typeof Fastify>> = [];

function preparationEvent() {
  return {
    method: "item/started", visibility: "user_visible" as const,
    preparation: { turnId: TURN_ID },
    params: {
      threadId: "native-source-thread", turnId: "native-compact-turn",
      item: { id: "compact-item", type: "contextCompaction" },
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("ConversationEventService sanitization and terminal semantics", () => {
  it.each<RunnerTextDeltaEvent["method"]>(["item/agentMessage/delta", "item/plan/delta", "item/reasoning/summaryTextDelta"])("keeps batched %s equivalent to individual ingestion, including internal visibility", async method => {
    const individual = eventFixture();
    const batched = eventFixture();
    individual.tx.conversationEvent.findFirst.mockImplementation(async () => {
      const written = individual.tx.conversationEvent.create.mock.calls.length;
      return written > 0 ? { sequenceNo: BigInt(written) } : null;
    });
    const entries = [textDeltaEntry("内部", 1), textDeltaEntry("正文🙂", 2), textDeltaEntry("继续", 3)].map((entry, index) => {
      const visibility = index === 0 ? "internal_sanitized" as const : "user_visible" as const;
      const event: RunnerTextDeltaEvent = method === "item/reasoning/summaryTextDelta"
        ? { method, visibility, params: { ...entry.event.params, summaryIndex: 1 } }
        : { method, visibility, params: entry.event.params };
      return { deliveryId: entry.deliveryId, event };
    });
    for (const entry of entries) {
      await individual.service.ingest(CONVERSATION_ID, entry.event, entry.deliveryId);
    }
    await batched.service.ingestTextDeltaBatch(CONVERSATION_ID, entries);
    const expected = individual.redis.publishConversationEvent.mock.calls.map(([, event]) => event);
    expect(expected).toHaveLength(2);
    expect(batched.redis.publishConversationEvents).toHaveBeenCalledExactlyOnceWith(CONVERSATION_ID, expected);
    expect(batched.tx.insertTextRows.mock.calls[0]?.[0]).toHaveLength(3);
    expect(batched.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(batched.tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(batched.redis.releaseTurnSlot).not.toHaveBeenCalled();
  });

  it("commits consecutive text deltas together and publishes their unchanged payloads only after commit", async () => {
    const fixture = eventFixture();
    let releaseCommit: () => void = () => undefined;
    const commit = new Promise<void>(resolve => { releaseCommit = resolve; });
    fixture.prisma.$transaction.mockImplementationOnce(async action => {
      const result = await action(fixture.tx);
      await commit;
      return result;
    });
    const entries = [textDeltaEntry("甲🙂", 1), textDeltaEntry("乙", 2)];
    const ingest = fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries);
    try {
      await vi.waitFor(() => expect(fixture.tx.insertTextRows).toHaveBeenCalledOnce());
      expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
      expect(fixture.redis.publishConversationEvents).not.toHaveBeenCalled();
      releaseCommit();
      await expect(ingest).resolves.toEqual({ accepted: true });
      expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
      expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
      expect(fixture.redis.publishConversationEvents).toHaveBeenCalledExactlyOnceWith(CONVERSATION_ID, entries.map((entry, index) => expect.objectContaining({
          id: entry.deliveryId, sequence_no: index + 1, event_type: entry.event.method,
          payload: { schema_version: 2, source: "codex_app_server", method: entry.event.method, params: entry.event.params },
        })));
      expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
      expect(fixture.tx.conversationMessage.create).not.toHaveBeenCalled();
      expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
      expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    } finally {
      releaseCommit();
      await ingest.catch(() => undefined);
    }
  });

  it("deduplicates a replayed text group and restores input order even when the database returns rows in reverse", async () => {
    const fixture = eventFixture();
    const entries = [textDeltaEntry("a", 1), textDeltaEntry("b", 2)];
    const create = fixture.tx.insertTextRows.getMockImplementation();
    if (!create) throw new Error("missing create implementation");
    fixture.tx.insertTextRows.mockImplementation(async input => (await create(input)).reverse());
    await fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries);
    fixture.tx.conversationEvent.findMany.mockResolvedValue(textDeltaRows(entries));
    await fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries);
    expect(fixture.tx.insertTextRows).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvents).toHaveBeenNthCalledWith(2, CONVERSATION_ID, [
      expect.objectContaining({ id: entries[0]?.deliveryId, sequence_no: 1 }),
      expect.objectContaining({ id: entries[1]?.deliveryId, sequence_no: 2 }),
    ]);
  });

  it("treats differently cased delivery UUIDs as the same durable event, matching PostgreSQL", async () => {
    const fixture = eventFixture();
    const first = textDeltaEntry("a", 1);
    first.deliveryId = "a0000000-0000-4000-8000-00000000000b";
    const upper = { ...first, deliveryId: first.deliveryId.toUpperCase() };
    const second = textDeltaEntry("b", 2);
    await fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [upper, second, first]);
    expect(fixture.tx.insertTextRows).toHaveBeenCalledOnce();
    expect(fixture.tx.insertTextRows.mock.calls[0]?.[0].map(row => row.id)).toEqual([first.deliveryId, second.deliveryId]);
    fixture.tx.conversationEvent.findMany.mockResolvedValue(textDeltaRows([first, second]));
    await fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [upper, second]);
    expect(fixture.tx.insertTextRows).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvents).toHaveBeenNthCalledWith(2, CONVERSATION_ID, [
      expect.objectContaining({ id: first.deliveryId, sequence_no: 1 }),
      expect.objectContaining({ id: second.deliveryId, sequence_no: 2 }),
    ]);
  });

  it("does not write or acknowledge text whose turn projection is pending", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationTurn.findFirst.mockResolvedValue(null);
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [textDeltaEntry("a", 1), textDeltaEntry("b", 2)])).resolves.toMatchObject({ accepted: false, reason_code: "TURN_PROJECTION_PENDING" });
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("checks the active branch again inside the text transaction", async () => {
    const fixture = eventFixture();
    fixture.tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [textDeltaEntry("a", 1), textDeltaEntry("b", 2)])).resolves.toMatchObject({ accepted: true, ignored: true, reason_code: "STALE_BRANCH" });
    expect(fixture.tx.insertTextRows).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("propagates text insertion failure without publishing uncommitted events or applying completion effects", async () => {
    const fixture = eventFixture();
    fixture.tx.insertTextRows.mockRejectedValueOnce(new Error("disk write failed"));
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [textDeltaEntry("a", 1), textDeltaEntry("b", 2)])).rejects.toThrow("disk write failed");
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a text group spanning native streams before starting a transaction", async () => {
    const fixture = eventFixture();
    const second = textDeltaEntry("b", 2);
    second.event.params.turnId = "another-turn";
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [textDeltaEntry("a", 1), second])).rejects.toThrow();
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a delivery id belonging to another conversation without exposing or overwriting its event", async () => {
    const fixture = eventFixture();
    const entries = [textDeltaEntry("a", 1), textDeltaEntry("b", 2)];
    fixture.tx.conversationEvent.findMany.mockResolvedValue([{ ...eventRow(), id: entries[0]?.deliveryId ?? "", conversationId: OTHER_ID, eventType: "item/agentMessage/delta" }]);
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries)).rejects.toThrow("delivery id collision");
    expect(fixture.tx.insertTextRows).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("retries Redis notification after commit without inserting the text again", async () => {
    const fixture = eventFixture();
    const entries = [textDeltaEntry("a", 1), textDeltaEntry("b", 2)];
    fixture.redis.publishConversationEvents.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries)).rejects.toThrow("redis unavailable");
    fixture.tx.conversationEvent.findMany.mockResolvedValue(textDeltaRows(entries));
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries)).resolves.toEqual({ accepted: true });
    expect(fixture.tx.insertTextRows).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvents).toHaveBeenCalledTimes(2);
  });

  it("rejects an incomplete insert result without publishing any part of the text group", async () => {
    const fixture = eventFixture();
    const entries = [textDeltaEntry("a", 1), textDeltaEntry("b", 2)];
    fixture.tx.insertTextRows.mockResolvedValueOnce([{ id: entries[0]!.deliveryId, createdAt: NOW }]);
    await expect(fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries)).rejects.toThrow("did not persist every entry");
    expect(fixture.redis.publishConversationEvents).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
  });

  it("keeps internal text in storage while excluding it from Redis notifications", async () => {
    const fixture = eventFixture();
    const hidden = textDeltaEntry("internal", 1);
    hidden.event.visibility = "internal_sanitized";
    const visible = textDeltaEntry("visible", 2);
    await fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, [hidden, visible]);
    expect(fixture.tx.insertTextRows.mock.calls[0]?.[0]).toHaveLength(2);
    expect(fixture.redis.publishConversationEvents).toHaveBeenCalledExactlyOnceWith(CONVERSATION_ID, [expect.objectContaining({ id: visible.deliveryId, sequence_no: 2 })]);
  });

  it("binds Unicode, quotes and SQL-like model output as data and preserves it in the published text", async () => {
    const fixture = eventFixture();
    const entries = [textDeltaEntry("引号'；DROP TABLE conversation_events; --", 1), textDeltaEntry('\\路径\n🙂 "正文"', 2)];
    await fixture.service.ingestTextDeltaBatch(CONVERSATION_ID, entries);
    const query = fixture.tx.$queryRaw.mock.calls.map(([value]) => value).find(value => "sql" in value && value.sql.includes("INSERT INTO conversation_events"));
    if (!query || !("sql" in query)) throw new Error("missing parameterized text insert");
    expect(query.sql).not.toContain("DROP TABLE");
    expect(query.values.slice(0, 2)).toEqual([CONVERSATION_ID, TURN_ID]);
    const encoded = query.values[2];
    if (typeof encoded !== "string") throw new Error("missing bound text rows");
    expect(JSON.parse(encoded)).toEqual(entries.map((entry, index) => ({
      id: entry.deliveryId, sequence_no: String(index + 1), event_type: entry.event.method,
      visibility: entry.event.visibility, sse_event_id: `${CONVERSATION_ID}:${index + 1}`,
      payload_json: { schema_version: 2, source: "codex_app_server", method: entry.event.method, params: entry.event.params },
    })));
    expect(fixture.redis.publishConversationEvents).toHaveBeenCalledExactlyOnceWith(CONVERSATION_ID, entries.map(entry => expect.objectContaining({
      id: entry.deliveryId, payload: expect.objectContaining({ params: entry.event.params }),
    })));
  });

  it.each(["item/started", "item/completed"])("publishes preparation %s before the user turn exists without changing execution state", async (method) => {
    const fixture = eventFixture();
    fixture.tx.conversationTurnStartIntent.findFirst.mockResolvedValue({ projectionTurnId: TURN_ID });
    const input = {
      method, visibility: "user_visible" as const,
      preparation: { turnId: TURN_ID },
      params: {
        threadId: "native-source-thread", turnId: "native-compact-turn",
        item: { id: "compact-item", type: "contextCompaction" },
      },
    };
    const deliveryId = "90000000-0000-4000-8000-000000000001";
    const result = await fixture.service.ingest(CONVERSATION_ID, input, deliveryId);
    expect(result).toMatchObject({ accepted: true, event: {
      turn_id: TURN_ID, event_type: method,
      payload: { source: "codex_app_server", params: input.params },
    } });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationTurnStartIntent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: CONVERSATION_ID, projectionTurnId: TURN_ID, runnerStatus: { in: ["prepared", "runner_succeeded"] } },
    }));
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurnAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(fixture.conversations.startPending).not.toHaveBeenCalled();
    const stored = fixture.tx.conversationEvent.create.mock.results[0];
    fixture.tx.conversationEvent.findUnique.mockResolvedValue(await stored!.value);
    await fixture.service.ingest(CONVERSATION_ID, input, deliveryId);
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledTimes(2);
  });

  it("accepts delayed preparation after the intent is replaced by its projected turn", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(turnRow());
    await expect(fixture.service.ingest(CONVERSATION_ID, preparationEvent())).resolves.toMatchObject({ accepted: true, event: { turn_id: TURN_ID } });
  });

  it("ignores preparation with no matching admitted request or turn", async () => {
    const fixture = eventFixture();
    await expect(fixture.service.ingest(CONVERSATION_ID, preparationEvent())).resolves.toMatchObject({ accepted: true, ignored: true });
    expect(fixture.tx.conversationTurn.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TURN_ID, conversationId: CONVERSATION_ID } }));
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("ignores preparation from a superseded conversation branch", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce({ ...turnRow(), codexThreadId: "old-branch" });
    await expect(fixture.service.ingest(CONVERSATION_ID, preparationEvent())).resolves.toMatchObject({ accepted: true, ignored: true });
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
  });

  it("rejects preparation metadata on non-compaction items", async () => {
    const fixture = eventFixture();
    const input = preparationEvent();
    await expect(fixture.service.ingest(CONVERSATION_ID, {
      ...input, params: { ...input.params, item: { id: "message", type: "agentMessage", text: "unsafe" } },
    })).rejects.toThrow();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
  });
  it("acknowledges late native events without reviving deployment-stopped turns", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
      { ...turnRow({ status: "failed", completedAt: NOW }), errorCode: "DEPLOYMENT_STOPPED" },
    );
    await expect(fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/started", visibility: "user_visible",
      params: { threadId: "codex-thread-1", turn: { id: "codex-turn-1", status: "inProgress" } },
    })).resolves.toMatchObject({ accepted: true, ignored: true });
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
  });

  it("does not apply a delayed active Goal notification from before deployment", async () => {
    const fixture = eventFixture();
    fixture.prisma.auditLog.findFirst.mockResolvedValueOnce({ createdAt: new Date("2026-09-09T00:00:00Z") });
    await expect(fixture.service.ingest(CONVERSATION_ID, {
      method: "thread/goal/updated", visibility: "user_visible", params: {
        threadId: "codex-thread-1", turnId: "codex-turn-1", goal: {
          threadId: "codex-thread-1", objective: "finish the task", status: "active", tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1_785_996_100, updatedAt: 1_785_996_100,
        },
      },
    })).resolves.toMatchObject({ accepted: true, ignored: true });
    expect(fixture.tx.conversationGoal.upsert).not.toHaveBeenCalled();
  });
  it("validates and publishes an interactive application custom event", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversation.findFirst.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      applicationId: "40000000-0000-4000-8000-000000000001",
      codexThreadId: "codex-thread-1",
      interactiveApplicationPackageId:
        "50000000-0000-4000-8000-000000000001",
    } as never);
    fixture.prisma.interactiveApplicationPackage.findFirst.mockResolvedValueOnce(
      {
        id: "50000000-0000-4000-8000-000000000001",
        manifestJson: {
          schema_version: 1,
          id: "research-workbench",
          name: "Research workbench",
          version: "1.0.0",
          sdk_version: 1,
          custom_events: [
            {
              name: "research.section_ready",
              description: "A section is ready.",
              payload_schema: {
                type: "object",
                additionalProperties: false,
                required: ["title"],
                properties: { title: { type: "string" } },
              },
            },
          ],
        },
      },
    );

    await expect(
      fixture.service.emitInteractiveApplicationCustomEvent({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        event: {
          name: "research.section_ready",
          payload: { title: "Market overview" },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "linksense/application/custom-event",
      }),
    );
  });

  it("records token usage and publishes a collapsed context usage event", async () => {
    const fixture = eventFixture();
    const captureTokenUsage = vi.fn(async () => ({ accepted: true }));
    const service = new ConversationEventService(
      fixture.prisma as never,
      fixture.redis as never,
      fixture.conversations as never,
      undefined,
      undefined,
      { captureTokenUsage },
    );
    const params = {
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      tokenUsage: {
        total: {
          totalTokens: 30,
          inputTokens: 20,
          cachedInputTokens: 5,
          outputTokens: 10,
          reasoningOutputTokens: 3,
        },
        last: {
          totalTokens: 30,
          inputTokens: 20,
          cachedInputTokens: 5,
          outputTokens: 10,
          reasoningOutputTokens: 3,
        },
        modelContextWindow: null,
      },
    };

    await expect(
      service.ingest(
        CONVERSATION_ID,
        {
          method: "thread/tokenUsage/updated",
          visibility: "internal_sanitized",
          params,
        },
        "60000000-0000-4000-8000-000000000010",
      ),
    ).resolves.toMatchObject({
      accepted: true,
      event: {
        event_type: "thread/tokenUsage/updated",
        visibility: "user_collapsed",
        turn_id: TURN_ID,
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "thread/tokenUsage/updated",
          params,
        },
      },
    });
    expect(captureTokenUsage).toHaveBeenCalledWith(CONVERSATION_ID, params);
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "60000000-0000-4000-8000-000000000010",
        eventType: "thread/tokenUsage/updated",
        visibility: "user_collapsed",
        payloadJson: {
          schema_version: 2,
          source: "codex_app_server",
          method: "thread/tokenUsage/updated",
          params,
        },
      }),
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "thread/tokenUsage/updated",
        visibility: "user_collapsed",
      }),
    );
  });

  it.each([true, false])("acknowledges orphan usage only with a deployment stop fence (%s)", async (stopped) => {
    const fixture = eventFixture();
    fixture.prisma.auditLog.findFirst.mockResolvedValue(stopped ? { createdAt: NOW } : null);
    fixture.prisma.conversationTurn.findFirst.mockResolvedValue(null);
    const captureTokenUsage = vi.fn(async () => ({ accepted: false, reason_code: "TURN_PROJECTION_PENDING" }));
    const service = new ConversationEventService(
      { ...fixture.prisma, conversationTurnStartIntent: { findUnique: vi.fn(async () => null) } } as never,
      fixture.redis as never,
      fixture.conversations as never,
      undefined,
      undefined,
      { captureTokenUsage },
    );
    const tokens = { totalTokens: 30, inputTokens: 20, cachedInputTokens: 5, outputTokens: 10, reasoningOutputTokens: 3 };
    await expect(service.ingest(CONVERSATION_ID, {
      method: "thread/tokenUsage/updated", visibility: "internal_sanitized",
      params: { threadId: "codex-thread-1", turnId: "codex-turn-orphan", tokenUsage: { total: tokens, last: tokens, modelContextWindow: null } },
    })).resolves.toMatchObject(stopped
      ? { accepted: true, ignored: true, reason_code: "DEPLOYMENT_STOPPED" }
      : { accepted: false, reason_code: "TURN_PROJECTION_PENDING" });
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
  });

  it("persists one native Codex item event without inventing a LinkSense step or tool event", async () => {
    const fixture = eventFixture();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        completedAtMs: 1_789_000_000_000,
        item: {
          type: "mcpToolCall",
          id: "native-tool-1",
          server: "linksense_core",
          tool: "register_artifact",
          status: "completed",
          durationMs: 125,
        },
      },
    });

    expect(result).toMatchObject({
      accepted: true,
      event: {
        event_type: "item/completed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
        },
      },
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "item/completed",
        visibility: "user_collapsed",
      }),
    });
    const serialized = JSON.stringify(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson,
    );
    expect(serialized).toContain('"type":"mcpToolCall"');
    expect(serialized).not.toContain("conversation.tool");
    expect(serialized).not.toContain("conversation.step");
  });

  it("persists and publishes a sanitized native reasoning summary delta", async () => {
    const fixture = eventFixture();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/reasoning/summaryTextDelta",
      visibility: "user_collapsed",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Evaluating test timing reliability",
      },
    });

    expect(result).toMatchObject({
      accepted: true,
      event: {
        event_type: "item/reasoning/summaryTextDelta",
        payload: {
          method: "item/reasoning/summaryTextDelta",
          params: {
            itemId: "reasoning-1",
            summaryIndex: 0,
            delta: "Evaluating test timing reliability",
          },
        },
      },
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "item/reasoning/summaryTextDelta",
        visibility: "user_collapsed",
      }),
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "item/reasoning/summaryTextDelta",
      }),
    );
  });

  it("persists asynchronous questions once without a duplicate assistant message or an RPC request id", async () => {
    const fixture = eventFixture();
    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed", visibility: "user_visible",
      params: {
        threadId: "codex-thread-1", turnId: "codex-turn-1", completedAtMs: 1_789_000_000_100,
        item: { type: "agentMessage", id: "async-question-1", text: "", phase: "final_answer", delivery: "async",
          questions: [{ title: "Which scope?", options: ["Complete", "Minimal"] }, { title: "Constraints?", options: null }],
        },
      },
    });
    expect(fixture.tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationUserInputRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      conversationId: CONVERSATION_ID, turnId: TURN_ID, ownerId: OWNER_ID,
      codexItemId: "async-question-1", nativeRequestId: null, requestKind: "async_questions",
      status: "pending", autoResolveAt: null,
      questionsJson: [
        { id: "question-1", header: "1", question: "Which scope?", is_other: true, is_secret: false,
          options: [{ label: "Complete", description: "" }, { label: "Minimal", description: "" }] },
        { id: "question-2", header: "2", question: "Constraints?", is_other: true, is_secret: false, options: null },
      ],
    }) });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payloadJson: expect.objectContaining({ local: expect.objectContaining({ user_input_request_id: expect.any(String) }) }),
    }) });
  });

  it.each(["completed", "failed", "interrupted"])("keeps asynchronous questions pending when the source turn becomes %s", async (status) => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed", visibility: "user_visible",
      params: { threadId: "codex-thread-1", turn: { id: "codex-turn-1", status, error: null } },
    });
    expect(fixture.tx.conversationUserInputRequest.updateMany).toHaveBeenCalledWith({
      where: { turnId: TURN_ID, requestKind: { not: "async_questions" }, status: { in: ["pending", "answering"] } },
      data: expect.objectContaining({ status: "cancelled" }),
    });
  });

  it("retains the answered state when an asynchronous item is redelivered with JSONB object key order", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationUserInputRequest.findFirst.mockResolvedValueOnce({
      id: "30000000-0000-4000-8000-000000000019", conversationId: CONVERSATION_ID, turnId: TURN_ID,
      ownerId: OWNER_ID, requestKind: "async_questions", status: "answered",
      questionsJson: [{ options: null, question: "Constraints?", is_secret: false, is_other: true, header: "1", id: "question-1" }],
    });
    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed", visibility: "user_visible",
      params: { threadId: "codex-thread-1", turnId: "codex-turn-1", item: {
        type: "agentMessage", id: "async-question-1", text: "", phase: "final_answer", delivery: "async",
        questions: [{ title: "Constraints?", options: null }],
      } },
    });
    expect(fixture.tx.conversationUserInputRequest.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationUserInputRequest.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the native agentMessage phase while materializing the assistant message", async () => {
    const fixture = eventFixture();

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        completedAtMs: 1_789_000_000_100,
        item: {
          type: "agentMessage",
          id: "native-message-1",
          text: "正在核对下载登记链路。",
          phase: "commentary",
        },
      },
    });

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        role: "assistant",
        contentText: "正在核对下载登记链路。",
      }),
    });
    const payload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(payload).toMatchObject({
      method: "item/completed",
      params: {
        item: {
          id: "native-message-1",
          type: "agentMessage",
          phase: "commentary",
        },
      },
      local: {
        message_id: "70000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("links a blocked native Stop hook to the exact completed final answer", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });
    fixture.tx.conversationEvent.findFirst.mockResolvedValueOnce({
      payloadJson: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          item: {
            type: "agentMessage",
            id: "native-invalid-final-1",
            text: "请切换模式后重试。",
            phase: "final_answer",
          },
        },
        local: {
          message_id: "70000000-0000-4000-8000-000000000009",
        },
      },
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "hook/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        run: { eventName: "stop", status: "blocked" },
        supersededItemId: "native-invalid-final-1",
      },
    });

    expect(fixture.tx.conversationEvent.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventType: "item/completed",
        payloadJson: {
          path: ["params", "item", "id"],
          equals: "native-invalid-final-1",
        },
      },
      orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
      select: { payloadJson: true },
    });
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson,
    ).toMatchObject({
      method: "hook/completed",
      local: {
        superseded_item_id: "native-invalid-final-1",
        superseded_message_id: "70000000-0000-4000-8000-000000000009",
      },
    });
  });

  it("does not supersede commentary when a blocked Stop hook association is invalid", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });
    fixture.tx.conversationEvent.findFirst.mockResolvedValueOnce({
      payloadJson: {
        method: "item/completed",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          item: {
            type: "agentMessage",
            id: "native-commentary-1",
            text: "正在核对数据。",
            phase: "commentary",
          },
        },
        local: {
          message_id: "70000000-0000-4000-8000-000000000008",
        },
      },
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "hook/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        run: { eventName: "stop", status: "blocked" },
        supersededItemId: "native-commentary-1",
      },
    });

    const payload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(payload).not.toHaveProperty("local.superseded_message_id");
    expect(payload).not.toHaveProperty("local.superseded_item_id");
  });

  it("materializes a completed native Plan item as the authoritative assistant response", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "plan",
          id: "native-plan-1",
          text: "## 实施计划\n\n1. 核对原生协议\n2. 完成端到端接入",
        },
      },
    });

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        role: "assistant",
        contentText: "## 实施计划\n\n1. 核对原生协议\n2. 完成端到端接入",
      }),
    });
    expect(fixture.tx.conversationPlanReview.upsert).toHaveBeenCalledWith({
      where: { sourceTurnId: TURN_ID },
      create: {
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
        sourceTurnId: TURN_ID,
        planMessageId: "70000000-0000-4000-8000-000000000001",
        codexItemId: "native-plan-1",
        status: "preparing",
        resolvedAt: null,
      },
      update: {},
    });
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson,
    ).toMatchObject({
      method: "item/completed",
      params: {
        item: { id: "native-plan-1", type: "plan" },
      },
      local: {
        message_id: "70000000-0000-4000-8000-000000000001",
        plan_review_id: PLAN_REVIEW_ID,
      },
    });
  });

  it("does not create a Plan review for a Plan item from a Default turn", async () => {
    const fixture = eventFixture();

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "plan",
          id: "native-plan-default-1",
          text: "## 不应进入计划确认",
        },
      },
    });

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationPlanReview.upsert).not.toHaveBeenCalled();
  });

  it("does not duplicate a Plan review when the native delivery is replayed", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });
    const deliveryId = "60000000-0000-4000-8000-000000000041";
    const persistedEvent = {
      ...eventRow(41n),
      id: deliveryId,
      eventType: "item/completed",
      payloadJson: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          item: {
            type: "plan",
            id: "native-plan-replayed-1",
            text: "## 实施计划",
          },
        },
        local: {
          message_id: "70000000-0000-4000-8000-000000000001",
          plan_review_id: PLAN_REVIEW_ID,
        },
      },
    };
    fixture.tx.conversationEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persistedEvent);
    const input = {
      method: "item/completed",
      visibility: "user_visible" as const,
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "plan",
          id: "native-plan-replayed-1",
          text: "## 实施计划",
        },
      },
    };

    await fixture.service.ingest(CONVERSATION_ID, input, deliveryId);
    await fixture.service.ingest(CONVERSATION_ID, input, deliveryId);

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationPlanReview.upsert).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
  });

  it.each([
    ["completed", "pending", null],
    ["failed", "cancelled", NOW],
  ] as const)(
    "handles a late Plan item after a %s source turn by creating a %s review",
    async (sourceStatus, reviewStatus, resolvedAt) => {
      const fixture = eventFixture(undefined, { collaborationMode: "plan" });
      const terminalTurn = turnRow({
        collaborationMode: "plan",
        status: sourceStatus,
        completedAt: NOW,
      });
      fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
        terminalTurn,
      );
      fixture.tx.conversationTurn.findUnique.mockResolvedValue(terminalTurn);
      fixture.tx.conversationTurn.findFirst.mockResolvedValue(terminalTurn);

      await fixture.service.ingest(CONVERSATION_ID, {
        method: "item/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          item: {
            type: "plan",
            id: `late-plan-${sourceStatus}`,
            text: "## 晚到的实施计划",
          },
        },
      });

      expect(fixture.tx.conversationPlanReview.upsert).toHaveBeenCalledWith({
        where: { sourceTurnId: TURN_ID },
        create: expect.objectContaining({
          conversationId: CONVERSATION_ID,
          sourceTurnId: TURN_ID,
          status: reviewStatus,
          resolvedAt:
            resolvedAt === null ? null : expect.any(Date),
        }),
        update: {},
      });
    },
  );

  it("projects native requestUserInput state without persisting or publishing an answer", async () => {
    const fixture = eventFixture();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/tool/requestUserInput",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        itemId: "native-user-input-item-1",
        requestId: 17,
        questions: [
          {
            id: "implementation_scope",
            header: "范围",
            question: "请选择实施范围。",
            isOther: true,
            isSecret: false,
            options: [
              {
                label: "完整实现（推荐）",
                description: "完成前后端与测试。",
              },
              {
                label: "仅做界面",
                description: "只增加入口。",
              },
            ],
          },
        ],
        isBlocking: false,
        autoResolutionMs: 60_000,
      },
    });

    expect(fixture.tx.conversationUserInputRequest.create).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        ownerId: OWNER_ID,
        codexThreadId: "codex-thread-1",
        codexTurnId: "codex-turn-1",
        codexItemId: "native-user-input-item-1",
        nativeRequestId: 17n,
        requestKind: "questions",
        questionsJson: [
          {
            id: "implementation_scope",
            header: "范围",
            question: "请选择实施范围。",
            is_other: true,
            is_secret: false,
            options: [
              {
                label: "完整实现（推荐）",
                description: "完成前后端与测试。",
              },
              {
                label: "仅做界面",
                description: "只增加入口。",
              },
            ],
          },
        ],
        status: "pending",
        autoResolveAt: expect.any(Date),
      },
    });
    expect(result).toMatchObject({
      accepted: true,
      event: {
        payload: {
          local: {
            user_input_request_id:
              "72000000-0000-4000-8000-000000000001",
          },
        },
      },
    });
    const persistedPayload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(JSON.stringify(persistedPayload)).not.toMatch(/answer/iu);
    expect(
      JSON.stringify(fixture.redis.publishConversationEvent.mock.calls),
    ).not.toMatch(/answer/iu);
  });

  it("does not schedule auto-resolution for a blocking native user-input request", async () => {
    const fixture = eventFixture();

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/tool/requestUserInput",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        itemId: "native-blocking-user-input-item-1",
        requestId: 18,
        questions: [
          {
            id: "implementation_scope",
            header: "范围",
            question: "请选择实施范围。",
            isOther: true,
            isSecret: false,
            options: null,
          },
        ],
        isBlocking: true,
        autoResolutionMs: 60_000,
      },
    });

    expect(fixture.tx.conversationUserInputRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codexItemId: "native-blocking-user-input-item-1",
        nativeRequestId: 18n,
        status: "pending",
        autoResolveAt: null,
      }),
    });
  });

  it("projects a LinkSense form broker request into the durable interaction request", async () => {
    const fixture = eventFixture();
    const ingestStartedAt = Date.now();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      method: "linksense/form/request",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        itemId: "linksense-form-18",
        requestId: 18,
        serverName: "linksense_core",
        message: "请确认发布信息",
        requestedSchema: {
          type: "object",
          properties: {
            title: { type: "string", title: "标题", maxLength: 100 },
            channel: {
              type: "string",
              title: "渠道",
              oneOf: [
                { const: "email", title: "邮件" },
                { const: "teams", title: "Teams" },
              ],
            },
          },
          required: ["title", "channel"],
        },
        uiHints: { title: { control: "textarea" } },
        responseSemantics: { kind: "input" },
        autoResolutionMs: 600_000,
      },
    });
    const ingestFinishedAt = Date.now();

    expect(fixture.tx.conversationUserInputRequest.create).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        ownerId: OWNER_ID,
        codexThreadId: "codex-thread-1",
        codexTurnId: "codex-turn-1",
        codexItemId: "linksense-form-18",
        nativeRequestId: 18n,
        requestKind: "form",
        questionsJson: [],
        serverName: "linksense_core",
        messageText: "请确认发布信息",
        formSchemaJson: {
          type: "object",
          properties: {
            title: { type: "string", title: "标题", maxLength: 100 },
            channel: {
              type: "string",
              title: "渠道",
              oneOf: [
                { const: "email", title: "邮件" },
                { const: "teams", title: "Teams" },
              ],
            },
          },
          required: ["title", "channel"],
        },
        formUiHintsJson: { title: { control: "textarea" } },
        formResponseSemanticsJson: { kind: "input" },
        status: "pending",
        autoResolveAt: expect.any(Date),
      },
    });
    const autoResolveAt = fixture.tx.conversationUserInputRequest.create.mock
      .calls[0]?.[0].data.autoResolveAt;
    expect(autoResolveAt).toBeInstanceOf(Date);
    if (!(autoResolveAt instanceof Date)) {
      throw new Error("Expected a form auto-resolution deadline");
    }
    expect(autoResolveAt.getTime()).toBeGreaterThanOrEqual(
      ingestStartedAt + 600_000,
    );
    expect(autoResolveAt.getTime()).toBeLessThanOrEqual(
      ingestFinishedAt + 600_000,
    );
    expect(result).toMatchObject({
      accepted: true,
      event: {
        payload: {
          schema_version: 1,
          source: "linksense_runner",
          method: "linksense/form/request",
          local: {
            user_input_request_id:
              "72000000-0000-4000-8000-000000000001",
          },
        },
      },
    });
  });

  it.each([
    ["pending", null, "expired", "cancel"],
    ["answering", "accept", "answered", "accept"],
  ] as const)(
    "resolves a native user-input request from %s to %s",
    async (status, resolvedAction, expectedStatus, expectedAction) => {
      const fixture = eventFixture();
      const storedRequest = {
        id: "72000000-0000-4000-8000-000000000001",
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        ownerId: OWNER_ID,
        codexThreadId: "codex-thread-1",
        codexTurnId: "codex-turn-1",
        codexItemId: "native-user-input-item-1",
        nativeRequestId: 17n,
        requestKind: "questions",
        questionsJson: [],
        serverName: null,
        messageText: null,
        formSchemaJson: null,
        formUiHintsJson: null,
        status,
        autoResolveAt: null,
        resolvedAction,
        resolvedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      fixture.prisma.conversationUserInputRequest.findFirst.mockResolvedValueOnce(
        storedRequest,
      );
      fixture.tx.conversationUserInputRequest.findUnique.mockResolvedValueOnce(
        storedRequest,
      );

      const result = await fixture.service.ingest(CONVERSATION_ID, {
        method: "serverRequest/resolved",
        visibility: "user_visible",
        params: { threadId: "codex-thread-1", requestId: 17 },
      });

      expect(fixture.tx.conversationUserInputRequest.update).toHaveBeenCalledWith(
        {
          where: { id: storedRequest.id },
          data: {
            status: expectedStatus,
            resolvedAction: expectedAction,
            resolvedAt: expect.any(Date),
          },
        },
      );
      expect(result).toMatchObject({
        accepted: true,
        event: {
          payload: {
            local: { user_input_request_id: storedRequest.id },
          },
        },
      });
    },
  );

  it("does not replace the native answer when a selected knowledge base has no search call", async () => {
    const fixture = eventFixture(undefined, {
      knowledgeBaseIds: ["81000000-0000-4000-8000-000000000001"],
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "agentMessage",
          id: "native-ungrounded-message",
          text: "OneDrive 是微软提供的云存储服务。",
          phase: "final_answer",
        },
      },
    });

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentText: "OneDrive 是微软提供的云存储服务。",
      }),
    });
    const payload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(payload).toMatchObject({
      params: {
        item: {
          text: "OneDrive 是微软提供的云存储服务。",
        },
      },
    });
  });

  it("does not replace a result-backed native answer that omits source markers", async () => {
    const fixture = eventFixture(undefined, {
      knowledgeBaseIds: ["81000000-0000-4000-8000-000000000001"],
    });
    const knowledgeSources = {
      read: vi.fn(
        async () =>
          new Map([
            [
              "source_ref_1234567890abcdef",
              {
                knowledgeBaseId: "81000000-0000-4000-8000-000000000001",
                documentId: "82000000-0000-4000-8000-000000000001",
                documentVersionId: "83000000-0000-4000-8000-000000000001",
                parentId: "parent-1",
                titlePath: ["第一章"],
                matchedChildIds: ["child-1"],
                pageNumbers: [1],
              },
            ],
          ]),
      ),
    };
    const service = new ConversationEventService(
      fixture.prisma as never,
      fixture.redis as never,
      fixture.conversations as never,
      undefined,
      knowledgeSources as never,
    );
    await service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "agentMessage",
          id: "native-result-without-citation",
          text: "检索过，但没有输出来源标记。",
          phase: "final_answer",
        },
      },
    });

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentText: "检索过，但没有输出来源标记。",
      }),
    });
    expect(
      fixture.tx.conversationMessageKnowledgeCitation.create,
    ).not.toHaveBeenCalled();
  });

  it("atomically removes private source markers and persists exact-version citations", async () => {
    const fixture = eventFixture(undefined, {
      knowledgeBaseIds: ["81000000-0000-4000-8000-000000000001"],
    });
    const sourceRef = "source_ref_1234567890abcdef";
    const knowledgeSources = {
      read: vi.fn(
        async () =>
          new Map([
            [
              sourceRef,
              {
                knowledgeBaseId: "81000000-0000-4000-8000-000000000001",
                documentId: "82000000-0000-4000-8000-000000000001",
                documentVersionId: "83000000-0000-4000-8000-000000000001",
                parentId: "parent-1",
                titlePath: ["第一章"],
                matchedChildIds: ["child-1"],
                pageNumbers: [1],
              },
            ],
          ]),
      ),
    };
    fixture.tx.knowledgeBaseDocumentVersion.findMany.mockResolvedValueOnce([
      {
        id: "83000000-0000-4000-8000-000000000001",
        knowledgeBaseId: "81000000-0000-4000-8000-000000000001",
        documentId: "82000000-0000-4000-8000-000000000001",
      },
    ]);
    const service = new ConversationEventService(
      fixture.prisma as never,
      fixture.redis as never,
      fixture.conversations as never,
      undefined,
      knowledgeSources as never,
    );
    await service.ingest(CONVERSATION_ID, {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "agentMessage",
          id: "native-message-with-citation",
          text: `知识结论[[kb-source:${sourceRef}]]。`,
          phase: "final_answer",
        },
      },
    });

    expect(knowledgeSources.read).toHaveBeenCalledWith(TURN_ID);
    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentText: "知识结论。" }),
    });
    expect(
      fixture.tx.conversationMessageKnowledgeCitation.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: "70000000-0000-4000-8000-000000000001",
        documentVersionId: "83000000-0000-4000-8000-000000000001",
        citationNo: 1,
      }),
    });
    expect(
      fixture.tx.knowledgeBaseDocumentVersion.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: { in: ["83000000-0000-4000-8000-000000000001"] },
      },
      data: { cleanupEligibleAt: null },
    });
    expect(
      fixture.tx.conversationMessageKnowledgeCitationAnchor.createMany,
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          occurrenceNo: 1,
          anchorAfterOffsetUtf16: 4,
        }),
      ],
    });
    const payload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(JSON.stringify(payload)).not.toContain(sourceRef);
    expect(payload).toMatchObject({
      params: { item: { text: "知识结论。" } },
    });
  });

  it("projects a native terminal turn but publishes only turn/completed", async () => {
    const titleRefresh = { schedule: vi.fn() };
    const fixture = eventFixture(titleRefresh);
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.tx.automationRun.findFirst.mockResolvedValueOnce({
      id: "50000000-0000-4000-8000-000000000001",
      automationId: "51000000-0000-4000-8000-000000000001",
    });
    fixture.tx.conversationMessage.findMany.mockResolvedValueOnce([
      { contentText: "自动化最终内容" },
    ]);

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "completed", completionUnread: true },
    });
    expect(fixture.tx.automationRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "50000000-0000-4000-8000-000000000001",
        status: { in: ["dispatching", "queued", "started"] },
        completedAt: null,
      },
      data: { completedAt: expect.any(Date), errorCode: null },
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.eventType,
    ).toBe("turn/completed");
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ event_type: "turn/completed" }),
    );
    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledWith(
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(fixture.confirmRecovery).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      ownerId: OWNER_ID,
      projectionTurnId: TURN_ID,
      capabilityGeneration: CAPABILITY_GENERATION,
    });
    expect(titleRefresh.schedule).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("persists streamed assistant text before an interrupted turn becomes terminal", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([
      {
        sequenceNo: 11n,
        eventType: "item/agentMessage/delta",
        payloadJson: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/agentMessage/delta",
          params: {
            threadId: "codex-thread-1",
            turnId: "codex-turn-1",
            itemId: "native-partial-message",
            delta: "已经输出",
          },
        },
      },
      {
        sequenceNo: 12n,
        eventType: "item/agentMessage/delta",
        payloadJson: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/agentMessage/delta",
          params: {
            threadId: "codex-thread-1",
            turnId: "codex-turn-1",
            itemId: "native-partial-message",
            delta: "的内容",
          },
        },
      },
    ] as never);
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "interrupted" },
      },
    });

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        role: "assistant",
        contentText: "已经输出的内容",
      }),
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledTimes(2);
    expect(fixture.tx.conversationEvent.create).toHaveBeenNthCalledWith(
      1,
      {
        data: expect.objectContaining({
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
          eventType: "conversation.message.completed",
          visibility: "user_visible",
          payloadJson: {
            schema_version: 1,
            message_id: "70000000-0000-4000-8000-000000000001",
            role: "assistant",
            item_id: "native-partial-message",
          },
        }),
      },
    );
    expect(fixture.tx.conversationEvent.create).toHaveBeenNthCalledWith(
      2,
      {
        data: expect.objectContaining({ eventType: "turn/completed" }),
      },
    );
    expect(fixture.redis.publishConversationEvent).toHaveBeenNthCalledWith(
      1,
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "conversation.message.completed",
        payload: expect.objectContaining({
          message_id: "70000000-0000-4000-8000-000000000001",
          item_id: "native-partial-message",
        }),
      }),
    );
    expect(fixture.redis.publishConversationEvent).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ID,
      expect.objectContaining({ event_type: "turn/completed" }),
    );
  });

  it("does not persist streamed text again when Codex completed the agent message before interruption", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([
      {
        sequenceNo: 11n,
        eventType: "item/agentMessage/delta",
        payloadJson: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/agentMessage/delta",
          params: {
            threadId: "codex-thread-1",
            turnId: "codex-turn-1",
            itemId: "native-completed-message",
            delta: "权威正文",
          },
        },
      },
      {
        sequenceNo: 12n,
        eventType: "item/completed",
        payloadJson: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            threadId: "codex-thread-1",
            turnId: "codex-turn-1",
            item: {
              id: "native-completed-message",
              type: "agentMessage",
              text: "权威正文",
            },
          },
        },
      },
    ] as never);
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "interrupted" },
      },
    });

    expect(fixture.tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.eventType,
    ).toBe("turn/completed");
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledOnce();
  });

  it("reuses the persisted interrupted message when terminal delivery is retried", async () => {
    const fixture = eventFixture();
    const deliveryId = "60000000-0000-4000-8000-000000000099";
    const partialMessageEvent = {
      ...eventRow(12n),
      eventType: "conversation.message.completed",
      payloadJson: {
        schema_version: 1,
        message_id: "70000000-0000-4000-8000-000000000001",
        role: "assistant",
        item_id: "native-partial-message",
      },
    };
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([
      {
        ...eventRow(11n),
        eventType: "item/agentMessage/delta",
        payloadJson: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/agentMessage/delta",
          params: {
            threadId: "codex-thread-1",
            turnId: "codex-turn-1",
            itemId: "native-partial-message",
            delta: "已经输出的内容",
          },
        },
      },
      partialMessageEvent,
    ] as never);
    fixture.tx.conversationEvent.findUnique.mockResolvedValueOnce({
      ...eventRow(13n),
      id: deliveryId,
      eventType: "turn/completed",
      payloadJson: {
        schema_version: 2,
        source: "codex_app_server",
        method: "turn/completed",
        params: {
          threadId: "codex-thread-1",
          turn: { id: "codex-turn-1", status: "interrupted" },
        },
      },
    });

    await fixture.service.ingest(
      CONVERSATION_ID,
      {
        method: "turn/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: { id: "codex-turn-1", status: "interrupted" },
        },
      },
      deliveryId,
    );

    expect(fixture.tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).toHaveBeenNthCalledWith(
      1,
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "conversation.message.completed",
        sse_event_id: `${CONVERSATION_ID}:12`,
      }),
    );
    expect(fixture.redis.publishConversationEvent).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "turn/completed",
        sse_event_id: `${CONVERSATION_ID}:13`,
      }),
    );
  });

  it("keeps a completed Plan turn terminal while persisting a visible error when no reviewable Plan was produced", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });
    const deliveryId = "60000000-0000-4000-8000-000000000042";
    fixture.tx.conversationPlanReview.findFirst.mockResolvedValue(null);
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.tx.conversationEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sequenceNo: 1n });
    const completedInput = {
      method: "turn/completed",
      visibility: "user_visible" as const,
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    };

    await fixture.service.ingest(CONVERSATION_ID, completedInput, deliveryId);

    expect(fixture.tx.conversationTurnAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: ATTEMPT_ID,
        status: { in: ["pending", "running"] },
      },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "completed", completionUnread: true },
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledTimes(2);
    expect(fixture.tx.conversationEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          schema_version: 1,
          error_code: "PLAN_OUTPUT_MISSING",
          message_key: "errors.conversation.planOutputMissing",
          retryable: true,
        },
      }),
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenNthCalledWith(
      1,
      CONVERSATION_ID,
      expect.objectContaining({
        sequence_no: 1,
        event_type: "turn/completed",
        sse_event_id: `${CONVERSATION_ID}:1`,
      }),
    );
    expect(fixture.redis.publishConversationEvent).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ID,
      expect.objectContaining({
        sequence_no: 2,
        event_type: "conversation.error",
        visibility: "user_visible",
        payload: {
          schema_version: 1,
          error_code: "PLAN_OUTPUT_MISSING",
          message_key: "errors.conversation.planOutputMissing",
          retryable: true,
        },
        sse_event_id: `${CONVERSATION_ID}:2`,
      }),
    );
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).not.toHaveBeenCalled();

    const persistedNativeEvent = await fixture.tx.conversationEvent.create.mock
      .results[0]!.value;
    fixture.tx.conversationEvent.findUnique.mockResolvedValueOnce(
      persistedNativeEvent,
    );
    await fixture.service.ingest(CONVERSATION_ID, completedInput, deliveryId);

    const publishedEvents = fixture.redis.publishConversationEvent.mock
      .calls as unknown as Array<[string, { event_type: string }]>;
    expect(
      publishedEvents.filter(
        ([, event]) => event.event_type === "conversation.error",
      ),
    ).toHaveLength(1);
  });

  it("does not persist the Plan output error when a native Plan review exists", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    });

    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.eventType,
    ).toBe("turn/completed");
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ event_type: "turn/completed" }),
    );
  });

  it.each([
    ["completed", "pending"],
    ["failed", "cancelled"],
    ["interrupted", "cancelled"],
  ] as const)(
    "settles a prepared Plan review when the source turn becomes %s",
    async (terminalStatus, expectedReviewStatus) => {
      const fixture = eventFixture(undefined, { collaborationMode: "plan" });
      fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

      await fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: { id: "codex-turn-1", status: terminalStatus },
        },
      });

      expect(fixture.tx.conversationPlanReview.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: CONVERSATION_ID,
          sourceTurnId: TURN_ID,
          status: "preparing",
        },
        data:
          expectedReviewStatus === "pending"
            ? { status: "pending" }
            : { status: "cancelled", resolvedAt: expect.any(Date) },
      });
    },
  );

  it("cancels a prepared Plan review when a queued follow-up already exists", async () => {
    const fixture = eventFixture(undefined, { collaborationMode: "plan" });
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.tx.pendingRequest.findFirst.mockResolvedValueOnce({
      id: "60000000-0000-4000-8000-000000000020",
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    });

    expect(fixture.tx.conversationPlanReview.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        sourceTurnId: TURN_ID,
        status: "preparing",
      },
      data: { status: "cancelled", resolvedAt: expect.any(Date) },
    });
  });

  it("keeps the logical Goal turn running while the native Goal remains active", async () => {
    const titleRefresh = { schedule: vi.fn() };
    const fixture = eventFixture(titleRefresh, {
      taskKind: "goal",
      activeGoal: true,
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    });

    expect(fixture.tx.conversationTurnAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: ATTEMPT_ID,
        status: { in: ["pending", "running"] },
      },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(fixture.confirmRecovery).not.toHaveBeenCalled();
    expect(titleRefresh.schedule).not.toHaveBeenCalled();
  });

  it("fails an automation completion that has no assistant content or artifact", async () => {
    const fixture = eventFixture();
    const run = {
      id: "50000000-0000-4000-8000-000000000002",
      automationId: "51000000-0000-4000-8000-000000000002",
    };
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.tx.automationRun.findFirst
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ id: run.id });
    fixture.tx.automationRun.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    });

    expect(fixture.tx.automationRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: run.id,
        status: { in: ["dispatching", "queued", "started"] },
        completedAt: null,
      },
      data: {
        status: "failed",
        turnId: null,
        pendingRequestId: null,
        errorCode: "AUTOMATION_EMPTY_RESULT",
      },
    });
    expect(fixture.tx.automation.updateMany).toHaveBeenCalledWith({
      where: { id: run.automationId, deletedAt: null },
      data: {
        lastRunStatus: "failed",
        lastErrorCode: "AUTOMATION_EMPTY_RESULT",
      },
    });
    expect(fixture.tx.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "completed" },
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledTimes(2);
    expect(fixture.tx.conversationEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          schema_version: 1,
          error_code: "AUTOMATION_EMPTY_RESULT",
          message_key: "errors.automation.emptyResult",
          retryable: true,
        },
      }),
    });
    expect(fixture.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "automation_run_empty_result",
        result: "failure",
      }),
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ event_type: "turn/completed" }),
    );
  });

  it("accepts a registered downloadable artifact as automation output", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.tx.automationRun.findFirst.mockResolvedValueOnce({
      id: "50000000-0000-4000-8000-000000000003",
      automationId: "51000000-0000-4000-8000-000000000003",
    });
    fixture.tx.conversationFile.findFirst.mockResolvedValueOnce({
      id: "52000000-0000-4000-8000-000000000003",
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    });

    expect(fixture.tx.automationRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "50000000-0000-4000-8000-000000000003",
        status: { in: ["dispatching", "queued", "started"] },
        completedAt: null,
      },
      data: { completedAt: expect.any(Date), errorCode: null },
    });
    expect(fixture.tx.automation.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
  });

  it("persists the sanitized native failure reason on the failed turn", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: {
          id: "codex-turn-1",
          status: "failed",
          error: {
            message: "The model provider quota is exhausted.",
            codexErrorInfo: "usageLimitExceeded",
          },
        },
      },
    });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "CODEX_TURN_FAILED",
        errorMessage: "The model provider quota is exhausted.",
      }),
    });
    expect(fixture.tx.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "failed", completionUnread: true },
    });
    expect(fixture.tx.automationRun.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the logical turn running and starts one native continuation after context overflow", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurnAttempt.upsert.mockResolvedValueOnce({
      id: RECOVERY_ATTEMPT_ID,
      status: "pending",
    });

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: {
            id: "codex-turn-1",
            status: "failed",
            error: {
              message: "The model context window was exceeded.",
              codexErrorInfo: "contextWindowExceeded",
            },
          },
        },
      }),
    ).resolves.toEqual({ accepted: true });

    expect(fixture.tx.conversationTurnAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID, status: { in: ["pending", "running"] } },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "CONTEXT_WINDOW_EXCEEDED",
      }),
    });
    expect(fixture.tx.conversationTurnAttempt.upsert).toHaveBeenCalledWith({
      where: {
        turnId_attemptNo: { turnId: TURN_ID, attemptNo: 2 },
      },
      create: expect.objectContaining({
        turnId: TURN_ID,
        attemptNo: 2,
        kind: "context_recovery",
        codexThreadId: "codex-thread-1",
        sourceCodexTurnId: "codex-turn-1",
        status: "pending",
      }),
      update: {},
      select: { id: true, status: true },
    });
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.conversation.update).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ visibility: "internal_sanitized" }),
    });
    expect(fixture.confirmRecovery).toHaveBeenCalledOnce();
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).toHaveBeenCalledWith(RECOVERY_ATTEMPT_ID);
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
  });

  it("does not recursively continue a failed manual context compaction", async () => {
    const fixture = eventFixture(undefined, { taskKind: "compact" });
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: {
          id: "codex-turn-1",
          status: "failed",
          error: {
            message: "The compaction context window was exceeded.",
            codexErrorInfo: "contextWindowExceeded",
          },
        },
      },
    });

    expect(fixture.tx.conversationTurnAttempt.upsert).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "CODEX_TURN_FAILED",
      }),
    });
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledWith(
      CONVERSATION_ID,
      TURN_ID,
    );
  });

  it("retries the same pending context continuation when the terminal delivery is duplicated", async () => {
    const fixture = eventFixture();
    const deliveryId = "60000000-0000-4000-8000-000000000098";
    const persistedEvent = {
      ...eventRow(98n),
      id: deliveryId,
      eventType: "turn/completed",
      visibility: "internal_sanitized",
      payloadJson: {
        schema_version: 2,
        source: "codex_app_server",
        method: "turn/completed",
        params: {
          threadId: "codex-thread-1",
          turn: {
            id: "codex-turn-1",
            status: "failed",
            error: { codexErrorInfo: "contextWindowExceeded" },
          },
        },
      },
    };
    fixture.tx.conversationEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persistedEvent);
    fixture.tx.conversationTurnAttempt.findUnique.mockResolvedValueOnce({
      id: RECOVERY_ATTEMPT_ID,
      status: "pending",
    });
    fixture.conversations.recoverContextWindowAttempt
      .mockRejectedValueOnce(new Error("transient recovery start failure"))
      .mockResolvedValueOnce("running");
    const input = {
      method: "turn/completed",
      visibility: "user_visible" as const,
      params: {
        threadId: "codex-thread-1",
        turn: {
          id: "codex-turn-1",
          status: "failed",
          error: {
            message: "The model context window was exceeded.",
            codexErrorInfo: "contextWindowExceeded",
          },
        },
      },
    };

    await expect(
      fixture.service.ingest(CONVERSATION_ID, input, deliveryId),
    ).resolves.toEqual({ accepted: true });
    await expect(
      fixture.service.ingest(CONVERSATION_ID, input, deliveryId),
    ).resolves.toEqual({ accepted: true });

    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationTurnAttempt.upsert).toHaveBeenCalledOnce();
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).toHaveBeenCalledTimes(2);
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).toHaveBeenNthCalledWith(1, RECOVERY_ATTEMPT_ID);
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).toHaveBeenNthCalledWith(2, RECOVERY_ATTEMPT_ID);
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
  });

  it("ignores late events from the failed native turn after the logical turn advances", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce({
      ...turnRow(),
      codexTurnId: "codex-turn-2",
    });

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: {
            id: "codex-turn-1",
            status: "failed",
            error: {
              message: "The model context window was exceeded.",
              codexErrorInfo: "contextWindowExceeded",
            },
          },
        },
      }),
    ).resolves.toEqual({
      accepted: true,
      ignored: true,
      reason_code: "STALE_BRANCH",
    });

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.confirmRecovery).not.toHaveBeenCalled();
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
  });

  it("bounds context recovery to one continuation and fails the logical turn on a second overflow", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({
        id: RECOVERY_ATTEMPT_ID,
        attemptNo: 2,
        kind: "context_recovery",
      }),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turn: {
          id: "codex-turn-1",
          status: "failed",
          error: {
            message: "The model context window was exceeded again.",
            codexErrorInfo: "contextWindowExceeded",
          },
        },
      },
    });

    expect(fixture.tx.conversationTurnAttempt.upsert).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "CODEX_TURN_FAILED",
      }),
    });
    expect(
      fixture.conversations.recoverContextWindowAttempt,
    ).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledWith(
      CONVERSATION_ID,
      TURN_ID,
    );
  });

  it("retries terminal confirmation after a lost response without duplicating the durable projection", async () => {
    const fixture = eventFixture();
    const deliveryId = "60000000-0000-4000-8000-000000000099";
    const persistedEvent = {
      ...eventRow(99n),
      id: deliveryId,
      eventType: "turn/completed",
      payloadJson: {
        schema_version: 2,
        source: "codex_app_server",
        method: "turn/completed",
        params: {
          threadId: "codex-thread-1",
          turn: { id: "codex-turn-1", status: "completed" },
        },
      },
    };
    fixture.tx.conversationEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persistedEvent);
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.confirmRecovery
      .mockRejectedValueOnce(new AppError("RUNNER_UNAVAILABLE"))
      .mockResolvedValueOnce({ confirmed: true });
    const input = {
      method: "turn/completed",
      visibility: "user_visible" as const,
      params: {
        threadId: "codex-thread-1",
        turn: { id: "codex-turn-1", status: "completed" },
      },
    };

    await expect(
      fixture.service.ingest(CONVERSATION_ID, input, deliveryId),
    ).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    await expect(
      fixture.service.ingest(CONVERSATION_ID, input, deliveryId),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.confirmRecovery).toHaveBeenCalledTimes(2);
    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledOnce();
  });

  it("stores and fans out only whitelisted scalar metadata for a user-visible runner event", async () => {
    const fixture = eventFixture();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.tool.completed",
      visibility: "user_collapsed",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: {
        schema_version: 1,
        item_id: "item-1",
        action: "read",
        message_key: "conversation.toolCompleted",
        command: "cat /private/secret.txt",
        arguments: { token: "secret" },
        output: "SECRET TOOL OUTPUT",
        internal_path: "/private/workspace",
      },
    });

    expect(result.accepted).toBe(true);
    const createdPayload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(createdPayload).toEqual({
      schema_version: 1,
      item_id: "item-1",
      action: "read",
      safe_summary: "read",
    });
    const serialized = JSON.stringify(createdPayload);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("token");
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ payload: createdPayload }),
    );
  });

  it("persists internal-sanitized events for diagnostics but never leaks them through live SSE fan-out", async () => {
    const fixture = eventFixture();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.internal.observed",
      visibility: "internal_sanitized",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: { schema_version: 1, reason_code: "INTERNAL_RECOVERY" },
    });

    expect(result.accepted).toBe(true);
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ visibility: "internal_sanitized" }),
    });
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("persists a native thread title without requiring a turn projection and fans out the generated title", async () => {
    const fixture = eventFixture();
    fixture.tx.conversation.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await fixture.service.ingest(
      CONVERSATION_ID,
      {
        eventType: "conversation.title.updated",
        visibility: "user_visible",
        threadId: "codex-thread-1",
        payload: {
          schema_version: 1,
          title: "  自动生成的\n任务名称  ",
        },
      },
      "60000000-0000-4000-8000-000000000099",
    );

    expect(result).toMatchObject({
      accepted: true,
      event: {
        turn_id: null,
        event_type: "conversation.title.updated",
        payload: {
          schema_version: 1,
          title: "自动生成的 任务名称",
          thread_id: "codex-thread-1",
        },
      },
    });
    expect(fixture.prisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      select: { codexThreadId: true },
    });
    expect(fixture.prisma.conversationTurn.findFirst).not.toHaveBeenCalled();
    expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        codexThreadId: "codex-thread-1",
        titleSource: "fallback",
      },
      data: {
        title: "自动生成的 任务名称",
        titleSource: "generated",
      },
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        turn_id: null,
        event_type: "conversation.title.updated",
      }),
    );
  });

  it("does not overwrite a manual or already-generated title when a title update is repeated", async () => {
    const fixture = eventFixture();
    fixture.tx.conversation.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.title.updated",
      visibility: "user_visible",
      threadId: "codex-thread-1",
      payload: { schema_version: 1, title: "不应覆盖的名称" },
    });

    expect(result).toEqual({ accepted: true, ignored: true });
    expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ titleSource: "fallback" }),
      data: {
        title: "不应覆盖的名称",
        titleSource: "generated",
      },
    });
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("safely ignores an empty native thread title", async () => {
    const fixture = eventFixture();

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        eventType: "conversation.title.updated",
        visibility: "user_visible",
        threadId: "codex-thread-1",
        payload: { schema_version: 1, title: " \n\t " },
      }),
    ).resolves.toEqual({ accepted: true, ignored: true });

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.conversation.updateMany).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("projects an explicitly used attached skill and never treats attachment alone as usage", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationEvent.findMany.mockResolvedValueOnce([
      {
        payloadJson: {
          schema_version: 1,
          capability_id: "80000000-0000-4000-8000-000000000001",
          capability_type: "skill",
          usage_type: "auto_skill",
          priority_requested: false,
          name: "presentations",
          scope: "personal",
          source_type: "local",
          status: "active",
        },
      } as never,
    ]);

    await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.capability.used",
      visibility: "user_collapsed",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: {
        schema_version: 1,
        capability_reference: "presentations",
        capability_type: "skill",
        usage_type: "auto_skill",
        safe_summary: "skill_invoked",
      },
    });

    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson,
    ).toEqual({
      schema_version: 1,
      capability_id: "80000000-0000-4000-8000-000000000001",
      capability_type: "skill",
      usage_type: "auto_skill",
      name: "presentations",
      safe_summary: "skill_invoked",
    });
  });

  it("acknowledges but does not invent usage for an unattached capability reference", async () => {
    const fixture = eventFixture();

    const result = await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.capability.used",
      visibility: "user_collapsed",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: {
        schema_version: 1,
        capability_reference: "not-attached",
        capability_type: "skill",
        usage_type: "auto_skill",
        safe_summary: "skill_invoked",
      },
    });

    expect(result).toEqual({ accepted: true, ignored: true });
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("projects a terminal status exactly once, releases capacity, and attempts only the FIFO head", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.prisma.pendingRequest.findFirst.mockResolvedValueOnce({
      id: "pending-head",
      status: "waiting_previous_turn",
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.status.changed",
      visibility: "user_visible",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: {
        turn_status: "completed",
        content: "must not survive",
        retry_attempt: 99,
      },
    });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "completed", completionUnread: true },
    });
    expect(fixture.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "conversation_turn_completed",
        result: "success",
        metadataJson: { conversation_id: CONVERSATION_ID },
      }),
    });
    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledWith(
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(fixture.conversations.startPending).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      "pending-head",
      {},
    );
    const payload =
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson;
    expect(payload).toEqual({
      schema_version: 1,
      turn_id: TURN_ID,
      turn_status: "completed",
      conversation_execution_status: "completed",
    });
  });

  it("does not skip a pending guide reservation to start a later request", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.prisma.pendingRequest.findFirst.mockResolvedValueOnce({
      id: "pending-guiding-head",
      status: "steering",
    });

    await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.status.changed",
      visibility: "user_visible",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: { turn_status: "completed" },
    });

    expect(fixture.prisma.pendingRequest.findFirst).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      orderBy: { queueNo: "asc" },
    });
    expect(fixture.conversations.startPending).not.toHaveBeenCalled();
  });

  it("does not duplicate terminal projection but safely retries its tokenized post-actions", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 0 });

    await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.status.changed",
      visibility: "user_visible",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: { turn_status: "failed", error_code: "CODEX_TURN_FAILED" },
    });

    expect(fixture.tx.conversation.update).not.toHaveBeenCalled();
    expect(fixture.tx.auditLog.create).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledWith(
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(fixture.prisma.pendingRequest.findFirst).toHaveBeenCalledOnce();
    expect(fixture.conversations.startPending).not.toHaveBeenCalled();
  });

  it("marks a newly projected failed status as unread", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.status.changed",
      visibility: "user_visible",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: { turn_status: "failed", error_code: "CODEX_TURN_FAILED" },
    });

    expect(fixture.tx.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "failed", completionUnread: true },
    });
  });

  it("rejects a terminal delivery when capacity release is unavailable so the durable runner outbox retries it", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.redis.releaseTurnSlot.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        eventType: "conversation.status.changed",
        visibility: "user_visible",
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        payload: { turn_status: "completed" },
      }),
    ).rejects.toThrow("redis unavailable");
    expect(fixture.prisma.pendingRequest.findFirst).not.toHaveBeenCalled();
  });

  it("treats reconnect as the same running native turn without attempts, terminal transition, or input replay", async () => {
    const fixture = eventFixture();

    await fixture.service.ingest(CONVERSATION_ID, {
      eventType: "conversation.reconnect",
      visibility: "user_collapsed",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: {
        willRetry: true,
        attempt: 3,
        original_input: "private request",
      },
    });

    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(fixture.conversations.startPending).not.toHaveBeenCalled();
    expect(
      fixture.tx.conversationEvent.create.mock.calls[0]?.[0].data.payloadJson,
    ).toEqual({
      schema_version: 1,
      codex_turn_id: "codex-turn-1",
      reason_code: "transport_interrupted",
      will_retry: true,
      message_key: "conversation.codexReconnecting",
    });
  });

  it("rejects events until the local turn projection exists without persisting or publishing anything", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(null);

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        eventType: "conversation.status.changed",
        visibility: "user_visible",
        threadId: "codex-thread-missing",
        turnId: "codex-turn-missing",
        payload: { turn_status: "completed" },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason_code: "TURN_PROJECTION_PENDING",
    });

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("acknowledges a native event from an obsolete Codex branch without persisting or publishing it", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversation.findUnique.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      codexThreadId: "codex-thread-current",
    });

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "item/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          item: {
            id: "obsolete-agent-message",
            type: "agentMessage",
            text: "不应进入当前分支",
          },
        },
      }),
    ).resolves.toEqual({
      accepted: true,
      ignored: true,
      reason_code: "STALE_BRANCH",
    });

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("keeps a new Codex branch notification pending until its local turn projection exists", async () => {
    const fixture = eventFixture();
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(null);

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/started",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-fork",
          turn: { id: "codex-turn-fork", status: "inProgress" },
        },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason_code: "TURN_PROJECTION_PENDING",
    });

    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("acknowledges an unprojected Goal turn that races the running primary attempt", async () => {
    const fixture = eventFixture(undefined, {
      taskKind: "goal",
      activeGoal: true,
    });
    const unexpectedTurnId = "codex-turn-goal-race";
    fixture.tx.conversationGoal.findFirst.mockResolvedValueOnce(goalRow());
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal" }),
    );
    fixture.tx.conversationTurnAttempt.findFirst.mockResolvedValueOnce(
      attemptRow({ status: "running" }),
    );
    fixture.prisma.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      null,
    );
    fixture.prisma.conversationTurn.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(turnRow({ taskKind: "goal" }));

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/started",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: { id: unexpectedTurnId, status: "inProgress" },
        },
      }),
    ).resolves.toEqual({
      accepted: true,
      ignored: true,
      reason_code: "STALE_BRANCH",
    });

    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationTurnAttempt.create).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("attaches a native Goal continuation to the existing logical turn", async () => {
    const fixture = eventFixture(undefined, {
      taskKind: "goal",
      activeGoal: true,
    });
    const continuationTurnId = "codex-turn-goal-continuation";
    fixture.tx.conversationGoal.findFirst.mockResolvedValueOnce(goalRow());
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal" }),
    );
    fixture.tx.conversationTurnAttempt.findFirst.mockResolvedValueOnce(
      attemptRow({ status: "completed" }),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.prisma.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({
        attemptNo: 2,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        status: "running",
      }),
    );
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal", codexTurnId: continuationTurnId }),
    );

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/started",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: { id: continuationTurnId, status: "inProgress" },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurnAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnId: TURN_ID,
        attemptNo: 2,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        sourceCodexTurnId: "codex-turn-1",
        status: "running",
      }),
    });
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        status: "running",
        codexTurnId: "codex-turn-1",
      },
      data: { codexTurnId: continuationTurnId },
    });
  });

  it("reopens a terminal logical Goal when its native continuation starts after recovery", async () => {
    const fixture = eventFixture(undefined, {
      taskKind: "goal",
      activeGoal: true,
    });
    const continuationTurnId = "codex-turn-goal-after-recovery";
    fixture.tx.conversationGoal.findFirst.mockResolvedValueOnce(goalRow());
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal", status: "completed", completedAt: NOW }),
    );
    fixture.tx.conversationTurnAttempt.findFirst.mockResolvedValueOnce(
      attemptRow({ status: "completed" }),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.prisma.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({
        attemptNo: 2,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        status: "running",
      }),
    );
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal", codexTurnId: continuationTurnId }),
    );

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/started",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: { id: continuationTurnId, status: "inProgress" },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        status: "completed",
        codexTurnId: "codex-turn-1",
      },
      data: {
        codexTurnId: continuationTurnId,
        status: "running",
        completedAt: null,
        interruptRequestedAt: null,
        interruptedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        codexThreadId: "codex-thread-1",
      },
      data: {
        lastTurnStatus: "running",
        lastRunAt: expect.any(Date),
      },
    });
  });

  it("attaches a historical Goal continuation after recovery already projected the blocked Goal", async () => {
    const fixture = eventFixture(undefined, { taskKind: "goal" });
    const continuationTurnId = "codex-turn-goal-before-blocked";
    const nativeCreatedAt = new Date("2026-08-17T08:58:21.000Z");
    const nativeUpdatedAt = new Date("2026-08-17T09:05:57.000Z");
    const terminalTurn = turnRow({
      taskKind: "goal",
      status: "completed",
      completedAt: NOW,
      codexTurnId: "codex-turn-goal-continuation-2",
    });
    fixture.tx.conversationGoal.findFirst.mockResolvedValueOnce(
      goalRow({
        status: "blocked",
        activeTurnId: null,
        nativeCreatedAt,
        nativeUpdatedAt,
      }),
    );
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(terminalTurn);
    fixture.tx.conversationTurn.findUnique.mockResolvedValueOnce(terminalTurn);
    fixture.tx.conversationTurnAttempt.findFirst.mockResolvedValueOnce(
      attemptRow({
        attemptNo: 2,
        kind: "goal_continuation",
        codexTurnId: "codex-turn-goal-continuation-2",
        sourceCodexTurnId: "codex-turn-1",
        status: "completed",
      }),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.prisma.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({
        attemptNo: 3,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        sourceCodexTurnId: "codex-turn-goal-continuation-2",
        status: "running",
      }),
    );
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({
        taskKind: "goal",
        status: "completed",
        completedAt: NOW,
        codexTurnId: continuationTurnId,
      }),
    );

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/started",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: {
            id: continuationTurnId,
            status: "inProgress",
            startedAt: new Date("2026-08-17T09:03:55.000Z").getTime() / 1_000,
          },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurnAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnId: TURN_ID,
        attemptNo: 3,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        sourceCodexTurnId: "codex-turn-goal-continuation-2",
        status: "running",
        startedAt: new Date("2026-08-17T09:03:55.000Z"),
      }),
    });
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        status: "completed",
        codexTurnId: terminalTurn.codexTurnId,
      },
      data: { codexTurnId: continuationTurnId },
    });
    expect(fixture.tx.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("attaches a third native Goal attempt without applying the normal turn retry limit", async () => {
    const fixture = eventFixture(undefined, {
      taskKind: "goal",
      activeGoal: true,
    });
    const previousTurnId = "codex-turn-goal-continuation-2";
    const continuationTurnId = "codex-turn-goal-continuation-3";
    fixture.tx.conversationGoal.findFirst.mockResolvedValueOnce(goalRow());
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal", codexTurnId: previousTurnId }),
    );
    fixture.tx.conversationTurnAttempt.findFirst.mockResolvedValueOnce(
      attemptRow({
        attemptNo: 2,
        kind: "goal_continuation",
        codexTurnId: previousTurnId,
        sourceCodexTurnId: "codex-turn-1",
        status: "completed",
      }),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });
    fixture.prisma.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({
        attemptNo: 3,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        sourceCodexTurnId: previousTurnId,
        status: "running",
      }),
    );
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal", codexTurnId: continuationTurnId }),
    );

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "turn/started",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turn: { id: continuationTurnId, status: "inProgress" },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurnAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnId: TURN_ID,
        attemptNo: 3,
        kind: "goal_continuation",
        codexTurnId: continuationTurnId,
        sourceCodexTurnId: previousTurnId,
        status: "running",
      }),
    });
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        status: "running",
        codexTurnId: previousTurnId,
      },
      data: { codexTurnId: continuationTurnId },
    });
  });

  it("drops an event when the active Codex branch changes while its transaction waits", async () => {
    const fixture = eventFixture();
    fixture.tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "item/completed",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          item: { id: "racing-item", type: "agentMessage", text: "旧分支" },
        },
      }),
    ).resolves.toEqual({
      accepted: true,
      ignored: true,
      reason_code: "STALE_BRANCH",
    });

    expect(fixture.tx.conversationEvent.findUnique).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("acknowledges a stale native thread name but keeps an unprojected fork name pending", async () => {
    const stale = eventFixture();
    stale.prisma.conversation.findUnique.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      codexThreadId: "codex-thread-current",
    });

    await expect(
      stale.service.ingest(CONVERSATION_ID, {
        method: "thread/name/updated",
        visibility: "user_visible",
        params: { threadId: "codex-thread-1", threadName: "旧标题" },
      }),
    ).resolves.toEqual({
      accepted: true,
      ignored: true,
      reason_code: "STALE_BRANCH",
    });
    expect(stale.prisma.$transaction).not.toHaveBeenCalled();

    const pending = eventFixture();
    pending.prisma.conversation.findUnique.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      codexThreadId: "codex-thread-1",
    });
    pending.prisma.conversationTurn.findFirst.mockResolvedValueOnce(null);
    await expect(
      pending.service.ingest(CONVERSATION_ID, {
        method: "thread/name/updated",
        visibility: "user_visible",
        params: { threadId: "codex-thread-fork", threadName: "新标题" },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason_code: "THREAD_PROJECTION_PENDING",
    });
    expect(pending.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists and publishes native Goal updates and clears", async () => {
    const fixture = eventFixture(undefined, { taskKind: "goal" });
    const nativeGoal = {
      threadId: "codex-thread-1",
      objective: "完整实现目标功能",
      status: "active",
      tokenBudget: 12_000,
      tokensUsed: 800,
      timeUsedSeconds: 38,
      createdAt: 1_785_996_000,
      updatedAt: 1_785_996_038,
    } as const;
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(
      turnRow({ taskKind: "goal" }),
    );

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "thread/goal/updated",
      visibility: "user_visible",
      params: {
        threadId: "codex-thread-1",
        turnId: null,
        goal: nativeGoal,
      },
    });

    expect(fixture.tx.conversationGoal.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      create: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
        codexThreadId: "codex-thread-1",
        activeTurnId: TURN_ID,
        objective: "完整实现目标功能",
        status: "active",
        tokenBudget: 12_000n,
      }),
      update: expect.objectContaining({
        activeTurnId: TURN_ID,
        tokensUsed: 800n,
        timeUsedSeconds: 38n,
      }),
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ event_type: "thread/goal/updated" }),
    );

    await fixture.service.ingest(CONVERSATION_ID, {
      method: "thread/goal/cleared",
      visibility: "user_visible",
      params: { threadId: "codex-thread-1" },
    });

    expect(fixture.tx.conversationGoal.deleteMany).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        codexThreadId: "codex-thread-1",
      },
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenLastCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ event_type: "thread/goal/cleared" }),
    );
  });

  it("promotes the running logical turn when Codex creates a Goal during a normal turn", async () => {
    const fixture = eventFixture();
    const nativeGoal = {
      threadId: "codex-thread-1",
      objective: "持续完成已批准的草稿创建",
      status: "active",
      tokenBudget: null,
      tokensUsed: 120,
      timeUsedSeconds: 3,
      createdAt: 1_785_996_000,
      updatedAt: 1_785_996_003,
    } as const;
    fixture.tx.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow(),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "thread/goal/updated",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          goal: nativeGoal,
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        conversationId: CONVERSATION_ID,
        codexThreadId: "codex-thread-1",
        taskKind: "turn",
      },
      data: { taskKind: "goal" },
    });
    expect(fixture.tx.conversationTurnAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        turnId: TURN_ID,
        attemptNo: 1,
        kind: "primary",
      },
      data: { kind: "goal_primary" },
    });
    expect(fixture.tx.conversationGoal.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      create: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        activeTurnId: TURN_ID,
        objective: nativeGoal.objective,
        status: "active",
      }),
      update: expect.objectContaining({
        activeTurnId: TURN_ID,
        objective: nativeGoal.objective,
        status: "active",
      }),
    });
  });

  it("uses the native Goal turn instead of a stale active turn from the previous Goal", async () => {
    const fixture = eventFixture();
    const staleGoalTurnId = "30000000-0000-4000-8000-000000000099";
    fixture.tx.conversationGoal.findUnique.mockResolvedValueOnce(
      goalRow({ status: "complete", activeTurnId: staleGoalTurnId }),
    );
    fixture.tx.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow(),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "thread/goal/updated",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          goal: {
            threadId: "codex-thread-1",
            objective: "发布已批准的 ManageBac 草稿",
            status: "active",
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 1_785_996_100,
            updatedAt: 1_785_996_100,
          },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurnAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        turnId: TURN_ID,
        attemptNo: 1,
        kind: "primary",
      },
      data: { kind: "goal_primary" },
    });
    expect(fixture.tx.conversationGoal.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      create: expect.objectContaining({ activeTurnId: TURN_ID }),
      update: expect.objectContaining({ activeTurnId: TURN_ID }),
    });
  });

  it("promotes a terminal turn when Goal projection arrives after process-exit reconciliation", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({ status: "completed" }),
    );
    fixture.tx.conversationTurn.findUnique.mockResolvedValueOnce(
      turnRow({ status: "completed", completedAt: NOW }),
    );
    fixture.tx.conversationTurn.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "thread/goal/updated",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          goal: {
            threadId: "codex-thread-1",
            objective: "在恢复后继续原生 Goal",
            status: "active",
            tokenBudget: null,
            tokensUsed: 300,
            timeUsedSeconds: 12,
            createdAt: 1_785_996_100,
            updatedAt: 1_785_996_112,
          },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        conversationId: CONVERSATION_ID,
        codexThreadId: "codex-thread-1",
        taskKind: "turn",
      },
      data: { taskKind: "goal" },
    });
  });

  it("retries an AI-created Goal update until its native turn is projected", async () => {
    const fixture = eventFixture();
    fixture.tx.conversationTurnAttempt.findUnique.mockResolvedValueOnce(null);

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "thread/goal/updated",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-not-projected",
          goal: {
            threadId: "codex-thread-1",
            objective: "等待本地 turn 投影后继续",
            status: "active",
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 1_785_996_000,
            updatedAt: 1_785_996_000,
          },
        },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason_code: "TURN_PROJECTION_PENDING",
    });

    expect(fixture.tx.conversationGoal.upsert).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("clears the active turn when a native Goal update settles the Goal", async () => {
    const fixture = eventFixture(undefined, { taskKind: "goal" });
    fixture.tx.conversationGoal.findUnique.mockResolvedValueOnce(goalRow());
    fixture.tx.conversationTurnAttempt.findUnique.mockResolvedValueOnce(
      attemptRow({ kind: "goal_primary" }),
    );
    fixture.tx.conversationTurn.findUnique.mockResolvedValueOnce(
      turnRow({ taskKind: "goal" }),
    );

    await expect(
      fixture.service.ingest(CONVERSATION_ID, {
        method: "thread/goal/updated",
        visibility: "user_visible",
        params: {
          threadId: "codex-thread-1",
          turnId: "codex-turn-1",
          goal: {
            threadId: "codex-thread-1",
            objective: "等待用户处理阻塞条件",
            status: "blocked",
            tokenBudget: null,
            tokensUsed: 1_200,
            timeUsedSeconds: 51,
            createdAt: 1_785_996_000,
            updatedAt: 1_785_996_051,
          },
        },
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(fixture.tx.conversationGoal.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      create: expect.objectContaining({ status: "blocked", activeTurnId: null }),
      update: expect.objectContaining({ status: "blocked", activeTurnId: null }),
    });
  });

  it("uses a persistent delivery id to avoid duplicate assistant messages and keeps completed-event payloads body-free", async () => {
    const fixture = eventFixture();
    const deliveryId = "60000000-0000-4000-8000-000000000001";
    const storedEvent = {
      ...eventRow(1n),
      id: deliveryId,
      eventType: "conversation.message.completed",
      payloadJson: {
        schema_version: 1,
        message_id: "70000000-0000-4000-8000-000000000001",
        role: "assistant",
        item_id: "native-item-1",
      },
    };
    fixture.tx.conversationEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedEvent);
    fixture.tx.conversationMessage.create.mockResolvedValueOnce({
      id: "70000000-0000-4000-8000-000000000001",
    });
    fixture.tx.conversationEvent.create.mockResolvedValueOnce(storedEvent);
    const input = {
      eventType: "conversation.message.completed",
      visibility: "user_visible" as const,
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      payload: {
        item_id: "native-item-1",
        text: "PRIVATE ASSISTANT RESPONSE",
      },
    };

    await fixture.service.ingest(CONVERSATION_ID, input, deliveryId);
    await fixture.service.ingest(
      CONVERSATION_ID,
      input,
      "60000000-0000-4000-8000-000000000002",
    );

    expect(fixture.tx.conversationMessage.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: deliveryId,
        payloadJson: storedEvent.payloadJson,
      }),
    });
    expect(JSON.stringify(storedEvent.payloadJson)).not.toContain("PRIVATE");
    expect(storedEvent.payloadJson).not.toHaveProperty("content_text");
    expect(storedEvent.payloadJson).not.toHaveProperty("text");
  });
});

describe("ConversationEventService SSE replay privacy", () => {
  it("bounds an authorized empty stream poll to two database reads", async () => {
    const fixture = eventFixture();

    const page = await fixture.service.historyPage(OWNER_ID, CONVERSATION_ID, {
      afterSequence: 5n,
      limit: 200,
    });

    expect(page).toMatchObject({ items: [], last_sequence: 5n, confirmed_sequence: 5n });
    const reads = [
      fixture.conversations.assertOwner,
      fixture.prisma.$queryRaw,
      fixture.tx.conversation.findUnique,
      fixture.tx.conversationTurn.findMany,
      fixture.tx.conversationTurnStartIntent.findMany,
      fixture.tx.conversationEvent.findMany,
      fixture.tx.conversationEvent.findFirst,
    ].reduce((count, read) => count + read.mock.calls.length, 0);
    expect(reads).toBeLessThanOrEqual(2);
  });

  it("rejects an unauthorized history request before reading any events", async () => {
    const fixture = eventFixture();
    fixture.conversations.assertOwner.mockRejectedValueOnce(new AppError("CONVERSATION_NOT_FOUND"));

    await expect(fixture.service.historyPage(OTHER_ID, CONVERSATION_ID, {
      afterSequence: 0n,
      limit: 200,
    })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect(fixture.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps preparation, branch and visibility restrictions in one parameterized history snapshot", async () => {
    const fixture = eventFixture();
    await fixture.service.historyPage(OWNER_ID, CONVERSATION_ID, { afterSequence: 0n, limit: 200 });

    const query = fixture.prisma.$queryRaw.mock.calls[0]![0];
    expect(query.values).toEqual([0n, 0n, 0n, OWNER_ID, "prepared", "runner_succeeded", 201, CONVERSATION_ID, OWNER_ID]);
    expect(query.sql).toContain("candidate.visibility IN ('user_visible', 'user_collapsed')");
    expect(query.sql).toContain("intent.projection_turn_id = candidate.turn_id");
    expect(query.sql).toContain("intent.conversation_id = conversation.id");
    expect(query.sql).toContain("intent.owner_id = ?::uuid");
    expect(query.sql).toContain("intent.runner_status IN (?,?)");
    expect(query.sql).toContain("candidate.event_type IN ('item/started', 'item/completed')");
    expect(query.sql).toContain("candidate.payload_json #> '{params,item,type}' = '\"contextCompaction\"'::jsonb");
    expect(query.sql).toContain("turn.conversation_id = conversation.id");
    expect(query.sql).toContain("turn.codex_thread_id = NULLIF(conversation.codex_thread_id, '')");
    expect(query.sql).toContain("candidate.event_type NOT IN ('thread/name/updated', 'conversation.title.updated')");
    expect(query.sql).toContain("candidate.payload_json #> '{params,threadId}' = to_jsonb(NULLIF(conversation.codex_thread_id, ''))");
    expect(query.sql).toContain("candidate.payload_json -> 'thread_id' = to_jsonb(NULLIF(conversation.codex_thread_id, ''))");
    expect(query.sql).toContain("conversation.owner_id = ?::uuid");
    expect(query.sql).not.toContain(OWNER_ID);
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts only non-negative cursors scoped to the requested conversation", () => {
    expect(
      eventRouteTesting.parseSequence(CONVERSATION_ID, `${CONVERSATION_ID}:12`),
    ).toBe(12n);
    expect(
      eventRouteTesting.parseSequence(CONVERSATION_ID, `${CONVERSATION_ID}:`),
    ).toBeNull();
    expect(
      eventRouteTesting.parseSequence(CONVERSATION_ID, `${CONVERSATION_ID}:-1`),
    ).toBeNull();
    expect(
      eventRouteTesting.parseSequence(
        CONVERSATION_ID,
        "20000000-0000-4000-8000-000000000099:12",
      ),
    ).toBeNull();
  });

  it("checks owner on every bounded history page and returns an opaque next cursor", async () => {
    const fixture = eventFixture();
    const firstPage = Array.from({ length: 201 }, (_, index) =>
      eventRow(BigInt(index + 1)),
    );
    fixture.prisma.$queryRaw
      .mockResolvedValueOnce(firstPage.map(row => ({ ...row, confirmedSequence: row.sequenceNo })))
      .mockResolvedValueOnce([{ ...eventRow(201n), confirmedSequence: 201n }]);

    const result = await fixture.service.historyPage(
      OWNER_ID,
      CONVERSATION_ID,
      {
        afterSequence: 0n,
        limit: 200,
      },
    );

    expect(fixture.conversations.assertOwner).toHaveBeenCalledBefore(
      fixture.prisma.$queryRaw,
    );
    expect(result.items).toHaveLength(200);
    expect(result.items.at(-1)?.sse_event_id).toBe(`${CONVERSATION_ID}:200`);
    expect(result.next_cursor).toBe(`${CONVERSATION_ID}:200`);
    expect(result.last_sequence).toBe(200n);
    const finalPage = await fixture.service.historyPage(
      OWNER_ID,
      CONVERSATION_ID,
      { afterSequence: result.last_sequence, limit: 200 },
    );
    expect(finalPage.items.map((event) => event.sequence_no)).toEqual([201]);
    expect(finalPage.next_cursor).toBeNull();
    expect(fixture.prisma.$queryRaw.mock.calls[0]![0].values).toEqual([
      0n, 0n, 0n, OWNER_ID, "prepared", "runner_succeeded", 201, CONVERSATION_ID, OWNER_ID,
    ]);
    expect(fixture.prisma.$queryRaw.mock.calls[1]![0].values).toEqual([
      200n, 200n, 200n, OWNER_ID, "prepared", "runner_succeeded", 201, CONVERSATION_ID, OWNER_ID,
    ]);
    expect(fixture.conversations.assertOwner).toHaveBeenCalledTimes(2);
  });

  it("reports the persisted event high-water mark when the active projection is empty", async () => {
    const fixture = eventFixture();
    fixture.prisma.$queryRaw.mockResolvedValue([{ id: null, confirmedSequence: 12n }]);

    const result = await fixture.service.historyPage(
      OWNER_ID,
      CONVERSATION_ID,
      { afterSequence: 5n, limit: 200 },
    );

    expect(result.items).toEqual([]);
    expect(result.last_sequence).toBe(5n);
    expect(result.confirmed_sequence).toBe(12n);
  });

  it("exposes owner-scoped event history through a bounded REST cursor page", async () => {
    const historyPage = vi.fn(async () => ({
      items: [],
      next_cursor: `${CONVERSATION_ID}:200`,
      last_sequence: 200n,
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(sseRoutes, {
      prefix: "/conversations",
      services: { events: { historyPage } } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/events/history?cursor=${encodeURIComponent(`${CONVERSATION_ID}:120`)}&limit=80`,
    });

    expect(response.statusCode).toBe(200);
    expect(historyPage).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID, {
      afterSequence: 120n,
      limit: 80,
    });
    expect(response.json().data).toEqual({
      items: [],
      next_cursor: `${CONVERSATION_ID}:200`,
    });

    const invalid = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/events/history?cursor=${encodeURIComponent(`${CONVERSATION_ID}:`)}`,
    });
    expect(invalid.statusCode).toBe(400);
    expect(historyPage).toHaveBeenCalledOnce();
  });

  it("waits for response drain instead of accumulating unbounded SSE writes", async () => {
    let drain: (() => void) | undefined;
    const response = {
      destroyed: false,
      write: vi.fn(() => false),
      once: vi.fn((event: "drain" | "close", listener: () => void) => {
        if (event === "drain") drain = listener;
      }),
      off: vi.fn(),
    };
    const event = eventRow(1n);
    const pending = eventRouteTesting.writeEventWithBackpressure(response, {
      id: event.id,
      conversation_id: event.conversationId,
      turn_id: event.turnId,
      sequence_no: Number(event.sequenceNo),
      event_type: "conversation.step.completed",
      visibility: "user_visible",
      payload: event.payloadJson,
      sse_event_id: event.sseEventId,
      created_at: event.createdAt.toISOString(),
    } as never);

    expect(response.write).toHaveBeenCalledOnce();
    drain?.();
    await expect(pending).resolves.toBe(true);
    expect(response.off).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("rejects a non-owner SSE request before allocating a Redis subscriber", async () => {
    const events = {
      assertOwner: vi.fn(async () => {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }),
      historyPage: vi.fn(async () => ({
        items: [],
        next_cursor: null,
        last_sequence: 0n,
      })),
    };
    const redis = { duplicate: vi.fn() };
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(sseRoutes, {
      prefix: "/conversations",
      services: { events, redis } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/events`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error_code: "CONVERSATION_NOT_FOUND",
    });
    expect(redis.duplicate).not.toHaveBeenCalled();
    expect(events.historyPage).not.toHaveBeenCalled();
  });

  it("flushes an idle SSE connection immediately and closes its subscriber with the response", async () => {
    const subscriber = Object.assign(new EventEmitter(), {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
    });
    const events = {
      assertOwner: vi.fn(async () => undefined),
      historyPage: vi.fn(async () => ({
        items: [],
        next_cursor: null,
        last_sequence: 0n,
      })),
    };
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(sseRoutes, {
      prefix: "/conversations",
      services: {
        config: { publicBaseUrl: "http://localhost:5173" },
        events,
        redis: { duplicate: vi.fn(() => subscriber) },
      } as unknown as AppServices,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server address is unavailable");
    }
    const controller = new AbortController();

    const response = await Promise.race([
      fetch(
        `http://127.0.0.1:${address.port}/conversations/${CONVERSATION_ID}/events`,
        {
          headers: { origin: "http://localhost:5173" },
          signal: controller.signal,
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("SSE headers were not flushed")),
          500,
        ),
      ),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(subscriber.unsubscribe).toHaveBeenCalledOnce(),
    );
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });

  it("keeps the SSE connection open across filtered and transient projection gaps", async () => {
    const subscriber = Object.assign(new EventEmitter(), {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
    });
    const visibleEvent = projectedEvent(2);
    const historyPage = vi
      .fn()
      .mockResolvedValueOnce(eventHistoryPage([], 0n))
      .mockResolvedValueOnce(eventHistoryPage([], 1n))
      .mockResolvedValueOnce(eventHistoryPage([], 1n))
      .mockResolvedValueOnce(eventHistoryPage([visibleEvent], 2n));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(sseRoutes, {
      prefix: "/conversations",
      services: {
        config: { publicBaseUrl: "http://localhost:5173" },
        events: {
          assertOwner: vi.fn(async () => undefined),
          historyPage,
        },
        redis: { duplicate: vi.fn(() => subscriber) },
      } as unknown as AppServices,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server address is unavailable");
    }
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/conversations/${CONVERSATION_ID}/events`,
      {
        headers: { origin: "http://localhost:5173" },
        signal: controller.signal,
      },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SSE response body is unavailable");
    const channel = `linksense:conversation-events:${CONVERSATION_ID}`;

    await vi.waitFor(() => expect(historyPage).toHaveBeenCalledTimes(1));
    subscriber.emit("message", channel, JSON.stringify(projectedEvent(1)));
    await vi.waitFor(() => expect(historyPage).toHaveBeenCalledTimes(2));

    subscriber.emit("message", channel, JSON.stringify(visibleEvent));
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSE projection retry timed out")), 500),
      ),
    ]);

    expect(chunk.done).toBe(false);
    expect(new TextDecoder().decode(chunk.value)).toContain(
      `id: ${CONVERSATION_ID}:2`,
    );
    expect(historyPage).toHaveBeenCalledTimes(4);
    controller.abort();
    await vi.waitFor(() =>
      expect(subscriber.unsubscribe).toHaveBeenCalledOnce(),
    );
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });

  it("waits for process-exit reconciliation before confirming the callback", async () => {
    let resolveRecovery:
      ((result: { outcome: "succeeded" }) => void) | undefined;
    const reconcileAfterProcessExit = vi.fn(
      () =>
        new Promise<{ outcome: "succeeded" }>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const assertOwner = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner },
        events: { reconcileAfterProcessExit, scheduleProcessExitRecovery: vi.fn(async () => undefined) },
      } as unknown as AppServices,
    });

    let responseSettled = false;
    const responsePromise = app.inject({
      method: "POST",
      url: "/runner/process-exit",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": OWNER_ID,
      },
      payload: processExitPayload(),
    });
    void responsePromise.then(() => {
      responseSettled = true;
    });
    await vi.waitFor(() =>
      expect(reconcileAfterProcessExit).toHaveBeenCalledOnce(),
    );

    expect(responseSettled).toBe(false);
    expect(assertOwner).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    resolveRecovery?.({ outcome: "succeeded" });
    const response = await responsePromise;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { confirmed: true, outcome: "succeeded" },
    });
  });

  it("accepts an authenticated worker heartbeat without reading any conversation", async () => {
    const recordRunnerHeartbeat = vi.fn(async () => undefined);
    const assertOwner = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner },
        events: { recordRunnerHeartbeat },
      } as unknown as AppServices,
    });
    const payload = { bootId: "60000000-0000-4000-8000-000000000001", startup: true };
    const unauthorized = await app.inject({ method: "POST", url: "/runner/heartbeat", payload });
    expect(unauthorized.statusCode).toBe(401);
    const headers = { authorization: "Bearer runner-secret", "x-linksense-owner-id": OWNER_ID };
    const invalid = await app.inject({ method: "POST", url: "/runner/heartbeat", headers, payload: { ...payload, ownerId: OTHER_ID } });
    expect(invalid.statusCode).toBe(400);
    const missingOwner = await app.inject({ method: "POST", url: "/runner/heartbeat", headers: { authorization: "Bearer runner-secret" }, payload });
    expect(missingOwner.statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: "/runner/heartbeat", headers, payload });
    expect(response.statusCode).toBe(200);
    expect(recordRunnerHeartbeat).toHaveBeenCalledExactlyOnceWith(OWNER_ID, payload);
    expect(assertOwner).not.toHaveBeenCalled();
  });

  it("records owner-scoped native memory usage without requiring the conversation to still exist", async () => {
    const recordModelUsage = vi.fn(async () => ({ recorded: true }));
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        usageAnalytics: { recordModelUsage },
      } as unknown as AppServices,
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/runner/memory-usage",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": OWNER_ID,
      },
      payload: memoryUsagePayload(),
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      success: true,
      data: { recorded: true },
    });
    expect(recordModelUsage).toHaveBeenCalledWith({
      requestId: "50000000-0000-4000-8000-000000000001",
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      operation: "extract",
      workload: "memory_generation",
      modelKind: "generation",
      model: "gpt-memory",
      measurementMethod: "provider",
      tokenUsage: {
        totalTokens: 50,
        inputTokens: 40,
        cachedInputTokens: 10,
        outputTokens: 10,
        reasoningOutputTokens: 2,
      },
      pricing: {
        input_price_per_million: "5",
        cached_input_price_per_million: "1",
        output_price_per_million: "8",
      },
      observedAt: new Date("2026-07-31T03:00:00.000Z"),
    });

    const mismatched = await app.inject({
      method: "POST",
      url: "/runner/memory-usage",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": OTHER_ID,
      },
      payload: memoryUsagePayload(),
    });

    expect(mismatched.statusCode).toBe(403);
    expect(recordModelUsage).toHaveBeenCalledOnce();
  });

  it.each(["succeeded", "not_applicable"] as const)(
    "confirms process-exit reconciliation only for the %s outcome",
    async (outcome) => {
      const reconcileAfterProcessExit = vi.fn(async () => ({ outcome }));
      const assertOwner = vi.fn(async () => undefined);
      const app = Fastify();
      apps.push(app);
      app.setErrorHandler((error, request, reply) =>
        sendAppError(reply, request, error),
      );
      await app.register(internalRunnerRoutes, {
        services: {
          config: { runnerSharedSecret: "runner-secret" },
          conversations: { assertOwner },
          events: { reconcileAfterProcessExit, scheduleProcessExitRecovery: vi.fn(async () => undefined) },
        } as unknown as AppServices,
      });

      const response = await app.inject({
        method: "POST",
        url: "/runner/process-exit",
        headers: {
          authorization: "Bearer runner-secret",
          "x-linksense-owner-id": OWNER_ID,
        },
        payload: processExitPayload(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        success: true,
        data: { confirmed: true, outcome },
      });
    },
  );

  it("returns a stable non-2xx response for failed process-exit reconciliation without writing a duplicate route audit", async () => {
    const reconcileAfterProcessExit = vi.fn(async () => ({
      outcome: "failed" as const,
      reasonCode: "RUNNING_TURN_RECOVERY_FAILED",
    }));
    const auditWrite = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner: vi.fn(async () => undefined) },
        events: { reconcileAfterProcessExit, scheduleProcessExitRecovery: vi.fn(async () => undefined) },
        audit: { write: auditWrite },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "POST",
      url: "/runner/process-exit",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": OWNER_ID,
      },
      payload: processExitPayload(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "RUNNER_UNAVAILABLE",
    });
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it("maps an unexpected process-exit reconciliation rejection to a stable non-2xx response", async () => {
    const reconcileAfterProcessExit = vi.fn(async () => {
      throw new Error("private runner failure");
    });
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner: vi.fn(async () => undefined) },
        events: { reconcileAfterProcessExit, scheduleProcessExitRecovery: vi.fn(async () => undefined) },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "POST",
      url: "/runner/process-exit",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": OWNER_ID,
      },
      payload: processExitPayload(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "RUNNER_UNAVAILABLE",
    });
    expect(response.body).not.toContain("private runner failure");
  });

  it("rejects every internal runner callback before ownership-scoped work when the owner header is missing or invalid", async () => {
    const assertOwner = vi.fn(async () => undefined);
    const ingest = vi.fn(async () => ({ accepted: true }));
    const reconcileAfterProcessExit = vi.fn(async () => undefined);
    const registerArtifact = vi.fn(async () => ({ success: true }));
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner },
        events: { ingest, reconcileAfterProcessExit },
        files: { registerArtifact },
        audit: { write: vi.fn(async () => undefined) },
      } as unknown as AppServices,
    });
    const requests = internalRunnerCallbackRequests();

    const unauthenticated = await app.inject({
      ...requests[0]!,
      headers: { "x-linksense-owner-id": "not-a-uuid" },
    });
    expect(unauthenticated.statusCode).toBe(401);

    for (const ownerHeader of [undefined, "not-a-uuid"]) {
      for (const input of requests) {
        const response = await app.inject({
          ...input,
          headers: {
            authorization: "Bearer runner-secret",
            ...(ownerHeader ? { "x-linksense-owner-id": ownerHeader } : {}),
          },
        });
        expect(response.statusCode).toBe(400);
      }
    }

    expect(assertOwner).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
    expect(reconcileAfterProcessExit).not.toHaveBeenCalled();
    expect(registerArtifact).not.toHaveBeenCalled();
  });

  it("rejects owner-mismatched internal runner callbacks before event, recovery, or artifact writes", async () => {
    const assertOwner = vi.fn(async () => {
      throw new AppError("CONVERSATION_NOT_FOUND");
    });
    const ingest = vi.fn(async () => ({ accepted: true }));
    const reconcileAfterProcessExit = vi.fn(async () => undefined);
    const registerArtifact = vi.fn(async () => ({ success: true }));
    const auditWrite = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner },
        events: { ingest, reconcileAfterProcessExit },
        files: { registerArtifact },
        audit: { write: auditWrite },
      } as unknown as AppServices,
    });

    for (const input of internalRunnerCallbackRequests()) {
      const response = await app.inject({
        ...input,
        headers: {
          authorization: "Bearer runner-secret",
          "x-linksense-owner-id": OTHER_ID,
        },
      });
      expect(response.statusCode).toBe(404);
    }

    expect(assertOwner).toHaveBeenCalledTimes(3);
    expect(assertOwner).toHaveBeenCalledWith(OTHER_ID, CONVERSATION_ID);
    expect(ingest).not.toHaveBeenCalled();
    expect(reconcileAfterProcessExit).not.toHaveBeenCalled();
    expect(registerArtifact).not.toHaveBeenCalled();
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it("passes the authenticated owner into artifact registration after ownership validation", async () => {
    const assertOwner = vi.fn(async () => undefined);
    const registerArtifact = vi.fn(async () => ({ success: true }));
    const app = Fastify();
    apps.push(app);
    await app.register(internalRunnerRoutes, {
      services: {
        config: { runnerSharedSecret: "runner-secret" },
        conversations: { assertOwner },
        files: { registerArtifact },
      } as unknown as AppServices,
    });

    const artifactRequest = internalRunnerCallbackRequests()[2]!;
    const response = await app.inject({
      ...artifactRequest,
      payload: {
        ...artifactRequest.payload,
        artifactKind: "inline_image",
      },
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": OWNER_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(assertOwner).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    expect(registerArtifact).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      codexTurnId: "codex-turn-1",
      workspaceRelativePath: "artifacts/report.txt",
      displayName: "report.txt",
      mimeType: "text/plain",
      artifactKind: "inline_image",
    });
  });

  it("contains both unsubscribe and quit failures while cleaning up an SSE subscriber", async () => {
    const subscriber = {
      unsubscribe: vi.fn(async () => {
        throw new Error("unsubscribe failed");
      }),
      quit: vi.fn(async () => {
        throw new Error("quit failed");
      }),
    };

    await expect(
      eventRouteTesting.closeSubscriber(subscriber, "conversation-channel"),
    ).resolves.toBeUndefined();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith("conversation-channel");
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });

  it("recovers the exact process-exit turn with its persisted capability snapshot and generation", async () => {
    const capabilityId = "60000000-0000-4000-8000-000000000001";
    const credentialSource =
      "LINKSENSE_CREDENTIAL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const capability = {
      id: capabilityId,
      name: "pdf",
      type: "plugin" as const,
      revision: "2026-07-20T00:00:00.000Z",
      credentialEnvironment: { PDF_API_KEY: credentialSource },
    };
    const persistedCapability = {
      ...capability,
      description: "Original snapshot",
      scope: "personal",
      sourceType: "local",
    };
    const resolveRecoveryRuntime = vi.fn().mockResolvedValue({
      capabilities: [capability],
      capabilityGeneration: CAPABILITY_GENERATION,
      environment: { [credentialSource]: "current-secret" },
      modelRuntime: TEST_MODEL_RUNTIME,
      modelTransitionSource: {
        model: "test-source-model",
        provider: {
          ...TEST_MODEL_RUNTIME.provider,
          revision: 2,
          baseUrl: "https://source-models.example.test/v1",
          apiKey: "source-provider-key",
        },
      },
    });
    const reconcile = vi.fn().mockResolvedValue({
      thread: {
        turns: [{ id: "codex-turn-1", status: "inProgress" }],
      },
    });
    const auditCreate = vi.fn();
    const prisma = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          ownerId: OWNER_ID,
          codexThreadId: "codex-thread-1",
          runtimeGeneration: "01900000-0000-7000-8000-000000000010",
        }),
      },
      conversationTurn: {
        findUnique: vi.fn().mockResolvedValue({
          id: TURN_ID,
          conversationId: CONVERSATION_ID,
          submittedBy: OWNER_ID,
          codexTurnId: "codex-turn-1",
          status: "running",
          taskKind: "turn",
          collaborationMode: "default",
          capabilityGeneration: CAPABILITY_GENERATION,
          capabilitiesJson: [persistedCapability],
        }),
      },
      auditLog: { create: auditCreate },
    };
    const service = new ConversationEventService(
      prisma as never,
      {} as never,
      {
        resolveRecoveryRuntime,
        runnerForRecovery: () => ({ reconcile }),
      } as never,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(resolveRecoveryRuntime).toHaveBeenCalledWith(
      OWNER_ID,
      {
        conversationId: CONVERSATION_ID,
        capabilityGeneration: CAPABILITY_GENERATION,
        capabilitiesJson: [persistedCapability],
      },
      { includeModelTransitionSource: true },
    );
    expect(reconcile).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      ownerId: OWNER_ID,
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      capabilityGeneration: CAPABILITY_GENERATION,
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      projectionTurnId: TURN_ID,
      taskKind: "turn",
      collaborationMode: "default",
      capabilities: [capability],
      environment: { [credentialSource]: "current-secret" },
      model: TEST_MODEL_RUNTIME.model,
      modelTransitionSource: {
        model: "test-source-model",
        provider: {
          ...TEST_MODEL_RUNTIME.provider,
          revision: 2,
          baseUrl: "https://source-models.example.test/v1",
          apiKey: "source-provider-key",
        },
      },
      reasoningEffort: TEST_MODEL_RUNTIME.reasoningEffort,
      modelProvider: TEST_MODEL_RUNTIME.provider,
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("fails closed before runner recovery when current preflight detects revoked access", async () => {
    const reconcile = vi.fn();
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          ownerId: OWNER_ID,
          codexThreadId: "codex-thread-1",
          runtimeGeneration: "01900000-0000-7000-8000-000000000010",
        }),
      },
      conversationTurn: {
        findUnique: vi.fn().mockResolvedValue({
          id: TURN_ID,
          conversationId: CONVERSATION_ID,
          submittedBy: OWNER_ID,
          codexTurnId: "codex-turn-1",
          status: "running",
          capabilityGeneration: CAPABILITY_GENERATION,
          capabilitiesJson: [],
        }),
      },
      auditLog: { create: auditCreate },
    };
    const service = new ConversationEventService(
      prisma as never,
      {} as never,
      {
        resolveRecoveryRuntime: vi
          .fn()
          .mockRejectedValue(new AppError("CAPABILITY_NOT_FOUND")),
        runnerForRecovery: () => ({ reconcile }),
      } as never,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toMatchObject({
      outcome: "failed",
      reasonCode: "RUNNING_TURN_RECOVERY_FAILED",
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "codex_thread_recovery_failed",
        targetType: "conversation",
        targetId: CONVERSATION_ID,
        result: "failure",
        metadataJson: {
          reason_code: "CODEX_THREAD_RECOVERY_UNAVAILABLE",
        },
      },
    });
  });

  it("retries confirmation for an exact already-terminal process-exit token before post-actions", async () => {
    const confirmRecovery = vi.fn().mockResolvedValue({ confirmed: true });
    const releaseTurnSlot = vi.fn().mockResolvedValue(undefined);
    const resolveRecoveryRuntime = vi.fn();
    const reconcile = vi.fn();
    const titleRefresh = { schedule: vi.fn() };
    const service = new ConversationEventService(
      {
        conversation: {
          findUnique: vi.fn().mockResolvedValue({
            id: CONVERSATION_ID,
            ownerId: OWNER_ID,
            codexThreadId: "codex-thread-1",
            titleSource: "fallback",
          }),
        },
        conversationTurn: {
          findUnique: vi.fn().mockResolvedValue({
            id: TURN_ID,
            conversationId: CONVERSATION_ID,
            submittedBy: OWNER_ID,
            codexTurnId: "codex-turn-1",
            capabilitiesJson: [],
            status: "completed",
            capabilityGeneration: CAPABILITY_GENERATION,
          }),
        },
        pendingRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      } as never,
      { releaseTurnSlot } as never,
      {
        resolveRecoveryRuntime,
        runnerForRecovery: () => ({ reconcile, confirmRecovery }),
      } as never,
      titleRefresh,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "not_applicable" });
    expect(confirmRecovery).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      ownerId: OWNER_ID,
      projectionTurnId: TURN_ID,
      capabilityGeneration: CAPABILITY_GENERATION,
    });
    expect(confirmRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      releaseTurnSlot.mock.invocationCallOrder[0]!,
    );
    expect(resolveRecoveryRuntime).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(titleRefresh.schedule).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("confirms a process-exit token with a different capability generation as not applicable without mutating runner state", async () => {
    const resolveRecoveryRuntime = vi.fn();
    const reconcile = vi.fn();
    const confirmRecovery = vi.fn();
    const service = new ConversationEventService(
      {
        conversation: {
          findUnique: vi.fn().mockResolvedValue({
            id: CONVERSATION_ID,
            ownerId: OWNER_ID,
            codexThreadId: "codex-thread-1",
          }),
        },
        conversationTurn: {
          findUnique: vi.fn().mockResolvedValue({
            id: TURN_ID,
            conversationId: CONVERSATION_ID,
            submittedBy: OWNER_ID,
            codexTurnId: "codex-turn-1",
            capabilitiesJson: [],
            status: "running",
            capabilityGeneration: "e".repeat(64),
          }),
        },
      } as never,
      {} as never,
      {
        resolveRecoveryRuntime,
        runnerForRecovery: () => ({ reconcile, confirmRecovery }),
      } as never,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "not_applicable" });
    expect(resolveRecoveryRuntime).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(confirmRecovery).not.toHaveBeenCalled();
  });

  it.each([
    ["missing target turn", []],
    ["unknown target turn status", [{ id: "codex-turn-1", status: "paused" }]],
  ])("fails process-exit confirmation for a %s", async (_name, nativeTurns) => {
    const reconcile = vi.fn().mockResolvedValue({
      thread: { turns: nativeTurns },
    });
    const confirmRecovery = vi.fn();
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const service = new ConversationEventService(
      {
        conversation: {
          findUnique: vi.fn().mockResolvedValue({
            id: CONVERSATION_ID,
            ownerId: OWNER_ID,
            codexThreadId: "codex-thread-1",
            runtimeGeneration: "01900000-0000-7000-8000-000000000010",
          }),
        },
        conversationTurn: {
          findUnique: vi.fn().mockResolvedValue({
            id: TURN_ID,
            conversationId: CONVERSATION_ID,
            submittedBy: OWNER_ID,
            codexTurnId: "codex-turn-1",
            status: "running",
            taskKind: "turn",
            collaborationMode: "default",
            capabilityGeneration: CAPABILITY_GENERATION,
            capabilitiesJson: [],
          }),
        },
        auditLog: { create: auditCreate },
      } as never,
      {} as never,
      {
        resolveRecoveryRuntime: vi.fn().mockResolvedValue({
          capabilities: [],
          capabilityGeneration: CAPABILITY_GENERATION,
          environment: {},
          modelRuntime: TEST_MODEL_RUNTIME,
        }),
        runnerForRecovery: () => ({ reconcile, confirmRecovery }),
      } as never,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toMatchObject({
      outcome: "failed",
      reasonCode: "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE",
    });
    expect(confirmRecovery).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it("confirms the exact recovery token only after terminal projection commits", async () => {
    const turnUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const confirmRecovery = vi.fn().mockResolvedValue({ confirmed: true });
    const releaseTurnSlot = vi.fn().mockResolvedValue(undefined);
    const startPending = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: TURN_ID }]),
      conversationTurn: { updateMany: turnUpdate },
      conversationUserInputRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      conversationPlanReview: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      conversationTurnAttempt: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      conversation: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          ownerId: OWNER_ID,
          codexThreadId: "codex-thread-1",
          runtimeGeneration: "01900000-0000-7000-8000-000000000010",
        }),
      },
      conversationTurn: {
        findUnique: vi.fn().mockResolvedValue({
          id: TURN_ID,
          conversationId: CONVERSATION_ID,
          submittedBy: OWNER_ID,
          codexTurnId: "codex-turn-1",
          status: "running",
          taskKind: "turn",
          collaborationMode: "default",
          capabilityGeneration: CAPABILITY_GENERATION,
          capabilitiesJson: [],
          interruptRequestedAt: null,
        }),
      },
      pendingRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: "60000000-0000-4000-8000-000000000020",
          status: "waiting_previous_turn",
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(
        async (action: (tx: typeof transaction) => Promise<unknown>) =>
          action(transaction),
      ),
    };
    const service = new ConversationEventService(
      prisma as never,
      {
        releaseTurnSlot,
      } as never,
      {
        startPending,
        resolveRecoveryRuntime: vi.fn().mockResolvedValue({
          capabilities: [],
          capabilityGeneration: CAPABILITY_GENERATION,
          environment: {},
          modelRuntime: TEST_MODEL_RUNTIME,
        }),
        runnerForRecovery: () => ({
          reconcile: vi.fn().mockResolvedValue({
            thread: {
              turns: [
                {
                  id: "codex-turn-1",
                  status: "failed",
                  error: {
                    message: "Recovered provider failure.",
                    codexErrorInfo: "other",
                  },
                },
              ],
            },
          }),
          confirmRecovery,
        }),
      } as never,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });
    expect(confirmRecovery).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      ownerId: OWNER_ID,
      projectionTurnId: TURN_ID,
      capabilityGeneration: CAPABILITY_GENERATION,
    });
    expect(turnUpdate).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "CODEX_TURN_FAILED",
        errorMessage: "Recovered provider failure.",
      }),
    });
    expect(transaction.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastTurnStatus: "failed", completionUnread: true },
    });
    expect(turnUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      confirmRecovery.mock.invocationCallOrder[0]!,
    );
    expect(confirmRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      releaseTurnSlot.mock.invocationCallOrder[0]!,
    );
    expect(releaseTurnSlot.mock.invocationCallOrder[0]).toBeLessThan(
      startPending.mock.invocationCallOrder[0]!,
    );
  });

  it("persists and live-publishes a missing Plan output error after process-exit reconciliation commits", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "plan",
      taskKind: "turn",
      nativeStatus: "completed",
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          schema_version: 1,
          error_code: "PLAN_OUTPUT_MISSING",
          message_key: "errors.conversation.planOutputMissing",
          retryable: true,
        },
      }),
    });
    expect(fixture.lifecycle).toEqual([
      "transaction.committed",
      "conversation.error.published",
    ]);
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "conversation.error",
        visibility: "user_visible",
        payload: {
          schema_version: 1,
          error_code: "PLAN_OUTPUT_MISSING",
          message_key: "errors.conversation.planOutputMissing",
          retryable: true,
        },
      }),
    );
    expect(fixture.titleRefresh.schedule).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("publishes the persisted missing Plan output error when a concurrent reconciliation wins the terminal update", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "plan",
      taskKind: "turn",
      nativeStatus: "completed",
      terminalUpdateCount: 0,
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.prisma.conversationEvent.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventType: "conversation.error",
        payloadJson: {
          path: ["error_code"],
          equals: "PLAN_OUTPUT_MISSING",
        },
      },
      orderBy: { sequenceNo: "desc" },
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "conversation.error",
        sse_event_id: `${CONVERSATION_ID}:1`,
      }),
    );
  });

  it("does not report a missing Plan when process-exit recovery sees the native Plan item before its outbox projection", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "plan",
      taskKind: "turn",
      nativeStatus: "completed",
      nativePlanOutput: true,
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("keeps a Plan turn waiting for native user input running during process-exit reconciliation", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "plan",
      taskKind: "turn",
      nativeStatus: "inProgress",
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.confirmRecovery).not.toHaveBeenCalled();
  });

  it("projects the authoritative completed Goal before process-exit recovery settles the logical turn", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "default",
      taskKind: "goal",
      nativeStatus: "completed",
      nativeGoalStatus: "complete",
      nativeTurnId: "codex-goal-continuation-turn",
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationGoal.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      create: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        activeTurnId: null,
        status: "complete",
      }),
      update: expect.objectContaining({
        activeTurnId: null,
        status: "complete",
      }),
    });
    expect(fixture.tx.conversationTurn.updateMany).toHaveBeenCalledWith({
      where: { id: TURN_ID, status: "running" },
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(fixture.tx.conversationGoal.updateMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID, activeTurnId: TURN_ID },
      data: { activeTurnId: null },
    });
    expect(fixture.confirmRecovery).toHaveBeenCalledOnce();
    expect(fixture.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ taskKind: "goal" }),
    );
    expect(fixture.titleRefresh.schedule).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("clears a completed Goal active turn when terminal event projection wins the process-exit race", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "default",
      taskKind: "goal",
      nativeStatus: "completed",
      nativeGoalStatus: "complete",
      terminalUpdateCount: 0,
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationGoal.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        activeTurnId: TURN_ID,
        status: { not: "active" },
      },
      data: { activeTurnId: null },
    });
  });

  it("keeps the logical Goal running when recovery sees a terminal native turn but the authoritative Goal is still active", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "default",
      taskKind: "goal",
      nativeStatus: "completed",
      nativeGoalStatus: "active",
    });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationGoal.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      create: expect.objectContaining({ status: "active" }),
      update: expect.objectContaining({ status: "active" }),
    });
    expect(fixture.tx.conversationTurn.updateMany).not.toHaveBeenCalled();
    expect(fixture.confirmRecovery).not.toHaveBeenCalled();
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(fixture.conversations.startPending).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an existing Plan review",
      collaborationMode: "plan" as const,
      taskKind: "turn" as const,
      nativeStatus: "completed" as const,
      hasPlanReview: true,
    },
    {
      name: "Default mode",
      collaborationMode: "default" as const,
      taskKind: "turn" as const,
      nativeStatus: "completed" as const,
      hasPlanReview: false,
    },
    {
      name: "a Goal turn",
      collaborationMode: "plan" as const,
      taskKind: "goal" as const,
      nativeStatus: "completed" as const,
      hasPlanReview: false,
    },
    {
      name: "a failed Plan turn",
      collaborationMode: "plan" as const,
      taskKind: "turn" as const,
      nativeStatus: "failed" as const,
      hasPlanReview: false,
    },
    {
      name: "an interrupted Plan turn",
      collaborationMode: "plan" as const,
      taskKind: "turn" as const,
      nativeStatus: "interrupted" as const,
      hasPlanReview: false,
    },
  ])("does not project a missing Plan output error for $name", async (input) => {
    const fixture = processExitTerminalFixture(input);

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "succeeded" });

    expect(fixture.tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("does not duplicate the durable missing Plan output error when process-exit confirmation retries", async () => {
    const fixture = processExitTerminalFixture({
      collaborationMode: "plan",
      taskKind: "turn",
      nativeStatus: "completed",
      retryTerminalTurn: true,
    });
    fixture.confirmRecovery
      .mockRejectedValueOnce(new AppError("RUNNER_UNAVAILABLE"))
      .mockResolvedValueOnce({ confirmed: true });

    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toMatchObject({ outcome: "failed" });
    await expect(
      fixture.service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "not_applicable" });

    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.prisma.conversationEvent.findFirst).toHaveBeenCalledOnce();
    expect(fixture.prisma.conversationEvent.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventType: "conversation.error",
        payloadJson: {
          path: ["error_code"],
          equals: "PLAN_OUTPUT_MISSING",
        },
      },
      orderBy: { sequenceNo: "desc" },
    });
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledTimes(2);
    expect(
      fixture.redis.publishConversationEvent.mock.calls.map(
        ([, event]) => event.sse_event_id,
      ),
    ).toEqual([
      `${CONVERSATION_ID}:1`,
      `${CONVERSATION_ID}:1`,
    ]);
  });

  it("retries process-exit confirmation after a durable terminal projection without running post-actions early", async () => {
    const runningTurn = {
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      submittedBy: OWNER_ID,
      codexTurnId: "codex-turn-1",
      status: "running",
      taskKind: "turn",
      collaborationMode: "default",
      capabilityGeneration: CAPABILITY_GENERATION,
      capabilitiesJson: [],
      interruptRequestedAt: null,
      idempotencyKey: "automation:test",
    };
    const turnUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: TURN_ID }]),
      conversationTurn: { updateMany: turnUpdate },
      conversationUserInputRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      conversationPlanReview: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      pendingRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      conversationTurnAttempt: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      conversation: { update: vi.fn().mockResolvedValue({}) },
      automationRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const confirmRecovery = vi
      .fn()
      .mockRejectedValueOnce(new AppError("RUNNER_UNAVAILABLE"))
      .mockResolvedValueOnce({ confirmed: true });
    const releaseTurnSlot = vi.fn().mockResolvedValue(undefined);
    const reconcile = vi.fn().mockResolvedValue({
      thread: {
        turns: [{ id: "codex-turn-1", status: "completed" }],
      },
    });
    const prisma = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          ownerId: OWNER_ID,
          codexThreadId: "codex-thread-1",
          runtimeGeneration: "01900000-0000-7000-8000-000000000010",
        }),
      },
      conversationTurn: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(runningTurn)
          .mockResolvedValueOnce({ ...runningTurn, status: "completed" }),
      },
      pendingRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(
        async (action: (tx: typeof transaction) => Promise<unknown>) =>
          action(transaction),
      ),
    };
    const service = new ConversationEventService(
      prisma as never,
      { releaseTurnSlot } as never,
      {
        resolveRecoveryRuntime: vi.fn().mockResolvedValue({
          capabilities: [],
          capabilityGeneration: CAPABILITY_GENERATION,
          environment: {},
          modelRuntime: TEST_MODEL_RUNTIME,
        }),
        runnerForRecovery: () => ({ reconcile, confirmRecovery }),
      } as never,
    );

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(releaseTurnSlot).not.toHaveBeenCalled();

    await expect(
      service.reconcileAfterProcessExit(processExitPayload()),
    ).resolves.toEqual({ outcome: "not_applicable" });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(confirmRecovery).toHaveBeenCalledTimes(2);
    expect(turnUpdate).toHaveBeenCalledOnce();
    expect(releaseTurnSlot).toHaveBeenCalledOnce();
    expect(confirmRecovery.mock.invocationCallOrder[1]).toBeLessThan(
      releaseTurnSlot.mock.invocationCallOrder[0]!,
    );
  });

  it("uses one in-process recovery cycle for concurrent callers", async () => {
    let resolveIntentRecovery: (() => void) | undefined;
    const recoverStartIntents = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveIntentRecovery = resolve;
        }),
    );
    let resolveLease: ((lease: null) => void) | undefined;
    const acquireRunningTurnReconcileLease = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveLease = resolve;
        }),
    );
    const service = new ConversationEventService(
      {} as never,
      { acquireRunningTurnReconcileLease } as never,
      { recoverStartIntents } as never,
    );

    const first = service.recoverRunningTurns({ requireObserved: false });
    const second = service.recoverRunningTurns({ requireObserved: false });

    expect(first).toBe(second);
    expect(recoverStartIntents).toHaveBeenCalledOnce();
    expect(acquireRunningTurnReconcileLease).not.toHaveBeenCalled();
    resolveIntentRecovery?.();
    await vi.waitFor(() => {
      expect(acquireRunningTurnReconcileLease).toHaveBeenCalledOnce();
    });
    resolveLease?.(null);
    await first;
  });

  it("keeps the shared status unchanged when another API instance owns the lease", async () => {
    const beginRunningTurnRecoveryAttempt = vi.fn();
    const completeRunningTurnRecoveryAttempt = vi.fn();
    const sharedStatus = {
      outcome: "not_started" as const,
      last_attempt_at: null,
      last_success_at: null,
      last_failure_at: null,
      reason_code: null,
    };
    const redis = {
      acquireRunningTurnReconcileLease: vi.fn().mockResolvedValue(null),
      beginRunningTurnRecoveryAttempt,
      completeRunningTurnRecoveryAttempt,
      runningTurnRecoveryStatus: vi.fn().mockResolvedValue(sharedStatus),
    };
    const service = new ConversationEventService(
      {} as never,
      redis as never,
      { recoverStartIntents: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.recoverRunningTurns({ requireObserved: false });

    expect(beginRunningTurnRecoveryAttempt).not.toHaveBeenCalled();
    expect(completeRunningTurnRecoveryAttempt).not.toHaveBeenCalled();
    await expect(service.getRunningTurnRecoveryStatus()).resolves.toEqual(
      sharedStatus,
    );
  });

  it("fails startup recovery when no fenced lease can be observed", async () => {
    vi.useFakeTimers();
    const fixture = runningRecoveryFixture();
    fixture.redis.acquireRunningTurnReconcileLease.mockResolvedValueOnce(null);
    fixture.redis.runningTurnRecoveryStatus.mockReset().mockResolvedValue({
      outcome: "not_started",
      last_attempt_at: null,
      last_success_at: null,
      last_failure_at: null,
      reason_code: null,
    });

    const recovery = fixture.service.recoverRunningTurns();
    const rejected = expect(recovery).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_LEASE_UNAVAILABLE",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    vi.useRealTimers();

    expect(
      fixture.redis.beginRunningTurnRecoveryAttempt,
    ).not.toHaveBeenCalled();
  });

  it("allows a second API instance to start when another instance holds the lease over a successful baseline", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.acquireRunningTurnReconcileLease.mockResolvedValueOnce(null);

    await expect(
      fixture.service.recoverRunningTurns(),
    ).resolves.toBeUndefined();

    expect(fixture.redis.runningTurnRecoveryStatus).toHaveBeenCalledOnce();
    expect(
      fixture.redis.beginRunningTurnRecoveryAttempt,
    ).not.toHaveBeenCalled();
  });

  it("waits for another API instance to establish the first successful baseline despite local intent-lock contention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const fixture = runningRecoveryFixture();
    fixture.conversations.recoverStartIntents.mockRejectedValueOnce(
      new AppError("INTERNAL_ERROR", {
        reason_code: "TURN_PROJECTION_UNAVAILABLE",
      }),
    );
    fixture.redis.acquireRunningTurnReconcileLease.mockResolvedValueOnce(null);
    fixture.redis.runningTurnRecoveryStatus
      .mockResolvedValueOnce({
        outcome: "running",
        last_attempt_at: "2026-07-15T00:00:00.100Z",
        last_success_at: null,
        last_failure_at: null,
        reason_code: null,
      })
      .mockResolvedValueOnce({
        outcome: "succeeded",
        last_attempt_at: "2026-07-15T00:00:00.100Z",
        last_success_at: "2026-07-15T00:00:00.200Z",
        last_failure_at: null,
        reason_code: null,
      });

    const recovery = fixture.service.recoverRunningTurns();
    await vi.advanceTimersByTimeAsync(100);
    await expect(recovery).resolves.toBeUndefined();
    vi.useRealTimers();

    expect(fixture.redis.runningTurnRecoveryStatus).toHaveBeenCalledTimes(2);
    expect(
      fixture.conversations.recoverContextWindowAttempts,
    ).toHaveBeenCalledOnce();
    expect(
      fixture.redis.beginRunningTurnRecoveryAttempt,
    ).not.toHaveBeenCalled();
  });

  it("does not mask a local intent recovery failure with an older successful baseline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:05.000Z"));
    const fixture = runningRecoveryFixture();
    fixture.conversations.recoverStartIntents.mockRejectedValueOnce(
      new AppError("INTERNAL_ERROR", {
        reason_code: "TURN_PROJECTION_UNAVAILABLE",
      }),
    );
    fixture.redis.acquireRunningTurnReconcileLease.mockResolvedValueOnce(null);
    fixture.redis.runningTurnRecoveryStatus.mockReset().mockResolvedValue({
      outcome: "succeeded",
      last_attempt_at: "2026-07-15T00:00:00.000Z",
      last_success_at: "2026-07-15T00:00:01.000Z",
      last_failure_at: null,
      reason_code: null,
    });

    const recovery = fixture.service.recoverRunningTurns();
    const rejected = expect(recovery).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_LEASE_UNAVAILABLE",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;

    expect(
      fixture.redis.runningTurnRecoveryStatus.mock.calls.length,
    ).toBeGreaterThan(1);
  });

  it("fails startup recovery when the fenced attempt cannot begin", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.beginRunningTurnRecoveryAttempt.mockResolvedValueOnce(null);

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_ATTEMPT_UNAVAILABLE",
    );

    expect(fixture.redis.releaseRunningTurnReconcileLease).toHaveBeenCalledWith(
      { token: "lease-secret", fence: 1 },
    );
  });

  it("fails startup recovery when the fenced Redis snapshot was not applied", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.reconcileRunningTurnSlots.mockResolvedValueOnce({
      applied: false,
      conflicted: false,
    });
    fixture.redis.completeRunningTurnRecoveryAttempt.mockResolvedValueOnce(
      false,
    );

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_COMPLETION_STALE",
    );

    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "RUNNING_TURN_RECOVERY_RECONCILE_STALE",
      }),
    );
  });

  it("fails startup recovery when the shared success completion is stale", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.completeRunningTurnRecoveryAttempt.mockResolvedValueOnce(
      false,
    );

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_COMPLETION_STALE",
    );
  });

  it("records a successful recovery through the shared fenced attempt", async () => {
    const recoveryTx = {
      conversationTurn: { findMany: vi.fn().mockResolvedValue([]) },
      conversationTurnStartIntent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      ...recoveryTx,
      $transaction: vi.fn(
        async (action: (tx: typeof recoveryTx) => Promise<unknown>) =>
          action(recoveryTx),
      ),
    };
    const completeRunningTurnRecoveryAttempt = vi.fn().mockResolvedValue(true);
    const redis = {
      acquireRunningTurnReconcileLease: vi.fn().mockResolvedValue({
        token: "lease-secret",
        fence: 1,
      }),
      beginRunningTurnRecoveryAttempt: vi.fn().mockResolvedValue({
        attempt: 1,
        fence: 1,
      }),
      reconcileRunningTurnSlots: vi.fn().mockResolvedValue({
        applied: true,
        conflicted: false,
      }),
      runningTurnSlots: vi.fn().mockResolvedValue([]),
      releaseRunningTurnReconcileLease: vi.fn().mockResolvedValue(undefined),
      completeRunningTurnRecoveryAttempt,
    };
    const service = new ConversationEventService(
      prisma as never,
      redis as never,
      { recoverStartIntents: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.recoverRunningTurns({ requireObserved: false });

    expect(completeRunningTurnRecoveryAttempt).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({
        outcome: "succeeded",
        completedAt: expect.any(String),
      }),
    );
  });

  it("marks the shared attempt failed when one runner reconciliation fails", async () => {
    const completeRunningTurnRecoveryAttempt = vi.fn().mockResolvedValue(true);
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const recoveryTx = {
      conversationTurn: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: TURN_ID,
            conversationId: CONVERSATION_ID,
            submittedBy: OWNER_ID,
            capabilityGeneration: CAPABILITY_GENERATION,
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          id: TURN_ID,
          conversationId: CONVERSATION_ID,
          submittedBy: OWNER_ID,
          codexTurnId: "codex-turn-1",
          status: "running",
          taskKind: "turn",
          collaborationMode: "default",
          capabilityGeneration: CAPABILITY_GENERATION,
          capabilitiesJson: [],
        }),
      },
      conversation: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          ownerId: OWNER_ID,
          codexThreadId: "codex-thread-1",
          runtimeGeneration: "01900000-0000-7000-8000-000000000010",
        }),
      },
      conversationEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      conversationTurnStartIntent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      ...recoveryTx,
      $transaction: vi.fn(
        async (action: (tx: typeof recoveryTx) => Promise<unknown>) =>
          action(recoveryTx),
      ),
      auditLog: { create: auditCreate },
    };
    const redis = {
      acquireRunningTurnReconcileLease: vi.fn().mockResolvedValue({
        token: "lease-secret",
        fence: 7,
      }),
      beginRunningTurnRecoveryAttempt: vi.fn().mockResolvedValue({
        attempt: 9,
        fence: 7,
      }),
      reconcileRunningTurnSlots: vi.fn().mockResolvedValue({
        applied: true,
        conflicted: false,
      }),
      runningTurnSlots: vi.fn().mockResolvedValue([]),
      releaseRunningTurnReconcileLease: vi.fn().mockResolvedValue(undefined),
      acquireRecoveryLock: vi.fn().mockResolvedValue("conversation-lock"),
      releaseRecoveryLock: vi.fn().mockResolvedValue(undefined),
      completeRunningTurnRecoveryAttempt,
    };
    const reconcile = vi
      .fn()
      .mockRejectedValue(new AppError("RUNNER_UNAVAILABLE"));
    const service = new ConversationEventService(
      prisma as never,
      redis as never,
      {
        recoverStartIntents: vi.fn().mockResolvedValue(undefined),
        resolveRecoveryRuntime: vi.fn().mockResolvedValue({
          capabilities: [],
          capabilityGeneration: CAPABILITY_GENERATION,
          environment: {},
          modelRuntime: TEST_MODEL_RUNTIME,
        }),
        runnerForRecovery: () => ({ reconcile }),
      } as never,
    );

    await service.recoverRunningTurns({ requireObserved: false });

    expect(completeRunningTurnRecoveryAttempt).toHaveBeenCalledWith(
      { attempt: 9, fence: 7 },
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE",
      }),
    );
    expect(completeRunningTurnRecoveryAttempt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "succeeded" }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "codex_thread_recovery_failed",
        metadataJson: { reason_code: "CODEX_THREAD_RECOVERY_UNAVAILABLE" },
      }),
    });
  });

  it("recovers durable start intents before leasing and records any intent failure in the shared attempt", async () => {
    const fixture = runningRecoveryFixture();
    fixture.conversations.recoverStartIntents.mockRejectedValueOnce(
      new AppError("INTERNAL_ERROR", {
        reason_code: "TURN_PROJECTION_UNAVAILABLE",
      }),
    );

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_START_INTENT_FAILED",
    );

    expect(
      fixture.conversations.recoverStartIntents.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.redis.acquireRunningTurnReconcileLease.mock
        .invocationCallOrder[0]!,
    );
    expect(fixture.redis.reconcileRunningTurnSlots).toHaveBeenCalledWith([], {
      token: "lease-secret",
      fence: 1,
    });
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "RUNNING_TURN_RECOVERY_START_INTENT_FAILED",
      }),
    );
  });

  it("reconstructs a missing Redis slot from an active durable start intent", async () => {
    const fixture = runningRecoveryFixture();
    fixture.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      {
        projectionTurnId: TURN_ID,
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
      },
    ]);

    await fixture.service.recoverRunningTurns();

    expect(fixture.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "RepeatableRead" },
    );
    expect(fixture.redis.reconcileRunningTurnSlots).toHaveBeenCalledWith(
      [
        {
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
          ownerId: OWNER_ID,
        },
      ],
      { token: "lease-secret", fence: 1 },
    );
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });

  it("excludes slot-pending and release-pending intents from the active slot snapshot", async () => {
    const fixture = runningRecoveryFixture();

    await fixture.service.recoverRunningTurns();

    expect(
      fixture.prisma.conversationTurnStartIntent.findMany,
    ).toHaveBeenCalledWith({
      where: {
        runnerStatus: { in: ["prepared", "runner_succeeded"] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        projectionTurnId: true,
        conversationId: true,
        ownerId: true,
      },
    });
    expect(fixture.redis.reconcileRunningTurnSlots).toHaveBeenCalledWith(
      [],
      expect.anything(),
    );
  });

  it("fails closed without reconciling when one conversation has conflicting active tokens", async () => {
    const fixture = runningRecoveryFixture();
    const conflictingTurnId = "30000000-0000-4000-8000-000000000002";
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([
      { id: TURN_ID, conversationId: CONVERSATION_ID, submittedBy: OWNER_ID },
    ]);
    fixture.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      {
        projectionTurnId: conflictingTurnId,
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
      },
    ]);

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_SLOT_CONFLICT",
    );

    expect(fixture.redis.reconcileRunningTurnSlots).not.toHaveBeenCalled();
    expect(fixture.redis.runningTurnSlots).not.toHaveBeenCalled();
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "RUNNING_TURN_RECOVERY_SLOT_CONFLICT",
      }),
    );
  });

  it("fails recovery when Redis retains a different token for an active database conversation", async () => {
    const fixture = runningRecoveryFixture();
    const staleRedisTurnId = "30000000-0000-4000-8000-000000000002";
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([
      { id: TURN_ID, conversationId: CONVERSATION_ID, submittedBy: OWNER_ID },
    ]);
    fixture.redis.runningTurnSlots.mockResolvedValueOnce([
      {
        conversationId: CONVERSATION_ID,
        turnId: staleRedisTurnId,
        ownerId: OWNER_ID,
      },
    ]);

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_SLOT_CONFLICT",
    );

    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "RUNNING_TURN_RECOVERY_SLOT_CONFLICT",
      }),
    );
  });

  it("deduplicates a running turn and active intent that prove the same slot", async () => {
    const fixture = runningRecoveryFixture();
    fixture.prisma.conversationTurn.findMany.mockResolvedValueOnce([
      { id: TURN_ID, conversationId: CONVERSATION_ID, submittedBy: OWNER_ID },
    ]);
    fixture.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      {
        projectionTurnId: TURN_ID,
        conversationId: CONVERSATION_ID,
        ownerId: OWNER_ID,
      },
    ]);
    fixture.redis.acquireRecoveryLock.mockResolvedValueOnce(null);

    await fixture.service.recoverRunningTurns();

    expect(fixture.redis.reconcileRunningTurnSlots).toHaveBeenCalledWith(
      [
        {
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
          ownerId: OWNER_ID,
        },
      ],
      expect.anything(),
    );
  });

  it("releases only an exactly proven terminal Redis slot", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.runningTurnSlots.mockResolvedValueOnce([
      { conversationId: CONVERSATION_ID, turnId: TURN_ID, ownerId: OWNER_ID },
    ]);
    fixture.prisma.conversationTurn.findUnique.mockResolvedValueOnce({
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      submittedBy: OWNER_ID,
      status: "completed",
    });

    await fixture.service.recoverRunningTurns();

    expect(fixture.redis.releaseTurnSlot).toHaveBeenCalledWith(
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });

  it("retains an observed Redis slot without a matching local turn", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.runningTurnSlots.mockResolvedValueOnce([
      { conversationId: CONVERSATION_ID, turnId: TURN_ID, ownerId: OWNER_ID },
    ]);

    await fixture.service.recoverRunningTurns();

    expect(fixture.prisma.conversationTurn.findUnique).toHaveBeenCalledWith({
      where: { id: TURN_ID },
      select: {
        id: true,
        conversationId: true,
        submittedBy: true,
        status: true,
      },
    });
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
  });

  it("retains an observed terminal slot whose owner does not match local proof", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.runningTurnSlots.mockResolvedValueOnce([
      { conversationId: CONVERSATION_ID, turnId: TURN_ID, ownerId: OWNER_ID },
    ]);
    fixture.prisma.conversationTurn.findUnique.mockResolvedValueOnce({
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      submittedBy: OTHER_ID,
      status: "completed",
    });

    await fixture.service.recoverRunningTurns();

    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });

  it("retains a proven terminal slot while any different unresolved start intent exists", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.runningTurnSlots.mockResolvedValueOnce([
      { conversationId: CONVERSATION_ID, turnId: TURN_ID, ownerId: OWNER_ID },
    ]);
    fixture.prisma.conversationTurn.findUnique.mockResolvedValueOnce({
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      submittedBy: OWNER_ID,
      status: "completed",
    });
    fixture.prisma.conversationTurnStartIntent.findFirst.mockResolvedValueOnce({
      projectionTurnId: "30000000-0000-4000-8000-000000000002",
    });

    await fixture.service.recoverRunningTurns();

    expect(
      fixture.prisma.conversationTurnStartIntent.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        runnerStatus: {
          in: [
            "slot_pending",
            "prepared",
            "runner_succeeded",
            "release_pending",
          ],
        },
        projectionTurnId: { not: TURN_ID },
      },
      select: { projectionTurnId: true },
    });
    expect(fixture.redis.releaseTurnSlot).not.toHaveBeenCalled();
  });

  it("marks the shared attempt failed when exact terminal slot release is unavailable", async () => {
    const fixture = runningRecoveryFixture();
    fixture.redis.runningTurnSlots.mockResolvedValueOnce([
      { conversationId: CONVERSATION_ID, turnId: TURN_ID, ownerId: OWNER_ID },
    ]);
    fixture.prisma.conversationTurn.findUnique.mockResolvedValueOnce({
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      submittedBy: OWNER_ID,
      status: "failed",
    });
    const releaseError = new Error("release unavailable");
    releaseError.name = "RedisUnavailableError";
    fixture.redis.releaseTurnSlot.mockRejectedValueOnce(releaseError);

    await expect(fixture.service.recoverRunningTurns()).rejects.toThrow(
      "RUNNING_TURN_RECOVERY_REDIS_UNAVAILABLE",
    );

    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).toHaveBeenCalledWith(
      { attempt: 1, fence: 1 },
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "RUNNING_TURN_RECOVERY_REDIS_UNAVAILABLE",
      }),
    );
    expect(
      fixture.redis.completeRunningTurnRecoveryAttempt,
    ).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });
});

function runningRecoveryFixture() {
  const recoveryTx = {
    conversationTurn: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    conversationTurnStartIntent: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    ...recoveryTx,
    $transaction: vi.fn(
      async (action: (tx: typeof recoveryTx) => Promise<unknown>) =>
        action(recoveryTx),
    ),
    conversation: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    conversationEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const redis = {
    acquireRunningTurnReconcileLease: vi.fn().mockResolvedValue({
      token: "lease-secret",
      fence: 1,
    }),
    beginRunningTurnRecoveryAttempt: vi.fn().mockResolvedValue({
      attempt: 1,
      fence: 1,
    }),
    reconcileRunningTurnSlots: vi.fn().mockResolvedValue({
      applied: true,
      conflicted: false,
    }),
    releaseRunningTurnReconcileLease: vi.fn().mockResolvedValue(undefined),
    completeRunningTurnRecoveryAttempt: vi.fn().mockResolvedValue(true),
    runningTurnRecoveryStatus: vi.fn().mockResolvedValue({
      outcome: "succeeded",
      last_attempt_at: "2026-07-15T00:00:00.000Z",
      last_success_at: "2026-07-15T00:00:01.000Z",
      last_failure_at: null,
      reason_code: null,
    }),
    runningTurnSlots: vi.fn().mockResolvedValue([]),
    releaseTurnSlot: vi.fn().mockResolvedValue(undefined),
    acquireRecoveryLock: vi.fn().mockResolvedValue(null),
    releaseRecoveryLock: vi.fn().mockResolvedValue(undefined),
  };
  const runnerReconcile = vi.fn().mockResolvedValue({ thread: { turns: [] } });
  const conversations = {
    recoverStartIntents: vi.fn().mockResolvedValue(undefined),
    recoverContextWindowAttempts: vi.fn().mockResolvedValue(undefined),
    resolveRecoveryRuntime: vi.fn().mockResolvedValue({
      capabilities: [],
      capabilityGeneration: CAPABILITY_GENERATION,
      environment: {},
      modelRuntime: TEST_MODEL_RUNTIME,
    }),
    runnerForRecovery: () => ({ reconcile: runnerReconcile }),
  };
  return {
    prisma,
    redis,
    conversations,
    runnerReconcile,
    service: new ConversationEventService(
      prisma as never,
      redis as never,
      conversations as never,
    ),
  };
}

function internalRunnerCallbackRequests() {
  return [
    {
      method: "POST" as const,
      url: "/runner/events",
      payload: {
        conversationId: CONVERSATION_ID,
        events: [{ deliveryId: "60000000-0000-4000-8000-000000000001",
        event: {
          threadId: "codex-thread-1",
          eventType: "conversation.title.updated",
          visibility: "user_visible",
          payload: { schema_version: 1, title: "Safe title" },
        } }],
      },
    },
    {
      method: "POST" as const,
      url: "/runner/process-exit",
      payload: processExitPayload(),
    },
    {
      method: "POST" as const,
      url: "/file-service/register-artifact",
      payload: {
        conversationId: CONVERSATION_ID,
        turnId: "codex-turn-1",
        workspaceRelativePath: "artifacts/report.txt",
        displayName: "report.txt",
        mimeType: "text/plain",
      },
    },
  ];
}

function processExitPayload() {
  return {
    conversationId: CONVERSATION_ID,
    projectionTurnId: TURN_ID,
    capabilityGeneration: CAPABILITY_GENERATION,
  };
}

function processExitTerminalFixture(options: {
  collaborationMode: "default" | "plan";
  taskKind: "turn" | "goal" | "compact";
  nativeStatus: "inProgress" | "completed" | "failed" | "interrupted";
  nativeGoalStatus?:
    | "active"
    | "paused"
    | "blocked"
    | "usageLimited"
    | "budgetLimited"
    | "complete";
  nativeTurnId?: string;
  hasPlanReview?: boolean;
  nativePlanOutput?: boolean;
  retryTerminalTurn?: boolean;
  terminalUpdateCount?: number;
}) {
  const nativeGoalStatus =
    options.taskKind === "goal"
      ? (options.nativeGoalStatus ??
        (options.nativeStatus === "inProgress" ? "active" : "complete"))
      : null;
  const tx = transactionFixture({
    collaborationMode: options.collaborationMode,
    taskKind: options.taskKind,
  });
  if (nativeGoalStatus) {
    tx.conversationGoal.upsert.mockResolvedValue(
      goalRow({ status: nativeGoalStatus, activeTurnId: TURN_ID }),
    );
  }
  tx.conversationTurn.updateMany.mockResolvedValue({
    count: options.terminalUpdateCount ?? 1,
  });
  let planReviewLookup = 0;
  tx.conversationPlanReview.findFirst.mockImplementation(async () => {
    planReviewLookup += 1;
    if (planReviewLookup === 1) return null;
    return options.hasPlanReview ? { id: PLAN_REVIEW_ID } : null;
  });
  const runningTurn = turnRow({
    collaborationMode: options.collaborationMode,
    taskKind: options.taskKind,
    status: "running",
  });
  const persistedPlanOutputMissingEvent = {
    ...eventRow(1n),
    id: "60000000-0000-4000-8000-000000000043",
    turnId: TURN_ID,
    eventType: "conversation.error",
    visibility: "user_visible",
    payloadJson: {
      schema_version: 1,
      error_code: "PLAN_OUTPUT_MISSING",
      message_key: "errors.conversation.planOutputMissing",
      retryable: true,
    },
  };
  const hasPersistedPlanOutputMissingEvent =
    options.collaborationMode === "plan" &&
    options.taskKind === "turn" &&
    options.nativeStatus === "completed" &&
    !options.hasPlanReview &&
    !options.nativePlanOutput &&
    (options.retryTerminalTurn || options.terminalUpdateCount === 0);
  const lifecycle: string[] = [];
  let turnLookup = 0;
  const prisma = {
    conversation: {
      findUnique: vi.fn().mockResolvedValue({
        id: CONVERSATION_ID,
        ownerId: OWNER_ID,
        codexThreadId: "codex-thread-1",
        runtimeGeneration: "01900000-0000-7000-8000-000000000010",
      }),
    },
    conversationTurn: {
      findUnique: vi.fn(async () => {
        turnLookup += 1;
        return options.retryTerminalTurn && turnLookup > 1
          ? { ...runningTurn, status: "completed" }
          : runningTurn;
      }),
    },
    conversationEvent: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          hasPersistedPlanOutputMissingEvent
            ? persistedPlanOutputMissingEvent
            : null,
        ),
    },
    conversationPlanReview: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.hasPlanReview ? { id: PLAN_REVIEW_ID } : null),
    },
    pendingRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(
      async (action: (transaction: typeof tx) => Promise<unknown>) => {
        const result = await action(tx);
        lifecycle.push("transaction.committed");
        return result;
      },
    ),
  };
  const redis = {
    publishConversationEvent: vi.fn(
      async (
        _conversationId: string,
        event: { event_type: string; sse_event_id: string },
      ) => {
        lifecycle.push(`${event.event_type}.published`);
      },
    ),
    releaseTurnSlot: vi.fn().mockResolvedValue(undefined),
  };
  const confirmRecovery = vi.fn().mockResolvedValue({ confirmed: true });
  const titleRefresh = { schedule: vi.fn() };
  const reconcile = vi.fn().mockResolvedValue({
    thread: {
      turns: [
        {
          id: options.nativeTurnId ?? "codex-turn-1",
          status: options.nativeStatus,
          ...(options.nativePlanOutput
            ? {
                items: [
                  {
                    id: "native-plan-1",
                    type: "plan",
                    text: "# Implementation plan\n\n1. Prepare the deliverable.",
                  },
                ],
              }
            : {}),
          ...(options.nativeStatus === "failed"
            ? {
                error: {
                  message: "Recovered provider failure.",
                  codexErrorInfo: "other",
                },
              }
            : {}),
        },
      ],
    },
    goal: nativeGoalStatus
      ? {
          threadId: "codex-thread-1",
          objective: "完成目标功能",
          status: nativeGoalStatus,
          tokenBudget: 100_000,
          tokensUsed: 1_000,
          timeUsedSeconds: 38,
          createdAt: 1_785_996_000,
          updatedAt: 1_785_996_038,
        }
      : null,
  });
  const conversations = {
    resolveRecoveryRuntime: vi.fn().mockResolvedValue({
      capabilities: [],
      capabilityGeneration: CAPABILITY_GENERATION,
      environment: {},
      modelRuntime: TEST_MODEL_RUNTIME,
    }),
    runnerForRecovery: () => ({ reconcile, confirmRecovery }),
    startPending: vi.fn().mockResolvedValue(undefined),
  };
  return {
    tx,
    prisma,
    redis,
    conversations,
    confirmRecovery,
    titleRefresh,
    reconcile,
    lifecycle,
    service: new ConversationEventService(
      prisma as never,
      redis as never,
      conversations as never,
      titleRefresh,
    ),
  };
}

function memoryUsagePayload() {
  return {
    request_id: "50000000-0000-4000-8000-000000000001",
    owner_id: OWNER_ID,
    conversation_id: CONVERSATION_ID,
    operation: "extract",
    model: "gpt-memory",
    measurement_method: "provider",
    token_usage: {
      total_tokens: 50,
      input_tokens: 40,
      cached_input_tokens: 10,
      output_tokens: 10,
      reasoning_output_tokens: 2,
    },
    pricing: {
      input_price_per_million: "5",
      cached_input_price_per_million: "1",
      output_price_per_million: "8",
    },
    observed_at: "2026-07-31T03:00:00.000Z",
  };
}

function textDeltaEntry(delta: string, index: number): { deliveryId: string; event: RunnerTextDeltaEvent } {
  return {
    deliveryId: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event: { method: "item/agentMessage/delta", visibility: "user_visible", params: { threadId: "codex-thread-1", turnId: "codex-turn-1", itemId: "stream-item", delta } },
  };
}

function textDeltaRows(entries: ReturnType<typeof textDeltaEntry>[]): StoredEventFixture[] {
  return entries.map(({ deliveryId, event }, index) => ({
    ...eventRow(BigInt(index + 1)), id: deliveryId, eventType: event.method,
    payloadJson: { schema_version: 2, source: "codex_app_server", method: event.method, params: event.params },
  }));
}

function eventFixture(
  titleRefresh?: {
    schedule(conversationId: string): void;
  },
  options?: {
    knowledgeBaseIds?: string[];
    taskKind?: "turn" | "goal" | "compact";
    activeGoal?: boolean;
    collaborationMode?: "default" | "plan";
  },
) {
  const tx = transactionFixture(options);
  const prisma = {
    $queryRaw: vi.fn<(query: Prisma.Sql) => Promise<Array<(ConversationEvent | { id: null }) & { confirmedSequence: bigint }>>>().mockResolvedValue([]),
    auditLog: { findFirst: vi.fn<() => Promise<{ createdAt: Date } | null>>().mockResolvedValue(null) },
    conversation: {
      findFirst: vi.fn(async () => ({ id: CONVERSATION_ID })),
      findUnique: vi.fn(async () => ({
        id: CONVERSATION_ID,
        codexThreadId: "codex-thread-1",
      })),
    },
    conversationTurn: {
      findFirst: vi.fn<() => Promise<ReturnType<typeof turnRow> | null>>(
        async () =>
          turnRow({
            knowledgeBaseIdsJson: options?.knowledgeBaseIds ?? [],
            taskKind: options?.taskKind ?? "turn",
            collaborationMode: options?.collaborationMode ?? "default",
          }),
      ),
    },
    conversationTurnAttempt: {
      findUnique: vi.fn<
        () => Promise<ReturnType<typeof attemptRow> | null>
      >(async () => attemptRow()),
      findFirst: vi.fn(async () =>
        options?.activeGoal ? attemptRow() : null,
      ),
    },
    conversationGoal: {
      findFirst: vi.fn(async () =>
        options?.activeGoal ? goalRow() : null,
      ),
    },
    conversationEvent: {
      findMany: vi.fn(async () => [] as Array<{ payloadJson: unknown }>),
    },
    conversationUserInputRequest: {
      findFirst: vi.fn(async () => null as Record<string, unknown> | null),
    },
    interactiveApplicationPackage: {
      findFirst: vi.fn(async () => null as Record<string, unknown> | null),
    },
    pendingRequest: {
      findFirst: vi.fn(
        async () => null as { id: string; status: string } | null,
      ),
    },
    user: {
      findUnique: vi.fn(async () => ({ preferredLocale: "zh-CN" })),
    },
    $transaction: vi.fn(
      async (action: (transaction: typeof tx) => Promise<unknown>) =>
        action(tx),
    ),
  };
  const redis = {
    publishConversationEvent: vi.fn<(conversationId: string, event: unknown) => Promise<void>>(async () => undefined),
    publishConversationEvents: vi.fn(async () => undefined),
    releaseTurnSlot: vi.fn(async () => undefined),
  };
  const confirmRecovery = vi.fn(async () => ({ confirmed: true as const }));
  const conversations = {
    assertOwner: vi.fn(async () => turnRow()),
    startPending: vi.fn(async () => ({})),
    recoverContextWindowAttempt: vi.fn(async () => "running" as const),
    runnerForRecovery: () => ({ confirmRecovery }),
  };
  return {
    prisma,
    redis,
    conversations,
    confirmRecovery,
    tx,
    service: new ConversationEventService(
      prisma as never,
      redis as never,
      conversations as never,
      titleRefresh,
    ),
  };
}

function transactionFixture(options?: {
  taskKind?: "turn" | "goal" | "compact";
  activeGoal?: boolean;
  collaborationMode?: "default" | "plan";
}) {
  const conversationEventCreate = vi.fn<
    (input: { data: Record<string, unknown> }) => Promise<StoredEventFixture>
  >(
    async ({ data }) =>
      ({
        ...eventRow(typeof data.sequenceNo === "bigint" ? data.sequenceNo : 1n),
        ...data,
      }) as StoredEventFixture,
  );
  const insertTextRows = vi.fn(async (data: Array<{ id: string }>) => data.map(({ id }) => ({ id: id.toLowerCase(), createdAt: NOW })));
  return {
    insertTextRows,
    $queryRaw: vi.fn(async (query: Prisma.Sql | TemplateStringsArray) => {
      if ("sql" in query && query.sql.includes("INSERT INTO conversation_events")) {
        const encoded = query.values[2];
        if (typeof encoded !== "string") throw new Error("missing bound text rows");
        return insertTextRows(z.array(z.object({ id: z.string() }).passthrough()).parse(JSON.parse(encoded)));
      }
      return [{ id: CONVERSATION_ID }];
    }),
    $executeRaw: vi.fn(async () => 1),
    conversationEvent: {
      findMany: vi.fn(async () => [] as StoredEventFixture[]),
      findFirst: vi.fn(
        async () =>
          null as {
            sequenceNo?: bigint;
            payloadJson?: unknown;
          } | null,
      ),
      findUnique: vi.fn(async () => null as StoredEventFixture | null),
      create: conversationEventCreate,
    },
    conversationMessage: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [] as Array<{ contentText: string }>),
      create: vi.fn(async () => ({
        id: "70000000-0000-4000-8000-000000000001",
      })),
    },
    conversationUserInputRequest: {
      findFirst: vi.fn(async () => null as Record<string, unknown> | null),
      findUnique: vi.fn(async () => null as Record<string, unknown> | null),
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: "72000000-0000-4000-8000-000000000001",
          createdAt: NOW,
          updatedAt: NOW,
          resolvedAt: null,
          ...data,
        }),
      ),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    conversationPlanReview: {
      findFirst: vi.fn(async () =>
        options?.collaborationMode === "plan" ? { id: PLAN_REVIEW_ID } : null,
      ),
      upsert: vi.fn(
        async ({ create }: { create: Record<string, unknown> }) => ({
          id: PLAN_REVIEW_ID,
          decision: null,
          followUpTurnId: null,
          resolvedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          ...create,
        }),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    pendingRequest: {
      findFirst: vi.fn(
        async () => null as { id: string } | null,
      ),
    },
    knowledgeBaseDocumentVersion: {
      findMany: vi.fn(
        async () =>
          [] as Array<{
            id: string;
            knowledgeBaseId: string;
            documentId: string;
          }>,
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    knowledgeBase: {
      findMany: vi.fn(async () => [
        {
          id: "81000000-0000-4000-8000-000000000001",
          name: "售后知识库",
        },
      ]),
    },
    knowledgeBaseDocument: {
      findMany: vi.fn(async () => [
        {
          id: "82000000-0000-4000-8000-000000000001",
          knowledgeBaseId: "81000000-0000-4000-8000-000000000001",
          displayName: "售后政策.pdf",
        },
      ]),
    },
    knowledgeBaseCleanupOutbox: {
      findFirst: vi.fn(async () => null),
    },
    conversationMessageKnowledgeCitation: {
      create: vi.fn(async () => ({
        id: "71000000-0000-4000-8000-000000000001",
      })),
    },
    conversationMessageKnowledgeCitationAnchor: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    conversationTurn: {
      findMany: vi.fn(async () => [{ id: TURN_ID }]),
      findFirst: vi.fn(
        async (query?: { where?: Record<string, unknown>; orderBy?: unknown }) =>
          query?.orderBy && query.where && !("status" in query.where)
            ? turnRow({
                taskKind: options?.taskKind ?? "turn",
                collaborationMode: options?.collaborationMode ?? "default",
              })
            : null,
      ),
      findUnique: vi.fn(async () =>
        turnRow({
          taskKind: options?.taskKind ?? "turn",
          collaborationMode: options?.collaborationMode ?? "default",
        }),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    conversationTurnStartIntent: {
      findUnique: vi.fn(async () => null as { projectionTurnId: string } | null),
      findFirst: vi.fn(async () => null as { projectionTurnId: string } | null),
      findMany: vi.fn(async () => [] as Array<{ projectionTurnId: string }>),
    },
    conversationTurnAttempt: {
      findUnique: vi.fn(
        async (): Promise<{ id: string; status: string } | null> => null,
      ),
      findFirst: vi.fn(
        async () => null as ReturnType<typeof attemptRow> | null,
      ),
      create: vi.fn(async () => attemptRow()),
      updateMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(async () => ({
        id: RECOVERY_ATTEMPT_ID,
        status: "pending",
      })),
    },
    conversationGoal: {
      findUnique: vi.fn(async () =>
        options?.activeGoal ? goalRow() : null,
      ),
      findFirst: vi.fn(
        async () => null as ReturnType<typeof goalRow> | null,
      ),
      upsert: vi.fn(async () => goalRow()),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    automationRun: {
      findFirst: vi.fn(
        async () => null as { id: string; automationId?: string } | null,
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    automation: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    conversationFile: {
      findFirst: vi.fn(async () => null as { id: string } | null),
    },
    conversation: {
      findUnique: vi.fn(async () => ({
        codexThreadId: "codex-thread-1",
        ownerId: OWNER_ID,
        collaborationMode: options?.collaborationMode ?? "default",
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
}

type StoredEventFixture = Omit<ReturnType<typeof eventRow>, "payloadJson"> & {
  payloadJson: unknown;
};

function turnRow(
  overrides: Partial<{
    knowledgeBaseIdsJson: string[];
    taskKind: "turn" | "goal" | "compact";
    codexTurnId: string;
    collaborationMode: "default" | "plan";
    status: "running" | "completed" | "failed" | "interrupted";
    completedAt: Date | null;
    interruptedAt: Date | null;
    errorCode: string | null;
  }> = {},
) {
  return {
    id: TURN_ID,
    conversationId: CONVERSATION_ID,
    submittedBy: OWNER_ID,
    codexThreadId: "codex-thread-1",
    codexTurnId: "codex-turn-1",
    taskKind: "turn",
    collaborationMode: "default",
    status: "running",
    sequenceNo: 1,
    completedAt: null,
    interruptedAt: null,
    errorCode: null,
    updatedAt: NOW,
    idempotencyKey: "automation:test",
    interruptRequestedAt: null,
    knowledgeBaseIdsJson: [],
    capabilityGeneration: CAPABILITY_GENERATION,
    capabilitiesJson: [],
    ...overrides,
  };
}

function attemptRow(
  overrides: Partial<{
    id: string;
    attemptNo: number;
    kind: string;
    codexTurnId: string;
    sourceCodexTurnId: string | null;
    status: string;
  }> = {},
) {
  return {
    id: ATTEMPT_ID,
    turnId: TURN_ID,
    attemptNo: 1,
    kind: "primary",
    codexThreadId: "codex-thread-1",
    codexTurnId: "codex-turn-1",
    sourceCodexTurnId: null,
    status: "running",
    continuationContextJson: {
      require_final_response: false,
      application_instructions: null,
      collaboration_mode: "default",
      selected_knowledge_base_count: 0,
      priority_capability_ids: [],
    },
    errorCode: null,
    errorMessage: null,
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function goalRow(
  overrides: Partial<{
    status: string;
    activeTurnId: string | null;
    nativeCreatedAt: Date;
    nativeUpdatedAt: Date;
  }> = {},
) {
  return {
    conversationId: CONVERSATION_ID,
    ownerId: OWNER_ID,
    codexThreadId: "codex-thread-1",
    activeTurnId: TURN_ID,
    objective: "完成目标功能",
    status: "active",
    tokenBudget: 100_000n,
    tokensUsed: 1_000n,
    timeUsedSeconds: 38n,
    nativeCreatedAt: NOW,
    nativeUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function eventRow(sequenceNo = 1n) {
  return {
    id: `60000000-0000-4000-8000-${String(sequenceNo).padStart(12, "0")}`,
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    sequenceNo,
    eventType: "conversation.step.completed",
    visibility: "user_visible",
    payloadJson: {
      schema_version: 1,
      item_id: `item-${sequenceNo}`,
      action: "safe",
      safe_summary: "safe",
    },
    sseEventId: `${CONVERSATION_ID}:${sequenceNo}`,
    createdAt: NOW,
  };
}

function projectedEvent(sequenceNo: number) {
  return {
    id: `60000000-0000-4000-8000-${String(sequenceNo).padStart(12, "0")}`,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    sequence_no: sequenceNo,
    event_type: "conversation.step.completed" as const,
    visibility: "user_visible" as const,
    payload: {
      schema_version: 1 as const,
      item_id: `item-${sequenceNo}`,
      action: "safe",
      safe_summary: "safe",
    },
    sse_event_id: `${CONVERSATION_ID}:${sequenceNo}`,
    created_at: NOW.toISOString(),
  };
}

function eventHistoryPage(
  items: ReturnType<typeof projectedEvent>[],
  latestPersistedSequence: bigint,
) {
  return {
    items,
    next_cursor: null,
    last_sequence:
      items.length > 0
        ? BigInt(items.at(-1)?.sequence_no ?? 0)
        : 0n,
    confirmed_sequence: latestPersistedSequence,
  };
}
