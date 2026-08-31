import { describe, expect, it, vi } from "vitest";

import { BillingStatementScheduler } from "../src/modules/usage/billing-scheduler.js";

describe("BillingStatementScheduler", () => {
  it("schedules a monthly job in the configured time zone and catches up on startup", async () => {
    const queue = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const worker = { close: vi.fn().mockResolvedValue(undefined) };
    const generateMissingStatements = vi.fn().mockResolvedValue(0);
    const scheduler = new BillingStatementScheduler(
      { redisUrl: "redis://unused" },
      { timeZone: "Asia/Shanghai", generateMissingStatements },
      queue,
      (processor) => {
        void processor({
          data: { type: "generate-missing-statements" },
        } as never);
        return worker;
      },
    );

    await scheduler.start();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "generate-missing-statements",
      { pattern: "5 0 1 * *", tz: "Asia/Shanghai" },
      expect.objectContaining({ name: "generate-missing-statements" }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      "generate-missing-statements",
      { type: "generate-missing-statements" },
      { removeOnComplete: true },
    );
    await vi.waitFor(() =>
      expect(generateMissingStatements).toHaveBeenCalled(),
    );

    await scheduler.close();
    expect(worker.close).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });
});
