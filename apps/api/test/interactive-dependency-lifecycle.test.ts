import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { interactiveApplicationManifestSchema } from "@linksense/shared";
import type { Application, ApplicationCapability, InteractiveApplicationPackage, Prisma } from "../src/generated/prisma/client.js";
import { ApplicationService } from "../src/modules/applications/service.js";
import { ApplicationPublicationService } from "../src/modules/applications/publication-service.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const SKILL = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const actor = { id: OWNER, role: "user" as const, status: "active" as const, ipAddress: "192.0.2.1" };
const now = new Date("2026-09-16T00:00:00Z");

async function archive(version = "1", ids = [SKILL]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ schema_version: 1, id: "review", name: "Review", version, sdk_version: 1,
    dependencies: { skills: ids.map(id => ({ id, name: "Review skill" })) } }));
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
    application: {
      findMany: vi.fn(async ({ where }: { where: { ownerId?: string } }) => application && (!where.ownerId || where.ownerId === application.ownerId) ? [application] : []),
      findFirst: vi.fn(async ({ where }: { where: { ownerId?: string; id: string } }) => application && where.id === application.id && (!where.ownerId || where.ownerId === application.ownerId) ? application : null),
      create: vi.fn(async ({ data }: { data: Pick<Application, "id" | "ownerId" | "name" | "kind" | "interactivePackageId" | "interactiveDependencyBindings" | "instructions"> }) => {
        application = { iconPreset: "sparkles", iconObjectKey: null, description: null, model: null, reasoningEffort: null, usageInstructions: "", publishedVersionId: null,
          status: "active", deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now, ...data };
        return application;
      }),
      updateMany: vi.fn(async ({ data }: { data: Partial<Application> }) => {
        if (!application) throw new Error("fixture application missing");
        application = { ...application, ...data }; return { count: 1 };
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
    applicationVersion: { findMany: vi.fn(async () => []) },
  };
  const prisma = { ...database, $transaction: vi.fn(async <T>(run: (tx: typeof database) => Promise<T>) => run(database)) };
  const assets = { put: vi.fn(), remove: vi.fn(), get: vi.fn() };
  const publications = { capture: vi.fn(), readVersion: vi.fn() };
  const service = new ApplicationService(prisma as unknown as ConstructorParameters<typeof ApplicationService>[0],
    { resolveRuntimeForSelection: vi.fn() } as unknown as ConstructorParameters<typeof ApplicationService>[1],
    { write: vi.fn() } as unknown as ConstructorParameters<typeof ApplicationService>[2],
    { resolveForCapability: vi.fn() }, undefined, assets,
    publications as unknown as ConstructorParameters<typeof ApplicationService>[6]);
  return { service, database, prisma, assets, publications, skills, packages, app: () => {
    if (!application) throw new Error("fixture application missing"); return application;
  } };
}

describe("interactive dependency lifecycle", () => {
  it("imports unmatched declarations successfully, retains counts, and blocks draft execution and sharing", async () => {
    const f = fixture(); f.skills.splice(0);
    const imported = await f.service.importInteractive(actor, await archive(), {});
    expect(imported.capability_count).toBe(1);
    expect(imported.dependencies_available).toBe(false);
    expect(f.app().interactiveDependencyBindings).toEqual([{ type: "skill", id: SKILL, resource_id: null }]);
    expect(f.database.applicationCapability.createMany).not.toHaveBeenCalled();
    await expect(f.service.resolveRuntime(OWNER, imported.id)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    await expect(f.service.captureDistributionVersion(actor, imported.id, { version_number: "1.0.0", usage_instructions: "" }, vi.fn())).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.publications.capture).not.toHaveBeenCalled();
  });
  it("allows an explicit skip, later maps to an owned resource, and uses only that resource at runtime", async () => {
    const f = fixture();
    const imported = await f.service.importInteractive(actor, await archive(), {}, [{ type: "skill", id: SKILL, resource_id: null }]);
    expect(imported.dependencies_available).toBe(false);
    const updated = await f.service.updateInteractiveDependencies(actor, imported.id, [{ type: "skill", id: SKILL, resource_id: OTHER }], {});
    expect(updated.dependencies_available).toBe(true);
    expect((await f.service.resolveRuntime(OWNER, imported.id)).capabilityIds).toEqual([OTHER]);
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
    expect((await f.service.resolveRuntime(OWNER, imported.id)).capabilityIds).toEqual([]);
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
  it("keeps the published service usable when a new draft has unresolved declarations", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive("1", []), {});
    const releasedPackage = f.app().interactivePackageId;
    f.app().publishedVersionId = OTHER;
    const definition = { schemaVersion: 1, kind: "interactive", name: "Published", instructions: "Published instructions", usageInstructions: "", model: null, reasoningEffort: null,
      interactivePackageId: releasedPackage, capabilities: [], knowledgeBaseIds: [], mcpServerIds: [] };
    f.publications.readVersion.mockResolvedValue(definition);
    // Persisted published snapshots predate dependency declarations; the draft must not override them.
    const versionQuery = vi.spyOn(f.database.applicationVersion, "findMany");
    versionQuery.mockImplementation(async () => [{ id: OTHER, definitionJson: definition }] as never);
    f.skills.splice(0);
    const updated = await f.service.updateInteractivePackage(actor, imported.id, await archive("2"), {});
    expect(updated.dependencies_available).toBe(true);
    expect((await f.service.interactiveDependencies(actor, imported.id)).items[0]?.available).toBe(false);
    const runtime = await f.service.resolveRuntime(OWNER, imported.id);
    expect(runtime.interactivePackageId).toBe(releasedPackage);
    expect(runtime.instructions).toBe("Published instructions");
  });
  it("continues to read and execute a pre-change package with no dependency fields", async () => {
    const f = fixture(); const imported = await f.service.importInteractive(actor, await archive("1", []), {});
    const package_ = f.packages[0]; if (!package_) throw new Error("fixture package missing");
    const { dependencies, ...oldManifest } = interactiveApplicationManifestSchema.parse(package_.manifestJson);
    expect(dependencies.skills).toEqual([]);
    package_.manifestJson = oldManifest;
    f.app().interactiveDependencyBindings = [] satisfies Prisma.JsonArray;
    expect((await f.service.get(actor, imported.id)).dependencies_available).toBe(true);
    expect((await f.service.resolveRuntime(OWNER, imported.id)).interactivePackageId).toBe(package_.id);
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
    const runtime = await f.service.resolveRuntime(OWNER, imported.id);
    expect(runtime.capabilityIds).toEqual([OTHER]);
    expect(runtime.instructions).toBe(f.app().instructions);
    expect(runtime.interactivePackageId).toBe(package_.id);
    expect(runtime.applicationVersionId).toBeNull();
  });
});
