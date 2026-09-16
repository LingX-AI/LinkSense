import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPrismaClient } from "../../src/db.js";
import { convertProjectRuntime } from "../../src/operations/project-runtime-conversion.js";
import { assertRuntimeLayoutReady } from "../../src/operations/runtime-layout-readiness.js";
import { executionPrincipalStatus } from "../../src/lib/execution-principal.js";
import { ProjectRepository } from "../../src/modules/projects/repository.js";
import { convertApplicationEnvironments, recoverApplicationEnvironments } from "../../src/operations/application-environment-conversion.js";

// This test owns a disposable database and never reads application .env files.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20260915100000_promote_categories_to_projects";
const root = await mkdtemp(join(tmpdir(), "linksense-project-db-"));
const name = `linksense-project-test-${randomUUID()}`;
const docker = async (...args: string[]) => (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let created = false;
let database: ReturnType<typeof createPrismaClient> | undefined;
try {
  const password = randomUUID();
  await docker("run", "--detach", "--name", name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=linksense_project_test", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  created = true;
  const port = Number((await docker("port", name, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", name, "pg_isready", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/linksense_project_test`;
  const migrations = join(repositoryRoot, "prisma/migrations");
  const historical = join(root, "migrations");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName) await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
  }
  const migrate = async (migrationsPath: string) => execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: migrationsPath },
  });
  await migrate(historical);
  database = createPrismaClient(databaseUrl);
  const db = database;
  const owner = randomUUID(), project = randomUUID(), task = randomUUID(), file = randomUUID(), share = randomUUID();
  const nativeThread = randomUUID(), generation = randomUUID(), intent = randomUUID();
  const oldWorkspace = `${owner}/home/workspaces/${task}`;
  await db.$executeRaw`INSERT INTO task_categories (id, owner_id, name, sort_order, updated_at) VALUES (${project}::uuid, ${owner}::uuid, 'Existing project', 7, now())`;
  await db.$executeRaw`INSERT INTO conversations (id, owner_id, title, title_source, archive_status, category_id, sort_order, workspace_rel_path, codex_thread_id, runtime_generation, updated_at)
    VALUES (${task}::uuid, ${owner}::uuid, 'Existing task', 'manual', 'active', ${project}::uuid, 9, ${oldWorkspace}, ${nativeThread}, ${generation}::uuid, now())`;
  await db.$executeRaw`INSERT INTO conversation_files (id, conversation_id, kind, source, status, filename, size_bytes, storage_backend, workspace_relative_path, downloadable, updated_at)
    VALUES (${file}::uuid, ${task}::uuid, 'attachment', 'user_upload', 'staged', 'history.txt', 5, 'workspace', 'attachments/history.txt', false, now())`;
  const snapshot = { conversation: { id: task, category_id: project, title: 'Existing task' }, messages: [{ content: 'Preserved message' }] };
  await db.$executeRaw`INSERT INTO conversation_shares (id, conversation_id, owner_id, title_snapshot, snapshot_json, updated_at)
    VALUES (${share}::uuid, ${task}::uuid, ${owner}::uuid, 'Existing task', ${JSON.stringify(snapshot)}::jsonb, now())`;
  await db.conversationTurnStartIntent.create({ data: { projectionTurnId: intent, conversationId: task, ownerId: owner, runtimeGeneration: generation,
    capabilityGeneration: 'a'.repeat(64), submitMode: 'normal', inputText: 'Pending input', attachmentsJson: [{ id: file, storageBackend: 'workspace', workspaceRelativePath: 'attachments/history.txt' }] } });
  const appId = randomUUID(), visitor = randomUUID(), externalTask = randomUUID(), externalAccess = randomUUID(), session = randomUUID();
  await db.$executeRaw`INSERT INTO users (id, email, name, role, status, account_type, updated_at) VALUES (${owner}::uuid, 'owner@example.test', 'Author', 'user', 'active', 'member', now())`;
  await db.$executeRaw`INSERT INTO users (id, email, name, role, status, account_type, preferred_locale, total_credit_limit_micros, updated_at) VALUES (${visitor}::uuid, 'visitor@example.test', 'Existing visitor', 'user', 'active', 'application_external', 'en-US', 2500000, now())`;
  await db.$executeRaw`INSERT INTO applications (id, owner_id, name, kind, status, instructions, updated_at) VALUES (${appId}::uuid, ${owner}::uuid, 'Existing app', 'standard', 'active', 'Preserved application instructions.', now())`;
  const pageApp = randomUUID(), oldPage = randomUUID(), currentPage = randomUUID(), pageTask = randomUUID();
  await db.$executeRaw`INSERT INTO applications (id, owner_id, name, kind, status, instructions, interactive_package_id, updated_at) VALUES (${pageApp}::uuid, ${owner}::uuid, 'Existing page', 'interactive', 'active', 'Page instructions', ${currentPage}::uuid, now())`;
  for (const [packageId, version, instructions] of [[oldPage, '1.0.0', 'Retained page instructions.'], [currentPage, '2.0.0', 'Current page instructions.']] as const) {
    await db.interactiveApplicationPackage.create({ data: { id: packageId, applicationId: pageApp, version,
      manifestJson: { schema_version: 1, id: 'existing-page', name: 'Existing page', version, sdk_version: 1, instructions }, archiveSha256: 'a'.repeat(64), fileCount: 1, expandedBytes: 1, createdBy: owner } });
    await db.interactiveApplicationAsset.create({ data: { packageId, path: 'index.html', objectKey: `fixture/${packageId}/index.html`, contentType: 'text/html', byteSize: 1, sha256: 'a'.repeat(64) } });
  }
  await db.$executeRaw`INSERT INTO conversations (id, owner_id, title, title_source, archive_status, workspace_rel_path, application_id, application_name_snapshot, interactive_application_package_id, runtime_generation, updated_at)
    VALUES (${pageTask}::uuid, ${owner}::uuid, 'Old page task', 'manual', 'active', ${`${owner}/home/workspaces/${pageTask}`}, ${pageApp}::uuid, 'Existing page', ${oldPage}::uuid, ${randomUUID()}::uuid, now())`;
  await db.$executeRaw`INSERT INTO conversations (id, owner_id, title, title_source, archive_status, workspace_rel_path, application_id, application_name_snapshot, runtime_generation, updated_at)
    VALUES (${externalTask}::uuid, ${visitor}::uuid, 'Embedded history', 'manual', 'active', ${`${visitor}/home/workspaces/${externalTask}`}, ${appId}::uuid, 'Existing app', ${randomUUID()}::uuid, now())`;
  await db.$executeRaw`INSERT INTO application_external_access (id, application_id, public_id, enabled, auth_mode, app_id, app_secret_hash, app_secret_encrypted, app_secret_encryption_key_id, credential_version, allowed_origins_json, created_by, updated_at)
    VALUES (${externalAccess}::uuid, ${appId}::uuid, 'preserved-public-id', true, 'required', 'preserved-app-id', ${'a'.repeat(64)}, 'fixture-encrypted-secret', 'fixture-key-id', 3, '["https://embed.example.test"]'::jsonb, ${owner}::uuid, now())`;
  await db.$executeRaw`INSERT INTO application_external_sessions (id, external_access_id, application_id, runtime_principal_id, conversation_id, origin, credential_version, absolute_expires_at, updated_at)
    VALUES (${session}::uuid, ${externalAccess}::uuid, ${appId}::uuid, ${visitor}::uuid, ${externalTask}::uuid, 'https://embed.example.test', 3, now() + interval '1 day', now())`;
  const grant = randomUUID();
  await db.$executeRaw`INSERT INTO application_grants (id, application_id, grantee_type, user_id, status, granted_by, updated_at) VALUES (${grant}::uuid, ${appId}::uuid, 'user', ${owner}::uuid, 'active', ${owner}::uuid, now())`;
  const accessBefore = await db.applicationExternalAccess.findUniqueOrThrow({ where: { id: externalAccess } });
  const before = await db.$queryRaw<Array<{ row: Record<string, unknown> }>>`SELECT to_jsonb(c) AS row FROM conversations c WHERE id = ${task}::uuid`;
  const checksums = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  const historicalCleanup = randomUUID();
  await db.$executeRaw`INSERT INTO runtime_cleanup_outbox (id, owner_id, conversation_id, updated_at)
    VALUES (${historicalCleanup}::uuid, ${owner}::uuid, ${randomUUID()}::uuid, now())`;
  await migrate(migrations);
  assert.equal((await db.runtimeCleanupOutbox.findUniqueOrThrow({ where: { id: historicalCleanup } })).removeServiceEnvironment, false);
  const converted = await db.conversation.findUniqueOrThrow({ where: { id: task } });
  assert.equal(converted.projectId, project);
  assert.equal(converted.codexThreadId, nativeThread);
  assert.equal(converted.sortOrder, 9);
  assert.equal(converted.workspaceRelPath, oldWorkspace);
  const after = await db.$queryRaw<Array<{ row: Record<string, unknown> }>>`SELECT to_jsonb(c) AS row FROM conversations c WHERE id = ${task}::uuid`;
  const expectedRow: Record<string, unknown> = { ...before[0]!.row, project_id: project, application_version_id: null, application_channel: null };
  delete expectedRow.category_id;
  assert.deepEqual(after[0]?.row, expectedRow);
  assert.deepEqual(await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name < ${migrationName} ORDER BY migration_name`, checksums);
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: project } })).sortOrder, 7);
  assert.equal((await db.conversationFile.findUniqueOrThrow({ where: { id: file } })).workspaceRootRelPath, oldWorkspace);
  assert.deepEqual((await db.conversationShare.findUniqueOrThrow({ where: { id: share } })).snapshotJson,
    { ...snapshot, conversation: { id: task, project_id: project, title: 'Existing task' } });
  assert.deepEqual((await db.conversationTurnStartIntent.findUniqueOrThrow({ where: { projectionTurnId: intent } })).attachmentsJson,
    [{ id: file, storageBackend: 'workspace', workspaceRelativePath: 'attachments/history.txt', workspaceRootRelPath: oldWorkspace }]);
  assert.equal(await db.user.count(), 1);
  const externalSession = await db.applicationExternalSession.findUniqueOrThrow({ where: { id: session } });
  assert.equal(externalSession.runtimePrincipalId, visitor);
  assert.equal(externalSession.conversationId, externalTask);
  assert.equal(externalSession.preferredLocale, 'en-US');
  assert.equal(externalSession.totalCreditLimitMicros, 2500000n);
  assert.equal(externalSession.displayName, 'Existing visitor');
  assert.deepEqual(await db.applicationExternalAccess.findUniqueOrThrow({ where: { id: externalAccess } }), accessBefore);
  assert.equal(await db.applicationGrant.count({ where: { id: grant } }), 1);
  const usersRoot = join(root, 'users'), capabilityRoot = join(usersRoot, '.capabilities');
  await mkdir(capabilityRoot, { recursive: true });
  for (const [id, user, native] of [[task, owner, nativeThread], [externalTask, visitor, null], [pageTask, owner, null]] as const) {
    const workspace = join(usersRoot, user, 'home', 'workspaces', id);
    await mkdir(join(workspace, 'attachments'), { recursive: true });
    await writeFile(join(workspace, 'attachments/history.txt'), 'saved');
    if (native) {
      const codex = join(usersRoot, user, 'home', 'task-homes', id, '.codex/sessions');
      await mkdir(codex, { recursive: true });
      await writeFile(join(codex, `${native}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id: native } }) + '\n');
    }
  }
  await assert.rejects(assertRuntimeLayoutReady(db, usersRoot), /MIGRATION_PROJECT_RUNTIME_REQUIRED/);
  const pinnedVersion = (await db.application.findUniqueOrThrow({ where: { id: appId } })).publishedVersionId;
  assert(pinnedVersion);
  await assert.rejects(convertProjectRuntime({ prisma: db, userDataRoot: usersRoot, capabilityRoot, backupRoot: join(root, 'busy-precheck'), apply: false }), /MIGRATION_ACTIVE_TASKS/);
  // Simulate the old runtime settling its accepted start before maintenance.
  await db.conversationTurnStartIntent.delete({ where: { projectionTurnId: intent } });
  const dryRun = await convertProjectRuntime({ prisma: db, userDataRoot: usersRoot, capabilityRoot, backupRoot: join(root, 'dry-run'), apply: false });
  assert.equal(dryRun.applied, false);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: task } })).workspaceRelPath, oldWorkspace);
  const conversion = await convertProjectRuntime({ prisma: db, userDataRoot: usersRoot, capabilityRoot, backupRoot: join(root, 'backup'), apply: true });
  assert.equal(conversion.tasks, 3);
  const historicalPageTask = await db.conversation.findUniqueOrThrow({ where: { id: pageTask } });
  const currentPageApp = await db.application.findUniqueOrThrow({ where: { id: pageApp } });
  assert.notEqual(historicalPageTask.applicationVersionId, currentPageApp.publishedVersionId);
  assert.equal(historicalPageTask.interactiveApplicationPackageId, oldPage);
  const historicalPageVersion = await db.applicationVersion.findUniqueOrThrow({ where: { id: historicalPageTask.applicationVersionId! } });
  const pageDefinition = historicalPageVersion.definitionJson as { interactivePackageId: string; instructions: string };
  assert.equal(pageDefinition.interactivePackageId, oldPage);
  assert(pageDefinition.instructions.includes('Retained page instructions.'));
  assert(!pageDefinition.instructions.includes('Current page instructions.'));
  const projectPath = `${owner}/home/projects/${project}`;
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: task } })).workspaceRelPath, projectPath);
  const convertedFile = await db.conversationFile.findUniqueOrThrow({ where: { id: file } });
  assert.equal(convertedFile.workspaceRootRelPath, projectPath);
  assert.equal(convertedFile.workspaceRelativePath, `imports/${task}/attachments/history.txt`);
  assert.equal(await readFile(join(usersRoot, projectPath, convertedFile.workspaceRelativePath!), 'utf8'), 'saved');
  assert.equal(await readFile(join(root, 'backup/original-users', oldWorkspace, 'attachments/history.txt'), 'utf8'), 'saved');
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: externalTask } })).workspaceRelPath, `${visitor}/services/${externalTask}/home/workspace`);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: appId } })).publishedVersionId, pinnedVersion);
  assert.equal((await db.applicationVersion.findUniqueOrThrow({ where: { id: pinnedVersion } })).assetsReady, true);
  assert.equal(await executionPrincipalStatus(db, visitor), 'active');
  await assertRuntimeLayoutReady(db, usersRoot);
  const extraServiceId = randomUUID(), extraFileId = randomUUID();
  const oldServiceWorkspace = `${visitor}/services/${extraServiceId}/home/workspace`;
  await db.conversation.create({ data: { id: extraServiceId, ownerId: visitor, applicationId: appId, applicationNameSnapshot: "Existing app", applicationVersionId: pinnedVersion, title: "Another application task", titleSource: "manual", archiveStatus: "active", workspaceRelPath: oldServiceWorkspace, runtimeGeneration: randomUUID() } });
  await mkdir(join(usersRoot, oldServiceWorkspace, "artifacts"), { recursive: true });
  await writeFile(join(usersRoot, oldServiceWorkspace, "artifacts/result.txt"), "retained result");
  await db.conversationFile.create({ data: { id: extraFileId, conversationId: extraServiceId, kind: "artifact", source: "agent_generated", status: "registered", filename: "result.txt", sizeBytes: 15n, storageBackend: "workspace", workspaceRootRelPath: oldServiceWorkspace, workspaceRelativePath: "artifacts/result.txt", downloadable: false } });
  const appDryRun = await convertApplicationEnvironments({ prisma: db, userDataRoot: usersRoot, outputRoot: join(root, "application-dry-run"), apply: false });
  assert.equal(appDryRun.applied, false);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: extraServiceId } })).workspaceRelPath, oldServiceWorkspace);
  const appOutput = join(root, "application-conversion");
  await convertApplicationEnvironments({ prisma: db, userDataRoot: usersRoot, outputRoot: appOutput, apply: true });
  const appWorkspace = `${visitor}/services/${appId}/home/workspace`;
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: externalTask } })).workspaceRelPath, appWorkspace);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: extraServiceId } })).workspaceRelPath, appWorkspace);
  const importedFile = await db.conversationFile.findUniqueOrThrow({ where: { id: extraFileId } });
  assert.equal(importedFile.workspaceRootRelPath, appWorkspace);
  assert.equal(await readFile(join(usersRoot, appWorkspace, importedFile.workspaceRelativePath!), "utf8"), "retained result");
  assert.equal(await readFile(join(appOutput, "originals", oldServiceWorkspace, "artifacts/result.txt"), "utf8"), "retained result");
  assert.deepEqual(await db.applicationExternalAccess.findUniqueOrThrow({ where: { id: externalAccess } }), accessBefore);
  await recoverApplicationEnvironments(db, appOutput);
  assert.equal((await convertApplicationEnvironments({ prisma: db, userDataRoot: usersRoot, outputRoot: join(root, "already-shared"), apply: true })).applications, 0);
  const repository = new ProjectRepository(db);
  await db.conversationTurnStartIntent.create({ data: { projectionTurnId: intent, conversationId: task, ownerId: owner, runtimeGeneration: generation,
    capabilityGeneration: 'a'.repeat(64), submitMode: 'normal', inputText: 'New pending input', attachmentsJson: [] } });
  await assert.rejects(repository.delete(owner, project), { code: 'PROJECT_TASK_ACTIVE' });
  assert.equal(await db.project.count({ where: { id: project } }), 1);
  await db.conversationTurnStartIntent.delete({ where: { projectionTurnId: intent } });
  const historicalService = await db.conversation.create({ data: { ownerId: owner, projectId: project, title: 'Retained service', titleSource: 'manual', archiveStatus: 'active', workspaceRelPath: `${owner}/services/${randomUUID()}/home/workspace`, runtimeGeneration: randomUUID() } });
  await repository.delete(owner, project);
  const detachedService = await db.conversation.findUniqueOrThrow({ where: { id: historicalService.id } });
  assert.equal(detachedService.projectId, null);
  assert.equal(detachedService.workspaceRelPath, historicalService.workspaceRelPath);
  const moved = await db.conversation.findUniqueOrThrow({ where: { id: task } });
  assert.equal(moved.projectId, null);
  assert.equal(moved.workspaceRelPath, `${owner}/home/workspace`);
  assert.equal((await db.conversationFile.findUniqueOrThrow({ where: { id: file } })).workspaceRootRelPath, projectPath);
  await db.conversation.create({ data: { ownerId: owner, title: 'Shared cwd', titleSource: 'manual', archiveStatus: 'active', workspaceRelPath: moved.workspaceRelPath, runtimeGeneration: randomUUID() } });
  assert.deepEqual(await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_categories'`, []);
  assert.deepEqual(await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'category_id'`, []);
  process.stdout.write(JSON.stringify({ status: 'passed', historicalRowsPreserved: true, migrationChecksumsPreserved: true, busyProjectProtected: true, sharedDirectoryAccepted: true, oldFilesAndNativeIdsPreserved: true, embeddedIdentityAndSecretsPreserved: true, externalAccountsRemoved: true, publicationConverted: true }) + '\n');
} finally {
  await database?.$disconnect();
  if (created) await docker('rm', '--force', name);
  await rm(root, { recursive: true, force: true });
}
