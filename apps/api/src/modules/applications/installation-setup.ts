import { isDeepStrictEqual } from "node:util";
import {
  applicationInstallationSetupSchema,
  reasoningEffortSchema,
  type ApplicationInstallationSetup,
  type ApplicationSetupBindingInput,
  type ApplicationSetupItem,
  type ApplicationSetupRevision,
  type ApplicationSetupModelInput,
  type InteractiveDependencyType,
} from "@linksense/shared";
import type { Prisma, Application, ApplicationInstallation, ApplicationVersion } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { ModelRuntimeSettingsReader } from "../system/model-provider-settings.js";
import { publishedApplicationDefinitionSchema, type PublishedApplicationDefinition } from "./published-definition.js";
import type { ApplicationCredentialResolver } from "./runtime-credentials.js";
import { declaredApplicationCredentialKeys } from "./runtime-credentials.js";
import { installedApplicationBaselineSchema } from "./installation-merge.js";

type SetupDatabase = Pick<Prisma.TransactionClient,
  "application" | "applicationInstallation" | "applicationVersion" | "applicationRuntimeInstallation" |
  "applicationCapability" | "applicationKnowledgeBase" | "applicationMcpServer" | "capability" | "knowledgeBase" | "mcpServer">;
type SetupReference = Pick<ApplicationSetupItem, "id" | "position" | "name" | "description"> & { type: InteractiveDependencyType };
type OwnedInstallation = { application: Application; installation: ApplicationInstallation; version: ApplicationVersion; definition: PublishedApplicationDefinition };
type InstallationSetupState = OwnedInstallation & { guide: ApplicationInstallationSetup; resourceIds: { capabilityIds: string[]; knowledgeBaseIds: string[]; mcpServerIds: string[] } };
type CapabilitySetupBinding = { capabilityId: string; capabilityTypeSnapshot: string; selectionOrder: number };

function capabilitySetupReferences(definition: PublishedApplicationDefinition, baselineJson: unknown, bindings: CapabilitySetupBinding[]): SetupReference[] {
  const baseline = installedApplicationBaselineSchema.parse(baselineJson);
  const assigned = new Map<string, number>();
  const occupied = new Set<number>();
  for (const reference of definition.capabilities) {
    const localId = baseline.capabilities.find(item => item.sourceId === reference.id)?.installedId;
    const binding = bindings.find(item => item.capabilityId === localId && item.capabilityTypeSnapshot === reference.type);
    if (binding) { assigned.set(reference.id, binding.selectionOrder); occupied.add(binding.selectionOrder); }
  }
  for (const reference of definition.capabilities.filter(item => !assigned.has(item.id))) {
    const replacement = bindings.find(item => !occupied.has(item.selectionOrder) && item.capabilityTypeSnapshot === reference.type);
    let position = replacement?.selectionOrder ?? 0;
    while (occupied.has(position) || (!replacement && bindings.some(item => item.selectionOrder === position))) position++;
    assigned.set(reference.id, position);
    occupied.add(position);
  }
  return definition.capabilities.map(item => {
    const position = assigned.get(item.id);
    if (position === undefined) throw new AppError("INTERNAL_ERROR");
    return { id: item.id, type: item.type, position, name: item.name, description: item.description?.slice(0, 4_000) ?? null };
  });
}

export function applicationSetupMatchesRuntime(
  definition: PublishedApplicationDefinition,
  current: { instructions: string | null; model: string | null; reasoningEffort: string | null; capabilityIds: string[]; knowledgeBaseIds: string[]; mcpServerIds: string[] },
): boolean {
  return isDeepStrictEqual(
    [definition.capabilities.map(item => item.id), definition.knowledgeBaseIds, definition.mcpServerIds, definition.model, definition.reasoningEffort, definition.instructions],
    [current.capabilityIds, current.knowledgeBaseIds, current.mcpServerIds, current.model, current.reasoningEffort, current.instructions],
  );
}

async function ownedInstallation(db: SetupDatabase, ownerId: string, applicationId: string): Promise<OwnedInstallation> {
  const [application, installation] = await Promise.all([
    db.application.findFirst({ where: { id: applicationId, ownerId, kind: "standard", status: { in: ["active", "disabled"] } } }),
    db.applicationInstallation.findFirst({ where: { applicationId, ownerId } }),
  ]);
  if (!application || !installation) throw new AppError("APPLICATION_NOT_FOUND");
  const version = await db.applicationVersion.findFirst({
    where: { id: installation.installedVersionId, applicationId: installation.sourceApplicationId, assetsReady: true },
  });
  if (!version) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  const definition = publishedApplicationDefinitionSchema.parse(version.definitionJson);
  return { application, installation, version, definition };
}

export function assertApplicationSetupRevision(
  state: { application: { updatedAt: Date }; installation: { installedVersionId: string } }, revision: ApplicationSetupRevision,
): void {
  if (state.installation.installedVersionId !== revision.installed_version_id || state.application.updatedAt.toISOString() !== revision.updated_at) {
    throw new AppError("CONFLICT");
  }
}

/** Read the pinned package, including requirements not copied into the personal app. */
export async function readApplicationInstallationSetup(
  db: SetupDatabase, credentials: ApplicationCredentialResolver,
  models: Pick<ModelRuntimeSettingsReader, "resolveRuntime" | "resolveRuntimeForSelection">,
  ownerId: string, applicationId: string,
): Promise<InstallationSetupState> {
  const state = await ownedInstallation(db, ownerId, applicationId);
  const { application, installation, version, definition } = state;
  const query = { where: { applicationId }, orderBy: { selectionOrder: "asc" as const } };
  const [capabilityBindings, knowledgeBindings, mcpBindings, publisher, selected] = await Promise.all([
    db.applicationCapability.findMany(query), db.applicationKnowledgeBase.findMany(query), db.applicationMcpServer.findMany(query),
    db.application.findUnique({ where: { id: installation.sourceApplicationId }, select: { ownerId: true } }),
    db.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId, applicationId } } }),
  ]);
  const [capabilities, knowledge, mcp, sourceKnowledge, sourceMcp, runtime] = await Promise.all([
    db.capability.findMany({ where: { ownerId, id: { in: capabilityBindings.map(item => item.capabilityId) } },
      select: { id: true, type: true, name: true, status: true, riskSummaryJson: true } }),
    db.knowledgeBase.findMany({ where: { ownerId, id: { in: knowledgeBindings.map(item => item.knowledgeBaseId) } },
      select: { id: true, name: true, lifecycleStatus: true, availabilityStatus: true } }),
    db.mcpServer.findMany({ where: { ownerId, id: { in: mcpBindings.map(item => item.mcpServerId) } }, select: { id: true, name: true, status: true } }),
    publisher ? db.knowledgeBase.findMany({ where: { ownerId: publisher.ownerId, id: { in: definition.knowledgeBaseIds } }, select: { id: true, name: true } }) : [],
    publisher ? db.mcpServer.findMany({ where: { ownerId: publisher.ownerId, id: { in: definition.mcpServerIds } }, select: { id: true, name: true } }) : [],
    selected ? db.applicationVersion.findFirst({ where: { id: selected.versionId, applicationId, assetsReady: true } }) : null,
  ]);
  const capabilityReferences = capabilitySetupReferences(definition, installation.baselineJson, capabilityBindings);
  const occupied = new Set(capabilityReferences.map(item => item.position));
  const references: SetupReference[] = [
    ...capabilityReferences,
    ...definition.knowledgeBaseIds.map((id, position) => ({ id, type: "knowledge_base" as const, position, name: sourceKnowledge.find(item => item.id === id)?.name ?? null, description: null })),
    ...definition.mcpServerIds.map((id, position) => ({ id, type: "mcp_server" as const, position, name: sourceMcp.find(item => item.id === id)?.name ?? null, description: null })),
  ];
  // Personal additions remain part of the configuration and must also be usable.
  for (const binding of capabilityBindings.filter(item => !occupied.has(item.selectionOrder))) {
    if (binding.capabilityTypeSnapshot !== "plugin" && binding.capabilityTypeSnapshot !== "skill") throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    references.push({ id: binding.capabilityId, type: binding.capabilityTypeSnapshot, position: binding.selectionOrder, name: binding.capabilityNameSnapshot, description: null });
  }
  for (const binding of knowledgeBindings.filter(item => item.selectionOrder >= definition.knowledgeBaseIds.length)) {
    references.push({ id: binding.knowledgeBaseId, type: "knowledge_base", position: binding.selectionOrder, name: binding.knowledgeBaseNameSnapshot, description: null });
  }
  for (const binding of mcpBindings.filter(item => item.selectionOrder >= definition.mcpServerIds.length)) {
    references.push({ id: binding.mcpServerId, type: "mcp_server", position: binding.selectionOrder, name: binding.mcpServerNameSnapshot, description: null });
  }
  const items = await Promise.all(references.map(async (reference): Promise<ApplicationSetupItem> => {
    let resourceId: string | null;
    let resourceName: string | null;
    let status: ApplicationSetupItem["status"];
    if (reference.type === "plugin" || reference.type === "skill") {
      const binding = capabilityBindings.find(item => item.selectionOrder === reference.position);
      resourceId = binding?.capabilityId ?? null;
      const resource = capabilities.find(item => item.id === resourceId && item.type === reference.type);
      resourceName = resource?.name ?? binding?.capabilityNameSnapshot ?? null;
      status = resourceId ? resource?.status === "active" ? "configured" : "unavailable" : "unconfigured";
      if (status === "configured" && resource?.type === "plugin") {
        const keys = declaredApplicationCredentialKeys(resource.riskSummaryJson);
        if (keys.length && !(await credentials.resolveForCapability(ownerId, resource.id, keys)).ok) status = "credentials_required";
      }
    } else if (reference.type === "knowledge_base") {
      const binding = knowledgeBindings.find(item => item.selectionOrder === reference.position);
      resourceId = binding?.knowledgeBaseId ?? null;
      const resource = knowledge.find(item => item.id === resourceId);
      resourceName = resource?.name ?? binding?.knowledgeBaseNameSnapshot ?? null;
      status = resourceId ? resource?.lifecycleStatus === "active" && resource.availabilityStatus === "enabled" ? "configured" : "unavailable" : "unconfigured";
    } else {
      const binding = mcpBindings.find(item => item.selectionOrder === reference.position);
      resourceId = binding?.mcpServerId ?? null;
      const resource = mcp.find(item => item.id === resourceId);
      resourceName = resource?.name ?? binding?.mcpServerNameSnapshot ?? null;
      status = resourceId ? resource?.status === "active" ? "configured" : "unavailable" : "unconfigured";
    }
    return { ...reference, resource_id: resourceId, resource_name: resourceName, status };
  }));
  let modelAvailable = true;
  try {
    if ((application.model === null) !== (application.reasoningEffort === null)) throw new AppError("MODEL_SELECTION_INVALID");
    if (application.model && application.reasoningEffort) {
      await models.resolveRuntimeForSelection(application.model, reasoningEffortSchema.parse(application.reasoningEffort));
    } else {
      await models.resolveRuntime(ownerId);
    }
  } catch (error) {
    if (!(error instanceof AppError) || !["MODEL_PROVIDER_NOT_CONFIGURED", "MODEL_SELECTION_INVALID", "MODEL_PROVIDER_CREDENTIAL_REQUIRED"].includes(error.code)) throw error;
    modelAvailable = false;
  }
  items.push({ id: applicationId, type: "model", position: 0, name: application.model?.slice(0, 160) ?? null, description: null,
    resource_id: null, resource_name: null, status: modelAvailable ? "configured" : "unavailable" });
  const canComplete = items.every(item => item.status === "configured");
  const installed = runtime ? publishedApplicationDefinitionSchema.parse(runtime.definitionJson) : null;
  const resourceIds = {
    capabilityIds: capabilityBindings.map(item => item.capabilityId),
    knowledgeBaseIds: knowledgeBindings.map(item => item.knowledgeBaseId),
    mcpServerIds: mcpBindings.map(item => item.mcpServerId),
  };
  const activated = installed !== null && applicationSetupMatchesRuntime(installed, { ...resourceIds, instructions: application.instructions, model: application.model, reasoningEffort: application.reasoningEffort });
  const guide: ApplicationInstallationSetup = applicationInstallationSetupSchema.parse({
    application_id: applicationId, installed_version_id: installation.installedVersionId, installed_version_number: version.versionLabel,
    updated_at: application.updatedAt.toISOString(), usage_instructions: definition.usageInstructions,
    model: application.model, reasoning_effort: application.reasoningEffort,
    items, can_complete: canComplete, can_use: canComplete && activated && application.status === "active",
  });
  return { ...state, guide, resourceIds };
}

export async function saveApplicationSetupModel(
  db: SetupDatabase, models: Pick<ModelRuntimeSettingsReader, "resolveRuntime" | "resolveRuntimeForSelection">,
  ownerId: string, applicationId: string, input: ApplicationSetupModelInput,
): Promise<void> {
  const state = await ownedInstallation(db, ownerId, applicationId);
  assertApplicationSetupRevision(state, input);
  if ((input.model === null) !== (input.reasoning_effort === null)) throw new AppError("VALIDATION_ERROR");
  if (input.model !== null && input.reasoning_effort !== null) await models.resolveRuntimeForSelection(input.model, input.reasoning_effort);
  else await models.resolveRuntime(ownerId);
  const changed = await db.application.updateMany({ where: { id: applicationId, ownerId, updatedAt: state.application.updatedAt }, data: {
    model: input.model, reasoningEffort: input.reasoning_effort, updatedAt: new Date(Math.max(Date.now(), state.application.updatedAt.getTime() + 1)),
  } });
  if (changed.count !== 1) throw new AppError("CONFLICT");
}

/** Called inside the runtime gate and transaction; positions preserve partially configured steps. */
export async function saveApplicationSetupBinding(
  db: SetupDatabase, ownerId: string, applicationId: string, input: ApplicationSetupBindingInput,
): Promise<void> {
  const state = await ownedInstallation(db, ownerId, applicationId);
  assertApplicationSetupRevision(state, input);
  const { position, resource_id: resourceId, type } = input;
  const capability = type === "plugin" || type === "skill";
  const capabilityBindings = capability ? await db.applicationCapability.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }) : [];
  const required = capability ? capabilitySetupReferences(state.definition, state.installation.baselineJson, capabilityBindings).some(item => item.type === type && item.position === position)
    : position < (type === "knowledge_base" ? state.definition.knowledgeBaseIds.length : state.definition.mcpServerIds.length);
  const bindings = capability ? capabilityBindings
    : type === "knowledge_base" ? await db.applicationKnowledgeBase.findMany({ where: { applicationId } })
    : await db.applicationMcpServer.findMany({ where: { applicationId } });
  if (!required && !bindings.some(item => item.selectionOrder === position)) throw new AppError("VALIDATION_ERROR");
  if (resourceId && !bindings.some(item => item.selectionOrder === position) && bindings.length >= (capability ? 50 : 20)) throw new AppError("VALIDATION_ERROR");
  let name: string | null = null;
  if (resourceId) {
    const resource = capability ? await db.capability.findFirst({ where: { id: resourceId, ownerId, type, status: "active" }, select: { id: true, name: true } })
      : type === "knowledge_base" ? await db.knowledgeBase.findFirst({ where: { id: resourceId, ownerId, lifecycleStatus: "active", availabilityStatus: "enabled" }, select: { id: true, name: true } })
      : await db.mcpServer.findFirst({ where: { id: resourceId, ownerId, status: "active" }, select: { id: true, name: true } });
    if (!resource) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    name = resource.name;
    if (bindings.some(item => item.selectionOrder !== position && (
      "capabilityId" in item ? item.capabilityId : "knowledgeBaseId" in item ? item.knowledgeBaseId : item.mcpServerId
    ) === resourceId)) throw new AppError("VALIDATION_ERROR");
  }
  const where = { applicationId, selectionOrder: position };
  if (capability) {
    await db.applicationCapability.deleteMany({ where });
    if (resourceId && name) await db.applicationCapability.create({ data: { applicationId, selectionOrder: position, capabilityId: resourceId, capabilityNameSnapshot: name, capabilityTypeSnapshot: type } });
  } else if (type === "knowledge_base") {
    await db.applicationKnowledgeBase.deleteMany({ where });
    if (resourceId && name) await db.applicationKnowledgeBase.create({ data: { applicationId, selectionOrder: position, knowledgeBaseId: resourceId, knowledgeBaseNameSnapshot: name } });
  } else {
    await db.applicationMcpServer.deleteMany({ where });
    if (resourceId && name) await db.applicationMcpServer.create({ data: { applicationId, selectionOrder: position, mcpServerId: resourceId, mcpServerNameSnapshot: name } });
  }
  const changed = await db.application.updateMany({ where: { id: applicationId, ownerId, updatedAt: state.application.updatedAt }, data: { updatedAt: new Date(Math.max(Date.now(), state.application.updatedAt.getTime() + 1)) } });
  if (changed.count !== 1) throw new AppError("CONFLICT");
}
