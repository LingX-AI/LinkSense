import type { Prisma } from "../../generated/prisma/client.js";

export async function cancelConnectionNotifications(tx: Prisma.TransactionClient, ownerId: string, connectionId: string): Promise<void> {
  await tx.automationNotificationDelivery.updateMany({
    where: { ownerId, status: { in: ["pending", "processing"] }, targetJson: { path: ["connection_id"], equals: connectionId } },
    data: { status: "cancelled", processingToken: null },
  });
}
