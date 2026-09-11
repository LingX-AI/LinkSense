import { describe, expect, it, vi } from "vitest";

import { OrderedBatchQueue } from "../src/ordered-batch-queue.js";
import { deferred } from "./deferred.js";

describe("OrderedBatchQueue", () => {
  it("groups only adjacent pending values and never lets a boundary overtake durable completion", async () => {
    const durable = deferred<void>();
    const started = deferred<void>();
    const calls: string[][] = [];
    const queue = new OrderedBatchQueue<string>(async values => {
      calls.push([...values]);
      if (values[0] === "first") { started.resolve(); await durable.promise; }
    }, { maxCount: 32, maxBytes: 1024 });
    const first = queue.enqueue("first", "text", 1);
    await started.promise;
    const pending = [queue.enqueue("a", "text", 1), queue.enqueue("b", "text", 1)];
    const boundary = queue.enqueue("unknown-future-event", null, 1);
    const tail = queue.enqueue("c", "text", 1);
    expect(calls).toEqual([["first"]]);
    durable.resolve();
    await Promise.all([first, ...pending, boundary, tail]);
    expect(calls).toEqual([["first"], ["a", "b"], ["unknown-future-event"], ["c"]]);
  });

  it("uses a captured queue position for server requests without waiting for the user's eventual answer", async () => {
    const answer = deferred<string>();
    const calls: string[] = [];
    const queue = new OrderedBatchQueue<string>(async values => { calls.push(...values); }, { maxCount: 32, maxBytes: 1024 });
    const before = queue.enqueue("before", "text", 1);
    const request = queue.enqueueOperation(async () => { calls.push("request-persisted"); return { response: answer.promise }; });
    const resolved = queue.enqueue("request-resolved", null, 1);
    const after = queue.enqueue("after", "text", 1);
    await Promise.all([before, resolved, after]);
    expect(calls).toEqual(["before", "request-persisted", "request-resolved", "after"]);
    answer.resolve("approved");
    await expect((await request).response).resolves.toBe("approved");
  });

  it("bounds groups by count and bytes and does not join different stream identities", async () => {
    const process = vi.fn<(values: readonly string[]) => Promise<void>>(async () => undefined);
    const queue = new OrderedBatchQueue(process, { maxCount: 2, maxBytes: 5 });
    await Promise.all([
      queue.enqueue("a", "one", 2), queue.enqueue("b", "one", 2),
      queue.enqueue("c", "one", 2), queue.enqueue("large", "one", 6),
      queue.enqueue("d", "one", 3), queue.enqueue("e", "one", 3),
      queue.enqueue("f", "two", 1),
    ]);
    expect(process.mock.calls.map(([values]) => values)).toEqual([["a", "b"], ["c"], ["large"], ["d"], ["e"], ["f"]]);
  });

  it("propagates a group failure to every member without automatically replaying it", async () => {
    const process = vi.fn<(values: readonly string[]) => Promise<void>>(async () => undefined).mockRejectedValueOnce(new Error("disk unavailable"));
    const queue = new OrderedBatchQueue(process, { maxCount: 32, maxBytes: 1024 });
    const result = await Promise.allSettled([queue.enqueue("a", "text", 1), queue.enqueue("b", "text", 1)]);
    expect(result.every(item => item.status === "rejected")).toBe(true);
    expect(process).toHaveBeenCalledTimes(1);
    await expect(queue.enqueueOperation(async () => "recovery inspection")).resolves.toBe("recovery inspection");
    expect(process).toHaveBeenCalledTimes(1);
  });
});
