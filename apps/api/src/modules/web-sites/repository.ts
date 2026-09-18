import { Prisma, type ConversationFile, type PrismaClient, type WebArtifactBundle, type WebSite, type WebSiteRelease } from "../../generated/prisma/client.js";
import type { WebSiteCreate, WebSiteStatus, WebSiteUpdate, WebBundleManifest } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";

export type SiteAndRelease = { site: WebSite; release: WebSiteRelease };
type SiteSource = {
  conversation: { id: string; title: string };
  file: Pick<ConversationFile, "id" | "conversationId" | "filename" | "mimeType" | "minioObjectKey" | "sizeBytes" | "checksumSha256">;
  bundle: WebArtifactBundle | null;
};
export type SiteListInput = { search?: string; status?: WebSiteStatus; conversationId?: string; cursor?: { updatedAt: Date; id: string }; limit: number };
export class WebSiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(ownerId: string, input: SiteListInput): Promise<SiteAndRelease[]> {
    const sites = await this.prisma.webSite.findMany({
      where: { ownerId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        AND: [
          ...(input.search ? [{ OR: [{ name: { contains: input.search, mode: "insensitive" as const } }, { slug: { contains: input.search, mode: "insensitive" as const } }] }] : []),
          ...(input.cursor ? [{ OR: [{ updatedAt: { lt: input.cursor.updatedAt } }, { updatedAt: input.cursor.updatedAt, id: { lt: input.cursor.id } }] }] : []),
        ],
      }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: input.limit + 1,
    });
    const releases = new Map((await this.prisma.webSiteRelease.findMany({ where: { id: { in: sites.map(site => site.currentReleaseId) } } })).map(release => [release.id, release]));
    return sites.map(site => {
      const release = releases.get(site.currentReleaseId);
      if (!release) throw new AppError("INTERNAL_ERROR");
      return { site, release };
    });
  }

  async owned(ownerId: string, id: string): Promise<SiteAndRelease> {
    const site = await this.prisma.webSite.findFirst({ where: { id, ownerId } });
    if (!site) throw new AppError("WEB_SITE_NOT_FOUND");
    return this.withRelease(site);
  }

  async publicSite(slug: string, releaseId?: string): Promise<SiteAndRelease> {
    const site = await this.prisma.webSite.findFirst({ where: { slug, status: "published" } });
    if (!site || !await this.prisma.user.count({ where: { id: site.ownerId, status: "active" } })) throw new AppError("WEB_SITE_NOT_FOUND");
    return this.withRelease(site, releaseId);
  }

  private async withRelease(site: WebSite, releaseId = site.currentReleaseId): Promise<SiteAndRelease> {
    const release = await this.prisma.webSiteRelease.findFirst({ where: { id: releaseId, siteId: site.id } });
    if (!release) throw new AppError("WEB_SITE_NOT_FOUND");
    return { site, release };
  }

  async source(ownerId: string, conversationId: string | null, fileId: string): Promise<SiteSource> {
    // Creation supplies a task scope; replacement resolves the file's actual
    // task and independently verifies that it belongs to the same owner.
    const file = await this.prisma.conversationFile.findFirst({ where: { id: fileId, ...(conversationId ? { conversationId } : {}), kind: "artifact", status: "registered", downloadable: true }, select: { id: true, conversationId: true, filename: true, mimeType: true, minioObjectKey: true, sizeBytes: true, checksumSha256: true } });
    if (!file?.minioObjectKey || !/\.html?$/iu.test(file.filename) || file.mimeType !== "text/html") throw new AppError("WEB_SITE_SOURCE_UNAVAILABLE");
    const conversation = await this.prisma.conversation.findFirst({ where: { id: file.conversationId, ownerId }, select: { id: true, title: true } });
    if (!conversation) throw new AppError("WEB_SITE_SOURCE_UNAVAILABLE");
    const bundle = await this.prisma.webArtifactBundle.findFirst({ where: { fileId, ownerId, conversationId: conversation.id } });
    return { conversation, file, bundle };
  }

  async sources(ownerId: string, siteId: string) {
    const { site } = await this.owned(ownerId, siteId);
    if (!site.conversationId) return [];
    const files = await this.prisma.conversationFile.findMany({
      where: { conversationId: site.conversationId, kind: "artifact", status: "registered", mimeType: "text/html", downloadable: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200,
      select: { id: true, filename: true, createdAt: true },
    });
    return files.map(file => ({ id: file.id, filename: file.filename, created_at: file.createdAt.toISOString() }));
  }

  async create(ownerId: string, input: WebSiteCreate, ids: { siteId: string; releaseId: string; slug: string }, sourceTitle: string, manifest: WebBundleManifest): Promise<SiteAndRelease> {
    try {
      return await this.prisma.$transaction(async tx => {
        await lockSource(tx, ownerId, input.conversation_id, input.file_id);
        const existing = await tx.webSite.findFirst({ where: { ownerId, originFileId: input.file_id } });
        if (existing) {
          const release = await tx.webSiteRelease.findUniqueOrThrow({ where: { id: existing.currentReleaseId } });
          return { site: existing, release };
        }
        await tx.webSiteAddress.create({ data: { slug: ids.slug, siteId: ids.siteId } });
        const site = await tx.webSite.create({ data: {
          id: ids.siteId, ownerId, conversationId: input.conversation_id, originFileId: input.file_id,
          sourceFileId: input.file_id, sourceTaskTitle: sourceTitle, name: input.name,
          description: input.description, slug: ids.slug, status: "published", currentReleaseId: ids.releaseId,
        } });
        const release = await tx.webSiteRelease.create({ data: { id: ids.releaseId, siteId: site.id, sourceFileId: input.file_id, manifestJson: manifest } });
        await audit(tx, ownerId, site.id, "web_site_created");
        return { site, release };
      });
    } catch (error) { throw translateConflict(error); }
  }

  async update(ownerId: string, id: string, input: WebSiteUpdate): Promise<SiteAndRelease> {
    try {
      await this.prisma.$transaction(async tx => {
        await lockSite(tx, ownerId, id);
        if (input.slug) {
          const reservation = await tx.webSiteAddress.findUnique({ where: { slug: input.slug } });
          if (reservation && reservation.siteId !== id) throw new AppError("WEB_SITE_SLUG_TAKEN");
          if (!reservation) await tx.webSiteAddress.create({ data: { slug: input.slug, siteId: id } });
        }
        await tx.webSite.update({ where: { id }, data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        } });
        await audit(tx, ownerId, id, "web_site_updated");
      });
      return this.owned(ownerId, id);
    } catch (error) { throw translateConflict(error); }
  }

  async publish(ownerId: string, id: string, conversationId: string, fileId: string, releaseId: string, manifest: WebBundleManifest): Promise<SiteAndRelease> {
    return this.prisma.$transaction(async tx => {
      const source = await lockSource(tx, ownerId, conversationId, fileId);
      await lockSite(tx, ownerId, id);
      const release = await tx.webSiteRelease.create({ data: { id: releaseId, siteId: id, sourceFileId: fileId, manifestJson: manifest } });
      const site = await tx.webSite.update({ where: { id }, data: { currentReleaseId: release.id, sourceFileId: fileId, conversationId, sourceTaskTitle: source.title } });
      await audit(tx, ownerId, id, "web_site_published");
      return { site, release };
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockSite(tx, ownerId, id);
      // Releases reference immutable original artifacts, not independently owned
      // copies. Removing a site must never delete those task resources.
      await tx.webSiteRelease.deleteMany({ where: { siteId: id } });
      await tx.webSiteAddress.deleteMany({ where: { siteId: id } });
      await tx.webSite.delete({ where: { id } });
      await audit(tx, ownerId, id, "web_site_deleted");
    });
  }
}

async function audit(tx: Prisma.TransactionClient, ownerId: string, siteId: string, action: "web_site_created" | "web_site_updated" | "web_site_published" | "web_site_deleted"): Promise<void> {
  await tx.auditLog.create({ data: { actorId: ownerId, action, targetType: "web_site", targetId: siteId, result: "success", metadataJson: {} } });
}

async function lockSource(tx: Prisma.TransactionClient, ownerId: string, conversationId: string, fileId: string): Promise<{ id: string; title: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string; title: string }>>(Prisma.sql`SELECT id, title FROM conversations WHERE id = ${conversationId}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE`);
  const source = rows[0];
  if (!source || !await tx.conversationFile.count({ where: { id: fileId, conversationId, kind: "artifact", status: "registered", downloadable: true, mimeType: "text/html" } })) throw new AppError("WEB_SITE_SOURCE_UNAVAILABLE");
  return source;
}
async function lockSite(tx: Prisma.TransactionClient, ownerId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM web_sites WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE`);
  if (!rows.length) throw new AppError("WEB_SITE_NOT_FOUND");
}
function translateConflict(error: unknown): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? new AppError("WEB_SITE_SLUG_TAKEN") : error;
}
export type WebSiteStore = Pick<WebSiteRepository, "list" | "owned" | "publicSite" | "source" | "sources" | "create" | "update" | "publish" | "delete">;
