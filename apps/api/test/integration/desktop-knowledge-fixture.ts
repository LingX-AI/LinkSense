import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { DesktopRunScope } from "../../src/modules/desktop-credentials/run-leases.js";
import { assertDesktopKnowledgeAssetCurrent } from "../../src/modules/desktop-devices/knowledge-publication.js";
import { TurnKnowledgeSourceStore } from "../../src/modules/events/knowledge-source-store.js";
import { InternalKnowledgeSearchService } from "../../src/modules/knowledge/internal-search.js";
import { TurnKnowledgeDocumentReferenceStore } from "../../src/modules/knowledge/knowledge-document-ref-store.js";
import { PrismaKnowledgeStore } from "../../src/modules/knowledge/repository.js";
import { KnowledgeService } from "../../src/modules/knowledge/service.js";
import type { ParentSearchHit } from "../../src/modules/knowledge-processing/elasticsearch.js";

export async function createDesktopKnowledgeFixture(prisma: PrismaClient, redis: Redis, ownerId: string, otherOwnerId: string) {
  const createDocument = async (actorId: string, name: string) => {
    const base = await prisma.knowledgeBase.create({ data: { ownerId: actorId, name } });
    const displayName = `${name}.md`;
    const content = `${name}-${randomUUID()}`;
    const versionId = randomUUID();
    const file = {
      canonicalExtension: "md",
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(content),
      originalSha256: createHash("sha256").update(content).digest("hex"),
      createdBy: actorId,
    };
    const document = await prisma.knowledgeBaseDocument.create({
      data: {
        ...file, knowledgeBaseId: base.id, status: "ready", currentVersionId: versionId,
        displayName, normalizedDisplayName: displayName.toLowerCase(),
      },
    });
    await prisma.knowledgeBaseDocumentVersion.create({
      data: {
        ...file, id: versionId, knowledgeBaseId: base.id, documentId: document.id, originalFilename: displayName,
        versionNumber: 1, versionStatus: "ready", processingGeneration: randomUUID(), processingStage: "completed",
        progressPercent: 100, completedAt: new Date(), indexReady: true, parentCount: 1, childCount: 1,
      },
    });
    const child = {
      childId: randomUUID(), order: 0, rawText: content, titlePath: [name],
      pageNumbers: [1], score: 1, matchKinds: ["lexical" as const],
    };
    const hit: ParentSearchHit = {
      parentId: randomUUID(), parentOrder: 0, knowledgeBaseId: base.id, documentId: document.id,
      documentVersionId: versionId, titlePath: [name], parentText: content,
      pageNumbers: [1], childIds: [child.childId], childCount: 1, matchedChildren: [child], score: 1,
    };
    return { base, document, content, hit };
  };
  const owned = await createDocument(ownerId, "Fixture reference");
  const foreign = await createDocument(otherOwnerId, "Other account reference");
  const store = new PrismaKnowledgeStore(prisma);
  const unavailable = async (): Promise<never> => { throw new Error("Unexpected knowledge mutation"); };
  const knowledge = new KnowledgeService({
    store,
    ingestionAdapter: { registerUpload: unavailable, discardRegisteredUpload: unavailable },
    scheduler: {
      enqueue: unavailable, cancel: unavailable, runDocumentExclusiveMutation: unavailable, abortActiveDocumentMutations: () => {},
    },
  });
  const sources = new TurnKnowledgeSourceStore(redis);
  const references = new TurnKnowledgeDocumentReferenceStore(redis);
  const service = new InternalKnowledgeSearchService(
    prisma,
    {
      getTurnRetrievalScope: (actor, locator) => knowledge.getTurnRetrievalScope(actor, locator),
      listDocuments: async (_actor, baseId) => {
        const docs = await prisma.knowledgeBaseDocument.findMany({ where: { knowledgeBaseId: baseId, status: "ready" } });
        return {
          items: docs.map(doc => ({
            id: doc.id, display_name: doc.displayName, canonical_extension: doc.canonicalExtension,
            current_version_id: doc.currentVersionId, searchable: true,
          })),
          next_cursor: null,
        };
      },
      getParsedContentChunk: async (actor, baseId, documentId, versionId) => {
        assert.equal(actor.id, ownerId);
        assert.equal(baseId, owned.base.id);
        assert.equal(documentId, owned.document.id);
        assert.equal(versionId, owned.document.currentVersionId);
        const bytes = Buffer.byteLength(owned.content);
        return { markdown: owned.content, byteStart: 0, byteEnd: bytes, totalBytes: bytes, complete: true };
      },
    },
    {
      search: async ({ authorizedKnowledgeBaseIds, filterCandidates }) => {
        assert.deepEqual(authorizedKnowledgeBaseIds, [owned.base.id]);
        const parents = await filterCandidates([owned.hit, foreign.hit].map(hit => ({ ...hit, rrfScore: 1 })));
        return { parents, ranking: "rrf" };
      },
    },
    sources, references, { capture: async ({ sources }) => { assert(sources.every(source => !source.assetReferenceIds.length)); } },
  );
  return { store, service, owned, foreign, sources, references };
}

export async function verifyDesktopKnowledgePublication(
  prisma: PrismaClient,
  scope: DesktopRunScope,
  shared: Awaited<ReturnType<typeof createDesktopKnowledgeFixture>>["foreign"],
): Promise<void> {
  const grant = await prisma.knowledgeBaseGrant.create({
    data: {
      knowledgeBaseId: shared.base.id, granteeType: "user",
      userId: scope.ownerId, grantedBy: shared.base.ownerId,
    },
  });
  const check = () => prisma.$transaction(tx => assertDesktopKnowledgeAssetCurrent(prisma, tx, scope, {
    knowledgeBaseId: shared.base.id, documentId: shared.document.id,
    documentVersionId: shared.hit.documentVersionId, assetReferenceIds: [],
  }));
  await check();
  await prisma.knowledgeBaseGrant.update({
    where: { id: grant.id },
    data: { status: "revoked", revokedBy: shared.base.ownerId, revokedAt: new Date() },
  });
  await assert.rejects(check(), { code: "FORBIDDEN" });
}
