import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import {
  builtInCapabilityDefinitions,
  builtInCapabilityId,
  capabilitySupplyChainReviewSchema,
} from "@linksense/shared";
import { lock } from "proper-lockfile";

import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory } from "../../lib/package-directory-integrity.js";
import {
  CapabilityPackageImporter,
  capabilityDirectory,
  detectSafeRasterImage,
  extensionMatchesImageType,
  slugifyCapabilityName,
  stageAtomicDirectoryReplacement,
  validateRequestedType,
} from "./importer.js";
import {
  CapabilityPreviewRepository,
  stripSkillFrontmatter,
  type CapabilityImportPreview,
  type ClawHubPreviewSource,
} from "./preview.js";
import {
  assertCapabilitySupplyChainApproval,
  scanCapabilitySupplyChain,
} from "./supply-chain-scanner.js";
import {
  type MaterializeUserHomes,
  type UserHomeCapabilityTargets,
} from "./user-home-reconciler.js";
import type {
  CapabilityImportSource,
  ClawHubCapabilityOrigin,
  CapabilityLogoStore,
  CapabilityPackageCleanup,
  CapabilityRecord,
  CapabilityRiskSummary,
  CapabilityStatus,
  CapabilityStore,
  CapabilityType,
  PreparedCapabilityPackage,
  PreparedLogo,
  RemoteCapabilityFile,
  RequestActor,
} from "./types.js";

export interface CapabilityServiceOptions {
  store: CapabilityStore;
  importer: CapabilityPackageImporter;
  capabilityRoot: string;
  logoStore?: CapabilityLogoStore;
  packageCleanup?: CapabilityPackageCleanup;
  materializeUserHomes?: MaterializeUserHomes;
  validateClawHubInstall?: ValidateClawHubInstall;
  now?: () => Date;
}

export type ValidateClawHubInstall = (
  actor: RequestActor,
  origin: ClawHubCapabilityOrigin,
) => Promise<void>;

export interface CapabilityView {
  id: string;
  type: CapabilityType;
  name: string;
  slug: string;
  description: string | null;
  source_type: CapabilityRecord["sourceType"] | "builtin";
  builtin_key: string | null;
  is_builtin: boolean;
  marketplace_listing_id: string | null;
  marketplace_release_id: string | null;
  status: CapabilityStatus;
  has_logo: boolean;
  logo_url: string | null;
  manifest: Record<string, unknown> | null;
  risk_summary: Record<string, unknown> | null;
  preference_status: "enabled" | "disabled";
  can_manage: boolean;
  can_govern: boolean;
  can_select: boolean;
  can_delete: boolean;
  is_owner: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ImportCapabilityInput {
  source: CapabilityImportSource;
  requestedType?: CapabilityType;
}

export interface MarketplaceReleaseInstallInput {
  listingId: string;
  releaseId: string;
  packageRoot: string;
  type: CapabilityType;
  name: string;
  description: string | null;
  manifest: Record<string, unknown>;
  riskSummary: CapabilityRiskSummary;
  logo: PreparedLogo | null;
}

export interface ClawHubInstallPreviewInput extends ClawHubCapabilityOrigin {
  files: readonly RemoteCapabilityFile[];
}

interface ClawHubInstallOrigin extends ClawHubCapabilityOrigin {
  contentSha256: string;
}

export interface PatchCapabilityInput {
  name?: string;
  description?: string | null;
  status?: CapabilityStatus;
}

export interface CapabilitySkillContent {
  content: string;
}

const MAX_EDITABLE_SKILL_CONTENT_LENGTH = 1_000_000;

export class CapabilityService {
  readonly #store: CapabilityStore;
  readonly #importer: CapabilityPackageImporter;
  readonly #capabilityRoot: string;
  readonly #logoStore: CapabilityLogoStore | undefined;
  readonly #packageCleanup: CapabilityPackageCleanup | undefined;
  readonly #materializeUserHomes: MaterializeUserHomes | undefined;
  readonly #validateClawHubInstall: ValidateClawHubInstall | undefined;
  readonly #now: () => Date;
  readonly #previews: CapabilityPreviewRepository;

  constructor(options: CapabilityServiceOptions) {
    this.#store = options.store;
    this.#importer = options.importer;
    this.#capabilityRoot = options.capabilityRoot;
    this.#logoStore = options.logoStore;
    this.#packageCleanup = options.packageCleanup;
    this.#materializeUserHomes = options.materializeUserHomes;
    this.#validateClawHubInstall = options.validateClawHubInstall;
    this.#now = options.now ?? (() => new Date());
    this.#previews = new CapabilityPreviewRepository(
      this.#capabilityRoot,
      this.#now,
    );
  }

  async listAvailable(actor: RequestActor): Promise<CapabilityView[]> {
    assertActiveActor(actor);
    const capabilities = await this.#store.listCapabilities();
    const preferences = await this.#store.listPreferences(actor.id);
    const preferenceByCapability = new Map(
      preferences.map((preference) => [
        preference.capabilityId,
        preference.status,
      ]),
    );

    const personal = await Promise.all(
      capabilities
        .filter(
          (capability) =>
            capability.ownerId === actor.id &&
            capability.status === "active" &&
            preferenceByCapability.get(capability.id) !== "disabled",
        )
        .map((capability) =>
          this.#capabilityView(
            capability,
            preferenceByCapability.get(capability.id) ?? "enabled",
            actor,
          ),
        ),
    );
    return [...builtInCapabilityViews(), ...personal];
  }

  async listManaged(actor: RequestActor): Promise<CapabilityView[]> {
    assertActiveActor(actor);
    const capabilities = await this.#store.listCapabilities();
    const preferences = await this.#store.listPreferences(actor.id);
    const preferenceByCapability = new Map(
      preferences.map((preference) => [
        preference.capabilityId,
        preference.status,
      ]),
    );
    const personal = await Promise.all(
      capabilities
        .filter((capability) => canFullyManage(actor, capability))
        .map((capability) =>
          this.#capabilityView(
            capability,
            preferenceByCapability.get(capability.id) ?? "enabled",
            actor,
          ),
        ),
    );
    return [...builtInCapabilityViews(), ...personal];
  }

  async get(
    actor: RequestActor,
    capabilityId: string,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    const capability = await this.requireCapability(capabilityId);
    const preferences = await this.#store.listPreferences(actor.id);
    const preference =
      preferences.find((item) => item.capabilityId === capabilityId)?.status ??
      "enabled";
    if (!canFullyManage(actor, capability)) {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    return this.#capabilityView(capability, preference, actor);
  }

  async getSkillContent(
    actor: RequestActor,
    capabilityId: string,
  ): Promise<CapabilitySkillContent> {
    assertActiveActor(actor);
    const capability = await this.requireCapability(capabilityId);
    assertCanFullyManage(actor, capability);
    if (capability.type !== "skill") throw new AppError("CAPABILITY_NOT_FOUND");

    try {
      const markdown = await readFile(
        join(
          capabilityDirectory(this.#capabilityRoot, capability.id),
          "current",
          "SKILL.md",
        ),
        "utf8",
      );
      const content = stripSkillFrontmatter(markdown);
      if (content.length > MAX_EDITABLE_SKILL_CONTENT_LENGTH) {
        throw new AppError("INVALID_PACKAGE");
      }
      return { content };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
  }

  async previewImportCapability(
    actor: RequestActor,
    input: ImportCapabilityInput,
  ): Promise<CapabilityImportPreview> {
    assertActiveActor(actor);
    let prepared: Awaited<
      ReturnType<CapabilityPackageImporter["prepare"]>
    > | null = null;
    try {
      prepared = await this.#importer.prepare(input.source);
      validateRequestedType(prepared.type, input.requestedType);
      await assertCapabilityNameAvailable(this.#store, {
        type: prepared.type,
        ownerId: actor.id,
        name: prepared.name,
      });
      return await this.#previews.stage({
        actorId: actor.id,
        operation: "install",
        capabilityId: null,
        ...(input.requestedType === undefined
          ? {}
          : { requestedType: input.requestedType }),
        source: input.source,
        prepared,
      });
    } catch (error) {
      if (prepared !== null) await this.#cleanupPreparedPackage(prepared);
      await this.#writeImportFailureAudit(
        actor,
        "install",
        null,
        "local",
        error,
      );
      throw error;
    }
  }

  async previewClawHubInstall(
    actor: RequestActor,
    input: ClawHubInstallPreviewInput,
  ): Promise<CapabilityImportPreview> {
    assertActiveActor(actor);
    if (
      input.securityStatus === "unverified" ||
      input.securityStatus === "malicious" ||
      input.ownerHandle.length === 0 ||
      input.slug.length === 0
    ) {
      throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
    }

    let prepared: PreparedCapabilityPackage | null = null;
    try {
      prepared = await this.#importer.prepareRemoteFiles(input.files);
      validateRequestedType(prepared.type, "skill");
      await assertCapabilityNameAvailable(this.#store, {
        type: "skill",
        ownerId: actor.id,
        name: prepared.name,
      });
      const source: ClawHubPreviewSource = {
        kind: "clawhub",
        skillId: input.skillId,
        ownerHandle: input.ownerHandle,
        slug: input.slug,
        version: input.version,
        securityStatus: input.securityStatus,
        securityHasWarnings: input.securityHasWarnings,
        canonicalUrl: input.canonicalUrl,
      };
      return await this.#previews.stage({
        actorId: actor.id,
        operation: "install",
        capabilityId: null,
        requestedType: "skill",
        source,
        prepared,
      });
    } catch (error) {
      if (prepared !== null) await this.#cleanupPreparedPackage(prepared);
      await this.#writeImportFailureAudit(
        actor,
        "install",
        null,
        "clawhub",
        error,
      );
      throw error;
    }
  }

  async previewUpdatePackage(
    actor: RequestActor,
    capabilityId: string,
    input: ImportCapabilityInput,
  ): Promise<CapabilityImportPreview> {
    assertActiveActor(actor);
    const existing = await this.requireCapability(capabilityId);
    assertCanFullyManage(actor, existing);
    if (
      existing.sourceType === "marketplace" ||
      existing.sourceType === "clawhub"
    ) {
      throw new AppError("CONFLICT");
    }
    let prepared: Awaited<
      ReturnType<CapabilityPackageImporter["prepare"]>
    > | null = null;
    try {
      prepared = await this.#importer.prepare(input.source);
      validateRequestedType(prepared.type, existing.type);
      validateRequestedType(prepared.type, input.requestedType);
      if (prepared.name !== existing.name) {
        throw new AppError("VALIDATION_ERROR");
      }
      await assertCapabilityNameAvailable(this.#store, {
        type: prepared.type,
        ownerId: existing.ownerId,
        name: prepared.name,
        excludeCapabilityId: existing.id,
      });
      return await this.#previews.stage({
        actorId: actor.id,
        operation: "update",
        capabilityId,
        requestedType: existing.type,
        source: input.source,
        prepared,
      });
    } catch (error) {
      if (prepared !== null) await this.#cleanupPreparedPackage(prepared);
      await this.#writeImportFailureAudit(
        actor,
        "update",
        capabilityId,
        "local",
        error,
      );
      throw error;
    }
  }

  async confirmCapabilityImport(
    actor: RequestActor,
    previewToken: string,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    const preview = await this.#previews.claim(previewToken, actor.id);
    const capabilityId =
      preview.operation === "install"
        ? randomUUID()
        : requirePreviewCapabilityId(preview.capabilityId);
    const capabilityPath = capabilityDirectory(
      this.#capabilityRoot,
      capabilityId,
    );
    let sourceAndDatabaseCommitted = false;
    try {
      assertCapabilitySupplyChainApproval(
        preview.prepared.riskSummary.supply_chain_review,
      );
      if (preview.clawHubOrigin !== null) {
        if (this.#validateClawHubInstall === undefined) {
          throw new AppError("CLAWHUB_SERVICE_UNAVAILABLE");
        }
        await this.#validateClawHubInstall(actor, preview.clawHubOrigin);
      }
      return await withCapabilityMutationLock(capabilityPath, async () => {
        const capability =
          preview.operation === "install"
            ? await this.#activateInstall(
                actor,
                capabilityId,
                preview.prepared,
                preview.sourceType,
                null,
                preview.clawHubOrigin === null
                  ? null
                  : {
                      ...preview.clawHubOrigin,
                      contentSha256: preview.packageSha256,
                    },
              )
            : await this.#activateUpdate(
                actor,
                capabilityId,
                preview.prepared,
                preview.sourceType,
                null,
                false,
              );
        sourceAndDatabaseCommitted = true;
        await preview.commit().catch(async () => {
          await this.#enqueueDirectoryRemoval(
            preview.prepared.stagingDirectory,
          );
        });

        try {
          await this.#materializeAffectedUserHomes({
            userIds: [capability.ownerId],
          });
        } catch {
          await this.#writeCommittedImportHomeSyncFailureAudit(
            actor,
            preview.operation,
            capability.id,
            preview.sourceType,
          );
          throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
        }

        return preview.operation === "install"
          ? this.#capabilityView(capability, "enabled", actor)
          : this.get(actor, capability.id);
      });
    } catch (error) {
      if (!sourceAndDatabaseCommitted) {
        await preview.rollback();
        await this.#writeImportFailureAudit(
          actor,
          preview.operation,
          preview.capabilityId,
          preview.sourceType,
          error,
        );
      }
      throw error;
    }
  }

  async installMarketplaceRelease(
    actor: RequestActor,
    input: MarketplaceReleaseInstallInput,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    const capabilityId = randomUUID();
    const capabilityPath = capabilityDirectory(
      this.#capabilityRoot,
      capabilityId,
    );
    const prepared = await marketplacePreparedPackage(input);
    return withCapabilityMutationLock(capabilityPath, async () => {
      const capability = await this.#activateInstall(
        actor,
        capabilityId,
        prepared,
        "marketplace",
        { listingId: input.listingId, releaseId: input.releaseId },
        null,
      );
      try {
        await this.#materializeAffectedUserHomes({
          userIds: [capability.ownerId],
        });
      } catch {
        await this.#writeCommittedImportHomeSyncFailureAudit(
          actor,
          "install",
          capability.id,
          "marketplace",
        );
        throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
      }
      return this.#capabilityView(capability, "enabled", actor);
    });
  }

  async updateMarketplaceRelease(
    actor: RequestActor,
    capabilityId: string,
    input: MarketplaceReleaseInstallInput,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    const capabilityPath = capabilityDirectory(
      this.#capabilityRoot,
      capabilityId,
    );
    const prepared = await marketplacePreparedPackage(input);
    return withCapabilityMutationLock(capabilityPath, async () => {
      const capability = await this.#activateUpdate(
        actor,
        capabilityId,
        prepared,
        "marketplace",
        { listingId: input.listingId, releaseId: input.releaseId },
        true,
      );
      try {
        await this.#materializeAffectedUserHomes({
          userIds: [capability.ownerId],
        });
      } catch {
        await this.#writeCommittedImportHomeSyncFailureAudit(
          actor,
          "update",
          capability.id,
          "marketplace",
        );
        throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
      }
      return this.get(actor, capability.id);
    });
  }

  async #activateInstall(
    actor: RequestActor,
    id: string,
    prepared: Awaited<ReturnType<CapabilityPackageImporter["prepare"]>>,
    sourceType: CapabilityRecord["sourceType"],
    marketplaceOrigin: {
      listingId: string;
      releaseId: string;
    } | null,
    clawHubOrigin: ClawHubInstallOrigin | null,
  ): Promise<CapabilityRecord> {
    const capabilityPath = capabilityDirectory(this.#capabilityRoot, id);
    let replacement:
      Awaited<ReturnType<typeof stageAtomicDirectoryReplacement>> | undefined;
    let logoObjectKey: string | null = null;
    let committed = false;
    try {
      const stagedReplacement = await stageAtomicDirectoryReplacement(
        prepared.packageRoot,
        capabilityPath,
      );
      replacement = stagedReplacement;
      assertCapabilitySupplyChainApproval(
        prepared.riskSummary.supply_chain_review,
        await hashPackageDirectory(stagedReplacement.currentDirectory),
      );
      if (prepared.logo !== null) {
        logoObjectKey = await this.#storeLogo(
          id,
          prepared.logo.bytes,
          prepared.logo.filename,
          prepared.logo.contentType,
        );
      }
      const capability = await this.#store.transaction(async (store) => {
        if (
          (sourceType === "marketplace") !== (marketplaceOrigin !== null) ||
          (sourceType === "clawhub") !== (clawHubOrigin !== null)
        ) {
          throw new AppError("INTERNAL_ERROR");
        }
        await store.lockSkillNameRegistry();
        await assertCapabilityNameAvailable(store, {
          type: prepared.type,
          ownerId: actor.id,
          name: prepared.name,
        });
        const created = await store.createCapability({
          id,
          type: prepared.type,
          ownerId: actor.id,
          name: prepared.name,
          slug: slugifyCapabilityName(prepared.name),
          description: prepared.description,
          sourceType,
          marketplaceListingId: marketplaceOrigin?.listingId ?? null,
          marketplaceReleaseId: marketplaceOrigin?.releaseId ?? null,
          logoObjectKey,
          storagePath: stagedReplacement.currentDirectory,
          manifestJson: prepared.manifest,
          riskSummaryJson: prepared.riskSummary,
          status: "active",
          installedBy: actor.id,
        });
        if (marketplaceOrigin !== null) {
          await store.recordMarketplaceInstall(marketplaceOrigin.listingId);
        }
        if (clawHubOrigin !== null) {
          await store.createClawHubInstallation({
            userId: actor.id,
            clawHubSkillId: clawHubOrigin.skillId,
            capabilityId: id,
            installedVersion: clawHubOrigin.version,
            sourceSecurityStatus: clawHubOrigin.securityStatus,
            sourceSecurityHasWarnings: clawHubOrigin.securityHasWarnings,
            contentSha256: clawHubOrigin.contentSha256,
          });
        }
        await store.writeAudit(
          audit(actor, "capability_installed", id, {
            capability_type: prepared.type,
            source_type: sourceType,
            contains_scripts: prepared.riskSummary.contains_scripts,
            contains_mcp_server: prepared.riskSummary.contains_mcp_server,
            ...supplyChainAuditMetadata(prepared.riskSummary),
          }),
        );
        return created;
      });
      await stagedReplacement.commit();
      committed = true;
      if (stagedReplacement.retiredDirectory !== null) {
        await this.#enqueueDirectoryRemoval(stagedReplacement.retiredDirectory);
      }
      return capability;
    } catch (error) {
      if (!committed) {
        await replacement?.rollback();
        if (logoObjectKey !== null) {
          await this.#removeLogoAfterFailure(logoObjectKey);
        }
      }
      if (error instanceof AppError) throw error;
      throw new AppError("IMPORT_FAILED");
    }
  }

  async #activateUpdate(
    actor: RequestActor,
    capabilityId: string,
    prepared: Awaited<ReturnType<CapabilityPackageImporter["prepare"]>>,
    sourceType: CapabilityRecord["sourceType"],
    marketplaceOrigin: {
      listingId: string;
      releaseId: string;
    } | null,
    replaceLogoFromPackage: boolean,
  ): Promise<CapabilityRecord> {
    assertActiveActor(actor);
    const capabilityPath = capabilityDirectory(
      this.#capabilityRoot,
      capabilityId,
    );
    let replacement:
      Awaited<ReturnType<typeof stageAtomicDirectoryReplacement>> | undefined;
    let newLogoObjectKey: string | null | undefined;
    let replacedLogoObjectKey: string | null = null;
    let committed = false;
    try {
      const stagedReplacement = await stageAtomicDirectoryReplacement(
        prepared.packageRoot,
        capabilityPath,
      );
      replacement = stagedReplacement;
      assertCapabilitySupplyChainApproval(
        prepared.riskSummary.supply_chain_review,
        await hashPackageDirectory(stagedReplacement.currentDirectory),
      );
      if (prepared.logo !== null) {
        newLogoObjectKey = await this.#storeLogo(
          capabilityId,
          prepared.logo.bytes,
          prepared.logo.filename,
          prepared.logo.contentType,
        );
      } else if (replaceLogoFromPackage) {
        newLogoObjectKey = null;
      }
      const updated = await this.#store.transaction(async (store) => {
        await store.lockCapability(capabilityId);
        const current = await store.findCapability(capabilityId);
        if (current === null) throw new AppError("CAPABILITY_NOT_FOUND");
        assertCanFullyManage(actor, current);
        if (
          current.sourceType === "clawhub" ||
          (marketplaceOrigin === null &&
            current.sourceType === "marketplace") ||
          (marketplaceOrigin !== null &&
            (current.sourceType !== "marketplace" ||
              current.marketplaceListingId !== marketplaceOrigin.listingId))
        ) {
          throw new AppError("CONFLICT");
        }
        validateRequestedType(prepared.type, current.type);
        if (prepared.name !== current.name) {
          throw new AppError("VALIDATION_ERROR");
        }
        await store.lockSkillNameRegistry();
        await assertCapabilityNameAvailable(store, {
          type: prepared.type,
          ownerId: current.ownerId,
          name: prepared.name,
          excludeCapabilityId: current.id,
        });
        if (newLogoObjectKey !== undefined) {
          replacedLogoObjectKey = current.logoObjectKey;
        }
        const value = await store.updateCapability(capabilityId, {
          name: prepared.name,
          slug: slugifyCapabilityName(prepared.name),
          description: prepared.description,
          sourceType,
          ...(marketplaceOrigin === null
            ? {}
            : {
                marketplaceListingId: marketplaceOrigin.listingId,
                marketplaceReleaseId: marketplaceOrigin.releaseId,
              }),
          storagePath: stagedReplacement.currentDirectory,
          manifestJson: prepared.manifest,
          riskSummaryJson: prepared.riskSummary,
          ...(newLogoObjectKey === undefined
            ? {}
            : { logoObjectKey: newLogoObjectKey }),
        });
        await store.writeAudit(
          audit(actor, "capability_updated", capabilityId, {
            capability_type: prepared.type,
            source_type: sourceType,
            contains_scripts: prepared.riskSummary.contains_scripts,
            contains_mcp_server: prepared.riskSummary.contains_mcp_server,
            ...supplyChainAuditMetadata(prepared.riskSummary),
          }),
        );
        return value;
      });
      await stagedReplacement.commit();
      committed = true;
      if (stagedReplacement.retiredDirectory !== null) {
        await this.#enqueueDirectoryRemoval(stagedReplacement.retiredDirectory);
      }
      if (
        newLogoObjectKey !== undefined &&
        replacedLogoObjectKey !== null &&
        replacedLogoObjectKey !== newLogoObjectKey
      ) {
        await this.#enqueueLogoRemoval(replacedLogoObjectKey);
      }
      return updated;
    } catch (error) {
      if (!committed) {
        await replacement?.rollback();
        if (typeof newLogoObjectKey === "string") {
          await this.#removeLogoAfterFailure(newLogoObjectKey);
        }
      }
      if (error instanceof AppError) throw error;
      throw new AppError("IMPORT_FAILED");
    }
  }

  async patch(
    actor: RequestActor,
    capabilityId: string,
    input: PatchCapabilityInput,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    const current = await this.requireCapability(capabilityId);
    assertCanPatchCapability(actor, current);
    if (
      current.sourceType === "marketplace" ||
      current.sourceType === "clawhub"
    ) {
      throw new AppError("CONFLICT");
    }
    if (input.status === "active") {
      await this.#assertStoredSupplyChainApproval(current);
    }
    if (input.name !== undefined && input.name.trim() !== current.name) {
      throw new AppError("VALIDATION_ERROR");
    }
    const name =
      input.name === undefined ? undefined : validateName(input.name);
    const description =
      input.description === undefined
        ? undefined
        : validateDescription(input.description);
    const statusChanged = await this.#store.transaction(async (store) => {
      await store.lockCapability(capabilityId);
      const locked = await store.findCapability(capabilityId);
      if (locked === null) throw new AppError("CAPABILITY_NOT_FOUND");
      assertCanPatchCapability(actor, locked);
      const changesStatus =
        input.status !== undefined && input.status !== locked.status;
      await store.updateCapability(capabilityId, {
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
        ...(input.status === undefined ? {} : { status: input.status }),
      });
      await store.writeAudit(
        audit(actor, "capability_configuration_updated", capabilityId, {
          changed_name: name !== undefined,
          changed_description: description !== undefined,
          changed_status: input.status !== undefined,
        }),
      );
      return changesStatus;
    });
    if (statusChanged) {
      await this.#materializeAffectedUserHomes({ userIds: [current.ownerId] });
    }
    return this.get(actor, capabilityId);
  }

  async replaceLogo(
    actor: RequestActor,
    capabilityId: string,
    bytes: Buffer,
    filename: string,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    const current = await this.requireCapability(capabilityId);
    assertCanFullyManage(actor, current);
    if (
      current.sourceType === "marketplace" ||
      current.sourceType === "clawhub"
    ) {
      throw new AppError("CONFLICT");
    }
    if (
      this.#logoStore === undefined ||
      bytes.length === 0 ||
      bytes.length > 2 * 1024 * 1024
    ) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const detectedType = detectSafeRasterImage(bytes);
    if (detectedType === null)
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    const newObjectKey = await this.#storeLogo(
      capabilityId,
      bytes,
      filename,
      detectedType,
    );
    let replacedLogoObjectKey: string | null = null;
    try {
      await this.#store.transaction(async (store) => {
        await store.lockCapability(capabilityId);
        const locked = await store.findCapability(capabilityId);
        if (locked === null) throw new AppError("CAPABILITY_NOT_FOUND");
        assertCanFullyManage(actor, locked);
        replacedLogoObjectKey = locked.logoObjectKey;
        await store.updateCapability(capabilityId, {
          logoObjectKey: newObjectKey,
        });
        await store.writeAudit(
          audit(actor, "capability_logo_updated", capabilityId, {
            replaced_existing_logo: locked.logoObjectKey !== null,
          }),
        );
      });
    } catch (error) {
      await this.#removeLogoAfterFailure(newObjectKey);
      throw error;
    }
    if (replacedLogoObjectKey !== null) {
      await this.#enqueueLogoRemoval(replacedLogoObjectKey);
    }
    return this.get(actor, capabilityId);
  }

  async delete(actor: RequestActor, capabilityId: string): Promise<void> {
    assertActiveActor(actor);
    const current = await this.requireCapability(capabilityId);
    assertCanFullyManage(actor, current);
    const capabilityPath = capabilityDirectory(
      this.#capabilityRoot,
      capabilityId,
    );
    await withCapabilityMutationLock(capabilityPath, async () => {
      let deletedLogoObjectKey: string | null = null;
      let affectedOwnerId = current.ownerId;
      let sourceRemoval:
        | Awaited<ReturnType<typeof stageAtomicCapabilityDirectoryRemoval>>
        | undefined;
      try {
        await this.#store.transaction(async (store) => {
          await store.lockCapability(capabilityId);
          const locked = await store.findCapability(capabilityId);
          if (locked === null) throw new AppError("CAPABILITY_NOT_FOUND");
          assertCanFullyManage(actor, locked);
          affectedOwnerId = locked.ownerId;
          deletedLogoObjectKey = locked.logoObjectKey;
          sourceRemoval =
            await stageAtomicCapabilityDirectoryRemoval(capabilityPath);
          await store.writeAudit(
            audit(actor, "capability_deleted", capabilityId, {
              had_logo: locked.logoObjectKey !== null,
            }),
          );
          await store.deleteCapabilityGraph(capabilityId);
        });
        await sourceRemoval?.commit();
      } catch (error) {
        await sourceRemoval?.rollback();
        throw error;
      }
      if (sourceRemoval?.retiredDirectory !== undefined) {
        await this.#enqueueDirectoryRemoval(sourceRemoval.retiredDirectory);
      }
      if (deletedLogoObjectKey !== null) {
        await this.#enqueueLogoRemoval(deletedLogoObjectKey);
      }
      await this.#materializeAffectedUserHomes({ userIds: [affectedOwnerId] });
    });
  }

  async setPreference(
    actor: RequestActor,
    capabilityId: string,
    status: "enabled" | "disabled",
  ): Promise<{ capability_id: string; status: "enabled" | "disabled" }> {
    assertActiveActor(actor);
    const capability = await this.requireCapability(capabilityId);
    if (capability.status === "failed" || capability.ownerId !== actor.id) {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    if (status === "enabled") {
      await this.#assertStoredSupplyChainApproval(capability);
    }
    await this.#store.transaction(async (store) => {
      await store.upsertPreference(
        actor.id,
        capabilityId,
        status,
        status === "disabled" ? this.#now() : null,
      );
      await store.writeAudit(
        audit(actor, "capability_preference_updated", capabilityId, {
          preference_status: status,
        }),
      );
    });
    await this.#materializeAffectedUserHomes({ userIds: [actor.id] });
    return { capability_id: capabilityId, status };
  }

  async assertUsable(
    userId: string,
    capabilityIds: string[],
  ): Promise<CapabilityRecord[]> {
    const requested = new Set(capabilityIds);
    if (requested.size !== capabilityIds.length)
      throw new AppError("VALIDATION_ERROR");
    const capabilities = await this.#store.listCapabilities();
    const disabled = new Set(
      (await this.#store.listPreferences(userId))
        .filter((item) => item.status === "disabled")
        .map((item) => item.capabilityId),
    );
    const result = capabilities.filter(
      (capability) =>
        requested.has(capability.id) &&
        capability.ownerId === userId &&
        capability.status === "active" &&
        !disabled.has(capability.id),
    );
    if (result.length !== requested.size)
      throw new AppError("CAPABILITY_NOT_FOUND");
    return result;
  }

  async #assertStoredSupplyChainApproval(
    capability: CapabilityRecord,
  ): Promise<void> {
    const review = capabilityRiskSummaryReview(capability.riskSummaryJson);
    if (review === undefined) return;
    const packageRoot = join(
      capabilityDirectory(this.#capabilityRoot, capability.id),
      "current",
    );
    assertCapabilitySupplyChainApproval(
      review,
      await hashPackageDirectory(packageRoot),
    );
  }

  async requireCapability(capabilityId: string): Promise<CapabilityRecord> {
    const capability = await this.#store.findCapability(capabilityId);
    if (capability === null) throw new AppError("CAPABILITY_NOT_FOUND");
    return capability;
  }

  async #storeLogo(
    capabilityId: string,
    bytes: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string> {
    if (this.#logoStore === undefined)
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    const detectedType = detectSafeRasterImage(bytes);
    if (
      bytes.length === 0 ||
      bytes.length > 2 * 1024 * 1024 ||
      detectedType === null ||
      detectedType !== contentType ||
      !extensionMatchesImageType(filename, contentType)
    ) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const extension = safeImageExtension(contentType, filename);
    const objectKey =
      "capabilities/" + capabilityId + "/logos/" + randomUUID() + extension;
    await this.#logoStore.put(objectKey, bytes, contentType);
    return objectKey;
  }

  async #removeLogoAfterFailure(objectKey: string): Promise<void> {
    if (this.#logoStore === undefined) return;
    try {
      await this.#logoStore.remove(objectKey);
    } catch {
      try {
        await this.#logoStore.enqueueRemoval?.(objectKey);
      } catch {
        // The durable object cleanup adapter records retryable failures.
      }
    }
  }

  async #enqueueLogoRemoval(objectKey: string): Promise<void> {
    if (this.#logoStore === undefined) return;
    try {
      if (this.#logoStore.enqueueRemoval !== undefined) {
        await this.#logoStore.enqueueRemoval(objectKey);
        return;
      }
      await this.#logoStore.remove(objectKey);
    } catch {
      try {
        await this.#logoStore.remove(objectKey);
      } catch {
        // A committed database update must not be reported as failed cleanup.
      }
    }
  }

  async #enqueueDirectoryRemoval(path: string): Promise<void> {
    try {
      if (this.#packageCleanup?.enqueueDirectoryRemoval !== undefined) {
        await this.#packageCleanup.enqueueDirectoryRemoval(path);
        return;
      }
      await rm(path, { recursive: true, force: true });
    } catch {
      try {
        await rm(path, { recursive: true, force: true });
      } catch {
        // The cleanup adapter is expected to retry; do not undo committed state.
      }
    }
  }

  async #cleanupPreparedPackage(
    prepared: Parameters<CapabilityPackageImporter["cleanup"]>[0],
  ): Promise<void> {
    try {
      await this.#importer.cleanup(prepared);
    } catch {
      await this.#enqueueDirectoryRemoval(prepared.stagingDirectory);
    }
  }

  async #materializeAffectedUserHomes(
    targets: UserHomeCapabilityTargets,
  ): Promise<void> {
    if (this.#materializeUserHomes === undefined) return;
    try {
      await this.#materializeUserHomes(targets);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
    }
  }

  async #writeCommittedImportHomeSyncFailureAudit(
    actor: RequestActor,
    operation: "install" | "update",
    capabilityId: string,
    sourceType: CapabilityRecord["sourceType"],
  ): Promise<void> {
    await this.#store
      .writeAudit({
        actorId: actor.id,
        action: "capability_home_sync_failed",
        targetType: "capability",
        targetId: capabilityId,
        result: "failure",
        metadata: {
          operation,
          source_type: sourceType,
          error_code: "CAPABILITY_HOME_SYNC_FAILED",
          recovery: "next_turn_preflight",
        },
        ...(actor.ipAddress === undefined
          ? {}
          : { ipAddress: actor.ipAddress }),
        ...(actor.userAgent === undefined
          ? {}
          : { userAgent: actor.userAgent }),
      })
      .catch(() => undefined);
  }

  async #capabilityView(
    capability: CapabilityRecord,
    preferenceStatus: "enabled" | "disabled",
    actor: RequestActor,
  ): Promise<CapabilityView> {
    const logoUrl =
      capability.logoObjectKey === null
        ? null
        : await requireLogoStore(this.#logoStore).presignGet(
            capability.logoObjectKey,
            5 * 60,
          );
    return capabilityView(capability, preferenceStatus, actor, logoUrl);
  }

  async #writeImportFailureAudit(
    actor: RequestActor,
    operation: "install" | "update",
    capabilityId: string | null,
    sourceType: "local" | "clawhub",
    error: unknown,
  ): Promise<void> {
    await this.#store
      .writeAudit({
        actorId: actor.id,
        action:
          operation === "install"
            ? "capability_install_failed"
            : "capability_update_failed",
        targetType: "capability",
        ...(capabilityId === null ? {} : { targetId: capabilityId }),
        result: "failure",
        metadata: {
          source_type: sourceType,
          error_code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        },
        ...(actor.ipAddress === undefined
          ? {}
          : { ipAddress: actor.ipAddress }),
        ...(actor.userAgent === undefined
          ? {}
          : { userAgent: actor.userAgent }),
      })
      .catch(() => undefined);
  }
}

async function withCapabilityMutationLock<T>(
  capabilityPath: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    await mkdir(dirname(capabilityPath), { recursive: true, mode: 0o700 });
    const pathStat = await lstat(capabilityPath).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    });
    if (
      pathStat !== null &&
      (!pathStat.isDirectory() || pathStat.isSymbolicLink())
    ) {
      throw new AppError("IMPORT_FAILED");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("IMPORT_FAILED");
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(capabilityPath, {
      realpath: false,
      lockfilePath: `${capabilityPath}.mutation.lock`,
      stale: 120_000,
      update: 10_000,
      retries: {
        retries: 100,
        factor: 1.2,
        minTimeout: 10,
        maxTimeout: 250,
        randomize: true,
      },
    });
  } catch {
    throw new AppError("IMPORT_FAILED");
  }

  try {
    return await work();
  } finally {
    await release().catch(() => undefined);
  }
}

async function stageAtomicCapabilityDirectoryRemoval(
  capabilityPath: string,
): Promise<{
  retiredDirectory: string | undefined;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}> {
  const retiredDirectory = `${capabilityPath}.deleted-${randomUUID()}`;
  const currentStat = await lstat(capabilityPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (currentStat === null) {
    return {
      retiredDirectory: undefined,
      async commit() {},
      async rollback() {},
    };
  }
  if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
    throw new AppError("IMPORT_FAILED");
  }
  await rename(capabilityPath, retiredDirectory);
  let settled = false;
  return {
    retiredDirectory,
    async commit() {
      settled = true;
    },
    async rollback() {
      if (settled) return;
      settled = true;
      await rename(retiredDirectory, capabilityPath);
    },
  };
}

async function assertCapabilityNameAvailable(
  store: CapabilityStore,
  input: {
    type: CapabilityType;
    ownerId: string;
    name: string;
    excludeCapabilityId?: string;
  },
): Promise<void> {
  const requestedSlug = slugifyCapabilityName(input.name);
  const conflict = (await store.listCapabilities()).some((capability) => {
    if (
      capability.id === input.excludeCapabilityId ||
      capability.type !== input.type ||
      capability.ownerId !== input.ownerId
    ) {
      return false;
    }
    return capability.name === input.name || capability.slug === requestedSlug;
  });
  if (conflict) throw new AppError("CONFLICT");
}

function capabilityView(
  capability: CapabilityRecord,
  preferenceStatus: "enabled" | "disabled",
  actor: RequestActor,
  logoUrl: string | null,
): CapabilityView {
  return {
    id: capability.id,
    type: capability.type,
    name: capability.name,
    slug: capability.slug,
    description: capability.description,
    source_type: capability.sourceType,
    builtin_key: null,
    is_builtin: false,
    marketplace_listing_id: capability.marketplaceListingId,
    marketplace_release_id: capability.marketplaceReleaseId,
    status: capability.status,
    has_logo: capability.logoObjectKey !== null,
    logo_url: logoUrl,
    manifest: capability.manifestJson,
    risk_summary: capability.riskSummaryJson,
    preference_status: preferenceStatus,
    can_manage: canFullyManage(actor, capability),
    can_govern: false,
    can_select:
      capability.status === "active" && preferenceStatus === "enabled",
    can_delete: canFullyManage(actor, capability),
    is_owner: capability.ownerId === actor.id,
    created_at: capability.createdAt.toISOString(),
    updated_at: capability.updatedAt.toISOString(),
  };
}

function builtInCapabilityViews(): CapabilityView[] {
  return builtInCapabilityDefinitions.map((definition) => ({
    id: builtInCapabilityId(definition.key),
    type: definition.type,
    name: definition.slug,
    slug: definition.slug,
    description: null,
    source_type: "builtin",
    builtin_key: definition.key,
    is_builtin: true,
    marketplace_listing_id: null,
    marketplace_release_id: null,
    status: "active",
    has_logo: false,
    logo_url: null,
    manifest: null,
    risk_summary: null,
    preference_status: "enabled",
    can_manage: false,
    can_govern: false,
    can_select: false,
    can_delete: false,
    is_owner: false,
    created_at: null,
    updated_at: null,
  }));
}

function requireLogoStore(
  value: CapabilityLogoStore | undefined,
): CapabilityLogoStore {
  if (value === undefined) throw new AppError("INTERNAL_ERROR");
  return value;
}

function canFullyManage(
  actor: RequestActor,
  capability: CapabilityRecord,
): boolean {
  if (actor.status !== "active") return false;
  return capability.ownerId === actor.id;
}

function assertCanFullyManage(
  actor: RequestActor,
  capability: CapabilityRecord,
): void {
  if (!canFullyManage(actor, capability)) {
    throw new AppError("FORBIDDEN");
  }
}

function assertCanPatchCapability(
  actor: RequestActor,
  capability: CapabilityRecord,
): void {
  if (!canFullyManage(actor, capability)) {
    throw new AppError("FORBIDDEN");
  }
}

async function marketplacePreparedPackage(
  input: MarketplaceReleaseInstallInput,
): Promise<PreparedCapabilityPackage> {
  const supplyChainReview = await scanCapabilitySupplyChain(input.packageRoot);
  assertCapabilitySupplyChainApproval(supplyChainReview);
  return {
    stagingDirectory: input.packageRoot,
    packageRoot: input.packageRoot,
    type: input.type,
    name: input.name,
    description: input.description,
    manifest: input.manifest,
    riskSummary: {
      ...input.riskSummary,
      supply_chain_review: supplyChainReview,
    },
    logo: input.logo,
  };
}

function supplyChainAuditMetadata(
  riskSummary: CapabilityRiskSummary,
): Record<string, string | number> {
  const review = riskSummary.supply_chain_review;
  if (review === undefined) return {};
  return {
    security_scanner_version: review.scanner_version,
    security_ruleset_version: review.ruleset_version,
    security_content_sha256: review.content_sha256,
    security_verdict: review.verdict,
    security_finding_count: review.finding_count,
  };
}

function capabilityRiskSummaryReview(
  value: Record<string, unknown> | null,
): CapabilityRiskSummary["supply_chain_review"] {
  const review = value?.supply_chain_review;
  if (review === undefined) return undefined;
  const parsed = capabilitySupplyChainReviewSchema.safeParse(review);
  if (!parsed.success) {
    throw new AppError("INVALID_PACKAGE", {
      reason_code: "security_review_stale",
    });
  }
  return parsed.data;
}

function assertActiveActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}

function validateName(value: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 160)
    throw new AppError("VALIDATION_ERROR");
  return result;
}

function validateDescription(value: string | null): string | null {
  if (value === null) return null;
  const result = value.trim();
  if (result.length > 4_000) throw new AppError("VALIDATION_ERROR");
  return result === "" ? null : result;
}

function safeImageExtension(contentType: string, filename: string): string {
  const byType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };
  return byType[contentType] ?? extname(filename).toLocaleLowerCase("en-US");
}

function requirePreviewCapabilityId(value: string | null): string {
  if (value === null) throw new AppError("CAPABILITY_NOT_FOUND");
  return value;
}

function audit(
  actor: RequestActor,
  action: string,
  capabilityId: string,
  metadata: Record<string, unknown>,
) {
  return {
    actorId: actor.id,
    action,
    targetType: "capability",
    targetId: capabilityId,
    result: "success" as const,
    metadata,
    ...(actor.ipAddress === undefined ? {} : { ipAddress: actor.ipAddress }),
    ...(actor.userAgent === undefined ? {} : { userAgent: actor.userAgent }),
  };
}
