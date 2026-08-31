import { describe, expect, it, vi } from "vitest";

import {
  ClawHubSyncScheduler,
  type ClawHubSyncQueueControl,
} from "../src/modules/clawhub/scheduler.js";

describe("ClawHubSyncScheduler", () => {
  it("registers one midnight job, enforces global concurrency, and catches up on startup", async () => {
    const fixture = schedulerFixture();

    await fixture.scheduler.start();
    await fixture.scheduler.start();

    expect(fixture.queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(fixture.queue.setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(fixture.queue.upsertJobScheduler).toHaveBeenCalledWith(
      "sync-all-skills",
      { pattern: "0 0 * * *", tz: "Asia/Shanghai" },
      {
        name: "sync-all-skills",
        data: { type: "sync-all-skills", trigger: "scheduled" },
      },
    );
    expect(fixture.queue.add).toHaveBeenCalledWith(
      "sync-all-skills",
      { type: "sync-all-skills", trigger: "startup" },
      {
        jobId: "clawhub-startup-catchup-2026-08-07",
        removeOnComplete: 32,
        removeOnFail: true,
      },
    );
    expect(fixture.workerFactory).toHaveBeenCalledOnce();
  });

  it("uses a new catch-up identity on the next day", async () => {
    const first = schedulerFixture(new Date("2026-08-07T15:59:59.000Z"));
    const next = schedulerFixture(new Date("2026-08-07T16:00:00.000Z"));

    await first.scheduler.start();
    await next.scheduler.start();

    expect(first.queue.add.mock.calls[0]?.[2]).toMatchObject({
      jobId: "clawhub-startup-catchup-2026-08-07",
    });
    expect(next.queue.add.mock.calls[0]?.[2]).toMatchObject({
      jobId: "clawhub-startup-catchup-2026-08-08",
    });
  });

  it("dispatches only validated jobs to the sync service", async () => {
    const fixture = schedulerFixture();

    await fixture.scheduler.process({
      data: { type: "sync-all-skills", trigger: "scheduled" },
    } as never);

    expect(fixture.service.syncAll).toHaveBeenCalledWith("scheduled");
    await expect(
      fixture.scheduler.process({
        data: { type: "sync-all-skills", trigger: "manual" },
      } as never),
    ).rejects.toThrow();
  });

  it("closes the worker before the queue", async () => {
    const fixture = schedulerFixture();

    await fixture.scheduler.start();
    await fixture.scheduler.close();

    expect(fixture.worker.close).toHaveBeenCalledOnce();
    expect(fixture.queue.close).toHaveBeenCalledOnce();
    expect(
      fixture.worker.close.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.queue.close.mock.invocationCallOrder[0] ?? 0);
  });
});

function schedulerFixture(now = new Date("2026-08-07T00:00:00.000Z")) {
  const queue = {
    add: vi.fn<ClawHubSyncQueueControl["add"]>(
      async () => undefined as never,
    ),
    close: vi.fn(async () => undefined),
    setGlobalConcurrency: vi.fn(async () => undefined),
    upsertJobScheduler: vi.fn(async () => undefined),
    waitUntilReady: vi.fn(async () => undefined),
  };
  const worker = { close: vi.fn(async () => undefined) };
  const workerFactory = vi.fn(() => worker);
  const service = { syncAll: vi.fn(async () => undefined) };
  const scheduler = new ClawHubSyncScheduler(
    {
      redisUrl: "redis://unused",
      timeZone: "Asia/Shanghai",
      now: () => now,
    },
    service,
    queue as unknown as ClawHubSyncQueueControl,
    workerFactory,
  );
  return { scheduler, queue, worker, workerFactory, service };
}
