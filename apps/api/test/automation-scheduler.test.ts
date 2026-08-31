import { describe, expect, it, vi } from "vitest";

import {
  AutomationScheduler,
  automationDispatchJobId,
  type AutomationQueueControl,
} from "../src/modules/automations/scheduler.js";
import { testConfig } from "./test-config.js";

const AUTOMATION_ID = "20000000-0000-4000-8000-000000000001";
const SCHEDULED_FOR = new Date("2026-07-30T01:00:00.000Z");

describe("AutomationScheduler", () => {
  it("registers one recurring due scan and one worker", async () => {
    const fixture = schedulerFixture();

    await fixture.scheduler.start();
    await fixture.scheduler.start();
    await fixture.scheduler.close();

    expect(fixture.queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(fixture.queue.upsertJobScheduler).toHaveBeenCalledWith(
      "scan",
      { every: 15_000 },
      { name: "scan", data: { type: "scan" } },
    );
    expect(fixture.workerFactory).toHaveBeenCalledOnce();
    expect(fixture.worker.close).toHaveBeenCalledOnce();
    expect(fixture.queue.close).toHaveBeenCalledOnce();
  });

  it("fans a scan out into deterministic occurrence jobs", async () => {
    const fixture = schedulerFixture();
    fixture.service.listDue.mockResolvedValueOnce([
      { id: AUTOMATION_ID, nextRunAt: SCHEDULED_FOR },
    ]);

    await fixture.scheduler.process({ data: { type: "scan" } } as never);

    expect(fixture.queue.add).toHaveBeenCalledWith(
      "dispatch",
      {
        type: "dispatch",
        automationId: AUTOMATION_ID,
        scheduledFor: SCHEDULED_FOR.toISOString(),
      },
      { jobId: automationDispatchJobId(AUTOMATION_ID, SCHEDULED_FOR) },
    );
  });

  it("dispatches a validated occurrence through the automation service", async () => {
    const fixture = schedulerFixture();

    await fixture.scheduler.process({
      data: {
        type: "dispatch",
        automationId: AUTOMATION_ID,
        scheduledFor: SCHEDULED_FOR.toISOString(),
      },
    } as never);

    expect(fixture.service.dispatchOccurrence).toHaveBeenCalledWith(
      AUTOMATION_ID,
      SCHEDULED_FOR,
    );
  });
});

function schedulerFixture() {
  const queue = {
    add: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    upsertJobScheduler: vi.fn(async () => undefined),
    waitUntilReady: vi.fn(async () => undefined),
  };
  const worker = { close: vi.fn(async () => undefined) };
  const workerFactory = vi.fn(() => worker);
  const service = {
    listDue: vi.fn(
      async (): Promise<Array<{ id: string; nextRunAt: Date }>> => [],
    ),
    dispatchOccurrence: vi.fn(async () => undefined),
  };
  const scheduler = new AutomationScheduler(
    testConfig(),
    service as never,
    queue as unknown as AutomationQueueControl,
    workerFactory,
  );
  return { scheduler, queue, worker, workerFactory, service };
}
