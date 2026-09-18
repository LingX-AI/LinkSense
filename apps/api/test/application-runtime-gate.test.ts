import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntimeGate } from "../src/modules/applications/runtime-gate.js";
import { AppError } from "../src/lib/errors.js";
import { hasActiveApplicationTasks } from "../src/modules/applications/publication-readiness.js";

function latch() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const readers = new Map<string, Set<string>>();
  const writers = new Map<string, string>();
  let sequence = 0;
  const store = {
    acquireUserRuntimeLease: vi.fn(async (key: string) => {
      if (writers.has(key)) return null;
      const token = String(++sequence);
      const tokens = readers.get(key) ?? new Set<string>(); tokens.add(token); readers.set(key, tokens);
      return token;
    }),
    renewUserRuntimeLease: vi.fn(async () => true),
    releaseUserRuntimeLease: vi.fn(async (key: string, token: string) => { readers.get(key)?.delete(token); }),
    acquireUserLifecycleLock: vi.fn(async (key: string) => {
      if (writers.has(key) || readers.get(key)?.size) return null;
      const token = String(++sequence); writers.set(key, token); return token;
    }),
    renewUserLifecycleLock: vi.fn(async () => true),
    releaseUserLifecycleLock: vi.fn(async (key: string, token: string) => { if (writers.get(key) === token) writers.delete(key); }),
  };
  const prisma = { $queryRaw: vi.fn(async () => [] as Array<{ id: string }>),
    conversation: { findMany: vi.fn(async () => [{ id: "idle-task" }]) } };
  const close = vi.fn(async () => {});
  return { store, prisma, close, gate: new ApplicationRuntimeGate(prisma as never, store, close) };
}

describe("application runtime installation gate", () => {
  it("still rejects publication when a task starts after the dialog's readiness check", async () => {
    const f = fixture();
    await expect(hasActiveApplicationTasks(f.prisma as never, "user", "app")).resolves.toBe(false);
    f.prisma.$queryRaw.mockResolvedValue([{ id: "new-task" }]);
    const publish = vi.fn(async () => {});
    await expect(f.gate.change("user", "app", publish)).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    expect(publish).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
  });
  it("allows parallel tasks in the same environment but rejects installation until admission finishes", async () => {
    const f = fixture(); const entered = latch(); const release = latch(); const starts: number[] = [];
    const first = f.gate.start("user", "app", async () => { starts.push(1); entered.resolve(); await release.promise; });
    await entered.promise;
    await f.gate.start("user", "app", async () => { starts.push(2); });
    expect(starts).toEqual([1, 2]);
    await expect(f.gate.change("user", "app", async () => {})).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    release.resolve(); await first;
    await f.gate.change("user", "app", async () => {});
    expect(f.close).toHaveBeenCalledWith("user", "idle-task");
  });

  it("blocks new starts and competing installs only in the updating environment", async () => {
    const f = fixture(); const entered = latch(); const release = latch();
    const install = f.gate.change("user", "app", async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    await expect(f.gate.start("user", "app", async () => {})).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_UPDATING" });
    await expect(f.gate.change("user", "app", async () => {})).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    await expect(f.gate.start("user", "app", async () => {}, true)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_RUNTIME_UPDATING" });
    await f.gate.start("other-user", "app", async () => {});
    await f.gate.start("user", "private-preview-app", async () => {});
    release.resolve(); await install;
    await f.gate.start("user", "app", async () => {});
  });

  it("rejects even one unfinished task or start intent without closing processes or modifying resources", async () => {
    const f = fixture(); f.prisma.$queryRaw.mockResolvedValue([{ id: "running-task" }]); const change = vi.fn();
    await expect(f.gate.change("user", "app", change)).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    await expect(f.gate.change("user", "preview", change, true)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_BUSY" });
    expect(change).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
    expect(f.store.releaseUserLifecycleLock).toHaveBeenCalledTimes(2);
  });

  it("keeps installation unchanged when a native process cannot close and releases failed installs", async () => {
    const f = fixture(); f.close.mockRejectedValueOnce(new Error("native turn still active")); const change = vi.fn();
    await expect(f.gate.change("user", "app", change)).rejects.toThrow("native turn still active");
    expect(change).not.toHaveBeenCalled();
    await expect(f.gate.change("user", "app", async () => { throw new Error("invalid resources"); })).rejects.toThrow("invalid resources");
    await f.gate.start("user", "app", async () => {});
  });

  it("uses the test-specific busy message when a native debug task has not finished stopping", async () => {
    const f = fixture(); f.close.mockRejectedValueOnce(new AppError("APPLICATION_RUNTIME_BUSY")); const change = vi.fn();
    await expect(f.gate.change("user", "preview", change, true)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_BUSY" });
    expect(change).not.toHaveBeenCalled();
    await f.gate.start("user", "preview", async () => {});
  });
});
