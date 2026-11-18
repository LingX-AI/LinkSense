import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { conversationWebSiteSchema, conversationWebSitesSchema, webSiteCursorSchema, webApplicationPath, type ConversationWebSite } from "@linksense/shared";
import { webBundleManifestSchema, webSiteSchema, webSiteToolPageSchema, webSiteWithUrlSchema, type WebBundleManifest, type WebSite, type WebSiteCreate, type WebSiteToolPage, type WebSiteToolRequest, type WebSiteUpdate, type WebSiteWithUrl } from "@linksense/shared";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { hashPassword } from "../../lib/password.js";
import { AppError } from "../../lib/errors.js";
import type { SiteAndRelease, SiteListInput, WebSiteStore } from "./repository.js";
import { bundleSize, prepareWebResource } from "./resources.js";

import { WebArtifactResources } from "./artifact-resources.js";
import { analyticsDomain, type WebSiteAnalytics } from "./analytics.js";
import type { WebSiteBackendService } from "../web-site-backends/service.js";
import type { WebSiteBackend } from "@linksense/shared";

export class WebSiteService {
  private readonly resources: WebArtifactResources;
  constructor(
    private readonly store: WebSiteStore,
    private readonly storage: ObjectStorage,
    private readonly backends?: WebSiteBackendService,
    private readonly analytics?: WebSiteAnalytics,
  ) { this.resources = new WebArtifactResources(store, storage); }
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
          origin = this.backends.publishedUrl(backend.data, delivery.id);
          origins.set(backend.data, origin);
        }
      }
      return { ...delivery, url: origin ? await origin : new URL(webApplicationPath(delivery.id), publicBaseUrl).href };
    })));
  }
  /** UUID addresses are site ids; any other address is a current or retired owner-chosen slug. */
  async publishedSiteIdByAddress(address: string): Promise<string> {
    if (webSiteSchema.shape.id.safeParse(address).success) return address;
    const slug = webSiteSchema.shape.slug.safeParse(address);
    if (!slug.success) throw new AppError("WEB_SITE_NOT_FOUND");
    return (await this.store.publicSite(slug.data)).site.id;
  }
  /** Published access state for the passcode gate; the hash itself stays server-side. */
  async publicAccess(address: string): Promise<{ id: string; slug: string; passcodeHash: string | null }> {
    const siteId = await this.publishedSiteIdByAddress(address);
    const { site } = await this.store.publicSiteById(siteId);
    return { id: site.id, slug: site.slug, passcodeHash: site.passcodeHash ?? null };
  }
  private async passcodeHash(passcode: string | null | undefined): Promise<string | null | undefined> {
    if (passcode === undefined) return undefined;
    if (passcode === null) return null;
    return await hashPassword(passcode);
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
    const passcodeHash = await this.passcodeHash(input.passcode);
    return await this.project(input.backend_id
      ? await this.requiredBackends().withPublishable(ownerId, input.backend_id,
        lease => this.store.create(ownerId, input, ids, sourceTitle, manifest, lease, passcodeHash))
      : await this.store.create(ownerId, input, ids, sourceTitle, manifest, undefined, passcodeHash));
  }
  async update(ownerId: string, id: string, input: WebSiteUpdate): Promise<WebSite> {
    const passcodeHash = await this.passcodeHash(input.passcode);
    const analytics = await this.analyticsUpdate(ownerId, id, input.analytics);
    if (input.status === "published") {
      const { site } = await this.store.owned(ownerId, id);
      if (site.backendId) return await this.project(await this.requiredBackends().withPublishable(
        ownerId, site.backendId, lease => this.store.update(ownerId, id, input, lease, passcodeHash, analytics),
      ));
    }
    return await this.project(await this.store.update(ownerId, id, input, undefined, passcodeHash, analytics));
  }
  /** Enabling needs the remote site first; disabling only stops injection and keeps its history. */
  private async analyticsUpdate(
    ownerId: string, id: string, enabled: boolean | undefined,
  ): Promise<{ enabled: boolean; siteId?: number; domain?: string } | undefined> {
    if (enabled === undefined) return undefined;
    // Turning collection off needs no upstream call, even if the service was
    // removed from configuration after the site had enabled it.
    if (!enabled) return { enabled: false };
    if (!this.analytics) throw new AppError("WEB_SITE_ANALYTICS_NOT_CONFIGURED");
    const { site } = await this.store.owned(ownerId, id);
    if (site.status !== "published") throw new AppError("WEB_SITE_ANALYTICS_UNPUBLISHED");
    const domain = site.analyticsDomain ?? analyticsDomain(site.id);
    const remote = await this.analytics.ensureSite({ name: site.name, domain });
    return { enabled: true, siteId: remote.id, domain: remote.domain };
  }
  async publish(ownerId: string, id: string, fileId: string, expectedBackendId?: string): Promise<WebSite> {
    const { site } = await this.store.owned(ownerId, id);
    if (expectedBackendId && site.backendId && site.backendId !== expectedBackendId) throw new AppError("CONFLICT");
    const addingBackend = expectedBackendId && !site.backendId ? expectedBackendId : undefined;
    if (addingBackend && (await this.requiredBackends().store.owned(ownerId, addingBackend)).runtimeMode !== "sandbox") throw new AppError("CONFLICT");
    const { manifest, conversationId } = await this.sourceBundle(ownerId, null, fileId);
    const releaseId = randomUUID();
    const binding = site.backendId ?? addingBackend;
    return await this.project(binding
      ? await this.requiredBackends().withPublishable(ownerId, binding,
        lease => addingBackend
          ? this.store.publish(ownerId, id, conversationId, fileId, releaseId, manifest, lease, addingBackend)
          : this.store.publish(ownerId, id, conversationId, fileId, releaseId, manifest, lease))
      : await this.store.publish(ownerId, id, conversationId, fileId, releaseId, manifest));
  }
  sources(ownerId: string, id: string) { return this.store.sources(ownerId, id); }
  delete(ownerId: string, id: string): Promise<void> { return this.store.delete(ownerId, id); }
  async publicEntry(slug: string): Promise<{ title: string; path: string; url?: string }> {
    const { site, release } = await this.store.publicSite(slug);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    return { title: site.name, path: `/web/${site.slug}/_releases/${release.id}/${encodeResourcePath(manifest.entry_path)}`, ...(site.backendId ? { url: await this.requiredBackends().publishedUrl(site.backendId, site.id) } : {}) };
  }
  async publicApplication(id: string): Promise<{ title: string; path: string; releasePath: string; backendId?: string; url?: string }> {
    const { site, release } = await this.store.publicSiteById(id);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    const releasePath = `/web/${webSiteSchema.shape.slug.parse(site.slug)}/_releases/${release.id}/`;
    return { title: site.name, path: `${releasePath}${encodeResourcePath(manifest.entry_path)}`, releasePath,
      ...(site.backendId ? { backendId: site.backendId, url: await this.requiredBackends().publishedUrl(site.backendId, site.id) } : {}) };
  }
  async applicationResource(ownerId: string, id: string, path: string): Promise<{ data: Buffer; mimeType: string } | { redirect: string }> {
    const { site, release } = await this.store.owned(ownerId, id);
    if (site.status !== "published" || !site.backendId) throw new AppError("WEB_SITE_NOT_FOUND");
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    if (path === "/" && manifest.entry_path.includes("/")) return { redirect: `/${encodeResourcePath(manifest.entry_path)}` };
    return this.resources.resource(manifest, path === "/" ? manifest.entry_path : path.slice(1));
  }
  async applicationEntry(ownerId: string, id: string): Promise<{ title: string; path: string; releasePath: string }> {
    const { site, release } = await this.store.owned(ownerId, id);
    if (site.status !== "published" || !site.backendId) throw new AppError("WEB_SITE_NOT_FOUND");
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    const releasePath = `/web/${webSiteSchema.shape.slug.parse(site.slug)}/_releases/${webSiteSchema.shape.release_id.parse(release.id)}/`;
    return { title: site.name, path: `${releasePath}${encodeResourcePath(manifest.entry_path)}`, releasePath };
  }
  async resource(slug: string, releaseId: string, path: string): Promise<{ data: Buffer; mimeType: string }> {
    const { site, release } = await this.store.publicSite(slug, releaseId);
    const manifest = webBundleManifestSchema.parse(release.manifestJson);
    return this.injectAnalytics(site, await this.resources.resource(manifest, path));
  }
  /** Publishes the tracker into HTML documents only; other assets pass through untouched. */
  private injectAnalytics(
    site: { analyticsEnabled: boolean; analyticsDomain: string | null },
    resource: { data: Buffer; mimeType: string },
  ): { data: Buffer; mimeType: string } {
    if (!site.analyticsEnabled || !site.analyticsDomain || !this.analytics ||
        resource.mimeType.toLowerCase() !== "text/html") return resource;
    const html = resource.data.toString("utf8");
    if (html.includes("data-linksense-analytics")) return resource;
    const tag = this.analytics.scriptTag(site.analyticsDomain);
    if (/<\/head\s*>/iu.test(html)) {
      return { ...resource, data: Buffer.from(html.replace(/<\/head\s*>/iu, match => `${tag}${match}`)) };
    }
    const body = /<body[^>]*>/iu.exec(html);
    if (body) {
      const index = body.index + body[0].length;
      return { ...resource, data: Buffer.from(`${html.slice(0, index)}${tag}${html.slice(index)}`) };
    }
    const doctype = /^<!doctype[^>]*>/iu.exec(html);
    if (doctype) {
      const index = doctype[0].length;
      return { ...resource, data: Buffer.from(`${html.slice(0, index)}${tag}${html.slice(index)}`) };
    }
    return { ...resource, data: Buffer.from(`${tag}${html}`) };
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
        ...(request.analytics !== undefined ? { analytics: request.analytics } : {}),
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
    const analyticsUrl = result.analytics_enabled && row.site.analyticsSiteId && this.analytics
      ? this.analytics.dashboardUrl(row.site.analyticsSiteId) : undefined;
    const projected = { ...result, ...(analyticsUrl ? { analytics_url: analyticsUrl } : {}) };
    return row.site.backendId && this.backends?.client
      ? { ...projected, url: await this.backends.publishedUrl(row.site.backendId, row.site.id) }
      : projected;
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
    passcode_protected: Boolean(site.passcodeHash),
    analytics_enabled: Boolean(site.analyticsEnabled),
    url_path: webApplicationPath(site.id), conversation_id: site.conversationId, source_task_title: site.sourceTaskTitle,
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
export function withUrl(site: WebSite, publicBaseUrl: string): WebSiteWithUrl {
  const slug = webSiteSchema.shape.slug.parse(site.slug);
  // Auto-generated slugs are UUIDs: /app/s/ treats a UUID as the site id, so only a chosen slug is addressable.
  const custom = !webSiteSchema.shape.id.safeParse(slug).success;
  return webSiteWithUrlSchema.parse({
    ...site,
    url: site.url ?? new URL(site.url_path, publicBaseUrl).href,
    ...(custom ? { alias_url: new URL(`/app/s/${slug}`, publicBaseUrl).href } : {}),
  });
}
