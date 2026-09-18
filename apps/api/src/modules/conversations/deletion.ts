import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { runtimePlacementForWorkspace } from "../../lib/user-runtime-paths.js";
import type { AuditContext } from "../audit/service.js";
import { detachConversationDevelopment } from "../applications/development-cleanup.js";
import { restoreUnreferencedVersionCleanupEligibility } from "../knowledge/retention.js";

/** Caller holds the conversation row lock. Persist cleanup before removing its graph. */
export async function deleteConversationWithinTransaction(
  tx: Prisma.TransactionClient, ownerId: string, conversationId: string,
  context: AuditContext, deletionReason: "user" | "creation-failed" = "user",
  deletedIds: string[] = [],
): Promise<void> {
  const automationCount = await tx.automation.count({
    where: { conversationId, deletedAt: null },
  });
  if (automationCount > 0) throw new AppError("AUTOMATION_TASK_IN_USE");
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM conversation_files
    WHERE conversation_id = ${conversationId}::uuid
    FOR UPDATE
  `;
  const running = await tx.conversationTurn.count({
    where: { conversationId, status: "running" },
  });
  if (running > 0) throw new AppError("CONFLICT");
  const unresolvedStart = await tx.conversationTurnStartIntent.count({
    where: { conversationId },
  });
  if (unresolvedStart > 0) throw new AppError("CONFLICT");
  const storedConversation = await tx.conversation.findUnique({ where: { id: conversationId, ownerId }, select: { workspaceRelPath: true } });
  if (!storedConversation) throw new AppError("CONVERSATION_NOT_FOUND");
  const cleanupPlacement = runtimePlacementForWorkspace(ownerId, storedConversation.workspaceRelPath);
  const removeServiceEnvironment = deletionReason === "user" && cleanupPlacement.serviceSessionId !== undefined;
  const artifacts = await tx.conversationFile.findMany({
    where: {
      conversationId,
      kind: "artifact",
      ...(removeServiceEnvironment ? {} : { minioObjectKey: { not: null } }),
    },
  });
  if (removeServiceEnvironment && artifacts.some((artifact) => !artifact.minioObjectKey)) {
    throw new AppError("ARTIFACT_RETENTION_INCOMPLETE");
  }
  const deletedAt = new Date();
  const retainedArtifactIds: string[] = [];
  for (const artifact of artifacts) {
    if (!artifact.minioObjectKey) continue;
    const retained = await tx.retainedArtifact.create({
      data: {
        originalFileId: artifact.id,
        conversationId,
        ownerId,
        minioObjectKey: artifact.minioObjectKey,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        checksumSha256: artifact.checksumSha256,
        artifactCreatedAt: artifact.createdAt,
        conversationDeletedAt: deletedAt,
        createdAt: deletedAt,
      },
    });
    retainedArtifactIds.push(retained.id);
  }
  const fileSummary = await tx.conversationFile.aggregate({
    where: { conversationId },
    _count: { id: true },
    _sum: { sizeBytes: true },
  });
  await tx.auditLog.create({
    data: {
      actorId: ownerId,
      action: "conversation_deleted",
      targetType: "conversation",
      targetId: conversationId,
      result: "success",
      metadataJson: {
        file_count: fileSummary._count.id,
        retained_artifact_count: retainedArtifactIds.length,
        retained_artifact_ids: retainedArtifactIds,
        total_size_bytes: Number(fileSummary._sum.sizeBytes ?? 0n),
      },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    },
  });
  await tx.runtimeCleanupOutbox.upsert({
    where: { conversationId },
    create: {
      ownerId,
      conversationId,
      serviceSessionId: cleanupPlacement.serviceSessionId ?? null,
      removeServiceEnvironment,
      status: "pending",
      stage: "reconcile",
    },
    update: {
      serviceSessionId: cleanupPlacement.serviceSessionId ?? null,
      removeServiceEnvironment,
      status: "pending",
      stage: "reconcile",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastAttemptAt: null,
      lastErrorCode: null,
      claimToken: null,
      leaseExpiresAt: null,
    },
  });
  await deleteConversationGraph(tx, conversationId);
  deletedIds.push(conversationId);
}

async function deleteConversationGraph(
  tx: Prisma.TransactionClient,
  conversationId: string,
) {
  const turnIds = (
    await tx.conversationTurn.findMany({
      where: { conversationId },
      select: { id: true },
    })
  ).map((turn) => turn.id);
  const citations = await tx.conversationMessageKnowledgeCitation.findMany({
    where: { conversationId },
    select: { id: true, documentVersionId: true },
  });
  const citationIds = citations.map((citation) => citation.id);
  const citedVersionIds = [
    ...new Set(citations.map((citation) => citation.documentVersionId)),
  ];
  await tx.webSite.updateMany({ where: { conversationId }, data: { conversationId: null, status: "disabled" } });
  await detachConversationDevelopment(tx, conversationId);
  await tx.conversationShare.deleteMany({ where: { conversationId } });
  await tx.botChannelOutboundDelivery.deleteMany({ where: { conversationId } });
  await tx.botChannelInboundMessage.deleteMany({ where: { conversationId } });
  await tx.botChannelPeerSession.deleteMany({ where: { conversationId } });
  await tx.weixinOutboundDelivery.deleteMany({ where: { conversationId } });
  await tx.weixinInboundMessage.deleteMany({ where: { conversationId } });
  await tx.weixinPeerSession.deleteMany({ where: { conversationId } });
  await tx.conversationFile.deleteMany({ where: { conversationId } });
  if (citationIds.length > 0) {
    await tx.conversationMessageKnowledgeCitationAnchor.deleteMany({
      where: { citationId: { in: citationIds } },
    });
  }
  await tx.conversationMessageKnowledgeCitation.deleteMany({
    where: { conversationId },
  });
  await restoreUnreferencedVersionCleanupEligibility(tx, citedVersionIds);
  await tx.conversationEvent.deleteMany({ where: { conversationId } });
  await tx.conversationPlanReview.deleteMany({ where: { conversationId } });
  await tx.conversationMessage.deleteMany({ where: { conversationId } });
  await tx.conversationTurnKnowledgeBase.deleteMany({
    where: { turnId: { in: turnIds } },
  });
  await tx.conversationTurnAttempt.deleteMany({
    where: { turnId: { in: turnIds } },
  });
  await tx.conversationUserInputRequest.deleteMany({
    where: { conversationId },
  });
  await tx.conversationGoal.deleteMany({ where: { conversationId } });
  await tx.conversationTurn.deleteMany({ where: { conversationId } });
  await tx.conversationTurnStartIntent.deleteMany({
    where: { conversationId },
  });
  await tx.pendingRequest.deleteMany({ where: { conversationId } });
  await tx.conversation.delete({ where: { id: conversationId } });
}
