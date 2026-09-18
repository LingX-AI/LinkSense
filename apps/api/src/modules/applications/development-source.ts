import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import JSZip from "jszip";
import {
  applicationSourceDirectorySchema,
  INTERACTIVE_APPLICATION_ENTRY_MAX_BYTES,
  INTERACTIVE_APPLICATION_ENTRY_MAX_COUNT,
  INTERACTIVE_APPLICATION_EXPANDED_MAX_BYTES,
  type InteractiveApplicationManifest,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { readStableRegularFile } from "../../lib/stable-regular-file.js";
import { inspectInteractiveApplicationArchive } from "./interactive-package.js";

export interface ApplicationSourceSnapshot {
  hash: string;
  manifest: InteractiveApplicationManifest;
  files: ReadonlyMap<string, Buffer>;
  archive(version?: string): Promise<Buffer>;
}

export async function buildApplicationSourceArchive(files: ReadonlyMap<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, bytes] of files) zip.file(path, bytes, { date: new Date("1980-01-01T00:00:00Z"), createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Capture only deployable files, never credentials, dependencies or symlinks. */
export async function readApplicationSource(workspaceRoot: string, directory: string): Promise<ApplicationSourceSnapshot> {
  const parsed = applicationSourceDirectorySchema.safeParse(directory);
  if (!parsed.success) throw invalidSource();
  const workspace = await realpath(workspaceRoot);
  const root = resolve(workspace, parsed.data);
  const inside = (path: string) => path.startsWith(`${root}${sep}`);
  if (!root.startsWith(`${workspace}${sep}`) || await realpath(root) !== root) throw invalidSource();
  const files = new Map<string, Buffer>();
  const versions: Array<{ path: string; size: number; mtimeMs: number; ctimeMs: number; ino: number }> = [];
  let total = 0;
  let directories = 0;
  const walk = async (current: string): Promise<void> => {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current || ++directories > 200) throw invalidSource();
    versions.push({ path: current, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino });
    for (const name of (await readdir(current)).sort()) {
      if (name.startsWith(".") || name === "node_modules") throw invalidSource();
      const path = resolve(current, name);
      if (!inside(path)) throw invalidSource();
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw invalidSource();
      if (stats.isDirectory()) { await walk(path); continue; }
      if (!stats.isFile() || files.size >= INTERACTIVE_APPLICATION_ENTRY_MAX_COUNT) throw invalidSource();
      total += stats.size;
      if (total > INTERACTIVE_APPLICATION_EXPANDED_MAX_BYTES) throw invalidSource();
      const data = await readStableRegularFile(path, stats, {
        maximumBytes: INTERACTIVE_APPLICATION_ENTRY_MAX_BYTES,
        invalidFileError: invalidSource,
        fileTooLargeError: invalidSource,
      });
      if (await realpath(path) !== path) throw invalidSource();
      files.set(relative(root, path).split(sep).join("/"), data);
      versions.push({ path, size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, ino: stats.ino });
    }
  };
  await walk(root);
  for (const before of versions) {
    const after = await lstat(before.path);
    if (after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino) throw invalidSource();
  }
  const archive = async (version?: string): Promise<Buffer> => {
    const contents = new Map(files);
    if (version) contents.set("manifest.json", Buffer.from(JSON.stringify({ ...manifest, version })));
    return buildApplicationSourceArchive(contents);
  };
  // Use the import validator as the single application-package contract.
  const prepared = await inspectInteractiveApplicationArchive(await archive());
  const manifest = prepared.manifest;
  const digest = createHash("sha256");
  for (const [name, data] of files) digest.update(`${name}\0${data.length}\0`).update(data);
  return { hash: digest.digest("hex"), manifest, files, archive };
}

function invalidSource(): AppError { return new AppError("APPLICATION_PACKAGE_INVALID"); }
