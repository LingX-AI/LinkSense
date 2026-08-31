import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import {
  registrationSettings,
  SystemService,
} from "../src/modules/system/service.js"

describe("system open registration settings", () => {
  it("defaults to closed for existing installations without the setting", () => {
    expect(registrationSettings({})).toEqual({
      enabled: false,
      total_token_limit: null,
    })
    expect(registrationSettings({ self_registration: null })).toEqual({
      enabled: false,
      total_token_limit: null,
    })
  })

  it("opens registration only with an explicit positive total quota", () => {
    expect(
      registrationSettings({
        self_registration: {
          enabled: true,
          total_token_limit: "12500000",
        },
      }),
    ).toEqual({ enabled: true, total_token_limit: "12500000" })
    expect(
      registrationSettings({ self_registration: { enabled: "true" } }),
    ).toEqual({ enabled: false, total_token_limit: null })
    expect(
      registrationSettings({ self_registration: { enabled: true } }),
    ).toEqual({ enabled: false, total_token_limit: null })
  })

  it("synchronizes a positive quota to every historical self-registered user", async () => {
    const transaction = registrationSettingsTransaction({ updatedUserCount: 3 })
    const service = registrationSettingsService(transaction)

    await expect(
      service.updateRegistrationSettings(
        "01900000-0000-7000-8000-000000000099",
        { enabled: true, total_token_limit: "12500000" },
        { ipAddress: "192.0.2.1", userAgent: "Browser" },
      ),
    ).resolves.toEqual({ enabled: true, total_token_limit: "12500000" })

    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        accountType: "member",
        selfRegisteredAt: { not: null },
      },
      data: { totalTokenLimit: 12_500_000n },
    })
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "self_registration_settings_updated",
        metadataJson: expect.objectContaining({ updated_user_count: 3 }),
      }),
    })
  })

  it("keeps existing user quotas when registration is closed without a quota", async () => {
    const transaction = registrationSettingsTransaction({ updatedUserCount: 3 })
    const service = registrationSettingsService(transaction)

    await expect(
      service.updateRegistrationSettings(
        "01900000-0000-7000-8000-000000000099",
        { enabled: false, total_token_limit: null },
        {},
      ),
    ).resolves.toEqual({ enabled: false, total_token_limit: null })

    expect(transaction.user.updateMany).not.toHaveBeenCalled()
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadataJson: expect.objectContaining({ updated_user_count: 0 }),
      }),
    })
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
