import type { LinkSenseRedis } from "../adapters/redis.js";
import { AppError } from "./errors.js";
import { startTaskStage } from "./task-latency.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ErrorCode } from "@linksense/shared";

const leaseChecks = new AsyncLocalStorage<() => void>();
export function assertUserRuntimeLeaseCurrent(): void { leaseChecks.getStore()?.(); }

type RuntimeLeaseStore = Pick<LinkSenseRedis,
  "acquireUserRuntimeLease" | "renewUserRuntimeLease" | "releaseUserRuntimeLease">;

/** Readers may prepare independent tasks together; lifecycle writers drain them. */
export async function withUserRuntimeLease<T>(
  store: RuntimeLeaseStore,
  ownerId: string,
  action: (assertCurrent: () => void) => Promise<T>,
  options: { wait?: boolean; unavailableCode?: ErrorCode } = {},
): Promise<T> {
  const parentCheck = leaseChecks.getStore();
  const ttlMs = 120_000;
  let token: string | null = null;
  let expiresAt = 0;
  const finishWait = startTaskStage("user_lease_wait");
  for (let attempt = 0; attempt < (options.wait === false ? 1 : 400); attempt += 1) {
    expiresAt = performance.now() + ttlMs;
    token = await store.acquireUserRuntimeLease(ownerId, ttlMs);
    if (token) break;
    if (options.wait !== false) await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  finishWait(token ? "ok" : "error");
  if (!token) throw new AppError(options.unavailableCode ?? "CONFLICT");
  const leaseToken = token;
  let valid = true;
  let stopped = false;
  let renewal: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assertCurrent = () => {
    parentCheck?.();
    if (!valid || performance.now() >= expiresAt) throw new AppError("CONFLICT");
  };
  const scheduleRenewal = () => {
    timer = setTimeout(() => {
      const renewedExpiresAt = performance.now() + ttlMs;
      renewal = store.renewUserRuntimeLease(ownerId, leaseToken, ttlMs)
        .then((renewed) => { valid = renewed; if (renewed) expiresAt = renewedExpiresAt; })
        .catch(() => { valid = false; })
        .finally(() => { if (!stopped && valid) scheduleRenewal(); });
    }, ttlMs / 3);
    timer.unref();
  };
  scheduleRenewal();
  try {
    const result = await leaseChecks.run(assertCurrent, () => action(assertCurrent));
    await renewal;
    assertCurrent();
    return result;
  } finally {
    stopped = true;
    clearTimeout(timer);
    await renewal;
    await store.releaseUserRuntimeLease(ownerId, leaseToken);
  }
}
