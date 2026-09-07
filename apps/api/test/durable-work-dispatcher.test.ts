import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DurableWorkDispatcher } from "../src/lib/durable-work-dispatcher.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DurableWorkDispatcher", () => {
  it("starts newly available work while an earlier job is still running", async () => {
    const slowJob = deferred<void>();
    const listPending = vi
      .fn()
      .mockResolvedValueOnce(["slow"])
      .mockResolvedValueOnce(["next"]);
    const process = vi.fn(async (id: string) => {
      if (id === "slow") await slowJob.promise;
    });
    const dispatcher = createDispatcher(listPending, process, 2);
    try {
      dispatcher.start();
      dispatcher.wake();
      await flush();
      dispatcher.wake();
      await flush();

      expect(process.mock.calls).toEqual([["slow"], ["next"]]);
      expect(listPending.mock.calls).toEqual([[2], [1]]);
    } finally {
      slowJob.resolve();
      await dispatcher.close();
    }
  });

  it("bounds admitted jobs and retains notifications until a slot is free", async () => {
    const firstJob = deferred<void>();
    const secondJob = deferred<void>();
    const listPending = vi
      .fn()
      .mockResolvedValueOnce(["first", "second"])
      .mockResolvedValueOnce(["third"]);
    const process = vi.fn(async (id: string) => {
      if (id === "first") await firstJob.promise;
      if (id === "second") await secondJob.promise;
    });
    const dispatcher = createDispatcher(listPending, process, 2);
    try {
      dispatcher.start();
      dispatcher.wake();
      await flush();
      dispatcher.wake();
      dispatcher.wake();
      await flush();
      expect(listPending).toHaveBeenCalledOnce();
      expect(process).toHaveBeenCalledTimes(2);

      firstJob.resolve();
      await flush();
      expect(process.mock.calls).toEqual([["first"], ["second"], ["third"]]);
      expect(listPending.mock.calls).toEqual([[2], [1]]);
    } finally {
      firstJob.resolve();
      secondJob.resolve();
      await dispatcher.close();
    }
  });

  it("coalesces notifications during a query without losing their follow-up scan", async () => {
    const scan = deferred<string[]>();
    const listPending = vi
      .fn()
      .mockImplementationOnce(() => scan.promise)
      .mockResolvedValueOnce(["new"]);
    const process = vi.fn(async () => undefined);
    const dispatcher = createDispatcher(listPending, process);
    try {
      dispatcher.start();
      dispatcher.wake();
      dispatcher.wake();
      dispatcher.wake();
      expect(listPending).toHaveBeenCalledOnce();
      scan.resolve([]);
      await flush();
      expect(process).toHaveBeenCalledExactlyOnceWith("new");
      expect(listPending).toHaveBeenCalledTimes(2);
    } finally {
      scan.resolve([]);
      await dispatcher.close();
    }
  });

  it("does not dispatch the same durable row twice while its job is running", async () => {
    const job = deferred<void>();
    const listPending = vi.fn(async () => ["same", "same"]);
    const process = vi.fn(async () => job.promise);
    const dispatcher = createDispatcher(listPending, process);
    try {
      dispatcher.start();
      dispatcher.wake();
      await flush();
      dispatcher.wake();
      await flush();
      expect(process).toHaveBeenCalledExactlyOnceWith("same");
    } finally {
      job.resolve();
      await dispatcher.close();
    }
  });

  it("retries failed scans only on another notification", async () => {
    const listPending = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(["retry"]);
    const process = vi.fn(async () => undefined);
    const dispatcher = createDispatcher(listPending, process);
    try {
      dispatcher.start();
      dispatcher.wake();
      await flush();
      expect(listPending).toHaveBeenCalledOnce();
      expect(process).not.toHaveBeenCalled();

      dispatcher.wake();
      await flush();
      expect(process).toHaveBeenCalledExactlyOnceWith("retry");
    } finally {
      await dispatcher.close();
    }
  });

  it("leaves failed jobs to durable retry eligibility without a hot loop", async () => {
    const listPending = vi.fn(async () => ["retry"]);
    const process = vi.fn(async () => {
      throw new Error("lease lost");
    });
    const dispatcher = createDispatcher(listPending, process);
    try {
      dispatcher.start();
      dispatcher.wake();
      await flush();
      expect(process).toHaveBeenCalledOnce();
      dispatcher.wake();
      await flush();
      expect(process).toHaveBeenCalledTimes(2);
    } finally {
      await dispatcher.close();
    }
  });

  it("waits for an active scan at shutdown without starting the returned jobs", async () => {
    const scan = deferred<string[]>();
    const listPending = vi.fn(async () => scan.promise);
    const process = vi.fn(async () => undefined);
    const dispatcher = createDispatcher(listPending, process);
    dispatcher.start();
    dispatcher.wake();
    dispatcher.wake();
    const closed = vi.fn();
    const closing = dispatcher.close().then(closed);
    await flush();
    expect(closed).not.toHaveBeenCalled();
    scan.resolve(["late"]);
    await closing;
    dispatcher.wake();
    await flush();
    expect(process).not.toHaveBeenCalled();
    expect(listPending).toHaveBeenCalledOnce();
  });

  it("drains active jobs at shutdown and accepts work after being restarted", async () => {
    const job = deferred<void>();
    const listPending = vi
      .fn()
      .mockResolvedValueOnce(["active"])
      .mockResolvedValueOnce(["restarted"]);
    const process = vi.fn(async (id: string) => {
      if (id === "active") await job.promise;
    });
    const dispatcher = createDispatcher(listPending, process, 1);
    dispatcher.start();
    dispatcher.wake();
    await flush();
    dispatcher.wake();
    const closed = vi.fn();
    const closing = dispatcher.close().then(closed);
    await flush();
    expect(closed).not.toHaveBeenCalled();
    job.resolve();
    await closing;
    expect(listPending).toHaveBeenCalledOnce();

    try {
      dispatcher.start();
      dispatcher.wake();
      await flush();
      expect(process.mock.calls).toEqual([["active"], ["restarted"]]);
    } finally {
      await dispatcher.close();
    }
  });
});

function createDispatcher(
  listPending: (limit: number) => Promise<string[]>,
  process: (id: string) => Promise<void>,
  concurrency = 20,
): DurableWorkDispatcher<string> {
  return new DurableWorkDispatcher({
    concurrency,
    listPending,
    key: (id) => id,
    process,
  });
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: T) => resolvePromise?.(value) };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}
