import { Prisma } from "../../generated/prisma/client.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { sanitizeAuditMetadata } from "../audit/service.js"
import type { CapabilityRecord } from "../capabilities/types.js"

import type {
  CreateMarketplaceListingInput,
  CreateMarketplaceReleaseInput,
  MarketplaceAuditInput,
  MarketplaceListingRecord,
  MarketplaceListingStatus,
  MarketplaceReleaseRecord,
  MarketplaceReleaseStatus,
  MarketplaceStore,
} from "./types.js"

type DatabaseClient = PrismaClient | Prisma.TransactionClient

function capabilityRecord(value: Prisma.CapabilityModel): CapabilityRecord {
  return {
    ...value,
    type: value.type as CapabilityRecord["type"],
    sourceType: value.sourceType as CapabilityRecord["sourceType"],
    status: value.status as CapabilityRecord["status"],
    manifestJson: value.manifestJson as Record<string, unknown> | null,
    riskSummaryJson: value.riskSummaryJson as Record<string, unknown> | null,
  }
}

function listingRecord(
  value: Prisma.MarketplaceListingModel,
): MarketplaceListingRecord {
  return {
    ...value,
    type: value.type as MarketplaceListingRecord["type"],
    status: value.status as MarketplaceListingStatus,
  }
}

function releaseRecord(
  value: Prisma.MarketplaceReleaseModel,
): MarketplaceReleaseRecord {
  return {
    ...value,
    status: value.status as MarketplaceReleaseStatus,
    manifestJson: value.manifestJson as Record<string, unknown>,
    riskSummaryJson:
      value.riskSummaryJson as unknown as MarketplaceReleaseRecord["riskSummaryJson"],
  }
}

export class PrismaMarketplaceStore implements MarketplaceStore {
  readonly #root: PrismaClient
  readonly #database: DatabaseClient

  constructor(root: PrismaClient, transaction?: Prisma.TransactionClient) {
    this.#root = root
    this.#database = transaction ?? root
  }

  async transaction<T>(
    work: (store: MarketplaceStore) => Promise<T>,
  ): Promise<T> {
    if (this.#database !== this.#root) return work(this)
    return this.#root.$transaction((transaction) =>
      work(new PrismaMarketplaceStore(this.#root, transaction)),
    )
  }

  async lockListing(id: string): Promise<void> {
    await this.#database.$queryRawUnsafe(
      'SELECT "id" FROM "marketplace_listings" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    )
  }

  async lockSlugRegistry(): Promise<void> {
    await this.#database.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(1450474821)",
    )
  }

  async findCapability(id: string): Promise<CapabilityRecord | null> {
    const value = await this.#database.capability.findUnique({ where: { id } })
    return value === null ? null : capabilityRecord(value)
  }

  async listCapabilitiesByOwner(userId: string): Promise<CapabilityRecord[]> {
    return (
      await this.#database.capability.findMany({
        where: { ownerId: userId },
        orderBy: { updatedAt: "desc" },
      })
    ).map(capabilityRecord)
  }

  async findListing(id: string): Promise<MarketplaceListingRecord | null> {
    const value = await this.#database.marketplaceListing.findUnique({
      where: { id },
    })
    return value === null ? null : listingRecord(value)
  }

  async findListingBySlug(
    type: MarketplaceListingRecord["type"],
    slug: string,
  ): Promise<MarketplaceListingRecord | null> {
    const value = await this.#database.marketplaceListing.findUnique({
      where: { type_slug: { type, slug } },
    })
    return value === null ? null : listingRecord(value)
  }

  async listListings(input?: {
    publisherId?: string
    status?: MarketplaceListingStatus
  }): Promise<MarketplaceListingRecord[]> {
    return (
      await this.#database.marketplaceListing.findMany({
        where: {
          ...(input?.publisherId === undefined
            ? {}
            : { publisherId: input.publisherId }),
          ...(input?.status === undefined ? {} : { status: input.status }),
        },
        orderBy: { updatedAt: "desc" },
      })
    ).map(listingRecord)
  }

  async createListing(
    input: CreateMarketplaceListingInput,
  ): Promise<MarketplaceListingRecord> {
    return listingRecord(
      await this.#database.marketplaceListing.create({
        data: {
          ...input,
          status: "draft",
          currentReleaseId: null,
          suspendedBy: null,
          suspendedAt: null,
          suspensionReason: null,
        },
      }),
    )
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
    return listingRecord(
      await this.#database.marketplaceListing.update({
        where: { id },
        data: input,
      }),
    )
  }

  async findRelease(id: string): Promise<MarketplaceReleaseRecord | null> {
    const value = await this.#database.marketplaceRelease.findUnique({
      where: { id },
    })
    return value === null ? null : releaseRecord(value)
  }

  async listReleases(input?: {
    listingId?: string
    status?: MarketplaceReleaseStatus
  }): Promise<MarketplaceReleaseRecord[]> {
    return (
      await this.#database.marketplaceRelease.findMany({
        where: {
          ...(input?.listingId === undefined
            ? {}
            : { listingId: input.listingId }),
          ...(input?.status === undefined ? {} : { status: input.status }),
        },
        orderBy: [{ listingId: "asc" }, { releaseNumber: "desc" }],
      })
    ).map(releaseRecord)
  }

  async nextReleaseNumber(listingId: string): Promise<number> {
    const latest = await this.#database.marketplaceRelease.findFirst({
      where: { listingId },
      orderBy: { releaseNumber: "desc" },
      select: { releaseNumber: true },
    })
    return (latest?.releaseNumber ?? 0) + 1
  }

  async createRelease(
    input: CreateMarketplaceReleaseInput,
  ): Promise<MarketplaceReleaseRecord> {
    return releaseRecord(
      await this.#database.marketplaceRelease.create({
        data: {
          ...input,
          status: "pending",
          manifestJson: input.manifestJson as Prisma.InputJsonValue,
          riskSummaryJson:
            input.riskSummaryJson as unknown as Prisma.InputJsonValue,
          reviewerId: null,
          reviewComment: null,
          reviewedAt: null,
          publishedAt: null,
        },
      }),
    )
  }

  async updateRelease(
    id: string,
    input: Partial<
      Pick<
        MarketplaceReleaseRecord,
        | "status"
        | "reviewerId"
        | "reviewComment"
        | "reviewedAt"
        | "publishedAt"
      >
    >,
  ): Promise<MarketplaceReleaseRecord> {
    return releaseRecord(
      await this.#database.marketplaceRelease.update({
        where: { id },
        data: input,
      }),
    )
  }

  async getUserNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map()
    const users = await this.#database.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, name: true },
    })
    return new Map(users.map((user) => [user.id, user.name]))
  }

  async getInstallCountsByListingIds(
    listingIds: string[],
  ): Promise<Map<string, number>> {
    if (listingIds.length === 0) return new Map()
    const listings = await this.#database.marketplaceListing.findMany({
      where: { id: { in: [...new Set(listingIds)] } },
      select: { id: true, installCount: true },
    })
    return new Map(
      listings.map((listing) => [listing.id, listing.installCount]),
    )
  }

  async writeAudit(input: MarketplaceAuditInput): Promise<void> {
    await this.#database.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        result: input.result,
        metadataJson:
          input.metadata === undefined
            ? Prisma.JsonNull
            : sanitizeAuditMetadata(input.action, input.metadata),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  }
}
