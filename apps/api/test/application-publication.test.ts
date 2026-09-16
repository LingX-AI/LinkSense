import { ApplicationInstallationService } from "../src/modules/applications/installation-service.js";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationPublicationService, applicationPackagePath } from "../src/modules/applications/publication-service.js";
import { publishedApplicationDefinitionSchema } from "../src/modules/applications/published-definition.js";
import { type Prisma } from "../src/generated/prisma/client.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'linksense-app-publication-'));
  roots.push(root);
  const ownerId = randomUUID(), applicationId = randomUUID(), capabilityId = randomUUID();
  const application = {
    id: applicationId, ownerId, status: 'active', name: 'Published reports', kind: 'standard',
    iconPreset: 'bot', description: 'Reports', instructions: 'Create a report.', usageInstructions: '', publishedVersionId: null as string | null,
    model: null, reasoningEffort: null, interactivePackageId: null as string | null, updatedAt: new Date('2026-09-15T00:00:00Z'),
  };
  const knowledgeBaseId = randomUUID(), mcpServerId = randomUUID();
  const capability = { id: capabilityId, ownerId, type: 'skill', name: 'report', description: 'Write reports',
    sourceType: 'local', storagePath: 'source', updatedAt: application.updatedAt,
    manifestJson: { name: 'report' }, riskSummaryJson: {},
  };
  await mkdir(join(root, 'source'));
  await writeFile(join(root, 'source', 'SKILL.md'), '---\nname: report\ndescription: Write reports\n---\nOriginal skill.');
  type Version = { id: string; applicationId: string; versionNumber: number; versionLabel: string; definitionJson: Prisma.InputJsonValue; assetsReady: boolean; createdBy: string };
  const versions: Version[] = [];
  const createdApplications: Prisma.ApplicationCreateInput[] = [];
  const createdCapabilities: Prisma.CapabilityCreateManyInput[] = [];
  const bindingsCreated: Prisma.ApplicationCapabilityCreateManyInput[] = [];
  const database = {
    user: { findFirst: vi.fn(async () => ({ selfRegisteredAt: null })) },
    userGroupMember: { findMany: vi.fn(async () => []) },
    applicationGrant: { findMany: vi.fn(async () => [{ usageModes: ["install", "service"] }]) },
    applicationListing: { findUnique: vi.fn(async () => null) },
    applicationInstallation: { findFirst: vi.fn(async () => null), create: vi.fn() },
    application: {
      findFirst: vi.fn(async ({ where }: { where: { ownerId?: string } }) => (!where.ownerId || where.ownerId === ownerId) ? application : null),
      create: vi.fn(async ({ data }: { data: Prisma.ApplicationCreateInput }) => { createdApplications.push(data); return data; }),
      findUniqueOrThrow: vi.fn(async () => application),
      update: vi.fn(async ({ data }: { data: { publishedVersionId: string; usageInstructions: string; } }) => Object.assign(application, data)),
    },
    applicationCapability: { findMany: vi.fn(async ({ where }: { where: { applicationId: string } }) => where.applicationId === applicationId ? [{ capabilityId }] : []), deleteMany: vi.fn(), createMany: vi.fn(async ({ data }: { data: Prisma.ApplicationCapabilityCreateManyInput[] }) => { bindingsCreated.push(...data); return { count: data.length }; }) },
    applicationKnowledgeBase: { findMany: vi.fn(async () => [{ knowledgeBaseId }]) },
    applicationMcpServer: { findMany: vi.fn(async () => [{ mcpServerId }]) },
    capability: { findMany: vi.fn(async ({ where }: { where: { ownerId: string } }) => where.ownerId === ownerId ? [capability] : []),
      createMany: vi.fn(async ({ data }: { data: Prisma.CapabilityCreateManyInput[] }) => { createdCapabilities.push(...data); return { count: data.length }; }) },
    applicationVersion: {
      findMany: vi.fn(async () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { const version = versions.find(item => item.id === where.id); if (!version) throw new Error("missing version"); return version }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Pick<Version, "definitionJson" | "assetsReady"> }) => {
        const version = versions.find(version => version.id === where.id && !version.assetsReady);
        if (!version) return { count: 0 };
        Object.assign(version, data); return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => where.id ? versions.find(version => version.id === where.id && version.assetsReady) ?? null : versions.at(-1) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => versions.find(version => version.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Version }) => { versions.push(structuredClone(data)); return data; }),
    },
    $queryRaw: vi.fn(async () => [{ id: applicationId }]),
  };
  const prisma = { ...database, $transaction: vi.fn(async <T>(action: (tx: typeof database) => Promise<T>) => action(database)) };
  const service = new ApplicationPublicationService(prisma as never, root);
  const capture = (userId: string, appId: string, input: { usage_instructions: string; version_number?: string }, runtimeInstructions?: string, conversionVersionId?: string) => service.capture(userId, appId, { version_number: "1.0.0", ...input }, { ...(runtimeInstructions === undefined ? {} : { runtimeInstructions }), ...(conversionVersionId === undefined ? {} : { conversionVersionId }), complete: async (tx, version) => { await tx.application.update({ where: { id: appId }, data: { publishedVersionId: version.id, usageInstructions: input.usage_instructions } }); } });
  return { capture, root, ownerId, applicationId, application, capability, versions, prisma, service, createdApplications, createdCapabilities, bindingsCreated };
}

describe('application publication', () => {
  it("prefills historical usage instructions before a version is available", async () => {
    const f = await fixture();
    f.application.usageInstructions = "Existing usage guide";
    expect((await f.service.settings(f.applicationId)).usage_instructions).toBe("Existing usage guide");
    f.versions.push({ id: randomUUID(), applicationId: f.applicationId, versionNumber: 1, versionLabel: "1.0.0", definitionJson: { conversionRequired: true }, assetsReady: false, createdBy: f.ownerId });
    expect((await f.service.settings(f.applicationId)).usage_instructions).toBe("Existing usage guide");
  });

  it("prefills the latest saved guide across channels and preserves an explicitly cleared guide", async () => {
    const f = await fixture();
    await f.capture(f.ownerId, f.applicationId, { usage_instructions: "Direct guide" });
    expect((await f.service.settings(f.applicationId)).usage_instructions).toBe("Direct guide");
    for (const usage_instructions of ["Revised center guide", ""]) {
      await f.service.capture(f.ownerId, f.applicationId, { version_number: "1.0.0", usage_instructions }, { complete: async () => undefined });
      expect((await f.service.settings(f.applicationId)).usage_instructions).toBe(usage_instructions);
      expect(f.application.usageInstructions).toBe("Direct guide");
    }
  });
  it("compares semantic versions against the highest version and rejects lower submissions before writing", async () => {
    const f = await fixture();
    const input = { usage_instructions: "Use your own account", version_number: "1.10.0" };
    const first = await f.capture(f.ownerId, f.applicationId, input);
    await expect(f.capture(f.ownerId, f.applicationId, { ...input, version_number: "1.9.0" })).rejects.toMatchObject({ code: "APPLICATION_VERSION_TOO_LOW", params: { version: "1.10.0" } });
    expect(f.versions).toHaveLength(1);
    expect(f.application.publishedVersionId).toBe(first.version_id);
    expect(await f.service.settings(f.applicationId)).toMatchObject({ version_number: "1.10.0", highest_version_number: "1.10.0" });
  });

  it("reuses an unchanged same-number submission without reporting a new update", async () => {
    const f = await fixture();
    const input = { usage_instructions: "Use your own account", version_number: "1.0.0" };
    const first = await f.capture(f.ownerId, f.applicationId, input);
    const second = await f.capture(f.ownerId, f.applicationId, input);
    expect(second).toEqual(first);
    expect(f.versions).toHaveLength(1);
    await f.service.verifyVersion(f.applicationId, first.version_id!);
  });

  it("rechecks the highest version inside the transaction after a concurrent submission", async () => {
    const f = await fixture();
    await f.capture(f.ownerId, f.applicationId, { usage_instructions: "Use your own account", version_number: "2.0.0" });
    f.prisma.applicationVersion.findMany.mockResolvedValueOnce([]);
    await expect(f.capture(f.ownerId, f.applicationId, { usage_instructions: "Use your own account", version_number: "1.0.0" })).rejects.toMatchObject({ code: "APPLICATION_VERSION_TOO_LOW" });
    expect(f.versions).toHaveLength(1);
  });

  it("captures a center submission without changing the active direct service", async () => {
    const f = await fixture();
    const complete = vi.fn(async () => undefined);
    const version = await f.service.capture(f.ownerId, f.applicationId, { usage_instructions: "Use your own account", version_number: "1.0.0" }, { complete });
    expect(version.version_number).toBe("1.0.0");
    expect(f.application.publishedVersionId).toBeNull();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("converts a disabled historical application without enabling its dependencies or changing its version ID", async () => {
    const f = await fixture(), versionId = randomUUID();
    f.application.status = "disabled";
    f.application.publishedVersionId = versionId;
    f.versions.push({ id: versionId, applicationId: f.applicationId, versionNumber: 1, versionLabel: "1.0.0", definitionJson: { conversionRequired: true }, assetsReady: false, createdBy: f.ownerId });
    const converted = await f.capture(f.ownerId, f.applicationId, { usage_instructions: "Set up before enabling." }, undefined, versionId);
    expect(converted.version_id).toBe(versionId);
    expect(f.versions).toHaveLength(1);
    expect(f.versions[0]?.assetsReady).toBe(true);
    expect(f.application.status).toBe("disabled");
    expect(f.prisma.capability.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ status: { in: ["active", "disabled"] } }) });
    expect((await f.service.readVersion(f.applicationId, versionId)).capabilities).toHaveLength(1);
  });

  it('freezes instructions and package bytes while later publications get a new version', async () => {
    const f = await fixture();
    const first = await f.capture(f.ownerId, f.applicationId, { usage_instructions: 'Configure your service connection.' });
    expect(first.version_number).toBe('1.0.0');
    expect(first).not.toHaveProperty("allow_copy");
    const original = await f.service.readVersion(f.applicationId, first.version_id!);
    f.application.instructions = 'Changed draft.';
    await writeFile(join(f.root, 'source', 'SKILL.md'), '---\nname: report\ndescription: Write reports\n---\nUpdated skill.');
    const second = await f.capture(f.ownerId, f.applicationId, { usage_instructions: 'Use your own credentials.' });
    expect(second.version_number).toBe('1.0.0');
    expect(second.version_id).not.toBe(first.version_id);
    expect(await f.service.readVersion(f.applicationId, first.version_id!)).toEqual(original);
    expect(original.instructions).toBe('Create a report.');
    await expect(readFile(join(f.root, original.capabilities[0]!.storagePath, 'SKILL.md'), 'utf8')).resolves.toContain('Original skill.');
    const latest = await f.service.readVersion(f.applicationId, second.version_id!);
    expect(latest.instructions).toBe('Changed draft.');
    expect(latest.capabilities[0]?.contentSha256).not.toBe(original.capabilities[0]?.contentSha256);
  });

  it('requires ownership and leaves no published version after a concurrent draft change', async () => {
    const f = await fixture();
    const input = { usage_instructions: 'Set up the connections.' };
    await expect(f.capture(randomUUID(), f.applicationId, input)).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    f.prisma.$queryRaw.mockResolvedValue([]);
    await expect(f.capture(f.ownerId, f.applicationId, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.versions).toHaveLength(0);
    expect(f.application.publishedVersionId).toBeNull();
    await expect(readFile(join(f.root, 'source', 'SKILL.md'), 'utf8')).resolves.toContain('Original skill.');
  });

  it('rejects missing converted assets and paths outside the package store', async () => {
    const f = await fixture();
    await expect(f.service.readVersion(f.applicationId, randomUUID())).rejects.toMatchObject({ code: 'APPLICATION_DEPENDENCY_UNAVAILABLE' });
    expect(() => applicationPackagePath(f.root, '../private')).toThrow();
    expect(() => applicationPackagePath(f.root, f.root)).toThrow();
    expect(publishedApplicationDefinitionSchema.safeParse({ conversionRequired: true }).success).toBe(false);
  });
});


describe("independent application copies", () => {
  it.each([false, true])("copies interactive assets to the recipient and rolls back corrupt downloads (corrupt: %s)", async corrupt => {
    const f = await fixture(), recipient = randomUUID(), sourcePackageId = randomUUID();
    f.application.kind = "interactive";
    f.application.interactivePackageId = sourcePackageId;
    await f.capture(f.ownerId, f.applicationId, { usage_instructions: "Connect your own services." });
    const files = [
      { path: "index.html", contentType: "text/html", bytes: Buffer.from("<main>Reports</main>") },
      { path: "style.css", contentType: "text/css", bytes: Buffer.from("main { color: black }") },
    ];
    const sourceAssets = files.map(file => ({ ...file, id: randomUUID(), packageId: sourcePackageId,
      objectKey: `author/${sourcePackageId}/${file.path}`, byteSize: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    }));
    const sourcePackage = { id: sourcePackageId, applicationId: f.applicationId, version: "1.0.0",
      manifestJson: { schema_version: 1, id: "reports", name: "Reports", version: "1.0.0", entry: "index.html", sdk_version: 1 },
      archiveSha256: "a".repeat(64), fileCount: 2, expandedBytes: files.reduce((sum, file) => sum + file.bytes.length, 0), createdBy: f.ownerId,
    };
    const database = { ...f.prisma,
      interactiveApplicationPackage: { findFirst: vi.fn(async () => sourcePackage), create: vi.fn() },
      interactiveApplicationAsset: { findMany: vi.fn(async () => sourceAssets), createMany: vi.fn() },
    };
    const prisma = { ...database, $transaction: vi.fn(async <T>(action: (tx: typeof database) => Promise<T>) => action(database)) };
    const assets = { get: vi.fn(async (key: string) => {
      const asset = sourceAssets.find(asset => asset.objectKey === key)!;
      return Readable.from([corrupt && asset.path === "style.css" ? Buffer.from("corrupt") : asset.bytes]);
    }), put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const copy = new ApplicationInstallationService(prisma as never, f.root, f.service, assets);
    if (corrupt) {
      await expect(copy.install(recipient, f.applicationId, { name: "My page", channel: "direct", version_id: f.application.publishedVersionId! })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
      expect(f.createdApplications).toHaveLength(0);
      expect(f.createdCapabilities).toHaveLength(0);
      expect(assets.remove).toHaveBeenCalledOnce();
      expect(database.interactiveApplicationPackage.create).not.toHaveBeenCalled();
    } else {
      const id = await copy.install(recipient, f.applicationId, { name: "My page", channel: "direct", version_id: f.application.publishedVersionId! });
      const packageId = f.createdApplications[0]!.interactivePackageId;
      expect(packageId).not.toBe(sourcePackageId);
      expect(database.interactiveApplicationPackage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: packageId, applicationId: id, createdBy: recipient, manifestJson: sourcePackage.manifestJson }) });
      expect(database.interactiveApplicationAsset.createMany).toHaveBeenCalledWith({ data: sourceAssets.map(asset => expect.objectContaining({ packageId, path: asset.path, sha256: asset.sha256, objectKey: expect.stringContaining(`applications/${recipient}/${id}/packages/${packageId}/`) })) });
      expect(assets.put).toHaveBeenCalledTimes(2);
      expect(assets.remove).not.toHaveBeenCalled();
    }
  });

  it("creates recipient-owned files and bindings, leaving external connections for the recipient to configure", async () => {
    const f = await fixture(), recipient = randomUUID();
    await f.capture(f.ownerId, f.applicationId, { usage_instructions: "Connect your own handbook and MCP service." });
    const assets = { get: vi.fn(), put: vi.fn(), remove: vi.fn() };
    const copy = new ApplicationInstallationService(f.prisma as never, f.root, f.service, assets);
    const id = await copy.install(recipient, f.applicationId, { name: "My reports", channel: "direct", version_id: f.application.publishedVersionId! });
    expect(f.createdApplications).toEqual([expect.objectContaining({ id, ownerId: recipient, status: "disabled", name: "My reports", usageInstructions: "Connect your own handbook and MCP service." })]);
    expect(f.createdApplications[0]).not.toHaveProperty("publishedVersionId");
    expect(f.createdCapabilities).toHaveLength(1);
    expect(f.createdCapabilities[0]).toMatchObject({ ownerId: recipient, installedBy: recipient, sourceType: "local" });
    expect(f.createdCapabilities[0]?.id).not.toBe(f.capability.id);
    expect(f.bindingsCreated[0]).toMatchObject({ applicationId: id, capabilityId: f.createdCapabilities[0]?.id });
    await expect(readFile(join(f.root, f.createdCapabilities[0]!.storagePath, "SKILL.md"), "utf8")).resolves.toContain("Original skill.");
    expect(f.application.ownerId).toBe(f.ownerId);
    expect(assets.get).not.toHaveBeenCalled();
  });

  it("requires separate copy permission and rechecks revocation before saving", async () => {
    const f = await fixture(), recipient = randomUUID();
    const copy = new ApplicationInstallationService(f.prisma as never, f.root, f.service, { get: vi.fn(), put: vi.fn(), remove: vi.fn() });
    await f.capture(f.ownerId, f.applicationId, { usage_instructions: "Use the service." });
    f.prisma.applicationGrant.findMany.mockResolvedValue([{ usageModes: ["service"] }]);
    await expect(copy.install(recipient, f.applicationId, { name: "Private copy", channel: "direct", version_id: f.application.publishedVersionId! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.createdApplications).toHaveLength(0);
    f.prisma.applicationGrant.findMany.mockResolvedValueOnce([{ usageModes: ["install"] }]).mockResolvedValue([]);
    await expect(copy.install(recipient, f.applicationId, { name: "Revoked copy", channel: "direct", version_id: f.application.publishedVersionId! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.createdCapabilities).toHaveLength(0);
    expect(f.createdApplications).toHaveLength(0);
  });
});
