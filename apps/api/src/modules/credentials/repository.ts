import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

import type { CapabilityRecord } from "../capabilities/types.js";
import { sanitizeAuditMetadata } from "../audit/service.js";
import type {
  CreateCredentialBindingRecordInput,
  CreateCredentialRecordInput,
  CredentialAuditInput,
  CredentialBindingRecord,
  CredentialRecord,
  CredentialStore,
  UpdateCredentialRecordInput,
} from "./types.js";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

function credentialRecord(value: Prisma.CredentialModel): CredentialRecord {
  return {
    ...value,
    status: value.status as CredentialRecord["status"],
  };
}

function bindingRecord(
  value: Prisma.CredentialBindingModel,
): CredentialBindingRecord {
  return {
    ...value,
    status: value.status as CredentialBindingRecord["status"],
  };
}

function capabilityRecord(value: Prisma.CapabilityModel): CapabilityRecord {
  return {
    ...value,
    type: value.type as CapabilityRecord["type"],
    sourceType: value.sourceType as CapabilityRecord["sourceType"],
    status: value.status as CapabilityRecord["status"],
    manifestJson: value.manifestJson as Record<string, unknown> | null,
    riskSummaryJson: value.riskSummaryJson as Record<string, unknown> | null,
  };
}

export class PrismaCredentialStore implements CredentialStore {
  readonly #root: PrismaClient;
  readonly #database: DatabaseClient;

  constructor(root: PrismaClient, transaction?: Prisma.TransactionClient) {
    this.#root = root;
    this.#database = transaction ?? root;
  }

  async transaction<T>(
    work: (store: CredentialStore) => Promise<T>,
  ): Promise<T> {
    if (this.#database !== this.#root) return work(this);
    return this.#root.$transaction((transaction) =>
      work(new PrismaCredentialStore(this.#root, transaction)),
    );
  }

  async lockCapability(id: string): Promise<void> {
    await this.#database.$queryRawUnsafe(
      'SELECT "id" FROM "capabilities" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    );
  }

  async lockCredential(id: string): Promise<void> {
    await this.#database.$queryRawUnsafe(
      'SELECT "id" FROM "credentials" WHERE "id" = $1::uuid FOR UPDATE',
      id,
    );
  }

  async findCredential(id: string): Promise<CredentialRecord | null> {
    const value = await this.#database.credential.findUnique({ where: { id } });
    return value === null ? null : credentialRecord(value);
  }

  async listCredentials(): Promise<CredentialRecord[]> {
    const values = await this.#database.credential.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return values.map(credentialRecord);
  }

  async createCredential(
    input: CreateCredentialRecordInput,
  ): Promise<CredentialRecord> {
    return credentialRecord(
      await this.#database.credential.create({
        data: {
          ...(input.id === undefined ? {} : { id: input.id }),
          ownerId: input.ownerId,
          name: input.name,
          providerType: input.providerType,
          encryptedPayload: input.encryptedPayload,
          encryptionKeyId: input.encryptionKeyId,
          status: input.status,
          createdBy: input.createdBy,
          updatedBy: input.updatedBy,
        },
      }),
    );
  }

  async updateCredential(
    id: string,
    input: UpdateCredentialRecordInput,
  ): Promise<CredentialRecord> {
    return credentialRecord(
      await this.#database.credential.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.providerType === undefined
            ? {}
            : { providerType: input.providerType }),
          ...(input.encryptedPayload === undefined
            ? {}
            : { encryptedPayload: input.encryptedPayload }),
          ...(input.encryptionKeyId === undefined
            ? {}
            : { encryptionKeyId: input.encryptionKeyId }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.lastUsedAt === undefined
            ? {}
            : { lastUsedAt: input.lastUsedAt }),
          updatedBy: input.updatedBy,
        },
      }),
    );
  }

  async markCredentialUsed(id: string, at: Date): Promise<void> {
    await this.#database.credential.update({
      where: { id },
      data: { lastUsedAt: at },
    });
  }

  async deleteCredentialGraph(id: string): Promise<void> {
    await this.#database.credentialBinding.deleteMany({
      where: { credentialId: id },
    });
    await this.#database.credential.delete({ where: { id } });
  }

  async findBinding(id: string): Promise<CredentialBindingRecord | null> {
    const value = await this.#database.credentialBinding.findUnique({
      where: { id },
    });
    return value === null ? null : bindingRecord(value);
  }

  async listBindings(input?: {
    capabilityId?: string;
    credentialId?: string;
    userId?: string;
    envKey?: string;
    credentialKey?: string;
    status?: "active" | "revoked";
  }): Promise<CredentialBindingRecord[]> {
    const values = await this.#database.credentialBinding.findMany({
      where: {
        ...(input?.capabilityId === undefined
          ? {}
          : { capabilityId: input.capabilityId }),
        ...(input?.credentialId === undefined
          ? {}
          : { credentialId: input.credentialId }),
        ...(!input || !("userId" in input) ? {} : { userId: input.userId }),
        ...(input?.envKey === undefined ? {} : { envKey: input.envKey }),
        ...(input?.credentialKey === undefined
          ? {}
          : { credentialKey: input.credentialKey }),
        ...(input?.status === undefined ? {} : { status: input.status }),
      },
      orderBy: { createdAt: "asc" },
    });
    return values.map(bindingRecord);
  }

  async createBinding(
    input: CreateCredentialBindingRecordInput,
  ): Promise<CredentialBindingRecord> {
    return bindingRecord(
      await this.#database.credentialBinding.create({
        data: {
          ...(input.id === undefined ? {} : { id: input.id }),
          credentialId: input.credentialId,
          capabilityId: input.capabilityId,
          userId: input.userId,
          envKey: input.envKey,
          credentialKey: input.credentialKey,
          status: input.status,
          createdBy: input.createdBy,
          revokedBy: null,
          revokedAt: null,
        },
      }),
    );
  }

  async revokeBinding(
    id: string,
    actorId: string,
    at: Date,
  ): Promise<CredentialBindingRecord> {
    return bindingRecord(
      await this.#database.credentialBinding.update({
        where: { id },
        data: { status: "revoked", revokedBy: actorId, revokedAt: at },
      }),
    );
  }

  async findCapability(id: string): Promise<CapabilityRecord | null> {
    const value = await this.#database.capability.findUnique({ where: { id } });
    return value === null ? null : capabilityRecord(value);
  }

  async canUserUseCapability(
    userId: string,
    capabilityId: string,
  ): Promise<boolean> {
    const capability = await this.#database.capability.findFirst({
      where: { id: capabilityId, ownerId: userId, status: "active" },
      select: { id: true },
    });
    if (capability === null) return false;
    const preference = await this.#database.capabilityUserPreference.findUnique(
      {
        where: { userId_capabilityId: { userId, capabilityId } },
        select: { status: true },
      },
    );
    if (preference?.status === "disabled") return false;
    return true;
  }

  async writeAudit(input: CredentialAuditInput): Promise<void> {
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
    });
  }
}

export function createPrismaCredentialStore(
  client: PrismaClient,
): CredentialStore {
  return new PrismaCredentialStore(client);
}
