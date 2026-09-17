import JSZip from "jszip";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Fastify from "fastify";
import { createPrismaClient } from "../../src/db.js";
import { assertApplicationRuntimeCurrent } from "../../src/modules/applications/runtime-version.js";
import { ApplicationService } from "../../src/modules/applications/service.js";
import { ApplicationPublicationService } from "../../src/modules/applications/publication-service.js";
import { ApplicationInstallationService } from "../../src/modules/applications/installation-service.js";
import { ApplicationDistributionRepository } from "../../src/modules/applications/distribution-repository.js";
import { ApplicationCenterService } from "../../src/modules/applications/center-service.js";
import { applicationRoutes } from "../../src/modules/applications/routes.js";
import { applicationCenterRoutes, adminApplicationCenterRoutes } from "../../src/modules/applications/center-routes.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { AppError } from "../../src/lib/errors.js";
import { sendAppError } from "../../src/lib/http.js";
import type { ModelRuntimeSettingsReader } from "../../src/modules/system/model-provider-settings.js";
import type { RequestActor } from "../../src/modules/capabilities/types.js";

// Disposable PostgreSQL only. Never loads or migrates the application's .env database.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "linksense-application-distribution-"));
const name = `linksense-distribution-test-${randomUUID()}`;
const docker = async (...args: string[]): Promise<string> => (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let created = false;
let database: ReturnType<typeof createPrismaClient> | undefined;
const app = Fastify();
try {
  const password = randomUUID();
  await docker("run", "--detach", "--name", name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=distribution_test", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  created = true;
  const port = Number((await docker("port", name, "5432")).split(":").at(-1));
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", name, "pg_isready", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/distribution_test`;
  const migrations = join(repositoryRoot, "prisma/migrations"), historical = join(root, "migrations");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < "20260916030000_add_application_distribution") await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
  }
  const migrate = async (path: string): Promise<void> => {
    await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000, env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: path } });
  };
  await migrate(historical);
  database = createPrismaClient(databaseUrl);
  const db = database;
  const [publisher, recipient, admin, outsider] = await Promise.all(["publisher", "recipient", "admin", "outsider"].map(name => db.user.create({ data: { email: `${name}@example.test`, name, status: "active", role: name === "admin" ? "admin" : "user", selfRegisteredAt: name === "outsider" ? new Date() : null } })));
  assert(publisher && recipient && admin && outsider);
  const sourceId = randomUUID(), serviceOnlyId = randomUUID(), oldCopyId = randomUUID(), oldTaskId = randomUUID();
  for (const [id, ownerId, copy] of [[sourceId, publisher.id, true], [serviceOnlyId, publisher.id, false], [oldCopyId, recipient.id, false]] as const) {
    await db.$executeRaw`INSERT INTO applications (id,owner_id,name,instructions,allow_copy,updated_at) VALUES (${id}::uuid,${ownerId}::uuid,'Reports','Version one',${copy},CURRENT_TIMESTAMP)`;
  }
  for (const id of [sourceId, serviceOnlyId]) await db.$executeRaw`INSERT INTO application_grants(id,application_id,grantee_type,user_id,granted_by,updated_at) VALUES (${randomUUID()}::uuid,${id}::uuid,'user',${recipient.id}::uuid,${publisher.id}::uuid,CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO conversations(id,owner_id,title,title_source,archive_status,workspace_rel_path,runtime_generation,application_id,application_name_snapshot,updated_at) VALUES (${oldTaskId}::uuid,${recipient.id}::uuid,'Existing task','manual','active','historical/workspace',${randomUUID()}::uuid,${sourceId}::uuid,'Reports',CURRENT_TIMESTAMP)`;
  const historicalVersionId = randomUUID();
  const historicalDefinition = JSON.stringify({ schemaVersion: 1, name: "Reports", kind: "standard", instructions: "Existing shared service", usageInstructions: "Existing guide", model: null, reasoningEffort: null, interactivePackageId: null, capabilities: [], knowledgeBaseIds: [], mcpServerIds: [] });
  await db.$executeRaw`INSERT INTO application_versions(id,application_id,version_number,definition_json,assets_ready,created_by) VALUES (${historicalVersionId}::uuid,${oldCopyId}::uuid,7,${historicalDefinition}::jsonb,true,${recipient.id}::uuid)`;
  await db.$executeRaw`UPDATE applications SET published_version_id=${historicalVersionId}::uuid WHERE id=${oldCopyId}::uuid`;
  const beforeLabels = join(root, "before-labels");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < "20260916040000_add_application_version_labels") await cp(join(migrations, entry.name), join(beforeLabels, entry.name), { recursive: true });
  }
  await migrate(beforeLabels);
  const historicalListing = await db.applicationListing.create({ data: { applicationId: oldCopyId, publisherId: recipient.id, status: "published" } });
  const historicalRelease = await db.applicationRelease.create({ data: { listingId: historicalListing.id, applicationId: oldCopyId, versionId: historicalVersionId, name: "Existing listing", publisherName: recipient.name, usageModes: ["install", "service"], releaseNotes: "Existing approved release", status: "approved", reviewerId: admin.id } });
  await db.applicationListing.update({ where: { id: historicalListing.id }, data: { currentReleaseId: historicalRelease.id } });
  const historicalInstall = { id: randomUUID() };
  await db.$executeRaw`INSERT INTO applications(id,owner_id,name,instructions,updated_at) VALUES (${historicalInstall.id}::uuid,${admin.id}::uuid,'Existing installation','Existing shared service',CURRENT_TIMESTAMP)`;
  await db.applicationInstallation.create({ data: { applicationId: historicalInstall.id, ownerId: admin.id, sourceApplicationId: oldCopyId, channel: "center", installedVersionId: historicalVersionId, baselineJson: { name: "Reports", instructions: "Existing shared service", model: null, reasoningEffort: null, interactivePackageId: null, capabilities: [], requiredKnowledgeBases: 0, requiredMcpServers: 0 } } });
  await migrate(migrations);
  const historicalVersion = await db.applicationVersion.findUniqueOrThrow({ where: { id: historicalVersionId } });
  assert.equal(historicalVersion.versionLabel, "7.0.0");
  assert.equal(historicalVersion.versionNumber, 7);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: oldCopyId } })).publishedVersionId, historicalVersionId);
  assert.deepEqual((await db.application.findUniqueOrThrow({ where: { id: oldCopyId } })).interactiveDependencyBindings, []);
  assert.deepEqual((await db.applicationGrant.findFirstOrThrow({ where: { applicationId: sourceId } })).usageModes, ["install", "service"]);
  assert.deepEqual((await db.applicationGrant.findFirstOrThrow({ where: { applicationId: serviceOnlyId } })).usageModes, ["service"]);
  assert.equal(await db.application.count(), 4);
  assert.equal(await db.applicationInstallation.count(), 1);
  assert.equal(await db.applicationInstallation.count({ where: { applicationId: oldCopyId } }), 0);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: oldTaskId } })).applicationChannel, "direct");
  assert.equal((await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM information_schema.columns WHERE table_name='applications' AND column_name='allow_copy'`)[0]?.count, 0n);
  console.log("PASS upgrade: applications, old copies, tasks and grant permissions preserved; obsolete column removed.");

  const capabilityRoot = join(root, "capabilities");
  await mkdir(join(capabilityRoot, "author"), { recursive: true });
  await writeFile(join(capabilityRoot, "author", "SKILL.md"), "---\nname: reports\ndescription: Reports\n---\nVersion one");
  const capability = await db.capability.create({ data: { ownerId: publisher.id, installedBy: publisher.id, type: "skill", name: "reports", slug: "reports", sourceType: "local", storagePath: "author", status: "active" } });
  await db.applicationCapability.create({ data: { applicationId: sourceId, capabilityId: capability.id, capabilityNameSnapshot: capability.name, capabilityTypeSnapshot: capability.type, selectionOrder: 0 } });
  const assets = new Map<string, Buffer>();
  const assetStore = { put: async (key: string, value: Buffer) => { assets.set(key, value); }, get: async (key: string) => { const value = assets.get(key); if (!value) throw new Error("missing asset"); return Readable.from(value); }, remove: async (key: string) => { assets.delete(key); } };
  const publications = new ApplicationPublicationService(db, capabilityRoot, assetStore);
  const installations = new ApplicationInstallationService(db, capabilityRoot, publications);
  const models: ModelRuntimeSettingsReader = { resolveRuntime: async () => { throw new Error("not selected"); }, resolveRuntimeForSelection: async () => { throw new Error("not selected"); }, resolveModelTransitionRuntime: async () => { throw new Error("not selected"); } };
  const service = new ApplicationService(db, models, new AuditService(db), { resolveForCapability: async (userId, capabilityId) => ({ ok: true, environment: {}, usageReceipt: { userId, capabilityId, credentialIds: [] } }) }, undefined, assetStore, publications, installations);
  const center = new ApplicationCenterService(new ApplicationDistributionRepository(db), publications, new AuditService(db), service);
  const actor = (user: typeof publisher): RequestActor => ({ id: user.id, role: user.role === "admin" ? "admin" : "user", status: "active", registrationSource: user.selfRegisteredAt ? "self_registration" : "organization_invitation", ipAddress: "127.0.0.1" });
  const context = { ipAddress: "127.0.0.1" };
  await db.applicationGrant.create({ data: { applicationId: oldCopyId, granteeType: "user", userId: admin.id, grantedBy: recipient.id, usageModes: ["service"] } });
  assert.equal((await service.resolveRuntime(admin.id, oldCopyId)).instructions, "Existing shared service");
  assert.equal((await service.getPublication(actor(admin), oldCopyId)).version_number, "7.0.0");
  assert.equal((await service.resolveRuntime(admin.id, oldCopyId, undefined, "center")).applicationVersionId, historicalVersionId);
  assert.equal((await installations.previewUpdate(admin.id, historicalInstall.id)).update_available, false);
  assert.equal((await center.catalog(actor(publisher))).find(item => item.application_id === oldCopyId)?.version_number, "7.0.0");
  await db.application.update({ where: { id: oldCopyId }, data: { instructions: "Updated historical service" } });
  const historicalUpdate = await center.submit(actor(recipient), oldCopyId, { version_number: "7.0.0", usage_instructions: "Updated historical guide", usage_modes: ["install", "service"], release_notes: "Existing installation update" }, context);
  await center.review(actor(admin), historicalUpdate.id, { decision: "approved", comment: "" }, context);
  assert.equal((await installations.previewUpdate(admin.id, historicalInstall.id)).update_available, true);
  await installations.update(admin.id, historicalInstall.id, historicalUpdate.version_id);
  assert.equal((await service.resolveRuntime(admin.id, historicalInstall.id)).instructions, "Updated historical service");
  await center.setStatus(actor(recipient), oldCopyId, { status: "unlisted", reason: "" }, context);
  const historicalMine = await center.ownPublications(actor(recipient));
  assert.deepEqual(historicalMine.map(item => item.id), [historicalUpdate.id]);
  assert.equal(historicalMine[0]?.listing_status, "unlisted");
  assert.equal(historicalMine[0]?.version_number, "7.0.0");
  assert.equal((await center.ownPublications(actor(publisher))).length, 0);
  console.log("PASS version-label upgrade: existing shared services, approved listings and installations remain usable and support same-label manual updates.");
  const version1Input = { version_number: "1.0.0", usage_instructions: "Configure your own account when installing." };
  const version2Input = { version_number: "2.0.0", usage_instructions: "Version two guide" };
  const version1 = await service.share(actor(publisher), sourceId, { ...version1Input, target: null }, context);
  assert(version1.version_id);
  const installedId = await installations.install(recipient.id, sourceId, { name: "My reports", channel: "direct", version_id: version1.version_id });
  assert.equal((await service.resolveRuntime(recipient.id, installedId)).applicationOwnerId, recipient.id);
  assert.equal((await service.resolveRuntime(recipient.id, sourceId)).applicationOwnerId, publisher.id);
  assert.equal(await db.credentialBinding.count({ where: { userId: recipient.id } }), 0);
  const installedBinding = await db.applicationCapability.findFirstOrThrow({ where: { applicationId: installedId } });
  const installedCapability = await db.capability.findUniqueOrThrow({ where: { id: installedBinding.capabilityId } });
  assert.notEqual(installedCapability.id, capability.id);
  assert.equal(installedCapability.ownerId, recipient.id);
  // A recipient's credential binding must survive upgrades verbatim.
  const localCredential = await db.credentialBinding.create({ data: { capabilityId: installedCapability.id, userId: recipient.id, credentialId: randomUUID(), envKey: "REPORT_API_KEY", credentialKey: "key", status: "active", createdBy: recipient.id } });
  const directGrant = await db.applicationGrant.findFirstOrThrow({ where: { applicationId: sourceId, userId: recipient.id } });
  await service.updateGrantModes(actor(publisher), sourceId, directGrant.id, ["install"], context);
  await assert.rejects(service.resolveRuntime(recipient.id, sourceId), { code: "FORBIDDEN" });
  const group = await db.userGroup.create({ data: { name: "Research" } });
  await db.userGroupMember.create({ data: { userId: recipient.id, userGroupId: group.id, status: "active" } });
  const groupVersion = await service.share(actor(publisher), sourceId, { ...version1Input, target: { grantee_type: "user_group", user_group_id: group.id, usage_modes: ["service"] } }, context);
  assert.equal(groupVersion.version_id, version1.version_id);
  const groupGrant = await db.applicationGrant.findFirstOrThrow({ where: { applicationId: sourceId, userGroupId: group.id } });
  assert.equal((await service.resolveRuntime(recipient.id, sourceId)).applicationOwnerId, publisher.id);
  await service.revokeGrant(actor(publisher), sourceId, groupGrant.id, context);
  await assert.rejects(service.resolveRuntime(recipient.id, sourceId), { code: "FORBIDDEN" });
  console.log("PASS direct sharing: install/service independent, group unions enforced, installed resources owned by recipient.");

  const release1 = await center.submit(actor(publisher), sourceId, { ...version1Input, usage_modes: ["install", "service"], release_notes: "Initial release" }, context);
  assert.equal((await center.catalog(actor(recipient))).length, 0);
  const beforeRejectedSubmit = await db.applicationVersion.count({ where: { applicationId: sourceId } });
  await assert.rejects(center.submit(actor(publisher), sourceId, { ...version1Input, version_number: "1.1.0", usage_modes: ["service"], release_notes: "Duplicate pending request" }, context), { code: "CONFLICT" });
  await assert.rejects(service.share(actor(publisher), sourceId, { ...version1Input, version_number: "1.1.0", target: { grantee_type: "user", user_id: publisher.id, usage_modes: ["service"] } }, context), { code: "APPLICATION_GRANT_TARGET_INVALID" });
  assert.equal(await db.applicationVersion.count({ where: { applicationId: sourceId } }), beforeRejectedSubmit);
  assert.equal((await service.distributionSettings(actor(publisher), sourceId)).highest_version_number, "1.0.0");
  await assert.rejects(center.review(actor(recipient), release1.id, { decision: "approved", comment: "" }, context), { code: "FORBIDDEN" });
  await center.review(actor(admin), release1.id, { decision: "approved", comment: "" }, context);
  await assert.rejects(center.catalog(actor(outsider)), { code: "FORBIDDEN" });
  const centerInstalledId = await installations.install(recipient.id, sourceId, { name: "Center reports", channel: "center", version_id: version1.version_id });
  await db.application.update({ where: { id: sourceId }, data: { instructions: "Version two" } });
  await writeFile(join(capabilityRoot, "author", "SKILL.md"), "---\nname: reports\ndescription: Reports\n---\nVersion two");
  const version2 = await service.share(actor(publisher), sourceId, { ...version2Input, target: null }, context);
  assert(version2.version_id);
  assert.equal((await service.resolveRuntime(recipient.id, sourceId, undefined, "center")).applicationVersionId, version1.version_id);
  assert.equal((await service.resolveRuntime(publisher.id, sourceId, undefined, "center")).applicationVersionId, version1.version_id);
  assert.equal((await installations.previewUpdate(recipient.id, installedId)).update_available, true);
  assert.equal((await installations.previewUpdate(recipient.id, centerInstalledId)).update_available, false);
  assert.equal((await db.applicationInstallation.findUniqueOrThrow({ where: { applicationId: installedId } })).installedVersionId, version1.version_id);
  await db.application.update({ where: { id: installedId }, data: { instructions: "My own instructions" } });
  await installations.update(recipient.id, installedId, version2.version_id);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: installedId } })).instructions, "My own instructions");
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: installedId } })).name, "My reports");
  assert.equal(await readFile(join(capabilityRoot, installedCapability.storagePath, "SKILL.md"), "utf8"), await readFile(join(capabilityRoot, "author", "SKILL.md"), "utf8"));
  assert.deepEqual(await db.credentialBinding.findUnique({ where: { id: localCredential.id } }), localCredential);
  const release2 = await center.submit(actor(publisher), sourceId, { ...version2Input, usage_modes: ["install", "service"], release_notes: "Second release" }, context);
  const publisherMine = await center.ownPublications(actor(publisher));
  assert.deepEqual(publisherMine.map(item => item.id), [release2.id]);
  assert.equal(publisherMine[0]?.status, "pending");
  assert.equal(publisherMine[0]?.listing_status, "published");
  assert.deepEqual((await center.ownPublications(actor(recipient))).map(item => item.application_id), [oldCopyId]);
  await assert.rejects(center.ownPublications(actor(outsider)), { code: "FORBIDDEN" });
  console.log("PASS my publications: latest release per owned application, pending updates and historical unlisted records; other publishers excluded.");
  await center.review(actor(admin), release2.id, { decision: "approved", comment: "" }, context);
  assert.equal((await installations.previewUpdate(recipient.id, centerInstalledId)).update_available, true);
  await installations.update(recipient.id, centerInstalledId, version2.version_id);
  assert.equal((await service.resolveRuntime(recipient.id, centerInstalledId)).instructions, "Version two");
  await assert.rejects(installations.update(recipient.id, installedId, version1.version_id), { code: "CONFLICT" });
  assert((await service.distributionSummaries(actor(recipient))).some(item => item.application_id === installedId && item.installation?.installed_version_number === "2.0.0"));
  console.log("PASS versions: approval pins center service; updates are discovered without auto-install; manual update preserves local instructions, names and credential bindings.");

  const rowsBeforeLower = await db.applicationVersion.count({ where: { applicationId: sourceId } });
  await assert.rejects(center.submit(actor(publisher), sourceId, { ...version1Input, usage_modes: ["install", "service"], release_notes: "Older version" }, context), { code: "APPLICATION_VERSION_TOO_LOW" });
  await assert.rejects(service.share(actor(publisher), sourceId, { ...version1Input, target: null }, context), { code: "APPLICATION_VERSION_TOO_LOW" });
  assert.equal(await db.applicationVersion.count({ where: { applicationId: sourceId } }), rowsBeforeLower);
  assert.equal(await db.applicationRelease.count({ where: { applicationId: sourceId, status: "pending" } }), 0);
  await db.application.update({ where: { id: sourceId }, data: { instructions: "Same version revised content" } });
  const sameVersion = await service.share(actor(publisher), sourceId, { ...version2Input, target: null }, context);
  assert.equal(sameVersion.version_number, "2.0.0");
  assert.notEqual(sameVersion.version_id, version2.version_id);
  assert(sameVersion.version_id);
  assert.equal((await installations.previewUpdate(recipient.id, installedId)).update_available, true);
  assert.equal((await installations.previewUpdate(recipient.id, centerInstalledId)).update_available, false);
  assert.equal((await service.resolveRuntime(recipient.id, sourceId, undefined, "center")).applicationVersionId, version2.version_id);
  await installations.update(recipient.id, installedId, sameVersion.version_id);
  assert.equal((await installations.previewUpdate(recipient.id, installedId)).update_available, false);
  const sameRelease = await center.submit(actor(publisher), sourceId, { ...version2Input, usage_modes: ["install", "service"], release_notes: "Same version revised content" }, context);
  assert.equal(sameRelease.version_id, sameVersion.version_id);
  await center.review(actor(admin), sameRelease.id, { decision: "approved", comment: "" }, context);
  assert.equal((await installations.previewUpdate(recipient.id, centerInstalledId)).update_available, true);
  await installations.update(recipient.id, centerInstalledId, sameVersion.version_id);
  console.log("PASS semantic versions: lower labels rejected without writes; same-label content changes are immutable, discoverable and manually updated.");

  // Interactive applications are service-only; approved versions and tickets remain isolated.
  const archive = async (version: string, dependencyId?: string): Promise<Buffer> => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ schema_version: 1, id: "interactive-reports", name: "Interactive reports", version, sdk_version: 1, instructions: "Summarize reports", ...(dependencyId ? { dependencies: { skills: [{ id: dependencyId, name: "Reports skill" }] } } : {}) }));
    zip.file("index.html", "<main>Reports</main>");
    return zip.generateAsync({ type: "nodebuffer" });
  };
  const interactive = await service.importInteractive(actor(publisher), await archive("1.0.0"), context);
  await assert.rejects(center.submit(actor(publisher), interactive.id, { version_number: "1.0.0", usage_instructions: "Use the report form", usage_modes: ["install"], release_notes: "Invalid copy mode" }, context), { code: "VALIDATION_ERROR" });
  const interactiveRelease = await center.submit(actor(publisher), interactive.id, { version_number: "1.0.0", usage_instructions: "Use the report form", usage_modes: ["service"], release_notes: "Interactive release" }, context);
  const interactiveVersion1 = { version_id: interactiveRelease.version_id };
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: interactive.id } })).publishedVersionId, null);
  await assert.rejects(service.resolveRuntime(recipient.id, interactive.id, undefined, "center"), { code: "FORBIDDEN" });
  await center.review(actor(admin), interactiveRelease.id, { decision: "approved", comment: "" }, context);
  const approvedRuntime = await service.resolveRuntime(recipient.id, interactive.id, undefined, "center");
  await db.$transaction(tx => assertApplicationRuntimeCurrent(tx, recipient.id, approvedRuntime));
  await assert.rejects(installations.install(recipient.id, interactive.id, { name: "My interactive reports", channel: "center", version_id: interactiveVersion1.version_id }), { code: "FORBIDDEN" });
  assert.equal(approvedRuntime.applicationOwnerId, publisher.id);
  assert.equal(approvedRuntime.interactivePackageId, interactive.interactive_package?.id);
  const interactiveTask = await db.conversation.create({ data: { ownerId: recipient.id, title: "Interactive task", titleSource: "manual", archiveStatus: "active", workspaceRelPath: "test/interactive", runtimeGeneration: randomUUID(), applicationId: interactive.id, applicationNameSnapshot: interactive.name, applicationChannel: "center", interactiveApplicationPackageId: interactive.interactive_package?.id ?? null } });
  const ticket = await service.createInteractiveRuntimeTicket(actor(recipient), interactive.id, undefined, interactiveTask.id);
  assert.equal((await service.getInteractiveAssetForTicket(ticket.token, "index.html")).contentType, "text/html; charset=utf-8");
  await service.updateInteractivePackage(actor(publisher), interactive.id, await archive("2.0.0"), context);
  const interactiveRelease2 = await center.submit(actor(publisher), interactive.id, { version_number: "2.0.0", usage_instructions: "Updated form", usage_modes: ["service"], release_notes: "New form" }, context);
  const pendingPackage = (await db.application.findUniqueOrThrow({ where: { id: interactive.id } })).interactivePackageId;
  assert(pendingPackage);
  await assert.rejects(service.resolveInteractiveRuntimePackage(actor(recipient), interactive.id, pendingPackage, "center"), { code: "APPLICATION_NOT_FOUND" });
  assert.equal((await service.resolveRuntime(recipient.id, interactive.id, undefined, "center")).interactivePackageId, approvedRuntime.interactivePackageId);
  await center.review(actor(admin), interactiveRelease2.id, { decision: "approved", comment: "" }, context);
  assert.equal((await service.resolveRuntime(recipient.id, interactive.id, undefined, "center")).interactivePackageId, pendingPackage);
  await center.setStatus(actor(admin), interactive.id, { status: "suspended", reason: "Review" }, context);
  await assert.rejects(service.getInteractiveAssetForTicket(ticket.token, "index.html"), { code: "FORBIDDEN" });
  console.log("PASS interactive applications: service-only distribution, approved versions, package updates and ticket revocation.");

  const declarationId = randomUUID();
  const unresolved = await service.importInteractive(actor(publisher), await archive("1.0.0", declarationId), context);
  assert.equal(unresolved.dependencies_available, false);
  assert.equal(unresolved.capability_count, 1);
  assert.deepEqual((await db.application.findUniqueOrThrow({ where: { id: unresolved.id } })).interactiveDependencyBindings, [{ type: "skill", id: declarationId, resource_id: null }]);
  await assert.rejects(service.resolveRuntime(publisher.id, unresolved.id), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  const shareInput = { version_number: "1.0.0", usage_instructions: "Read-only review", target: { grantee_type: "user" as const, user_id: recipient.id, usage_modes: ["service" as const] } };
  await assert.rejects(service.share(actor(publisher), unresolved.id, shareInput, context), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  await service.updateInteractiveDependencies(actor(publisher), unresolved.id, [{ type: "skill", id: declarationId, resource_id: capability.id }], context);
  assert.deepEqual((await service.resolveRuntime(publisher.id, unresolved.id)).capabilityIds, [capability.id]);
  await service.share(actor(publisher), unresolved.id, shareInput, context);
  const publishedRuntime = await service.resolveRuntime(recipient.id, unresolved.id);
  assert.equal(publishedRuntime.applicationOwnerId, publisher.id);
  assert.deepEqual(publishedRuntime.capabilityIds, [capability.id]);
  await assert.rejects(service.updateInteractiveDependencies(actor(recipient), unresolved.id, [], context), { code: "APPLICATION_NOT_FOUND" });
  await service.updateInteractivePackage(actor(publisher), unresolved.id, await archive("1.1.0", declarationId), context);
  assert.equal((await service.interactiveDependencies(actor(publisher), unresolved.id)).items[0]?.resource_id, capability.id);
  await service.updateInteractivePackage(actor(publisher), unresolved.id, await archive("1.2.0", randomUUID()), context);
  assert.equal((await service.interactiveDependencies(actor(publisher), unresolved.id)).items[0]?.resource_id, null);
  assert.equal(await db.applicationCapability.count({ where: { applicationId: unresolved.id } }), 0);
  assert.deepEqual((await service.resolveRuntime(recipient.id, unresolved.id)).capabilityIds, [capability.id]);
  await assert.rejects(service.share(actor(publisher), unresolved.id, { ...shareInput, version_number: "1.2.0" }, context), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  console.log("PASS dependency lifecycle: unresolved import, later matching, owner-scoped runtime, preserved mappings and published snapshot isolation.");

  // Real route handlers and services against the migrated database.
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  const actors = new Map([publisher, recipient, admin, outsider].map(user => [user.id, actor(user)]));
  const resolveActor = async (request: import("fastify").FastifyRequest): Promise<RequestActor> => {
    const user = actors.get(String(request.headers["x-test-user"]));
    if (!user) throw new AppError("AUTH_REQUIRED");
    return user;
  };
  await app.register(applicationRoutes, { prefix: "/api/v1/applications", service, resolveActor, usageAnalytics: { applicationReport: async () => { throw new Error("not requested"); } }, createConversation: async (ownerId, application) => ({ id: (await db.conversation.create({ data: { ownerId, title: application.name, titleSource: "manual", archiveStatus: "active", workspaceRelPath: "test/workspace", runtimeGeneration: randomUUID(), applicationId: application.id, applicationNameSnapshot: application.name, applicationChannel: application.channel ?? "direct", interactiveApplicationPackageId: application.interactivePackageId } })).id }) });
  await app.register(applicationCenterRoutes, { prefix: "/api/v1/application-center", service: center, resolveActor });
  await app.register(adminApplicationCenterRoutes, { prefix: "/api/v1/admin/application-center", service: center, resolveActor });
  if (process.argv.includes("--serve")) app.get("/api/v1/test-context", async () => ({ success: true, data: { publisher: publisher.id, recipient: recipient.id, admin: admin.id, applicationId: sourceId, installedId: centerInstalledId } }));
  assert.equal((await app.inject("/api/v1/application-center")).statusCode, 401);
  const publisherHeaders = { "x-test-user": publisher.id };
  const settingsResponse = await app.inject({ url: `/api/v1/applications/${sourceId}/distribution/settings`, headers: publisherHeaders });
  assert.equal(settingsResponse.statusCode, 200, settingsResponse.body);
  assert.equal(settingsResponse.json().data.highest_version_number, "2.0.0");
  for (const suffix of ["publish", "grants"]) {
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/applications/${sourceId}/${suffix}`, headers: publisherHeaders, payload: {} })).statusCode, 404);
  }
  const sameNumberResponse = await app.inject({ method: "POST", url: `/api/v1/applications/${sourceId}/share`, headers: publisherHeaders, payload: { ...version2Input, target: null } });
  assert.equal(sameNumberResponse.statusCode, 200, sameNumberResponse.body);
  assert.equal(sameNumberResponse.json().data.version_id, sameVersion.version_id);
  for (const [url, payload] of [
    [`/api/v1/applications/${sourceId}/share`, { ...version1Input, target: null }],
    [`/api/v1/application-center/${sourceId}/submissions`, { ...version1Input, usage_modes: ["service"], release_notes: "Lower version" }],
  ] as const) {
    const rejected = await app.inject({ method: "POST", url, headers: publisherHeaders, payload });
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal(rejected.json().error_code, "APPLICATION_VERSION_TOO_LOW");
  }
  const headers = { "x-test-user": recipient.id };
  const launch = await app.inject({ method: "POST", url: `/api/v1/applications/${sourceId}/conversations`, headers, payload: { channel: "center" } });
  assert.equal(launch.statusCode, 201, launch.body);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: launch.json().data.conversation_id } })).applicationChannel, "center");
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/applications/${sourceId}/conversations`, headers, payload: { channel: "direct" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/applications/${sourceId}/install`, headers, payload: { name: "Bad", channel: "center", version_id: version2.version_id, credentials: {} } })).statusCode, 400);
  await center.setStatus(actor(admin), sourceId, { status: "suspended", reason: "Review required" }, context);
  await assert.rejects(service.resolveRuntime(recipient.id, sourceId, undefined, "center"), { code: "FORBIDDEN" });
  await assert.rejects(center.setStatus(actor(publisher), sourceId, { status: "published", reason: "" }, context), { code: "FORBIDDEN" });
  assert.equal((await center.catalog(actor(recipient))).length, 0);
  await service.revokeGrant(actor(publisher), sourceId, directGrant.id, context);
  assert.equal((await installations.previewUpdate(recipient.id, installedId)).latest_version_id, null);
  assert.equal((await service.resolveRuntime(recipient.id, installedId)).applicationOwnerId, recipient.id);
  await service.delete(actor(recipient), installedId, context);
  assert.equal(await db.applicationInstallation.count({ where: { applicationId: installedId } }), 0);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: oldCopyId } })).status, "active");
  assert.equal(await db.conversation.count({ where: { id: oldTaskId } }), 1);
  console.log("PASS API and revocation: authentication, validation, channel persistence, suspension, revocation and independent copies/history verified.");
  if (process.argv.includes("--serve")) {
    await center.setStatus(actor(admin), sourceId, { status: "published", reason: "" }, context);
    await db.application.update({ where: { id: sourceId }, data: { instructions: "Version three" } });
    const next = await service.share(actor(publisher), sourceId, { version_number: "3.0.0", usage_instructions: "填写报告主题，即可生成摘要。安装后可以使用自己的配置。", target: { grantee_type: "user", user_id: recipient.id, usage_modes: ["install", "service"] } }, context);
    assert(next.version_id);
    await center.submit(actor(publisher), sourceId, { version_number: "3.0.0", usage_instructions: "填写报告主题，即可生成摘要。安装后可以使用自己的配置。", usage_modes: ["install", "service"], release_notes: "改进报告格式和引用。" }, context);
    const url = await app.listen({ host: "127.0.0.1", port: 18400 });
    console.log("Browser verification API ready at " + url);
    await new Promise<void>(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }

} finally {
  await app.close();
  await database?.$disconnect();
  if (created) await docker("rm", "--force", name);
  await rm(root, { recursive: true, force: true });
}
