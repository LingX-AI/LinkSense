import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import {
  APPLICATION_ICON_MAX_BYTES,
  APPLICATION_ICON_MAX_DIMENSION,
  applicationIconInputSchema,
  applicationIconPresetSchema,
  applicationSchema,
  type Application,
  type ApplicationUnavailableReason,
  type ApplicationIconInput,
  type ApplicationIconPreset,
  type CreateApplicationInput,
  interactiveApplicationManifestSchema,
  type UpdateApplicationInput,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import type { RequestActor } from "../capabilities/types.js";
import type { CredentialService } from "../credentials/service.js";
import type { ModelRuntimeSettingsReader } from "../system/model-provider-settings.js";
import {
  inspectInteractiveApplicationArchive,
} from "./interactive-package.js";

export type ApplicationRuntimeConfiguration = {
  kind: "standard" | "interactive";
  applicationId: string;
  applicationOwnerId: string;
  applicationName: string;
  applicationUpdatedAt: Date;
  instructions: string;
  model: string | null;
  reasoningEffort:
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | "ultra"
    | null;
  capabilityIds: string[];
  knowledgeBaseIds: string[];
  mcpServerIds: string[];
};

type ApplicationListScope = "all" | "owned" | "shared";
type ApplicationShareTargetType = "user" | "user_group";
type AccessibleApplications = {
  owned: Set<string>;
  shared: Set<string>;
  accessSource: Map<string, "direct" | "user_group">;
};

export type ApplicationTaskMetadata = {
  icon: Application["icon"];
  available: boolean;
  unavailable_reason: ApplicationUnavailableReason | null;
};

export interface ApplicationIconStore {
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(objectKey: string): Promise<void>;
  presignGet(objectKey: string, expiresSeconds: number): Promise<string>;
  enqueueRemoval?(objectKey: string): Promise<void>;
}

export interface InteractiveApplicationAssetStore {
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Readable>;
  remove(objectKey: string): Promise<void>;
}

type PreparedApplicationIcon = {
  preset: ApplicationIconPreset;
  objectKey: string | null;
  newObjectKey: string | null;
};

export class ApplicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly models: ModelRuntimeSettingsReader,
    private readonly audit: AuditService,
    private readonly credentials: Pick<CredentialService, "resolveForCapability">,
    private readonly iconStore?: ApplicationIconStore,
    private readonly interactiveAssetStore?: InteractiveApplicationAssetStore,
  ) {}

  async list(
    actor: RequestActor,
    input: { scope: ApplicationListScope; search?: string; limit: number },
  ): Promise<Application[]> {
    assertActiveActor(actor);
    const access = await this.#resolveAccessibleApplicationIds(
      actor.id,
      actor.registrationSource,
    );
    const ids =
      input.scope === "owned"
        ? [...access.owned]
        : input.scope === "shared"
          ? [...access.shared]
          : [...new Set([...access.owned, ...access.shared])];
    if (ids.length === 0) return [];
    const rows = await this.prisma.application.findMany({
      where: {
        id: { in: ids },
        status: { in: ["active", "disabled"] },
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                {
                  description: {
                    contains: input.search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return this.#projectApplications(
      actor.id,
      rows,
      access,
      actor.registrationSource !== "self_registration",
    );
  }

  async get(actor: RequestActor, applicationId: string): Promise<Application> {
    assertActiveActor(actor);
    const access = await this.#resolveAccessibleApplicationIds(
      actor.id,
      actor.registrationSource,
    );
    if (!access.owned.has(applicationId) && !access.shared.has(applicationId)) {
      throw new AppError("APPLICATION_NOT_FOUND");
    }
    const row = await this.prisma.application.findFirst({
      where: {
        id: applicationId,
        status: { in: ["active", "disabled"] },
      },
    });
    if (!row) throw new AppError("APPLICATION_NOT_FOUND");
    const [projected] = await this.#projectApplications(
      actor.id,
      [row],
      access,
      actor.registrationSource !== "self_registration",
    );
    if (!projected) throw new AppError("APPLICATION_NOT_FOUND");
    return projected;
  }

  async resolveTaskMetadata(
    actorId: string,
    applicationIds: readonly string[],
  ): Promise<ReadonlyMap<string, ApplicationTaskMetadata>> {
    const requestedIds = [...new Set(applicationIds)];
    if (requestedIds.length === 0) return new Map();
    const actor = await this.prisma.user.findFirst({
      where: { id: actorId, status: "active" },
      select: { selfRegisteredAt: true },
    });
    if (!actor) return new Map();
    const access = await this.#resolveAccessibleApplicationIds(
      actorId,
      actor.selfRegisteredAt
        ? "self_registration"
        : "organization_invitation",
    );
    const accessibleIds = requestedIds.filter(
      (applicationId) =>
        access.owned.has(applicationId) || access.shared.has(applicationId),
    );
    if (accessibleIds.length === 0) return new Map();
    const rows = await this.prisma.application.findMany({
      where: {
        id: { in: accessibleIds },
        status: { in: ["active", "disabled"] },
      },
    });
    if (rows.length === 0) return new Map();
    const applications = await this.#projectApplications(
      actorId,
      rows,
      access,
      false,
    );
    return new Map(
      applications.map((application) => {
        const reason =
          application.status !== "active"
            ? "APPLICATION_DISABLED"
            : !application.dependencies_available
              ? "APPLICATION_DEPENDENCY_UNAVAILABLE"
              : null;
        return [
          application.id,
          {
            icon: application.icon,
            available: reason === null,
            unavailable_reason: reason,
          },
        ];
      }),
    );
  }

  async create(
    actor: RequestActor,
    input: CreateApplicationInput,
    context: AuditContext,
  ): Promise<Application> {
    assertActiveActor(actor);
    const dependencies = await this.#validateDependencies(actor.id, {
      capabilityIds: input.capability_ids,
      knowledgeBaseIds: input.knowledge_base_ids,
      mcpServerIds: input.mcp_server_ids,
    });
    if (input.model !== null && input.reasoning_effort !== null) {
      await this.models.resolveRuntimeForSelection(
        input.model,
        input.reasoning_effort,
      );
    }
    const preparedIcon = await this.#prepareIcon(actor.id, input.icon);
    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.application.create({
          data: {
            ownerId: actor.id,
            name: input.name,
            iconPreset: preparedIcon.preset,
            iconObjectKey: preparedIcon.objectKey,
            description: input.description ?? null,
            instructions: input.instructions,
            model: input.model,
            reasoningEffort: input.reasoning_effort,
            status: input.status ?? "active",
          },
        });
        if (dependencies.capabilities.length > 0) {
          await tx.applicationCapability.createMany({
            data: dependencies.capabilities.map((capability, index) => ({
              applicationId: created.id,
              capabilityId: capability.id,
              capabilityNameSnapshot: capability.name,
              capabilityTypeSnapshot: capability.type,
              selectionOrder: index,
            })),
          });
        }
        if (dependencies.knowledgeBases.length > 0) {
          await tx.applicationKnowledgeBase.createMany({
            data: dependencies.knowledgeBases.map((knowledgeBase, index) => ({
              applicationId: created.id,
              knowledgeBaseId: knowledgeBase.id,
              knowledgeBaseNameSnapshot: knowledgeBase.name,
              selectionOrder: index,
            })),
          });
        }
        if (dependencies.mcpServers.length > 0) {
          await tx.applicationMcpServer.createMany({
            data: dependencies.mcpServers.map((server, index) => ({
              applicationId: created.id,
              mcpServerId: server.id,
              mcpServerNameSnapshot: server.name,
              selectionOrder: index,
            })),
          });
        }
        return created;
      });
    } catch (error) {
      if (preparedIcon.newObjectKey) {
        await this.#removeIconAfterFailure(preparedIcon.newObjectKey);
      }
      throw error;
    }
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "application_created",
      targetType: "application",
      targetId: row.id,
      result: "success",
      metadata: {
        capability_count: input.capability_ids.length,
        knowledge_base_count: input.knowledge_base_ids.length,
        mcp_server_count: input.mcp_server_ids.length,
        model: input.model,
      },
    });
    return this.get(actor, row.id);
  }

  async importInteractive(
    actor: RequestActor,
    archive: Buffer,
    context: AuditContext,
  ): Promise<Application> {
    assertActiveActor(actor);
    const prepared = await inspectInteractiveApplicationArchive(archive);
    const applicationId = randomUUID();
    const packageId = randomUUID();
    const iconObjectKey = prepared.icon
      ? `applications/${actor.id}/${applicationId}/icon/${randomUUID()}`
      : null;
    const uploadedObjectKeys: string[] = [];
    if (!this.interactiveAssetStore) throw new AppError("INTERNAL_ERROR");
    try {
      for (const asset of prepared.assets) {
        const objectKey = interactiveAssetObjectKey(
          actor.id,
          applicationId,
          packageId,
          asset.path,
        );
        await this.interactiveAssetStore.put(
          objectKey,
          asset.bytes,
          asset.contentType,
        );
        uploadedObjectKeys.push(objectKey);
      }
      if (prepared.icon && iconObjectKey) {
        if (!this.iconStore) throw new AppError("INTERNAL_ERROR");
        await this.iconStore.put(
          iconObjectKey,
          prepared.icon.bytes,
          prepared.icon.contentType,
        );
        uploadedObjectKeys.push(iconObjectKey);
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.application.create({
          data: {
            id: applicationId,
            ownerId: actor.id,
            name: prepared.manifest.name,
            kind: "interactive",
            iconPreset: "sparkles",
            iconObjectKey,
            description: prepared.manifest.description,
            instructions:
              prepared.manifest.instructions ??
              interactiveApplicationBaseInstructions(prepared.manifest.name),
            model: null,
            reasoningEffort: null,
            interactivePackageId: packageId,
            status: "active",
          },
        });
        await tx.interactiveApplicationPackage.create({
          data: {
            id: packageId,
            applicationId,
            version: prepared.manifest.version,
            manifestJson: prepared.manifest,
            archiveSha256: prepared.archiveSha256,
            fileCount: prepared.assets.length,
            expandedBytes: prepared.expandedBytes,
            createdBy: actor.id,
          },
        });
        await tx.interactiveApplicationAsset.createMany({
          data: prepared.assets.map((asset) => ({
            packageId,
            path: asset.path,
            objectKey: interactiveAssetObjectKey(
              actor.id,
              applicationId,
              packageId,
              asset.path,
            ),
            contentType: asset.contentType,
            byteSize: asset.bytes.byteLength,
            sha256: asset.sha256,
          })),
        });
      });
    } catch (error) {
      await Promise.allSettled(
        uploadedObjectKeys.map((objectKey) =>
          objectKey === iconObjectKey
            ? this.iconStore?.remove(objectKey)
            : this.interactiveAssetStore?.remove(objectKey),
        ),
      );
      if (isPackageVersionConflict(error)) {
        throw new AppError("APPLICATION_PACKAGE_VERSION_CONFLICT");
      }
      throw error;
    }
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "interactive_application_imported",
      targetType: "application",
      targetId: applicationId,
      result: "success",
      metadata: {
        package_version: prepared.manifest.version,
        file_count: prepared.assets.length,
        expanded_bytes: prepared.expandedBytes,
      },
    });
    return this.get(actor, applicationId);
  }

  async updateInteractivePackage(
    actor: RequestActor,
    applicationId: string,
    archive: Buffer,
    context: AuditContext,
  ): Promise<Application> {
    assertActiveActor(actor);
    const current = await this.#requireOwned(actor.id, applicationId);
    if (current.kind !== "interactive") {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    const prepared = await inspectInteractiveApplicationArchive(archive);
    const packageId = randomUUID();
    const nextIconObjectKey = prepared.icon
      ? `applications/${actor.id}/${applicationId}/icon/${randomUUID()}`
      : current.iconObjectKey;
    const uploadedObjectKeys: string[] = [];
    if (!this.interactiveAssetStore) throw new AppError("INTERNAL_ERROR");
    try {
      for (const asset of prepared.assets) {
        const objectKey = interactiveAssetObjectKey(
          actor.id,
          applicationId,
          packageId,
          asset.path,
        );
        await this.interactiveAssetStore.put(
          objectKey,
          asset.bytes,
          asset.contentType,
        );
        uploadedObjectKeys.push(objectKey);
      }
      if (
        prepared.icon &&
        nextIconObjectKey &&
        nextIconObjectKey !== current.iconObjectKey
      ) {
        if (!this.iconStore) throw new AppError("INTERNAL_ERROR");
        await this.iconStore.put(
          nextIconObjectKey,
          prepared.icon.bytes,
          prepared.icon.contentType,
        );
        uploadedObjectKeys.push(nextIconObjectKey);
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.interactiveApplicationPackage.create({
          data: {
            id: packageId,
            applicationId,
            version: prepared.manifest.version,
            manifestJson: prepared.manifest,
            archiveSha256: prepared.archiveSha256,
            fileCount: prepared.assets.length,
            expandedBytes: prepared.expandedBytes,
            createdBy: actor.id,
          },
        });
        await tx.interactiveApplicationAsset.createMany({
          data: prepared.assets.map((asset) => ({
            packageId,
            path: asset.path,
            objectKey: interactiveAssetObjectKey(
              actor.id,
              applicationId,
              packageId,
              asset.path,
            ),
            contentType: asset.contentType,
            byteSize: asset.bytes.byteLength,
            sha256: asset.sha256,
          })),
        });
        const updated = await tx.application.updateMany({
          where: {
            id: applicationId,
            ownerId: actor.id,
            kind: "interactive",
            updatedAt: current.updatedAt,
          },
          data: {
            name: prepared.manifest.name,
            description: prepared.manifest.description,
            instructions:
              prepared.manifest.instructions ??
              interactiveApplicationBaseInstructions(prepared.manifest.name),
            iconObjectKey: nextIconObjectKey,
            interactivePackageId: packageId,
            updatedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new AppError("CONFLICT");
      });
    } catch (error) {
      await Promise.allSettled(
        uploadedObjectKeys.map((objectKey) =>
          objectKey === nextIconObjectKey
            ? this.iconStore?.remove(objectKey)
            : this.interactiveAssetStore?.remove(objectKey),
        ),
      );
      if (isPackageVersionConflict(error)) {
        throw new AppError("APPLICATION_PACKAGE_VERSION_CONFLICT");
      }
      throw error;
    }
    if (
      prepared.icon &&
      current.iconObjectKey &&
      current.iconObjectKey !== nextIconObjectKey
    ) {
      await this.#enqueueIconRemoval(current.iconObjectKey);
    }
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "interactive_application_package_updated",
      targetType: "application",
      targetId: applicationId,
      result: "success",
      metadata: {
        package_version: prepared.manifest.version,
        file_count: prepared.assets.length,
      },
    });
    return this.get(actor, applicationId);
  }

  async resolveInteractiveRuntimePackage(
    actor: RequestActor,
    applicationId: string,
    requestedPackageId?: string,
  ) {
    assertActiveActor(actor);
    const application = await this.#requireCurrentAccess(
      actor.id,
      applicationId,
    );
    const packageId = requestedPackageId ?? application.interactivePackageId;
    if (application.kind !== "interactive" || !packageId) {
      throw new AppError("APPLICATION_NOT_FOUND");
    }
    const package_ = await this.prisma.interactiveApplicationPackage.findFirst({
      where: { id: packageId, applicationId },
      select: { id: true, manifestJson: true },
    });
    if (!package_) throw new AppError("APPLICATION_NOT_FOUND");
    return {
      id: package_.id,
      manifest: interactiveApplicationManifestSchema.parse(
        package_.manifestJson,
      ),
    };
  }

  async createInteractiveRuntimeTicket(
    actor: RequestActor,
    applicationId: string,
    requestedPackageId?: string,
  ) {
    const package_ = await this.resolveInteractiveRuntimePackage(
      actor,
      applicationId,
      requestedPackageId,
    );
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    await this.prisma.interactiveApplicationRuntimeTicket.create({
      data: {
        tokenHash: sha256(token),
        ownerId: actor.id,
        applicationId,
        packageId: package_.id,
        expiresAt,
      },
    });
    return { token, expiresAt, manifest: package_.manifest };
  }

  async getInteractiveAssetForTicket(token: string, path: string) {
    const ticket = await this.prisma.interactiveApplicationRuntimeTicket.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!ticket || ticket.expiresAt <= new Date()) {
      throw new AppError("APPLICATION_NOT_FOUND");
    }
    const application = await this.#requireCurrentAccess(
      ticket.ownerId,
      ticket.applicationId,
    );
    if (application.kind !== "interactive") {
      throw new AppError("APPLICATION_NOT_FOUND");
    }
    return this.#loadInteractiveAsset(
      ticket.applicationId,
      ticket.packageId,
      path,
    );
  }

  async #loadInteractiveAsset(
    applicationId: string,
    packageId: string,
    path: string,
  ) {
    if (!this.interactiveAssetStore) throw new AppError("INTERNAL_ERROR");
    const asset = await this.prisma.interactiveApplicationAsset.findFirst({
      where: { packageId, path },
    });
    const package_ = asset
      ? await this.prisma.interactiveApplicationPackage.findFirst({
          where: { id: packageId, applicationId },
          select: { id: true },
        })
      : null;
    if (!asset || !package_) throw new AppError("APPLICATION_NOT_FOUND");
    return {
      data: await this.interactiveAssetStore.get(asset.objectKey),
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      etag: asset.sha256,
    };
  }

  async update(
    actor: RequestActor,
    applicationId: string,
    input: UpdateApplicationInput,
    context: AuditContext,
  ): Promise<Application> {
    assertActiveActor(actor);
    const current = await this.#requireOwned(actor.id, applicationId);
    if (
      current.kind === "interactive" &&
      Object.keys(input).some((key) => key !== "status")
    ) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    const capabilityIds =
      input.capability_ids ??
      (
        await this.prisma.applicationCapability.findMany({
          where: { applicationId },
          orderBy: { selectionOrder: "asc" },
          select: { capabilityId: true },
        })
      ).map((binding) => binding.capabilityId);
    const knowledgeBaseIds =
      input.knowledge_base_ids ??
      (
        await this.prisma.applicationKnowledgeBase.findMany({
          where: { applicationId },
          orderBy: { selectionOrder: "asc" },
          select: { knowledgeBaseId: true },
        })
      ).map((binding) => binding.knowledgeBaseId);
    const mcpServerIds =
      input.mcp_server_ids ??
      (
        await this.prisma.applicationMcpServer.findMany({
          where: { applicationId },
          orderBy: { selectionOrder: "asc" },
          select: { mcpServerId: true },
        })
      ).map((binding) => binding.mcpServerId);
    const dependencies = await this.#validateDependencies(actor.id, {
      capabilityIds,
      knowledgeBaseIds,
      mcpServerIds,
    });
    const model = input.model === undefined ? current.model : input.model;
    const reasoningEffort =
      input.reasoning_effort === undefined
        ? (current.reasoningEffort as ApplicationRuntimeConfiguration["reasoningEffort"])
        : input.reasoning_effort;
    if (model !== null && reasoningEffort !== null) {
      await this.models.resolveRuntimeForSelection(model, reasoningEffort);
    }
    const preparedIcon =
      input.icon === undefined
        ? null
        : await this.#prepareIcon(actor.id, input.icon);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.application.updateMany({
          where: {
            id: applicationId,
            ownerId: actor.id,
            status: { in: ["active", "disabled"] },
            updatedAt: current.updatedAt,
          },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(preparedIcon === null
              ? {}
              : {
                  iconPreset: preparedIcon.preset,
                  iconObjectKey: preparedIcon.objectKey,
                }),
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            ...(input.instructions === undefined
              ? {}
              : { instructions: input.instructions }),
            model,
            reasoningEffort,
            ...(input.status === undefined ? {} : { status: input.status }),
            updatedAt: now,
          },
        });
        if (updated.count !== 1) throw new AppError("CONFLICT");
        if (input.capability_ids !== undefined) {
          await tx.applicationCapability.deleteMany({
            where: { applicationId },
          });
          if (dependencies.capabilities.length > 0) {
            await tx.applicationCapability.createMany({
              data: dependencies.capabilities.map((capability, index) => ({
                applicationId,
                capabilityId: capability.id,
                capabilityNameSnapshot: capability.name,
                capabilityTypeSnapshot: capability.type,
                selectionOrder: index,
              })),
            });
          }
        }
        if (input.knowledge_base_ids !== undefined) {
          await tx.applicationKnowledgeBase.deleteMany({
            where: { applicationId },
          });
          if (dependencies.knowledgeBases.length > 0) {
            await tx.applicationKnowledgeBase.createMany({
              data: dependencies.knowledgeBases.map((knowledgeBase, index) => ({
                applicationId,
                knowledgeBaseId: knowledgeBase.id,
                knowledgeBaseNameSnapshot: knowledgeBase.name,
                selectionOrder: index,
              })),
            });
          }
        }
        if (input.mcp_server_ids !== undefined) {
          await tx.applicationMcpServer.deleteMany({
            where: { applicationId },
          });
          if (dependencies.mcpServers.length > 0) {
            await tx.applicationMcpServer.createMany({
              data: dependencies.mcpServers.map((server, index) => ({
                applicationId,
                mcpServerId: server.id,
                mcpServerNameSnapshot: server.name,
                selectionOrder: index,
              })),
            });
          }
        }
        if (input.status === "disabled" && current.status !== "disabled") {
          const externalSessions =
            await tx.applicationExternalSession.findMany({
              where: { applicationId, status: "active" },
              select: { id: true, runtimePrincipalId: true },
            });
          const sessionIds = externalSessions.map((session) => session.id);
          await tx.applicationExternalAccess.updateMany({
            where: { applicationId, enabled: true },
            data: { enabled: false, updatedBy: actor.id, updatedAt: now },
          });
          await tx.applicationExternalSession.updateMany({
            where: { id: { in: sessionIds }, status: "active" },
            data: {
              status: "revoked",
              revokedAt: now,
              revokeReason: "application_disabled",
            },
          });
          await tx.applicationExternalRefreshToken.updateMany({
            where: { sessionId: { in: sessionIds }, revokedAt: null },
            data: { revokedAt: now, revokeReason: "application_disabled" },
          });
          await tx.user.updateMany({
            where: {
              id: {
                in: externalSessions.map(
                  (session) => session.runtimePrincipalId,
                ),
              },
              accountType: "application_external",
            },
            data: { status: "disabled", updatedAt: now },
          });
        }
      });
    } catch (error) {
      if (preparedIcon?.newObjectKey) {
        await this.#removeIconAfterFailure(preparedIcon.newObjectKey);
      }
      throw error;
    }
    if (
      preparedIcon !== null &&
      current.iconObjectKey !== null &&
      current.iconObjectKey !== preparedIcon.objectKey
    ) {
      await this.#enqueueIconRemoval(current.iconObjectKey);
    }
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "application_updated",
      targetType: "application",
      targetId: applicationId,
      result: "success",
      metadata: {
        capability_count: capabilityIds.length,
        knowledge_base_count: knowledgeBaseIds.length,
        mcp_server_count: mcpServerIds.length,
        model,
        status: input.status ?? current.status,
      },
    });
    return this.get(actor, applicationId);
  }

  async delete(
    actor: RequestActor,
    applicationId: string,
    context: AuditContext,
  ): Promise<void> {
    assertActiveActor(actor);
    const current = await this.#requireOwned(actor.id, applicationId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.updateMany({
        where: {
          id: applicationId,
          ownerId: actor.id,
          status: { in: ["active", "disabled"] },
        },
        data: {
          status: "deleted",
          deletedAt: now,
          deletedBy: actor.id,
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw new AppError("APPLICATION_NOT_FOUND");
      await tx.applicationGrant.updateMany({
        where: { applicationId, status: "active" },
        data: {
          status: "revoked",
          revokedBy: actor.id,
          revokedAt: now,
          revocationReason: "application_deleted",
        },
      });
      const externalSessions = await tx.applicationExternalSession.findMany({
        where: { applicationId, status: "active" },
        select: { id: true, runtimePrincipalId: true },
      });
      const sessionIds = externalSessions.map((session) => session.id);
      await tx.applicationExternalAccess.updateMany({
        where: { applicationId },
        data: { enabled: false, updatedBy: actor.id, updatedAt: now },
      });
      await tx.applicationExternalSession.updateMany({
        where: { id: { in: sessionIds }, status: "active" },
        data: {
          status: "revoked",
          revokedAt: now,
          revokeReason: "application_deleted",
        },
      });
      await tx.applicationExternalRefreshToken.updateMany({
        where: { sessionId: { in: sessionIds }, revokedAt: null },
        data: { revokedAt: now, revokeReason: "application_deleted" },
      });
      await tx.user.updateMany({
        where: {
          id: {
            in: externalSessions.map((session) => session.runtimePrincipalId),
          },
          accountType: "application_external",
        },
        data: { status: "disabled", updatedAt: now },
      });
    });
    if (current.iconObjectKey !== null) {
      await this.#enqueueIconRemoval(current.iconObjectKey);
    }
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "application_deleted",
      targetType: "application",
      targetId: applicationId,
      result: "success",
      metadata: {},
    });
  }

  async listGrants(actor: RequestActor, applicationId: string) {
    assertActiveActor(actor);
    assertOrganizationSharingAccess(actor);
    await this.#requireOwned(actor.id, applicationId);
    const grants = await this.prisma.applicationGrant.findMany({
      where: { applicationId, status: "active" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const userIds = grants.flatMap((grant) =>
      grant.userId === null ? [] : [grant.userId],
    );
    const groupIds = grants.flatMap((grant) =>
      grant.userGroupId === null ? [] : [grant.userGroupId],
    );
    const [users, groups] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      }),
      this.prisma.userGroup.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true },
      }),
    ]);
    const targets = new Map(
      [...users, ...groups].map((target) => [target.id, target.name]),
    );
    return grants.map((grant) => ({
      id: grant.id,
      application_id: grant.applicationId,
      grantee_type:
        grant.granteeType === "user"
          ? ("user" as const)
          : ("user_group" as const),
      target: {
        id: grant.userId ?? grant.userGroupId!,
        name: targets.get(grant.userId ?? grant.userGroupId!) ?? "-",
      },
      status: "active" as const,
      created_at: grant.createdAt.toISOString(),
      updated_at: grant.updatedAt.toISOString(),
    }));
  }

  async grant(
    actor: RequestActor,
    applicationId: string,
    target:
      | { granteeType: "user"; userId: string }
      | { granteeType: "user_group"; userGroupId: string },
    context: AuditContext,
  ) {
    assertActiveActor(actor);
    assertOrganizationSharingAccess(actor);
    await this.#requireOwned(actor.id, applicationId);
    if (target.granteeType === "user" && target.userId === actor.id) {
      throw new AppError("APPLICATION_GRANT_TARGET_INVALID");
    }
    const targetExists =
      target.granteeType === "user"
        ? await this.prisma.user.findFirst({
            where: {
              id: target.userId,
              status: "active",
              selfRegisteredAt: null,
            },
            select: { id: true },
          })
        : await this.prisma.userGroup.findUnique({
            where: { id: target.userGroupId },
            select: { id: true },
          });
    if (!targetExists) throw new AppError("APPLICATION_GRANT_TARGET_INVALID");
    const existing = await this.prisma.applicationGrant.findFirst({
      where: {
        applicationId,
        status: "active",
        ...(target.granteeType === "user"
          ? { granteeType: "user", userId: target.userId }
          : { granteeType: "user_group", userGroupId: target.userGroupId }),
      },
      select: { id: true },
    });
    if (existing) throw new AppError("APPLICATION_GRANT_CONFLICT");
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const grant = await tx.applicationGrant.create({
          data: {
            applicationId,
            granteeType: target.granteeType,
            ...(target.granteeType === "user"
              ? { userId: target.userId }
              : { userGroupId: target.userGroupId }),
            status: "active",
            grantedBy: actor.id,
          },
        });
        await tx.application.update({
          where: { id: applicationId },
          data: { updatedAt: new Date() },
        });
        return grant;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError("APPLICATION_GRANT_CONFLICT");
      }
      throw error;
    }
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "application_shared",
      targetType: "application_grant",
      targetId: created.id,
      result: "success",
      metadata: {
        application_id: applicationId,
        grantee_type: target.granteeType,
        target_id:
          target.granteeType === "user" ? target.userId : target.userGroupId,
      },
    });
    return (await this.listGrants(actor, applicationId)).find(
      (grant) => grant.id === created.id,
    )!;
  }

  async revokeGrant(
    actor: RequestActor,
    applicationId: string,
    grantId: string,
    context: AuditContext,
  ) {
    assertActiveActor(actor);
    assertOrganizationSharingAccess(actor);
    await this.#requireOwned(actor.id, applicationId);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.applicationGrant.updateMany({
        where: { id: grantId, applicationId, status: "active" },
        data: {
          status: "revoked",
          revokedBy: actor.id,
          revokedAt: now,
          revocationReason: "owner_revoked",
        },
      });
      if (result.count === 1) {
        await tx.application.update({
          where: { id: applicationId },
          data: { updatedAt: now },
        });
      }
      return result;
    });
    if (updated.count !== 1) throw new AppError("NOT_FOUND");
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "application_share_revoked",
      targetType: "application_grant",
      targetId: grantId,
      result: "success",
      metadata: { application_id: applicationId },
    });
    return { code: "APPLICATION_GRANT_REVOKED" as const };
  }

  async searchShareTargets(
    actor: RequestActor,
    input: {
      search?: string;
      limit: number;
      type?: ApplicationShareTargetType;
    },
  ) {
    assertActiveActor(actor);
    assertOrganizationSharingAccess(actor);
    const includeUsers = input.type !== "user_group";
    const includeGroups = input.type !== "user";
    const [users, groups] = await Promise.all([
      includeUsers
        ? this.prisma.user.findMany({
            where: {
              id: { not: actor.id },
              status: "active",
              accountType: "member",
              selfRegisteredAt: null,
              ...(input.search
                ? {
                    OR: [
                      {
                        name: { contains: input.search, mode: "insensitive" },
                      },
                      {
                        email: { contains: input.search, mode: "insensitive" },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: input.limit,
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
      includeGroups
        ? this.prisma.userGroup.findMany({
            where: input.search
              ? {
                  OR: [
                    {
                      name: { contains: input.search, mode: "insensitive" },
                    },
                    {
                      description: {
                        contains: input.search,
                        mode: "insensitive",
                      },
                    },
                  ],
                }
              : {},
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: input.limit,
            select: { id: true, name: true, description: true },
          })
        : Promise.resolve([]),
    ]);
    return [
      ...users.map((user) => ({
        id: user.id,
        type: "user" as const,
        name: user.name,
        secondary_text: user.email,
      })),
      ...groups.map((group) => ({
        id: group.id,
        type: "user_group" as const,
        name: group.name,
        secondary_text: group.description,
      })),
    ].slice(0, input.limit);
  }

  async resolveRuntime(
    actorId: string,
    applicationId: string,
    interactivePackageId?: string | null,
  ): Promise<ApplicationRuntimeConfiguration> {
    const application = await this.#requireCurrentAccess(
      actorId,
      applicationId,
    );
    const [capabilityBindings, knowledgeBindings, mcpBindings, package_] =
      await Promise.all([
        this.prisma.applicationCapability.findMany({
          where: { applicationId },
          orderBy: { selectionOrder: "asc" },
        }),
        this.prisma.applicationKnowledgeBase.findMany({
          where: { applicationId },
          orderBy: { selectionOrder: "asc" },
        }),
        this.prisma.applicationMcpServer.findMany({
          where: { applicationId },
          orderBy: { selectionOrder: "asc" },
        }),
        (interactivePackageId ?? application.interactivePackageId)
          ? this.prisma.interactiveApplicationPackage.findUnique({
              where: {
                id: (interactivePackageId ?? application.interactivePackageId)!,
              },
            })
          : Promise.resolve(null),
      ]);
    if (application.kind !== "interactive") {
      await this.#validateDependencies(application.ownerId, {
        capabilityIds: capabilityBindings.map(
          (binding) => binding.capabilityId,
        ),
        knowledgeBaseIds: knowledgeBindings.map(
          (binding) => binding.knowledgeBaseId,
        ),
        mcpServerIds: mcpBindings.map((binding) => binding.mcpServerId),
      });
    } else if (!package_ || package_.applicationId !== application.id) {
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    }
    const reasoningEffort =
      application.reasoningEffort as ApplicationRuntimeConfiguration["reasoningEffort"];
    if (application.model !== null && reasoningEffort !== null) {
      await this.models.resolveRuntimeForSelection(
        application.model,
        reasoningEffort,
      );
    }
    return {
      kind:
        application.kind === "interactive" ? "interactive" : "standard",
      applicationId: application.id,
      applicationOwnerId: application.ownerId,
      applicationName: application.name,
      applicationUpdatedAt: application.updatedAt,
      instructions:
        application.kind === "interactive" && package_
          ? (() => {
              const manifest = interactiveApplicationManifestSchema.parse(
                package_.manifestJson,
              );
              return interactiveApplicationRuntimeInstructions(
                manifest.instructions ??
                  interactiveApplicationBaseInstructions(manifest.name),
                manifest,
              );
            })()
          : application.instructions,
      model: application.model,
      reasoningEffort,
      capabilityIds:
        application.kind !== "interactive"
          ? capabilityBindings.map((binding) => binding.capabilityId)
          : [],
      knowledgeBaseIds:
        application.kind !== "interactive"
          ? knowledgeBindings.map((binding) => binding.knowledgeBaseId)
          : [],
      mcpServerIds:
        application.kind !== "interactive"
          ? mcpBindings.map((binding) => binding.mcpServerId)
          : [],
    };
  }

  async assertCurrentAccess(
    actorId: string,
    applicationId: string,
  ): Promise<void> {
    await this.#requireCurrentAccess(actorId, applicationId);
  }

  async allowsUserModelSelection(
    actorId: string,
    applicationId: string,
  ): Promise<boolean> {
    const application = await this.#requireCurrentAccess(
      actorId,
      applicationId,
    );
    return application.model === null;
  }

  async #requireCurrentAccess(actorId: string, applicationId: string) {
    const actor = await this.prisma.user.findFirst({
      where: { id: actorId, status: "active" },
      select: { id: true, accountType: true, selfRegisteredAt: true },
    });
    if (!actor) throw new AppError("USER_DISABLED");
    if (actor.accountType === "application_external") {
      const externalSession =
        await this.prisma.applicationExternalSession.findFirst({
          where: {
            applicationId,
            runtimePrincipalId: actorId,
            status: "active",
            absoluteExpiresAt: { gt: new Date() },
          },
          select: { externalAccessId: true },
        });
      const external = await this.prisma.applicationExternalAccess.findFirst({
        where: {
          id: externalSession?.externalAccessId ?? randomUUID(),
          applicationId,
          enabled: true,
        },
        select: { id: true },
      });
      if (!external) throw new AppError("APPLICATION_NOT_FOUND");
    } else {
      const access = await this.#resolveAccessibleApplicationIds(
        actorId,
        actor.selfRegisteredAt
          ? "self_registration"
          : "organization_invitation",
      );
      if (!access.owned.has(applicationId) && !access.shared.has(applicationId)) {
        throw new AppError("APPLICATION_NOT_FOUND");
      }
    }
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, status: { in: ["active", "disabled"] } },
    });
    if (!application) throw new AppError("APPLICATION_NOT_FOUND");
    if (application.status !== "active") {
      throw new AppError("APPLICATION_DISABLED");
    }
    return application;
  }

  async resolveUsableKnowledgeBaseIdsForTurn(
    actorId: string,
    locator: { turnId?: string; codexTurnId?: string },
    requestedIds: string[],
  ): Promise<string[]> {
    if (requestedIds.length === 0) return [];
    const [turn, intent] = await Promise.all([
      locator.turnId
        ? this.prisma.conversationTurn.findUnique({
            where: { id: locator.turnId },
            select: { conversationId: true, knowledgeBaseIdsJson: true },
          })
        : locator.codexTurnId
          ? this.prisma.conversationTurn.findFirst({
              where: { codexTurnId: locator.codexTurnId },
              orderBy: { createdAt: "desc" },
              select: { conversationId: true, knowledgeBaseIdsJson: true },
            })
          : Promise.resolve(null),
      locator.turnId
        ? this.prisma.conversationTurnStartIntent.findUnique({
            where: { projectionTurnId: locator.turnId },
            select: {
              conversationId: true,
              applicationId: true,
              knowledgeBaseIdsJson: true,
            },
          })
        : Promise.resolve(null),
    ]);
    const conversationId = turn?.conversationId ?? intent?.conversationId;
    if (!conversationId) return [];
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ownerId: actorId },
      select: { applicationId: true },
    });
    if (!conversation?.applicationId) return [];
    if (
      intent?.applicationId &&
      intent.applicationId !== conversation.applicationId
    ) {
      return [];
    }
    const [actor, application] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: actorId, status: "active" },
        select: { id: true, accountType: true, selfRegisteredAt: true },
      }),
      this.prisma.application.findFirst({
        where: {
          id: conversation.applicationId,
          status: "active",
        },
        select: { id: true },
      }),
    ]);
    if (!actor || !application) return [];
    if (actor.accountType === "application_external") {
      const externalSession =
        await this.prisma.applicationExternalSession.findFirst({
          where: {
            applicationId: conversation.applicationId,
            runtimePrincipalId: actorId,
            status: "active",
            absoluteExpiresAt: { gt: new Date() },
          },
          select: { externalAccessId: true },
        });
      const externalAccess = externalSession
        ? await this.prisma.applicationExternalAccess.findFirst({
            where: {
              id: externalSession.externalAccessId,
              applicationId: conversation.applicationId,
              enabled: true,
            },
            select: { id: true },
          })
        : null;
      if (!externalAccess) return [];
    } else {
      const access = await this.#resolveAccessibleApplicationIds(
        actorId,
        actor.selfRegisteredAt
          ? "self_registration"
          : "organization_invitation",
      );
      if (
        !access.owned.has(conversation.applicationId) &&
        !access.shared.has(conversation.applicationId)
      ) {
        return [];
      }
    }
    // Runtime resources are snapshotted at turn start. Configuration edits
    // affect the next turn only, while grant revocation or disabling the
    // application itself still closes scoped knowledge access immediately.
    const allowed = new Set(
      jsonStringIds(intent?.knowledgeBaseIdsJson ?? turn?.knowledgeBaseIdsJson),
    );
    return requestedIds.filter((id) => allowed.has(id));
  }

  async #validateDependencies(
    ownerId: string,
    input: {
      capabilityIds: string[];
      knowledgeBaseIds: string[];
      mcpServerIds: string[];
    },
  ) {
    const [capabilities, knowledgeBases, mcpServers] = await Promise.all([
      this.prisma.capability.findMany({
        where: {
          id: { in: input.capabilityIds },
          ownerId,
          status: "active",
        },
      }),
      this.prisma.knowledgeBase.findMany({
        where: {
          id: { in: input.knowledgeBaseIds },
          ownerId,
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        },
      }),
      this.prisma.mcpServer.findMany({
        where: {
          id: { in: input.mcpServerIds },
          ownerId,
          status: "active",
        },
      }),
    ]);
    const capabilitiesById = new Map(
      capabilities.map((capability) => [capability.id, capability]),
    );
    const knowledgeBasesById = new Map(
      knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]),
    );
    const mcpServersById = new Map(
      mcpServers.map((server) => [server.id, server]),
    );
    if (
      input.capabilityIds.some((id) => !capabilitiesById.has(id)) ||
      input.knowledgeBaseIds.some((id) => !knowledgeBasesById.has(id)) ||
      input.mcpServerIds.some((id) => !mcpServersById.has(id))
    ) {
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    }
    const orderedCapabilities = input.capabilityIds.map((id) =>
      capabilitiesById.get(id)!,
    );
    return {
      capabilities: orderedCapabilities,
      knowledgeBases: input.knowledgeBaseIds.map((id) =>
        knowledgeBasesById.get(id)!,
      ),
      mcpServers: input.mcpServerIds.map((id) => mcpServersById.get(id)!),
    };
  }

  async #requireOwned(ownerId: string, applicationId: string) {
    const row = await this.prisma.application.findFirst({
      where: {
        id: applicationId,
        ownerId,
        status: { in: ["active", "disabled"] },
      },
    });
    if (!row) throw new AppError("APPLICATION_NOT_FOUND");
    return row;
  }

  async #resolveAccessibleApplicationIds(
    actorId: string,
    registrationSource?: RequestActor["registrationSource"],
  ) {
    const [owned, memberships] = await Promise.all([
      this.prisma.application.findMany({
        where: {
          ownerId: actorId,
          status: { in: ["active", "disabled"] },
        },
        select: { id: true },
      }),
      registrationSource === "self_registration"
        ? Promise.resolve([])
        : this.prisma.userGroupMember.findMany({
            where: { userId: actorId, status: "active" },
            select: { userGroupId: true },
          }),
    ]);
    const ownedIds = new Set(owned.map((application) => application.id));
    if (registrationSource === "self_registration") {
      return {
        owned: ownedIds,
        shared: new Set<string>(),
        accessSource: new Map<string, "direct" | "user_group">(),
      };
    }
    const groupIds = memberships.map((membership) => membership.userGroupId);
    const grants = await this.prisma.applicationGrant.findMany({
      where: {
        status: "active",
        OR: [
          { granteeType: "user", userId: actorId },
          ...(groupIds.length > 0
            ? [
                {
                  granteeType: "user_group",
                  userGroupId: { in: groupIds },
                },
              ]
            : []),
        ],
      },
      select: {
        applicationId: true,
        granteeType: true,
      },
    });
    const sharedIds = new Set(
      grants
        .map((grant) => grant.applicationId)
        .filter((id) => !ownedIds.has(id)),
    );
    const accessSource = new Map<string, "direct" | "user_group">();
    for (const grant of grants) {
      if (ownedIds.has(grant.applicationId)) continue;
      const next = grant.granteeType === "user" ? "direct" : "user_group";
      if (next === "direct" || !accessSource.has(grant.applicationId)) {
        accessSource.set(grant.applicationId, next);
      }
    }
    return { owned: ownedIds, shared: sharedIds, accessSource };
  }

  async #projectApplications(
    actorId: string,
    rows: Array<{
      id: string;
      ownerId: string;
      name: string;
      kind: string;
      description: string | null;
      iconPreset: string;
      iconObjectKey: string | null;
      instructions: string;
      model: string | null;
      reasoningEffort: string | null;
      interactivePackageId: string | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
    access: AccessibleApplications,
    includeOrganizationSharing: boolean,
  ): Promise<Application[]> {
    const applicationIds = rows.map((row) => row.id);
    const ownedApplicationIds = includeOrganizationSharing
      ? rows.filter((row) => row.ownerId === actorId).map((row) => row.id)
      : [];
    const ownerIds = [...new Set(rows.map((row) => row.ownerId))];
    const [
      owners,
      capabilityBindings,
      knowledgeBindings,
      mcpBindings,
      grants,
      interactivePackages,
    ] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        }),
        this.prisma.applicationCapability.findMany({
          where: { applicationId: { in: applicationIds } },
          orderBy: [{ applicationId: "asc" }, { selectionOrder: "asc" }],
        }),
        this.prisma.applicationKnowledgeBase.findMany({
          where: { applicationId: { in: applicationIds } },
          orderBy: [{ applicationId: "asc" }, { selectionOrder: "asc" }],
        }),
        this.prisma.applicationMcpServer.findMany({
          where: { applicationId: { in: applicationIds } },
          orderBy: [{ applicationId: "asc" }, { selectionOrder: "asc" }],
        }),
        ownedApplicationIds.length > 0
          ? this.prisma.applicationGrant.findMany({
              where: {
                applicationId: { in: ownedApplicationIds },
                status: "active",
              },
              orderBy: [
                { applicationId: "asc" },
                { createdAt: "asc" },
                { id: "asc" },
              ],
            })
          : Promise.resolve([]),
        rows.some((row) => row.interactivePackageId)
          ? this.prisma.interactiveApplicationPackage.findMany({
              where: {
                id: {
                  in: rows.flatMap((row) =>
                    row.interactivePackageId ? [row.interactivePackageId] : [],
                  ),
                },
              },
            })
          : Promise.resolve([]),
      ]);
    const capabilityIds = capabilityBindings.map(
      (binding) => binding.capabilityId,
    );
    const knowledgeBaseIds = knowledgeBindings.map(
      (binding) => binding.knowledgeBaseId,
    );
    const mcpServerIds = mcpBindings.map((binding) => binding.mcpServerId);
    const userShareTargetIds = grants.flatMap((grant) =>
      grant.userId === null ? [] : [grant.userId],
    );
    const groupShareTargetIds = grants.flatMap((grant) =>
      grant.userGroupId === null ? [] : [grant.userGroupId],
    );
    const [
      capabilities,
      knowledgeBases,
      mcpServers,
      shareTargetUsers,
      shareTargetGroups,
    ] =
      await Promise.all([
        this.prisma.capability.findMany({
          where: { id: { in: capabilityIds } },
        }),
        this.prisma.knowledgeBase.findMany({
          where: { id: { in: knowledgeBaseIds } },
        }),
        this.prisma.mcpServer.findMany({
          where: { id: { in: mcpServerIds } },
        }),
        userShareTargetIds.length > 0
          ? this.prisma.user.findMany({
              where: { id: { in: userShareTargetIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        groupShareTargetIds.length > 0
          ? this.prisma.userGroup.findMany({
              where: { id: { in: groupShareTargetIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    const capabilityById = new Map(
      capabilities.map((capability) => [capability.id, capability]),
    );
    const knowledgeBaseById = new Map(
      knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]),
    );
    const mcpServerById = new Map(
      mcpServers.map((server) => [server.id, server]),
    );
    const capabilityBindingsByApplication = groupBy(
      capabilityBindings,
      (binding) => binding.applicationId,
    );
    const knowledgeBindingsByApplication = groupBy(
      knowledgeBindings,
      (binding) => binding.applicationId,
    );
    const mcpBindingsByApplication = groupBy(
      mcpBindings,
      (binding) => binding.applicationId,
    );
    const grantsByApplication = groupBy(grants, (grant) => grant.applicationId);
    const interactivePackageById = new Map(
      interactivePackages.map((package_) => [package_.id, package_]),
    );
    const shareTargetNameById = new Map(
      [...shareTargetUsers, ...shareTargetGroups].map((target) => [
        target.id,
        target.name,
      ]),
    );
    const credentialAvailability = new Map<string, Promise<boolean>>();
    const hasAvailablePluginCredentials = (
      ownerId: string,
      capabilityId: string,
      requiredKeys: string[],
    ) => {
      const key = `${ownerId}:${capabilityId}:${requiredKeys.join("\0")}`;
      const current = credentialAvailability.get(key);
      if (current) return current;
      const pending = this.credentials
        .resolveForCapability(ownerId, capabilityId, requiredKeys)
        .then((resolution) => resolution.ok);
      credentialAvailability.set(key, pending);
      return pending;
    };
    return Promise.all(
      rows.map(async (row) => {
        const isOwner = row.ownerId === actorId;
        const projectedCapabilities = await Promise.all(
          (capabilityBindingsByApplication.get(row.id) ?? []).map(
            async (binding) => {
              const capability = capabilityById.get(binding.capabilityId);
              const dependencyAvailable =
                capability?.ownerId === row.ownerId &&
                capability.status === "active";
              const requiredCredentialKeys =
                capability?.type === "plugin"
                  ? declaredApplicationCredentialKeys(
                      capability.riskSummaryJson,
                    )
                  : [];
              const credentialsAvailable =
                dependencyAvailable && requiredCredentialKeys.length > 0
                  ? await hasAvailablePluginCredentials(
                      row.ownerId,
                      binding.capabilityId,
                      requiredCredentialKeys,
                    )
                  : true;
              return {
                id: binding.capabilityId,
                name: capability?.name ?? binding.capabilityNameSnapshot,
                type: capability?.type ?? binding.capabilityTypeSnapshot,
                description: capability?.description ?? null,
                status: capability?.status ?? "failed",
                available: dependencyAvailable && credentialsAvailable,
                updated_at: (
                  capability?.updatedAt ?? binding.createdAt
                ).toISOString(),
              };
            },
          ),
        );
        const projectedKnowledgeBases = (
          knowledgeBindingsByApplication.get(row.id) ?? []
        ).map((binding) => {
          const knowledgeBase = knowledgeBaseById.get(binding.knowledgeBaseId);
          return {
            id: binding.knowledgeBaseId,
            name: knowledgeBase?.name ?? binding.knowledgeBaseNameSnapshot,
            lifecycle_status: knowledgeBase?.lifecycleStatus ?? "deleted",
            availability_status:
              knowledgeBase?.availabilityStatus ?? "disabled",
            available:
              knowledgeBase?.ownerId === row.ownerId &&
              knowledgeBase.lifecycleStatus === "active" &&
              knowledgeBase.availabilityStatus === "enabled",
            updated_at: (
              knowledgeBase?.updatedAt ?? binding.createdAt
            ).toISOString(),
          };
        });
        const projectedMcpServers = (
          mcpBindingsByApplication.get(row.id) ?? []
        ).map((binding) => {
          const server = mcpServerById.get(binding.mcpServerId);
          return {
            id: binding.mcpServerId,
            name: server?.name ?? binding.mcpServerNameSnapshot,
            status:
              server?.status === "disabled"
                ? ("disabled" as const)
                : ("active" as const),
            available:
              server?.ownerId === row.ownerId && server.status === "active",
            updated_at: (server?.updatedAt ?? binding.updatedAt).toISOString(),
          };
        });
        const shareTargets = isOwner
          ? (grantsByApplication.get(row.id) ?? []).map((grant) => {
              const targetId = grant.userId ?? grant.userGroupId!;
              return {
                id: targetId,
                type:
                  grant.granteeType === "user"
                    ? ("user" as const)
                    : ("user_group" as const),
                name: shareTargetNameById.get(targetId) ?? "-",
              };
            })
          : [];
        const icon = await this.#projectIcon(row);
        return applicationSchema.parse({
          id: row.id,
          owner: {
            id: row.ownerId,
            name: ownerById.get(row.ownerId)?.name ?? "-",
          },
          name: row.name,
          icon,
          description: row.description,
          kind: row.kind === "interactive" ? "interactive" : "standard",
          instructions: isOwner ? row.instructions : null,
          model: row.model,
          reasoning_effort: row.reasoningEffort,
          status: row.status,
          is_owner: isOwner,
          can_manage: isOwner,
          access_source: isOwner
            ? "owner"
            : (access.accessSource.get(row.id) ?? "user_group"),
          capability_count: projectedCapabilities.length,
          knowledge_base_count: projectedKnowledgeBases.length,
          mcp_server_count: projectedMcpServers.length,
          share_targets: shareTargets,
          dependencies_available:
            projectedCapabilities.every((item) => item.available) &&
            projectedKnowledgeBases.every((item) => item.available) &&
            projectedMcpServers.every((item) => item.available),
          capabilities: isOwner ? projectedCapabilities : [],
          knowledge_bases: isOwner ? projectedKnowledgeBases : [],
          mcp_servers: isOwner ? projectedMcpServers : [],
          interactive_package:
            row.kind === "interactive" && row.interactivePackageId
              ? projectInteractivePackage(
                  interactivePackageById.get(row.interactivePackageId),
                )
              : null,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        });
      }),
    );
  }

  async #projectIcon(row: {
    iconPreset: string;
    iconObjectKey: string | null;
  }): Promise<Application["icon"]> {
    const parsedPreset = applicationIconPresetSchema.safeParse(row.iconPreset);
    const fallbackPreset = parsedPreset.success ? parsedPreset.data : "bot";
    if (row.iconObjectKey === null || this.iconStore === undefined) {
      return { type: "preset", preset: fallbackPreset };
    }
    try {
      return {
        type: "custom",
        url: await this.iconStore.presignGet(row.iconObjectKey, 5 * 60),
        fallback_preset: fallbackPreset,
      };
    } catch {
      return { type: "preset", preset: fallbackPreset };
    }
  }

  async #prepareIcon(
    ownerId: string,
    input?: ApplicationIconInput,
  ): Promise<PreparedApplicationIcon> {
    if (input === undefined) {
      return { preset: "bot", objectKey: null, newObjectKey: null };
    }
    const parsed = applicationIconInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    if (parsed.data.type === "preset") {
      return {
        preset: parsed.data.preset,
        objectKey: null,
        newObjectKey: null,
      };
    }
    if (this.iconStore === undefined) {
      throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    }
    const bytes = Buffer.from(parsed.data.data_base64, "base64");
    const detectedType = detectSafeRasterImage(
      bytes,
      APPLICATION_ICON_MAX_DIMENSION,
    );
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > APPLICATION_ICON_MAX_BYTES ||
      detectedType === null ||
      detectedType === "image/gif" ||
      detectedType !== parsed.data.mime_type
    ) {
      throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    }
    const extension =
      detectedType === "image/png"
        ? "png"
        : detectedType === "image/jpeg"
          ? "jpg"
          : "webp";
    const objectKey = `applications/${ownerId}/icons/${randomUUID()}.${extension}`;
    try {
      await this.iconStore.put(objectKey, bytes, detectedType);
    } catch {
      await this.#removeIconAfterFailure(objectKey);
      throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    }
    return {
      preset: "bot",
      objectKey,
      newObjectKey: objectKey,
    };
  }

  async #removeIconAfterFailure(objectKey: string): Promise<void> {
    if (this.iconStore === undefined) return;
    try {
      await this.iconStore.remove(objectKey);
    } catch {
      try {
        await this.iconStore.enqueueRemoval?.(objectKey);
      } catch {
        // Durable cleanup retries are best-effort after a failed mutation.
      }
    }
  }

  async #enqueueIconRemoval(objectKey: string): Promise<void> {
    if (this.iconStore === undefined) return;
    try {
      if (this.iconStore.enqueueRemoval !== undefined) {
        await this.iconStore.enqueueRemoval(objectKey);
        return;
      }
      await this.iconStore.remove(objectKey);
    } catch {
      try {
        await this.iconStore.remove(objectKey);
      } catch {
        // A committed application update must not fail because cleanup failed.
      }
    }
  }
}

function assertActiveActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}

function assertOrganizationSharingAccess(actor: RequestActor): void {
  if (actor.registrationSource === "self_registration") {
    throw new AppError("FORBIDDEN");
  }
}

function declaredApplicationCredentialKeys(value: unknown): string[] {
  const risk = asObject(value);
  return Array.isArray(risk.declared_environment_keys)
    ? risk.declared_environment_keys.filter(
        (key): key is string =>
          typeof key === "string" &&
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key),
      )
    : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonStringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function groupBy<T, K>(values: T[], keyFor: (value: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const current = grouped.get(key) ?? [];
    current.push(value);
    grouped.set(key, current);
  }
  return grouped;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isPackageVersionConflict(error: unknown): boolean {
  return isUniqueConstraintError(error);
}

function interactiveAssetObjectKey(
  ownerId: string,
  applicationId: string,
  packageId: string,
  path: string,
) {
  return `applications/${ownerId}/${applicationId}/packages/${packageId}/${path}`;
}

function interactiveApplicationBaseInstructions(name: string) {
  return `This task is presented through the LinkSense interactive application ${JSON.stringify(name)}. Follow the user's submitted prompt and use only resources authorized for the current LinkSense user.`;
}

function interactiveApplicationRuntimeInstructions(
  instructions: string,
  manifest: import("@linksense/shared").InteractiveApplicationManifest,
) {
  if (manifest.custom_events.length === 0) return instructions;
  const contracts = manifest.custom_events
    .map(
      (event) =>
        `- ${event.name}: ${event.description}\n  payload_schema=${JSON.stringify(event.payload_schema)}`,
    )
    .join("\n");
  return [
    instructions,
    "",
    "The current interactive application declares these LinkSense custom business events:",
    contracts,
    "When the described process data becomes available, call the LinkSense Core MCP tool emit_application_event with the exact event name and a payload matching its schema. Do not use custom events for chat message deltas, reasoning, or tool progress because the trusted LinkSense chat panel already renders those native events.",
  ].join("\n");
}

function projectInteractivePackage(
  package_:
    | {
        id: string;
        version: string;
        manifestJson: unknown;
        createdAt: Date;
      }
    | undefined,
) {
  if (!package_) return null;
  const manifest = interactiveApplicationManifestSchema.safeParse(
    package_.manifestJson,
  );
  if (!manifest.success) return null;
  return {
    id: package_.id,
    version: package_.version,
    manifest: manifest.data,
    created_at: package_.createdAt.toISOString(),
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
