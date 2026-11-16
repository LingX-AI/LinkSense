import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../src/db.js";
import { WebSiteRepository } from "../../src/modules/web-sites/repository.js";

// This check requires an explicitly supplied disposable, migrated database.
if (!process.env.LINKSENSE_TEST_DATABASE_URL) throw new Error("LINKSENSE_TEST_DATABASE_URL is required");
const db = createPrismaClient(process.env.LINKSENSE_TEST_DATABASE_URL);
try {
  const owner = await db.user.create({ data: { email: "site-owner@example.test", name: "Owner", role: "user", status: "active" } });
  const other = await db.user.create({ data: { email: "site-other@example.test", name: "Other", role: "user", status: "active" } });
  const createTask = (thread: string) => db.conversation.create({ data: {
    ownerId: owner.id, title: thread, titleSource: "manual", codexThreadId: thread,
    archiveStatus: "active", workspaceRelPath: `${owner.id}/home/workspace`, runtimeGeneration: randomUUID(),
  } });
  const firstTask = await createTask("original-thread");
  const nextTask = await createTask("next-thread");
  const createTurn = (conversationId: string, thread: string) => db.conversationTurn.create({ data: {
    conversationId, submittedBy: owner.id, sequenceNo: 1, codexThreadId: thread, codexTurnId: `${thread}-turn`,
    status: "completed", submitMode: "normal", capabilityGeneration: "a".repeat(64), capabilitiesJson: [],
    startedAt: new Date(), completedAt: new Date(),
  } });
  const firstTurn = await createTurn(firstTask.id, "original-thread");
  const nextTurn = await createTurn(nextTask.id, "next-thread");
  const createFile = (conversationId: string, turnId: string) => db.conversationFile.create({ data: {
    conversationId, turnId, kind: "artifact", source: "agent_generated", status: "registered", filename: "index.html",
    mimeType: "text/html", sizeBytes: 10, storageBackend: "minio", minioObjectKey: `fixture/${turnId}`,
    downloadable: true, downloadCardEventId: randomUUID(),
  } });
  const firstFile = await createFile(firstTask.id, firstTurn.id);
  const nextFile = await createFile(nextTask.id, nextTurn.id);
  const siteId = randomUUID();
  const firstReleaseId = randomUUID();
  const nextReleaseId = randomUUID();
  await db.webSite.create({ data: {
    id: siteId, ownerId: owner.id, conversationId: firstTask.id, sourceTaskTitle: firstTask.title,
    originFileId: firstFile.id, sourceFileId: firstFile.id, name: "Sample", slug: "sample",
    status: "published", currentReleaseId: firstReleaseId,
  } });
  await db.webSiteRelease.create({ data: { id: firstReleaseId, siteId, sourceFileId: firstFile.id, manifestJson: {} } });
  const repository = new WebSiteRepository(db);
  const expected = {
    id: siteId, name: "Sample", slug: "sample", status: "published", source_file_id: firstFile.id, turn_id: firstTurn.id, backend_id: null,
  };
  assert.deepEqual(await repository.conversationDeliveries(owner.id, firstTask.id), [expected]);
  assert.deepEqual(await repository.conversationDeliveries(other.id, firstTask.id), []);
  await db.webSiteRelease.create({ data: { id: nextReleaseId, siteId, sourceFileId: nextFile.id, manifestJson: {} } });
  await db.webSite.update({ where: { id: siteId }, data: {
    conversationId: nextTask.id, sourceFileId: nextFile.id, currentReleaseId: nextReleaseId, status: "disabled",
  } });
  assert.deepEqual(await repository.conversationDeliveries(owner.id, firstTask.id), [{ ...expected, status: "disabled" }]);
  assert.deepEqual(await repository.conversationDeliveries(owner.id, nextTask.id), [{
    ...expected, status: "disabled", source_file_id: nextFile.id, turn_id: nextTurn.id,
  }]);

  const assertTurn = (userId = owner.id, conversationId = nextTask.id) =>
    repository.assertActiveTurn(userId, conversationId, nextTurn.id);
  await assert.rejects(assertTurn(), { code: "FORBIDDEN" });
  await db.conversationTurn.update({ where: { id: nextTurn.id }, data: {
    status: "running", completedAt: null,
  } });
  await assertTurn();
  await assert.rejects(assertTurn(other.id), { code: "FORBIDDEN" });
  await assert.rejects(assertTurn(owner.id, firstTask.id), { code: "FORBIDDEN" });
  await db.conversationTurn.update({ where: { id: nextTurn.id }, data: { collaborationMode: "plan" } });
  await assert.rejects(assertTurn(), { code: "FORBIDDEN" });
  await db.conversationTurn.update({ where: { id: nextTurn.id }, data: { collaborationMode: "default" } });
  await db.conversation.update({ where: { id: nextTask.id }, data: { codexThreadId: "replaced-thread" } });
  await assert.rejects(assertTurn(), { code: "FORBIDDEN" });
  await db.conversation.update({ where: { id: nextTask.id }, data: {
    codexThreadId: nextTurn.codexThreadId, archiveStatus: "archived", archivedAt: new Date(),
  } });
  await assert.rejects(assertTurn(), { code: "FORBIDDEN" });
  console.log("PASS: release history, publication status, owner isolation and active turn scope.");
} finally {
  await db.$disconnect();
}
