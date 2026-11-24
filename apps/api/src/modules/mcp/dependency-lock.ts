import { Prisma } from "../../generated/prisma/client.js"
import { AppError } from "../../lib/errors.js"

/** Binding and release writes take a shared row lock against MCP deletion. */
export async function assertOwnedMcpServersExist(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
  ownerId: string,
  serverIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(serverIds.map((id) => id.toLowerCase()))]
  if (ids.length === 0) return
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM mcp_servers
    WHERE owner_id = ${ownerId}::uuid
      AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR KEY SHARE
  `)
  if (rows.length !== ids.length) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE")
}
