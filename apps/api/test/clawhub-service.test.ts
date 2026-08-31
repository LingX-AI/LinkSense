import { describe, expect, it, vi } from "vitest";

import type { RequestActor } from "../src/modules/capabilities/types.js";
import type {
  ClawHubCatalogRecord,
  ClawHubStore,
} from "../src/modules/clawhub/repository.js";
import type { ClawHubInstallPreviewGuard } from "../src/modules/clawhub/install-guard.js";
import {
  ClawHubService,
  type ClawHubClientPort,
} from "../src/modules/clawhub/service.js";
import {
  ClawHubClientError,
  type ClawHubDownloadedVersion,
  type ClawHubSkillDetail,
  type ClawHubSkillPackage,
  type ClawHubVersionDetail,
} from "../src/modules/clawhub/types.js";

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const SKILL_ID = "10000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-08-07T00:00:00.000Z");
const OWNER = "alice";
const SLUG = "useful-agent";
const VERSION = "1.2.3";

describe("ClawHubService", () => {
  it("fully paginates publisher-qualified packages without requesting skill details", async () => {
    const fixture = serviceFixture();
    fixture.client.listSkillPackages
      .mockResolvedValueOnce({
        items: [skillPackage()],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });

    await expect(fixture.service.syncAll("scheduled")).resolves.toEqual({
      runId: RUN_ID,
      listedCount: 1,
      detailCount: 1,
      unavailableCount: 2,
    });

    expect(fixture.client.listSkillPackages).toHaveBeenNthCalledWith(2, {
      limit: 100,
      sort: "updated",
      cursor: "page-2",
    });
    expect(fixture.client.getSkillDetail).not.toHaveBeenCalled();
    expect(fixture.client.getVersionDetail).not.toHaveBeenCalled();
    expect(fixture.client.downloadVersionFiles).not.toHaveBeenCalled();
    expect(fixture.store.stageSkill).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      expect.objectContaining({
        ownerHandle: OWNER,
        slug: SLUG,
        displayName: "Useful Agent",
        summary: "Useful skill",
        securityStatus: "unverified",
        securityHasWarnings: false,
        fileCount: 0,
        totalFileBytes: 0,
        installBlockReason: null,
        sourceMetadata: { package: skillPackage() },
      }),
    );
    expect(fixture.store.publishSyncRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      listedCount: 1,
      detailCount: 1,
      finishedAt: NOW,
    });
    expect(fixture.store.failSyncRun).not.toHaveBeenCalled();
  });

  it("retries only the current packages page after a retryable upstream failure", async () => {
    vi.useFakeTimers();
    try {
      const fixture = serviceFixture();
      fixture.client.listSkillPackages
        .mockRejectedValueOnce(
          new ClawHubClientError(
            "REQUEST_TIMEOUT",
            "ClawHub request timed out",
            { retryable: true },
          ),
        )
        .mockResolvedValueOnce({ items: [skillPackage()], nextCursor: null });

      const syncPromise = fixture.service.syncAll("scheduled");
      await vi.runAllTimersAsync();

      await expect(syncPromise).resolves.toMatchObject({
        listedCount: 1,
        detailCount: 1,
      });
      expect(fixture.client.listSkillPackages).toHaveBeenCalledTimes(2);
      expect(fixture.client.getSkillDetail).not.toHaveBeenCalled();
      expect(fixture.client.getVersionDetail).not.toHaveBeenCalled();
      expect(fixture.client.downloadVersionFiles).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-retryable packages response failure", async () => {
    const fixture = serviceFixture();
    fixture.client.listSkillPackages.mockRejectedValueOnce(
      new ClawHubClientError(
        "INVALID_RESPONSE",
        "ClawHub response did not match the documented contract",
      ),
    );

    await expect(fixture.service.syncAll("scheduled")).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
    expect(fixture.client.listSkillPackages).toHaveBeenCalledTimes(1);
    expect(fixture.store.publishSyncRun).not.toHaveBeenCalled();
  });

  it("stores only package metadata and defers security and manifest checks until install", async () => {
    const fixture = serviceFixture();
    fixture.client.listSkillPackages.mockResolvedValueOnce({
      items: [skillPackage()],
      nextCursor: null,
    });
    await expect(fixture.service.syncAll("scheduled")).resolves.toEqual({
      runId: RUN_ID,
      listedCount: 1,
      detailCount: 1,
      unavailableCount: 2,
    });

    expect(fixture.store.stageSkill).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      expect.objectContaining({
        ownerHandle: OWNER,
        slug: SLUG,
        securityStatus: "unverified",
        installBlockReason: null,
        sourceMetadata: { package: skillPackage() },
      }),
    );
    expect(fixture.store.publishSyncRun).toHaveBeenCalledOnce();
    expect(fixture.store.failSyncRun).not.toHaveBeenCalled();
    expect(fixture.client.getVersionDetail).not.toHaveBeenCalled();
  });

  it("does not request or inspect a version manifest during synchronization", async () => {
    const fixture = serviceFixture();
    fixture.client.listSkillPackages.mockResolvedValueOnce({
      items: [skillPackage()],
      nextCursor: null,
    });

    await fixture.service.syncAll("scheduled");

    expect(fixture.client.getSkillDetail).not.toHaveBeenCalled();
    expect(fixture.client.getVersionDetail).not.toHaveBeenCalled();
    expect(fixture.client.downloadVersionFiles).not.toHaveBeenCalled();
    expect(fixture.store.publishSyncRun).toHaveBeenCalledOnce();
  });

  it("records a failed staging run without publishing unseen skill changes", async () => {
    const fixture = serviceFixture();
    fixture.client.listSkillPackages.mockResolvedValueOnce({
      items: [skillPackage()],
      nextCursor: null,
    });
    fixture.store.stageSkill.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(fixture.service.syncAll("scheduled")).rejects.toThrow(
      "database unavailable",
    );

    expect(fixture.store.publishSyncRun).not.toHaveBeenCalled();
    expect(fixture.store.failSyncRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      listedCount: 1,
      detailCount: 0,
      errorCode: "clawhub_sync_failed",
      finishedAt: NOW,
    });
  });

  it("fails an empty snapshot publication and preserves the previous catalog", async () => {
    const fixture = serviceFixture();
    fixture.client.listSkillPackages.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    fixture.store.publishSyncRun.mockRejectedValueOnce(
      new Error("clawhub_sync_empty_snapshot"),
    );

    await expect(fixture.service.syncAll("scheduled")).rejects.toThrow(
      "clawhub_sync_empty_snapshot",
    );

    expect(fixture.store.failSyncRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      listedCount: 0,
      detailCount: 0,
      errorCode: "clawhub_empty_snapshot",
      finishedAt: NOW,
    });
  });

  it("keeps an unverified catalog entry installable so install preview can check it live", async () => {
    const fixture = serviceFixture();
    const unverified = catalogRecord({ securityStatus: "unverified" });
    fixture.store.listCatalog.mockResolvedValueOnce({
      items: [unverified],
      nextCursor: null,
      totalCount: 1,
    });

    const page = await fixture.service.listCatalog(actor(), {
      search: "agent",
      sort: "stars",
      limit: 20,
    });

    expect(fixture.store.listCatalog).toHaveBeenCalledWith({
      userId: USER_ID,
      search: "agent",
      sort: "stars",
      limit: 20,
    });
    expect(page.totalCount).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: SKILL_ID,
      owner_handle: OWNER,
      security_status: "unverified",
      installable: true,
      installability_reason: null,
    });
  });

  it("ignores stale catalog manifest results because install preview rechecks them live", async () => {
    const fixture = serviceFixture();
    fixture.store.listCatalog.mockResolvedValueOnce({
      items: [
        catalogRecord({
          securityStatus: "unverified",
          installBlockReason: "manifest_unsafe",
        }),
      ],
      nextCursor: null,
      totalCount: 1,
    });

    const page = await fixture.service.listCatalog(actor(), { limit: 20 });

    expect(fixture.store.listCatalog).toHaveBeenCalledWith({
      userId: USER_ID,
      sort: "downloads",
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      installable: true,
      installability_reason: null,
    });
  });

  it("locks preview to the catalog exact version even when ClawHub latest advances", async () => {
    const fixture = serviceFixture();
    fixture.store.findCatalogSkill.mockResolvedValueOnce(
      catalogRecord({
        securityStatus: "unverified",
        securityHasWarnings: false,
        securityCheckedAt: null,
        fileCount: 0,
        totalFileBytes: 0,
      }),
    );
    fixture.client.getSkillDetail.mockResolvedValueOnce(
      skillDetail({
        moderation: {
          isSuspicious: true,
          isMalwareBlocked: false,
          verdict: "review",
        },
        latestVersion: {
          version: "9.9.9",
          createdAt: NOW.getTime(),
          changelog: "New upstream release",
          license: "MIT",
        },
      }),
    );
    fixture.client.getVersionDetail.mockResolvedValueOnce(
      versionDetail({
        status: "clean",
        hasWarnings: true,
        checkedAt: NOW.getTime(),
      }),
    );

    await expect(
      fixture.service.previewInstall(actor(), SKILL_ID),
    ).resolves.toEqual({ preview_token: "preview" });

    expect(fixture.installPreviewGuardRun).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
    );
    expect(fixture.client.getVersionDetail).toHaveBeenCalledWith({
      ownerHandle: OWNER,
      slug: SLUG,
      version: VERSION,
    });
    expect(fixture.client.downloadVersionFiles).toHaveBeenCalledWith({
      ownerHandle: OWNER,
      slug: SLUG,
      version: VERSION,
      files: versionDetail().version.files,
    });
    expect(
      fixture.capabilityInstaller.previewClawHubInstall,
    ).toHaveBeenCalledWith(actor(), {
      skillId: SKILL_ID,
      ownerHandle: OWNER,
      slug: SLUG,
      version: VERSION,
      securityStatus: "suspicious",
      securityHasWarnings: true,
      canonicalUrl: `https://clawhub.ai/${OWNER}/skills/${SLUG}`,
      files: downloadedVersion().files,
    });
  });

  it.each([
    {
      name: "unverified version",
      detail: skillDetail(),
      version: versionDetail(null),
    },
    {
      name: "malware-blocked moderation",
      detail: skillDetail({
        moderation: {
          isSuspicious: true,
          isMalwareBlocked: true,
          verdict: "malicious",
        },
      }),
      version: versionDetail({ status: "clean", hasWarnings: false }),
    },
  ])("blocks $name before downloading files", async ({ detail, version }) => {
    const fixture = serviceFixture();
    fixture.store.findCatalogSkill.mockResolvedValueOnce(catalogRecord());
    fixture.client.getSkillDetail.mockResolvedValueOnce(detail);
    fixture.client.getVersionDetail.mockResolvedValueOnce(version);

    await expect(
      fixture.service.previewInstall(actor(), SKILL_ID),
    ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });
    expect(fixture.client.downloadVersionFiles).not.toHaveBeenCalled();
    expect(
      fixture.capabilityInstaller.previewClawHubInstall,
    ).not.toHaveBeenCalled();
  });

  it.each([false, undefined])(
    "fails closed when hasScanResult is %s",
    async (hasScanResult) => {
      const fixture = serviceFixture();
      const version = versionDetail();
      if (hasScanResult === undefined) {
        delete version.version.security?.hasScanResult;
      } else if (version.version.security !== null) {
        version.version.security.hasScanResult = hasScanResult;
      }
      fixture.store.findCatalogSkill.mockResolvedValueOnce(catalogRecord());
      fixture.client.getVersionDetail.mockResolvedValueOnce(version);

      await expect(
        fixture.service.previewInstall(actor(), SKILL_ID),
      ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });
      expect(fixture.client.downloadVersionFiles).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the exact version no longer exposes files", async () => {
    const fixture = serviceFixture();
    const version = versionDetail();
    version.version.files = [];
    fixture.store.findCatalogSkill.mockResolvedValueOnce(catalogRecord());
    fixture.client.getVersionDetail.mockResolvedValueOnce(version);

    await expect(
      fixture.service.previewInstall(actor(), SKILL_ID),
    ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });
    expect(fixture.client.downloadVersionFiles).not.toHaveBeenCalled();
  });

  it("revalidates exact-version security before confirming an install", async () => {
    const fixture = serviceFixture();
    const origin = {
      skillId: SKILL_ID,
      ownerHandle: OWNER,
      slug: SLUG,
      version: VERSION,
      securityStatus: "clean" as const,
      securityHasWarnings: true,
      canonicalUrl: `https://clawhub.ai/${OWNER}/skills/${SLUG}`,
    };
    fixture.store.findCatalogSkill.mockResolvedValue(catalogRecord());

    await expect(
      fixture.service.validateInstallConfirmation(actor(), origin),
    ).resolves.toBeUndefined();

    const filesRevokedVersion = versionDetail();
    filesRevokedVersion.version.files = [];
    fixture.client.getVersionDetail.mockResolvedValueOnce(filesRevokedVersion);

    await expect(
      fixture.service.validateInstallConfirmation(actor(), origin),
    ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });

    const scanRevokedVersion = versionDetail();
    if (scanRevokedVersion.version.security !== null) {
      scanRevokedVersion.version.security.hasScanResult = false;
    }
    fixture.client.getVersionDetail.mockResolvedValueOnce(scanRevokedVersion);

    await expect(
      fixture.service.validateInstallConfirmation(actor(), origin),
    ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });
  });

  it("maps exact file integrity failures to the stable API error", async () => {
    const fixture = serviceFixture();
    fixture.store.findCatalogSkill.mockResolvedValueOnce(catalogRecord());
    fixture.client.downloadVersionFiles.mockRejectedValueOnce(
      new ClawHubClientError("INTEGRITY_MISMATCH", "checksum mismatch"),
    );

    await expect(
      fixture.service.previewInstall(actor(), SKILL_ID),
    ).rejects.toMatchObject({ code: "CLAWHUB_PACKAGE_INTEGRITY_FAILED" });
  });
});

function serviceFixture() {
  const store = {
    recoverInterruptedRuns: vi.fn<ClawHubStore["recoverInterruptedRuns"]>(
      async () => 0,
    ),
    createSyncRun: vi.fn<ClawHubStore["createSyncRun"]>(async () => ({
      id: RUN_ID,
      status: "running",
      trigger: "scheduled",
      listedCount: 0,
      detailCount: 0,
      unavailableCount: 0,
      errorCode: null,
      startedAt: NOW,
      finishedAt: null,
    })),
    stageSkill: vi.fn<ClawHubStore["stageSkill"]>(async () => undefined),
    publishSyncRun: vi.fn<ClawHubStore["publishSyncRun"]>(async () => 2),
    failSyncRun: vi.fn<ClawHubStore["failSyncRun"]>(async () => undefined),
    listCatalog: vi.fn<ClawHubStore["listCatalog"]>(async () => ({
      items: [],
      nextCursor: null,
      totalCount: 0,
    })),
    findCatalogSkill: vi.fn<ClawHubStore["findCatalogSkill"]>(
      async () => null,
    ),
  } satisfies ClawHubStore;
  const client = {
    listSkillPackages: vi.fn<ClawHubClientPort["listSkillPackages"]>(
      async () => ({ items: [], nextCursor: null }),
    ),
    getSkillDetail: vi.fn<ClawHubClientPort["getSkillDetail"]>(
      async () => skillDetail(),
    ),
    getVersionDetail: vi.fn<ClawHubClientPort["getVersionDetail"]>(
      async () => versionDetail(),
    ),
    downloadVersionFiles: vi.fn<
      ClawHubClientPort["downloadVersionFiles"]
    >(async () => downloadedVersion()),
  };
  const capabilityInstaller = {
    previewClawHubInstall: vi.fn(async () => ({ preview_token: "preview" })),
  };
  const installPreviewGuardRun = vi.fn(
    (actorId: string, work: () => Promise<unknown>) => ({ actorId, work }),
  );
  const installPreviewGuard: ClawHubInstallPreviewGuard = {
    async run<T>(actorId: string, work: () => Promise<T>): Promise<T> {
      installPreviewGuardRun(actorId, work);
      return work();
    },
  };
  const service = new ClawHubService({
    store,
    client,
    capabilityInstaller,
    installPreviewGuard,
    now: () => NOW,
  });
  return {
    service,
    store,
    client,
    capabilityInstaller,
    installPreviewGuardRun,
  };
}

function actor(overrides: Partial<RequestActor> = {}): RequestActor {
  return { id: USER_ID, role: "user", status: "active", ...overrides };
}

function skillPackage(
  overrides: Partial<ClawHubSkillPackage> = {},
): ClawHubSkillPackage {
  return {
    upstreamSkillId: "upstream-skill",
    ownerHandle: OWNER,
    slug: SLUG,
    displayName: "Useful Agent",
    summary: "Useful skill",
    latestVersion: VERSION,
    categories: ["agents"],
    topics: ["productivity"],
    channel: "community",
    isOfficial: false,
    verificationTier: "source-linked",
    stats: { comments: 2, downloads: 100, installs: 20, stars: 10, versions: 3 },
    createdAt: NOW.getTime(),
    updatedAt: NOW.getTime(),
    canonicalUrl: `https://clawhub.ai/${OWNER}/skills/${SLUG}`,
    ...overrides,
  };
}

function skillDetail(
  overrides: Partial<ClawHubSkillDetail> = {},
): ClawHubSkillDetail {
  return {
    upstreamSkillId: "upstream-skill",
    slug: SLUG,
    requestedSlug: SLUG,
    displayName: "Useful Agent",
    summary: "Useful skill",
    description: "Full description",
    icon: "lucide:box",
    topics: ["productivity"],
    tags: { latest: VERSION },
    stats: { comments: 2, downloads: 100, installs: 20, stars: 10, versions: 3 },
    createdAt: NOW.getTime(),
    updatedAt: NOW.getTime(),
    latestVersion: {
      version: VERSION,
      createdAt: NOW.getTime(),
      changelog: "Improved",
      license: "MIT",
    },
    metadata: { os: ["darwin"], systems: null },
    owner: {
      handle: OWNER,
      userId: "upstream-user",
      displayName: "Alice",
      image: "https://example.com/alice.png",
    },
    moderation: null,
    canonicalUrl: `https://clawhub.ai/${OWNER}/skills/${SLUG}`,
    ...overrides,
  };
}

function versionDetail(
  security:
    | ClawHubVersionDetail["version"]["security"]
    | undefined = {
    status: "clean",
    hasWarnings: true,
    hasScanResult: true,
    checkedAt: NOW.getTime(),
  },
): ClawHubVersionDetail {
  return {
    ownerHandle: OWNER,
    upstreamSkillId: "upstream-skill",
    skill: { slug: SLUG, displayName: "Useful Agent" },
    version: {
      upstreamVersionId: "upstream-version",
      version: VERSION,
      createdAt: NOW.getTime(),
      changelog: "Improved",
      changelogSource: "user",
      license: "MIT",
      files: [
        {
          path: "SKILL.md",
          size: 15,
          sha256: "a".repeat(64),
          contentType: "text/markdown",
        },
      ],
      security:
        security === null
          ? null
          : { hasScanResult: true, ...(security ?? {}) },
    },
  };
}

function downloadedVersion(): ClawHubDownloadedVersion {
  return {
    ownerHandle: OWNER,
    slug: SLUG,
    version: VERSION,
    files: [
      {
        ...versionDetail().version.files[0]!,
        bytes: Buffer.from("# Useful Agent"),
        responseContentType: "text/markdown",
      },
    ],
  };
}

function catalogRecord(
  skillOverrides: Partial<ClawHubCatalogRecord["skill"]> = {},
): ClawHubCatalogRecord {
  return {
    skill: {
      id: SKILL_ID,
      ownerHandle: OWNER,
      slug: SLUG,
      displayName: "Useful Agent",
      summary: "Useful skill",
      topics: ["productivity"],
      tags: { latest: VERSION },
      downloadCount: 100,
      installCount: 20,
      starCount: 10,
      commentCount: 2,
      versionCount: 3,
      latestVersion: VERSION,
      latestVersionCreatedAt: NOW,
      latestVersionChangelog: "Improved",
      latestVersionLicense: "MIT",
      ownerDisplayName: "Alice",
      ownerImageUrl: "https://example.com/alice.png",
      metadata: { os: ["darwin"], systems: null },
      sourceMetadata: { package: skillPackage() },
      moderationVerdict: null,
      moderationReasonCodes: [],
      moderationSummary: null,
      moderationEngineVersion: null,
      moderationUpdatedAt: null,
      isSuspicious: false,
      isMalwareBlocked: false,
      securityStatus: "clean",
      securityHasWarnings: true,
      securityCheckedAt: NOW,
      fileCount: 1,
      totalFileBytes: 15,
      installBlockReason: null,
      canonicalUrl: `https://clawhub.ai/${OWNER}/skills/${SLUG}`,
      searchText: "useful agent alice productivity",
      sourceCreatedAt: NOW,
      sourceUpdatedAt: NOW,
      available: true,
      unavailableAt: null,
      lastSeenSyncRunId: RUN_ID,
      lastSeenAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      ...skillOverrides,
    },
    installation: null,
  };
}
