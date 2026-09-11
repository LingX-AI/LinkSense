import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runnerEventBatchSchema, type RunnerCodexEvent } from "@linksense/shared";
import { HttpRunnerEventSink } from "../src/event-sink.js";
import { RunnerEventOutboxStore } from "../src/workspace/event-outbox.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

const roots: string[] = [];
const sinks: HttpRunnerEventSink[] = [];
const conversationId = "20000000-0000-4000-8000-000000000001";
const ownerId = "10000000-0000-4000-8000-000000000001";
afterEach(async () => {
  await Promise.all(sinks.splice(0).map(sink => sink.close(0)));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function delta(text: string): RunnerCodexEvent {
  return { method: "item/agentMessage/delta", visibility: "user_visible", params: { threadId: "thread", turnId: "turn", itemId: "item", delta: text } };
}

async function fixture(events: RunnerCodexEvent[]) {
  const root = await mkdtemp(join(tmpdir(), "linksense-event-batch-"));
  roots.push(root);
  const manager = new WorkspaceManager(root, undefined, { fixedOwnerId: ownerId });
  const outbox = new RunnerEventOutboxStore(manager);
  const entries = [];
  for (const event of events) entries.push(await outbox.append(conversationId, event));
  const createSink = (fetch: typeof globalThis.fetch) => {
    const sink = new HttpRunnerEventSink("http://127.0.0.1:4000", "batch-test-secret", manager, { fetch, retryBaseMs: 1, retryMaxMs: 1 });
    sinks.push(sink);
    return sink;
  };
  return { entries, outbox, createSink };
}

function request(init: RequestInit | undefined) {
  return runnerEventBatchSchema.parse(JSON.parse(String(init?.body)));
}
function receipt(ids: string[]) {
  return new Response(JSON.stringify({ data: { accepted_delivery_ids: ids } }));
}

describe("durable ordered event batches", () => {
  it("sends consecutive text and lifecycle events unchanged in one request", async () => {
    const events: RunnerCodexEvent[] = [
      { method: "turn/started", visibility: "user_visible", params: { threadId: "thread", turn: { id: "turn", status: "inProgress" } } },
      delta("第一段"), delta("第二段"),
      { method: "turn/completed", visibility: "user_visible", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } },
    ];
    const { entries, outbox, createSink } = await fixture(events);
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => receipt(request(init).events.map(entry => entry.deliveryId)));
    await createSink(fetch).restore();
    await vi.waitFor(async () => expect(await outbox.list(conversationId)).toEqual([]));
    expect(fetch).toHaveBeenCalledOnce();
    expect(request(fetch.mock.calls[0]![1]).events).toEqual(entries.map(({ deliveryId, event }) => ({ deliveryId, event })));
  });

  it("removes only the acknowledged prefix and retries the remaining ids in order", async () => {
    const { entries, outbox, createSink } = await fixture([delta("a"), delta("b"), delta("c")]);
    let requests = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests++;
      const batch = request(init);
      return receipt(batch.events.slice(0, requests === 1 ? 1 : undefined).map(entry => entry.deliveryId));
    });
    await createSink(fetch).restore();
    await vi.waitFor(async () => expect(await outbox.list(conversationId)).toEqual([]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(request(fetch.mock.calls[1]![1]).events.map(entry => entry.deliveryId)).toEqual(entries.slice(1).map(entry => entry.deliveryId));
  });

  it("replays the same ids after an acknowledgement is lost", async () => {
    const { entries, outbox, createSink } = await fixture([delta("a"), delta("b")]);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("acknowledgement lost"))
      .mockImplementation(async (_url, init) => receipt(request(init).events.map(entry => entry.deliveryId)));
    await createSink(fetch).restore();
    await vi.waitFor(async () => expect(await outbox.list(conversationId)).toEqual([]));
    expect(request(fetch.mock.calls[0]![1])).toEqual(request(fetch.mock.calls[1]![1]));
    expect(request(fetch.mock.calls[1]![1]).events.map(entry => entry.deliveryId)).toEqual(entries.map(entry => entry.deliveryId));
  });

  it.each(["reversed", "gap", "foreign", "too-many"])("keeps the outbox intact after a %s acknowledgement", async (invalid) => {
    const { entries, outbox, createSink } = await fixture([delta("a"), delta("b")]);
    const ids = entries.map(entry => entry.deliveryId);
    const invalidIds = invalid === "reversed" ? [...ids].reverse() : invalid === "gap" ? ids.slice(1) : invalid === "foreign" ? [randomUUID()] : [...ids, ids[0]!];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => receipt(invalidIds));
    const sink = createSink(fetch);
    await sink.restore();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await sink.close(0);
    expect((await outbox.list(conversationId)).map(entry => entry.deliveryId)).toEqual(ids);
  });

  it("restores all unacknowledged entries after the worker restarts", async () => {
    const { entries, outbox, createSink } = await fixture([delta("a"), delta("b")]);
    const offline = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(null, { status: 503 }));
    const first = createSink(offline);
    await first.restore();
    await vi.waitFor(() => expect(offline).toHaveBeenCalled());
    await first.close(0);
    expect((await outbox.list(conversationId)).map(entry => entry.deliveryId)).toEqual(entries.map(entry => entry.deliveryId));
    await createSink(async (_url, init) => receipt(request(init).events.map(entry => entry.deliveryId))).restore();
    await vi.waitFor(async () => expect(await outbox.list(conversationId)).toEqual([]));
  });

  it("bounds reads by count and bytes while allowing one oversized existing event", async () => {
    const { outbox, entries } = await fixture([delta("a".repeat(1000)), delta("b"), delta("c")]);
    expect(await outbox.peekBatch(conversationId, 2, 10_000)).toEqual(entries.slice(0, 2));
    expect(await outbox.peekBatch(conversationId, 32, 100)).toEqual(entries.slice(0, 1));
    await outbox.removeBatch(entries.slice(0, 2));
    expect(await outbox.list(conversationId)).toEqual(entries.slice(2));
  });

  it("delivers valid earlier records before reporting a corrupt later record", async () => {
    const { outbox, entries } = await fixture([delta("a"), delta("b")]);
    await writeFile(entries[1]!.path, "invalid-json");
    expect(await outbox.peekBatch(conversationId, 32, 10_000)).toEqual(entries.slice(0, 1));
    await outbox.removeBatch(entries.slice(0, 1));
    await expect(outbox.peekBatch(conversationId, 32, 10_000)).rejects.toThrow();
  });
});
