import { describe, expect, it, vi } from "vitest"

import {
  mcpDefaultStartupTimeoutSeconds,
  mcpDefaultToolTimeoutSeconds,
} from "@linksense/shared"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { PrismaMcpServerRepository } from "../src/modules/mcp/repository.js"
import type { CreateMcpServerRecord } from "../src/modules/mcp/types.js"

const OWNER_ID = "10000000-0000-4000-8000-000000000001"
const SERVER_ID = "10000000-0000-4000-8000-000000000002"
const NOW = new Date("2026-07-29T08:00:00.000Z")

describe("PrismaMcpServerRepository", () => {
  it("serializes owner creation before counting and inserting", async () => {
    const executeRaw = vi.fn(async (...arguments_: unknown[]) => {
      void arguments_
      return 1
    })
    const count = vi.fn(async () => 29)
    const create = vi.fn(async () => storedRecord())
    const transactionClient = {
      $executeRaw: executeRaw,
      mcpServer: { count, create },
    }
    const transaction = vi.fn(
      async (work: (client: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient)
    )
    const repository = new PrismaMcpServerRepository({
      $transaction: transaction,
    } as unknown as PrismaClient)

    await expect(
      repository.createWithinOwnerLimit(createInput(), 30)
    ).resolves.toMatchObject({ id: SERVER_ID, ownerId: OWNER_ID })

    expect(executeRaw).toHaveBeenCalledOnce()
    const rawCall = executeRaw.mock.calls[0]
    expect(Array.isArray(rawCall?.[0]) ? rawCall[0].join(" ") : "").toContain(
      "pg_advisory_xact_lock"
    )
    expect(rawCall?.[1]).toBe(`linksense:mcp-owner:${OWNER_ID}`)
    expect(count).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID } })
    const { args, environmentKeys, ...record } = createInput()
    expect(create).toHaveBeenCalledWith({
      data: {
        ...record,
        argsJson: args,
        environmentKeysJson: environmentKeys,
      },
    })
  })

  it("returns null without inserting after the owner limit is reached", async () => {
    const create = vi.fn(async () => storedRecord())
    const transactionClient = {
      $executeRaw: vi.fn(async () => 1),
      mcpServer: {
        count: vi.fn(async () => 30),
        create,
      },
    }
    const repository = new PrismaMcpServerRepository({
      $transaction: vi.fn(
        async (work: (client: typeof transactionClient) => Promise<unknown>) =>
          work(transactionClient)
      ),
    } as unknown as PrismaClient)

    await expect(
      repository.createWithinOwnerLimit(createInput(), 30)
    ).resolves.toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it("creates a JSON import batch under one owner lock and one limit check", async () => {
    const secondId = "10000000-0000-4000-8000-000000000003"
    const first = createInput()
    const second: CreateMcpServerRecord = {
      ...createInput(),
      id: secondId,
      serverKey: "user_10000000000040008000000000000003",
      name: "Reader",
    }
    const create = vi
      .fn()
      .mockResolvedValueOnce(storedRecord(first))
      .mockResolvedValueOnce(storedRecord(second))
    const transactionClient = {
      $executeRaw: vi.fn(async () => 1),
      mcpServer: { count: vi.fn(async () => 28), create },
    }
    const transaction = vi.fn(
      async (work: (client: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient)
    )
    const repository = new PrismaMcpServerRepository({
      $transaction: transaction,
    } as unknown as PrismaClient)

    await expect(
      repository.createManyWithinOwnerLimit([first, second], 30)
    ).resolves.toMatchObject([{ id: SERVER_ID }, { id: secondId }])

    expect(transaction).toHaveBeenCalledOnce()
    expect(transactionClient.$executeRaw).toHaveBeenCalledOnce()
    expect(transactionClient.mcpServer.count).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("does not insert any JSON import row when the whole batch exceeds the owner limit", async () => {
    const create = vi.fn()
    const transactionClient = {
      $executeRaw: vi.fn(async () => 1),
      mcpServer: { count: vi.fn(async () => 29), create },
    }
    const repository = new PrismaMcpServerRepository({
      $transaction: vi.fn(
        async (work: (client: typeof transactionClient) => Promise<unknown>) =>
          work(transactionClient)
      ),
    } as unknown as PrismaClient)

    await expect(
      repository.createManyWithinOwnerLimit(
        [
          createInput(),
          {
            ...createInput(),
            id: "10000000-0000-4000-8000-000000000003",
          },
        ],
        30
      )
    ).resolves.toBeNull()
    expect(create).not.toHaveBeenCalled()
  })
})

function createInput(): CreateMcpServerRecord {
  return {
    id: SERVER_ID,
    ownerId: OWNER_ID,
    name: "Search",
    serverKey: "user_10000000000040008000000000000002",
    transport: "streamable_http",
    url: "https://mcp.example.test/mcp",
    command: null,
    args: [],
    encryptedEnvironment: null,
    environmentKeys: [],
    authType: "none",
    apiKeyHeader: null,
    encryptedCredential: null,
    encryptionKeyId: null,
    status: "active",
    required: false,
    startupTimeoutSeconds: mcpDefaultStartupTimeoutSeconds,
    toolTimeoutSeconds: mcpDefaultToolTimeoutSeconds,
    insecureHttpAcknowledged: false,
  }
}

function storedRecord(source: CreateMcpServerRecord = createInput()) {
  const { args, environmentKeys, ...input } = source
  return {
    ...input,
    argsJson: args,
    environmentKeysJson: environmentKeys,
    lastTestStatus: null,
    lastTestErrorCode: null,
    lastTestedAt: null,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}
