import type { Prisma } from "../../generated/prisma/client.js"

/**
 * Serialize every event writer for one conversation. Event sequence numbers are
 * part of the SSE resume contract, so reading max(sequence_no) without this
 * transaction-scoped lock can allocate duplicates under concurrent writers.
 */
export async function nextConversationEventSequence(
  transaction: Prisma.TransactionClient,
  conversationId: string,
): Promise<bigint> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${conversationId}, 0))
  `
  const latest = await transaction.conversationEvent.findFirst({
    where: { conversationId },
    orderBy: { sequenceNo: "desc" },
    select: { sequenceNo: true },
  })
  return (latest?.sequenceNo ?? 0n) + 1n
}
