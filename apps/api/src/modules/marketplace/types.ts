import type {
  CapabilityRecord,
  CapabilityRiskSummary,
  CapabilityType,
  PreparedLogo,
  RequestActor,
} from "../capabilities/types.js"
import type { CapabilityView } from "../capabilities/service.js"

export type MarketplaceListingStatus =
  | "draft"
  | "published"
  | "unlisted"
  | "suspended"

export type MarketplaceReleaseStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"

export interface MarketplaceListingRecord {
  id: string
  publisherId: string
  publisherName: string
  type: CapabilityType
  slug: string
  status: MarketplaceListingStatus
  installCount: number
  currentReleaseId: string | null
  suspendedBy: string | null
  suspendedAt: Date | null
  suspensionReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface MarketplaceReleaseRecord {
  id: string
  listingId: string
  sourceCapabilityId: string
  releaseNumber: number
  status: MarketplaceReleaseStatus
  name: string
  description: string | null
  releaseNotes: string | null
  logoObjectKey: string | null
  packagePath: string
  contentSha256: string
  manifestJson: Record<string, unknown>
  riskSummaryJson: CapabilityRiskSummary
  submittedBy: string
  reviewerId: string | null
  reviewComment: string | null
  submittedAt: Date
  reviewedAt: Date | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface MarketplaceListingView {
  id: string
  publisher_id: string
  publisher_name: string
  type: CapabilityType
  slug: string
  status: MarketplaceListingStatus
  current_release_id: string | null
  suspended_by: string | null
  suspended_at: string | null
  suspension_reason: string | null
  created_at: string
  updated_at: string
}

export interface MarketplaceReleaseView {
  id: string
  listing_id: string
  source_capability_id: string
  release_number: number
  status: MarketplaceReleaseStatus
  name: string
  description: string | null
  release_notes: string | null
  logo_url: string | null
  content_sha256: string
  manifest: Record<string, unknown>
  risk_summary: CapabilityRiskSummary
  submitted_by: string
  reviewer_id: string | null
  review_comment: string | null
  submitted_at: string
  reviewed_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface MarketplaceCatalogItemView {
  listing: MarketplaceListingView
  release: MarketplaceReleaseView
  installed_capability_id: string | null
  installed_release_id: string | null
  update_available: boolean
  install_count: number
}

export interface MarketplacePublicationView {
  listing: MarketplaceListingView
  current_release: MarketplaceReleaseView | null
  latest_release: MarketplaceReleaseView
  install_count: number
}

export interface MarketplaceReviewDetailView {
  listing: MarketplaceListingView
  release: MarketplaceReleaseView
  files: string[]
  skill_content: string | null
}

export interface CreateMarketplaceListingInput {
  id: string
  publisherId: string
  publisherName: string
  type: CapabilityType
  slug: string
}

export interface CreateMarketplaceReleaseInput {
  id: string
  listingId: string
  sourceCapabilityId: string
  releaseNumber: number
  name: string
  description: string | null
  releaseNotes: string | null
  logoObjectKey: string | null
  packagePath: string
  contentSha256: string
  manifestJson: Record<string, unknown>
  riskSummaryJson: CapabilityRiskSummary
  submittedBy: string
}

export interface MarketplaceAuditInput {
  actorId: string | null
  action: string
  targetType: "marketplace_listing" | "marketplace_release" | "capability"
  targetId: string
  result: "success" | "failure" | "rejected"
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export interface MarketplaceStore {
  transaction<T>(work: (store: MarketplaceStore) => Promise<T>): Promise<T>
  lockListing(id: string): Promise<void>
  lockSlugRegistry(): Promise<void>
  findCapability(id: string): Promise<CapabilityRecord | null>
  listCapabilitiesByOwner(userId: string): Promise<CapabilityRecord[]>
  findListing(id: string): Promise<MarketplaceListingRecord | null>
  findListingBySlug(
    type: CapabilityType,
    slug: string,
  ): Promise<MarketplaceListingRecord | null>
  listListings(input?: {
    publisherId?: string
    status?: MarketplaceListingStatus
  }): Promise<MarketplaceListingRecord[]>
  createListing(
    input: CreateMarketplaceListingInput,
  ): Promise<MarketplaceListingRecord>
  updateListing(
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
  ): Promise<MarketplaceListingRecord>
  findRelease(id: string): Promise<MarketplaceReleaseRecord | null>
  listReleases(input?: {
    listingId?: string
    status?: MarketplaceReleaseStatus
  }): Promise<MarketplaceReleaseRecord[]>
  nextReleaseNumber(listingId: string): Promise<number>
  createRelease(
    input: CreateMarketplaceReleaseInput,
  ): Promise<MarketplaceReleaseRecord>
  updateRelease(
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
  ): Promise<MarketplaceReleaseRecord>
  getUserNames(userIds: string[]): Promise<Map<string, string>>
  getInstallCountsByListingIds(listingIds: string[]): Promise<Map<string, number>>
  writeAudit(input: MarketplaceAuditInput): Promise<void>
}

export interface MarketplaceLogoStore {
  read(objectKey: string): Promise<Buffer>
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>
  remove(objectKey: string): Promise<void>
  presignGet(objectKey: string, expiresSeconds: number): Promise<string>
}

export interface MarketplaceCapabilityInstaller {
  installMarketplaceRelease(
    actor: RequestActor,
    input: {
      listingId: string
      releaseId: string
      packageRoot: string
      type: CapabilityType
      name: string
      description: string | null
      manifest: Record<string, unknown>
      riskSummary: CapabilityRiskSummary
      logo: PreparedLogo | null
    },
  ): Promise<CapabilityView>
  updateMarketplaceRelease(
    actor: RequestActor,
    capabilityId: string,
    input: {
      listingId: string
      releaseId: string
      packageRoot: string
      type: CapabilityType
      name: string
      description: string | null
      manifest: Record<string, unknown>
      riskSummary: CapabilityRiskSummary
      logo: PreparedLogo | null
    },
  ): Promise<CapabilityView>
}
