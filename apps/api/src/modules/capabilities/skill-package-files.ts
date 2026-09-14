import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import JSZip from "jszip";
import { Open } from "unzipper";
import type { SkillPackageChanges } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { DEFAULT_CAPABILITY_PACKAGE_LIMITS, listRegularFiles } from "./importer.js";
import type { CapabilityRecord } from "./types.js";

export interface SkillPackageFile {
  path: string;
  size_bytes: number;
  sha256: string;
  executable: boolean;
}

/** Callers hold the capability mutation lock while reading the current package. */
export async function readSkillPackageFiles(root: string): Promise<SkillPackageFile[]> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError("INVALID_PACKAGE");
  const limits = DEFAULT_CAPABILITY_PACKAGE_LIMITS;
  const paths = await listRegularFiles(root, root, limits.entryCount);
  const files: SkillPackageFile[] = [];
  let total = 0;
  for (const filename of paths.sort()) {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > limits.entryBytes) throw new AppError("INVALID_PACKAGE");
    total += info.size;
    if (total > limits.totalExpandedBytes) throw new AppError("INVALID_PACKAGE");
    const bytes = await readFile(filename);
    if (bytes.length !== info.size) throw new AppError("INVALID_PACKAGE");
    files.push({
      path: relative(root, filename).replaceAll(sep, "/"),
      size_bytes: info.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      executable: (info.mode & 0o111) !== 0,
    });
  }
  return files;
}

export function skillPackageRevision(capability: CapabilityRecord, files: readonly SkillPackageFile[]): string {
  return createHash("sha256").update(JSON.stringify({
    name: capability.name,
    display_name: capability.displayName ?? null,
    description: capability.description,
    files,
  })).digest("hex");
}

export function compareSkillPackageFiles(before: readonly SkillPackageFile[], after: readonly SkillPackageFile[]): SkillPackageChanges {
  const previous = new Map(before.map((file) => [file.path, file]));
  const next = new Map(after.map((file) => [file.path, file]));
  const changes: SkillPackageChanges = { added: [], modified: [], deleted: [], unchanged_count: 0 };
  for (const file of after) {
    const old = previous.get(file.path);
    if (!old) changes.added.push(file.path);
    else if (old.sha256 !== file.sha256 || old.executable !== file.executable) changes.modified.push(file.path);
    else changes.unchanged_count++;
  }
  for (const file of before) if (!next.has(file.path)) changes.deleted.push(file.path);
  return changes;
}

export async function exportSkillPackage(root: string, name: string, files: readonly SkillPackageFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(`${name}/${file.path}`, await readFile(join(root, file.path)), {
      createFolders: false,
      unixPermissions: file.executable ? 0o100700 : 0o100600,
    });
  }
  const generate = () => zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" });
  let bytes = await generate();
  // Highly compressible resources must still pass the existing ZIP admission rules.
  const archive = await Open.buffer(bytes);
  let regenerate = false;
  for (const entry of archive.files) {
    if (entry.uncompressedSize / Math.max(1, entry.compressedSize) > DEFAULT_CAPABILITY_PACKAGE_LIMITS.compressionRatio) {
      const file = zip.file(entry.path);
      if (file === null) throw new AppError("INVALID_PACKAGE");
      zip.file(entry.path, await file.async("nodebuffer"), { createFolders: false, unixPermissions: file.unixPermissions ?? 0o100600, compression: "STORE" });
      regenerate = true;
    }
  }
  if (regenerate) bytes = await generate();
  if (bytes.length > DEFAULT_CAPABILITY_PACKAGE_LIMITS.archiveBytes) throw new AppError("INVALID_PACKAGE");
  return bytes;
}
