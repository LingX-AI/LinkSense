import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { webBundleManifestSchema, webSiteSchema, type WebBundleManifest, type WebSite, type WebSiteCreate, type WebSiteUpdate } from "@linksense/shared";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { AppError } from "../../lib/errors.js";
import type { SiteAndRelease, SiteListInput, WebSiteStore } from "./repository.js";
import { bundleSize, prepareWebResource, readResource, sha256 } from "./resources.js";

export class WebSiteService {
  constructor(private readonly store: WebSiteStore, private readonly storage: ObjectStorage) {}
  async list(ownerId: string, input: SiteListInput) {
    const rows = await this.store.list(ownerId, input);
    const items = rows.slice(0, input.limit).map(projectSite);
    const last = items.at(-1);
    return { items, next_cursor: rows.length > input.limit && last ? `${last.updated_at}|${last.id}` : null };
  }
  async create(ownerId: string, input: WebSiteCreate): Promise<WebSite> {
    const { sourceTitle, manifest } = await this.sourceBundle(ownerId, input.conversation_id, input.file_id);
    return projectSite(await this.store.create(ownerId, input, { siteId: randomUUID(), releaseId: randomUUID(), slug: input.slug ?? randomUUID() }, sourceTitle, manifest));
  }
  async update(ownerId: string, id: string, input: WebSiteUpdate): Promise<WebSite> { return projectSite(await this.store.update(ownerId, id, input)); }
  async publish(ownerId: string, id: string, fileId: string): Promise<WebSite> {
    await this.store.owned(ownerId, id);
    const { manifest, conversationId } = await this.sourceBundle(ownerId, null, fileId);
    return projectSite(await this.store.publish(ownerId, id, conversationId, fileId, randomUUID(), manifest));
  }
  sources(ownerId: string, id: string) { return this.store.sources(ownerId, id); }
  delete(ownerId: string, id: string): Promise<void> { return this.store.delete(ownerId, id); }
  async publicEntry(slug: string): Promise<{ title: string; path: string }> {
    const { site, release } = await this.store.publicSite(slug);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    return { title: site.name, path: `/web/${site.slug}/_releases/${release.id}/${encodeResourcePath(manifest.entry_path)}` };
  }
  async resource(slug: string, releaseId: string, path: string): Promise<{ data: Buffer; mimeType: string }> {
    const { release } = await this.store.publicSite(slug, releaseId);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    const normalized = path.endsWith("/") ? `${path}index.html` : path;
    const file = manifest.files.find(candidate => candidate.path === normalized);
    if (!file) throw new AppError("WEB_SITE_NOT_FOUND");
    const data = await this.read(file);
    return { data: await prepareWebResource(data, file.path, new Set(manifest.files.map(asset => asset.path))), mimeType: file.mime_type };
  }
  async download(ownerId: string, id: string): Promise<{ data: Buffer; filename: string }> {
    const { site, release } = await this.store.owned(ownerId, id);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    const zip = new JSZip();
    const paths = new Set(manifest.files.map(file => file.path));
    for (const file of manifest.files) zip.file(file.path, await prepareWebResource(await this.read(file), file.path, paths));
    return { data: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } }), filename: `${site.slug}.zip` };
  }
  private async read(file: WebBundleManifest["files"][number]): Promise<Buffer> {
    const data = await readResource(await this.storage.getObjectStream(file.object_key), file.size_bytes);
    if (sha256(data) !== file.checksum_sha256) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    return data;
  }
  private async sourceBundle(ownerId: string, conversationId: string | null, fileId: string): Promise<{ manifest: WebBundleManifest; sourceTitle: string; conversationId: string }> {
    const { conversation, file, bundle } = await this.store.source(ownerId, conversationId, fileId);
    if (bundle) {
      const manifest = webBundleManifestSchema.parse(bundle.manifestJson);
      // Verify existence before publishing. Resource reads verify checksums too.
      for (const asset of manifest.files) if (await this.storage.getObjectSize(asset.object_key) !== asset.size_bytes) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      return { sourceTitle: conversation.title, conversationId: conversation.id, manifest };
    }
    if (!file.minioObjectKey) throw new AppError("WEB_SITE_SOURCE_UNAVAILABLE");
    const data = await readResource(await this.storage.getObjectStream(file.minioObjectKey), Number(file.sizeBytes));
    if (file.checksumSha256 && sha256(data) !== file.checksumSha256) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    await prepareWebResource(data, "index.html", new Set(["index.html"]));
    return { sourceTitle: conversation.title, conversationId: conversation.id, manifest: webBundleManifestSchema.parse({ entry_path: "index.html", files: [{
      path: "index.html", object_key: file.minioObjectKey, mime_type: "text/html", size_bytes: data.length, checksum_sha256: sha256(data),
    }] }) };
  }
}
export function projectSite({ site, release }: SiteAndRelease): WebSite {
  const manifest = webBundleManifestSchema.parse(release.manifestJson);
  return webSiteSchema.parse({
    id: site.id, name: site.name, description: site.description, slug: site.slug, status: site.status,
    url_path: `/web/${site.slug}`, conversation_id: site.conversationId, source_task_title: site.sourceTaskTitle,
    source_file_id: site.sourceFileId, release_id: release.id, file_count: manifest.files.length, size_bytes: bundleSize(manifest),
    published_at: release.createdAt.toISOString(), created_at: site.createdAt.toISOString(), updated_at: site.updatedAt.toISOString(),
  });
}
export function encodeResourcePath(path: string): string { return path.split("/").map(encodeURIComponent).join("/"); }
