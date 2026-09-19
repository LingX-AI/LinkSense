import { applicationRuntimeFixture } from "./application-runtime-fixture.js";
import { ApplicationPublicationService } from "../../src/modules/applications/publication-service.js";
import { convertApplicationInstallations } from "../../src/operations/application-installation-conversion.js";
import { applicationAnnotationInputSchema, applicationDevelopmentSchema, type ApplicationDevelopment, type ApplicationVersionInput } from "@linksense/shared";
import Fastify from "fastify";
import { sendAppError } from "../../src/lib/http.js";
import { applicationDevelopmentRoutes } from "../../src/modules/applications/development-routes.js";
import { prepareApplicationAnnotation } from "../../src/modules/conversations/application-annotation.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPrismaClient } from "../../src/db.js";
import { projectWorkspaceRelativePath } from "../../src/lib/user-runtime-paths.js";
import { ApplicationService } from "../../src/modules/applications/service.js";
import { ApplicationDevelopmentService, type ApplicationDevelopmentServiceOptions } from "../../src/modules/applications/development-service.js";
import { ApplicationDevelopmentRepository } from "../../src/modules/applications/development-repository.js";
import { applicationDevelopmentTemplate } from "../../src/modules/applications/development-template.js";
import { deleteConversationWithinTransaction } from "../../src/modules/conversations/deletion.js";
import { lockDevelopmentPreview, reuseUnusedDevelopmentPreview, assertCurrentDevelopmentPreview, assertNotDevelopmentPreview } from "../../src/modules/applications/development-preview-lifecycle.js";
import { recoverDetachedDevelopmentTests } from "../../src/modules/applications/development-recovery.js";
import { deleteApplicationDevelopment } from "../../src/modules/applications/development-deletion.js";
import { ordinaryConversationFilter } from "../../src/modules/conversations/application-development-role.js";
import { lockDetachedDevelopment } from "../../src/modules/applications/development-conversation-lifecycle.js";
import { assertProjectTasksIdle, assertProjectHasNoApplicationSources } from "../../src/modules/projects/runtime-state.js";
import { readConversationDevelopmentRoles } from "../../src/modules/conversations/application-development-role.js";
import { AuditService } from "../../src/modules/audit/service.js";
import type { ModelRuntimeSettingsReader } from "../../src/modules/system/model-provider-settings.js";
import { interactiveDependenciesSchema } from "@linksense/shared";

// Uses a disposable database only, including upgrade fixtures. Never loads application .env.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "linksense-development-integration-"));
const name = `linksense-development-test-${randomUUID()}`;
const docker = async (...args: string[]) => (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let created = false;
let database: ReturnType<typeof createPrismaClient> | undefined;
const publicationApi = Fastify();
try {
  const password = randomUUID();
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "--detach", "--name", name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=development_test", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine"); created = true;
  const port = Number((await docker("port", name, "5432")).split(":").at(-1));
  for (let n = 0; ; n++) { try { await docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; } catch (error) { if (n >= 50) throw error; await delay(100); } }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/development_test`;
  const migrations = join(repositoryRoot, "prisma/migrations"), historical = join(root, "migrations");
  for (const entry of await readdir(migrations, { withFileTypes: true })) if (!entry.isDirectory() || entry.name < "20260917210000_add_application_development") await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
  const migrate = async (path: string) => { await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000, env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: path } }); };
  await migrate(historical);
  database = createPrismaClient(databaseUrl); const db = database;
  const user = await db.user.create({ data: { email: "builder@example.test", name: "Builder", status: "active", role: "user" } });
  const legacyId = randomUUID(), legacyPackageId = randomUUID();
  const files = applicationDevelopmentTemplate("Existing application", "existing", "en-US");
  const manifest: unknown = JSON.parse(files["manifest.json"]!);
  await db.$executeRaw`INSERT INTO applications (id,owner_id,name,kind,instructions,interactive_package_id,updated_at) VALUES (${legacyId}::uuid,${user.id}::uuid,'Existing application','interactive','Existing instructions',${legacyPackageId}::uuid,CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO interactive_application_packages (id,application_id,version,manifest_json,archive_sha256,file_count,expanded_bytes,created_by) VALUES (${legacyPackageId}::uuid,${legacyId}::uuid,'1.0.0',${JSON.stringify(manifest)}::jsonb,${"a".repeat(64)},4,1000,${user.id}::uuid)`;
  const objects = new Map<string, Buffer>();
  for (const [path, content] of Object.entries(files)) {
    const bytes = Buffer.from(content), objectKey = `legacy/${path}`; objects.set(objectKey, bytes);
    await db.interactiveApplicationAsset.create({ data: { packageId: legacyPackageId, path, objectKey, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: path.endsWith("html") ? "text/html; charset=utf-8" : "application/octet-stream" } });
  }
  // Upgrade an actual pre-change development row, including its source files.
  await cp(join(migrations, "20260917210000_add_application_development"), join(historical, "20260917210000_add_application_development"), { recursive: true });
  await migrate(historical);
  const workspaceRelPath = `${user.id}/home/workspace`;
  const existingDevelopmentId = randomUUID();
  const existingProject = await db.project.create({ data: { ownerId: user.id, name: "Historical development sources" } });
  const existingSourceWorkspace = projectWorkspaceRelativePath(user.id, existingProject.id);
  const existingConversation = await db.conversation.create({ data: { ownerId: user.id, projectId: existingProject.id, workspaceRelPath: existingSourceWorkspace, runtimeGeneration: randomUUID(), title: "Developed application", titleSource: "manual", archiveStatus: "active" } });
  await db.$executeRaw`INSERT INTO application_developments (id, owner_id, conversation_id, name, directory, updated_at)
    VALUES (${existingDevelopmentId}::uuid, ${user.id}::uuid, ${existingConversation.id}::uuid, 'Developed application', ${"applications/" + existingDevelopmentId}, CURRENT_TIMESTAMP)`;
  const existingDirectory = join(root, existingSourceWorkspace, "applications", existingDevelopmentId);
  await mkdir(existingDirectory, { recursive: true });
  for (const [path, value] of Object.entries(applicationDevelopmentTemplate("Developed application", existingDevelopmentId, "zh-CN"))) await writeFile(join(existingDirectory, path), value);
  await migrate(migrations);
  const upgradedDevelopment = await db.applicationDevelopment.findUniqueOrThrow({ where: { id: existingDevelopmentId } });
  assert.equal(upgradedDevelopment.workspaceRelPath, existingSourceWorkspace);
  assert.equal(upgradedDevelopment.projectId, existingProject.id);
  assert.equal(upgradedDevelopment.conversationId, existingConversation.id);
  const legacy = await db.application.findUniqueOrThrow({ where: { id: legacyId } });
  assert.equal(legacy.developmentOnly, false); assert.equal(legacy.interactivePackageId, legacyPackageId); assert.equal(legacy.instructions, "Existing instructions");
  assert.equal(await db.application.count(), 1);
  const assets = { put: async (key: string, value: Buffer) => { objects.set(key, value); }, get: async (key: string) => { const data = objects.get(key); if (!data) throw new Error("missing fixture asset"); return Readable.from([data]); }, remove: async (key: string) => { objects.delete(key); } };
  const models: ModelRuntimeSettingsReader = { resolveRuntime: async () => { throw new Error("not selected"); }, resolveRuntimeForSelection: async () => { throw new Error("not selected"); }, resolveModelTransitionRuntime: async () => { throw new Error("not selected"); } };
  const icons = { put: assets.put, remove: assets.remove, presignGet: async (key: string) => `https://icons.example.test/${encodeURIComponent(key)}` };
  const publications = new ApplicationPublicationService(db, join(root, "capabilities"), assets);
  const { selections } = applicationRuntimeFixture(db, publications);
  await convertApplicationInstallations({ prisma: db, capabilityRoot: join(root, "capabilities"), apply: true });
  const applications = new ApplicationService(db, models, new AuditService(db), { resolveForCapability: async (userId, capabilityId) => ({ ok: true, environment: {}, usageReceipt: { userId, capabilityId, credentialIds: [] } }) }, icons, assets, publications, undefined, selections);
  const actor = { id: user.id, role: "user" as const, status: "active" as const };
  assert.equal((await applications.resolveRuntime(user.id, legacyId)).interactivePackageId, legacyPackageId);
  assert.deepEqual((await applications.list(actor, { scope: "owned", limit: 200 })).map(item => item.id), [legacyId]);
  const legacyCatalog = await applications.catalog(actor, { state: "all", limit: 100 });
  assert.equal(legacyCatalog.items.length, 2);
  assert.equal(legacyCatalog.items.find(item => item.type === "application")?.development, null);
  console.log("PASS additive upgrade: existing application, files, execution and listing preserved.");
  await mkdir(join(root, workspaceRelPath), { recursive: true });
  const createApplicationTask = async (_owner: string, app: { id: string; name: string; interactivePackageId?: string | null }) => db.conversation.create({ data: { ownerId: user.id, workspaceRelPath, runtimeGeneration: randomUUID(), title: app.name, titleSource: "manual", archiveStatus: "active", applicationId: app.id, applicationNameSnapshot: app.name, interactiveApplicationPackageId: app.interactivePackageId ?? null } });
  const conversations = {
    createDevelopmentConversation: async (owner: string, expected: { id: string; workspaceRelPath: string; projectId: string | null }) => db.$transaction(async tx => {
      await lockDetachedDevelopment(tx, owner, expected);
      const conversation = await tx.conversation.create({ data: { ownerId: owner, workspaceRelPath: expected.workspaceRelPath, projectId: expected.projectId, runtimeGeneration: randomUUID(), title: "Development", titleSource: "manual", archiveStatus: "active" } });
      await tx.applicationDevelopment.update({ where: { id: expected.id }, data: { conversationId: conversation.id } });
      return conversation;
    }),
    create: async () => db.conversation.create({ data: { ownerId: user.id, workspaceRelPath, runtimeGeneration: randomUUID(), title: "Development", titleSource: "manual", archiveStatus: "active" } }),
    createDevelopmentPreview: async (owner: string, app: { id: string; name: string; interactivePackageId: string | null }, expected: { id: string; revision: number; previousConversationId: string | null }) => db.$transaction(async tx => {
      const reused = await reuseUnusedDevelopmentPreview(tx, owner, app, expected);
      if (reused) return reused;
      await lockDevelopmentPreview(tx, owner, app.id, app.interactivePackageId, expected);
      const session = await tx.conversation.create({ data: { ownerId: owner, workspaceRelPath: `${owner}/services/${app.id}/home/workspace`, runtimeGeneration: randomUUID(), title: app.name, titleSource: "manual", archiveStatus: "active", applicationId: app.id, applicationNameSnapshot: app.name, interactiveApplicationPackageId: app.interactivePackageId } });
      await tx.applicationDevelopment.update({ where: { id: expected.id }, data: { previewConversationId: session.id } });
      if (expected.previousConversationId) await tx.conversation.update({ where: { id: expected.previousConversationId }, data: { archiveStatus: "archived", archivedAt: new Date() } });
      return session;
    }),
    delete: async (owner: string, id: string) => db.$transaction(tx => deleteConversationWithinTransaction(tx, owner, id, {})),
    patch: async (_owner: string, id: string, data: { title?: string; archiveStatus?: string }) => db.conversation.update({ where: { id }, data: { ...data, ...(data.archiveStatus ? { archivedAt: data.archiveStatus === "archived" ? new Date() : null } : {}) } }),
  } as unknown as ApplicationDevelopmentServiceOptions["conversations"];
  const store = new ApplicationDevelopmentRepository(db);
  const service = new ApplicationDevelopmentService({ store, applications, conversations, assets, workspaceRoot: root });
  // Only authentication is substituted; HTTP parsing, publication and persistence are real.
  publicationApi.decorate("authenticate", async () => {});
  publicationApi.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await publicationApi.register(applicationDevelopmentRoutes, { prefix: "/api/v1/application-developments", service, resolveActor: async () => actor });
  const publishThroughHttp = async (id: string, sourceHash: string, release: ApplicationVersionInput): Promise<ApplicationDevelopment> => {
    const response = await publicationApi.inject({ method: "POST", url: `/api/v1/application-developments/${id}/install`, payload: { source_hash: sourceHash, ...release } });
    assert.equal(response.statusCode, 200, response.body);
    const result = applicationDevelopmentSchema.parse(response.json().data);
    assert(result.application_id);
    const installation = await db.applicationRuntimeInstallation.findFirstOrThrow({ where: { ownerId: user.id, applicationId: result.application_id } });
    const version = await db.applicationVersion.findUniqueOrThrow({ where: { id: installation.versionId } });
    assert.equal(version.versionLabel, release.version_number);
    assert.equal(version.purpose, "release");
    assert.equal(publications.parseDefinition(version.definitionJson).usageInstructions, release.usage_instructions);
    assert.equal(result.installed_source_hash, sourceHash);
    return result;
  };
  const first = await service.sync(actor, existingDevelopmentId, "zh-CN");
  assert(first.conversation_id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: first.conversation_id } })).title, "开发 Developed application");
  // A pre-change task keeps its identity and preview when its title is synchronized.
  await db.conversation.update({ where: { id: first.conversation_id }, data: { title: "Developed application" } });
  const renamedDevelopment = await service.sync(actor, first.id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: first.conversation_id } })).title, "开发 Developed application");
  assert.equal(renamedDevelopment.preview_conversation_id, first.preview_conversation_id);
  assert.equal(renamedDevelopment.revision, first.revision);
  assert(first.preview_current && first.source_hash && first.preview_application_id && first.preview_conversation_id);
  assert.notEqual(first.conversation_id, first.preview_conversation_id);
  const annotationPreview = await db.application.findUniqueOrThrow({ where: { id: first.preview_application_id } });
  const annotation = applicationAnnotationInputSchema.parse({ kind: "application_annotation", development_id: first.id, package_id: annotationPreview.interactivePackageId, source_hash: first.source_hash, page_path: "index.html", annotations: [{ request: "Change the button color", elements: [{ selector: "button", dom_path: [0], tag_name: "button", class_names: [], attributes: {}, bounds: { x: 0, y: 0, width: 100, height: 30 } }] }] });
  const annotationTasksBefore = await db.conversation.count({ where: { ownerId: user.id } });
  const preparedAnnotation = await prepareApplicationAnnotation(db, root, first.conversation_id, annotation, "b".repeat(64));
  assert.equal(preparedAnnotation.display.kind, "application_annotation");
  assert.equal(preparedAnnotation.display.application_name, first.name);
  assert.equal(await db.conversation.count({ where: { ownerId: user.id } }), annotationTasksBefore);
  await assert.rejects(prepareApplicationAnnotation(db, root, first.preview_conversation_id, annotation, "b".repeat(64)), { code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  await assert.rejects(prepareApplicationAnnotation(db, root, randomUUID(), annotation, "b".repeat(64)), { code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  await assert.rejects(prepareApplicationAnnotation(db, root, first.conversation_id, { ...annotation, source_hash: "c".repeat(64) }, "b".repeat(64)), { code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });

  const draftCatalog = await applications.catalog(actor, { state: "all", limit: 100 });
  assert.equal(draftCatalog.items.length, 2);
  assert.equal(draftCatalog.items.filter(item => item.type === "development").length, 1);
  assert.equal((await applications.catalog(actor, { state: "developing", search: "DEVELOPED", limit: 100 })).items[0]?.development?.id, first.id);
  assert.equal((await applications.catalog(actor, { state: "all", search: "%", limit: 100 })).items.length, 0);
  const pageOne = await applications.catalog(actor, { state: "all", limit: 1 });
  assert(pageOne.next_cursor);
  const pageTwo = await applications.catalog(actor, { state: "all", limit: 1, cursor: pageOne.next_cursor });
  assert.equal(pageOne.items[0]?.type, "development");
  assert.equal(pageTwo.items[0]?.type, "application");
  assert.equal(pageTwo.next_cursor, null);
  await assert.rejects(applications.catalog({ ...actor, status: "disabled" }, { state: "all", limit: 100 }), { code: "USER_DISABLED" });
  assert.equal((await applications.catalog({ ...actor, id: randomUUID() }, { state: "all", limit: 100 })).items.length, 0);
  const preparingConversation = await conversations.create(user.id, { collaborationMode: "default", fallbackLocale: "zh-CN" });
  const preparing = await db.applicationDevelopment.create({ data: { ownerId: user.id, conversationId: preparingConversation.id, workspaceRelPath, name: "准备中的草稿 100%", directory: "applications/preparing" } });
  const preparingCatalog = await applications.catalog(actor, { state: "developing", search: "100%", limit: 100 });
  assert.equal(preparingCatalog.items[0]?.type, "development");
  assert.equal(preparingCatalog.items[0]?.development?.id, preparing.id);
  await conversations.delete(user.id, preparingConversation.id, {});
  const detachedPreparing = await applications.catalog(actor, { state: "all", search: "100%", limit: 100 });
  assert.equal(detachedPreparing.items.length, 1);
  assert.equal(detachedPreparing.items[0]?.development?.conversation_id, null);
  await service.delete(actor, preparing.id);
  assert.equal((await applications.catalog(actor, { state: "all", search: "100%", limit: 100 })).items.length, 0);
  await assert.rejects(db.$transaction(tx => assertProjectTasksIdle(tx, [existingConversation.id])), { code: "APPLICATION_DEVELOPMENT_WORKSPACE_BOUND" });
  assert.equal((await applications.list(actor, { scope: "owned", limit: 200 })).length, 1);
  await assert.rejects(applications.captureDistributionVersion(actor, first.preview_application_id, { version_number: "1.0.0", usage_instructions: "" }, async () => {}), { code: "FORBIDDEN" });
  const ticket = await applications.createInteractiveRuntimeTicket(actor, first.preview_application_id, undefined, first.preview_conversation_id);
  const previewAsset = await applications.getInteractiveAssetForTicket(ticket.token, "index.html");
  assert((await buffer(previewAsset.data)).toString().includes("linksense:development"));
  const installed = await publishThroughHttp(first.id, first.source_hash, { version_number: "1.0.0", usage_instructions: "" }); assert(installed.application_id);
  const installedCatalog = await applications.catalog(actor, { state: "all", limit: 100 });
  assert.equal(installedCatalog.items.length, 2);
  assert(installedCatalog.items.every(item => item.type === "application"));
  assert.equal(installedCatalog.items.find(item => item.development?.id === first.id)?.development?.has_changes, false);
  assert.equal((await applications.catalog(actor, { state: "developing", limit: 100 })).items.length, 0);
  const installedPackage = (await db.application.findUniqueOrThrow({ where: { id: installed.application_id } })).interactivePackageId;
  const sourceFile = join(root, existingSourceWorkspace, first.directory, "app.js");
  await writeFile(sourceFile, "document.title='Updated application'");
  await assert.rejects(service.install(actor, first.id, "b".repeat(64), { version_number: "1.0.0", usage_instructions: "" }), { code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });
  const synchronized = await Promise.allSettled([service.sync(actor, first.id), service.sync(actor, first.id)]);
  for (const result of synchronized) { if (result.status === "rejected") throw result.reason; }
  const next = await service.sync(actor, first.id); assert(next.source_hash);
  assert.equal(next.revision, 2);
  const developmentTasks = await db.conversation.findMany({ where: { ownerId: user.id } });
  const developmentRoles = await readConversationDevelopmentRoles(db, user.id, developmentTasks);
  assert.equal(developmentRoles.get(first.conversation_id), "development");
  assert.equal(developmentRoles.get(first.preview_conversation_id), "preview");
  assert.equal(developmentRoles.get(next.preview_conversation_id!), "preview");
  assert.equal((await readConversationDevelopmentRoles(db, randomUUID(), developmentTasks)).size, 0);
  const installedTask = await createApplicationTask(user.id, { id: installed.application_id, name: "Installed application task", interactivePackageId: installedPackage });
  const legacyTask = await createApplicationTask(user.id, { id: legacyId, name: "Historical application task", interactivePackageId: legacyPackageId });
  assert.equal((await readConversationDevelopmentRoles(db, user.id, [installedTask, legacyTask])).size, 0);
  console.log("PASS task labels: builder, current and previous previews, installed/historical application isolation and owner boundaries.");
  const changedCatalog = await applications.catalog(actor, { state: "developing", limit: 100 });
  assert.equal(changedCatalog.items.length, 1);
  assert.equal(changedCatalog.items[0]?.type, "application");
  assert.equal(changedCatalog.items[0]?.development?.has_changes, true);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: installed.application_id } })).interactivePackageId, installedPackage);
  assert.equal(await db.interactiveApplicationPackage.count({ where: { applicationId: first.preview_application_id } }), 2);
  const updated = await publishThroughHttp(first.id, next.source_hash, { version_number: "1.0.1", usage_instructions: "测试" });
  assert.equal(updated.application_id, installed.application_id);
  assert.notEqual((await db.application.findUniqueOrThrow({ where: { id: installed.application_id } })).interactivePackageId, installedPackage);
  assert(await db.interactiveApplicationPackage.findUnique({ where: { id: installedPackage! } }));
  assert.equal((await applications.catalog(actor, { state: "developing", limit: 100 })).items.length, 0);
  assert.equal((await service.resume(actor, updated.application_id!, "en-US")).id, first.id);
  const resumedLegacy = await service.resume(actor, legacyId, "en-US"); assert(resumedLegacy.preview_current && resumedLegacy.conversation_id);
  assert.equal(resumedLegacy.installed_source_hash, resumedLegacy.source_hash);
  assert(!(await applications.catalog(actor, { state: "developing", limit: 100 })).items.some(item => item.development?.id === resumedLegacy.id));
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: resumedLegacy.conversation_id } })).title, "Develop Existing application");
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: legacyTask.id } })).title, "Historical application task");
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: legacyId } })).interactivePackageId, legacyPackageId);
  await assert.rejects(service.get({ ...actor, id: randomUUID() }, first.id), { code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  console.log("PASS development: live snapshots, real runtime assets, concurrent sync, installation isolation, updates, resume and owner checks.");
  console.log("PASS owned catalog: historical applications, drafts before preview, no duplicate installed entries, state transitions, literal search, pagination, owner isolation and orphan exclusion.");
  const createRunningTurn = (conversationId: string) => db.conversationTurn.create({ data: {
    conversationId, sequenceNo: 1, submittedBy: user.id, codexThreadId: randomUUID(), codexTurnId: randomUUID(),
    status: "running", submitMode: "normal", capabilityGeneration: "c".repeat(64), capabilitiesJson: [], startedAt: new Date(),
  } });
  assert.equal(next.preview_conversation_id, first.preview_conversation_id);
  const packageBeforeEdits = (await db.conversation.findUniqueOrThrow({ where: { id: first.preview_conversation_id } })).interactiveApplicationPackageId;
  let unsubmitted = updated;
  for (let revision = 3; revision <= 9; revision++) {
    await writeFile(sourceFile, `document.title='Preview ${revision}'`);
    unsubmitted = await service.sync(actor, first.id);
    assert.equal(unsubmitted.revision, revision);
    assert.equal(unsubmitted.preview_conversation_id, first.preview_conversation_id);
    assert.deepEqual(await service.testSessions(actor, first.id, { limit: 1 }), { items: [], next_cursor: null });
    assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), 1);
  }
  const idleReset = await service.restartTest(actor, first.id, { revision: unsubmitted.revision, preview_conversation_id: unsubmitted.preview_conversation_id });
  assert.equal(idleReset.preview_conversation_id, first.preview_conversation_id);
  const packageBeforeTest = (await db.conversation.findUniqueOrThrow({ where: { id: first.preview_conversation_id } })).interactiveApplicationPackageId;
  assert(packageBeforeTest);
  // Stale submission preparation cannot overwrite the package of a reused preview.
  await assert.rejects(db.$transaction(tx => assertCurrentDevelopmentPreview(tx, user.id, first.preview_conversation_id!, first.preview_application_id!, packageBeforeEdits)), { code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
  const firstRun = await createRunningTurn(first.preview_conversation_id);
  await db.conversationTurn.update({ where: { id: firstRun.id }, data: { status: "completed", completedAt: new Date() } });
  await db.conversation.update({ where: { id: first.preview_conversation_id }, data: { lastTurnStatus: "completed", lastRunAt: firstRun.startedAt } });
  await writeFile(sourceFile, "document.title='Edited after testing'");
  const secondTest = await service.sync(actor, first.id);
  assert(secondTest.preview_conversation_id);
  assert.notEqual(secondTest.preview_conversation_id, first.preview_conversation_id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: first.preview_conversation_id } })).interactiveApplicationPackageId, packageBeforeTest);
  assert.deepEqual((await service.testSessions(actor, first.id, { limit: 20 })).items.map(item => item.id), [first.preview_conversation_id]);
  const secondRun = await createRunningTurn(secondTest.preview_conversation_id);
  await db.conversationTurn.update({ where: { id: secondRun.id }, data: { status: "completed", completedAt: new Date() } });
  await db.conversation.update({ where: { id: secondTest.preview_conversation_id }, data: { lastTurnStatus: "completed", lastRunAt: secondRun.startedAt } });
  // Earlier releases produced empty sessions. They must not fill or truncate history pages.
  const legacyEmpty = await createApplicationTask(user.id, { id: first.preview_application_id, name: "Unused legacy preview", interactivePackageId: packageBeforeTest });
  await db.conversation.update({ where: { id: legacyEmpty.id }, data: { archiveStatus: "archived", archivedAt: new Date() } });
  assert.equal((await service.testSessions(actor, first.id, { limit: 2 })).items.length, 2);
  const history = await service.testSessions(actor, first.id, { limit: 1 });
  assert.equal(history.items.length, 1); assert(history.next_cursor);
  assert.equal(history.items[0]?.current, true);
  const older = await service.testSessions(actor, first.id, { limit: 1, cursor: history.next_cursor });
  assert.equal(older.items[0]?.id, first.preview_conversation_id);
  assert.equal(older.next_cursor, null);
  await assert.rejects(service.testSessions(actor, first.id, { limit: 1, cursor: installedTask.id }), { code: "VALIDATION_ERROR" });
  const reset = await service.restartTest(actor, first.id, { revision: secondTest.revision, preview_conversation_id: secondTest.preview_conversation_id });
  assert(reset.preview_conversation_id);
  assert.notEqual(reset.preview_conversation_id, secondTest.preview_conversation_id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: secondTest.preview_conversation_id } })).archiveStatus, "archived");
  await assert.rejects(service.restartTest(actor, first.id, { revision: secondTest.revision, preview_conversation_id: secondTest.preview_conversation_id }), { code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
  const resetPackageId = (await db.conversation.findUniqueOrThrow({ where: { id: reset.preview_conversation_id } })).interactiveApplicationPackageId;
  await db.$transaction(tx => assertCurrentDevelopmentPreview(tx, user.id, reset.preview_conversation_id!, first.preview_application_id!, resetPackageId));
  await db.$transaction(tx => assertCurrentDevelopmentPreview(tx, user.id, first.preview_conversation_id!, first.preview_application_id!, packageBeforeTest));
  await assert.rejects(db.$transaction(tx => assertNotDevelopmentPreview(tx, first.preview_application_id!)), { code: "FORBIDDEN" });
  const regular = await db.conversation.findMany({ where: { ownerId: user.id, AND: await ordinaryConversationFilter(db, user.id) } });
  assert(regular.some(item => item.id === first.conversation_id));
  assert(regular.some(item => item.id === installedTask.id));
  assert(!regular.some(item => item.applicationId === first.preview_application_id));
  await assert.rejects(service.testSessions({ ...actor, id: randomUUID() }, first.id, { limit: 20 }), { code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  await assert.rejects(service.deleteTest(actor, first.id, installedTask.id), { code: "CONVERSATION_NOT_FOUND" });
  const tests = await db.conversation.findMany({ where: { applicationId: first.preview_application_id } });
  const queued = await db.pendingRequest.create({ data: { conversationId: reset.preview_conversation_id,
    submittedBy: user.id, inputText: "Queued test", queueNo: 1n, status: "blocked_overload" } });
  const queuedHistory = await service.testSessions(actor, first.id, { limit: 20 });
  assert.equal(queuedHistory.items.find(item => item.id === reset.preview_conversation_id)?.busy, true);
  assert.equal(queuedHistory.items.find(item => item.id === reset.preview_conversation_id)?.turn_count, 0);
  const parallelTest = await service.restartTest(actor, first.id, { revision: reset.revision, preview_conversation_id: reset.preview_conversation_id });
  assert(parallelTest.preview_conversation_id);
  await db.pendingRequest.delete({ where: { id: queued.id } });
  const running = await createRunningTurn(reset.preview_conversation_id!);
  await assert.rejects(service.restartTest(actor, first.id, { revision: reset.revision, preview_conversation_id: reset.preview_conversation_id }), { code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
  await assert.rejects(applications.delete(actor, installed.application_id, {}), { code: "APPLICATION_DEVELOPMENT_TEST_BUSY" });
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), tests.length + 1);
  assert.equal(await db.runtimeCleanupOutbox.count({ where: { conversationId: first.conversation_id } }), 0);
  assert(await db.applicationDevelopment.findUnique({ where: { id: first.id } }));
  await db.conversationTurn.update({ where: { id: running.id }, data: { status: "completed", completedAt: new Date() } });
  await db.conversationMessage.createMany({ data: [
    { conversationId: reset.preview_conversation_id!, turnId: running.id, sequenceNo: 1, role: "user", contentText: "Test input" },
    { conversationId: reset.preview_conversation_id!, turnId: running.id, sequenceNo: 2, role: "assistant", contentText: "Test output" },
  ] });
  const inspection = await store.inspectTest(await store.owned(user.id, first.id), reset.preview_conversation_id!);
  assert.deepEqual(inspection.messages.map(message => message.content), ["Test input", "Test output"]);
  await assert.rejects(store.inspectTest(await store.owned(user.id, first.id), installedTask.id), { code: "CONVERSATION_NOT_FOUND" });
  // A failure after deletion must roll back parent, children, messages and cleanup records together.
  await assert.rejects(db.$transaction(async tx => {
    await deleteConversationWithinTransaction(tx, user.id, existingConversation.id, {});
    throw new Error("simulated transaction failure");
  }), /simulated transaction failure/);
  assert(await db.conversation.findUnique({ where: { id: first.conversation_id } }));
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), tests.length + 1);
  assert.equal(await db.conversationMessage.count({ where: { conversationId: reset.preview_conversation_id } }), 2);
  assert.equal(await db.runtimeCleanupOutbox.count({ where: { conversationId: first.conversation_id } }), 0);
  // Deleting the developer conversation preserves the independent application, sources and tests.
  await db.$transaction(tx => deleteConversationWithinTransaction(tx, user.id, first.conversation_id!, {}));
  assert.equal((await store.owned(user.id, first.id)).conversationId, null);
  await assert.rejects(db.$transaction(tx => assertProjectHasNoApplicationSources(tx, user.id, existingProject.id)), { code: "APPLICATION_DEVELOPMENT_WORKSPACE_BOUND" });
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), tests.length + 1);
  assert.equal(await db.runtimeCleanupOutbox.count({ where: { conversationId: { in: tests.map(item => item.id) } } }), 0);
  assert(await db.runtimeCleanupOutbox.findUnique({ where: { conversationId: first.conversation_id } }));
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: first.preview_application_id } })).status, "active");
  assert.equal((await service.sync(actor, first.id)).source_hash, reset.source_hash);
  assert.equal((await applications.catalog(actor, { state: "all", limit: 100 })).items.find(item => item.development?.id === first.id)?.development?.conversation_id, null);
  await recoverDetachedDevelopmentTests(db);
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), tests.length + 1);
  await db.$transaction(tx => assertCurrentDevelopmentPreview(tx, user.id, reset.preview_conversation_id!, first.preview_application_id!, resetPackageId));
  const reopened = await Promise.all([service.reopen(actor, first.id, "en-US"), service.reopen(actor, first.id, "en-US")]);
  const resumed = reopened[0]; assert(resumed?.conversation_id);
  assert.equal(reopened[1]?.conversation_id, resumed.conversation_id);
  assert.notEqual(resumed.conversation_id, first.conversation_id);
  assert.equal(resumed.directory, first.directory);
  const resumedSource = await db.conversation.findUniqueOrThrow({ where: { id: resumed.conversation_id } });
  assert.equal(resumedSource.projectId, existingProject.id);
  assert.equal(resumedSource.workspaceRelPath, existingSourceWorkspace);
  assert.equal(resumed.preview_conversation_id, parallelTest.preview_conversation_id);
  assert.equal((await service.testSessions(actor, first.id, { limit: 100 })).items.length, 3);
  await conversations.patch(user.id, resumed.conversation_id, { archiveStatus: "archived" });
  assert.equal((await service.resume(actor, installed.application_id, "en-US")).conversation_id, resumed.conversation_id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: resumed.conversation_id } })).archiveStatus, "active");
  await assert.rejects(db.$transaction(async tx => {
    await deleteApplicationDevelopment(tx, user.id, { applicationId: installed.application_id! }, {});
    throw new Error("application deletion rollback");
  }), /application deletion rollback/);
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), tests.length + 1);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: first.preview_application_id } })).status, "active");
  assert.equal(await db.runtimeCleanupOutbox.count({ where: { conversationId: { in: tests.map(item => item.id) } } }), 0);
  // Only deleting the application removes its draft and tests, using durable runtime cleanup.
  await applications.delete(actor, installed.application_id, {});
  assert.equal(await db.applicationDevelopment.count({ where: { id: first.id } }), 0);
  await db.$transaction(tx => assertProjectHasNoApplicationSources(tx, user.id, existingProject.id));
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), 0);
  assert.equal(await db.runtimeCleanupOutbox.count({ where: { conversationId: { in: tests.map(item => item.id) } } }), tests.length);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: first.preview_application_id } })).status, "deleted");
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: installed.application_id } })).status, "deleted");
  assert(await db.conversation.findUnique({ where: { id: installedTask.id } }));
  assert(await db.conversation.findUnique({ where: { id: resumed.conversation_id } }));
  await assert.rejects(service.reopen(actor, first.id, "en-US"), { code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  await assert.rejects(conversations.createDevelopmentPreview(user.id, { id: first.preview_application_id!, name: "Late test", kind: "interactive", interactivePackageId: (await db.application.findUniqueOrThrow({ where: { id: first.preview_application_id! } })).interactivePackageId }, { id: first.id, revision: reset.revision, previousConversationId: reset.preview_conversation_id }), { code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
  // Historical orphan from the old archive-only deletion path is recovered too.
  const orphan = await createApplicationTask(user.id, { id: first.preview_application_id!, name: "Old archived test" });
  const idleOrphanId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.conversation.update({ where: { id: orphan.id }, data: { id: idleOrphanId, archiveStatus: "archived", archivedAt: new Date() } });
  // Twenty earlier active sessions must not prevent this idle one from being recovered.
  const busyOrphans = [];
  for (let index = 0; index < 20; index++) {
    const session = await createApplicationTask(user.id, { id: first.preview_application_id!, name: "Unfinished historical test" });
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    await db.conversation.update({ where: { id: session.id }, data: { id } });
    busyOrphans.push(await createRunningTurn(id));
  }
  await recoverDetachedDevelopmentTests(db);
  assert.equal(await db.conversation.findUnique({ where: { id: idleOrphanId } }), null);
  assert(await db.runtimeCleanupOutbox.findUnique({ where: { conversationId: idleOrphanId } }));
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), 20);
  assert(await db.conversation.findUnique({ where: { id: resumedLegacy.preview_conversation_id! } }));
  await db.conversationTurn.updateMany({ where: { id: { in: busyOrphans.map(turn => turn.id) } }, data: { status: "completed", completedAt: new Date() } });
  await recoverDetachedDevelopmentTests(db);
  assert.equal(await db.conversation.count({ where: { applicationId: first.preview_application_id } }), 0);
  assert(await db.conversation.findUnique({ where: { id: installedTask.id } }));
  const raceProject = await service.create(actor, { name: "Concurrent deletion" }, "en-US");
  const race = await Promise.allSettled([
    service.restartTest(actor, raceProject.id, { revision: raceProject.revision, preview_conversation_id: raceProject.preview_conversation_id }),
    service.delete(actor, raceProject.id),
  ]);
  assert.equal(race[1]?.status, "fulfilled");
  if (race[0]?.status === "rejected") assert.equal(race[0].reason.code, "APPLICATION_DEVELOPMENT_TEST_CHANGED");
  assert.equal(await db.conversation.count({ where: { applicationId: raceProject.preview_application_id } }), 0);
  assert.equal(await db.applicationDevelopment.count({ where: { id: raceProject.id } }), 0);
  assert(raceProject.conversation_id);
  assert(await db.conversation.findUnique({ where: { id: raceProject.conversation_id } }));
  const liveDraft = await service.create(actor, { name: "Test survives task deletion" }, "en-US");
  assert(liveDraft.conversation_id && liveDraft.preview_conversation_id);
  const liveTest = await createRunningTurn(liveDraft.preview_conversation_id);
  await conversations.patch(user.id, liveDraft.conversation_id, { archiveStatus: "archived" });
  await conversations.delete(user.id, liveDraft.conversation_id, {});
  assert.equal((await store.owned(user.id, liveDraft.id)).conversationId, null);
  assert.equal((await service.testSessions(actor, liveDraft.id, { limit: 20 })).items[0]?.busy, true);
  const livePackageId = (await db.conversation.findUniqueOrThrow({ where: { id: liveDraft.preview_conversation_id } })).interactiveApplicationPackageId;
  await db.$transaction(tx => assertCurrentDevelopmentPreview(tx, user.id, liveDraft.preview_conversation_id!, liveDraft.preview_application_id!, livePackageId));
  await db.conversationTurn.update({ where: { id: liveTest.id }, data: { status: "completed", completedAt: new Date() } });
  await recoverDetachedDevelopmentTests(db);
  assert(await db.conversation.findUnique({ where: { id: liveDraft.preview_conversation_id } }));
  await assert.rejects(applications.delete(actor, liveDraft.preview_application_id!, {}), { code: "FORBIDDEN" });
  await service.delete(actor, liveDraft.id);
  assert.equal(await db.conversation.count({ where: { applicationId: liveDraft.preview_application_id } }), 0);
  const sourceProject = await db.project.create({ data: { ownerId: user.id, name: "Retained sources" } });
  const sourceDraft = await db.applicationDevelopment.create({ data: { ownerId: user.id, name: "Detached source", directory: "applications/detached", projectId: sourceProject.id, workspaceRelPath: projectWorkspaceRelativePath(user.id, sourceProject.id) } });
  await assert.rejects(db.$transaction(tx => assertProjectHasNoApplicationSources(tx, user.id, sourceProject.id)), { code: "APPLICATION_DEVELOPMENT_WORKSPACE_BOUND" });
  await service.delete(actor, sourceDraft.id);
  await db.$transaction(tx => assertProjectHasNoApplicationSources(tx, user.id, sourceProject.id));
  console.log("PASS tests: pagination, restart, stale/adversarial admission, ordinary task isolation and owner checks.");
  console.log("PASS cleanup: busy guards, transaction rollback, concurrent restart/deletion, durable cleanup, bounded orphan recovery without starvation, applications survive task deletion; explicit application deletion preserves regular tasks.");

  const capabilityDraft = await service.create(actor, { name: "Configured capabilities" }, "en-US");
  const plugin = await db.capability.create({ data: { ownerId: user.id, installedBy: user.id, type: "plugin", name: "Calendar", slug: "calendar", sourceType: "local", storagePath: "fixture/calendar", status: "active" } });
  const skill = await db.capability.create({ data: { ownerId: user.id, installedBy: user.id, type: "skill", name: "Writing", slug: "writing", sourceType: "local", storagePath: "fixture/writing", status: "active" } });
  const kb = await db.knowledgeBase.create({ data: { ownerId: user.id, name: "Research" } });
  const mcp = await db.mcpServer.create({ data: { ownerId: user.id, name: "Reports", serverKey: "reports", authType: "none", url: "https://mcp.example.test" } });
  const declaration = (resource: { id: string; name: string }) => ({ id: resource.id, name: resource.name });
  const dependencies = interactiveDependenciesSchema.parse({ plugins: [declaration(plugin)], skills: [declaration(skill)], knowledge_bases: [declaration(kb)], mcp_servers: [declaration(mcp)] });
  const configured = await service.updateCapabilities(actor, capabilityDraft.id, { source_hash: capabilityDraft.source_hash!, dependencies });
  const configuredManifestPath = join(root, workspaceRelPath, capabilityDraft.directory, "manifest.json");
  const configuredFile = await readFile(configuredManifestPath, "utf8");
  assert.deepEqual(JSON.parse(configuredFile).dependencies, dependencies);
  assert.deepEqual(configured.manifest?.dependencies, dependencies);
  assert((await service.capabilities(actor, configured.id)).dependencies.items.every(item => item.available));
  for (const directory of ["calendar", "writing"]) {
    await mkdir(join(root, "capabilities/fixture", directory), { recursive: true });
    await writeFile(join(root, "capabilities/fixture", directory, "SKILL.md"), "---\nname: fixture\ndescription: Test fixture\n---\nFixture capability");
  }
  const configuredInstall = await service.install(actor, configured.id, configured.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
  assert(configured.preview_application_id && configuredInstall.application_id);
  for (const applicationId of [configured.preview_application_id!, configuredInstall.application_id!]) {
    assert.equal(await db.applicationCapability.count({ where: { applicationId } }), 2);
    assert.equal(await db.applicationKnowledgeBase.count({ where: { applicationId, knowledgeBaseId: kb.id } }), 1);
    assert.equal(await db.applicationMcpServer.count({ where: { applicationId, mcpServerId: mcp.id } }), 1);
    const app = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
    const asset = await db.interactiveApplicationAsset.findFirstOrThrow({ where: { packageId: app.interactivePackageId!, path: "manifest.json" } });
    assert.deepEqual(JSON.parse((await buffer(await assets.get(asset.objectKey))).toString()).dependencies, dependencies);
    await applications.resolveRuntime(user.id, applicationId);
  }
  const foreign = await db.user.create({ data: { email: "other-builder@example.test", name: "Other", status: "active", role: "user" } });
  await assert.rejects(service.updateCapabilities({ ...actor, id: foreign.id }, configured.id, { source_hash: configured.source_hash!, dependencies }), { code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  await db.capability.update({ where: { id: plugin.id }, data: { ownerId: foreign.id } });
  await assert.rejects(service.updateCapabilities(actor, configured.id, { source_hash: configured.source_hash!, dependencies }), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  assert.equal(await readFile(configuredManifestPath, "utf8"), configuredFile);
  // Saving an empty selection also removes actual runtime links, while the installed app stays immutable.
  const cleared = await service.updateCapabilities(actor, configured.id, { source_hash: configured.source_hash!, dependencies: interactiveDependenciesSchema.parse({}) });
  assert.equal(await db.applicationCapability.count({ where: { applicationId: configured.preview_application_id } }), 0);
  assert.equal(await db.applicationKnowledgeBase.count({ where: { applicationId: configured.preview_application_id } }), 0);
  assert.equal(await db.applicationMcpServer.count({ where: { applicationId: configured.preview_application_id } }), 0);
  assert.equal(await db.applicationCapability.count({ where: { applicationId: configuredInstall.application_id } }), 2);
  assert.equal(cleared.installed_source_hash, null);
  const configuredEntry = (await applications.catalog(actor, { state: "developing", limit: 100 })).items.find(item => item.development?.id === configured.id);
  assert(configuredEntry?.type === "application");
  assert.equal(configuredEntry.application.capability_count, 2);
  assert.equal(configuredEntry.application.knowledge_base_count, 1);
  assert.equal(configuredEntry.application.mcp_server_count, 1);
  assert.equal(configuredEntry.development?.capability_count, 0);
  assert.equal(configuredEntry.development?.knowledge_base_count, 0);
  assert.equal(configuredEntry.development?.mcp_server_count, 0);
  // Pre-change imports can retain a declared ID while using a different local resource.
  const importedDeclarationId = randomUUID();
  const importedDraft = await service.create(actor, { name: "Previously mapped import" }, "en-US");
  const importedManifestPath = join(root, workspaceRelPath, importedDraft.directory, "manifest.json");
  const importedManifest = JSON.parse(await readFile(importedManifestPath, "utf8"));
  await writeFile(importedManifestPath, JSON.stringify({ ...importedManifest, dependencies: { skills: [{ id: importedDeclarationId, name: "Imported writing" }] } }));
  await service.sync(actor, importedDraft.id);
  await applications.updateInteractiveDependencies(actor, importedDraft.preview_application_id!, [{ type: "skill", id: importedDeclarationId, resource_id: skill.id }], {});
  const mappedState = await service.capabilities(actor, importedDraft.id);
  assert.equal(mappedState.dependencies.items[0]?.resource_id, skill.id);
  const mappedPreview = await service.sync(actor, importedDraft.id);
  const mappedInstalled = await service.install(actor, importedDraft.id, mappedPreview.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
  // Remove only this test fixture's development linkage to simulate first-time continuation of an older import.
  await db.applicationDevelopment.update({ where: { id: importedDraft.id }, data: { applicationId: null } });
  const continued = await service.resume(actor, mappedInstalled.application_id!, "en-US");
  const continuedState = await service.capabilities(actor, continued.id);
  assert.equal(continued.preview_current, true);
  assert.equal(continuedState.dependencies.items[0]?.resource_id, skill.id);
  const continuedEntry = (await applications.catalog(actor, { state: "all", limit: 100 })).items.find(item => item.development?.id === continued.id);
  assert.equal(continuedEntry?.development?.capability_count, 1);
  const normalized = await service.updateCapabilities(actor, continued.id, { source_hash: continuedState.source_hash, dependencies: interactiveDependenciesSchema.parse({ skills: [declaration(skill)] }) });
  assert.deepEqual(normalized.manifest?.dependencies.skills, [declaration(skill)]);
  assert.deepEqual((await applications.resolveRuntime(user.id, normalized.preview_application_id!)).capabilityIds, [skill.id]);
  await db.applicationDevelopment.update({ where: { id: continued.id }, data: { applicationId: null } });
  await db.capability.update({ where: { id: skill.id }, data: { status: "disabled" } });
  const needsRepair = await service.resume(actor, mappedInstalled.application_id!, "en-US");
  const repairState = await service.capabilities(actor, needsRepair.id);
  assert.equal(repairState.dependencies.items[0]?.resource_id, skill.id);
  assert.equal(repairState.dependencies.items[0]?.available, false);
  const repaired = await service.updateCapabilities(actor, needsRepair.id, { source_hash: repairState.source_hash, dependencies: interactiveDependenciesSchema.parse({}) });
  assert.equal(repaired.preview_current, true);
  console.log("PASS capabilities: four resource types persist in source and preview/install assets, runtime bindings update, owner authorization holds, clearing selections preserves the installed version.");
  console.log("PASS existing mapped imports: continuation preserves actual resources, configuration writes local IDs back to the package and remains executable.");

  const metadataDraft = await service.create(actor, { name: "Editable metadata" }, "en-US");
  const metadataInstalled = await service.install(actor, metadataDraft.id, metadataDraft.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
  assert(metadataInstalled.application_id);
  await db.application.update({ where: { id: metadataInstalled.application_id }, data: { status: "disabled" } });
  const iconBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const metadataEdited = await service.updateMetadata(actor, metadataDraft.id, {
    source_hash: metadataDraft.source_hash!, name: "Renamed application", description: "Updated description",
    icon: { type: "upload", filename: "logo.png", mime_type: "image/png", data_base64: iconBytes.toString("base64") },
  });
  assert.equal(metadataEdited.icon.type, "custom");
  const editedCatalog = await applications.catalog(actor, { state: "developing", limit: 100 });
  const draftMetadata = editedCatalog.items.find(item => item.development?.id === metadataDraft.id)?.development;
  assert.equal(draftMetadata?.description, "Updated description");
  assert.equal(draftMetadata?.icon?.type, "custom");
  const descriptionSearch = await applications.catalog(actor, { state: "developing", search: "Updated description", limit: 1 });
  assert.equal(descriptionSearch.items[0]?.development?.id, metadataDraft.id);
  const publishedEntry = descriptionSearch.items[0];
  assert(publishedEntry?.type === "application");
  assert.equal(publishedEntry.application.name, "Editable metadata");
  assert.equal(publishedEntry.development?.name, "Renamed application");
  // Existing published apps with changed drafts sort by draft activity, not installation age.
  await db.applicationDevelopment.update({ where: { id: metadataDraft.id }, data: { updatedAt: new Date("2099-01-01T00:00:00Z") } });
  const newestDraftPage = await applications.catalog(actor, { state: "developing", limit: 1 });
  assert.equal(newestDraftPage.items[0]?.development?.id, metadataDraft.id);
  if (newestDraftPage.next_cursor) {
    const nextDraftPage = await applications.catalog(actor, { state: "developing", limit: 100, cursor: newestDraftPage.next_cursor });
    assert(!nextDraftPage.items.some(item => item.development?.id === metadataDraft.id));
  }
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: metadataInstalled.application_id } })).name, "Editable metadata");
  const metadataPublished = await service.install(actor, metadataEdited.id, metadataEdited.source_hash!, { version_number: "1.0.1", usage_instructions: "" });
  const activeApp = await db.application.findUniqueOrThrow({ where: { id: metadataPublished.application_id! } });
  assert.equal(activeApp.status, "active");
  assert.equal(activeApp.name, "Renamed application");
  assert.equal(activeApp.description, "Updated description");
  assert(activeApp.iconObjectKey);
  assert.deepEqual(objects.get(activeApp.iconObjectKey), iconBytes);
  await applications.update(actor, activeApp.id, { name: "Catalog name", description: "Catalog description", icon: { type: "preset", preset: "book-open" } }, {});
  assert.equal((await applications.get(actor, activeApp.id)).name, "Catalog name");
  assert.deepEqual((await applications.get(actor, activeApp.id)).icon, { type: "preset", preset: "book-open" });
  assert.equal((await applications.resolveRuntime(actor.id, activeApp.id)).interactivePackageId, activeApp.interactivePackageId);
  const publishedManifestAsset = await db.interactiveApplicationAsset.findFirstOrThrow({ where: { packageId: activeApp.interactivePackageId!, path: "manifest.json" } });
  const publishedManifest = JSON.parse((await buffer(await assets.get(publishedManifestAsset.objectKey))).toString());
  assert.equal(publishedManifest.name, activeApp.name);
  assert.equal(publishedManifest.description, activeApp.description);
  await applications.resolveRuntime(user.id, activeApp.id);
  await db.application.update({ where: { id: activeApp.id }, data: { status: "disabled" } });
  await service.install(actor, metadataEdited.id, metadataEdited.source_hash!, { version_number: "1.0.2", usage_instructions: "" });
  const republishedApp = await db.application.findUniqueOrThrow({ where: { id: activeApp.id } });
  assert.equal(republishedApp.status, "active");
  console.log("PASS metadata publication: edits preserve the installed version; confirmed publication updates manifest, enables the application, resolves its runtime, and repeated publication re-enables it.");

  const publishedTask = await createApplicationTask(user.id, { id: activeApp.id, name: "Keep published task", interactivePackageId: activeApp.interactivePackageId });
  await service.delete(actor, metadataDraft.id);
  assert.equal(await db.applicationDevelopment.count({ where: { id: metadataDraft.id } }), 0);
  assert.equal(await db.conversation.count({ where: { applicationId: metadataDraft.preview_application_id } }), 0);
  assert(await db.conversation.findUnique({ where: { id: publishedTask.id } }));
  assert(await db.conversation.findUnique({ where: { id: metadataDraft.conversation_id! } }));
  assert.equal((await applications.resolveRuntime(user.id, activeApp.id)).interactivePackageId, republishedApp.interactivePackageId);
  const retainedEntry = (await applications.catalog(actor, { state: "all", limit: 100 })).items.find(item => item.type === "application" && item.application.id === activeApp.id);
  assert(retainedEntry?.type === "application"); assert.equal(retainedEntry.development, null);
  const newDevelopment = await service.resume(actor, activeApp.id, "en-US");
  assert.notEqual(newDevelopment.id, metadataDraft.id);
  assert.equal(newDevelopment.source_hash, newDevelopment.installed_source_hash);
  console.log("PASS catalog draft lifecycle: published metadata isolation, draft description search and ordering, draft-only deletion retains usable published runtime and tasks, development can restart without changes.");

} finally {
  await publicationApi.close();
  await database?.$disconnect();
  if (created) await docker("rm", "--force", "--volumes", name);
  await rm(root, { recursive: true, force: true });
}
