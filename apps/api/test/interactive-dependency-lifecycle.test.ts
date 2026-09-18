import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { interactiveApplicationManifestSchema, type ApplicationIconPreset } from "@linksense/shared";
import type { Application, ApplicationCapability, InteractiveApplicationPackage, Prisma } from "../src/generated/prisma/client.js";
import { ApplicationService } from "../src/modules/applications/service.js";
import { ApplicationPublicationService } from "../src/modules/applications/publication-service.js";
import { AppError } from "../src/lib/errors.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const SKILL = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const actor = { id: OWNER, role: "user" as const, status: "active" as const, ipAddress: "192.0.2.1" };
const now = new Date("2026-09-16T00:00:00Z");

async function archive(version = "1", ids = [SKILL], preset?: ApplicationIconPreset): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ schema_version: 1, id: "review", name: "Review", version, sdk_version: 1, ...(preset ? { icon_preset: preset } : {}),
    instructions: `Review instructions ${version}`, dependencies: { skills: ids.map(id => ({ id, name: "Review skill" })) } }));
  zip.file("index.html", "<!doctype html><title>Review</title>");
  return zip.generateAsync({ type: "nodebuffer" });
}

function fixture() {
  let application: Application | null = null;
  const packages: InteractiveApplicationPackage[] = [];
  let bindings: Array<Omit<ApplicationCapability, "id">> = [];
  const skills = [{ id: SKILL, ownerId: OWNER, type: "skill", name: "Review skill", status: "active", description: null, updatedAt: now },
    { id: OTHER, ownerId: OWNER, type: "skill", name: "Alternative", status: "active", description: null, updatedAt: now }];
  const database = {
    $queryRaw: vi.fn(async () => [{ id: SKILL }]),
    applicationRuntimeInstallation: { findMany: vi.fn(async () => []), findUnique: vi.fn(async (): Promise<{ versionId: string } | null> => null), upsert: vi.fn(async () => ({})) },
    application: {
      findMany: vi.fn(async ({ where }: { where: { ownerId?: string } }) => application && (!where.ownerId || where.ownerId === application.ownerId) ? [application] : []),
      findFirst: vi.fn(async ({ where }: { where: { ownerId?: string; id: string } }) => application && where.id === application.id && (!where.ownerId || where.ownerId === application.ownerId) ? application : null),
      create: vi.fn(async ({ data }: { data: Pick<Application, "id" | "ownerId" | "name" | "kind" | "interactivePackageId" | "interactiveDependencyBindings" | "instructions"> }) => {
        application = { developmentOnly: false, iconPreset: "sparkles", iconObjectKey: null, description: null, model: null, reasoningEffort: null, usageInstructions: "", publishedVersionId: null,
          status: "active", deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now, ...data };
        return application;
      }),
      updateMany: vi.fn(async ({ data }: { data: Partial<Application> }) => {
        if (!application) throw new Error("fixture application missing");
        application = { ...application, ...data }; return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Partial<Application> }) => {
        if (!application) throw new Error("fixture application missing");
        application = { ...application, ...data }; return application;
      }),
    },
    interactiveApplicationPackage: {
      create: vi.fn(async ({ data }: { data: Omit<InteractiveApplicationPackage, "createdAt"> }) => { const item = { ...data, createdAt: now }; packages.push(item); return item }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; applicationId: string } }) => packages.find(item => item.id === where.id && item.applicationId === where.applicationId) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => packages.find(item => item.id === where.id) ?? null),
      findMany: vi.fn(async () => packages),
    },
    interactiveApplicationAsset: { createMany: vi.fn() },
    applicationCapability: {
      findMany: vi.fn(async () => bindings),
      deleteMany: vi.fn(async () => { bindings = [] }),
      createMany: vi.fn(async ({ data }: { data: Array<Omit<ApplicationCapability, "id" | "createdAt" | "updatedAt">> }) => { bindings.push(...data.map(item => ({ ...item, createdAt: now, updatedAt: now }))) }),
    },
    applicationKnowledgeBase: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    applicationMcpServer: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    capability: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; ownerId?: string; status?: string } }) => skills.filter(item => where.id.in.includes(item.id) && (!where.ownerId || item.ownerId === where.ownerId) && (!where.status || item.status === where.status))) },
    knowledgeBase: { findMany: vi.fn(async () => []) }, mcpServer: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: OWNER, name: "Owner" }]), findFirst: vi.fn(async () => ({ id: OWNER, selfRegisteredAt: null })) },
    userGroupMember: { findMany: vi.fn(async () => []) }, applicationGrant: { findMany: vi.fn(async () => []) },
    applicationInstallation: { findUnique: vi.fn(async (): Promise<{ baselineJson: Prisma.JsonValue } | null> => null), findFirst: vi.fn(async () => null) },
    applicationVersion: { findFirst: vi.fn(async () => null), findMany: vi.fn(async (): Promise<Array<{ id: string; definitionJson: Prisma.JsonValue }>> => []) },
  };
  const prisma = { ...database, $transaction: vi.fn(async <T>(run: (tx: typeof database) => Promise<T>) => run(database)) };
  const assets = { put: vi.fn(), remove: vi.fn(), get: vi.fn() };
  const publications = { capture: vi.fn<ApplicationPublicationService["capture"]>(), readVersion: vi.fn(),
    settings: vi.fn(async () => ({ version_number: "1.3.0", highest_version_number: "1.3.0", usage_instructions: "Shared guide" })) };
  const gate = { change: vi.fn(async (_owner: string, _id: string, action: (assertCurrent: () => void) => Promise<unknown>) => action(() => {})) };
  const service = new ApplicationService(prisma as unknown as ConstructorParameters<typeof ApplicationService>[0],
    { resolveRuntimeForSelection: vi.fn() } as unknown as ConstructorParameters<typeof ApplicationService>[1],
    { write: vi.fn() } as unknown as ConstructorParameters<typeof ApplicationService>[2],
    { resolveForCapability: vi.fn() }, undefined, assets,
    publications as unknown as ConstructorParameters<typeof ApplicationService>[6], undefined,
    { gate } as never);
  return { service, database, prisma, assets, publications, skills, packages, gate, draftRuntime: async () => {
    if (!application) throw new Error("missing application");
    const previous = application.developmentOnly; application.developmentOnly = true;
    try { return await service.resolvePreviewRuntime(OWNER, application.id); } finally { application.developmentOnly = previous; }
  }, app: () => {
    if (!application) throw new Error("fixture application missing"); return application;
  } };
}

describe("interactive dependency lifecycle", () => {
  it.each(["1.0.0", "1.1.0"])("blocks package %s while a task is running before uploading or changing anything", async version => {
    const f = fixture();
    const app = await f.service.importInteractive(actor, await archive("1.0.0"), {});
    f.assets.put.mockClear();
    f.gate.change.mockRejectedValueOnce(new AppError("APPLICATION_RUNTIME_BUSY"));
    await expect(f.service.updateInteractivePackage(actor, app.id, await archive(version), {}, [], { release: { version_number: version, usage_instructions: "" } })).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    expect(f.packages).toHaveLength(1);
    expect(f.app().interactivePackageId).toBe(app.interactive_package?.id);
    expect(f.assets.put).not.toHaveBeenCalled();
    expect(f.publications.capture).not.toHaveBeenCalled();
  });
  it("previews parsed application metadata and dependencies without creating or publishing an application", async () => {
    const f = fixture();
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ schema_version: 1, id: "review", name: "Request review", description: "Review procurement requests.", version: "1.2.3", sdk_version: 1 }));
    zip.file("index.html", "<!doctype html><title>Review</title>");
    const preview = await f.service.previewInteractiveDependencies(actor, await zip.generateAsync({ type: "nodebuffer" }));
    expect(preview).toEqual({ application: { name: "Request review", description: "Review procurement requests.", version: "1.2.3" }, items: [] });
    expect(f.database.application.create).not.toHaveBeenCalled();
    expect(f.assets.put).not.toHaveBeenCalled();
    expect(f.publications.capture).not.toHaveBeenCalled();
  });
  it.each([undefined, "sparkles", "book-open"] as const)("uses the cube default without overwriting a declared preset: %s", async (preset) => {
    const f = fixture();
    const app = await f.service.importInteractive(actor, await archive("1", [], preset), {});
    expect(app.icon).toEqual({ type: "preset", preset: preset ?? "bot" });
    expect(f.app().iconPreset).toBe(preset ?? "bot");
  });
  it("edits an existing interactive app's presentation even when its declared resource is missing, preserving its runtime", async () => {
    const f = fixture();
    const app = await f.service.importInteractive(actor, await archive(), {});
    const before = { ...f.app() };
    f.skills.splice(0);
    f.database.applicationCapability.deleteMany.mockClear();
    const edited = await f.service.update(actor, app.id, { name: "Renamed", description: "Edited description", icon: { type: "preset", preset: "book-open" } }, {});
    expect(edited).toMatchObject({ name: "Renamed", description: "Edited description", icon: { type: "preset", preset: "book-open" } });
    expect(f.app()).toMatchObject({ interactivePackageId: before.interactivePackageId, instructions: before.instructions, interactiveDependencyBindings: before.interactiveDependencyBindings });
    expect(f.database.applicationCapability.deleteMany).not.toHaveBeenCalled();
    await expect(f.service.update({ ...actor, id: OTHER }, app.id, { name: "Not mine" }, {})).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(f.service.update({ ...actor, status: "disabled" }, app.id, { name: "Denied" }, {})).rejects.toMatchObject({ code: "USER_DISABLED" });
    await expect(f.service.update(actor, app.id, { name: "Runtime bypass", instructions: "override" }, {})).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
  });

  it("applies package presets and keeps an older package without icon fields usable", async () => {
    const f = fixture();
    const zip = await JSZip.loadAsync(await archive("1", []));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    zip.file("manifest.json", JSON.stringify({ ...manifest, icon_preset: "book-open" }));
    const imported = await f.service.importInteractive(actor, await zip.generateAsync({ type: "nodebuffer" }), {});
    expect(imported.icon).toEqual({ type: "preset", preset: "book-open" });
    const old = await f.service.updateInteractivePackage(actor, imported.id, await archive("2", []), {});
    expect(old.icon).toEqual({ type: "preset", preset: "book-open" });
    expect((await f.draftRuntime()).interactivePackageId).toBe(f.app().interactivePackageId);
    f.app().iconObjectKey = "applications/old/custom.png";
    zip.file("manifest.json", JSON.stringify({ ...manifest, version: "3", icon_preset: "lightbulb", icon: null }));
    const changed = await f.service.updateInteractivePackage(actor, old.id, await zip.generateAsync({ type: "nodebuffer" }), {});
    expect(changed.icon).toEqual({ type: "preset", preset: "lightbulb" });
    expect(f.app().iconObjectKey).toBeNull();
  });
  it("imports unmatched declarations successfully, retains counts, and blocks draft execution and sharing", async () => {
    const f = fixture(); f.skills.splice(0);
    const imported = await f.service.importInteractive(actor, await archive(), {});
    expect(imported.capability_count).toBe(1);
    expect(imported.dependencies_available).toBe(false);
    expect(f.app().interactiveDependencyBindings).toEqual([{ type: "skill", id: SKILL, resource_id: null }]);
    expect(f.database.applicationCapability.createMany).not.toHaveBeenCalled();
    await expect(f.draftRuntime()).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    await expect(f.service.captureDistributionVersion(actor, imported.id, { version_number: "1.0.0", usage_instructions: "" }, vi.fn())).rejects.toMatchObject({ code: "APPLICATION_PUBLICATION_REQUIRED" });
    expect(f.publications.capture).not.toHaveBeenCalled();
  });
  it("allows an explicit skip, later maps to an owned resource, and uses only that resource at runtime", async () => {
    const f = fixture();
    const imported = await f.service.importInteractive(actor, await archive(), {}, [{ type: "skill", id: SKILL, resource_id: null }]);
    expect(imported.dependencies_available).toBe(false);
    const updated = await f.service.updateInteractiveDependencies(actor, imported.id, [{ type: "skill", id: SKILL, resource_id: OTHER }], {});
    expect(updated.dependencies_available).toBe(true);
    expect((await f.draftRuntime()).capabilityIds).toEqual([OTHER]);
    expect((await f.service.interactiveDependencies(actor, imported.id)).items[0]).toMatchObject({ id: SKILL, resource_id: OTHER, resource_name: "Alternative" });
  });
  it("preserves mappings for unchanged declarations, resolves new ones, and removes obsolete runtime bindings", async () => {
    const f = fixture();
    const imported = await f.service.importInteractive(actor, await archive(), {}, [{ type: "skill", id: SKILL, resource_id: OTHER }]);
    await f.service.updateInteractivePackage(actor, imported.id, await archive("2"), {});
    expect(f.app().interactiveDependencyBindings).toEqual([{ type: "skill", id: SKILL, resource_id: OTHER }]);
    await f.service.updateInteractivePackage(actor, imported.id, await archive("3", [OTHER]), {});
    expect(f.app().interactiveDependencyBindings).toEqual([{ type: "skill", id: OTHER, resource_id: OTHER }]);
    await f.service.updateInteractivePackage(actor, imported.id, await archive("4", []), {});
    expect((await f.draftRuntime()).capabilityIds).toEqual([]);
    expect(f.app().interactiveDependencyBindings).toEqual([]);
  });
  it("previews without writes and rejects unauthorized mappings and non-owner edits", async () => {
    const f = fixture();
    expect((await f.service.previewInteractiveDependencies(actor, await archive())).items[0]?.resource_id).toBe(SKILL);
    expect(f.database.application.create).not.toHaveBeenCalled(); expect(f.assets.put).not.toHaveBeenCalled();
    const imported = await f.service.importInteractive(actor, await archive(), {});
    await expect(f.service.updateInteractiveDependencies({ ...actor, id: OTHER }, imported.id, [], {})).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(f.service.interactiveDependencies({ ...actor, id: OTHER }, imported.id)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(f.service.previewInteractiveDependencies({ ...actor, id: OTHER }, await archive("2"), imported.id)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    f.skills.splice(1);
    await expect(f.service.updateInteractiveDependencies(actor, imported.id, [{ type: "skill", id: SKILL, resource_id: OTHER }], {})).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.app().interactiveDependencyBindings).toEqual([{ type: "skill", id: SKILL, resource_id: SKILL }]);
  });
  it("rejects interactive copy grants and leaves standard application sharing behavior untouched", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive(), {});
    await expect(f.service.share(actor, imported.id, { version_number: "1.0.0", usage_instructions: "", target: { grantee_type: "user", user_id: OTHER, usage_modes: ["install"] } }, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(f.service.updateGrantModes(actor, imported.id, OTHER, ["install"], {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.publications.capture).not.toHaveBeenCalled();
  });
  it("does not publish unresolved declarations even when the publication service is called directly", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive(), {}, [{ type: "skill", id: SKILL, resource_id: null }]);
    const publisher = new ApplicationPublicationService(f.prisma as unknown as ConstructorParameters<typeof ApplicationPublicationService>[0], "/unused");
    await expect(publisher.capture(OWNER, imported.id, { version_number: "1.0.0", usage_instructions: "" }, { complete: vi.fn() })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("prepares the edited draft while formal execution requires an installation", async () => {
    const f = fixture();
    const imported = await f.service.importInteractive(actor, await archive("1.3.0", []), {});
    const releasedPackage = f.app().interactivePackageId;
    const definition = { schemaVersion: 1, description: null, iconPreset: "bot", iconObjectKey: null, kind: "interactive", name: "Published", instructions: "Published instructions", usageInstructions: "", model: null, reasoningEffort: null,
      interactivePackageId: releasedPackage, capabilities: [], knowledgeBaseIds: [], mcpServerIds: [] };
    f.publications.readVersion.mockResolvedValue(definition);
    f.database.applicationVersion.findMany.mockResolvedValue([{ id: OTHER, definitionJson: definition }]);

    const updated = await f.service.updateInteractivePackage(actor, imported.id, await archive("1.4.0"), {});
    // Existing records from before automatic shared publication remain usable.
    f.app().publishedVersionId = OTHER;
    expect(updated).toMatchObject({ dependencies_available: true, capability_count: 1, interactive_package: { version: "1.4.0" } });
    const runtime = await f.draftRuntime();
    expect(runtime).toMatchObject({ applicationVersionId: null, publishedCapabilities: [], interactivePackageId: updated.interactive_package?.id, capabilityIds: [SKILL] });
    expect(runtime.instructions).toContain("Review instructions 1.4.0");
    expect(runtime.interactivePackageId).not.toBe(releasedPackage);
    await expect(f.service.resolveInteractiveRuntimePackage(actor, imported.id)).rejects.toMatchObject({ code: "APPLICATION_INSTALLATION_REQUIRED" });
    expect(f.app().publishedVersionId).toBe(OTHER);
    expect(f.packages).toHaveLength(2);
    f.app().model = "fixed-model";
    await expect(f.service.allowsUserModelSelection(OWNER, imported.id)).rejects.toMatchObject({ code: "APPLICATION_INSTALLATION_REQUIRED" });
  });
  it("blocks the owner's current package when new declarations are unresolved instead of silently using its shared snapshot", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive("1", []), {});
    const releasedPackage = f.app().interactivePackageId;
    const definition = { schemaVersion: 1, description: null, iconPreset: "bot", iconObjectKey: null, kind: "interactive", name: "Published", instructions: "Published instructions", usageInstructions: "", model: null, reasoningEffort: null,
      interactivePackageId: releasedPackage, capabilities: [], knowledgeBaseIds: [], mcpServerIds: [] };
    f.publications.readVersion.mockResolvedValue(definition);
    f.database.applicationVersion.findMany.mockResolvedValue([{ id: OTHER, definitionJson: definition }]);
    f.skills.splice(0);
    const updated = await f.service.updateInteractivePackage(actor, imported.id, await archive("2"), {});
    f.app().publishedVersionId = OTHER;
    expect(updated.dependencies_available).toBe(false);
    expect((await f.service.get(actor, imported.id)).dependencies_available).toBe(false);
    expect((await f.service.interactiveDependencies(actor, imported.id)).items[0]?.available).toBe(false);
    await expect(f.draftRuntime()).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.app().publishedVersionId).toBe(OTHER);
  });
  it.each([["1.3.0", "1.3.0"], ["1.4.0", "1.4.0"], ["1.2.0", "1.4.0"], ["custom-version", "1.4.0"]])("publishes package %s explicitly as %s without advancing sharing", async (version, label) => {
    const f = fixture();
    const imported = await f.service.importInteractive(actor, await archive("1.3.0", []), {});
    f.app().publishedVersionId = OTHER;
    f.app().usageInstructions = "Existing sharing guide";
    const complete = vi.fn();
    f.publications.capture.mockImplementation(async (_owner, applicationId, input, options) => {
      expect(f.app().interactivePackageId).toBe(imported.interactive_package?.id);
      await options.complete(f.prisma as unknown as Prisma.TransactionClient, {
        id: SKILL, applicationId, versionNumber: 2, purpose: "release", versionLabel: label, definitionJson: { schemaVersion: 1, description: null, iconPreset: "bot", iconObjectKey: null, kind: "interactive", name: "Review", instructions: "Review", usageInstructions: "", model: null, reasoningEffort: null, capabilities: [], knowledgeBaseIds: [], mcpServerIds: [], interactivePackageId: null }, assetsReady: true, createdBy: OWNER, createdAt: now,
      });
      return { version_id: SKILL, version_number: input.version_number, usage_instructions: input.usage_instructions };
    });
    const updated = await f.service.updateInteractivePackage(actor, imported.id, await archive(version), {}, [], { complete, release: { version_number: label, usage_instructions: "Existing sharing guide" } });
    expect(f.publications.capture).toHaveBeenCalledWith(OWNER, imported.id, { version_number: label, usage_instructions: "Existing sharing guide" }, expect.objectContaining({
      interactiveUpdate: expect.objectContaining({ packageId: updated.interactive_package?.id, name: "Review", capabilityIds: [SKILL], knowledgeBaseIds: [], mcpServerIds: [] }),
      runtimeInstructions: expect.stringContaining(`Review instructions ${version}`),
    }));
    expect(f.app().publishedVersionId).toBe(OTHER);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("keeps an existing shared package intact when publication or dependency validation fails", async () => {
    const f = fixture();
    const imported = await f.service.importInteractive(actor, await archive("1.3.0", []), {});
    f.app().publishedVersionId = OTHER;
    const before = { ...f.app() };
    f.publications.capture.mockRejectedValueOnce(new Error("Snapshot storage unavailable"));
    await expect(f.service.updateInteractivePackage(actor, imported.id, await archive("1.4.0"), {}, [], { release: { version_number: "1.4.0", usage_instructions: "" } })).rejects.toThrow("Snapshot storage unavailable");
    expect(f.app()).toEqual(before);
    expect(f.packages).toHaveLength(1);
    expect(f.assets.remove).toHaveBeenCalled();
    f.skills.splice(0);
    await expect(f.service.updateInteractivePackage(actor, imported.id, await archive("1.4.0"), {}, [], { release: { version_number: "1.4.0", usage_instructions: "" } })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.app()).toEqual(before);
    expect(f.publications.capture).toHaveBeenCalledOnce();
  });
  it("continues to read and execute a pre-change package with no dependency fields", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive("1", []), {});
    const package_ = f.packages[0]; if (!package_) throw new Error("fixture package missing");
    const { dependencies, ...oldManifest } = interactiveApplicationManifestSchema.parse(package_.manifestJson);
    expect(dependencies.skills).toEqual([]);
    package_.manifestJson = oldManifest;
    f.app().interactiveDependencyBindings = [] satisfies Prisma.JsonArray;
    expect((await f.service.get(actor, imported.id)).dependencies_available).toBe(true);
    expect((await f.draftRuntime()).interactivePackageId).toBe(package_.id);
  });
  it("keeps a historical interactive copy usable with its own bindings and captured instructions", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive("1", []), {});
    const package_ = f.packages[0]; if (!package_) throw new Error("fixture package missing");
    const { dependencies, ...oldManifest } = interactiveApplicationManifestSchema.parse(package_.manifestJson);
    expect(dependencies.skills).toEqual([]);
    package_.manifestJson = oldManifest;
    f.app().instructions = "Captured instructions for the independent copy";
    f.database.applicationInstallation.findUnique.mockResolvedValue({ baselineJson: {
      name: f.app().name, instructions: f.app().instructions, model: null, reasoningEffort: null,
      interactivePackageId: package_.id,
      capabilities: [{ sourceId: SKILL, installedId: OTHER, contentSha256: "a".repeat(64) }],
      requiredKnowledgeBases: 0, requiredMcpServers: 0,
    } });
    await f.database.applicationCapability.createMany({ data: [{ applicationId: imported.id, capabilityId: OTHER, capabilityNameSnapshot: "Alternative", capabilityTypeSnapshot: "skill", selectionOrder: 0 }] });
    const runtime = await f.draftRuntime();
    expect(runtime.capabilityIds).toEqual([OTHER]);
    expect(runtime.instructions).toBe(f.app().instructions);
    expect(runtime.interactivePackageId).toBe(package_.id);
    expect(runtime.applicationVersionId).toBeNull();
  });
});
