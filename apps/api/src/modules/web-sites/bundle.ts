import { lstat, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Stats } from "node:fs";
import pLimit from "p-limit";
import { webBundleLimits, webBundleManifestSchema, type WebBundleManifest } from "@linksense/shared";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { readStableRegularFile } from "../../lib/stable-regular-file.js";
import { AppError } from "../../lib/errors.js";
import { prepareWebResource, resourceMimeType, sha256 } from "./resources.js";

export const webBundleObjectKey = (fileId: string, path: string): string =>
  `web-artifact-bundles/${fileId}/${path}`;

export async function captureWebBundle(input: {
  workspaceRoot: string; directory: string; entry: string; entryData: Buffer; fileId: string;
  storage: Pick<ObjectStorage, "putObject">;
  cleanup?(key: string): Promise<void>;
  beforeWrite?(manifest: WebBundleManifest): Promise<void>;
  signal?: AbortSignal;
}): Promise<WebBundleManifest> {
  input.signal?.throwIfAborted();
  const workspace = await realpath(input.workspaceRoot);
  const root = resolve(workspace, input.directory);
  const inside = (parent: string, path: string): boolean => path.startsWith(`${parent}${sep}`);
  if (!inside(workspace, root) || !inside(root, input.entry) || (await realpath(root)) !== root) throw new AppError("WEB_SITE_BUNDLE_INVALID");
  const raw = new Map<string, Buffer>();
  const identities = new Map<string, Stats>();
  let total = 0;
  let entries = 0;
  const walk = async (directory: string, depth = 0): Promise<void> => {
    if (depth > webBundleLimits.depth) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    const information = await lstat(directory);
    if (!information.isDirectory() || information.isSymbolicLink() || await realpath(directory) !== directory) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    identities.set(directory, information);
    for (const name of await readdir(directory)) {
      input.signal?.throwIfAborted();
      if (++entries > webBundleLimits.entries) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      if (name.startsWith(".") || name === "node_modules") throw new AppError("WEB_SITE_BUNDLE_INVALID");
      const absolute = resolve(directory, name);
      if (!inside(root, absolute)) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      if (info.isDirectory()) { await walk(absolute, depth + 1); continue; }
      if (!info.isFile() || raw.size >= webBundleLimits.files) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      const path = relative(root, absolute).split(sep).join("/");
      resourceMimeType(path);
      if (total + info.size > webBundleLimits.totalBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
      const data = await readStableRegularFile(absolute, info, {
        maximumBytes: webBundleLimits.fileBytes,
        invalidFileError: () => new AppError("WEB_SITE_BUNDLE_INVALID"),
        fileTooLargeError: () => new AppError("FILE_LIMIT_EXCEEDED"),
      });
      if (await realpath(absolute) !== absolute) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      raw.set(path, data);
      identities.set(absolute, info);
      total += data.length;
    }
  };
  await walk(root);
  // Check the whole tree again before uploading so an edit during capture
  // cannot silently mix files from different saves or swap a parent symlink.
  for (const [path, before] of identities) {
    input.signal?.throwIfAborted();
    const after = await lstat(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || await realpath(path) !== path) throw new AppError("WEB_SITE_BUNDLE_INVALID");
  }
  const entryPath = relative(root, input.entry).split(sep).join("/");
  if (!raw.get(entryPath)?.equals(input.entryData)) throw new AppError("WEB_SITE_BUNDLE_INVALID");
  const keys: string[] = [];
  try {
    const paths = new Set(raw.keys());
    const files: WebBundleManifest["files"] = [];
    const prepared = new Map<string, Buffer>();
    let preparedBytes = 0;
    for (const [path, content] of raw) {
      input.signal?.throwIfAborted();
      const data = await prepareWebResource(content, path, paths);
      preparedBytes += data.length;
      if (data.length > webBundleLimits.fileBytes || preparedBytes > webBundleLimits.totalBytes) {
        throw new AppError("WEB_SITE_BUNDLE_INVALID");
      }
      const mimeType = resourceMimeType(path);
      const key = webBundleObjectKey(input.fileId, path);
      prepared.set(key, data);
      files.push({ path, object_key: key, mime_type: mimeType, size_bytes: data.length, checksum_sha256: sha256(data) });
    }
    const parsed = webBundleManifestSchema.safeParse({ entry_path: entryPath, files });
    if (!parsed.success) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    const manifest = parsed.data;
    input.signal?.throwIfAborted();
    await input.beforeWrite?.(manifest);
    const limit = pLimit(8);
    const results = await Promise.allSettled(files.map(file => limit(async () => {
      input.signal?.throwIfAborted();
      const data = prepared.get(file.object_key);
      if (!data) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      keys.push(file.object_key);
      const args = [file.object_key, data, { "content-type": file.mime_type }] as const;
      if (input.signal) await input.storage.putObject(...args, input.signal);
      else await input.storage.putObject(...args);
    })));
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return manifest;
  } catch (error) {
    if (input.cleanup) await Promise.all(keys.map(input.cleanup));
    throw error;
  }
}
