import { describe, expect, it, vi } from "vitest";
import type { Application, ApplicationVersion, PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { ApplicationService } from "../src/modules/applications/service.js";
import { ApplicationPublicationService } from "../src/modules/applications/publication-service.js";
import { publishedApplicationDefinitionSchema } from "../src/modules/applications/published-definition.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const APP = "20000000-0000-4000-8000-000000000001";
const PREVIOUS = "30000000-0000-4000-8000-000000000001";
const actor = { id: OWNER, role: "user" as const, status: "active" as const, ipAddress: "192.0.2.1" };
const now = new Date("2026-09-18T00:00:00Z");
const release = { version_number: "1.2.4", usage_instructions: "Existing guide" };

function fixture(kind: "standard" | "interactive" = "standard") {
  let application: Application = {
    id: APP, ownerId: OWNER, kind, developmentOnly: false, name: "Old name", description: "Old description",
    instructions: "Old instructions", model: "test-model", reasoningEffort: "medium", status: "active",
    iconPreset: "bot", iconObjectKey: null, interactivePackageId: kind === "interactive" ? APP : null, interactiveDependencyBindings: [],
    usageInstructions: "Existing guide", publishedVersionId: PREVIOUS, deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now,
  };
  const originalDefinition = publishedApplicationDefinitionSchema.parse({ schemaVersion: 1, kind, name: application.name,
    description: application.description, iconPreset: application.iconPreset, iconObjectKey: null, instructions: application.instructions,
    usageInstructions: application.usageInstructions, model: application.model, reasoningEffort: application.reasoningEffort,
    capabilities: [], knowledgeBaseIds: [], mcpServerIds: [], interactivePackageId: application.interactivePackageId });
  const versions: ApplicationVersion[] = [{ id: PREVIOUS, applicationId: APP, versionNumber: 1, versionLabel: "1.2.3", purpose: "release", assetsReady: true, definitionJson: originalDefinition, createdAt: now, createdBy: OWNER }];
  let installedVersion = PREVIOUS;
  const activity = { busy: false };
  const assertCurrent = vi.fn();
  const gate = { change: vi.fn(async (_owner: string, _id: string, action: (check: () => void) => Promise<unknown>) => {
    if (activity.busy) throw new AppError("APPLICATION_RUNTIME_BUSY");
    return action(assertCurrent);
  }) };
  const database = {
    $queryRaw: vi.fn(async () => [{ id: APP }]),
    application: {
      findFirst: vi.fn(async ({ where }: { where: { ownerId?: string } }) => !where.ownerId || where.ownerId === OWNER ? application : null),
      findMany: vi.fn(async () => [application]),
      updateMany: vi.fn(async ({ data }: { data: Partial<Application> }) => { application = { ...application, ...data }; return { count: 1 }; }),
    },
    applicationVersion: {
      findMany: vi.fn(async () => versions),
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => where.id ? versions.find(item => item.id === where.id) ?? null : versions.at(-1)),
      create: vi.fn(async ({ data }: { data: Omit<ApplicationVersion, "createdAt"> }) => { const row = { ...data, createdAt: now }; versions.push(row); return row; }),
    },
    applicationRuntimeInstallation: {
      findMany: vi.fn(async () => [{ applicationId: APP, versionId: installedVersion }]),
      findUnique: vi.fn(async () => ({ versionId: installedVersion })),
      upsert: vi.fn(async ({ update }: { update: { versionId: string } }) => { installedVersion = update.versionId; }),
    },
    interactiveApplicationPackage: {
      findFirst: vi.fn(async () => ({ id: APP, applicationId: APP, version: "1.2.3", manifestJson: { schema_version: 1, id: "review", name: "Review", version: "1.2.3", sdk_version: 1 } })),
      findMany: vi.fn(async () => []),
    },
    applicationCapability: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    applicationKnowledgeBase: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    applicationMcpServer: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    capability: { findMany: vi.fn(async () => []) }, knowledgeBase: { findMany: vi.fn(async () => []) }, mcpServer: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: OWNER, name: "Owner" }]) },
    userGroupMember: { findMany: vi.fn(async () => []) }, applicationGrant: { findMany: vi.fn(async () => []) },
  };
  const prisma = { ...database, $transaction: vi.fn(async <T>(action: (tx: typeof database) => Promise<T>) => {
    const before = { application: structuredClone(application), versions: [...versions], installedVersion };
    try { return await action(database); }
    catch (error) { application = before.application; versions.splice(0, versions.length, ...before.versions); installedVersion = before.installedVersion; throw error; }
  }) };
  const publications = new ApplicationPublicationService(prisma as unknown as PrismaClient, "/unused-no-capabilities");
  const service = new ApplicationService(prisma as unknown as PrismaClient, { resolveRuntimeForSelection: vi.fn() } as never,
    { write: vi.fn() } as never, { resolveForCapability: vi.fn() }, undefined, undefined, publications, undefined, { gate } as never);
  return { service, publications, prisma, versions, activity, gate, assertCurrent, app: () => application, installed: () => installedVersion };
}

describe("application edit and publication", () => {
  it("publishes an existing application without historical releases as 0.0.1", async () => {
    const f = fixture(); f.versions.splice(0); f.app().publishedVersionId = null;
    await f.service.update(actor, APP, { name: "First release" }, {}, { ...release, version_number: "0.0.1" });
    expect(f.versions).toHaveLength(1);
    expect(f.versions[0]).toMatchObject({ versionLabel: "0.0.1", versionNumber: 1, definitionJson: { name: "First release" } });
    expect(f.installed()).toBe(f.versions[0]?.id);
  });

  it("preserves the disabled status when publishing edits", async () => {
    const f = fixture(); f.app().status = "disabled";
    await f.service.update(actor, APP, { name: "Updated disabled application", status: "disabled" }, {}, release);
    expect(f.app().status).toBe("disabled"); expect(f.installed()).toBe(f.versions[1]?.id);
  });
  it("commits edited metadata, instructions and owner installation together without advancing sharing", async () => {
    const f = fixture();
    const result = await f.service.update(actor, APP, { name: "New name", description: null, instructions: "New instructions", model: null, reasoning_effort: null, icon: { type: "preset", preset: "book-open" } }, {}, release);
    expect(result).toMatchObject({ name: "New name", description: null, instructions: "New instructions", model: null, reasoning_effort: null, icon: { type: "preset", preset: "book-open" } });
    expect(f.versions).toHaveLength(2);
    expect(f.versions[1]).toMatchObject({ versionLabel: "1.2.4", definitionJson: { name: "New name", description: null, instructions: "New instructions", model: null, reasoningEffort: null, usageInstructions: "Existing guide" } });
    expect(f.installed()).toBe(f.versions[1]?.id);
    expect(f.app().publishedVersionId).toBe(PREVIOUS);
    expect(f.gate.change).toHaveBeenCalledWith(OWNER, APP, expect.any(Function));
    expect(f.assertCurrent).toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it.each(["standard", "interactive"] as const)("rejects lower versions for %s without persisting edits", async kind => {
    const version_number = "1.2.2";
    const f = fixture(kind); const before = structuredClone(f.app());
    await expect(f.service.update(actor, APP, { name: "Rejected edit" }, {}, { ...release, version_number })).rejects.toMatchObject({ code: "APPLICATION_VERSION_TOO_LOW" });
    expect(f.app()).toEqual(before); expect(f.versions).toHaveLength(1); expect(f.installed()).toBe(PREVIOUS);
    expect(f.prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("blocks edits while the application has active tasks", async () => {
    const f = fixture(); f.activity.busy = true;
    await expect(f.service.update(actor, APP, { name: "Blocked" }, {}, release)).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    expect(f.app().name).toBe("Old name"); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back edits and the new version when installation fails and permits a clean retry", async () => {
    const f = fixture(); const before = structuredClone(f.app());
    f.prisma.applicationRuntimeInstallation.upsert.mockRejectedValueOnce(new Error("Installation failed"));
    await expect(f.service.update(actor, APP, { name: "New name" }, {}, release)).rejects.toThrow("Installation failed");
    expect(f.app()).toEqual(before); expect(f.versions).toHaveLength(1); expect(f.installed()).toBe(PREVIOUS);
    await f.service.update(actor, APP, { name: "New name" }, {}, release);
    expect(f.app().name).toBe("New name"); expect(f.versions).toHaveLength(2); expect(f.installed()).toBe(f.versions[1]?.id);
  });

  it.each(["standard", "interactive"] as const)("publishes %s edits with the same version number without changing existing releases", async kind => {
    const f = fixture(kind);
    const original = structuredClone(f.versions[0]);
    const result = await f.service.update(actor, APP, { name: "Edited", description: "Edited description", icon: { type: "preset", preset: "book-open" } }, {}, { ...release, version_number: "1.2.3" });
    expect(result.name).toBe("Edited");
    expect(f.versions).toHaveLength(2);
    expect(f.versions[0]).toEqual(original);
    expect(f.versions[1]).toMatchObject({ versionLabel: "1.2.3", versionNumber: 2, definitionJson: { name: "Edited", description: "Edited description", iconPreset: "book-open", kind } });
    expect(f.installed()).toBe(f.versions[1]?.id);
    expect(f.app().publishedVersionId).toBe(PREVIOUS);
  });

  it("rolls back interactive metadata when publishing fails and leaves the old installation usable", async () => {
    const f = fixture("interactive");
    f.prisma.applicationRuntimeInstallation.upsert.mockRejectedValueOnce(new Error("Installation failed"));
    await expect(f.service.update(actor, APP, { name: "Edited" }, {}, release)).rejects.toThrow("Installation failed");
    expect(f.app().name).toBe("Old name"); expect(f.versions).toHaveLength(1); expect(f.installed()).toBe(PREVIOUS);
    await f.service.update(actor, APP, { name: "Edited" }, {}, release);
    expect(f.versions[1]).toMatchObject({ versionLabel: "1.2.4", definitionJson: { name: "Edited", interactivePackageId: APP } });
    expect(f.installed()).toBe(f.versions[1]?.id);
  });

  it("blocks interactive edits during active tasks", async () => {
    const f = fixture("interactive"); f.activity.busy = true;
    await expect(f.service.update(actor, APP, { name: "Edited" }, {}, release)).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_BUSY" });
    expect(f.app().name).toBe("Old name"); expect(f.versions).toHaveLength(1);
  });

  it("checks ownership, user status and application kind before admitting a publication", async () => {
    const f = fixture();
    await expect(f.service.update({ ...actor, id: PREVIOUS }, APP, { name: "Denied" }, {}, release)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(f.service.update({ ...actor, status: "disabled" }, APP, { name: "Denied" }, {}, release)).rejects.toMatchObject({ code: "USER_DISABLED" });
    f.app().kind = "interactive";
    await expect(f.service.update(actor, APP, { instructions: "Denied" }, {}, release)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.gate.change).not.toHaveBeenCalled(); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});
