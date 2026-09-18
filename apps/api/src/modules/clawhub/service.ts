import type {
  ClawHubInstallabilityReason,
  ClawHubSecurityStatus,
  ClawHubSkillCatalogItem,
  ClawHubSkillCatalogSort,
} from "@linksense/shared";
import pLimit from "p-limit";
import pRetry from "p-retry";

import { AppError } from "../../lib/errors.js";
import type {
  ClawHubCapabilityOrigin,
  RequestActor,
} from "../capabilities/types.js";
import type { ClawHubClient } from "./client.js";
import type { ClawHubInstallPreviewGuard } from "./install-guard.js";
import { inspectClawHubManifest } from "./manifest-policy.js";
import type {
  ClawHubDownloadedFile,
  ClawHubSkillDetail,
  ClawHubSkillPackage,
  ClawHubVersionDetail,
} from "./types.js";
import { ClawHubClientError } from "./types.js";
import type {
  ClawHubCatalogPage,
  ClawHubCatalogRecord,
  ClawHubSkillSyncRecord,
  ClawHubStore,
  ClawHubSyncTrigger,
} from "./repository.js";

const SYNC_STAGE_CONCURRENCY = 16;
const SYNC_PAGE_RETRIES = 2;

export type ClawHubClientPort = Pick<
  ClawHubClient,
  | "downloadVersionFiles"
  | "getSkillDetail"
  | "getVersionDetail"
  | "listSkillPackages"
>;

export interface PreviewClawHubInstallInput {
  skillId: string;
  ownerHandle: string;
  slug: string;
  version: string;
  securityStatus: ClawHubSecurityStatus;
  securityHasWarnings: boolean;
  canonicalUrl: string;
  files: ClawHubDownloadedFile[];
}

export interface ClawHubCapabilityInstaller {
  previewClawHubInstall(
    actor: RequestActor,
    input: PreviewClawHubInstallInput,
  ): Promise<unknown>;
}

export interface ClawHubServiceOptions {
  store: ClawHubStore;
  client: ClawHubClientPort;
  capabilityInstaller: ClawHubCapabilityInstaller;
  installPreviewGuard: ClawHubInstallPreviewGuard;
  now?: () => Date;
}

export interface ClawHubCatalogResult {
  items: ClawHubSkillCatalogItem[];
  nextCursor: string | null;
  totalCount: number;
}

export interface ClawHubSyncResult {
  runId: string;
  listedCount: number;
  detailCount: number;
  unavailableCount: number;
}

export class ClawHubService {
  readonly #store: ClawHubStore;
  readonly #client: ClawHubClientPort;
  readonly #capabilityInstaller: ClawHubCapabilityInstaller;
  readonly #installPreviewGuard: ClawHubInstallPreviewGuard;
  readonly #now: () => Date;

  constructor(options: ClawHubServiceOptions) {
    this.#store = options.store;
    this.#client = options.client;
    this.#capabilityInstaller = options.capabilityInstaller;
    this.#installPreviewGuard = options.installPreviewGuard;
    this.#now = options.now ?? (() => new Date());
  }

  async listCatalog(
    actor: RequestActor,
    input: {
      search?: string;
      sort?: ClawHubSkillCatalogSort;
      cursor?: string;
      limit: number;
    },
  ): Promise<ClawHubCatalogResult> {
    assertActiveActor(actor);
    const page = await this.#store.listCatalog({
      userId: actor.id,
      limit: input.limit,
      sort: input.sort ?? "downloads",
      ...(input.search === undefined ? {} : { search: input.search }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    return projectCatalogPage(page);
  }

  async previewInstall(actor: RequestActor, skillId: string): Promise<unknown> {
    assertActiveActor(actor);
    const catalogRecord = await this.#store.findCatalogSkill(actor.id, skillId);
    if (catalogRecord === null) throw new AppError("CLAWHUB_SKILL_NOT_FOUND");
    assertStoredSkillInstallable(catalogRecord);

    return this.#installPreviewGuard.run(actor.id, () =>
      this.#prepareInstallPreview(actor, catalogRecord),
    );
  }

  async validateInstallConfirmation(
    actor: RequestActor,
    origin: ClawHubCapabilityOrigin,
  ): Promise<void> {
    assertActiveActor(actor);
    const catalogRecord = await this.#store.findCatalogSkill(
      actor.id,
      origin.skillId,
    );
    if (catalogRecord === null) throw new AppError("CLAWHUB_SKILL_NOT_FOUND");
    if (catalogRecord.installation !== null) {
      throw new AppError("CLAWHUB_SKILL_ALREADY_INSTALLED");
    }
    if (
      !catalogRecord.skill.available ||
      catalogRecord.skill.ownerHandle !== origin.ownerHandle ||
      catalogRecord.skill.slug !== origin.slug
    ) {
      throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
    }

    try {
      const { security } = await this.#loadExactInstallEvidence(
        catalogRecord,
        origin.version,
      );
      if (
        security.status === "unverified" ||
        security.status === "malicious" ||
        security.blocked ||
        security.status !== origin.securityStatus ||
        security.hasWarnings !== origin.securityHasWarnings
      ) {
        throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
      }
    } catch (error) {
      throw mapInstallFetchError(error);
    }
  }

  async #prepareInstallPreview(
    actor: RequestActor,
    catalogRecord: ClawHubCatalogRecord,
  ): Promise<unknown> {
    const { skill } = catalogRecord;
    const version = skill.latestVersion;
    if (version === null) throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");

    let detail: ClawHubSkillDetail;
    let versionDetail: ClawHubVersionDetail;
    let downloadedFiles: ClawHubDownloadedFile[];
    try {
      const evidence = await this.#loadExactInstallEvidence(
        catalogRecord,
        version,
      );
      detail = evidence.detail;
      versionDetail = evidence.versionDetail;
      const remoteSecurity = evidence.security;
      if (
        remoteSecurity.status === "unverified" ||
        remoteSecurity.status === "malicious" ||
        remoteSecurity.blocked
      ) {
        throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
      }
      downloadedFiles = (
        await this.#client.downloadVersionFiles({
          ownerHandle: skill.ownerHandle,
          slug: skill.slug,
          version,
          files: versionDetail.version.files,
        })
      ).files;
    } catch (error) {
      throw mapInstallFetchError(error);
    }

    const security = effectiveSecurity(detail, versionDetail);
    return this.#capabilityInstaller.previewClawHubInstall(actor, {
      skillId: skill.id,
      ownerHandle: skill.ownerHandle,
      slug: skill.slug,
      version: versionDetail.version.version,
      securityStatus: security.status,
      securityHasWarnings: security.hasWarnings,
      canonicalUrl: detail.canonicalUrl,
      files: downloadedFiles,
    });
  }

  async #loadExactInstallEvidence(
    catalogRecord: ClawHubCatalogRecord,
    version: string,
  ): Promise<{
    detail: ClawHubSkillDetail;
    versionDetail: ClawHubVersionDetail;
    security: ReturnType<typeof effectiveSecurity>;
  }> {
    const { skill } = catalogRecord;
    const detail = await this.#client.getSkillDetail({
      ownerHandle: skill.ownerHandle,
      slug: skill.slug,
    });
    assertExactSkillIdentity(skill.ownerHandle, skill.slug, detail);
    const versionDetail = await this.#client.getVersionDetail({
      ownerHandle: skill.ownerHandle,
      slug: skill.slug,
      version,
    });
    assertExactVersionIdentity(
      skill.ownerHandle,
      skill.slug,
      version,
      versionDetail,
    );
    if (
      inspectClawHubManifest(versionDetail.version.files)
        .installBlockReason !== null
    ) {
      throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
    }
    return {
      detail,
      versionDetail,
      security: effectiveSecurity(detail, versionDetail),
    };
  }

  async syncAll(trigger: ClawHubSyncTrigger, signal?: AbortSignal): Promise<ClawHubSyncResult> {
    signal?.throwIfAborted();
    const startedAt = this.#now();
    await this.#store.recoverInterruptedRuns(startedAt);
    const run = await this.#store.createSyncRun(trigger, startedAt);
    let listedCount = 0;
    let syncedCount = 0;
    let cursor: string | undefined;
    const visitedCursors = new Set<string>();
    const seenIdentities = new Set<string>();
    const limit = pLimit(SYNC_STAGE_CONCURRENCY);

    try {
      for (;;) {
        signal?.throwIfAborted();
        const page = await pRetry(
          () =>
            this.#client.listSkillPackages({
              limit: 100,
              sort: "updated",
              ...(cursor === undefined ? {} : { cursor }),
              ...(signal ? { signal } : {}),
            }),
          {
            retries: SYNC_PAGE_RETRIES,
            factor: 2,
            minTimeout: 1_000,
            maxTimeout: 5_000,
            ...(signal ? { signal } : {}),
            shouldRetry: (error) =>
              error instanceof ClawHubClientError && error.retryable,
          },
        );
        signal?.throwIfAborted();
        listedCount += page.items.length;
        const stageResults = await Promise.allSettled(
          page.items.map((skillPackage) =>
            limit(async () => {
              signal?.throwIfAborted();
              const identity = skillIdentity(skillPackage);
              if (seenIdentities.has(identity)) return;
              seenIdentities.add(identity);
              await this.#store.stageSkill(
                run.id,
                this.#now(),
                syncRecordFromPackage(skillPackage),
              );
              syncedCount += 1;
            }),
          ),
        );
        const failedStage = stageResults.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failedStage) throw failedStage.reason;
        signal?.throwIfAborted();

        if (page.nextCursor === null) break;
        if (
          page.nextCursor === cursor ||
          visitedCursors.has(page.nextCursor)
        ) {
          throw new Error("clawhub_sync_cursor_did_not_advance");
        }
        visitedCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }

      const finishedAt = this.#now();
      const unavailableCount = await this.#store.publishSyncRun({
        runId: run.id,
        listedCount,
        detailCount: syncedCount,
        finishedAt,
      });
      return {
        runId: run.id,
        listedCount,
        detailCount: syncedCount,
        unavailableCount,
      };
    } catch (error) {
      await this.#store.failSyncRun({
        runId: run.id,
        listedCount,
        detailCount: syncedCount,
        errorCode: signal?.aborted ? "clawhub_request_aborted" : syncErrorCode(error),
        finishedAt: this.#now(),
      });
      throw error;
    }
  }

}

function projectCatalogPage(page: ClawHubCatalogPage): ClawHubCatalogResult {
  return {
    items: page.items.map(projectCatalogItem),
    nextCursor: page.nextCursor,
    totalCount: page.totalCount,
  };
}

function projectCatalogItem(record: ClawHubCatalogRecord): ClawHubSkillCatalogItem {
  const { skill, installation } = record;
  const reason = installabilityReason(record);
  return {
    id: skill.id,
    slug: skill.slug,
    display_name: skill.displayName,
    summary: skill.summary,
    topics: skill.topics,
    tags: skill.tags,
    latest_version: skill.latestVersion,
    latest_version_created_at:
      skill.latestVersionCreatedAt?.toISOString() ?? null,
    latest_version_changelog: skill.latestVersionChangelog,
    latest_version_license: skill.latestVersionLicense,
    owner_handle: skill.ownerHandle,
    owner_display_name: skill.ownerDisplayName,
    metadata: platformMetadata(skill.metadata),
    stats: {
      downloads: skill.downloadCount,
      installs: skill.installCount,
      stars: skill.starCount,
      comments: skill.commentCount,
      versions: skill.versionCount,
    },
    security_status: skill.securityStatus,
    security_has_warnings: skill.securityHasWarnings,
    is_suspicious: skill.isSuspicious,
    is_malware_blocked: skill.isMalwareBlocked,
    source_created_at: skill.sourceCreatedAt.toISOString(),
    source_updated_at: skill.sourceUpdatedAt.toISOString(),
    synced_at: skill.lastSeenAt.toISOString(),
    canonical_url: skill.canonicalUrl,
    available: skill.available,
    installable: reason === null,
    installability_reason: reason,
    installed_capability_id: installation?.capabilityId ?? null,
    installed_version: installation?.installedVersion ?? null,
    update_available:
      installation !== null &&
      skill.latestVersion !== null &&
      installation.installedVersion !== skill.latestVersion,
  };
}

function installabilityReason(
  record: ClawHubCatalogRecord,
): ClawHubInstallabilityReason | null {
  if (!record.skill.available) return "unavailable";
  if (record.skill.latestVersion === null) return "missing_version";
  if (record.installation !== null) return "already_installed";
  return null;
}

function assertStoredSkillInstallable(record: ClawHubCatalogRecord): void {
  if (record.installation !== null) {
    throw new AppError("CLAWHUB_SKILL_ALREADY_INSTALLED");
  }
  if (installabilityReason(record) !== null) {
    throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
  }
}

function assertActiveActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}

function assertExactSkillIdentity(
  ownerHandle: string,
  slug: string,
  detail: ClawHubSkillDetail,
): void {
  if (detail.owner.handle !== ownerHandle || detail.slug !== slug) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub returned a different publisher or skill",
    );
  }
}

function assertExactVersionIdentity(
  ownerHandle: string,
  slug: string,
  version: string,
  detail: ClawHubVersionDetail,
): void {
  if (
    detail.ownerHandle !== ownerHandle ||
    detail.skill.slug !== slug ||
    detail.version.version !== version
  ) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub returned a different publisher, skill, or version",
    );
  }
}

function syncRecordFromPackage(
  skillPackage: ClawHubSkillPackage,
): ClawHubSkillSyncRecord {
  const topics = boundedStrings(skillPackage.topics, 100, 240);
  return {
    ownerHandle: skillPackage.ownerHandle,
    slug: skillPackage.slug,
    displayName: boundedText(skillPackage.displayName, 1_000),
    summary: boundedNullableText(skillPackage.summary, 20_000),
    topics,
    tags: {},
    downloadCount: skillPackage.stats.downloads,
    installCount: skillPackage.stats.installs,
    starCount: skillPackage.stats.stars,
    commentCount: skillPackage.stats.comments,
    versionCount: skillPackage.stats.versions,
    latestVersion: skillPackage.latestVersion,
    latestVersionCreatedAt: null,
    latestVersionChangelog: null,
    latestVersionLicense: null,
    ownerDisplayName: null,
    ownerImageUrl: null,
    metadata: null,
    sourceMetadata: jsonObject({ package: skillPackage }),
    moderationVerdict: null,
    moderationReasonCodes: [],
    moderationSummary: null,
    moderationEngineVersion: null,
    moderationUpdatedAt: null,
    isSuspicious: false,
    isMalwareBlocked: false,
    securityStatus: "unverified",
    securityHasWarnings: false,
    securityCheckedAt: null,
    fileCount: 0,
    totalFileBytes: 0,
    installBlockReason: null,
    canonicalUrl: skillPackage.canonicalUrl,
    searchText: boundedText(
      [
        skillPackage.displayName,
        skillPackage.slug,
        skillPackage.ownerHandle,
        skillPackage.summary,
        ...topics,
        ...skillPackage.categories,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase("en-US"),
      200_000,
    ),
    sourceCreatedAt: upstreamDate(skillPackage.createdAt),
    sourceUpdatedAt: upstreamDate(skillPackage.updatedAt),
  };
}

function effectiveSecurity(
  detail: ClawHubSkillDetail,
  versionDetail: ClawHubVersionDetail | null,
): {
  status: ClawHubSecurityStatus;
  hasWarnings: boolean;
  suspicious: boolean;
  blocked: boolean;
} {
  const moderationVerdict = detail.moderation?.verdict?.toLowerCase() ?? "";
  const status = normalizeSecurityStatus(
    versionDetail?.version.security?.status,
    versionDetail?.version.security?.hasScanResult,
  );
  const blocked =
    detail.moderation?.isMalwareBlocked === true ||
    status === "malicious" ||
    ["blocked", "malicious", "malware"].includes(moderationVerdict);
  const suspicious =
    detail.moderation?.isSuspicious === true ||
    status === "suspicious" ||
    blocked;
  return {
    status: blocked ? "malicious" : suspicious ? "suspicious" : status,
    hasWarnings:
      versionDetail?.version.security?.hasWarnings === true || suspicious,
    suspicious,
    blocked,
  };
}

function normalizeSecurityStatus(
  value: string | undefined,
  hasScanResult: boolean | undefined,
): ClawHubSecurityStatus {
  if (hasScanResult !== true) return "unverified";
  switch (value?.trim().toLowerCase()) {
    case "clean":
      return "clean";
    case "suspicious":
      return "suspicious";
    case "malicious":
    case "malware":
    case "blocked":
      return "malicious";
    default:
      return "unverified";
  }
}

function platformMetadata(
  value: Record<string, unknown> | null,
): { os: string[] | null; systems: string[] | null } | null {
  if (value === null) return null;
  return {
    os: stringArrayOrNull(value.os),
    systems: stringArrayOrNull(value.systems),
  };
}

function stringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function boundedText(value: string, maximumLength: number): string {
  return value.trim().slice(0, maximumLength);
}

function boundedNullableText(
  value: string | null,
  maximumLength: number,
): string | null {
  if (value === null) return null;
  const bounded = boundedText(value, maximumLength);
  return bounded.length === 0 ? null : bounded;
}

function boundedStrings(
  values: readonly string[],
  maximumItems: number,
  maximumLength: number,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = boundedText(value, maximumLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function jsonObject(value: object): Record<string, unknown> {
  const parsed = JSON.parse(JSON.stringify(value)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("clawhub_source_metadata_not_object");
  }
  return parsed as Record<string, unknown>;
}

function upstreamDate(value: number): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ClawHubClientError(
      "INVALID_RESPONSE",
      "ClawHub returned an invalid timestamp",
    );
  }
  return date;
}

function skillIdentity(skillPackage: ClawHubSkillPackage): string {
  return `${skillPackage.ownerHandle}\u0000${skillPackage.slug}`;
}

function mapInstallFetchError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (
    error instanceof ClawHubClientError &&
    (error.kind === "INTEGRITY_MISMATCH" ||
      error.kind === "INVALID_MANIFEST")
  ) {
    return new AppError("CLAWHUB_PACKAGE_INTEGRITY_FAILED");
  }
  return new AppError("CLAWHUB_SERVICE_UNAVAILABLE");
}

function syncErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    error.message === "clawhub_sync_empty_snapshot"
  ) {
    return "clawhub_empty_snapshot";
  }
  if (error instanceof ClawHubClientError) {
    return `clawhub_${error.kind.toLowerCase()}`;
  }
  if (error instanceof AppError) return error.code.toLowerCase();
  return "clawhub_sync_failed";
}
