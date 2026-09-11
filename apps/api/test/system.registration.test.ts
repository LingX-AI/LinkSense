import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import {
  registrationSettings,
  SystemService,
} from "../src/modules/system/service.js"

describe("system registration settings", () => {
  it("defaults registration to closed and allows opening it independently of quotas", () => {
    expect(registrationSettings({})).toEqual({ enabled: false })
    expect(registrationSettings({ self_registration: { enabled: true } })).toEqual({ enabled: true })
    expect(registrationSettings({ self_registration: { enabled: "true" } })).toEqual({ enabled: false })
  })
  it.each([true, false])("sets registration enabled=%s without altering any user quota", async (enabled) => {
    const tx = registrationSettingsTransaction({ updatedUserCount: 3 })
    const service = registrationSettingsService(tx)
    await expect(service.updateRegistrationSettings("admin", { enabled }, {})).resolves.toEqual({ enabled })
    expect(tx.user.updateMany).not.toHaveBeenCalled()
    expect(tx.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ settingsJson: { system_initialized: true, self_registration: { enabled } } }) }))
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "self_registration_settings_updated", metadataJson: { enabled } }) }))
  })
})

function registrationSettingsTransaction({
  updatedUserCount,
}: {
  updatedUserCount: number
}) {
  return {
    $executeRaw: vi.fn(async () => 1),
    systemSetting: {
      findUnique: vi.fn(async () => ({
        settingsJson: { system_initialized: true },
      })),
      upsert: vi.fn(async () => ({ id: "system-settings" })),
    },
    user: {
      updateMany: vi.fn(async () => ({ count: updatedUserCount })),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "audit" })),
    },
  }
}

function registrationSettingsService(
  transaction: ReturnType<typeof registrationSettingsTransaction>,
) {
  const prisma = {
    $transaction: vi.fn(
      async (
        callback: (
          tx: ReturnType<typeof registrationSettingsTransaction>,
        ) => Promise<unknown>,
      ) => callback(transaction),
    ),
  } as unknown as PrismaClient
  return new SystemService(
    prisma,
    {} as ConstructorParameters<typeof SystemService>[1],
    {} as ConstructorParameters<typeof SystemService>[2],
    {} as ConstructorParameters<typeof SystemService>[3],
    {} as ConstructorParameters<typeof SystemService>[4],
    {} as ConstructorParameters<typeof SystemService>[5],
    {} as ConstructorParameters<typeof SystemService>[6],
    {} as ConstructorParameters<typeof SystemService>[7],
  )
}
