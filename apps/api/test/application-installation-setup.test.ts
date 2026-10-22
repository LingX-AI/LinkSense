import { describe, expect, it, vi } from "vitest";
import { readApplicationInstallationSetup, saveApplicationSetupBinding, saveApplicationSetupModel } from "../src/modules/applications/installation-setup.js";
import { AppError } from "../src/lib/errors.js";
import { ApplicationService } from "../src/modules/applications/service.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const APP = "10000000-0000-4000-8000-000000000002";
const SOURCE = "10000000-0000-4000-8000-000000000003";
const VERSION = "10000000-0000-4000-8000-000000000004";
const PLUGIN = "20000000-0000-4000-8000-000000000001";
const LOCAL_PLUGIN = "20000000-0000-4000-8000-000000000002";
const KNOWLEDGE = "20000000-0000-4000-8000-000000000003";
const PERSONAL_KNOWLEDGE = "20000000-0000-4000-8000-000000000004";
const MCP = "20000000-0000-4000-8000-000000000005";
const NOW = new Date("2026-10-22T00:00:00.000Z");

function fixture() {
  const application = { id: APP, ownerId: OWNER, name: "Reports", description: null, instructions: "Private instructions", usageInstructions: "",
    iconPreset: "bot", iconObjectKey: null, developmentOnly: false, status: "disabled", kind: "standard", model: null, reasoningEffort: null, updatedAt: NOW };
  const definition = { schemaVersion: 1, name: "Reports", description: null, iconPreset: "bot", iconObjectKey: null,
    kind: "standard", instructions: "Private instructions", usageInstructions: "Connect your own reporting account.", model: null,
    reasoningEffort: null, interactivePackageId: null, capabilities: [{ id: PLUGIN, type: "plugin", name: "Reports plugin", description: "Query reports",
      sourceType: "local", storagePath: "/private/path", revision: NOW.toISOString(), contentSha256: "a".repeat(64), manifestJson: null,
      riskSummaryJson: { declared_environment_keys: ["REPORT_KEY"] } }], knowledgeBaseIds: [KNOWLEDGE], mcpServerIds: [MCP] };
  const baseline = { name: "Reports", instructions: "Private instructions", model: null, reasoningEffort: null, interactivePackageId: null,
    capabilities: [{ sourceId: PLUGIN, installedId: LOCAL_PLUGIN, contentSha256: "a".repeat(64) }], requiredKnowledgeBases: 1, requiredMcpServers: 1 };
  const installation = { applicationId: APP, ownerId: OWNER, sourceApplicationId: SOURCE, installedVersionId: VERSION, baselineJson: baseline };
  const knowledgeBindings: { knowledgeBaseId: string; selectionOrder: number; knowledgeBaseNameSnapshot: string }[] = [];
  const mcpBindings: { mcpServerId: string; selectionOrder: number; mcpServerNameSnapshot: string }[] = [];
  const db = {
    application: { findFirst: vi.fn(async () => application), findUnique: vi.fn(async () => ({ ownerId: "publisher" })), updateMany: vi.fn(async () => ({ count: 1 })) },
    applicationInstallation: { findFirst: vi.fn(async () => installation) },
    applicationVersion: { findFirst: vi.fn<(input: { where: { applicationId: string } }) => Promise<{ id: string; versionLabel: string; definitionJson: typeof definition }>>(async () => ({ id: VERSION, versionLabel: "1.0.0", definitionJson: definition })) },
    applicationRuntimeInstallation: { findUnique: vi.fn(async () => ({ versionId: VERSION })) },
    applicationCapability: { findMany: vi.fn(async () => [{ capabilityId: LOCAL_PLUGIN, capabilityNameSnapshot: "Reports plugin", capabilityTypeSnapshot: "plugin", selectionOrder: 0 }]) },
    applicationKnowledgeBase: { findMany: vi.fn(async () => knowledgeBindings), deleteMany: vi.fn(), create: vi.fn() },
    applicationMcpServer: { findMany: vi.fn(async () => mcpBindings), deleteMany: vi.fn(), create: vi.fn() },
    capability: { findMany: vi.fn(async () => [{ id: LOCAL_PLUGIN, type: "plugin", name: "Reports plugin", status: "active", riskSummaryJson: definition.capabilities[0]!.riskSummaryJson }]) },
    knowledgeBase: { findMany: vi.fn(async ({ where }: { where: { ownerId: string } }) => where.ownerId === OWNER
      ? [{ id: PERSONAL_KNOWLEDGE, name: "My handbook", lifecycleStatus: "active", availabilityStatus: "enabled" }]
      : [{ id: KNOWLEDGE, name: "Required handbook" }]), findFirst: vi.fn(async () => ({ id: PERSONAL_KNOWLEDGE, name: "My handbook" })) },
    mcpServer: { findMany: vi.fn(async ({ where }: { where: { ownerId: string } }) => where.ownerId === OWNER ? [] : [{ id: MCP, name: "Reporting system" }]) },
    $queryRaw: vi.fn(),
  };
  const credentials = { resolveForCapability: vi.fn(async (): Promise<{ ok: true; environment: Record<string, string> } | { ok: false }> => ({ ok: false })) };
  const models = { resolveRuntime: vi.fn(async () => ({})), resolveRuntimeForSelection: vi.fn(async () => ({})) };
  const read = () => readApplicationInstallationSetup(db as never, credentials as never, models as never, OWNER, APP);
  return { db, credentials, models, application, installation, definition, knowledgeBindings, mcpBindings, read };
}

describe("installed application setup guide", () => {
  it("keeps the installed release's missing requirements and identifies credentials without exposing secrets", async () => {
    const { read, db } = fixture();
    const { guide } = await read();
    expect(guide).toMatchObject({ installed_version_id: VERSION, can_complete: false, can_use: false });
    expect(guide.items.map(item => [item.type, item.name, item.status])).toEqual([
      ["plugin", "Reports plugin", "credentials_required"], ["knowledge_base", "Required handbook", "unconfigured"],
      ["mcp_server", "Reporting system", "unconfigured"], ["model", null, "configured"],
    ]);
    expect(db.applicationVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: VERSION, applicationId: SOURCE, assetsReady: true } }));
    for (const secret of ["Private instructions", "/private/path", "riskSummaryJson", "REPORT_KEY", "environment"]) expect(JSON.stringify(guide)).not.toContain(secret);
  });

  it.each(["application", "installation"])("rejects access before reading publisher metadata when %s is not owned", async missing => {
    const { db, read } = fixture();
    if (missing === "application") db.application.findFirst.mockResolvedValueOnce(null as never);
    else db.applicationInstallation.findFirst.mockResolvedValueOnce(null as never);
    await expect(read()).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(db.applicationVersion.findFirst).not.toHaveBeenCalled();
    expect(db.knowledgeBase.findMany).not.toHaveBeenCalled();
  });

  it("preserves a later configured slot while an earlier requirement is still missing", async () => {
    const { read, definition, knowledgeBindings } = fixture();
    definition.knowledgeBaseIds.push("20000000-0000-4000-8000-000000000006");
    knowledgeBindings.push({ knowledgeBaseId: PERSONAL_KNOWLEDGE, knowledgeBaseNameSnapshot: "My handbook", selectionOrder: 1 });
    const items = (await read()).guide.items.filter(item => item.type === "knowledge_base");
    expect(items.map(item => [item.position, item.resource_id, item.status])).toEqual([[0, null, "unconfigured"], [1, PERSONAL_KNOWLEDGE, "configured"]]);
  });

  it("recognizes existing plugin and Skill bindings after a user reorders them", async () => {
    const { db, read, definition, installation, credentials } = fixture();
    const skill = "30000000-0000-4000-8000-000000000001", localSkill = "30000000-0000-4000-8000-000000000002";
    definition.capabilities.push({ ...definition.capabilities[0]!, id: skill, type: "skill", name: "Reports Skill", riskSummaryJson: { declared_environment_keys: [] } });
    installation.baselineJson.capabilities.push({ sourceId: skill, installedId: localSkill, contentSha256: "a".repeat(64) });
    db.applicationCapability.findMany.mockResolvedValue([
      { capabilityId: localSkill, capabilityNameSnapshot: "Reports Skill", capabilityTypeSnapshot: "skill", selectionOrder: 0 },
      { capabilityId: LOCAL_PLUGIN, capabilityNameSnapshot: "Reports plugin", capabilityTypeSnapshot: "plugin", selectionOrder: 1 },
    ]);
    db.capability.findMany.mockResolvedValue([
      { id: LOCAL_PLUGIN, type: "plugin", name: "Reports plugin", status: "active", riskSummaryJson: { declared_environment_keys: ["REPORT_KEY"] } },
      { id: localSkill, type: "skill", name: "Reports Skill", status: "active", riskSummaryJson: { declared_environment_keys: [] } },
    ]);
    credentials.resolveForCapability.mockResolvedValue({ ok: true, environment: {} });
    expect((await read()).guide.items.slice(0, 2).map(item => [item.type, item.position, item.resource_id, item.status])).toEqual([
      ["plugin", 1, LOCAL_PLUGIN, "configured"], ["skill", 0, localSkill, "configured"],
    ]);
    await expect(saveApplicationSetupBinding(db as never, OWNER, APP, { installed_version_id: VERSION, updated_at: NOW.toISOString(), type: "plugin", position: 99, resource_id: LOCAL_PLUGIN })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("still explains an old installed release after publisher resources are deleted", async () => {
    const { read, db } = fixture();
    db.application.findUnique.mockResolvedValue(null as never);
    const guide = (await read()).guide;
    expect(guide.items.find(item => item.type === "knowledge_base")).toMatchObject({ name: null, status: "unconfigured" });
    expect(guide.usage_instructions).toContain("reporting account");
  });

  it("checks current model availability and propagates unexpected infrastructure errors", async () => {
    const { read, models } = fixture();
    models.resolveRuntime.mockRejectedValueOnce(new AppError("MODEL_PROVIDER_NOT_CONFIGURED"));
    expect((await read()).guide.items.at(-1)?.status).toBe("unavailable");
    models.resolveRuntime.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(read()).rejects.toThrow("database unavailable");
  });

  it("rejects stale guide revisions before changing bindings", async () => {
    const { db } = fixture();
    await expect(saveApplicationSetupBinding(db as never, OWNER, APP, {
      installed_version_id: VERSION, updated_at: new Date(0).toISOString(), type: "knowledge_base", position: 0, resource_id: PERSONAL_KNOWLEDGE,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.applicationKnowledgeBase.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects foreign resources before changing or deleting an existing binding", async () => {
    const { db } = fixture();
    db.knowledgeBase.findFirst.mockResolvedValue(null as never);
    await expect(saveApplicationSetupBinding(db as never, OWNER, APP, {
      installed_version_id: VERSION, updated_at: NOW.toISOString(), type: "knowledge_base", position: 0, resource_id: PERSONAL_KNOWLEDGE,
    })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(db.knowledgeBase.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: OWNER }) }));
    expect(db.applicationKnowledgeBase.deleteMany).not.toHaveBeenCalled();
  });

  it("saves an owned resource to its own slot and leaves other configuration intact", async () => {
    const { db } = fixture();
    await saveApplicationSetupBinding(db as never, OWNER, APP, { installed_version_id: VERSION, updated_at: NOW.toISOString(), type: "knowledge_base", position: 0, resource_id: PERSONAL_KNOWLEDGE });
    expect(db.applicationKnowledgeBase.create).toHaveBeenCalledWith({ data: { applicationId: APP, knowledgeBaseId: PERSONAL_KNOWLEDGE, knowledgeBaseNameSnapshot: "My handbook", selectionOrder: 0 } });
    expect(db.applicationMcpServer.deleteMany).not.toHaveBeenCalled();
    expect(db.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: APP, ownerId: OWNER, updatedAt: NOW } }));
  });

  it("saves a validated model before other requirements are configured without rewriting their bindings", async () => {
    const { db, models } = fixture();
    await saveApplicationSetupModel(db as never, models as never, OWNER, APP, { installed_version_id: VERSION, updated_at: NOW.toISOString(), model: "report-model", reasoning_effort: "high" });
    expect(models.resolveRuntimeForSelection).toHaveBeenCalledWith("report-model", "high");
    expect(db.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ model: "report-model", reasoningEffort: "high" }) }));
    expect(db.applicationKnowledgeBase.deleteMany).not.toHaveBeenCalled();
    expect(db.applicationMcpServer.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects unavailable models and mismatched model settings without saving them", async () => {
    const { db, models } = fixture();
    models.resolveRuntimeForSelection.mockRejectedValueOnce(new AppError("MODEL_SELECTION_INVALID"));
    const input = { installed_version_id: VERSION, updated_at: NOW.toISOString(), model: "removed-model", reasoning_effort: "high" as const };
    await expect(saveApplicationSetupModel(db as never, models as never, OWNER, APP, input)).rejects.toMatchObject({ code: "MODEL_SELECTION_INVALID" });
    await expect(saveApplicationSetupModel(db as never, models as never, OWNER, APP, { ...input, model: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(db.application.updateMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate bindings, unknown steps and stale installed versions before writing", async () => {
    const { db, knowledgeBindings, definition } = fixture();
    definition.knowledgeBaseIds.push("20000000-0000-4000-8000-000000000006");
    knowledgeBindings.push({ knowledgeBaseId: PERSONAL_KNOWLEDGE, knowledgeBaseNameSnapshot: "My handbook", selectionOrder: 0 });
    const input = { installed_version_id: VERSION, updated_at: NOW.toISOString(), type: "knowledge_base" as const, position: 1, resource_id: PERSONAL_KNOWLEDGE };
    await expect(saveApplicationSetupBinding(db as never, OWNER, APP, input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(saveApplicationSetupBinding(db as never, OWNER, APP, { ...input, position: 7 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(saveApplicationSetupBinding(db as never, OWNER, APP, { ...input, installed_version_id: APP })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.applicationKnowledgeBase.deleteMany).not.toHaveBeenCalled();
  });

  it("does not report ready drafts as usable before they are activated", async () => {
    const { db, read, definition, credentials, application, knowledgeBindings } = fixture();
    definition.mcpServerIds = [];
    knowledgeBindings.push({ knowledgeBaseId: PERSONAL_KNOWLEDGE, knowledgeBaseNameSnapshot: "My handbook", selectionOrder: 0 });
    credentials.resolveForCapability.mockResolvedValue({ ok: true, environment: { REPORT_KEY: "private-value" } });
    expect((await read()).guide).toMatchObject({ can_complete: true, can_use: false });
    application.status = "active";
    expect((await read()).guide.can_use).toBe(false);
    db.applicationVersion.findFirst.mockImplementation(async ({ where }: { where: { applicationId: string } }) => ({ id: VERSION, versionLabel: "1.0.0",
      definitionJson: where.applicationId === SOURCE ? definition : { ...definition, capabilities: definition.capabilities.map(item => ({ ...item, id: LOCAL_PLUGIN })), knowledgeBaseIds: [PERSONAL_KNOWLEDGE] } }));
    expect((await read()).guide).toMatchObject({ can_complete: true, can_use: true });
  });

  it("keeps completion blocked for missing capabilities and outdated configuration", async () => {
    const { db, credentials, models } = fixture();
    const publications = { capture: vi.fn() };
    const gate = { change: vi.fn(async (_owner: string, _app: string, action: (assertCurrent: () => void) => Promise<unknown>) => action(() => {})) };
    const service = new ApplicationService(db as never, models as never, { write: vi.fn() } as never, credentials as never,
      undefined, undefined, publications as never, undefined, { gate } as never);
    const actor = { id: OWNER, role: "user" as const, status: "active" as const };
    await expect(service.completeInstallationSetup(actor, APP, { installed_version_id: VERSION, updated_at: NOW.toISOString() }, {})).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    await expect(service.completeInstallationSetup(actor, APP, { installed_version_id: VERSION, updated_at: new Date(0).toISOString() }, {})).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.installationSetup({ ...actor, status: "disabled" }, APP)).rejects.toMatchObject({ code: "USER_DISABLED" });
    gate.change.mockRejectedValueOnce(new AppError("APPLICATION_RUNTIME_BUSY"));
    await expect(service.completeInstallationSetup(actor, APP, { installed_version_id: VERSION, updated_at: NOW.toISOString() }, {})).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    expect(publications.capture).not.toHaveBeenCalled();
  });
});
