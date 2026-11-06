import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { publicKnowledgeRunnerProgressSchema } from "@linksense/shared";
import type {
  PrismaClient,
  ConversationEvent,
} from "../src/generated/prisma/client.js";
import type { LinkSenseRedis } from "../src/adapters/redis.js";
import { PrismaPublicKnowledgeProgress } from "../src/modules/public-knowledge/progress.js";

const conversationId = "00000000-0000-4000-8000-000000000001",
  turnId = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const rows = new Map<string, ConversationEvent>();
  type Query = {
    where: {
      conversationId?: string;
      turnId?: string;
      id?: { in: string[] };
      sequenceNo?: { gt: bigint };
      eventType?: { notIn: string[] };
    };
    orderBy?: { sequenceNo: "asc" | "desc" };
    take?: number;
  };
  const findMany = vi.fn(async ({ where, orderBy, take }: Query) =>
    [...rows.values()]
      .filter(
        (row) =>
          (!where.conversationId ||
            row.conversationId === where.conversationId) &&
          (!where.turnId || row.turnId === where.turnId) &&
          (!where.id || where.id.in.includes(row.id)) &&
          (!where.sequenceNo || row.sequenceNo > where.sequenceNo.gt) &&
          (!where.eventType || !where.eventType.notIn.includes(row.eventType)),
      )
      .sort(
        (a, b) =>
          Number(a.sequenceNo - b.sequenceNo) *
          (orderBy?.sequenceNo === "desc" ? -1 : 1),
      )
      .slice(0, take ?? Number.POSITIVE_INFINITY),
  );
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    conversationEvent: {
      findMany,
      findFirst: vi.fn(
        async (query: Query) => (await findMany(query))[0] ?? null,
      ),
      createMany: vi.fn(async ({ data }: { data: ConversationEvent[] }) => {
        data.forEach((row) => rows.set(row.id, row));
        return { count: data.length };
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async <T>(run: (value: typeof tx) => Promise<T>) =>
      run(tx),
    ),
  } as unknown as PrismaClient;
  const subscriber = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => 1),
    disconnect: vi.fn(),
  });
  const bus = {
    duplicate: vi.fn(() => subscriber),
    publishConversationEvents: vi.fn(async (id: string) => {
      subscriber.emit("message", `linksense:conversation-events:${id}`, "wake");
    }),
  } as unknown as Pick<
    LinkSenseRedis,
    "duplicate" | "publishConversationEvents"
  >;
  const logger = { warn: vi.fn() };
  const store = new PrismaPublicKnowledgeProgress(prisma, bus, logger);
  return { store, rows, tx, subscriber, bus, logger };
}
const entry = () => ({
  deliveryId: "00000000-0000-4000-8000-000000000003",
  event: publicKnowledgeRunnerProgressSchema.parse({
    method: "linksense/publicKnowledge/progress",
    visibility: "user_visible",
    params: {
      threadId: conversationId,
      turnId,
      notification: {
        method: "item/agentMessage/delta",
        visibility: "user_visible",
        params: {
          threadId: conversationId,
          turnId,
          itemId: "message",
          delta: "Live answer",
        },
      },
    },
  }),
});

describe("public durable progress", () => {
  it("replays persisted events, resumes at the cursor, and keeps running text out of historical snapshots", async () => {
    const f = fixture();
    await f.store.step(conversationId, turnId, "started");
    await f.store.ingest(conversationId, [entry()]);
    await f.store.ingest(conversationId, [entry()]);
    expect(f.rows.size).toBe(2);
    const snapshot = await f.store.snapshot(conversationId, turnId);
    expect(snapshot.events.map((event) => event.event_type)).toEqual([
      "conversation.step.started",
    ]);
    expect(snapshot.event_cursor).toBe(`${conversationId}:0`);
    const controller = new AbortController(),
      authorize = vi.fn(async () => undefined);
    const iterable = f.store.stream(
      conversationId,
      1n,
      controller.signal,
      authorize,
    );
    const stream = iterable[Symbol.asyncIterator]();
    expect((await stream.next()).value).toContain("Live answer");
    expect(authorize).toHaveBeenCalledOnce();
    controller.abort();
    await stream.return?.();
    expect(f.subscriber.disconnect).toHaveBeenCalledOnce();
  });
  it("keeps notification failures retryable without duplicating persisted progress", async () => {
    const f = fixture();
    vi.mocked(f.bus.publishConversationEvents).mockRejectedValueOnce(
      new Error("transport unavailable"),
    );
    await expect(
      f.store.ingest(conversationId, [entry()]),
    ).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    await f.store.ingest(conversationId, [entry()]);
    expect(f.rows.size).toBe(1);
    expect(f.logger.warn).toHaveBeenCalledOnce();
    await expect(
      f.store.ingest(conversationId, [
        {
          ...entry(),
          event: publicKnowledgeRunnerProgressSchema.parse({
            ...entry().event,
            params: {
              ...entry().event.params,
              notification: {
                method: "item/agentMessage/delta",
                visibility: "user_visible",
                params: {
                  threadId: conversationId,
                  turnId,
                  itemId: "message",
                  delta: "Changed delivery",
                },
              },
            },
          }),
        },
      ]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("closes an idle stream during service shutdown without waiting for a heartbeat", async () => {
    const f = fixture(),
      authorize = vi.fn(async () => undefined);
    const iterable = f.store.stream(
      conversationId,
      0n,
      new AbortController().signal,
      authorize,
    );
    const stream = iterable[Symbol.asyncIterator]();
    const waiting = stream.next();
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    f.store.close();
    expect((await waiting).done).toBe(true);
    expect(f.subscriber.disconnect).toHaveBeenCalledOnce();
  });
});
