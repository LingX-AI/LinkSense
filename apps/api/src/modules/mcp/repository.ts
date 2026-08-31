import { z } from "zod"

import type {
  McpServer as PrismaMcpServer,
  PrismaClient,
} from "../../generated/prisma/client.js"
import type {
  CreateMcpServerRecord,
  McpServerRecord,
  McpServerRepository,
  UpdateMcpServerRecord,
} from "./types.js"

export class PrismaMcpServerRepository implements McpServerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByOwner(ownerId: string): Promise<McpServerRecord[]> {
    const rows = await this.prisma.mcpServer.findMany({
      where: { ownerId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    })
    return rows.map(parseMcpServerRecord)
  }

  async findOwned(
    ownerId: string,
    id: string
  ): Promise<McpServerRecord | null> {
    const row = await this.prisma.mcpServer.findFirst({
      where: { id, ownerId },
    })
    return row === null ? null : parseMcpServerRecord(row)
  }

  createWithinOwnerLimit(
    input: CreateMcpServerRecord,
    limit: number
  ): Promise<McpServerRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`linksense:mcp-owner:${input.ownerId}`}, 0)
        )
      `
      const count = await transaction.mcpServer.count({
        where: { ownerId: input.ownerId },
      })
      if (count >= limit) return null
      return parseMcpServerRecord(
        await transaction.mcpServer.create({ data: projectCreateRecord(input) })
      )
    })
  }

  createManyWithinOwnerLimit(
    input: CreateMcpServerRecord[],
    limit: number
  ): Promise<McpServerRecord[] | null> {
    if (input.length === 0) return Promise.resolve([])
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`linksense:mcp-owner:${input[0]!.ownerId}`}, 0)
        )
      `
      const count = await transaction.mcpServer.count({
        where: { ownerId: input[0]!.ownerId },
      })
      if (count + input.length > limit) return null
      const created: McpServerRecord[] = []
      for (const row of input) {
        created.push(
          parseMcpServerRecord(
            await transaction.mcpServer.create({
              data: projectCreateRecord(row),
            })
          )
        )
      }
      return created
    })
  }

  async update(
    id: string,
    input: UpdateMcpServerRecord
  ): Promise<McpServerRecord> {
    return parseMcpServerRecord(
      await this.prisma.mcpServer.update({
        where: { id },
        data: projectUpdateRecord(input),
      })
    )
  }

  async delete(id: string): Promise<void> {
    await this.prisma.mcpServer.delete({ where: { id } })
  }
}

const authTypeSchema = z.enum(["none", "bearer", "api_key"])
const statusSchema = z.enum(["active", "disabled"])
const testStatusSchema = z.enum(["succeeded", "failed"])
const transportSchema = z.enum(["streamable_http", "stdio"])
const stringArraySchema = z.array(z.string())

function parseMcpServerRecord(row: PrismaMcpServer): McpServerRecord {
  return {
    ...row,
    transport: transportSchema.parse(row.transport),
    args: stringArraySchema.parse(row.argsJson),
    environmentKeys: stringArraySchema.parse(row.environmentKeysJson),
    authType: authTypeSchema.parse(row.authType),
    status: statusSchema.parse(row.status),
    lastTestStatus:
      row.lastTestStatus === null
        ? null
        : testStatusSchema.parse(row.lastTestStatus),
  }
}

function projectCreateRecord(input: CreateMcpServerRecord) {
  const { args, environmentKeys, ...record } = input
  return {
    ...record,
    argsJson: args,
    environmentKeysJson: environmentKeys,
  }
}

function projectUpdateRecord(input: UpdateMcpServerRecord) {
  const { args, environmentKeys, ...record } = input
  return {
    ...record,
    ...(args === undefined ? {} : { argsJson: args }),
    ...(environmentKeys === undefined
      ? {}
      : { environmentKeysJson: environmentKeys }),
  }
}
