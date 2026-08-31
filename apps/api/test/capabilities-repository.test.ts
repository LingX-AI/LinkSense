import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { PrismaCapabilityStore } from "../src/modules/capabilities/repository.js"

describe("PrismaCapabilityStore Skill registry lock", () => {
  it("executes the advisory lock without attempting to deserialize its void result", async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1)
    const queryRawUnsafe = vi.fn()
    const store = new PrismaCapabilityStore({
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient)

    await store.lockSkillNameRegistry()

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(1280527699)",
    )
    expect(queryRawUnsafe).not.toHaveBeenCalled()
  })
})

describe("PrismaCapabilityStore marketplace installs", () => {
  it("increments the persisted cumulative count inside the active store", async () => {
    const update = vi.fn().mockResolvedValue({})
    const store = new PrismaCapabilityStore({
      marketplaceListing: { update },
    } as unknown as PrismaClient)

    await store.recordMarketplaceInstall(
      "30000000-0000-4000-8000-000000000001",
    )

    expect(update).toHaveBeenCalledWith({
      where: { id: "30000000-0000-4000-8000-000000000001" },
      data: { installCount: { increment: 1 } },
    })
  })
})
