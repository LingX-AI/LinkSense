import {
  capabilityTypeSchema,
  interactiveApplicationManifestSchema,
  interactiveDependencyDeclarations,
  type ApplicationDetails,
  type ApplicationDistributionChannel,
  type ApplicationResourceDetails,
} from "@linksense/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { applicationModesForChannel } from "./distribution-policy.js";
import { readApplicationDistributionAccess, type ApplicationDistributionDatabase } from "./distribution-repository.js";
import { resolveInteractiveDependencies } from "./interactive-dependencies.js";
import { publishedApplicationDefinitionSchema } from "./published-definition.js";

type DetailsDatabase = ApplicationDistributionDatabase & Pick<Prisma.TransactionClient,
  "applicationCapability" | "applicationKnowledgeBase" | "applicationMcpServer" |
  "applicationRuntimeInstallation" | "interactiveApplicationPackage" | "capability" | "knowledgeBase" | "mcpServer">;
type ResourceReference = Pick<ApplicationResourceDetails, "id" | "type" | "name">;

/** Resource names are visible through the app, not permission to open the resources. */
export async function readApplicationDetails(
  db: DetailsDatabase, actorId: string, applicationId: string, channel: ApplicationDistributionChannel,
): Promise<{
  details: Omit<ApplicationDetails, "icon">;
  iconSource: { iconPreset: string; iconObjectKey: string | null };
}> {
  const access = await readApplicationDistributionAccess(db, actorId, applicationId);
  const isOwner = channel === "direct" && access.ownerId === actorId;
  // A disabled shared app remains inspectable by its recipients, but cannot run.
  const canReadShared = channel === "direct" && applicationModesForChannel({ ...access, applicationStatus: "active" }, "direct").length > 0;
  if (!isOwner && !canReadShared && !(
    channel === "center" && applicationModesForChannel(access, "center").length > 0
  )) throw new AppError("APPLICATION_NOT_FOUND");

  const application = await db.application.findFirst({ where: { id: applicationId, status: { in: ["active", "disabled"] } } });
  if (!application) throw new AppError("APPLICATION_NOT_FOUND");
  const installation = isOwner ? await db.applicationRuntimeInstallation.findUnique({
    where: { ownerId_applicationId: { ownerId: actorId, applicationId } }, select: { versionId: true },
  }) : null;
  const versionId = channel === "center" ? access.center?.versionId : installation?.versionId ?? access.publishedVersionId;
  const ownConfiguration = isOwner && !versionId;
  const version = versionId
    ? await db.applicationVersion.findFirst({ where: { id: versionId, applicationId, assetsReady: true } }) : null;
  if (!ownConfiguration && !version) throw new AppError("APPLICATION_NOT_FOUND");
  const definition = version ? publishedApplicationDefinitionSchema.parse(version.definitionJson) : null;
  const packageId = definition ? definition.interactivePackageId : application.interactivePackageId;
  const [owner, package_] = await Promise.all([
    db.user.findUnique({ where: { id: application.ownerId }, select: { name: true } }),
    packageId ? db.interactiveApplicationPackage.findFirst({ where: { id: packageId, applicationId } }) : null,
  ]);

  let resources: ApplicationResourceDetails[];
  const manifest = ownConfiguration && package_ ? interactiveApplicationManifestSchema.parse(package_.manifestJson) : null;
  if (manifest && interactiveDependencyDeclarations(manifest.dependencies).length > 0) {
    const state = await resolveInteractiveDependencies(db, application.ownerId, manifest, application.interactiveDependencyBindings, [], false);
    resources = state.items.map(item => ({
      id: item.id, type: item.type, name: item.name,
      configured_name: item.resource_name && item.resource_name !== item.name ? item.resource_name : null,
      status: !item.resource_id ? "unconfigured" : item.available ? "configured" : "unavailable",
    }));
  } else {
    let references: ResourceReference[];
    if (definition) {
      references = [
        ...definition.capabilities.map(item => ({ id: item.id, type: item.type, name: item.name })),
        ...definition.knowledgeBaseIds.map(id => ({ id, type: "knowledge_base" as const, name: null })),
        ...definition.mcpServerIds.map(id => ({ id, type: "mcp_server" as const, name: null })),
      ];
    } else {
      const query = { where: { applicationId }, orderBy: { selectionOrder: "asc" as const } };
      const [capabilities, knowledge, mcp] = await Promise.all([
        db.applicationCapability.findMany(query), db.applicationKnowledgeBase.findMany(query), db.applicationMcpServer.findMany(query),
      ]);
      references = [
        ...capabilities.map(item => ({ id: item.capabilityId, type: capabilityTypeSchema.parse(item.capabilityTypeSnapshot), name: item.capabilityNameSnapshot })),
        ...knowledge.map(item => ({ id: item.knowledgeBaseId, type: "knowledge_base" as const, name: item.knowledgeBaseNameSnapshot })),
        ...mcp.map(item => ({ id: item.mcpServerId, type: "mcp_server" as const, name: item.mcpServerNameSnapshot })),
      ];
    }
    resources = await describeResources(db, application.ownerId, references, definition !== null);
  }

  let name = definition?.name ?? application.name;
  let description = definition ? definition.description : application.description;
  let creatorName = owner?.name ?? "—";
  if (channel === "center") {
    if (!version) throw new AppError("APPLICATION_NOT_FOUND");
    const listing = await db.applicationListing.findUnique({ where: { applicationId } });
    const release = listing?.status === "published" && listing.currentReleaseId
      ? await db.applicationRelease.findFirst({ where: { id: listing.currentReleaseId, listingId: listing.id, applicationId, versionId: version.id, status: "approved" } }) : null;
    if (!release) throw new AppError("APPLICATION_NOT_FOUND");
    name = release.name;
    description = release.description;
    creatorName = release.publisherName;
  }
  return {
    iconSource: definition ? { iconPreset: definition.iconPreset, iconObjectKey: definition.iconObjectKey } : { iconPreset: application.iconPreset, iconObjectKey: application.iconObjectKey },
    details: {
      id: application.id, name, description, creator_name: creatorName,
      kind: definition?.kind ?? (application.kind === "interactive" ? "interactive" : "standard"),
      model: definition ? definition.model : application.model,
      status: application.status === "active" ? "active" : "disabled",
      view: ownConfiguration ? "configuration" : "published",
      version_number: version?.versionLabel ?? package_?.version ?? null,
      resources, created_at: application.createdAt.toISOString(),
      updated_at: (version?.createdAt ?? application.updatedAt).toISOString(),
    },
  };
}

async function describeResources(
  db: DetailsDatabase, ownerId: string, references: ResourceReference[], published: boolean,
): Promise<ApplicationResourceDetails[]> {
  const ids = (type: ResourceReference["type"]) => references.filter(item => item.type === type).map(item => item.id);
  const [capabilities, knowledge, mcp] = await Promise.all([
    db.capability.findMany({ where: { ownerId, id: { in: [...ids("plugin"), ...ids("skill")] } }, select: { id: true, type: true, name: true, status: true } }),
    db.knowledgeBase.findMany({ where: { ownerId, id: { in: ids("knowledge_base") } }, select: { id: true, name: true, lifecycleStatus: true, availabilityStatus: true } }),
    db.mcpServer.findMany({ where: { ownerId, id: { in: ids("mcp_server") } }, select: { id: true, name: true, status: true } }),
  ]);
  const live = new Map([
    ...capabilities.map(item => [`${item.type}:${item.id}`, { name: item.name, available: item.status === "active" }] as const),
    ...knowledge.map(item => [`knowledge_base:${item.id}`, { name: item.name, available: item.lifecycleStatus === "active" && item.availabilityStatus === "enabled" }] as const),
    ...mcp.map(item => [`mcp_server:${item.id}`, { name: item.name, available: item.status === "active" }] as const),
  ]);
  return references.map(item => {
    const resource = live.get(`${item.type}:${item.id}`);
    return {
      ...item, name: published ? item.name ?? resource?.name ?? null : resource?.name ?? item.name,
      configured_name: null, status: resource?.available ? "configured" : "unavailable",
    };
  });
}
