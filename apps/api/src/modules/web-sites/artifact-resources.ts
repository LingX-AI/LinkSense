import { webBundleManifestSchema, type WebBundleManifest } from "@linksense/shared";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { AppError } from "../../lib/errors.js";
import type { WebSiteStore } from "./repository.js";
import { prepareWebResource, readResource, sha256 } from "./resources.js";
import { inlineSvgSprites } from "./svg-sprites.js";

/** The immutable resource reader shared by authenticated previews and published releases. */
export class WebArtifactResources {
  constructor(private readonly store: Pick<WebSiteStore, "source">, private readonly storage: ObjectStorage) {}

  async source(ownerId: string, conversationId: string | null, fileId: string): Promise<{ manifest: WebBundleManifest; sourceTitle: string; conversationId: string }> {
    const { conversation, file, bundle } = await this.store.source(ownerId, conversationId, fileId);
    if (bundle) return { manifest: webBundleManifestSchema.parse(bundle.manifestJson), sourceTitle: conversation.title, conversationId: conversation.id };
    if (!file.minioObjectKey) throw new AppError("WEB_SITE_SOURCE_UNAVAILABLE");
    const data = await readResource(await this.storage.getObjectStream(file.minioObjectKey), Number(file.sizeBytes));
    if (file.checksumSha256 && sha256(data) !== file.checksumSha256) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    return { sourceTitle: conversation.title, conversationId: conversation.id, manifest: webBundleManifestSchema.parse({ entry_path: "index.html", files: [{
      path: "index.html", object_key: file.minioObjectKey, mime_type: "text/html", size_bytes: data.length, checksum_sha256: sha256(data),
    }] }) };
  }

  async read(file: WebBundleManifest["files"][number]): Promise<Buffer> {
    const data = await readResource(await this.storage.getObjectStream(file.object_key), file.size_bytes);
    if (sha256(data) !== file.checksum_sha256) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    return data;
  }

  async resource(manifest: WebBundleManifest, path: string, missing?: Set<string>): Promise<{ data: Buffer; mimeType: string }> {
    const normalized = path.endsWith("/") ? `${path}index.html` : path;
    const file = manifest.files.find(candidate => candidate.path === normalized);
    if (!file) throw new AppError("WEB_SITE_NOT_FOUND");
    const paths = new Set(manifest.files.map(asset => asset.path));
    let data = await prepareWebResource(await this.read(file), file.path, paths, missing);
    if (/\.html?$/iu.test(file.path)) data = await inlineSvgSprites(data, file.path, async target => {
      const sprite = manifest.files.find(candidate => candidate.path === target && candidate.mime_type === "image/svg+xml");
      if (!sprite) {
        if (missing) { if (missing.size < 50) missing.add(target.slice(0, 240)); return null; }
        throw new AppError("WEB_SITE_RESOURCES_MISSING");
      }
      return this.read(sprite);
    });
    return { data, mimeType: file.mime_type };
  }
}
