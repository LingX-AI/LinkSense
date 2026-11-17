import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { conversationWebSiteSchema, conversationWebSitesSchema, webSiteCursorSchema, type ConversationWebSite } from "@linksense/shared";
import { webBundleManifestSchema, webSiteSchema, webSiteToolPageSchema, webSiteWithUrlSchema, type WebBundleManifest, type WebSite, type WebSiteCreate, type WebSiteToolPage, type WebSiteToolRequest, type WebSiteUpdate, type WebSiteWithUrl } from "@linksense/shared";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { AppError } from "../../lib/errors.js";
import type { SiteAndRelease, SiteListInput, WebSiteStore } from "./repository.js";
import { bundleSize, prepareWebResource } from "./resources.js";

import { WebArtifactResources } from "./artifact-resources.js";
import type { WebSiteBackendService } from "../web-site-backends/service.js";
import type { WebSiteBackend } from "@linksense/shared";

export class WebSiteService {
  private readonly resources: WebArtifactResources;
  constructor(private readonly store: WebSiteStore, private readonly storage: ObjectStorage, private readonly backends?: WebSiteBackendService) { this.resources = new WebArtifactResources(store, storage); }
  async conversationDeliveries(ownerId: string, conversationId: string, publicBaseUrl: string): Promise<ConversationWebSite[]> {
    const rows = await this.store.conversationDeliveries(ownerId, conversationId);
    const origins = new Map<string, Promise<string>>();
    return conversationWebSitesSchema.parse(await Promise.all(rows.map(async row => {
      const delivery = conversationWebSiteSchema.omit({ url: true }).parse(row);
      if (!delivery.backend_id) delete delivery.backend_id;
      const backend = conversationWebSiteSchema.shape.backend_id.safeParse(delivery.backend_id);
      let origin: Promise<string> | undefined;
      if (backend.success && backend.data && this.backends?.client) {
        origin = origins.get(backend.data);
        if (!origin) {
          origin = this.backends.originFor(backend.data);
          origins.set(backend.data, origin);
        }
      }
      return { ...delivery, url: origin ? await origin : new URL(`/web/${delivery.slug}`, publicBaseUrl).href };
    })));
  }
  async publishedSlugForOwner(ownerId: string, siteId: string): Promise<string> {
    const { site } = await this.store.owned(ownerId, siteId);
    if (site.status !== "published") throw new AppError("WEB_SITE_NOT_FOUND");
    return webSiteSchema.shape.slug.parse(site.slug);
  }
  async list(ownerId: string, input: SiteListInput) {
    const rows = await this.store.list(ownerId, input);
    const items = await Promise.all(rows.slice(0, input.limit).map(row => this.project(row)));
    const last = items.at(-1);
    return { items, next_cursor: rows.length > input.limit && last ? `${last.updated_at}|${last.id}` : null };
  }
  async create(ownerId: string, input: WebSiteCreate): Promise<WebSite> {
    const { sourceTitle, manifest } = await this.sourceBundle(ownerId, input.conversation_id, input.file_id);
    const ids = { siteId: randomUUID(), releaseId: randomUUID(), slug: input.slug ?? randomUUID() };
    return await this.project(input.backend_id
      ? await this.requiredBackends().withPublishable(ownerId, input.backend_id,
        lease => this.store.create(ownerId, input, ids, sourceTitle, manifest, lease))
      : await this.store.create(ownerId, input, ids, sourceTitle, manifest));
  }
  async update(ownerId: string, id: string, input: WebSiteUpdate): Promise<WebSite> {
    if (input.status === "published") {
      const { site } = await this.store.owned(ownerId, id);
      if (site.backendId) return await this.project(await this.requiredBackends().withPublishable(
        ownerId, site.backendId, lease => this.store.update(ownerId, id, input, lease),
      ));
    }
    return await this.project(await this.store.update(ownerId, id, input));
  }
  async publish(ownerId: string, id: string, fileId: string, expectedBackendId?: string): Promise<WebSite> {
    const { site } = await this.store.owned(ownerId, id);
    if (expectedBackendId && site.backendId !== expectedBackendId) throw new AppError("CONFLICT");
    const { manifest, conversationId } = await this.sourceBundle(ownerId, null, fileId);
    const releaseId = randomUUID();
    return await this.project(site.backendId
      ? await this.requiredBackends().withPublishable(ownerId, site.backendId,
        lease => this.store.publish(ownerId, id, conversationId, fileId, releaseId, manifest, lease))
      : await this.store.publish(ownerId, id, conversationId, fileId, releaseId, manifest));
  }
  sources(ownerId: string, id: string) { return this.store.sources(ownerId, id); }
  delete(ownerId: string, id: string): Promise<void> { return this.store.delete(ownerId, id); }
  async publicEntry(slug: string): Promise<{ title: string; path: string; url?: string }> {
    const { site, release } = await this.store.publicSite(slug);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    return { title: site.name, path: `/web/${site.slug}/_releases/${release.id}/${encodeResourcePath(manifest.entry_path)}`, ...(site.backendId ? { url: await this.requiredBackends().originFor(site.backendId) } : {}) };
  }
  async applicationResource(ownerId: string, id: string, path: string): Promise<{ data: Buffer; mimeType: string } | { redirect: string }> {
    const { site, release } = await this.store.owned(ownerId, id);
    if (site.status !== "published" || !site.backendId) throw new AppError("WEB_SITE_NOT_FOUND");
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    if (path === "/" && manifest.entry_path.includes("/")) return { redirect: `/${encodeResourcePath(manifest.entry_path)}` };
    return this.resources.resource(manifest, path === "/" ? manifest.entry_path : path.slice(1));
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
  /** Owner- and active-turn-scoped entry point for the agent publishing tool. */
  async toolForOwner(ownerId: string, conversationId: string, turnId: string, request: Extract<WebSiteToolRequest, { operation: "list" }>, publicBaseUrl: string): Promise<WebSiteToolPage>;
  async toolForOwner(ownerId: string, conversationId: string, turnId: string, request: Extract<WebSiteToolRequest, { operation: "publish" | "update" }>, publicBaseUrl: string): Promise<WebSiteWithUrl>;
  async toolForOwner(ownerId: string, conversationId: string, turnId: string, request: WebSiteToolRequest, publicBaseUrl: string): Promise<WebSiteWithUrl | WebSiteToolPage | WebSiteBackend | Record<string, unknown>>;
  async toolForOwner(ownerId: string, conversationId: string, turnId: string, request: WebSiteToolRequest, publicBaseUrl: string): Promise<WebSiteWithUrl | WebSiteToolPage | WebSiteBackend | Record<string, unknown>> {
    await this.store.assertActor(ownerId);
    await this.store.assertActiveTurn(ownerId, conversationId, turnId);
    if (request.operation === "prepare_backend") return this.requiredBackends().prepare(ownerId, conversationId, request.name, request.backend_id, request.address);
    if (request.operation === "configure_backend") return this.requiredBackends().configure(ownerId, request.backend_id, request.change);
    if (request.operation === "inspect_backend") return this.requiredBackends().inspect(ownerId, request.backend_id);
    if (request.operation === "list") {
      const page = await this.list(ownerId, {
        limit: request.limit,
        ...(request.search !== undefined ? { search: request.search } : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
        ...(request.cursor !== undefined ? { cursor: parseWebSiteCursor(request.cursor) } : {}),
      });
      return webSiteToolPageSchema.parse({ items: page.items.map(site => withUrl(site, publicBaseUrl)), next_cursor: page.next_cursor });
    }
    if (request.operation === "update") {
      const input: WebSiteUpdate = {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.slug !== undefined ? { slug: request.slug } : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
      };
      if (Object.keys(input).length === 0) throw new AppError("VALIDATION_ERROR");
      return withUrl(await this.update(ownerId, request.site_id, input), publicBaseUrl);
    }
    if (request.site_id) return withUrl(await this.publish(ownerId, request.site_id, request.file_id, request.backend_id), publicBaseUrl);
    if (!request.name) throw new AppError("VALIDATION_ERROR");
    return withUrl(await this.create(ownerId, {
      conversation_id: conversationId,
      file_id: request.file_id,
      name: request.name,
      description: request.description ?? "",
      ...(request.backend_id ? { backend_id: request.backend_id } : {}),
      ...(request.slug !== undefined ? { slug: request.slug } : {}),
    }), publicBaseUrl);
  }
  private async project(row: SiteAndRelease): Promise<WebSite> {
    const result = projectSite(row);
    return row.site.backendId && this.backends?.client ? { ...result, url: await this.backends.originFor(row.site.backendId) } : result;
  }
  private requiredBackends(): WebSiteBackendService {
    if (!this.backends) throw new AppError("WEB_SITE_BACKEND_NOT_CONFIGURED");
    return this.backends;
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
    ...(site.backendId ? { backend_id: site.backendId } : {}),
  });
}
export function encodeResourcePath(path: string): string { return path.split("/").map(encodeURIComponent).join("/"); }
export function parseWebSiteCursor(value: string): NonNullable<SiteListInput["cursor"]> {
  const [time, id] = webSiteCursorSchema.parse(value).split("|");
  if (!time || !id) throw new AppError("VALIDATION_ERROR");
  return { updatedAt: new Date(time), id };
}
function withUrl(site: WebSite, publicBaseUrl: string): WebSiteWithUrl {
  return webSiteWithUrlSchema.parse({ ...site, url: site.url ?? new URL(site.url_path, publicBaseUrl).href });
}
