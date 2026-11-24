import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ApplicationDistributionRepository } from "../../src/modules/applications/distribution-repository.js";
import type { PublishedApplicationDefinition } from "../../src/modules/applications/published-definition.js";
import { assertOwnedMcpServersExist } from "../../src/modules/mcp/dependency-lock.js";
import { PrismaMcpServerRepository } from "../../src/modules/mcp/repository.js";

export async function runMcpDeletionScenarios(db: PrismaClient): Promise<void> {
  const repository = new PrismaMcpServerRepository(db);
  const [owner, sharedUser, catalogUser] = await Promise.all(
    ["mcp-owner", "mcp-shared-user", "mcp-catalog-user"].map((name) =>
      db.user.create({ data: { name, email: `${name}@example.test`, role: "user", status: "active" } }),
    ),
  );
  assert(owner && sharedUser && catalogUser);
  const createMcp = (status: "active" | "disabled") => db.mcpServer.create({ data: {
    ownerId: owner.id, name: "Search", serverKey: `user_${randomUUID().replaceAll("-", "")}`,
    url: "https://mcp.example.test/mcp", authType: "none", status,
  } });
  const server = await createMcp("disabled");
  const createApp = (name: string, opts: {
    kind?: "standard" | "interactive" | "public_knowledge";
    status?: "active" | "disabled" | "deleted";
    developmentOnly?: boolean;
  } = {}) => db.application.create({
    data: {
      ownerId: owner.id, name, instructions: "Test fixture", ...opts,
      ...(opts.kind === "interactive" ? { interactivePackageId: randomUUID() } : {}),
      ...(opts.status === "deleted" ? { deletedAt: new Date(), deletedBy: owner.id } : {}),
    },
  });
  const [report, disabled, preview, draft, orphan, deleted, qa, installOnly] = await Promise.all([
    createApp("Report", { kind: "interactive" }),
    createApp("Disabled app", { status: "disabled" }),
    createApp("Internal report preview", { kind: "interactive", developmentOnly: true }),
    createApp("Internal standalone preview", { kind: "interactive", developmentOnly: true }),
    createApp("Internal orphan preview", { kind: "interactive", developmentOnly: true }),
    createApp("Deleted app", { status: "deleted" }),
    createApp("Knowledge Q&A", { kind: "public_knowledge" }),
    createApp("Install-only app"),
  ]);
  const standalone = await db.applicationDevelopment.create({ data: {
    ownerId: owner.id, name: "Standalone draft", workspaceRelPath: "test", directory: "standalone",
    previewApplicationId: draft.id,
  } });
  await db.applicationDevelopment.create({ data: {
    ownerId: owner.id, name: "Report draft", workspaceRelPath: "test", directory: "report",
    applicationId: report.id, previewApplicationId: preview.id,
  } });
  const binding = (applicationId: string, mcpServerId: string) => ({
    applicationId, mcpServerId, mcpServerNameSnapshot: "Search", selectionOrder: 0,
  });
  await db.applicationMcpServer.createMany({
    data: [disabled, preview, draft, orphan, deleted].map(({ id }) => binding(id, server.id)),
  });
  const saveVersion = (app: { id: string; name: string; interactivePackageId: string | null }, kind: PublishedApplicationDefinition["kind"],
    versionNumber: number, mcpServerIds: string[]) => db.applicationVersion.create({ data: {
    applicationId: app.id, versionNumber, versionLabel: `${versionNumber}.0.0`, assetsReady: true,
    createdBy: owner.id, definitionJson: {
      schemaVersion: 1, kind, name: app.name, description: null, instructions: "Test fixture",
      usageInstructions: "", iconPreset: "bot", iconObjectKey: null, model: null,
      reasoningEffort: null, interactivePackageId: app.interactivePackageId, capabilities: [], knowledgeBaseIds: [], mcpServerIds,
    } satisfies PublishedApplicationDefinition,
  } });
  const [oldVersion, newVersion, qaVersion, installVersion] = await Promise.all([
    saveVersion(report, "interactive", 1, [server.id]),
    saveVersion(report, "interactive", 2, []),
    saveVersion(qa, "public_knowledge", 1, []),
    saveVersion(installOnly, "standard", 1, [server.id]),
  ]);
  await db.application.update({ where: { id: qa.id }, data: { publishedVersionId: qaVersion.id } });
  await db.application.update({ where: { id: installOnly.id }, data: { publishedVersionId: installVersion.id } });
  await db.application.update({ where: { id: report.id }, data: { publishedVersionId: oldVersion.id } });
  const group = await db.userGroup.create({ data: { name: "MCP deletion test group" } });
  await db.userGroupMember.create({ data: { userGroupId: group.id, userId: sharedUser.id, status: "active" } });
  await db.applicationGrant.createMany({ data: [
    { applicationId: report.id, granteeType: "user_group", userGroupId: group.id, usageModes: ["service"], grantedBy: owner.id },
    { applicationId: installOnly.id, granteeType: "user", userId: catalogUser.id, usageModes: ["install"], grantedBy: owner.id },
  ] });
  const listing = await db.applicationListing.create({ data: {
    applicationId: report.id, publisherId: owner.id, status: "published",
  } });
  const createRelease = (versionId: string) => db.applicationRelease.create({ data: {
    listingId: listing.id, applicationId: report.id, versionId, name: report.name, publisherName: owner.name,
    usageModes: ["service"], releaseNotes: "Test release", status: "approved",
  } });
  const [oldRelease, newRelease] = await Promise.all([createRelease(oldVersion.id), createRelease(newVersion.id)]);
  await db.applicationListing.update({ where: { id: listing.id }, data: { currentReleaseId: oldRelease.id } });
  // Every installation starts at the version with the original dependency.
  await db.applicationRuntimeInstallation.createMany({ data: [
    { applicationId: report.id, ownerId: owner.id, versionId: oldVersion.id, channel: "direct" },
    { applicationId: report.id, ownerId: sharedUser.id, versionId: oldVersion.id, channel: "direct" },
    { applicationId: report.id, ownerId: catalogUser.id, versionId: oldVersion.id, channel: "center" },
  ] });

  assert.deepEqual(await repository.deleteOwned(sharedUser.id, server.id), { status: "not_found" });
  assert.deepEqual(await repository.deleteOwned(owner.id, server.id), {
    status: "in_use",
    usages: [
      { application_id: disabled.id, name: disabled.name, kind: "standard", locations: ["application"] },
      { application_id: report.id, name: report.name, kind: "interactive",
        locations: ["application", "center", "center_installation", "draft", "shared", "shared_installation"] },
      { application_id: standalone.id, name: standalone.name, kind: "interactive", locations: ["draft"] },
    ],
  });

  await db.applicationMcpServer.deleteMany({ where: { applicationId: { in: [disabled.id, preview.id, draft.id] } } });
  await db.applicationRuntimeInstallation.update({
    where: { ownerId_applicationId: { applicationId: report.id, ownerId: owner.id } },
    data: { versionId: newVersion.id },
  });
  await db.application.update({ where: { id: report.id }, data: { publishedVersionId: newVersion.id } });
  await db.applicationListing.update({ where: { id: listing.id }, data: { currentReleaseId: newRelease.id } });
  assert.deepEqual(await repository.deleteOwned(owner.id, server.id), {
    status: "in_use",
    usages: [{ application_id: report.id, name: report.name, kind: "interactive",
      locations: ["center_installation", "shared_installation"] }],
  });

  await db.userGroupMember.updateMany({
    where: { userGroupId: group.id },
    data: { status: "revoked", revokedAt: new Date(), revokedBy: owner.id },
  });
  assert.deepEqual(await repository.deleteOwned(owner.id, server.id), {
    status: "in_use",
    usages: [{ application_id: report.id, name: report.name, kind: "interactive", locations: ["center_installation"] }],
  });
  await db.applicationListing.update({ where: { id: listing.id }, data: { status: "unlisted", currentReleaseId: oldRelease.id } });
  assert.equal((await repository.deleteOwned(owner.id, server.id)).status, "deleted");
  assert.equal(await repository.findOwned(owner.id, server.id), null);
  await assert.rejects(
    new ApplicationDistributionRepository(db).setStatus(owner.id, false, report.id, "published", ""),
    { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" },
  );
  assert.equal((await db.applicationListing.findUniqueOrThrow({ where: { id: listing.id } })).status, "unlisted");
  console.log("PASS MCP deletion: visible apps, drafts, active releases, authorized installations and retired versions.");

  const concurrent = await createMcp("active");
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.mcpServer.findUniqueOrThrow({ where: { id: concurrent.id } });
    assert.equal((await repository.deleteOwned(owner.id, concurrent.id)).status, "deleted");
    await assertOwnedMcpServersExist(tx, owner.id, [concurrent.id]);
    await tx.applicationMcpServer.create({ data: binding(disabled.id, concurrent.id) });
  }), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  assert.equal(await db.applicationMcpServer.count({ where: { mcpServerId: concurrent.id } }), 0);

  const bindingWins = await createMcp("active");
  await db.$transaction(async (tx) => {
    await assertOwnedMcpServersExist(tx, owner.id, [bindingWins.id]);
    await assert.rejects(
      db.$queryRaw`SELECT id FROM mcp_servers WHERE id = ${bindingWins.id}::uuid FOR UPDATE NOWAIT`,
      /could not obtain lock/u,
    );
    await tx.applicationMcpServer.create({ data: binding(disabled.id, bindingWins.id) });
  });
  assert.equal((await repository.deleteOwned(owner.id, bindingWins.id)).status, "in_use");
  console.log("PASS MCP deletion races: concurrent binding and deletion serialize on the server row.");
}
