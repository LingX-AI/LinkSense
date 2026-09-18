import { AsyncLocalStorage } from "node:async_hooks";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { hasActiveApplicationTasks } from "./publication-readiness.js";
import { AppError } from "../../lib/errors.js";
import { withUserRuntimeLease, assertUserRuntimeLeaseCurrent } from "../../lib/user-runtime-lease.js";

type Store = Pick<LinkSenseRedis, "acquireUserRuntimeLease" | "renewUserRuntimeLease" | "releaseUserRuntimeLease" |
  "acquireUserLifecycleLock" | "renewUserLifecycleLock" | "releaseUserLifecycleLock">;
const writes = new AsyncLocalStorage<{ key: string; assertCurrent: () => void }>();
export function assertApplicationChangeCurrent(): void { writes.getStore()?.assertCurrent(); }

/** Held during preparation/admission only. Running tasks may share the environment. */
export class ApplicationRuntimeGate {
  constructor(private readonly prisma: PrismaClient, private readonly store: Store,
    private readonly closeProcess: (ownerId: string, conversationId: string) => Promise<void>) {}

  async start<T>(ownerId: string, applicationId: string, action: () => Promise<T>, debug = false): Promise<T> {
    return withUserRuntimeLease(this.store, keyFor(ownerId, applicationId), action,
      { wait: false, unavailableCode: debug ? "APPLICATION_DEVELOPMENT_RUNTIME_UPDATING" : "APPLICATION_RUNTIME_UPDATING" });
  }

  async change<T>(ownerId: string, applicationId: string, action: (assertCurrent: () => void) => Promise<T>, debug = false,
    options: { waitForReaders?: boolean } = {}): Promise<T> {
    const key = keyFor(ownerId, applicationId);
    const existing = writes.getStore();
    if (existing?.key === key) { existing.assertCurrent(); return action(existing.assertCurrent); }
    return withUserRuntimeLease(this.store, ownerId, () => this.changeLocked(ownerId, applicationId, action, debug, options), { wait: false });
  }

  private async changeLocked<T>(ownerId: string, applicationId: string, action: (assertCurrent: () => void) => Promise<T>, debug: boolean,
    options: { waitForReaders?: boolean }): Promise<T> {
    const key = keyFor(ownerId, applicationId);
    const busy = debug ? "APPLICATION_DEVELOPMENT_TEST_BUSY" : "APPLICATION_RUNTIME_BUSY";
    const ttl = 120_000;
    const token = await this.store.acquireUserLifecycleLock(key, ttl, options);
    if (!token) throw new AppError(busy);
    let expires = performance.now() + ttl;
    let valid = true;
    let renewal: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (renewal) return;
      const deadline = performance.now() + ttl;
      renewal = this.store.renewUserLifecycleLock(key, token, ttl)
        .then(ok => { valid = ok; if (ok) expires = deadline; })
        .catch(() => { valid = false; })
        .finally(() => { renewal = undefined; });
    }, ttl / 3);
    timer.unref();
    const assertCurrent = () => { assertUserRuntimeLeaseCurrent(); if (!valid || performance.now() >= expires) throw new AppError("APPLICATION_RUNTIME_UPDATING"); };
    try {
      if (await hasActiveApplicationTasks(this.prisma, ownerId, applicationId)) throw new AppError(busy);
      const tasks = await this.prisma.conversation.findMany({ where: { ownerId, applicationId }, select: { id: true } });
      // The runner also checks native activity. A stop click without native
      // completion never authorizes replacing resources underneath that turn.
      for (const task of tasks) {
        assertCurrent();
        try { await this.closeProcess(ownerId, task.id); }
        catch (error) {
          if (error instanceof AppError && error.code === "APPLICATION_RUNTIME_BUSY") throw new AppError(busy);
          throw error;
        }
      }
      return await writes.run({ key, assertCurrent }, async () => {
        const result = await action(assertCurrent);
        assertCurrent();
        return result;
      });
    } finally {
      clearInterval(timer);
      await renewal;
      await this.store.releaseUserLifecycleLock(key, token);
    }
  }
}

function keyFor(ownerId: string, applicationId: string): string {
  // Private preview app IDs are stable and disjoint from their formal app IDs.
  return `application:${ownerId}:${applicationId}`;
}
