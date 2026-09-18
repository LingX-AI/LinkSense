import type { Prisma } from "../../generated/prisma/client.js";

/** Applications own their sources and tests; task deletion only detaches the conversation. */
export async function detachConversationDevelopment(tx: Prisma.TransactionClient, conversationId: string): Promise<void> {
  await tx.applicationDevelopment.updateMany({ where: { conversationId }, data: { conversationId: null } });
  await tx.applicationDevelopment.updateMany({ where: { previewConversationId: conversationId }, data: { previewConversationId: null } });
}
