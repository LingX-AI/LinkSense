import { afterEach, expect, it, vi } from "vitest";
import { interruptNativeExecutionForShutdown } from "../src/codex/native-shutdown.js";

afterEach(() => vi.useRealTimers());

it("pauses active native goals before interrupting turns, without submitting work", async () => {
  const request = vi.fn(async () => ({}));
  await interruptNativeExecutionForShutdown([
    {
      codexThreadId: "thread",
      activeTurnId: "turn",
      activeGoal: { status: "active" },
      client: { request },
    },
  ]);
  expect(request.mock.calls).toEqual([
    ["thread/goal/set", { threadId: "thread", status: "paused" }],
    ["turn/interrupt", { threadId: "thread", turnId: "turn" }],
  ]);
});

it("bounds all processes by one deadline even if native requests never answer", async () => {
  vi.useFakeTimers();
  const request = vi.fn(() => new Promise(() => {}));
  const done = vi.fn();
  const closing = interruptNativeExecutionForShutdown(
    Array.from({ length: 5 }, () => ({
      codexThreadId: "thread",
      activeTurnId: "turn",
      activeGoal: null,
      client: { request },
    })),
  ).then(done);
  expect(request).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(1_000);
  await closing;
  expect(done).toHaveBeenCalledOnce();
});

it("does not interrupt idle threads and still interrupts after a goal-pause error", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue({});
  await interruptNativeExecutionForShutdown([
    {
      codexThreadId: null,
      activeTurnId: null,
      activeGoal: null,
      client: { request },
    },
    {
      codexThreadId: "thread",
      activeTurnId: "turn",
      activeGoal: { status: "active" },
      client: { request },
    },
  ]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith("turn/interrupt", {
    threadId: "thread",
    turnId: "turn",
  });
});
