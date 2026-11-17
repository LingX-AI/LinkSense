import { randomUUID } from "node:crypto";
import { generatedWebSiteBackendHostLabel } from "@linksense/shared";
import { Prisma, type PrismaClient, type WebSiteBackend } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export class WebSiteBackendRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(ownerId: string, conversationId: string, name: string): Promise<WebSiteBackend> {
    return this.prisma.$transaction(async tx => {
      const owners = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM users WHERE id=${ownerId}::uuid AND status='active' FOR UPDATE`);
      if (!owners.length || !await tx.conversation.count({ where: { id: conversationId, ownerId } })) throw new AppError("FORBIDDEN");
      const existing = await tx.webSiteBackend.findUnique({ where: { ownerId_conversationId_name: { ownerId, conversationId, name } } });
      if (existing) return existing;
      if (await tx.webSiteBackend.count({ where: { ownerId } }) >= 50) throw new AppError("WEB_SITE_BACKEND_LIMIT_REACHED");
      const id = randomUUID();
      const hostLabel = generatedWebSiteBackendHostLabel(id);
      await tx.webSiteBackendAddress.create({ data: { label: hostLabel, backendId: id } });
      return tx.webSiteBackend.create({ data: { id, ownerId, conversationId, name, hostLabel, hostResolved: true, projectId: `ls-${id.replaceAll("-", "")}` } });
    });
  }

  async owned(ownerId: string, id: string): Promise<WebSiteBackend> {
    const row = await this.prisma.webSiteBackend.findFirst({ where: { id, ownerId } });
    if (!row) throw new AppError("WEB_SITE_NOT_FOUND");
    return row;
  }

  async acquire(ownerId: string, id: string, until: Date): Promise<void> {
    const result = await this.prisma.webSiteBackend.updateMany({
      where: { id, ownerId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
      data: { leaseUntil: until },
    });
    if (result.count !== 1) throw new AppError("CONFLICT");
  }

  async finish(id: string, until: Date, status?: "ready" | "failed", encryptedCredential?: string): Promise<void> {
    const result = await this.prisma.webSiteBackend.updateMany({
      where: { id, leaseUntil: until },
      data: { leaseUntil: null, ...(status ? { status } : {}), ...(status === "ready" ? { hostResolved: true } : {}), ...(encryptedCredential ? { encryptedCredential } : {}) },
    });
    if (result.count !== 1) throw new AppError("CONFLICT");
  }

  async byHostLabel(label: string): Promise<{ id: string } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT b.id::text AS id FROM web_site_backends b
      WHERE b.host_label = ${label} OR (b.host_label IS NULL AND b.id::text = ${label})
        OR (NOT b.host_resolved AND (b.id::text = ${label}
          OR (b.host_label IS NULL AND left(replace(b.id::text, '-', ''), 12) = ${label})
          OR EXISTS (SELECT 1 FROM web_site_backend_addresses a WHERE a.backend_id = b.id AND a.label = ${label})))
      LIMIT 2`);
    const [row] = rows;
    return rows.length === 1 && row ? row : null;
  }

  findById(id: string): Promise<WebSiteBackend | null> {
    return this.prisma.webSiteBackend.findUnique({ where: { id } });
  }

  async findByHostLabel(hostLabel: string): Promise<{ id: string } | null> {
    const address = await this.prisma.webSiteBackendAddress.findUnique({ where: { label: hostLabel } });
    return address ? { id: address.backendId } : null;
  }

  async setHostLabel(id: string, lease: Date, hostLabel: string | null, hostResolved = true): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM web_site_backends WHERE id = ${id}::uuid
          AND lease_until = ${lease} AND lease_until > ${new Date()} FOR UPDATE`);
        if (!rows.length) throw new AppError("CONFLICT");
        if (hostLabel !== null) {
          const address = await tx.webSiteBackendAddress.upsert({
            where: { label: hostLabel }, create: { label: hostLabel, backendId: id }, update: {},
          });
          if (address.backendId !== id) throw new AppError("WEB_SITE_BACKEND_ADDRESS_TAKEN");
        }
        await tx.webSiteBackend.update({ where: { id }, data: { hostLabel, hostResolved } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("WEB_SITE_BACKEND_ADDRESS_TAKEN");
      throw error;
    }
  }

  async publicBinding(id: string): Promise<{ backend: WebSiteBackend; siteId: string }> {
    const site = await this.prisma.webSite.findFirst({ where: { backendId: id, status: "published" }, select: { id: true, ownerId: true } });
    if (!site || !await this.prisma.user.count({ where: { id: site.ownerId, status: "active" } })) throw new AppError("WEB_SITE_NOT_FOUND");
    const backend = await this.owned(site.ownerId, id);
    if (backend.status !== "ready") throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE");
    return { backend, siteId: site.id };
  }

  async source(ownerId: string, fileId: string): Promise<{ objectKey: string; size: number; checksum: string | null }> {
    const file = await this.prisma.conversationFile.findFirst({ where: { id: fileId, kind: "artifact", status: "registered", downloadable: true } });
    if (!file?.minioObjectKey || !file.filename.endsWith(".tar.gz") || file.sizeBytes > 20n * 1024n * 1024n ||
        !await this.prisma.conversation.count({ where: { id: file.conversationId, ownerId } })) throw new AppError("WEB_SITE_SOURCE_UNAVAILABLE");
    return { objectKey: file.minioObjectKey, size: Number(file.sizeBytes), checksum: file.checksumSha256 };
  }
}

export type WebSiteBackendStore = Pick<WebSiteBackendRepository, "reserve" | "owned" | "findById" | "findByHostLabel" | "byHostLabel" | "setHostLabel" | "acquire" | "finish" | "publicBinding" | "source">;
