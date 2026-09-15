import { assertExecutionPrincipalActive } from "../../lib/execution-principal.js";
import type {
  ConversationFile,
  PrismaClient,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

type SnapshotKey = { conversationId: string; assetId: string };
type SnapshotContext = SnapshotKey & { actorId: string; turnId: string };
type SnapshotFile = Pick<
  ConversationFile,
  "turnId" | "filename" | "mimeType" | "sizeBytes" | "minioObjectKey"
>;
type SnapshotPublication = SnapshotContext & {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  checksumSha256: string;
  objectKey: string;
};

function snapshotWhere(input: SnapshotKey) {
  return {
    conversationId_knowledgeAssetReferenceId: {
      conversationId: input.conversationId,
      knowledgeAssetReferenceId: input.assetId,
    },
  };
}

/** Durable image identity and conversation lifecycle checks live in one data boundary. */
export class ConversationAssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async exists(input: SnapshotKey): Promise<boolean> {
    return Boolean(
      await this.prisma.conversationFile.findUnique({
        where: snapshotWhere(input),
        select: { id: true },
      }),
    );
  }

  async publish(input: SnapshotPublication): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Use the same parent-row lock as conversation deletion. An upload may
      // finish after deletion, but must never recreate its attachment records.
      const conversations = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT c.id FROM conversations c
        WHERE c.id = ${input.conversationId}::uuid
          AND c.owner_id = ${input.actorId}::uuid
        FOR UPDATE OF c
      `;
      if (conversations.length === 0) throw new AppError("NOT_FOUND");
      await assertExecutionPrincipalActive(tx, input.actorId);
      const [turn, intent] = await Promise.all([
        tx.conversationTurn.findFirst({
          where: {
            id: input.turnId,
            conversationId: input.conversationId,
            submittedBy: input.actorId,
          },
          select: { id: true },
        }),
        tx.conversationTurnStartIntent.findFirst({
          where: {
            projectionTurnId: input.turnId,
            conversationId: input.conversationId,
            ownerId: input.actorId,
            runnerStatus: "runner_succeeded",
          },
          select: { projectionTurnId: true },
        }),
      ]);
      if (!turn && !intent) throw new AppError("NOT_FOUND");
      const saved = await tx.conversationFile.upsert({
        where: snapshotWhere(input),
        update: {},
        create: {
          id: input.id,
          conversationId: input.conversationId,
          turnId: input.turnId,
          knowledgeAssetReferenceId: input.assetId,
          kind: "artifact",
          source: "system_generated",
          status: "registered",
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256,
          storageBackend: "minio",
          minioObjectKey: input.objectKey,
          // Inline copies are not download-card artifacts. Their dedicated
          // reader authorizes the conversation and image identity instead.
          downloadable: false,
          createdBy: input.actorId,
        },
        select: { minioObjectKey: true },
      });
      return saved.minioObjectKey === input.objectKey;
    });
  }

  async findVisibleFile(input: SnapshotContext): Promise<SnapshotFile | null> {
    const [conversation, turn] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: input.conversationId, ownerId: input.actorId },
        select: { id: true },
      }),
      this.prisma.conversationTurn.findFirst({
        where: { id: input.turnId, conversationId: input.conversationId },
        select: { id: true, sequenceNo: true },
      }),
    ]);
    if (!conversation || !turn) return null;
    const file = await this.prisma.conversationFile.findFirst({
      where: {
        conversationId: input.conversationId,
        knowledgeAssetReferenceId: input.assetId,
        kind: "artifact",
        source: "system_generated",
        status: "registered",
        storageBackend: "minio",
      },
      select: {
        turnId: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        minioObjectKey: true,
      },
    });
    if (!file?.turnId) return null;
    // Later turns can reuse images, but earlier turns cannot read future
    // context. Forks keep this ordering through their remapped turn ids.
    const sourceTurn = await this.prisma.conversationTurn.findFirst({
      where: {
        id: file.turnId,
        conversationId: input.conversationId,
        sequenceNo: { lte: turn.sequenceNo },
      },
      select: { id: true },
    });
    return sourceTurn ? file : null;
  }
}
