import { describe, expect, it, vi } from "vitest"

import { UserHomeCapabilityReconciler } from "../src/modules/capabilities/user-home-reconciler.js"

const USER_A = "10000000-0000-4000-8000-000000000001"
const USER_B = "10000000-0000-4000-8000-000000000002"
const CAPABILITY_ID = "30000000-0000-4000-8000-000000000001"

describe("UserHomeCapabilityReconciler", () => {
  it("expands capability owners and deduplicates explicit users", async () => {
    const loadCapabilityOwnerIds = vi.fn(async () => [USER_B, USER_B])
    const resolveActiveUserIds = vi.fn(async () => [USER_B, USER_A, USER_A])
    const reconcileUser = vi.fn(async (userId: string) => {
      void userId
    })
    const reconciler = new UserHomeCapabilityReconciler({
      loadCapabilityOwnerIds,
      resolveActiveUserIds,
      reconcileUser,
      concurrency: 1,
    })

    await reconciler.reconcile({
      userIds: [USER_A, USER_A],
      capabilityIds: [CAPABILITY_ID, CAPABILITY_ID],
    })

    expect(loadCapabilityOwnerIds).toHaveBeenCalledWith([
      CAPABILITY_ID,
    ])
    expect(resolveActiveUserIds).toHaveBeenCalledWith([USER_A, USER_B])
    expect(reconcileUser.mock.calls.map(([userId]) => userId)).toEqual([
      USER_A,
      USER_B,
    ])
  })

  it("retries each owner, continues other reconciliations, and reports a stable failure", async () => {
    const attempts = new Map<string, number>()
    const reconcileUser = vi.fn(async (userId: string) => {
      attempts.set(userId, (attempts.get(userId) ?? 0) + 1)
      if (userId === USER_A) throw new Error("disk unavailable")
    })
    const reconciler = new UserHomeCapabilityReconciler({
      loadCapabilityOwnerIds: vi.fn(async () => []),
      resolveActiveUserIds: vi.fn(async () => [USER_A, USER_B]),
      reconcileUser,
      attempts: 3,
      concurrency: 2,
    })

    await expect(
      reconciler.reconcile({ userIds: [USER_A, USER_B] }),
    ).rejects.toMatchObject({
      code: "CAPABILITY_HOME_SYNC_FAILED",
      params: { failed_user_count: 1 },
    })
    expect(attempts.get(USER_A)).toBe(3)
    expect(attempts.get(USER_B)).toBe(1)
  })
})
