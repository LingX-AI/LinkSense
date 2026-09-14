import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { capabilityDisplayName } from "@linksense/shared";

import { capabilityMcpEnvironmentReferenceSchema } from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js";
import {
  capabilityDirectory,
  slugifyCapabilityName,
  stageAtomicDirectoryReplacement,
} from "../capabilities/importer.js";
import {
  assertCapabilitySupplyChainApproval,
  scanCapabilitySupplyChain,
} from "../capabilities/supply-chain-scanner.js";
import { stripSkillFrontmatter } from "../capabilities/preview.js";
import type { CapabilityView } from "../capabilities/service.js";
import type {
  CapabilityRecord,
  PreparedLogo,
  RequestActor,
} from "../capabilities/types.js";

import {
  assertMarketplacePackageIntegrity,
  hashMarketplacePackage,
  listMarketplacePackageFiles,
} from "./package.js";
import type {
  MarketplaceCapabilityInstaller,
  MarketplaceCatalogItemView,
  MarketplaceListingRecord,
  MarketplaceListingView,
  MarketplaceLogoStore,
  MarketplacePublicationView,
  MarketplaceReleaseRecord,
  MarketplaceReleaseView,
  MarketplaceReviewDetailView,
  MarketplaceStore,
} from "./types.js";

export interface MarketplaceServiceOptions {
  store: MarketplaceStore;
  capabilityInstaller: MarketplaceCapabilityInstaller;
  capabilityRoot: string;
  logoStore: MarketplaceLogoStore;
  now?: () => Date;
}

export class MarketplaceService {
  readonly #store: MarketplaceStore;
  readonly #capabilityInstaller: MarketplaceCapabilityInstaller;
  readonly #capabilityRoot: string;
  readonly #logoStore: MarketplaceLogoStore;
  readonly #now: () => Date;

  constructor(options: MarketplaceServiceOptions) {
    this.#store = options.store;
    this.#capabilityInstaller = options.capabilityInstaller;
    this.#capabilityRoot = resolve(options.capabilityRoot);
    this.#logoStore = options.logoStore;
    this.#now = options.now ?? (() => new Date());
  }

  async listCatalog(
    actor: RequestActor,
    input: {
      type?: "plugin" | "skill";
      search?: string;
    } = {},
  ): Promise<MarketplaceCatalogItemView[]> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const listings = (
      await this.#store.listListings({ status: "published" })
    ).filter(
      (listing) => input.type === undefined || listing.type === input.type,
    );
    const search = input.search?.trim().toLocaleLowerCase();
    const items = await this.#catalogItems(actor, listings);
    return items.filter(
      (item) =>
        search === undefined ||
        item.release.name.toLocaleLowerCase().includes(search) ||
        capabilityDisplayName({ ...item.release, type: item.listing.type })
          .toLocaleLowerCase()
          .includes(search) ||
        item.release.description?.toLocaleLowerCase().includes(search) ||
        item.listing.publisher_name.toLocaleLowerCase().includes(search),
    );
  }

  async listInstallations(
    actor: RequestActor,
  ): Promise<MarketplaceCatalogItemView[]> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const installedListingIds = new Set(
      (await this.#store.listCapabilitiesByOwner(actor.id)).flatMap(
        (capability) =>
          capability.marketplaceListingId === null
            ? []
            : [capability.marketplaceListingId],
      ),
    );
    if (installedListingIds.size === 0) return [];
    const listings = (await this.#store.listListings()).filter((listing) =>
      installedListingIds.has(listing.id),
    );
    return this.#catalogItems(actor, listings);
  }

  async getCatalogItem(
    actor: RequestActor,
    listingId: string,
  ): Promise<MarketplaceCatalogItemView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const listing = await this.#requireListing(listingId);
    const installed = (
      await this.#store.listCapabilitiesByOwner(actor.id)
    ).some((capability) => capability.marketplaceListingId === listing.id);
    const canInspectNonPublic =
      actor.role === "admin" || listing.publisherId === actor.id || installed;
    if (listing.status !== "published" && !canInspectNonPublic) {
      throw new AppError("MARKETPLACE_LISTING_NOT_FOUND");
    }
    const [item] = await this.#catalogItems(actor, [listing]);
    if (item === undefined) throw new AppError("MARKETPLACE_LISTING_NOT_FOUND");
    return item;
  }

  async listOwnPublications(
    actor: RequestActor,
  ): Promise<MarketplacePublicationView[]> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const listings = await this.#store.listListings({ publisherId: actor.id });
    return this.#publicationsForListings(listings);
  }

  async listAllPublications(
    actor: RequestActor,
  ): Promise<MarketplacePublicationView[]> {
    assertAdmin(actor);
    return this.#publicationsForListings(await this.#store.listListings());
  }

  async #publicationsForListings(
    listings: MarketplaceListingRecord[],
  ): Promise<MarketplacePublicationView[]> {
    const releases = await this.#store.listReleases();
    const counts = await this.#store.getInstallCountsByListingIds(
      listings.map((listing) => listing.id),
    );
    const releasesByListing = groupReleasesByListing(releases);
    const result: MarketplacePublicationView[] = [];
    for (const listing of listings) {
      const listingReleases = releasesByListing.get(listing.id) ?? [];
      const latest = listingReleases[0];
      if (latest === undefined) continue;
      const current =
        listing.currentReleaseId === null
          ? null
          : (listingReleases.find(
              (release) => release.id === listing.currentReleaseId,
            ) ?? null);
      result.push({
        listing: listingView(listing),
        current_release:
          current === null ? null : await this.#releaseView(current),
        latest_release: await this.#releaseView(latest),
        install_count: counts.get(listing.id) ?? 0,
      });
    }
    return result;
  }

  async listPendingReviews(
    actor: RequestActor,
  ): Promise<MarketplacePublicationView[]> {
    assertAdmin(actor);
    const pending = await this.#store.listReleases({ status: "pending" });
    const listings = await this.#store.listListings();
    const listingById = new Map(
      listings.map((listing) => [listing.id, listing]),
    );
    const counts = await this.#store.getInstallCountsByListingIds(
      listings.map((listing) => listing.id),
    );
    const result: MarketplacePublicationView[] = [];
    for (const release of pending) {
      const listing = listingById.get(release.listingId);
      if (listing === undefined) continue;
      const current =
        listing.currentReleaseId === null
          ? null
          : await this.#store.findRelease(listing.currentReleaseId);
      result.push({
        listing: listingView(listing),
        current_release:
          current === null ? null : await this.#releaseView(current),
        latest_release: await this.#releaseView(release),
        install_count: counts.get(listing.id) ?? 0,
      });
    }
    return result;
  }

  async submit(
    actor: RequestActor,
    input: {
      capabilityId: string;
      listingId?: string;
      releaseNotes?: string | null;
    },
  ): Promise<MarketplacePublicationView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const source = await this.#requirePublishableCapability(
      actor,
      input.capabilityId,
    );
    const releaseNotes = validateReleaseNotes(input.releaseNotes);
    const listingId = input.listingId ?? randomUUID();
    const releaseId = randomUUID();
    const slug = slugifyCapabilityName(source.name);
    const existing =
      input.listingId === undefined
        ? null
        : await this.#requirePublisherListing(actor, input.listingId);
    if (existing !== null) {
      assertListingAcceptsSource(existing, source, slug);
      if (existing.status === "suspended") {
        throw new AppError("MARKETPLACE_LISTING_SUSPENDED");
      }
      await this.#assertNoPendingRelease(existing.id);
    }

    const releaseRoot = marketplaceReleaseRoot(
      this.#capabilityRoot,
      listingId,
      releaseId,
    );
    const sourcePath = capabilitySourcePath(this.#capabilityRoot, source);
    let replacement:
      Awaited<ReturnType<typeof stageAtomicDirectoryReplacement>> | undefined;
    let releaseLogoKey: string | null = null;
    let committed = false;
    try {
      const stagedReplacement = await stageAtomicDirectoryReplacement(
        sourcePath,
        releaseRoot,
      );
      replacement = stagedReplacement;
      const contentSha256 = await hashMarketplacePackage(
        stagedReplacement.currentDirectory,
      );
      const supplyChainReview = await scanCapabilitySupplyChain(
        stagedReplacement.currentDirectory,
      );
      assertCapabilitySupplyChainApproval(supplyChainReview, contentSha256);
      releaseLogoKey = await this.#snapshotLogo(
        listingId,
        releaseId,
        source.logoObjectKey,
      );
      const result = await this.#store.transaction(async (store) => {
        let listing: MarketplaceListingRecord;
        if (existing === null) {
          await store.lockSlugRegistry();
          if ((await store.findListingBySlug(source.type, slug)) !== null) {
            throw new AppError("CONFLICT");
          }
          const names = await store.getUserNames([actor.id]);
          listing = await store.createListing({
            id: listingId,
            publisherId: actor.id,
            publisherName: names.get(actor.id) ?? actor.id,
            type: source.type,
            slug,
          });
        } else {
          await store.lockListing(existing.id);
          listing = await requireListingFromStore(store, existing.id);
          if (listing.publisherId !== actor.id) throw new AppError("FORBIDDEN");
          assertListingAcceptsSource(listing, source, slug);
          if (listing.status === "suspended") {
            throw new AppError("MARKETPLACE_LISTING_SUSPENDED");
          }
          if (
            (
              await store.listReleases({
                listingId: listing.id,
                status: "pending",
              })
            ).length > 0
          ) {
            throw new AppError("MARKETPLACE_RELEASE_PENDING_CONFLICT");
          }
        }
        const release = await store.createRelease({
          id: releaseId,
          listingId: listing.id,
          sourceCapabilityId: source.id,
          releaseNumber: await store.nextReleaseNumber(listing.id),
          name: source.name,
          displayName: source.displayName ?? null,
          description: source.description,
          releaseNotes,
          logoObjectKey: releaseLogoKey,
          packagePath: stagedReplacement.currentDirectory,
          contentSha256,
          manifestJson: source.manifestJson ?? {},
          riskSummaryJson: {
            ...normalizeRiskSummary(source.riskSummaryJson),
            supply_chain_review: supplyChainReview,
          },
          submittedBy: actor.id,
        });
        await store.writeAudit(
          audit(
            actor,
            "marketplace_release_submitted",
            "marketplace_release",
            release.id,
            {
              listing_id: listing.id,
              release_number: release.releaseNumber,
              capability_id: source.id,
              content_sha256: contentSha256,
              ...supplyChainReviewAuditMetadata(supplyChainReview),
            },
          ),
        );
        return { listing, release };
      });
      await stagedReplacement.commit();
      committed = true;
      if (stagedReplacement.retiredDirectory !== null) {
        await rm(stagedReplacement.retiredDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
      return {
        listing: listingView(result.listing),
        current_release:
          result.listing.currentReleaseId === null
            ? null
            : await this.#releaseView(
                await this.#requireRelease(result.listing.currentReleaseId),
              ),
        latest_release: await this.#releaseView(result.release),
        install_count:
          (
            await this.#store.getInstallCountsByListingIds([result.listing.id])
          ).get(result.listing.id) ?? 0,
      };
    } catch (error) {
      if (!committed) {
        await replacement?.rollback().catch(() => undefined);
        if (releaseLogoKey !== null) {
          await this.#logoStore.remove(releaseLogoKey).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async getReviewDetail(
    actor: RequestActor,
    releaseId: string,
  ): Promise<MarketplaceReviewDetailView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const release = await this.#requireRelease(releaseId);
    const listing = await this.#requireListing(release.listingId);
    if (actor.role !== "admin" && listing.publisherId !== actor.id) {
      throw new AppError("FORBIDDEN");
    }
    await assertMarketplacePackageIntegrity(
      release.packagePath,
      release.contentSha256,
    );
    const files = await listMarketplacePackageFiles(release.packagePath);
    const skillContent =
      listing.type === "skill"
        ? stripSkillFrontmatter(
            await readFile(join(release.packagePath, "SKILL.md"), "utf8"),
          )
        : null;
    return {
      listing: listingView(listing),
      release: await this.#releaseView(release),
      files,
      skill_content: skillContent,
    };
  }

  async review(
    actor: RequestActor,
    releaseId: string,
    input: {
      decision: "approved" | "rejected";
      comment?: string | null;
    },
  ): Promise<MarketplacePublicationView> {
    assertAdmin(actor);
    const release = await this.#requireRelease(releaseId);
    const listing = await this.#requireListing(release.listingId);
    if (release.status !== "pending") throw new AppError("CONFLICT");
    if (input.decision === "approved" && listing.status === "suspended") {
      throw new AppError("MARKETPLACE_LISTING_SUSPENDED");
    }
    await assertMarketplacePackageIntegrity(
      release.packagePath,
      release.contentSha256,
    );
    if (input.decision === "approved") {
      assertCapabilitySupplyChainApproval(
        release.riskSummaryJson.supply_chain_review,
        release.contentSha256,
      );
    }
    const reviewComment = validateReviewComment(input.comment);
    if (input.decision === "rejected" && reviewComment === null) {
      throw new AppError("VALIDATION_ERROR");
    }
    const now = this.#now();
    const result = await this.#store.transaction(async (store) => {
      await store.lockListing(listing.id);
      const lockedListing = await requireListingFromStore(store, listing.id);
      const lockedRelease = await requireReleaseFromStore(store, release.id);
      if (lockedRelease.status !== "pending") throw new AppError("CONFLICT");
      if (
        input.decision === "approved" &&
        lockedListing.status === "suspended"
      ) {
        throw new AppError("MARKETPLACE_LISTING_SUSPENDED");
      }
      const updatedRelease = await store.updateRelease(lockedRelease.id, {
        status: input.decision,
        reviewerId: actor.id,
        reviewComment,
        reviewedAt: now,
        publishedAt: input.decision === "approved" ? now : null,
      });
      const updatedListing =
        input.decision === "approved"
          ? await store.updateListing(lockedListing.id, {
              currentReleaseId: updatedRelease.id,
              status:
                lockedListing.status === "unlisted" ? "unlisted" : "published",
              suspendedBy: null,
              suspendedAt: null,
              suspensionReason: null,
            })
          : lockedListing;
      await store.writeAudit(
        audit(
          actor,
          "marketplace_release_reviewed",
          "marketplace_release",
          updatedRelease.id,
          {
            listing_id: updatedListing.id,
            release_number: updatedRelease.releaseNumber,
            decision: input.decision,
            ...(input.decision === "approved"
              ? supplyChainReviewAuditMetadata(
                  updatedRelease.riskSummaryJson.supply_chain_review,
                )
              : {}),
          },
        ),
      );
      return { listing: updatedListing, release: updatedRelease };
    });
    return {
      listing: listingView(result.listing),
      current_release:
        result.listing.currentReleaseId === null
          ? null
          : await this.#releaseView(
              await this.#requireRelease(result.listing.currentReleaseId),
            ),
      latest_release: await this.#releaseView(result.release),
      install_count:
        (await this.#store.getInstallCountsByListingIds([result.listing.id])).get(
          result.listing.id,
        ) ?? 0,
    };
  }

  async withdraw(
    actor: RequestActor,
    releaseId: string,
  ): Promise<MarketplaceReleaseView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const release = await this.#requireRelease(releaseId);
    const listing = await this.#requirePublisherListing(
      actor,
      release.listingId,
    );
    const updated = await this.#store.transaction(async (store) => {
      await store.lockListing(listing.id);
      const locked = await requireReleaseFromStore(store, release.id);
      if (locked.status !== "pending") throw new AppError("CONFLICT");
      const value = await store.updateRelease(locked.id, {
        status: "withdrawn",
        reviewedAt: this.#now(),
      });
      await store.writeAudit(
        audit(
          actor,
          "marketplace_release_withdrawn",
          "marketplace_release",
          value.id,
          {
            listing_id: listing.id,
            release_number: value.releaseNumber,
          },
        ),
      );
      return value;
    });
    return this.#releaseView(updated);
  }

  async setPublisherListingStatus(
    actor: RequestActor,
    listingId: string,
    status: "published" | "unlisted",
  ): Promise<MarketplaceListingView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    return this.#store.transaction(async (store) => {
      await store.lockListing(listingId);
      const listing = await requireListingFromStore(store, listingId);
      if (listing.publisherId !== actor.id) throw new AppError("FORBIDDEN");
      if (listing.status === "suspended") {
        throw new AppError("MARKETPLACE_LISTING_SUSPENDED");
      }
      if (listing.currentReleaseId === null) throw new AppError("CONFLICT");
      const updated = await store.updateListing(listing.id, {
        status,
        suspendedBy: null,
        suspendedAt: null,
        suspensionReason: null,
      });
      await store.writeAudit(
        audit(
          actor,
          "marketplace_listing_status_updated",
          "marketplace_listing",
          listing.id,
          { status },
        ),
      );
      return listingView(updated);
    });
  }

  async suspend(
    actor: RequestActor,
    listingId: string,
    reason: string,
  ): Promise<MarketplaceListingView> {
    assertAdmin(actor);
    const suspensionReason = validateRequiredComment(reason);
    return this.#store.transaction(async (store) => {
      await store.lockListing(listingId);
      const listing = await requireListingFromStore(store, listingId);
      if (
        listing.currentReleaseId === null ||
        listing.status === "draft" ||
        listing.status === "suspended"
      ) {
        throw new AppError("CONFLICT");
      }
      const updated = await store.updateListing(listing.id, {
        status: "suspended",
        suspendedBy: actor.id,
        suspendedAt: this.#now(),
        suspensionReason,
      });
      await store.writeAudit(
        audit(
          actor,
          "marketplace_listing_suspended",
          "marketplace_listing",
          listing.id,
          { reason: suspensionReason },
        ),
      );
      return listingView(updated);
    });
  }

  async resume(
    actor: RequestActor,
    listingId: string,
  ): Promise<MarketplaceListingView> {
    assertAdmin(actor);
    return this.#store.transaction(async (store) => {
      await store.lockListing(listingId);
      const listing = await requireListingFromStore(store, listingId);
      if (listing.status !== "suspended" || listing.currentReleaseId === null) {
        throw new AppError("CONFLICT");
      }
      const updated = await store.updateListing(listing.id, {
        status: "published",
        suspendedBy: null,
        suspendedAt: null,
        suspensionReason: null,
      });
      await store.writeAudit(
        audit(
          actor,
          "marketplace_listing_resumed",
          "marketplace_listing",
          listing.id,
          {},
        ),
      );
      return listingView(updated);
    });
  }

  async install(
    actor: RequestActor,
    listingId: string,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const listing = await this.#requireListing(listingId);
    if (listing.status !== "published" || listing.currentReleaseId === null) {
      throw new AppError(
        listing.status === "suspended"
          ? "MARKETPLACE_LISTING_SUSPENDED"
          : "MARKETPLACE_RELEASE_NOT_INSTALLABLE",
      );
    }
    const release = await this.#requireRelease(listing.currentReleaseId);
    assertReleaseInstallable(listing, release);
    if (
      (await this.#store.listCapabilitiesByOwner(actor.id)).some(
        (capability) => capability.marketplaceListingId === listing.id,
      )
    ) {
      throw new AppError("CONFLICT");
    }
    await assertMarketplacePackageIntegrity(
      release.packagePath,
      release.contentSha256,
    );
    const logo = await this.#loadReleaseLogo(release);
    return this.#capabilityInstaller.installMarketplaceRelease(actor, {
      listingId: listing.id,
      releaseId: release.id,
      packageRoot: release.packagePath,
      type: listing.type,
      name: release.name,
      displayName: release.displayName ?? null,
      description: release.description,
      manifest: release.manifestJson,
      riskSummary: release.riskSummaryJson,
      logo,
    });
  }

  async updateInstallation(
    actor: RequestActor,
    listingId: string,
  ): Promise<CapabilityView> {
    assertActiveActor(actor);
    assertOrganizationMarketplaceAccess(actor);
    const listing = await this.#requireListing(listingId);
    if (listing.status === "suspended") {
      throw new AppError("MARKETPLACE_LISTING_SUSPENDED");
    }
    if (
      (listing.status !== "published" && listing.status !== "unlisted") ||
      listing.currentReleaseId === null
    ) {
      throw new AppError("MARKETPLACE_RELEASE_NOT_INSTALLABLE");
    }
    const installed = (
      await this.#store.listCapabilitiesByOwner(actor.id)
    ).find((capability) => capability.marketplaceListingId === listing.id);
    if (installed === undefined) {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    const release = await this.#requireRelease(listing.currentReleaseId);
    assertReleaseInstallable(listing, release);
    if (installed.marketplaceReleaseId === release.id) {
      throw new AppError("CONFLICT");
    }
    await assertMarketplacePackageIntegrity(
      release.packagePath,
      release.contentSha256,
    );
    const logo = await this.#loadReleaseLogo(release);
    return this.#capabilityInstaller.updateMarketplaceRelease(
      actor,
      installed.id,
      {
        listingId: listing.id,
        releaseId: release.id,
        packageRoot: release.packagePath,
        type: listing.type,
        name: release.name,
        displayName: release.displayName ?? null,
        description: release.description,
        manifest: release.manifestJson,
        riskSummary: release.riskSummaryJson,
        logo,
      },
    );
  }

  async #catalogItems(
    actor: RequestActor,
    listings: MarketplaceListingRecord[],
  ): Promise<MarketplaceCatalogItemView[]> {
    const releases = await this.#store.listReleases();
    const releaseById = new Map(
      releases.map((release) => [release.id, release]),
    );
    const installed = await this.#store.listCapabilitiesByOwner(actor.id);
    const installedByListing = new Map(
      installed.flatMap((capability) =>
        capability.marketplaceListingId === null
          ? []
          : [[capability.marketplaceListingId, capability] as const],
      ),
    );
    const counts = await this.#store.getInstallCountsByListingIds(
      listings.map((listing) => listing.id),
    );
    const result: MarketplaceCatalogItemView[] = [];
    for (const listing of listings) {
      if (listing.currentReleaseId === null) continue;
      const release = releaseById.get(listing.currentReleaseId);
      if (release === undefined || release.status !== "approved") continue;
      const installation = installedByListing.get(listing.id);
      result.push({
        listing: listingView(listing),
        release: await this.#releaseView(release),
        installed_capability_id: installation?.id ?? null,
        installed_release_id: installation?.marketplaceReleaseId ?? null,
        update_available:
          installation !== undefined &&
          (listing.status === "published" || listing.status === "unlisted") &&
          installation.marketplaceReleaseId !== release.id,
        install_count: counts.get(listing.id) ?? 0,
      });
    }
    return result;
  }

  async #requirePublishableCapability(
    actor: RequestActor,
    capabilityId: string,
  ): Promise<CapabilityRecord> {
    const capability = await this.#store.findCapability(capabilityId);
    if (
      capability === null ||
      capability.ownerId !== actor.id ||
      (capability.sourceType !== "local" &&
        capability.sourceType !== "url") ||
      capability.status !== "active"
    ) {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    return capability;
  }

  async #requireListing(id: string): Promise<MarketplaceListingRecord> {
    const listing = await this.#store.findListing(id);
    if (listing === null) throw new AppError("MARKETPLACE_LISTING_NOT_FOUND");
    return listing;
  }

  async #requirePublisherListing(
    actor: RequestActor,
    id: string,
  ): Promise<MarketplaceListingRecord> {
    const listing = await this.#requireListing(id);
    if (listing.publisherId !== actor.id) throw new AppError("FORBIDDEN");
    return listing;
  }

  async #requireRelease(id: string): Promise<MarketplaceReleaseRecord> {
    const release = await this.#store.findRelease(id);
    if (release === null) throw new AppError("MARKETPLACE_RELEASE_NOT_FOUND");
    return release;
  }

  async #assertNoPendingRelease(listingId: string): Promise<void> {
    if (
      (
        await this.#store.listReleases({
          listingId,
          status: "pending",
        })
      ).length > 0
    ) {
      throw new AppError("MARKETPLACE_RELEASE_PENDING_CONFLICT");
    }
  }

  async #snapshotLogo(
    listingId: string,
    releaseId: string,
    sourceObjectKey: string | null,
  ): Promise<string | null> {
    if (sourceObjectKey === null) return null;
    const bytes = await this.#logoStore.read(sourceObjectKey);
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const contentType = detectSafeRasterImage(bytes);
    if (contentType === null) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const objectKey = `marketplace/${listingId}/releases/${releaseId}/logo${extensionForMime(contentType)}`;
    await this.#logoStore.put(objectKey, bytes, contentType);
    return objectKey;
  }

  async #loadReleaseLogo(
    release: MarketplaceReleaseRecord,
  ): Promise<PreparedLogo | null> {
    if (release.logoObjectKey === null) return null;
    const bytes = await this.#logoStore.read(release.logoObjectKey);
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED");
    }
    const contentType = detectSafeRasterImage(bytes);
    if (contentType === null) {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED");
    }
    return {
      bytes,
      filename: `marketplace-logo${extensionForMime(contentType)}`,
      contentType,
    };
  }

  async #releaseView(
    release: MarketplaceReleaseRecord,
  ): Promise<MarketplaceReleaseView> {
    return {
      id: release.id,
      listing_id: release.listingId,
      source_capability_id: release.sourceCapabilityId,
      release_number: release.releaseNumber,
      status: release.status,
      name: release.name,
      display_name: release.displayName ?? null,
      description: release.description,
      release_notes: release.releaseNotes,
      logo_url:
        release.logoObjectKey === null
          ? null
          : await this.#logoStore.presignGet(release.logoObjectKey, 5 * 60),
      content_sha256: release.contentSha256,
      manifest: release.manifestJson,
      risk_summary: release.riskSummaryJson,
      submitted_by: release.submittedBy,
      reviewer_id: release.reviewerId,
      review_comment: release.reviewComment,
      submitted_at: release.submittedAt.toISOString(),
      reviewed_at: release.reviewedAt?.toISOString() ?? null,
      published_at: release.publishedAt?.toISOString() ?? null,
      created_at: release.createdAt.toISOString(),
      updated_at: release.updatedAt.toISOString(),
    };
  }
}

function listingView(
  listing: MarketplaceListingRecord,
): MarketplaceListingView {
  return {
    id: listing.id,
    publisher_id: listing.publisherId,
    publisher_name: listing.publisherName,
    type: listing.type,
    slug: listing.slug,
    status: listing.status,
    current_release_id: listing.currentReleaseId,
    suspended_by: listing.suspendedBy,
    suspended_at: listing.suspendedAt?.toISOString() ?? null,
    suspension_reason: listing.suspensionReason,
    created_at: listing.createdAt.toISOString(),
    updated_at: listing.updatedAt.toISOString(),
  };
}

function groupReleasesByListing(
  releases: MarketplaceReleaseRecord[],
): Map<string, MarketplaceReleaseRecord[]> {
  const result = new Map<string, MarketplaceReleaseRecord[]>();
  for (const release of releases) {
    const values = result.get(release.listingId) ?? [];
    values.push(release);
    result.set(release.listingId, values);
  }
  for (const values of result.values()) {
    values.sort((left, right) => right.releaseNumber - left.releaseNumber);
  }
  return result;
}

function assertListingAcceptsSource(
  listing: MarketplaceListingRecord,
  capability: CapabilityRecord,
  slug: string,
): void {
  if (listing.type !== capability.type || listing.slug !== slug) {
    throw new AppError("VALIDATION_ERROR");
  }
}

function assertReleaseInstallable(
  listing: MarketplaceListingRecord,
  release: MarketplaceReleaseRecord,
): void {
  if (
    release.listingId !== listing.id ||
    release.status !== "approved" ||
    listing.currentReleaseId !== release.id
  ) {
    throw new AppError("MARKETPLACE_RELEASE_NOT_INSTALLABLE");
  }
}

function capabilitySourcePath(
  capabilityRoot: string,
  capability: CapabilityRecord,
): string {
  const expected = resolve(
    capabilityDirectory(capabilityRoot, capability.id),
    "current",
  );
  const actual = resolve(capability.storagePath);
  const fromRoot = relative(resolve(capabilityRoot), actual);
  if (
    actual !== expected ||
    fromRoot === ".." ||
    fromRoot.startsWith(".." + sep)
  ) {
    throw new AppError("CAPABILITY_NOT_FOUND");
  }
  return actual;
}

function marketplaceReleaseRoot(
  capabilityRoot: string,
  listingId: string,
  releaseId: string,
): string {
  return join(
    resolve(capabilityRoot),
    ".marketplace",
    "listings",
    listingId,
    "releases",
    releaseId,
  );
}

function normalizeRiskSummary(value: Record<string, unknown> | null) {
  return {
    contains_mcp_server: value?.contains_mcp_server === true,
    contains_scripts: value?.contains_scripts === true,
    contains_external_connections:
      value?.contains_external_connections === true,
    requires_environment_variables:
      value?.requires_environment_variables === true,
    requires_credentials: value?.requires_credentials === true,
    contains_dependency_download_commands:
      value?.contains_dependency_download_commands === true,
    declared_environment_keys: stringArray(value?.declared_environment_keys),
    mcp_environment_references: Array.isArray(
      value?.mcp_environment_references,
    )
      ? value.mcp_environment_references.flatMap((reference) => {
          const parsed =
            capabilityMcpEnvironmentReferenceSchema.safeParse(reference);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
    dependency_commands: stringArray(value?.dependency_commands),
  };
}

function supplyChainReviewAuditMetadata(
  review: MarketplaceReleaseRecord["riskSummaryJson"]["supply_chain_review"],
): Record<string, string | number> {
  if (review === undefined) return {};
  return {
    security_scanner_version: review.scanner_version,
    security_ruleset_version: review.ruleset_version,
    security_content_sha256: review.content_sha256,
    security_verdict: review.verdict,
    security_finding_count: review.finding_count,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validateReleaseNotes(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const result = value.trim();
  if (result.length > 8_000) throw new AppError("VALIDATION_ERROR");
  return result === "" ? null : result;
}

function validateReviewComment(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const result = value.trim();
  if (result.length > 4_000) throw new AppError("VALIDATION_ERROR");
  return result === "" ? null : result;
}

function validateRequiredComment(value: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 4_000) {
    throw new AppError("VALIDATION_ERROR");
  }
  return result;
}

function extensionForMime(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
}

function assertActiveActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}

function assertOrganizationMarketplaceAccess(actor: RequestActor): void {
  if (actor.registrationSource === "self_registration") {
    throw new AppError("FORBIDDEN");
  }
}

function assertAdmin(actor: RequestActor): void {
  assertActiveActor(actor);
  if (actor.role !== "admin") throw new AppError("FORBIDDEN");
}

async function requireListingFromStore(
  store: MarketplaceStore,
  id: string,
): Promise<MarketplaceListingRecord> {
  const listing = await store.findListing(id);
  if (listing === null) throw new AppError("MARKETPLACE_LISTING_NOT_FOUND");
  return listing;
}

async function requireReleaseFromStore(
  store: MarketplaceStore,
  id: string,
): Promise<MarketplaceReleaseRecord> {
  const release = await store.findRelease(id);
  if (release === null) throw new AppError("MARKETPLACE_RELEASE_NOT_FOUND");
  return release;
}

function audit(
  actor: RequestActor,
  action: string,
  targetType: "marketplace_listing" | "marketplace_release" | "capability",
  targetId: string,
  metadata: Record<string, unknown>,
) {
  return {
    actorId: actor.id,
    action,
    targetType,
    targetId,
    result: "success" as const,
    metadata,
    ...(actor.ipAddress === undefined ? {} : { ipAddress: actor.ipAddress }),
    ...(actor.userAgent === undefined ? {} : { userAgent: actor.userAgent }),
  };
}
