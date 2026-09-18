import { afterEach, describe, expect, it, vi } from "vitest";
import { withUserRuntimeLease } from "../src/lib/user-runtime-lease.js";

function store() {
  return {
    acquireUserRuntimeLease: vi.fn().mockResolvedValue("lease"),
    renewUserRuntimeLease: vi.fn().mockResolvedValue(true),
    releaseUserRuntimeLease: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("user runtime lease", () => {
  it("admits a foreground task while a prewarm reader is still running", async () => {
    const redis = store();
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    const prewarm = withUserRuntimeLease(redis, "user", () => wait);
    await expect(withUserRuntimeLease(redis, "user", async () => "accepted")).resolves.toBe("accepted");
    expect(redis.releaseUserRuntimeLease).toHaveBeenCalledTimes(1);
    release();
    await prewarm;
    expect(redis.releaseUserRuntimeLease).toHaveBeenCalledTimes(2);
  });

  it.each([false, "unavailable"])("fails closed when renewal returns %s and stops its timer", async result => {
    vi.useFakeTimers();
    const redis = store();
    if (result === false) redis.renewUserRuntimeLease.mockResolvedValue(false);
    else redis.renewUserRuntimeLease.mockRejectedValue(new Error("redis unavailable"));
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn();
    const work = withUserRuntimeLease(redis, "user", async assertCurrent => {
      await wait;
      assertCurrent();
      write();
    });
    const failure = expect(work).rejects.toMatchObject({ code: "CONFLICT" });
    await vi.advanceTimersByTimeAsync(40_000);
    release();
    await failure;
    expect(write).not.toHaveBeenCalled();
    expect(redis.releaseUserRuntimeLease).toHaveBeenCalledExactlyOnceWith("user", "lease");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the lease after action failure and renews long operations", async () => {
    vi.useFakeTimers();
    const redis = store();
    const failure = new Error("action failed");
    const work = withUserRuntimeLease(redis, "user", async () => {
      await new Promise(resolve => setTimeout(resolve, 90_000));
      throw failure;
    });
    const assertion = expect(work).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    expect(redis.renewUserRuntimeLease).toHaveBeenCalledTimes(2);
    expect(redis.releaseUserRuntimeLease).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
