import {
  interactiveApplicationManifestSchema, interactiveDependencyBindingsSchema,
  interactiveDependencyDeclarations,
  type InteractiveApplicationManifest, type InteractiveDependencyBinding,
  type InteractiveDependencyState, type InteractiveDependencyType, type InteractiveDependencyOptions,
} from "@linksense/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

type DependencyDatabase = Pick<Prisma.TransactionClient, "capability" | "knowledgeBase" | "mcpServer">;
const identity = (item: { type: string; id: string }): string => `${item.type}:${item.id}`;

export async function listInteractiveDependencyOptions(
  db: DependencyDatabase, ownerId: string, type: InteractiveDependencyType,
  search?: string, cursor?: string,
): Promise<InteractiveDependencyOptions> {
  const where = { ownerId, ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) };
  const query = { select: { id: true, name: true }, orderBy: { id: "asc" as const }, take: 101 };
  let resources: Array<{ id: string; name: string }>;
  switch (type) {
    case "plugin": case "skill": resources = await db.capability.findMany({ ...query, where: { ...where, status: "active", type } }); break;
    case "mcp_server": resources = await db.mcpServer.findMany({ ...query, where: { ...where, status: "active" } }); break;
    case "knowledge_base": resources = await db.knowledgeBase.findMany({ ...query, where: { ...where, lifecycleStatus: "active", availabilityStatus: "enabled" } }); break;
  }
  const items = resources.slice(0, 100);
  return { items, next_cursor: resources.length > 100 ? items.at(-1)?.id ?? null : null };
}

/** Declarations are portable metadata, never authorization or credentials. */
export async function resolveInteractiveDependencies(
  db: DependencyDatabase,
  ownerId: string,
  manifest: InteractiveApplicationManifest,
  previous: unknown = [],
  selections: InteractiveDependencyBinding[] = [],
  autoMatch = true,
): Promise<InteractiveDependencyState> {
  const declarations = interactiveDependencyDeclarations(manifest.dependencies);
  const prior = new Map(interactiveDependencyBindingsSchema.parse(previous).map(item => [identity(item), item]));
  const selected = new Map(interactiveDependencyBindingsSchema.parse(selections).map(item => [identity(item), item]));
  const declared = new Set(declarations.map(identity));
  if ([...selected.keys()].some(key => !declared.has(key))) throw new AppError("VALIDATION_ERROR");
  const proposed = declarations.map(item => {
    const binding = selected.get(identity(item)) ?? prior.get(identity(item));
    return { ...item, resource_id: binding ? binding.resource_id : autoMatch ? item.id : null };
  });
  const idsFor = (...types: InteractiveDependencyType[]): string[] => [...new Set(proposed.flatMap(item => types.includes(item.type) && item.resource_id ? [item.resource_id] : []))];
  const capabilityIds = idsFor("plugin", "skill");
  const knowledgeIds = idsFor("knowledge_base");
  const mcpIds = idsFor("mcp_server");
  const [capabilities, knowledge, mcp] = await Promise.all([
    capabilityIds.length ? db.capability.findMany({ where: { id: { in: capabilityIds }, ownerId, status: "active" }, select: { id: true, name: true, type: true } }) : [],
    knowledgeIds.length ? db.knowledgeBase.findMany({ where: { id: { in: knowledgeIds }, ownerId, lifecycleStatus: "active", availabilityStatus: "enabled" }, select: { id: true, name: true } }) : [],
    mcpIds.length ? db.mcpServer.findMany({ where: { id: { in: mcpIds }, ownerId, status: "active" }, select: { id: true, name: true } }) : [],
  ]);
  const resources = new Map([
    ...capabilities.map(item => [identity(item), item.name] as const),
    ...knowledge.map(item => [identity({ ...item, type: "knowledge_base" }), item.name] as const),
    ...mcp.map(item => [identity({ ...item, type: "mcp_server" }), item.name] as const),
  ]);
  return { items: proposed.map(item => {
    const resourceName = item.resource_id ? resources.get(identity({ type: item.type, id: item.resource_id })) : undefined;
    // A supplied binding must be authorized even when imports allow missing declarations.
    if (selected.get(identity(item))?.resource_id && resourceName === undefined) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    const explicitlyBound = prior.has(identity(item)) || selected.has(identity(item));
    return { ...item, resource_id: resourceName === undefined && !explicitlyBound ? null : item.resource_id,
      resource_name: resourceName ?? null, available: resourceName !== undefined };
  }) };
}

export function dependencyBindings(state: InteractiveDependencyState): InteractiveDependencyBinding[] {
  return state.items.map(({ type, id, resource_id }) => ({ type, id, resource_id }));
}

export function interactiveRuntimeDependencyIds(state: InteractiveDependencyState): {
  capabilityIds: string[]; knowledgeBaseIds: string[]; mcpServerIds: string[];
} {
  const ids = (...types: InteractiveDependencyType[]): string[] => [...new Set(state.items.flatMap(item =>
    types.includes(item.type) && item.resource_id ? [item.resource_id] : []))];
  return { capabilityIds: ids("plugin", "skill"), knowledgeBaseIds: ids("knowledge_base"), mcpServerIds: ids("mcp_server") };
}

/** Actual runtime bindings are deduplicated; several declarations may use one resource. */
export async function writeInteractiveRuntimeBindings(
  tx: Pick<Prisma.TransactionClient, "applicationCapability" | "applicationKnowledgeBase" | "applicationMcpServer">,
  applicationId: string, state: InteractiveDependencyState, replace: boolean,
): Promise<void> {
  if (replace) await Promise.all([
    tx.applicationCapability.deleteMany({ where: { applicationId } }),
    tx.applicationKnowledgeBase.deleteMany({ where: { applicationId } }),
    tx.applicationMcpServer.deleteMany({ where: { applicationId } }),
  ]);
  const bound = state.items.filter((item): item is typeof item & { resource_id: string } => item.resource_id !== null);
  const unique = [...new Map(bound.map(item => [`${item.type}:${item.resource_id}`, item])).values()];
  const capabilities = unique.filter(item => item.type === "plugin" || item.type === "skill");
  const knowledge = unique.filter(item => item.type === "knowledge_base");
  const mcp = unique.filter(item => item.type === "mcp_server");
  if (capabilities.length) await tx.applicationCapability.createMany({ data: capabilities.map((item, selectionOrder) => ({ applicationId,
    capabilityId: item.resource_id, capabilityNameSnapshot: item.resource_name ?? item.name, capabilityTypeSnapshot: item.type, selectionOrder })) });
  if (knowledge.length) await tx.applicationKnowledgeBase.createMany({ data: knowledge.map((item, selectionOrder) => ({ applicationId,
    knowledgeBaseId: item.resource_id, knowledgeBaseNameSnapshot: item.resource_name ?? item.name, selectionOrder })) });
  if (mcp.length) await tx.applicationMcpServer.createMany({ data: mcp.map((item, selectionOrder) => ({ applicationId,
    mcpServerId: item.resource_id, mcpServerNameSnapshot: item.resource_name ?? item.name, selectionOrder })) });
}

export function interactiveBindingsComplete(manifestJson: unknown, bindingsJson: unknown = []): boolean {
  const manifest = interactiveApplicationManifestSchema.parse(manifestJson);
  const bindings = new Map(interactiveDependencyBindingsSchema.parse(bindingsJson).map(item => [identity(item), item]));
  return interactiveDependencyDeclarations(manifest.dependencies).every(item => Boolean(bindings.get(identity(item))?.resource_id));
}

export async function assertInteractiveDependenciesReady(db: DependencyDatabase, ownerId: string, manifestJson: unknown, bindingsJson: unknown): Promise<void> {
  const state = await resolveInteractiveDependencies(db, ownerId, interactiveApplicationManifestSchema.parse(manifestJson), bindingsJson, [], false);
  if (state.items.some(item => !item.available)) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
}
