import { Readable } from "node:stream";
import { vi } from "vitest";
import type { WebBundleManifest } from "@linksense/shared";
import type { ObjectStorage } from "../src/adapters/object-storage.js";
import type { SiteAndRelease, WebSiteStore } from "../src/modules/web-sites/repository.js";
import { sha256 } from "../src/modules/web-sites/resources.js";
import { WebSiteService } from "../src/modules/web-sites/service.js";

export const ownerId = "10000000-0000-4000-8000-000000000001";
export const taskId = "20000000-0000-4000-8000-000000000001";
export const fileId = "30000000-0000-4000-8000-000000000001";
export const siteId = "40000000-0000-4000-8000-000000000001";
export const releaseId = "50000000-0000-4000-8000-000000000001";
export const now = new Date("2026-09-17T09:00:00.000Z");
export function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const storage = {
    ensureBucket: vi.fn(async () => {}), health: vi.fn(async () => {}),
    putObject: vi.fn<ObjectStorage["putObject"]>(async (key, data) => { objects.set(key, data); }),
    getObjectSize: vi.fn<ObjectStorage["getObjectSize"]>(async key => { const data = objects.get(key); if (!data) throw new Error("missing object"); return data.length; }),
    getObjectStream: vi.fn<ObjectStorage["getObjectStream"]>(async key => { const data = objects.get(key); if (!data) throw new Error("missing object"); return Readable.from([data]); }),
    getObjectRangeStream: vi.fn<ObjectStorage["getObjectRangeStream"]>(async () => { throw new Error("not used"); }),
    removeObject: vi.fn<ObjectStorage["removeObject"]>(async key => { objects.delete(key); }),
    presignedGetObject: vi.fn<ObjectStorage["presignedGetObject"]>(async () => { throw new Error("not used"); }),
  } satisfies ObjectStorage;
  return { storage, objects };
}
export function siteFixture() {
  const { storage, objects } = memoryStorage();
  const html = Buffer.from('<!doctype html><title>Sample</title><button onclick="this.textContent=42">Run</button>');
  objects.set("original/index.html", html);
  const manifest: WebBundleManifest = { entry_path: "index.html", files: [{ path: "index.html", object_key: "original/index.html", mime_type: "text/html", size_bytes: html.length, checksum_sha256: sha256(html) }] };
  const row: SiteAndRelease = {
    site: { id: siteId, ownerId, conversationId: taskId, sourceTaskTitle: "Source", originFileId: fileId, sourceFileId: fileId, name: "Sample", description: "", slug: "sample", status: "published", currentReleaseId: releaseId, createdAt: now, updatedAt: now },
    release: { id: releaseId, siteId, sourceFileId: fileId, manifestJson: manifest, createdAt: now },
  };
  const source: Awaited<ReturnType<WebSiteStore["source"]>> = {
    conversation: { id: taskId, title: "Source" },
    file: { id: fileId, conversationId: taskId, filename: "index.html", mimeType: "text/html", minioObjectKey: "original/index.html", checksumSha256: sha256(html), sizeBytes: BigInt(html.length) },
    bundle: null,
  };
  const store = {
    list: vi.fn<WebSiteStore["list"]>(async () => [row]),
    owned: vi.fn<WebSiteStore["owned"]>(async () => row),
    publicSite: vi.fn<WebSiteStore["publicSite"]>(async () => row),
    source: vi.fn<WebSiteStore["source"]>(async () => source),
    sources: vi.fn<WebSiteStore["sources"]>(async () => [{ id: fileId, filename: "index.html", created_at: now.toISOString() }]),
    create: vi.fn<WebSiteStore["create"]>(async () => row),
    update: vi.fn<WebSiteStore["update"]>(async () => row),
    publish: vi.fn<WebSiteStore["publish"]>(async () => row),
    delete: vi.fn<WebSiteStore["delete"]>(async () => {}),
  } satisfies WebSiteStore;
  return { storage, objects, manifest, row, source, store, html, service: new WebSiteService(store, storage) };
}
