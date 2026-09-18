import { describe, expect, it, vi } from "vitest";
import { applicationDetailsSchema, interactiveApplicationManifestSchema, type ApplicationDistributionChannel } from "@linksense/shared";
import { readApplicationDetails } from "../src/modules/applications/details.js";

const APP = "10000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000002";
const RECIPIENT = "10000000-0000-4000-8000-000000000003";
const PLUGIN = "20000000-0000-4000-8000-000000000001";
const SKILL = "20000000-0000-4000-8000-000000000002";
const KNOWLEDGE = "20000000-0000-4000-8000-000000000003";
const MCP = "20000000-0000-4000-8000-000000000004";
const DECLARED = "20000000-0000-4000-8000-000000000005";
const VERSION = "30000000-0000-4000-8000-000000000001";
const CENTER_VERSION = "30000000-0000-4000-8000-000000000002";
const PACKAGE = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-17T00:00:00.000Z");

function fixture() {
  const application = {
    id: APP, ownerId: OWNER, status: "active", kind: "standard", name: "Current app",
    description: "Current description", iconPreset: "bot", iconObjectKey: null,
    instructions: "Private instructions", model: null, publishedVersionId: VERSION as string | null,
    interactivePackageId: null as string | null, interactiveDependencyBindings: [] as unknown,
    createdAt: NOW, updatedAt: NOW,
  };
  const definition = {
    schemaVersion: 1, description: null, iconPreset: "bot", iconObjectKey: null, name: "Published app", kind: "standard", model: null,
    instructions: "Private published instructions", usageInstructions: "Usage instructions",
    reasoningEffort: null, interactivePackageId: null,
    capabilities: [{ id: PLUGIN, type: "plugin", name: "Published plugin", description: "Private description",
      sourceType: "local", storagePath: "/private/plugin", revision: NOW.toISOString(), contentSha256: "a".repeat(64),
      manifestJson: { hidden: "private-manifest" }, riskSummaryJson: null }],
    knowledgeBaseIds: [KNOWLEDGE], mcpServerIds: [MCP],
  };
  const version = { id: VERSION, applicationId: APP, assetsReady: true, versionLabel: "1.0.0", definitionJson: definition, createdAt: NOW };
  const db = {
    application: { findFirst: vi.fn(async (): Promise<typeof application | null> => application) },
    user: { findFirst: vi.fn(async (): Promise<{ selfRegisteredAt: Date | null } | null> => ({ selfRegisteredAt: null })), findUnique: vi.fn(async () => ({ name: "Creator" })) },
    userGroupMember: { findMany: vi.fn(async () => []) },
    applicationGrant: { findMany: vi.fn(async () => [] as { usageModes: string[] }[]) },
    applicationListing: { findUnique: vi.fn(async () => null as { id: string; currentReleaseId: string; status: string } | null) },
    applicationRelease: { findFirst: vi.fn(async () => null as { id: string; listingId: string; applicationId: string; versionId: string; usageModes: string[]; name: string; description: string; publisherName: string } | null) },
    applicationRuntimeInstallation: { findUnique: vi.fn(async (): Promise<{ versionId: string } | null> => null) },
    applicationVersion: { findFirst: vi.fn(async (): Promise<typeof version | null> => version) },
    interactiveApplicationPackage: { findFirst: vi.fn(async () => null as { id: string; version: string; manifestJson: unknown } | null) },
    applicationCapability: { findMany: vi.fn(async () => [
      { capabilityId: PLUGIN, capabilityNameSnapshot: "Old plugin", capabilityTypeSnapshot: "plugin" },
      { capabilityId: SKILL, capabilityNameSnapshot: "Old skill", capabilityTypeSnapshot: "skill" },
    ]) },
    applicationKnowledgeBase: { findMany: vi.fn(async () => [{ knowledgeBaseId: KNOWLEDGE, knowledgeBaseNameSnapshot: "Handbook" }]) },
    applicationMcpServer: { findMany: vi.fn(async () => [{ mcpServerId: MCP, mcpServerNameSnapshot: "Search" }]) },
    capability: { findMany: vi.fn(async () => [
      { id: PLUGIN, type: "plugin", name: "Current plugin", status: "active" },
      { id: SKILL, type: "skill", name: "Current skill", status: "active" },
    ]) },
    knowledgeBase: { findMany: vi.fn(async () => [{ id: KNOWLEDGE, name: "Handbook", lifecycleStatus: "active", availabilityStatus: "enabled" }]) },
    mcpServer: { findMany: vi.fn(async () => [{ id: MCP, name: "Search", status: "active" }]) },
  };
  const read = async (actorId = OWNER, channel: ApplicationDistributionChannel = "direct") => {
    const result = await readApplicationDetails(db as unknown as Parameters<typeof readApplicationDetails>[0], actorId, APP, channel);
    return applicationDetailsSchema.parse({ ...result.details, icon: { type: "preset", preset: result.iconSource.iconPreset } });
  };
  const share = () => db.applicationGrant.findMany.mockResolvedValue([{ usageModes: ["install"] }]);
  const publishToCenter = () => {
    db.applicationListing.findUnique.mockResolvedValue({ id: APP, currentReleaseId: CENTER_VERSION, status: "published" });
    db.applicationRelease.findFirst.mockResolvedValue({ id: CENTER_VERSION, listingId: APP, applicationId: APP, versionId: CENTER_VERSION,
      usageModes: ["service"], name: "Center app", description: "Approved description", publisherName: "Publisher" });
    db.applicationVersion.findFirst.mockResolvedValue({ ...version, id: CENTER_VERSION, versionLabel: "2.0.0", definitionJson: { ...definition, capabilities: [] } });
  };
  return { db, application, definition, read, share, publishToCenter };
}

describe("read-only application details", () => {
  it("shows the owner's current resources when the application has no released version", async () => {
    const { db, application, read } = fixture();
    application.publishedVersionId = null;
    const result = await read();
    expect(result).toMatchObject({ name: "Current app", view: "configuration", creator_name: "Creator", version_number: null });
    expect(result.resources.map(item => [item.type, item.name, item.status])).toEqual([
      ["plugin", "Current plugin", "configured"], ["skill", "Current skill", "configured"],
      ["knowledge_base", "Handbook", "configured"], ["mcp_server", "Search", "configured"],
    ]);
    expect(db.applicationVersion.findFirst).not.toHaveBeenCalled();
    expect(db.capability.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: OWNER, id: { in: [PLUGIN, SKILL] } } }));
    expect(JSON.stringify(result)).not.toContain("Private instructions");
  });

  it("keeps unmatched declarations and actual remapped names without auto-matching on read", async () => {
    const { db, application, read } = fixture();
    application.publishedVersionId = null;
    application.kind = "interactive";
    application.interactivePackageId = PACKAGE;
    application.interactiveDependencyBindings = [{ type: "skill", id: DECLARED, resource_id: SKILL }];
    db.interactiveApplicationPackage.findFirst.mockResolvedValue({ id: PACKAGE, version: "1.2.0", manifestJson: interactiveApplicationManifestSchema.parse({
      schema_version: 1, id: "resource-check", name: "Resource check", version: "1.2.0", sdk_version: 1,
      dependencies: { plugins: [{ id: PLUGIN, name: "Choose a plugin" }], skills: [{ id: DECLARED, name: "Required skill" }] },
    }) });
    const result = await read();
    expect(result.version_number).toBe("1.2.0");
    expect(result.resources).toEqual([
      { id: PLUGIN, type: "plugin", name: "Choose a plugin", configured_name: null, status: "unconfigured" },
      { id: DECLARED, type: "skill", name: "Required skill", configured_name: "Current skill", status: "configured" },
    ]);
    expect(db.applicationCapability.findMany).not.toHaveBeenCalled();
  });

  it("continues to show existing interactive bindings when an older manifest has no dependencies field", async () => {
    const { db, application, read } = fixture();
    application.publishedVersionId = null;
    application.kind = "interactive";
    application.interactivePackageId = PACKAGE;
    db.interactiveApplicationPackage.findFirst.mockResolvedValue({ id: PACKAGE, version: "1.0.0", manifestJson: {
      schema_version: 1, id: "old-app", name: "Old app", version: "1.0.0", sdk_version: 1,
    } });
    expect((await read()).resources).toHaveLength(4);
  });

  it("keeps the owner's interactive details on the installed release after a metadata-only edit", async () => {
    const { db, application, definition, read } = fixture();
    application.kind = "interactive";
    application.name = "Unpublished renamed app";
    application.description = "Unpublished description";
    application.iconPreset = "book-open";
    definition.kind = "interactive";
    db.applicationRuntimeInstallation.findUnique.mockResolvedValue({ versionId: VERSION });
    const result = await read();
    expect(result).toMatchObject({ name: "Published app", description: null, icon: { type: "preset", preset: "bot" }, view: "published", version_number: "1.0.0" });
    expect(result.resources.map(item => item.name)).toEqual(["Published plugin", "Handbook", "Search"]);
    expect(db.applicationVersion.findFirst).toHaveBeenCalledWith({ where: { id: VERSION, applicationId: APP, assetsReady: true } });
    expect(db.applicationCapability.findMany).not.toHaveBeenCalled();
  });

  it("uses the owner's installed release even when the organization is still sharing an older release", async () => {
    const { db, read } = fixture();
    db.applicationRuntimeInstallation.findUnique.mockResolvedValue({ versionId: CENTER_VERSION });
    await read();
    expect(db.applicationVersion.findFirst).toHaveBeenCalledWith({ where: { id: CENTER_VERSION, applicationId: APP, assetsReady: true } });
  });

  it("keeps existing published applications without a runtime installation on their published details", async () => {
    const { read } = fixture();
    expect(await read()).toMatchObject({ name: "Published app", view: "published", version_number: "1.0.0" });
  });

  it("shows recipients only the shared version's resources, including install-only grants", async () => {
    const { db, read, share } = fixture();
    share();
    const result = await read(RECIPIENT);
    expect(result).toMatchObject({ name: "Published app", view: "published", version_number: "1.0.0" });
    expect(result.resources.map(item => item.name)).toEqual(["Published plugin", "Handbook", "Search"]);
    expect(db.applicationCapability.findMany).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    for (const privateValue of ["Current skill", "Private", "/private/plugin", "private-manifest", "storagePath", "manifestJson", "instructions"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it.each([OWNER, RECIPIENT])("uses the approved center version even if viewer %s can see another direct version", async viewer => {
    const { db, read, share, publishToCenter } = fixture();
    share(); publishToCenter();
    const result = await read(viewer, "center");
    expect(result).toMatchObject({ name: "Center app", description: "Approved description", creator_name: "Publisher", view: "published", version_number: "2.0.0" });
    expect(result.resources.map(item => item.type)).toEqual(["knowledge_base", "mcp_server"]);
    expect(db.applicationVersion.findFirst).toHaveBeenCalledWith({ where: { id: CENTER_VERSION, applicationId: APP, assetsReady: true } });
  });

  it("retains deleted resource snapshots and flags disabled resources without inventing names", async () => {
    const { db, read, share } = fixture();
    share();
    db.capability.findMany.mockResolvedValue([]);
    db.knowledgeBase.findMany.mockResolvedValue([]);
    db.mcpServer.findMany.mockResolvedValue([{ id: MCP, name: "Search", status: "disabled" }]);
    const result = await read(RECIPIENT);
    expect(result.resources).toEqual([
      { id: PLUGIN, type: "plugin", name: "Published plugin", configured_name: null, status: "unavailable" },
      { id: KNOWLEDGE, type: "knowledge_base", name: null, configured_name: null, status: "unavailable" },
      { id: MCP, type: "mcp_server", name: "Search", configured_name: null, status: "unavailable" },
    ]);
  });

  it.each([OWNER, RECIPIENT])("allows an authorized viewer to inspect a disabled direct application (%s)", async viewer => {
    const { application, read, share } = fixture();
    share(); application.status = "disabled";
    expect((await read(viewer)).status).toBe("disabled");
  });

  it("rejects revoked sharing before reading the private inventory", async () => {
    const { db, read } = fixture();
    await expect(read(RECIPIENT)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(db.applicationVersion.findFirst).not.toHaveBeenCalled();
    expect(db.capability.findMany).not.toHaveBeenCalled();
  });

  it("does not let a center listing grant access to a private direct draft", async () => {
    const { read, publishToCenter } = fixture();
    publishToCenter();
    await expect(read(RECIPIENT)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });

  it("denies a self-registered non-owner even with stale grants or listings", async () => {
    const { db, read, share, publishToCenter } = fixture();
    share(); publishToCenter();
    db.user.findFirst.mockResolvedValue({ selfRegisteredAt: NOW });
    await expect(read(RECIPIENT)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(read(RECIPIENT, "center")).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });

  it("denies unlisted center access even for the creator", async () => {
    const { db, read, publishToCenter } = fixture();
    publishToCenter();
    db.applicationListing.findUnique.mockResolvedValue({ id: APP, currentReleaseId: CENTER_VERSION, status: "unlisted" });
    await expect(read(OWNER, "center")).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });

  it("does not treat an obsolete install-only grant as permission for an interactive app", async () => {
    const { application, read, share } = fixture();
    application.kind = "interactive";
    share();
    await expect(read(RECIPIENT)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });

  it.each(["actor", "application", "version"])("rejects missing or inactive %s data without exposing draft resources", async missing => {
    const { db, read, share } = fixture();
    share();
    if (missing === "actor") db.user.findFirst.mockResolvedValue(null);
    if (missing === "application") db.application.findFirst.mockResolvedValue(null);
    if (missing === "version") db.applicationVersion.findFirst.mockResolvedValue(null);
    await expect(read(RECIPIENT)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(db.capability.findMany).not.toHaveBeenCalled();
    expect(db.applicationCapability.findMany).not.toHaveBeenCalled();
  });
});
