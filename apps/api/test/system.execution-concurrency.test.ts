import { describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/config.js"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import {
  executionConcurrencySettings,
  SystemService,
} from "../src/modules/system/service.js"

const environmentDefaults = {
  max_concurrent_conversations: 20,
  runner_app_server_process_limit: 16,
}

describe("system execution concurrency settings", () => {
  it("falls back to environment defaults when overrides are absent or invalid", () => {
    expect(executionConcurrencySettings({}, environmentDefaults)).toEqual({
      max_concurrent_conversations: null,
      runner_app_server_process_limit: null,
      environment_defaults: environmentDefaults,
      effective: environmentDefaults,
    })
    expect(
      executionConcurrencySettings(
        {
          execution_concurrency: {
            max_concurrent_conversations: 8,
            runner_app_server_process_limit: 0,
          },
        },
        environmentDefaults,
      ),
    ).toEqual({
      max_concurrent_conversations: 8,
      runner_app_server_process_limit: null,
      environment_defaults: environmentDefaults,
      effective: {
        max_concurrent_conversations: 8,
        runner_app_server_process_limit: 16,
      },
    })
  })

  it("persists nullable overrides without replacing unrelated system settings", async () => {
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      systemSetting: {
        findUnique: vi.fn(async () => ({
          settingsJson: { system_initialized: true },
        })),
        upsert: vi.fn(async () => ({ id: "system-settings" })),
      },
      auditLog: {
        create: vi.fn(async () => ({ id: "audit" })),
      },
    }
    const prisma = {
      $transaction: vi.fn(
        async (
          callback: (tx: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    } as unknown as PrismaClient
    const service = executionConcurrencyService(prisma)

    await expect(
      service.updateExecutionConcurrencySettings(
        "01900000-0000-7000-8000-000000000099",
        {
          max_concurrent_conversations: null,
          runner_app_server_process_limit: 12,
        },
        { ipAddress: "192.0.2.1", userAgent: "Browser" },
      ),
    ).resolves.toEqual({
      max_concurrent_conversations: null,
      runner_app_server_process_limit: 12,
      environment_defaults: environmentDefaults,
      effective: {
        max_concurrent_conversations: 20,
        runner_app_server_process_limit: 12,
      },
    })

    expect(transaction.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          settingsJson: {
            system_initialized: true,
            execution_concurrency: {
              max_concurrent_conversations: null,
              runner_app_server_process_limit: 12,
            },
          },
        }),
      }),
    )
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "execution_concurrency_settings_updated",
        metadataJson: {
          max_concurrent_conversations: null,
          runner_app_server_process_limit: 12,
        },
      }),
    })
  })

  it("resolves the latest persisted override for each task start", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        settingsJson: {
          execution_concurrency: {
            max_concurrent_conversations: 7,
            runner_app_server_process_limit: null,
          },
        },
      })
      .mockResolvedValueOnce({
        settingsJson: {
          execution_concurrency: {
            max_concurrent_conversations: 5,
            runner_app_server_process_limit: 9,
          },
        },
      })
    const service = executionConcurrencyService({
      systemSetting: { findUnique },
    } as unknown as PrismaClient)

    await expect(service.resolveExecutionConcurrencySettings()).resolves.toEqual({
      max_concurrent_conversations: 7,
      runner_app_server_process_limit: 16,
    })
    await expect(service.resolveExecutionConcurrencySettings()).resolves.toEqual({
      max_concurrent_conversations: 5,
      runner_app_server_process_limit: 9,
    })
  })
})

function executionConcurrencyService(prisma: PrismaClient): SystemService {
  const config = {
    maxConcurrentConversations:
      environmentDefaults.max_concurrent_conversations,
    runnerAppServerProcessLimit:
      environmentDefaults.runner_app_server_process_limit,
  } as AppConfig
  return new SystemService(
    prisma,
    {} as ConstructorParameters<typeof SystemService>[1],
    {} as ConstructorParameters<typeof SystemService>[2],
    {} as ConstructorParameters<typeof SystemService>[3],
    {} as ConstructorParameters<typeof SystemService>[4],
    {} as ConstructorParameters<typeof SystemService>[5],
    config,
    {} as ConstructorParameters<typeof SystemService>[7],
  )
}
