import { Prisma } from "../../generated/prisma/client.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { AppError } from "../../lib/errors.js"
import { sanitizeAuditMetadata } from "../audit/service.js"

import type {
  CapabilityAuditInput,
  CreateClawHubInstallationInput,
  CapabilityPreferenceRecord,
  CapabilityRecord,
  CapabilityStore,
  CreateCapabilityRecordInput,
  UpdateCapabilityRecordInput,
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

function preferenceRecord(
  value: Prisma.CapabilityUserPreferenceModel,
): CapabilityPreferenceRecord {
  return {
    ...value,
    status: value.status as CapabilityPreferenceRecord["status"],
  }
}

function capabilityCreateData(
  input: CreateCapabilityRecordInput,
): Prisma.CapabilityCreateInput {
  return {
    ...input,
    manifestJson: input.manifestJson as Prisma.InputJsonValue,
    riskSummaryJson: input.riskSummaryJson as unknown as Prisma.InputJsonValue,
  }
}

export class PrismaCapabilityStore implements CapabilityStore {
  readonly #root: PrismaClient
  readonly #database: DatabaseClient

  constructor(root: PrismaClient, transaction?: Prisma.TransactionClient) {
    this.#root = root
    this.#database = transaction ?? root
  }

  async transaction<T>(work: (store: CapabilityStore) => Promise<T>): Promise<T> {
    if (this.#database !== this.#root) return work(this)
    return this.#root.$transaction((transaction) =>
      work(new PrismaCapabilityStore(this.#root, transaction)),
    )
  }

  async lockCapability(id: string): Promise<void> {
    await this.#database.$queryRawUnsafe(
      'SELECT "id" FROM "capabilities" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    )
  }

  async lockSkillNameRegistry(): Promise<void> {
    await this.#database.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(1280527699)",
    )
  }

  async findCapability(id: string): Promise<CapabilityRecord | null> {
    const value = await this.#database.capability.findUnique({ where: { id } })
    return value === null ? null : capabilityRecord(value)
  }

  async listCapabilities(): Promise<CapabilityRecord[]> {
    const values = await this.#database.capability.findMany({
      orderBy: { updatedAt: "desc" },
    })
    return values.map(capabilityRecord)
  }

  async createCapability(
    input: CreateCapabilityRecordInput,
  ): Promise<CapabilityRecord> {
    return capabilityRecord(
      await this.#database.capability.create({ data: capabilityCreateData(input) }),
    )
  }

  async updateCapability(
    id: string,
    input: UpdateCapabilityRecordInput,
  ): Promise<CapabilityRecord> {
    const data: Prisma.CapabilityUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.logoObjectKey !== undefined
        ? { logoObjectKey: input.logoObjectKey }
        : {}),
      ...(input.storagePath !== undefined
        ? { storagePath: input.storagePath }
        : {}),
      ...(input.manifestJson !== undefined
        ? { manifestJson: input.manifestJson as Prisma.InputJsonValue }
        : {}),
      ...(input.riskSummaryJson !== undefined
        ? {
            riskSummaryJson:
              input.riskSummaryJson as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
      ...(input.marketplaceListingId !== undefined
        ? { marketplaceListingId: input.marketplaceListingId }
        : {}),
      ...(input.marketplaceReleaseId !== undefined
        ? { marketplaceReleaseId: input.marketplaceReleaseId }
        : {}),
    }
    return capabilityRecord(
      await this.#database.capability.update({ where: { id }, data }),
    )
  }

  async recordMarketplaceInstall(listingId: string): Promise<void> {
    await this.#database.marketplaceListing.update({
      where: { id: listingId },
      data: { installCount: { increment: 1 } },
    })
  }

  async createClawHubInstallation(
    input: CreateClawHubInstallationInput,
  ): Promise<void> {
    try {
      await this.#database.clawHubSkillInstallation.create({ data: input })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("CLAWHUB_SKILL_ALREADY_INSTALLED")
      }
      throw error
    }
  }

  async deleteCapabilityGraph(id: string): Promise<void> {
    await this.#database.credentialBinding.deleteMany({
      where: { capabilityId: id },
    })
    await this.#database.capabilityUserPreference.deleteMany({
      where: { capabilityId: id },
    })
    await this.#database.clawHubSkillInstallation.deleteMany({
      where: { capabilityId: id },
    })
    await this.#database.capability.delete({ where: { id } })
  }

  async listPreferences(userId: string): Promise<CapabilityPreferenceRecord[]> {
    const values = await this.#database.capabilityUserPreference.findMany({
      where: { userId },
    })
    return values.map(preferenceRecord)
  }

  async upsertPreference(
    userId: string,
    capabilityId: string,
    status: CapabilityPreferenceRecord["status"],
    disabledAt: Date | null,
  ): Promise<CapabilityPreferenceRecord> {
    return preferenceRecord(
      await this.#database.capabilityUserPreference.upsert({
        where: { userId_capabilityId: { userId, capabilityId } },
        create: { userId, capabilityId, status, disabledAt },
        update: { status, disabledAt },
      }),
    )
  }

  async writeAudit(input: CapabilityAuditInput): Promise<void> {
    await this.#database.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
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

export function createPrismaCapabilityStore(
  client: PrismaClient,
): CapabilityStore {
  return new PrismaCapabilityStore(client)
}
