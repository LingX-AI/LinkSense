import { knowledgeCitationProjectionSourceSchema } from "@linksense/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { retainCitedKnowledgeVersions } from "../knowledge/retention.js";
import type { KnowledgeCitationProjection } from "./knowledge-citations.js";

/**
 * Persists the cleaned assistant body and its structured knowledge citations
 * inside the caller's event transaction. A completed message must never become
 * visible without the citation rows that explain its private source markers.
 */
export async function createProjectedAssistantMessage(
  transaction: Prisma.TransactionClient,
  input: {
    conversationId: string;
    turnId: string;
    projection: KnowledgeCitationProjection;
    now?: Date;
  },
) {
  const latestMessage = await transaction.conversationMessage.findFirst({
    where: { conversationId: input.conversationId },
    orderBy: { sequenceNo: "desc" },
  });
  const message = await transaction.conversationMessage.create({
    data: {
      conversationId: input.conversationId,
      turnId: input.turnId,
      sequenceNo: (latestMessage?.sequenceNo ?? 0) + 1,
      role: "assistant",
      contentText: input.projection.contentText,
      ...(input.now ? { createdAt: input.now, updatedAt: input.now } : {}),
    },
  });

  const citations = [...input.projection.citations].sort(
    (left, right) => left.citationNo - right.citationNo,
  );
  if (citations.length === 0) return message;
  if (
    citations.some(
      (citation, index) =>
        citation.citationNo !== index + 1 || citation.anchors.length === 0,
    )
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  for (const citation of citations) {
    knowledgeCitationProjectionSourceSchema.parse({
      knowledge_base_id: citation.knowledgeBaseId,
      document_id: citation.documentId,
      document_version_id: citation.documentVersionId,
      parent_id: citation.parentId,
      title_path: citation.titlePath,
      matched_child_ids: citation.matchedChildIds,
      page_numbers: citation.pageNumbers,
    });
    if (
      citation.anchors.some(
        (anchor) =>
          anchor.anchorAfterOffsetUtf16 < 0 ||
          anchor.anchorAfterOffsetUtf16 > input.projection.contentText.length,
      )
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
  }

  const [versions, knowledgeBases, documents] = await Promise.all([
    transaction.knowledgeBaseDocumentVersion.findMany({
      where: {
        id: {
          in: citations.map((citation) => citation.documentVersionId),
        },
      },
      select: { id: true, knowledgeBaseId: true, documentId: true },
    }),
    transaction.knowledgeBase.findMany({
      where: {
        id: { in: citations.map((citation) => citation.knowledgeBaseId) },
      },
      select: { id: true, name: true },
    }),
    transaction.knowledgeBaseDocument.findMany({
      where: { id: { in: citations.map((citation) => citation.documentId) } },
      select: { id: true, knowledgeBaseId: true, displayName: true },
    }),
  ]);
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const knowledgeBaseById = new Map(
    knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]),
  );
  const documentById = new Map(documents.map((document) => [document.id, document]));
  for (const citation of citations) {
    const version = versionById.get(citation.documentVersionId);
    const knowledgeBase = knowledgeBaseById.get(citation.knowledgeBaseId);
    const document = documentById.get(citation.documentId);
    if (
      version === undefined ||
      version.knowledgeBaseId !== citation.knowledgeBaseId ||
      version.documentId !== citation.documentId ||
      knowledgeBase === undefined ||
      knowledgeBase.name.trim().length === 0 ||
      document === undefined ||
      document.knowledgeBaseId !== citation.knowledgeBaseId ||
      document.displayName.trim().length === 0
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
  }

  // A structured citation is a durable retention reference. Clearing the
  // normal-expiry timestamp in this same transaction prevents a superseded
  // version from being claimed between message visibility and citation save.
  await retainCitedKnowledgeVersions(
    transaction,
    citations.map((item) => item.documentVersionId),
  );

  const createdByNumber = new Map<number, string>();
  for (const citation of citations) {
    const knowledgeBase = knowledgeBaseById.get(citation.knowledgeBaseId);
    const document = documentById.get(citation.documentId);
    if (knowledgeBase === undefined || document === undefined) {
      throw new AppError("VALIDATION_ERROR");
    }
    const created =
      await transaction.conversationMessageKnowledgeCitation.create({
        data: {
          conversationId: input.conversationId,
          turnId: input.turnId,
          messageId: message.id,
          knowledgeBaseId: citation.knowledgeBaseId,
          documentId: citation.documentId,
          documentVersionId: citation.documentVersionId,
          knowledgeBaseNameSnapshot: knowledgeBase.name,
          documentNameSnapshot: document.displayName,
          parentId: citation.parentId,
          citationNo: citation.citationNo,
          titlePath: citation.titlePath,
          matchedChildIds: citation.matchedChildIds,
          pageNumbers: citation.pageNumbers,
          ...(input.now ? { createdAt: input.now, updatedAt: input.now } : {}),
        },
      });
    createdByNumber.set(citation.citationNo, created.id);
  }

  const anchors = citations
    .flatMap((citation) =>
      citation.anchors.map((anchor) => ({
        citationNo: citation.citationNo,
        citationId: createdByNumber.get(citation.citationNo),
        offset: anchor.anchorAfterOffsetUtf16,
      })),
    )
    .sort(
      (left, right) =>
        left.offset - right.offset || left.citationNo - right.citationNo,
    );
  if (anchors.some((anchor) => anchor.citationId === undefined)) {
    throw new AppError("VALIDATION_ERROR");
  }
  await transaction.conversationMessageKnowledgeCitationAnchor.createMany({
    data: anchors.map((anchor, index) => ({
      messageId: message.id,
      citationId: anchor.citationId!,
      occurrenceNo: index + 1,
      anchorAfterOffsetUtf16: anchor.offset,
      ...(input.now ? { createdAt: input.now, updatedAt: input.now } : {}),
    })),
  });
  return message;
}
