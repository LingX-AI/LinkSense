import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { webBundleManifestSchema, webSiteSchema, type WebBundleManifest, type WebSite, type WebSiteCreate, type WebSiteUpdate } from "@linksense/shared";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { AppError } from "../../lib/errors.js";
import type { SiteAndRelease, SiteListInput, WebSiteStore } from "./repository.js";
import { bundleSize, prepareWebResource } from "./resources.js";

import { WebArtifactResources } from "./artifact-resources.js";

export class WebSiteService {
  private readonly resources: WebArtifactResources;
  constructor(private readonly store: WebSiteStore, private readonly storage: ObjectStorage) { this.resources = new WebArtifactResources(store, storage); }
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
    return this.resources.resource(manifest, path);
  }
  async download(ownerId: string, id: string): Promise<{ data: Buffer; filename: string }> {
    const { site, release } = await this.store.owned(ownerId, id);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    const zip = new JSZip();
    const paths = new Set(manifest.files.map(file => file.path));
    for (const file of manifest.files) zip.file(file.path, await prepareWebResource(await this.resources.read(file), file.path, paths));
    return { data: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } }), filename: `${site.slug}.zip` };
  }
  private async sourceBundle(ownerId: string, conversationId: string | null, fileId: string): Promise<{ manifest: WebBundleManifest; sourceTitle: string; conversationId: string }> {
    const source = await this.resources.source(ownerId, conversationId, fileId);
    for (const asset of source.manifest.files) if (await this.storage.getObjectSize(asset.object_key) !== asset.size_bytes) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    // Validate the rendered entry too, including local SVG symbol references.
    await this.resources.resource(source.manifest, source.manifest.entry_path);
    return source;
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
