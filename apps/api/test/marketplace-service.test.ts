import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import type { CapabilityView } from "../src/modules/capabilities/service.js";
import type {
  CapabilityRecord,
  CapabilityRiskSummary,
  RequestActor,
} from "../src/modules/capabilities/types.js";
import {
  assertMarketplacePackageIntegrity,
  hashMarketplacePackage,
} from "../src/modules/marketplace/package.js";
import {
  adminMarketplaceRoutes,
  marketplaceRoutes,
} from "../src/modules/marketplace/routes.js";
import { MarketplaceService } from "../src/modules/marketplace/service.js";
import type {
  CreateMarketplaceListingInput,
  CreateMarketplaceReleaseInput,
  MarketplaceAuditInput,
  MarketplaceCapabilityInstaller,
  MarketplaceListingRecord,
  MarketplaceListingStatus,
  MarketplaceReleaseRecord,
  MarketplaceReleaseStatus,
  MarketplaceStore,
} from "../src/modules/marketplace/types.js";

const PUBLISHER_ID = "10000000-0000-4000-8000-000000000001";
const REVIEWER_ID = "10000000-0000-4000-8000-000000000002";
const INSTALLER_ID = "10000000-0000-4000-8000-000000000003";
const OTHER_INSTALLER_ID = "10000000-0000-4000-8000-000000000004";
const SOURCE_CAPABILITY_ID = "20000000-0000-4000-8000-000000000001";
const FIXED_DATE = new Date("2026-07-25T08:00:00.000Z");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("MarketplaceService", () => {
  it.each([null, "团队报告助手"])(
    "preserves display name %s through publication, search, installation and update",
    async (displayName) => {
      const root = await createCapabilityRoot();
      const source = { ...sourceCapability(root), displayName };
      const store = new MemoryMarketplaceStore([source]);
      const installer = new MemoryMarketplaceInstaller(store);
      const service = createService(store, installer, root);
      const submission = await service.submit(publisherActor(), {
        capabilityId: source.id,
      });
      expect(submission.latest_release).toMatchObject({
        name: "team-reports",
        display_name: displayName,
      });
      await service.review(reviewerActor(), submission.latest_release.id, {
        decision: "approved",
      });
      source.displayName = "新报告助手";
      for (const search of ["team-reports", displayName || "Team Reports"]) {
        const catalog = await service.listCatalog(installerActor(), { search });
        expect(catalog).toHaveLength(1);
        expect(catalog[0]?.release.display_name).toBe(displayName);
      }
      expect(
        await service.listCatalog(installerActor(), { search: "新报告助手" }),
      ).toEqual([]);
      const installed = await service.install(
        installerActor(),
        submission.listing.id,
      );
      expect(installed).toMatchObject({
        name: "team-reports",
        display_name: displayName,
      });
      expect(installer.install).toHaveBeenCalledWith(
        installerActor(),
        expect.objectContaining({ name: "team-reports", displayName }),
      );

      const update = await service.submit(publisherActor(), {
        capabilityId: source.id,
        listingId: submission.listing.id,
      });
      await service.review(reviewerActor(), update.latest_release.id, {
        decision: "approved",
      });
      const updated = await service.updateInstallation(
        installerActor(),
        submission.listing.id,
      );
      expect(updated).toMatchObject({
        name: "team-reports",
        display_name: "新报告助手",
      });
      expect(store.releases[0]?.displayName).toBe(displayName);
    },
  );

  it("blocks organization marketplace access for self-registered users", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const service = createService(
      store,
      new MemoryMarketplaceInstaller(store),
      root,
    );
    const actor: RequestActor = {
      ...publisherActor(),
      registrationSource: "self_registration",
    };

    await expect(service.listCatalog(actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(service.listOwnPublications(actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.submit(actor, { capabilityId: source.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.install(actor, "90000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("publishes immutable reviewed releases and requires explicit install and update", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const installer = new MemoryMarketplaceInstaller(store);
    const service = createService(store, installer, root);

    const firstSubmission = await service.submit(publisherActor(), {
      capabilityId: source.id,
      releaseNotes: "Initial release",
    });
    const listingId = firstSubmission.listing.id;
    const firstReleaseId = firstSubmission.latest_release.id;

    expect(firstSubmission.listing.status).toBe("draft");
    expect(firstSubmission.latest_release.status).toBe("pending");
    expect(await service.listCatalog(installerActor())).toEqual([]);
    await expect(
      service.review(publisherActor(), firstReleaseId, {
        decision: "approved",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await writeFile(
      join(source.storagePath, "SKILL.md"),
      skillMarkdown("team-reports", "Changed after submission"),
    );
    const reviewDetail = await service.getReviewDetail(
      reviewerActor(),
      firstReleaseId,
    );
    expect(reviewDetail.skill_content).toContain("Initial instructions");
    expect(reviewDetail.skill_content).not.toContain(
      "Changed after submission",
    );

    const approved = await service.review(
      publisherAdminActor(),
      firstReleaseId,
      {
        decision: "approved",
        comment: "Self-reviewed by administrator",
      },
    );
    expect(approved.listing.status).toBe("published");
    expect(approved.current_release?.id).toBe(firstReleaseId);
    expect(approved.current_release?.reviewer_id).toBe(PUBLISHER_ID);
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        actorId: PUBLISHER_ID,
        action: "marketplace_release_reviewed",
        targetId: firstReleaseId,
      }),
    );
    await expect(service.listAllPublications(reviewerActor())).resolves.toEqual(
      [
        expect.objectContaining({
          listing: expect.objectContaining({ id: listingId }),
          current_release: expect.objectContaining({ id: firstReleaseId }),
        }),
      ],
    );
    await expect(
      service.listAllPublications(publisherActor()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const catalogBeforeInstall = await service.listCatalog(installerActor());
    expect(catalogBeforeInstall).toEqual([
      expect.objectContaining({
        installed_capability_id: null,
        update_available: false,
        release: expect.objectContaining({ id: firstReleaseId }),
      }),
    ]);

    const installed = await service.install(installerActor(), listingId);
    expect(installed.source_type).toBe("marketplace");
    expect(installed.marketplace_release_id).toBe(firstReleaseId);
    expect(installer.install).toHaveBeenCalledTimes(1);
    expect(
      (await service.listCatalog(installerActor()))[0]?.install_count,
    ).toBe(1);
    await expect(
      service.install(installerActor(), listingId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.listInstallations(otherInstallerActor()),
    ).resolves.toEqual([]);
    await expect(service.listInstallations(installerActor())).resolves.toEqual([
      expect.objectContaining({
        installed_capability_id: installed.id,
        installed_release_id: firstReleaseId,
        update_available: false,
      }),
    ]);

    const secondSubmission = await service.submit(publisherActor(), {
      capabilityId: source.id,
      listingId,
      releaseNotes: "Updated instructions",
    });
    expect(secondSubmission.latest_release.release_number).toBe(2);
    expect(secondSubmission.latest_release.status).toBe("pending");
    await service.review(reviewerActor(), secondSubmission.latest_release.id, {
      decision: "approved",
    });

    const catalogWithUpdate = await service.listCatalog(installerActor());
    expect(catalogWithUpdate[0]).toMatchObject({
      installed_capability_id: installed.id,
      installed_release_id: firstReleaseId,
      update_available: true,
    });
    await expect(service.listInstallations(installerActor())).resolves.toEqual([
      expect.objectContaining({
        installed_capability_id: installed.id,
        installed_release_id: firstReleaseId,
        update_available: true,
      }),
    ]);
    const updated = await service.updateInstallation(
      installerActor(),
      listingId,
    );
    expect(updated.marketplace_release_id).toBe(
      secondSubmission.latest_release.id,
    );
    expect(installer.update).toHaveBeenCalledTimes(1);
    expect(
      (await service.listCatalog(installerActor()))[0]?.install_count,
    ).toBe(1);
    await expect(service.listInstallations(installerActor())).resolves.toEqual([
      expect.objectContaining({
        installed_capability_id: installed.id,
        installed_release_id: secondSubmission.latest_release.id,
        update_available: false,
      }),
    ]);

    store.capabilities.splice(
      store.capabilities.findIndex((item) => item.id === installed.id),
      1,
    );
    await expect(service.listCatalog(installerActor())).resolves.toEqual([
      expect.objectContaining({
        installed_capability_id: null,
        install_count: 1,
      }),
    ]);

    const reinstalled = await service.install(installerActor(), listingId);
    expect(reinstalled.id).toBe(installed.id);
    expect(
      (await service.listCatalog(installerActor()))[0]?.install_count,
    ).toBe(2);

    await service.setPublisherListingStatus(
      publisherActor(),
      listingId,
      "unlisted",
    );
    expect(await service.listCatalog(installerActor())).toEqual([]);
    await expect(
      service.getCatalogItem(installerActor(), listingId),
    ).resolves.toMatchObject({
      listing: { status: "unlisted" },
      installed_capability_id: installed.id,
    });
    await expect(service.listInstallations(installerActor())).resolves.toEqual([
      expect.objectContaining({
        listing: expect.objectContaining({ status: "unlisted" }),
        installed_capability_id: installed.id,
        update_available: false,
      }),
    ]);
  });

  it("allows an administrator publisher to reject their own submission and still requires a comment", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const installer = new MemoryMarketplaceInstaller(store);
    const service = createService(store, installer, root);

    const submission = await service.submit(publisherActor(), {
      capabilityId: source.id,
    });
    await expect(
      service.review(publisherAdminActor(), submission.latest_release.id, {
        decision: "rejected",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const rejected = await service.review(
      publisherAdminActor(),
      submission.latest_release.id,
      {
        decision: "rejected",
        comment: "The package needs changes",
      },
    );
    expect(rejected.latest_release).toMatchObject({
      status: "rejected",
      reviewer_id: PUBLISHER_ID,
      review_comment: "The package needs changes",
    });
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        actorId: PUBLISHER_ID,
        action: "marketplace_release_reviewed",
        targetId: submission.latest_release.id,
      }),
    );
  });

  it("detects package tampering before review", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const installer = new MemoryMarketplaceInstaller(store);
    const service = createService(store, installer, root);

    const submission = await service.submit(publisherActor(), {
      capabilityId: source.id,
    });
    const release = store.releases[0];
    if (release === undefined) throw new Error("missing release");
    await writeFile(join(release.packagePath, "SKILL.md"), "tampered");
    await expect(
      service.review(publisherAdminActor(), submission.latest_release.id, {
        decision: "approved",
      }),
    ).rejects.toMatchObject({
      code: "MARKETPLACE_RELEASE_INTEGRITY_FAILED",
    });
  });

  it("rejects duplicate slugs and pending releases, then allows a new release after withdrawal", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const service = createService(
      store,
      new MemoryMarketplaceInstaller(store),
      root,
    );

    const first = await service.submit(publisherActor(), {
      capabilityId: source.id,
    });
    await expect(
      service.submit(publisherActor(), { capabilityId: source.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.submit(publisherActor(), {
        capabilityId: source.id,
        listingId: first.listing.id,
      }),
    ).rejects.toMatchObject({
      code: "MARKETPLACE_RELEASE_PENDING_CONFLICT",
    });

    await expect(
      service.withdraw(publisherActor(), first.latest_release.id),
    ).resolves.toMatchObject({ status: "withdrawn" });
    const second = await service.submit(publisherActor(), {
      capabilityId: source.id,
      listingId: first.listing.id,
    });
    expect(second.latest_release).toMatchObject({
      release_number: 2,
      status: "pending",
    });
    await expect(
      service.withdraw(publisherActor(), first.latest_release.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("only publishes active local or URL capabilities owned by the submitter", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const foreign = {
      ...source,
      id: "20000000-0000-4000-8000-000000000002",
      ownerId: INSTALLER_ID,
    };
    const marketplaceSource = {
      ...source,
      id: "20000000-0000-4000-8000-000000000003",
      sourceType: "marketplace" as const,
      marketplaceListingId: "30000000-0000-4000-8000-000000000010",
      marketplaceReleaseId: "30000000-0000-4000-8000-000000000011",
    };
    const inactive = {
      ...source,
      id: "20000000-0000-4000-8000-000000000004",
      status: "disabled" as const,
    };
    const clawHubSource = {
      ...source,
      id: "20000000-0000-4000-8000-000000000005",
      sourceType: "clawhub" as const,
    };
    const store = new MemoryMarketplaceStore([
      source,
      foreign,
      marketplaceSource,
      inactive,
      clawHubSource,
    ]);
    const service = createService(
      store,
      new MemoryMarketplaceInstaller(store),
      root,
    );

    for (const capability of [
      foreign,
      marketplaceSource,
      inactive,
      clawHubSource,
    ]) {
      await expect(
        service.submit(publisherActor(), {
          capabilityId: capability.id,
        }),
      ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    }
    expect(store.listings).toEqual([]);
    expect(store.releases).toEqual([]);
  });

  it("distinguishes publisher unlisting from administrator suspension", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const installer = new MemoryMarketplaceInstaller(store);
    const service = createService(store, installer, root);
    const submission = await service.submit(publisherActor(), {
      capabilityId: source.id,
    });
    const listingId = submission.listing.id;
    await service.review(reviewerActor(), submission.latest_release.id, {
      decision: "approved",
    });
    await service.install(installerActor(), listingId);

    await service.suspend(
      reviewerActor(),
      listingId,
      "Unsafe external connection",
    );
    await expect(
      service.install(otherInstallerActor(), listingId),
    ).rejects.toMatchObject({ code: "MARKETPLACE_LISTING_SUSPENDED" });
    await expect(
      service.updateInstallation(installerActor(), listingId),
    ).rejects.toMatchObject({ code: "MARKETPLACE_LISTING_SUSPENDED" });
    await expect(
      service.setPublisherListingStatus(
        publisherActor(),
        listingId,
        "published",
      ),
    ).rejects.toMatchObject({ code: "MARKETPLACE_LISTING_SUSPENDED" });
    await expect(
      service.suspend(reviewerActor(), listingId, "Repeated suspension"),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const resumed = await service.resume(reviewerActor(), listingId);
    expect(resumed.status).toBe("published");
    expect(resumed.suspension_reason).toBeNull();
  });
});

describe("marketplace package integrity", () => {
  it("uses deterministic hashes and rejects modified content", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-marketplace-hash-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "SKILL.md"), "# Stable");
    const hash = await hashMarketplacePackage(root);

    await expect(
      assertMarketplacePackageIntegrity(root, hash),
    ).resolves.toBeUndefined();
    await writeFile(join(root, "SKILL.md"), "# Modified");
    await expect(
      assertMarketplacePackageIntegrity(root, hash),
    ).rejects.toMatchObject({
      code: "MARKETPLACE_RELEASE_INTEGRITY_FAILED",
    });
  });

  it("includes executable bits in the hash and rejects symbolic links", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-marketplace-mode-"));
    temporaryDirectories.push(root);
    const scriptPath = join(root, "run.sh");
    await writeFile(scriptPath, "#!/bin/sh\n");
    await chmod(scriptPath, 0o644);
    const nonExecutableHash = await hashMarketplacePackage(root);
    await chmod(scriptPath, 0o755);
    expect(await hashMarketplacePackage(root)).not.toBe(nonExecutableHash);

    await symlink(scriptPath, join(root, "run-link.sh"));
    await expect(hashMarketplacePackage(root)).rejects.toMatchObject({
      code: "MARKETPLACE_RELEASE_INTEGRITY_FAILED",
    });
  });
});

describe("marketplace routes", () => {
  it("connects submission, immutable review, catalog, and explicit install endpoints", async () => {
    const root = await createCapabilityRoot();
    const source = sourceCapability(root);
    const store = new MemoryMarketplaceStore([source]);
    const installer = new MemoryMarketplaceInstaller(store);
    const service = createService(store, installer, root);
    const publisherApp = Fastify();
    const reviewerApp = Fastify();
    const installerApp = Fastify();
    for (const app of [publisherApp, reviewerApp, installerApp]) {
      app.setErrorHandler((error, request, reply) =>
        sendAppError(reply, request, error),
      );
    }
    await publisherApp.register(marketplaceRoutes, {
      prefix: "/api/v1/marketplace",
      service,
      resolveActor: () => publisherAdminActor(),
    });
    await publisherApp.register(adminMarketplaceRoutes, {
      prefix: "/api/v1/admin/marketplace",
      service,
      resolveActor: () => publisherAdminActor(),
    });
    await reviewerApp.register(adminMarketplaceRoutes, {
      prefix: "/api/v1/admin/marketplace",
      service,
      resolveActor: () => reviewerActor(),
    });
    await installerApp.register(marketplaceRoutes, {
      prefix: "/api/v1/marketplace",
      service,
      resolveActor: () => installerActor(),
    });

    const submissionResponse = await publisherApp.inject({
      method: "POST",
      url: "/api/v1/marketplace/submissions",
      payload: {
        capability_id: SOURCE_CAPABILITY_ID,
        release_notes: "Reviewed through the route",
      },
    });
    expect(submissionResponse.statusCode).toBe(202);
    const submission = submissionResponse.json() as {
      data: {
        listing: { id: string; status: string };
        latest_release: { id: string; status: string };
      };
    };
    expect(submission.data).toMatchObject({
      listing: { status: "draft" },
      latest_release: { status: "pending" },
    });

    const reviewQueueResponse = await reviewerApp.inject({
      method: "GET",
      url: "/api/v1/admin/marketplace/reviews",
    });
    expect(reviewQueueResponse.statusCode).toBe(200);
    expect(reviewQueueResponse.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            listing: { id: submission.data.listing.id },
            latest_release: { id: submission.data.latest_release.id },
          },
        ],
      },
    });

    const detailResponse = await reviewerApp.inject({
      method: "GET",
      url:
        "/api/v1/admin/marketplace/releases/" +
        submission.data.latest_release.id,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      success: true,
      data: {
        files: ["SKILL.md"],
        skill_content: expect.stringContaining("Initial instructions"),
      },
    });

    const approvalResponse = await publisherApp.inject({
      method: "PATCH",
      url:
        "/api/v1/admin/marketplace/releases/" +
        submission.data.latest_release.id +
        "/review",
      payload: { decision: "approved", review_comment: "Safe to publish" },
    });
    expect(approvalResponse.statusCode).toBe(200);
    expect(approvalResponse.json()).toMatchObject({
      success: true,
      data: {
        listing: { status: "published" },
        current_release: {
          id: submission.data.latest_release.id,
          reviewer_id: PUBLISHER_ID,
        },
      },
    });

    const catalogResponse = await installerApp.inject({
      method: "GET",
      url: "/api/v1/marketplace?type=skill&search=team",
    });
    expect(catalogResponse.statusCode).toBe(200);
    expect(catalogResponse.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            listing: { id: submission.data.listing.id },
            installed_capability_id: null,
          },
        ],
      },
    });

    const installResponse = await installerApp.inject({
      method: "POST",
      url: "/api/v1/marketplace/" + submission.data.listing.id + "/install",
    });
    expect(installResponse.statusCode).toBe(201);
    expect(installResponse.json()).toMatchObject({
      success: true,
      data: {
        source_type: "marketplace",
        marketplace_listing_id: submission.data.listing.id,
        marketplace_release_id: submission.data.latest_release.id,
      },
    });

    const installationsResponse = await installerApp.inject({
      method: "GET",
      url: "/api/v1/marketplace/installations",
    });
    expect(installationsResponse.statusCode).toBe(200);
    expect(installationsResponse.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            listing: { id: submission.data.listing.id },
            installed_capability_id: expect.any(String),
            installed_release_id: submission.data.latest_release.id,
            update_available: false,
          },
        ],
      },
    });

    const allListingsResponse = await reviewerApp.inject({
      method: "GET",
      url: "/api/v1/admin/marketplace/listings",
    });
    expect(allListingsResponse.statusCode).toBe(200);
    expect(allListingsResponse.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            listing: { id: submission.data.listing.id },
            install_count: 1,
          },
        ],
      },
    });

    await Promise.all([
      publisherApp.close(),
      reviewerApp.close(),
      installerApp.close(),
    ]);
  });
});

function createService(
  store: MarketplaceStore,
  installer: MarketplaceCapabilityInstaller,
  capabilityRoot: string,
): MarketplaceService {
  return new MarketplaceService({
    store,
    capabilityInstaller: installer,
    capabilityRoot,
    logoStore: {
      async read() {
        throw new Error("no logo expected");
      },
      async put() {
        throw new Error("no logo expected");
      },
      async remove() {},
      async presignGet() {
        throw new Error("no logo expected");
      },
    },
    now: () => FIXED_DATE,
  });
}

async function createCapabilityRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "linksense-marketplace-service-"));
  temporaryDirectories.push(root);
  const sourcePath = join(root, SOURCE_CAPABILITY_ID, "current");
  await mkdir(sourcePath, { recursive: true });
  await writeFile(
    join(sourcePath, "SKILL.md"),
    skillMarkdown("team-reports", "Initial instructions"),
  );
  return root;
}

function skillMarkdown(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Team reporting\n---\n\n# ${body}\n`;
}

function sourceCapability(root: string): CapabilityRecord {
  return {
    id: SOURCE_CAPABILITY_ID,
    type: "skill",
    ownerId: PUBLISHER_ID,
    name: "team-reports",
    slug: "team-reports",
    description: "Team reporting",
    sourceType: "local",
    marketplaceListingId: null,
    marketplaceReleaseId: null,
    logoObjectKey: null,
    storagePath: join(root, SOURCE_CAPABILITY_ID, "current"),
    manifestJson: {
      name: "team-reports",
      description: "Team reporting",
      format: "SKILL.md",
    },
    riskSummaryJson: { ...riskSummary() },
    status: "active",
    installedBy: PUBLISHER_ID,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
}

function installedCapability(
  actorId: string,
  id: string,
  input: Parameters<
    MarketplaceCapabilityInstaller["installMarketplaceRelease"]
  >[1],
): CapabilityRecord {
  return {
    id,
    type: input.type,
    ownerId: actorId,
    name: input.name,
    displayName: input.displayName ?? null,
    slug: input.name,
    description: input.description,
    sourceType: "marketplace",
    marketplaceListingId: input.listingId,
    marketplaceReleaseId: input.releaseId,
    logoObjectKey: null,
    storagePath: input.packageRoot,
    manifestJson: input.manifest,
    riskSummaryJson: { ...input.riskSummary },
    status: "active",
    installedBy: actorId,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
}

function capabilityView(capability: CapabilityRecord): CapabilityView {
  return {
    id: capability.id,
    type: capability.type,
    name: capability.name,
    display_name: capability.displayName ?? null,
    slug: capability.slug,
    description: capability.description,
    source_type: capability.sourceType,
    builtin_key: null,
    is_builtin: false,
    marketplace_listing_id: capability.marketplaceListingId,
    marketplace_release_id: capability.marketplaceReleaseId,
    status: capability.status,
    has_logo: false,
    logo_url: null,
    manifest: capability.manifestJson,
    risk_summary: capability.riskSummaryJson,
    preference_status: "enabled",
    can_manage: true,
    can_govern: false,
    can_select: true,
    can_delete: true,
    is_owner: true,
    created_at: capability.createdAt.toISOString(),
    updated_at: capability.updatedAt.toISOString(),
  };
}

function riskSummary(): CapabilityRiskSummary {
  return {
    contains_mcp_server: false,
    contains_scripts: false,
    contains_external_connections: false,
    requires_environment_variables: false,
    requires_credentials: false,
    contains_dependency_download_commands: false,
    declared_environment_keys: [],
    mcp_environment_references: [],
    dependency_commands: [],
  };
}

function publisherActor(): RequestActor {
  return { id: PUBLISHER_ID, role: "user", status: "active" };
}

function publisherAdminActor(): RequestActor {
  return { id: PUBLISHER_ID, role: "admin", status: "active" };
}

function reviewerActor(): RequestActor {
  return { id: REVIEWER_ID, role: "admin", status: "active" };
}

function installerActor(): RequestActor {
  return { id: INSTALLER_ID, role: "user", status: "active" };
}

function otherInstallerActor(): RequestActor {
  return { id: OTHER_INSTALLER_ID, role: "user", status: "active" };
}

class MemoryMarketplaceInstaller implements MarketplaceCapabilityInstaller {
  readonly install = vi.fn(
    async (
      actor: RequestActor,
      input: Parameters<
        MarketplaceCapabilityInstaller["installMarketplaceRelease"]
      >[1],
    ) => {
      const capability = installedCapability(
        actor.id,
        "30000000-0000-4000-8000-000000000001",
        input,
      );
      this.store.capabilities.push(capability);
      const listing = this.store.listings.find(
        (item) => item.id === input.listingId,
      );
      if (listing === undefined) throw new Error("missing listing");
      listing.installCount += 1;
      return capabilityView(capability);
    },
  );

  readonly update = vi.fn(
    async (
      actor: RequestActor,
      capabilityId: string,
      input: Parameters<
        MarketplaceCapabilityInstaller["updateMarketplaceRelease"]
      >[2],
    ) => {
      const index = this.store.capabilities.findIndex(
        (capability) =>
          capability.id === capabilityId && capability.ownerId === actor.id,
      );
      if (index < 0) throw new Error("missing installation");
      const capability = installedCapability(actor.id, capabilityId, input);
      this.store.capabilities[index] = capability;
      return capabilityView(capability);
    },
  );

  constructor(private readonly store: MemoryMarketplaceStore) {}

  installMarketplaceRelease(
    actor: RequestActor,
    input: Parameters<
      MarketplaceCapabilityInstaller["installMarketplaceRelease"]
    >[1],
  ): Promise<CapabilityView> {
    return this.install(actor, input);
  }

  updateMarketplaceRelease(
    actor: RequestActor,
    capabilityId: string,
    input: Parameters<
      MarketplaceCapabilityInstaller["updateMarketplaceRelease"]
    >[2],
  ): Promise<CapabilityView> {
    return this.update(actor, capabilityId, input);
  }
}

class MemoryMarketplaceStore implements MarketplaceStore {
  readonly listings: MarketplaceListingRecord[] = [];
  readonly releases: MarketplaceReleaseRecord[] = [];
  readonly audits: MarketplaceAuditInput[] = [];

  constructor(readonly capabilities: CapabilityRecord[]) {}

  transaction<T>(work: (store: MarketplaceStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  async lockListing(): Promise<void> {}

  async lockSlugRegistry(): Promise<void> {}

  async findCapability(id: string): Promise<CapabilityRecord | null> {
    return this.capabilities.find((capability) => capability.id === id) ?? null;
  }

  async listCapabilitiesByOwner(userId: string): Promise<CapabilityRecord[]> {
    return this.capabilities.filter(
      (capability) => capability.ownerId === userId,
    );
  }

  async findListing(id: string): Promise<MarketplaceListingRecord | null> {
    return this.listings.find((listing) => listing.id === id) ?? null;
  }

  async findListingBySlug(
    type: "plugin" | "skill",
    slug: string,
  ): Promise<MarketplaceListingRecord | null> {
    return (
      this.listings.find(
        (listing) => listing.type === type && listing.slug === slug,
      ) ?? null
    );
  }

  async listListings(input?: {
    publisherId?: string;
    status?: MarketplaceListingStatus;
  }): Promise<MarketplaceListingRecord[]> {
    return this.listings.filter(
      (listing) =>
        (input?.publisherId === undefined ||
          listing.publisherId === input.publisherId) &&
        (input?.status === undefined || listing.status === input.status),
    );
  }

  async createListing(
    input: CreateMarketplaceListingInput,
  ): Promise<MarketplaceListingRecord> {
    const listing: MarketplaceListingRecord = {
      ...input,
      status: "draft",
      installCount: 0,
      currentReleaseId: null,
      suspendedBy: null,
      suspendedAt: null,
      suspensionReason: null,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    };
    this.listings.push(listing);
    return listing;
  }

  async updateListing(
    id: string,
    input: Partial<
      Pick<
        MarketplaceListingRecord,
        | "status"
        | "currentReleaseId"
        | "suspendedBy"
        | "suspendedAt"
        | "suspensionReason"
      >
    >,
  ): Promise<MarketplaceListingRecord> {
    const listing = await this.findListing(id);
    if (listing === null) throw new Error("missing listing");
    Object.assign(listing, input, { updatedAt: FIXED_DATE });
    return listing;
  }

  async findRelease(id: string): Promise<MarketplaceReleaseRecord | null> {
    return this.releases.find((release) => release.id === id) ?? null;
  }

  async listReleases(input?: {
    listingId?: string;
    status?: MarketplaceReleaseStatus;
  }): Promise<MarketplaceReleaseRecord[]> {
    return this.releases
      .filter(
        (release) =>
          (input?.listingId === undefined ||
            release.listingId === input.listingId) &&
          (input?.status === undefined || release.status === input.status),
      )
      .sort((left, right) => right.releaseNumber - left.releaseNumber);
  }

  async nextReleaseNumber(listingId: string): Promise<number> {
    return (
      Math.max(
        0,
        ...this.releases
          .filter((release) => release.listingId === listingId)
          .map((release) => release.releaseNumber),
      ) + 1
    );
  }

  async createRelease(
    input: CreateMarketplaceReleaseInput,
  ): Promise<MarketplaceReleaseRecord> {
    const release: MarketplaceReleaseRecord = {
      ...input,
      status: "pending",
      reviewerId: null,
      reviewComment: null,
      submittedAt: FIXED_DATE,
      reviewedAt: null,
      publishedAt: null,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    };
    this.releases.push(release);
    return release;
  }

  async updateRelease(
    id: string,
    input: Partial<
      Pick<
        MarketplaceReleaseRecord,
        "status" | "reviewerId" | "reviewComment" | "reviewedAt" | "publishedAt"
      >
    >,
  ): Promise<MarketplaceReleaseRecord> {
    const release = await this.findRelease(id);
    if (release === null) throw new Error("missing release");
    Object.assign(release, input, { updatedAt: FIXED_DATE });
    return release;
  }

  async getUserNames(userIds: string[]): Promise<Map<string, string>> {
    return new Map(
      userIds.map((userId) => [
        userId,
        userId === PUBLISHER_ID ? "Publisher" : "User",
      ]),
    );
  }

  async getInstallCountsByListingIds(
    listingIds: string[],
  ): Promise<Map<string, number>> {
    return new Map(
      listingIds.flatMap((listingId) => {
        const listing = this.listings.find((item) => item.id === listingId);
        return listing === undefined
          ? []
          : ([[listingId, listing.installCount]] as const);
      }),
    );
  }

  async writeAudit(input: MarketplaceAuditInput): Promise<void> {
    this.audits.push(input);
  }
}
