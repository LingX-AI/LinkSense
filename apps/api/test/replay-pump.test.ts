import { describe, expect, it, vi } from "vitest";

import {
  createReplayPump,
  type ReplayPumpOptions,
} from "../src/modules/events/replay-pump.js";

const CONVERSATION_ID = "40000000-0000-4000-8000-000000000001";

type TestEvent = { sequence_no: number };

function pumpOptions(
  overrides: Partial<ReplayPumpOptions<TestEvent>> = {},
): ReplayPumpOptions<TestEvent> {
  return {
    conversationId: CONVERSATION_ID,
    initialSequence: 0n,
    pageSize: 250,
    gapRetryDelaysMs: [25, 50, 100, 200, 400],
    loadPage: vi.fn(async () => ({
      items: [],
      next_cursor: null,
      confirmed_sequence: 0n,
    })),
    writeEvent: vi.fn(async () => true),
    isDestroyed: () => false,
    closeStream: vi.fn(),
    logWarn: vi.fn(),
    logMessages: {
      replayFailed: "replay failed",
      projectionBehind: "projection behind",
    },
    ...overrides,
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("conversation event replay pump", () => {
  // Regression: a response can be `destroyed` without ever emitting `close`, so the
  // pump's own cleanup never ran. A failed write only ended that pass, and the
  // re-arm in the finally block then re-read the same history page with no delay,
  // burning a core and hammering conversation_events for hours.
  it("closes the stream and stops reading when a write fails", async () => {
    const loadPage = vi.fn(async () => ({
      items: [{ sequence_no: 1 }],
      next_cursor: null,
      confirmed_sequence: 250n,
    }));
    const writeEvent = vi.fn(async () => false);
    const closeStream = vi.fn();
    const pump = createReplayPump(
      pumpOptions({ loadPage, writeEvent, closeStream }),
    );

    pump.markReady();
    // Fan-out advertises a later event than the page confirms, which is the
    // condition that re-armed the loop.
    pump.observe(2_781n);
    await settle();
    await settle();

    expect(pump.isClosed()).toBe(true);
    expect(closeStream).toHaveBeenCalledTimes(1);
    expect(closeStream).toHaveBeenCalledWith(false);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("closes the stream when the response is destroyed even if the write succeeded", async () => {
    let destroyed = false;
    const loadPage = vi.fn(async () => {
      // The client goes away while the page is in flight; no `close` event fires.
      destroyed = true;
      return { items: [], next_cursor: null, confirmed_sequence: 0n };
    });
    const closeStream = vi.fn();
    const pump = createReplayPump(
      pumpOptions({ loadPage, closeStream, isDestroyed: () => destroyed }),
    );

    pump.markReady();
    pump.wake();
    await settle();

    expect(pump.isClosed()).toBe(true);
    expect(closeStream).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("writes each unseen event once and stops when caught up", async () => {
    const writeEvent = vi.fn<(event: TestEvent) => Promise<boolean>>(
      async () => true,
    );
    const loadPage = vi.fn(async () => ({
      items: [{ sequence_no: 1 }, { sequence_no: 2 }],
      next_cursor: null,
      confirmed_sequence: 2n,
    }));
    const pump = createReplayPump(pumpOptions({ loadPage, writeEvent }));

    pump.markReady();
    pump.observe(2n);
    await settle();
    await settle();

    expect(writeEvent.mock.calls.map(([event]) => event.sequence_no)).toEqual([
      1, 2,
    ]);
    expect(pump.isClosed()).toBe(false);
  });

  it("skips events at or below the cursor so a replay never duplicates them", async () => {
    const writeEvent = vi.fn<(event: TestEvent) => Promise<boolean>>(
      async () => true,
    );
    const loadPage = vi.fn(async () => ({
      items: [{ sequence_no: 5 }, { sequence_no: 7 }],
      next_cursor: null,
      confirmed_sequence: 7n,
    }));
    const pump = createReplayPump(
      pumpOptions({ loadPage, writeEvent, initialSequence: 5n }),
    );

    pump.markReady();
    pump.observe(7n);
    await settle();
    await settle();

    expect(writeEvent.mock.calls.map(([event]) => event.sequence_no)).toEqual([
      7,
    ]);
  });

  it("keeps paging while next_cursor is set", async () => {
    const pages = [
      { items: [{ sequence_no: 1 }], next_cursor: "cursor-1", confirmed_sequence: 2n },
      { items: [{ sequence_no: 2 }], next_cursor: null, confirmed_sequence: 2n },
    ];
    const loadPage = vi.fn(async () => pages.shift()!);
    const writeEvent = vi.fn<(event: TestEvent) => Promise<boolean>>(
      async () => true,
    );
    const pump = createReplayPump(pumpOptions({ loadPage, writeEvent }));

    pump.markReady();
    pump.observe(2n);
    await settle();
    await settle();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(writeEvent).toHaveBeenCalledTimes(2);
    expect(pump.isClosed()).toBe(false);
  });

  it("does not replay before the stream is ready", async () => {
    const loadPage = vi.fn(async () => ({
      items: [],
      next_cursor: null,
      confirmed_sequence: 0n,
    }));
    const pump = createReplayPump(pumpOptions({ loadPage }));

    pump.observe(5n);
    await settle();

    expect(loadPage).not.toHaveBeenCalled();

    pump.markReady();
    pump.wake();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("forces a reconnect when a replay gap never fills", async () => {
    vi.useFakeTimers();
    try {
      const loadPage = vi.fn(async () => ({
        items: [],
        next_cursor: null,
        confirmed_sequence: 100n,
      }));
      const closeStream = vi.fn();
      const logWarn = vi.fn();
      const pump = createReplayPump(
        pumpOptions({
          loadPage,
          closeStream,
          logWarn,
          gapRetryDelaysMs: [1],
        }),
      );

      pump.markReady();
      pump.observe(200n);
      await vi.runAllTimersAsync();

      expect(closeStream).toHaveBeenCalledTimes(1);
      expect(closeStream).toHaveBeenCalledWith(true);
      expect(logWarn).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: CONVERSATION_ID }),
        "projection behind",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the stream resources exactly once", () => {
    const closeStream = vi.fn();
    const pump = createReplayPump(pumpOptions({ closeStream }));

    pump.close();
    pump.close(true);
    pump.close();

    expect(closeStream).toHaveBeenCalledTimes(1);
    expect(closeStream).toHaveBeenCalledWith(false);
  });
});
