import { afterEach, describe, expect, it, vi } from "vitest";
import { RunnerHeartbeatReporter } from "../src/heartbeat.js";

afterEach(() => vi.useRealTimers());

describe("worker heartbeat", () => {
  it("retries the same boot notification until it is acknowledged, independently of model output", async () => {
    const report = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const failed = vi.fn();
    const reporter = new RunnerHeartbeatReporter(
      () => ["owner"],
      report,
      failed,
    );
    await reporter.tick();
    await reporter.tick();
    await reporter.tick();
    expect(failed).toHaveBeenCalledWith("owner");
    expect(report.mock.calls.map((call) => call[1].startup)).toEqual([
      true,
      true,
      false,
    ]);
    expect(new Set(report.mock.calls.map((call) => call[1].bootId)).size).toBe(
      1,
    );
  });

  it("does not overlap heartbeat requests and waits for the last request during shutdown", async () => {
    let finish: (() => void) | undefined;
    const report = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const reporter = new RunnerHeartbeatReporter(
      () => ["owner"],
      report,
      vi.fn(),
    );
    const first = reporter.tick();
    expect(reporter.tick()).toBe(first);
    let closed = false;
    const closing = reporter.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish?.();
    await closing;
    expect(report).toHaveBeenCalledOnce();
  });

  it("starts immediately, reports once per interval, and stops on close", async () => {
    vi.useFakeTimers();
    const report = vi.fn(async () => undefined);
    const reporter = new RunnerHeartbeatReporter(
      () => ["owner"],
      report,
      vi.fn(),
    );
    reporter.start();
    reporter.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(report).toHaveBeenCalledTimes(3);
    await reporter.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(report).toHaveBeenCalledTimes(3);
  });
});
