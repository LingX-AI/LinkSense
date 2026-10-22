import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import type { ApplicationSetupRevision, ApplicationSetupBindingInput } from "@linksense/shared";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ApplicationService } from "../../src/modules/applications/service.js";
import { ApplicationPublicationService } from "../../src/modules/applications/publication-service.js";
import { ApplicationInstallationService } from "../../src/modules/applications/installation-service.js";
import { ApplicationCenterService } from "../../src/modules/applications/center-service.js";
import { ApplicationDistributionRepository } from "../../src/modules/applications/distribution-repository.js";
import { applicationRoutes } from "../../src/modules/applications/routes.js";
import { AuditService } from "../../src/modules/audit/service.js";
import type { RequestActor } from "../../src/modules/capabilities/types.js";
import type { ModelRuntimeSettingsReader, ResolvedModelRuntime } from "../../src/modules/system/model-provider-settings.js";
import { AppError } from "../../src/lib/errors.js";
import { sendAppError } from "../../src/lib/http.js";
import { applicationRuntimeFixture } from "./application-runtime-fixture.js";

/** Runs only inside the distribution suite's disposable, migrated PostgreSQL. */
export async function runApplicationSetupScenarios(db: PrismaClient, capabilityRoot: string): Promise<void> {
  const users = await Promise.all(["setup-author", "setup-installer", "setup-center", "setup-admin"].map(name =>
    db.user.create({ data: { email: `${name}@example.test`, name, status: "active", role: name === "setup-admin" ? "admin" : "user" } })));
  const [author, installer, centerInstaller, admin] = users;
  assert(author && installer && centerInstaller && admin);
  const actor = (user: typeof author): RequestActor => ({ id: user.id, role: user.role === "admin" ? "admin" : "user", status: "active" });
  const audit = new AuditService(db);
  const publications = new ApplicationPublicationService(db, capabilityRoot);
  const { gate, selections } = applicationRuntimeFixture(db, publications);
  const credentialReady = new Set<string>();
  const credentials = { resolveForCapability: async (userId: string, capabilityId: string, keys: string[] = []) => credentialReady.has(capabilityId)
    ? { ok: true as const, environment: Object.fromEntries(keys.map(key => [key, "fixture-only"])), usageReceipt: { userId, capabilityId, credentialIds: [] } }
    : { ok: false as const, blockCode: "required_credential_unavailable" as const } };
  const modelRuntime: ResolvedModelRuntime = { model: "setup-model", reasoningEffort: "medium", provider: { revision: 1, baseUrl: "https://models.example.test/v1", protocolMode: "native_responses", apiKey: "fixture-only" } };
  const models: ModelRuntimeSettingsReader = { resolveRuntime: async () => modelRuntime, resolveRuntimeForSelection: async () => modelRuntime, resolveModelTransitionRuntime: async () => modelRuntime };
  const installations = new ApplicationInstallationService(db, capabilityRoot, publications, gate, credentials);
  const service = new ApplicationService(db, models, audit, credentials, undefined, undefined, publications, installations, selections);
  const center = new ApplicationCenterService(new ApplicationDistributionRepository(db), publications, audit, service);
  const context = { ipAddress: "127.0.0.1" };
  const existing = await db.applicationInstallation.findFirst({ orderBy: { createdAt: "asc" } });
  assert(existing, "The distribution suite must provide a pre-change installation.");
  const existingOwner = await db.user.findUniqueOrThrow({ where: { id: existing.ownerId } });
  const existingGuide = await service.installationSetup(actor(existingOwner), existing.applicationId);
  assert.equal(existingGuide.installed_version_id, existing.installedVersionId);
  assert.equal(existingGuide.can_use, true);
  const source = await db.application.create({ data: { ownerId: author.id, name: "Setup reports", instructions: "Use the selected reporting resources." } });
  const pluginPath = `setup-plugin-${randomUUID()}`;
  await mkdir(join(capabilityRoot, pluginPath), { recursive: true });
  await writeFile(join(capabilityRoot, pluginPath, "README.md"), "Reporting plugin fixture.");
  const plugin = await db.capability.create({ data: { ownerId: author.id, installedBy: author.id, type: "plugin", name: "Reporting plugin", slug: pluginPath,
    sourceType: "local", storagePath: pluginPath, status: "active", riskSummaryJson: { requires_credentials: true, declared_environment_keys: ["REPORT_KEY"] } } });
  credentialReady.add(plugin.id);
  await db.applicationCapability.create({ data: { applicationId: source.id, capabilityId: plugin.id, capabilityNameSnapshot: plugin.name, capabilityTypeSnapshot: "plugin", selectionOrder: 0 } });
  const sourceKnowledge = await Promise.all(["Handbook", "Policies", "New reports"].map(name => db.knowledgeBase.create({ data: { ownerId: author.id, name } })));
  const ownKnowledge = await Promise.all(["My handbook", "My policies", "My new reports", "My replacement"].map(name => db.knowledgeBase.create({ data: { ownerId: installer.id, name } })));
  const sourceMcp = await db.mcpServer.create({ data: { ownerId: author.id, name: "Reporting connection", serverKey: "setup-source", url: "https://reports.example.test/mcp", authType: "none" } });
  const ownMcp = await db.mcpServer.create({ data: { ownerId: installer.id, name: "My reporting connection", serverKey: "setup-personal", url: "https://personal.example.test/mcp", authType: "none" } });
  await db.applicationKnowledgeBase.createMany({ data: sourceKnowledge.slice(0, 2).map((item, selectionOrder) => ({ applicationId: source.id, knowledgeBaseId: item.id, knowledgeBaseNameSnapshot: item.name, selectionOrder })) });
  await db.applicationMcpServer.create({ data: { applicationId: source.id, mcpServerId: sourceMcp.id, mcpServerNameSnapshot: sourceMcp.name, selectionOrder: 0 } });
  const versionInput = { version_number: "1.0.0", usage_instructions: "Connect your own reporting account and select the required documents." };
  await service.publish(actor(author), source.id, versionInput);
  const shared = await service.share(actor(author), source.id, { ...versionInput, target: { grantee_type: "user", user_id: installer.id, usage_modes: ["install"] } }, context);
  assert(shared.version_id);
  const copy = await service.install(actor(installer), source.id, { name: "My setup reports", channel: "direct", version_id: shared.version_id }, context);
  const release = await center.submit(actor(author), source.id, { ...versionInput, usage_modes: ["install"], release_notes: "Setup fixture" }, context);
  await center.review(actor(admin), release.id, { decision: "approved", comment: "" }, context);
  const centerCopy = await service.install(actor(centerInstaller), source.id, { name: "Center setup reports", channel: "center", version_id: release.version_id }, context);
  const originalGuide = await service.installationSetup(actor(installer), copy.id);
  assert.equal(originalGuide.items.length, 5);
  assert.equal(originalGuide.items[0]?.status, "credentials_required");
  assert.equal(originalGuide.can_complete, false);
  assert.equal((await service.installationSetup(actor(centerInstaller), centerCopy.id)).items.length, 5);
  assert.equal(await db.credentialBinding.count({ where: { userId: installer.id } }), 0);
  await assert.rejects(service.resolveRuntime(installer.id, copy.id), { code: "APPLICATION_DISABLED" });
  const revision = (guide: ApplicationSetupRevision): ApplicationSetupRevision => ({ installed_version_id: guide.installed_version_id, updated_at: guide.updated_at });
  const bind = async (type: ApplicationSetupBindingInput["type"], position: number, resourceId: string) => {
    const guide = await service.installationSetup(actor(installer), copy.id);
    return service.saveInstallationSetup(actor(installer), copy.id, { ...revision(guide), type, position, resource_id: resourceId }, context);
  };
  await assert.rejects(bind("knowledge_base", 0, sourceKnowledge[0]!.id), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  await bind("knowledge_base", 1, ownKnowledge[1]!.id);
  const partial = await service.installationSetup(actor(installer), copy.id);
  assert.deepEqual(partial.items.filter(item => item.type === "knowledge_base").map(item => item.resource_id), [null, ownKnowledge[1]!.id]);
  await service.saveInstallationSetupModel(actor(installer), copy.id, { ...revision(partial), model: "setup-model", reasoning_effort: "high" }, context);
  assert.deepEqual((await service.installationSetup(actor(installer), copy.id)).items.filter(item => item.type === "knowledge_base").map(item => item.resource_id), [null, ownKnowledge[1]!.id]);
  await assert.rejects(service.saveInstallationSetup(actor(installer), copy.id, { ...revision(originalGuide), type: "knowledge_base", position: 0, resource_id: ownKnowledge[0]!.id }, context), { code: "CONFLICT" });
  await bind("knowledge_base", 0, ownKnowledge[0]!.id);
  await bind("mcp_server", 0, ownMcp.id);
  const pending = await service.installationSetup(actor(installer), copy.id);
  await assert.rejects(service.completeInstallationSetup(actor(installer), copy.id, revision(pending), context), { code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  const localPlugin = pending.items.find(item => item.type === "plugin")?.resource_id;
  assert(localPlugin);
  credentialReady.add(localPlugin);
  let ready = await service.installationSetup(actor(installer), copy.id);
  assert(ready.can_complete && !ready.can_use);
  await service.completeInstallationSetup(actor(installer), copy.id, revision(ready), context);
  ready = await service.installationSetup(actor(installer), copy.id);
  assert(ready.can_use);
  const versionCount = await db.applicationVersion.count({ where: { applicationId: copy.id } });
  await service.completeInstallationSetup(actor(installer), copy.id, revision(ready), context);
  assert.equal(await db.applicationVersion.count({ where: { applicationId: copy.id } }), versionCount);
  assert.deepEqual((await service.resolveRuntime(installer.id, copy.id)).knowledgeBaseIds, ownKnowledge.slice(0, 2).map(item => item.id));
  await bind("knowledge_base", 0, ownKnowledge[3]!.id);
  assert.equal((await service.distributionSummaries(actor(installer))).find(item => item.application_id === copy.id)?.installation?.setup_required, true);
  ready = await service.installationSetup(actor(installer), copy.id);
  assert(!ready.can_use && ready.can_complete);
  await service.completeInstallationSetup(actor(installer), copy.id, revision(ready), context);
  assert.deepEqual((await service.resolveRuntime(installer.id, copy.id)).knowledgeBaseIds, [ownKnowledge[3]!.id, ownKnowledge[1]!.id]);

  // Existing installed data and personal configuration must survive new requirements and source reordering.
  await db.$transaction(async tx => {
    await tx.applicationKnowledgeBase.deleteMany({ where: { applicationId: source.id } });
    await tx.applicationKnowledgeBase.createMany({ data: [sourceKnowledge[1]!, sourceKnowledge[0]!, sourceKnowledge[2]!].map((item, selectionOrder) => ({ applicationId: source.id, knowledgeBaseId: item.id, knowledgeBaseNameSnapshot: item.name, selectionOrder })) });
  });
  await service.publish(actor(author), source.id, { ...versionInput, version_number: "2.0.0" });
  const next = await service.share(actor(author), source.id, { ...versionInput, version_number: "2.0.0", target: null }, context);
  assert(next.version_id);
  await service.updateInstallation(actor(installer), copy.id, next.version_id, context);
  const upgraded = await service.installationSetup(actor(installer), copy.id);
  assert.deepEqual(upgraded.items.filter(item => item.type === "knowledge_base").map(item => item.resource_id), [ownKnowledge[1]!.id, ownKnowledge[3]!.id, null]);
  assert.equal(upgraded.can_complete, false);
  assert.equal((await db.application.findUniqueOrThrow({ where: { id: copy.id } })).status, "disabled");
  await bind("knowledge_base", 2, ownKnowledge[2]!.id);
  ready = await service.installationSetup(actor(installer), copy.id);
  await service.completeInstallationSetup(actor(installer), copy.id, revision(ready), context);
  assert.deepEqual((await service.resolveRuntime(installer.id, copy.id)).knowledgeBaseIds, [ownKnowledge[1]!.id, ownKnowledge[3]!.id, ownKnowledge[2]!.id]);

  const app = Fastify();
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(applicationRoutes, { service, usageAnalytics: { applicationReport: async () => { throw new Error("unused"); } },
    createConversation: async () => { throw new Error("unused"); }, resolveActor: async request => {
      const user = users.find(item => item.id === request.headers["x-setup-user"]);
      if (!user) throw new AppError("AUTH_REQUIRED");
      return actor(user);
    } });
  try {
    const path = `/${copy.id}/installation/setup`;
    assert.equal((await app.inject(path)).statusCode, 401);
    assert.equal((await app.inject({ url: path, headers: { "x-setup-user": author.id } })).statusCode, 404);
    const response = await app.inject({ url: path, headers: { "x-setup-user": installer.id } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.json().data.can_use, true);
    for (const privateValue of ["storagePath", "REPORT_KEY", "environment", "encryptedCredential"]) assert(!response.body.includes(privateValue));
  } finally { await app.close(); }
  const grant = await db.applicationGrant.findFirstOrThrow({ where: { applicationId: source.id, userId: installer.id } });
  await service.revokeGrant(actor(author), source.id, grant.id, context);
  assert((await service.installationSetup(actor(installer), copy.id)).can_use);
  assert.equal((await service.resolveRuntime(installer.id, copy.id)).applicationOwnerId, installer.id);
  console.log("PASS setup guide: direct/center packages, personal authorization, saved partial steps, activation, idempotent completion, source-reordered upgrades, owner-only HTTP and revoked-source independence.");
}
