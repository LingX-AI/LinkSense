import { conversationExecutionTargetSchema, type ConversationExecutionTarget } from "@linksense/shared";
import { v5 as uuidv5 } from "uuid";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export async function assertPairedDesktopDevice(
  db: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
  deviceId: string,
  requiredPlatform?: "darwin",
): Promise<void> {
  const platform = requiredPlatform
    ? Prisma.sql`AND d.platform = ${requiredPlatform}`
    : Prisma.empty;
  const [device] = await db.$queryRaw<Array<{ deviceEpoch: Date; ownerEpoch: Date }>>`
    SELECT d.auth_valid_after AS "deviceEpoch", u.auth_valid_after AS "ownerEpoch"
    FROM desktop_devices d JOIN users u ON u.id = d.owner_id
    WHERE d.id = ${deviceId}::uuid AND d.owner_id = ${ownerId}::uuid
      ${platform}
      AND d.revoked_at IS NULL AND u.status = 'active'
    FOR SHARE OF d, u`;
  if (!device || device.deviceEpoch.getTime() !== device.ownerEpoch.getTime()) {
    throw new AppError("FORBIDDEN");
  }
}

/** Deterministic idempotency receipt: normalized owner, source task and request scope the destination. */
export function conversationContinuationId(
  ownerId: string,
  sourceConversationId: string,
  requestId: string,
): string {
  return uuidv5(
    `linksense:conversation-continuation:${sourceConversationId.toLowerCase()}:${requestId.toLowerCase()}`,
    ownerId.toLowerCase(),
  );
}

type ContinuationSourceRow = {
  id: string;
  title: string;
  archiveStatus: string;
  applicationId: string | null;
  sideChatParentId: string | null;
  executionTarget: string | null;
};

export type ContinuationSource = {
  id: string;
  title: string;
  executionTarget: ConversationExecutionTarget;
};

async function eligibleContinuationSource(
  db: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
  row: ContinuationSourceRow | undefined,
  requestedTarget: ConversationExecutionTarget,
): Promise<ContinuationSource> {
  if (!row) throw new AppError("CONVERSATION_NOT_FOUND");
  if (row.archiveStatus !== "active") throw new AppError("CONFLICT");
  // The frozen continuation response reuses the task-reference title bounds.
  // Fail before workspace work instead of producing an invalid post-commit row.
  if (row.title.length < 1 || row.title.length > 240) throw new AppError("CONFLICT");
  if (row.applicationId !== null || row.sideChatParentId !== null) {
    throw new AppError("CONVERSATION_NOT_FOUND");
  }
  const development = await db.applicationDevelopment.findFirst({
    where: { conversationId: row.id, ownerId },
    select: { id: true },
  });
  if (development) throw new AppError("CONVERSATION_NOT_FOUND");
  const executionTarget = conversationExecutionTargetSchema.parse(
    row.executionTarget ?? "cloud",
  );
  if (executionTarget === requestedTarget) {
    throw new AppError("VALIDATION_ERROR");
  }
  return { id: row.id, title: row.title, executionTarget };
}

/** Cheap pre-workspace check. The creation transaction repeats it under the source row lock. */
export async function readContinuationSource(
  db: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
  sourceConversationId: string,
  requestedTarget: ConversationExecutionTarget,
): Promise<ContinuationSource> {
  const source = await db.conversation.findFirst({
    where: { id: sourceConversationId, ownerId },
    select: {
      id: true,
      title: true,
      archiveStatus: true,
      applicationId: true,
      sideChatParentId: true,
      executionTarget: true,
    },
  });
  return eligibleContinuationSource(
    db,
    ownerId,
    source ?? undefined,
    requestedTarget,
  );
}

/** Authority check immediately before the destination row and audit commit. */
export async function lockContinuationSource(
  tx: Prisma.TransactionClient,
  ownerId: string,
  sourceConversationId: string,
  requestedTarget: ConversationExecutionTarget,
): Promise<ContinuationSource> {
  const [source] = await tx.$queryRaw<ContinuationSourceRow[]>`
    SELECT id, title, archive_status AS "archiveStatus",
      application_id AS "applicationId", side_chat_parent_id AS "sideChatParentId",
      execution_target AS "executionTarget"
    FROM conversations
    WHERE id = ${sourceConversationId}::uuid AND owner_id = ${ownerId}::uuid
    FOR UPDATE`;
  return eligibleContinuationSource(
    tx,
    ownerId,
    source,
    requestedTarget,
  );
}
