// Explicit opt-in integration smoke: real PostgreSQL and MinIO, no AI requests.
// Creates and removes only its own random fixture rows and object keys.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { Client } from "minio";
import { z } from "zod";
import { createPrismaClient } from "../../src/db.js";
import { ConversationAssetSnapshots } from "../../src/modules/knowledge/conversation-asset-snapshots.js";
import { KnowledgeTurnAssetReadService } from "../../src/modules/knowledge/turn-asset-read.js";
import { knowledgeTurnAssetRoutes } from "../../src/modules/knowledge/turn-asset-routes.js";

const env = z
  .object({
    LINKSENSE_IMAGE_SMOKE: z.literal("1"),
    DATABASE_URL: z.string().min(1),
    MINIO_ENDPOINT: z.string().min(1),
    MINIO_PORT: z.coerce.number().int().positive(),
    MINIO_USE_SSL: z.enum(["true", "false"]),
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(1),
    MINIO_BUCKET: z.string().min(1),
  })
  .parse(process.env);
const client = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL === "true",
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});
const prisma = createPrismaClient(env.DATABASE_URL);
const ownerId = randomUUID();
const conversationId = randomUUID();
const turnId = randomUUID();
const laterTurnId = randomUUID();
const forkId = randomUUID();
const forkTurnId = randomUUID();
const knowledgeBaseId = randomUUID();
const assetIds = [randomUUID(), randomUUID(), randomUUID()];
const actor = { id: ownerId, status: "active" as const, role: "user" as const };
const keys = new Set<string>();
const storage = {
  async putObject(
    key: string,
    bytes: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void> {
    assert(key.startsWith(`conversations/${conversationId}/artifacts/`));
    keys.add(key);
    await client.putObject(
      env.MINIO_BUCKET,
      key,
      bytes,
      bytes.length,
      metadata,
    );
  },
  async removeObject(key: string): Promise<void> {
    assert(keys.has(key));
    await client.removeObject(env.MINIO_BUCKET, key);
  },
  getObjectStream: (key: string) => client.getObject(env.MINIO_BUCKET, key),
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=",
  "base64",
);
let knowledgeAvailable = true;
const writer = new ConversationAssetSnapshots(
  prisma,
  storage,
  {
    async getAsset() {
      assert(knowledgeAvailable);
      return {
        filename: "fixture.png",
        mimeType: "image/png",
        sizeBytes: BigInt(png.length),
        stream: Readable.from(png),
      };
    },
  },
  {
    async getTurnRetrievalScope() {
      assert(knowledgeAvailable);
      return {
        requested_ids: [knowledgeBaseId],
        usable_ids: [knowledgeBaseId],
        unavailable_ids: [],
      };
    },
  },
  { enqueueObjectDelete: storage.removeObject },
);
const app = Fastify();
try {
  await prisma.user.create({
    data: {
      id: ownerId,
      email: `${ownerId}@image-smoke.invalid`,
      name: "Image snapshot smoke fixture",
      role: "user",
      status: "active",
    },
  });
  await prisma.conversation.createMany({
    data: [conversationId, forkId].map((id) => ({
      id,
      ownerId,
      title: "Image snapshot smoke fixture",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: `image-smoke/${id}`,
      runtimeGeneration: randomUUID(),
    })),
  });
  await prisma.conversationTurn.createMany({
    data: [
      { id: turnId, conversationId, sequenceNo: 1 },
      { id: laterTurnId, conversationId, sequenceNo: 2 },
      { id: forkTurnId, conversationId: forkId, sequenceNo: 1 },
    ].map((turn) => ({
      ...turn,
      submittedBy: ownerId,
      codexThreadId: randomUUID(),
      codexTurnId: randomUUID(),
      status: "completed",
      submitMode: "normal",
      capabilityGeneration: "0".repeat(64),
      capabilitiesJson: [],
      startedAt: new Date(),
      completedAt: new Date(),
    })),
  });
  const input = {
    actor,
    conversationId,
    turnId,
    sources: [
      {
        knowledgeBaseId,
        documentId: randomUUID(),
        documentVersionId: randomUUID(),
        assetReferenceIds: assetIds,
      },
    ],
  };
  await Promise.all([writer.capture(input), writer.capture(input)]);
  const files = await prisma.conversationFile.findMany({
    where: { conversationId },
  });
  assert.equal(files.length, 3);
  assert.equal(new Set(files.map((file) => file.minioObjectKey)).size, 3);
  for (const file of files) {
    assert.equal(file.downloadable, false);
    assert.equal(file.downloadCardEventId, null);
    await prisma.conversationFile.create({
      data: {
        ...file,
        id: randomUUID(),
        conversationId: forkId,
        turnId: forkTurnId,
      },
    });
  }
  knowledgeAvailable = false;
  const reader = new KnowledgeTurnAssetReadService(prisma, storage);
  await app.register(knowledgeTurnAssetRoutes, {
    service: reader,
    resolveActor: async () => actor,
  });
  for (const [conversation, turn] of [
    [conversationId, laterTurnId],
    [forkId, forkTurnId],
  ]) {
    for (const asset of assetIds) {
      const response = await app.inject({
        method: "GET",
        url: `/${conversation}/turns/${turn}/knowledge-assets/${asset}`,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.rawPayload, png);
    }
  }
  await assert.rejects(
    reader.getAsset(
      { ...actor, id: randomUUID() },
      conversationId,
      laterTurnId,
      assetIds[0]!,
    ),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    reader.getAsset(actor, conversationId, laterTurnId, randomUUID()),
    { code: "NOT_FOUND" },
  );
  console.log(
    "PASS: real DB/MinIO, 3 snapshots, concurrent deduplication, 6 HTTP image reads, later-turn/fork isolation, unavailable knowledge source, unknown/foreign access rejected.",
  );
} finally {
  await app.close();
  try {
    for (const key of keys) await storage.removeObject(key);
    await prisma.$transaction(async (tx) => {
      const ids = [conversationId, forkId];
      await tx.conversationFile.deleteMany({
        where: { conversationId: { in: ids } },
      });
      await tx.conversationTurn.deleteMany({
        where: { conversationId: { in: ids } },
      });
      await tx.conversation.deleteMany({ where: { id: { in: ids }, ownerId } });
      await tx.user.deleteMany({ where: { id: ownerId } });
    });
    console.log("PASS: temporary fixture rows and image objects cleaned.");
  } finally {
    await prisma.$disconnect();
  }
}
