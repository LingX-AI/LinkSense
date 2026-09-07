import type { ObjectStorage } from "../../adapters/object-storage.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { ConversationAssetRepository } from "./conversation-asset-repository.js";
import type { KnowledgeActor, KnowledgeAssetFile } from "./types.js";

/** Reads only durable conversation attachments, never live knowledge storage. */
export class KnowledgeTurnAssetReadService {
  private readonly repository: ConversationAssetRepository;

  constructor(
    prisma: PrismaClient,
    private readonly storage: Pick<ObjectStorage, "getObjectStream">,
  ) {
    this.repository = new ConversationAssetRepository(prisma);
  }

  async getAsset(
    actor: KnowledgeActor,
    conversationId: string,
    turnId: string,
    assetReferenceId: string,
  ): Promise<KnowledgeAssetFile> {
    if (actor.status !== "active") throw new AppError("NOT_FOUND");
    const file = await this.repository.findVisibleFile({
      actorId: actor.id,
      conversationId,
      turnId,
      assetId: assetReferenceId,
    });
    if (
      !file?.turnId ||
      !file.minioObjectKey ||
      !file.mimeType?.startsWith("image/")
    ) {
      throw new AppError("NOT_FOUND");
    }
    try {
      return {
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        stream: await this.storage.getObjectStream(file.minioObjectKey),
      };
    } catch {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }
  }
}
