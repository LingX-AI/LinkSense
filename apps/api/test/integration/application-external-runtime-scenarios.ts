import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ApplicationService } from "../../src/modules/applications/service.js";
import type { ApplicationPublicationService } from "../../src/modules/applications/publication-service.js";
import type { ApplicationRuntimeGate } from "../../src/modules/applications/runtime-gate.js";
import { serviceWorkspaceRelativePath } from "../../src/lib/user-runtime-paths.js";

export async function verifyExternalRuntimeUpdates(input: {
  prisma: PrismaClient; applications: ApplicationService; publications: ApplicationPublicationService;
  competingGate: ApplicationRuntimeGate; applicationId: string; creatorId: string; recipientId: string;
  oldVersionId: string; newVersionId: string; userDataRoot: string; capabilityRoot: string;
}): Promise<void> {
  const { prisma, applications, publications, competingGate, applicationId, creatorId, recipientId, oldVersionId, newVersionId, userDataRoot, capabilityRoot } = input;
  const principalId = randomUUID();
  const access = await prisma.applicationExternalAccess.create({ data: {
    applicationId, publicId: randomUUID(), enabled: true, authMode: "public", createdBy: creatorId,
  } });
  const workspace = serviceWorkspaceRelativePath(principalId, applicationId);
  const tasks = await Promise.all(["Existing external task", "Another external task"].map(title => prisma.conversation.create({ data: {
    ownerId: principalId, applicationId, applicationVersionId: oldVersionId, title, titleSource: "manual",
    workspaceRelPath: workspace, runtimeGeneration: randomUUID(), codexThreadId: randomUUID(), archiveStatus: "active", applicationNameSnapshot: "Reports",
  } })));
  const task = tasks[0]!;
  await prisma.applicationExternalSession.create({ data: {
    externalAccessId: access.id, applicationId, runtimePrincipalId: principalId, conversationId: task.id,
    externalSubject: "existing-partner-user", origin: "https://partner.example.test", credentialVersion: access.credentialVersion,
    absoluteExpiresAt: new Date(Date.now() + 3_600_000),
  } });
  // Historical migrations inherited the conversation's direct channel.
  await prisma.applicationRuntimeInstallation.create({ data: { ownerId: principalId, applicationId, versionId: oldVersionId, channel: "direct" } });
  await mkdir(join(userDataRoot, workspace), { recursive: true });
  const workFile = join(userDataRoot, workspace, "previous-work.txt"); await writeFile(workFile, "External user's work");
  const turns = await Promise.all(tasks.map(conversation => prisma.conversationTurn.create({ data: {
    conversationId: conversation.id, sequenceNo: 1, submittedBy: principalId, submitMode: "normal", capabilityGeneration: "a".repeat(64),
    capabilitiesJson: [], startedAt: new Date(), status: "running", codexThreadId: conversation.codexThreadId!, codexTurnId: randomUUID(),
  } })));
  const start = () => applications.withRuntimeStart(principalId, applicationId, () => applications.resolveRuntime(principalId, applicationId));
  assert.equal((await start()).applicationVersionId, oldVersionId);
  await prisma.conversationTurn.update({ where: { id: turns[0]!.id }, data: { status: "completed", completedAt: new Date() } });
  assert.equal((await start()).applicationVersionId, oldVersionId);
  await prisma.conversationTurn.update({ where: { id: turns[1]!.id }, data: { status: "completed", completedAt: new Date() } });
  const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
  const intent = await prisma.conversationTurnStartIntent.create({ data: {
    projectionTurnId: randomUUID(), ownerId: principalId, conversationId: task.id, runtimeGeneration: task.runtimeGeneration,
    capabilityGeneration: "a".repeat(64), applicationId, applicationUpdatedAt: application.updatedAt,
    applicationInstructions: "Previous instructions", inputText: "Pending request", submitMode: "normal",
  } });
  assert.equal((await start()).applicationVersionId, oldVersionId);
  await prisma.conversationTurnStartIntent.delete({ where: { projectionTurnId: intent.projectionTurnId } });

  await competingGate.start(principalId, applicationId, async () => { assert.equal((await start()).applicationVersionId, oldVersionId); });
  const entered = latch(), releaseUpdate = latch();
  const updating = competingGate.change(principalId, applicationId, async () => {
    entered.resolve();
    await releaseUpdate.promise;
  });
  await entered.promise;
  try {
    await assert.rejects(start(), { code: "APPLICATION_RUNTIME_UPDATING" });
    await applications.withRuntimeStart(creatorId, applicationId, async () => {});
  } finally { releaseUpdate.resolve(); await updating; }
  const release = await publications.readVersion(applicationId, newVersionId);
  const skillPath = join(capabilityRoot, release.capabilities[0]!.storagePath, "SKILL.md");
  const bytes = await readFile(skillPath);
  try {
    await writeFile(skillPath, "Invalid package content");
    await assert.rejects(start(), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    assert.equal((await applications.resolveRuntime(principalId, applicationId)).applicationVersionId, oldVersionId);
  } finally { await writeFile(skillPath, bytes); }

  const updated = await start();
  assert.equal(updated.applicationVersionId, newVersionId);
  assert.equal(updated.instructions, release.instructions);
  assert.equal(await readFile(join(capabilityRoot, updated.publishedCapabilities[0]!.storagePath, "SKILL.md"), "utf8"), bytes.toString());
  const selection = await prisma.applicationRuntimeInstallation.findUniqueOrThrow({ where: { ownerId_applicationId: { ownerId: principalId, applicationId } } });
  assert.equal(selection.channel, "external");
  assert.equal((await start()).applicationVersionId, newVersionId);
  assert.equal(await prisma.applicationRuntimeInstallation.count({ where: { ownerId: principalId, applicationId } }), 1);
  const retained = await prisma.conversation.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(retained.codexThreadId, task.codexThreadId);
  assert.equal(retained.workspaceRelPath, workspace);
  assert.equal(retained.applicationVersionId, oldVersionId); // Historical admission remains a record, not a selector.
  assert.equal(await readFile(workFile, "utf8"), "External user's work");
  assert.equal(await prisma.conversationTurn.count({ where: { conversationId: { in: tasks.map(item => item.id) } } }), 2);
  assert.equal((await applications.withRuntimeStart(recipientId, applicationId, () => applications.resolveRuntime(recipientId, applicationId))).applicationVersionId, oldVersionId);
  console.log("PASS external updates: busy tasks/intents retain old release; cross-instance update excludes new starts; idle continuation updates skills, preserves files/history, and leaves shared users unchanged");
}

function latch(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
