import type { PrismaClient } from "../../generated/prisma/client.js";

/** Late durable outbox entries must not restart execution across a deploy cutover. */
export async function isStoppedDeploymentEvent(
  prisma: PrismaClient,
  conversationId: string,
  threadId: string,
  options: { nativeUpdatedAt?: number } = {},
): Promise<boolean> {
  const stop = await prisma.auditLog.findFirst({
    where: {
      action: "conversation_execution_stopped_for_deployment",
      targetType: "conversation",
      targetId: conversationId,
      result: "success",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!stop) return false;
  if (options.nativeUpdatedAt !== undefined) {
    return options.nativeUpdatedAt * 1_000 <= stop.createdAt.getTime();
  }
  // A new durable start/recovery must be allowed to project before delivery.
  const [start, turn, attempt] = await Promise.all([
    prisma.conversationTurnStartIntent.findUnique({
      where: { conversationId },
      select: { projectionTurnId: true },
    }),
    prisma.conversationTurn.findFirst({
      where: { conversationId, status: "running" },
      select: { id: true },
    }),
    prisma.conversationTurnAttempt.findFirst({
      where: { status: "pending", codexThreadId: threadId },
      select: { id: true },
    }),
  ]);
  return !start && !turn && !attempt;
}
