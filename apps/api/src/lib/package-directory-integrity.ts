import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export class PackageDirectoryIntegrityError extends Error {
  constructor() {
    super("package_directory_integrity_failed");
    this.name = "PackageDirectoryIntegrityError";
  }
}

export async function hashPackageDirectory(
  root: string,
  options: { maxFileCount?: number } = {},
): Promise<string> {
  const absoluteRoot = resolve(root);
  const files = await listPackageDirectoryFiles(absoluteRoot, options);
  const hash = createHash("sha256");
  hash.update("linksense-marketplace-release\n");
  for (const file of files) {
    const absolutePath = join(absoluteRoot, file);
    const info = await lstat(absolutePath);
    const bytes = await readFile(absolutePath);
    hash.update(`file\0${file}\0${info.mode & 0o111 ? "x" : "-"}\0`);
    hash.update(String(bytes.byteLength));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function listPackageDirectoryFiles(
  root: string,
  options: { maxFileCount?: number } = {},
): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const maxFileCount = options.maxFileCount ?? 1_000;
  if (!Number.isInteger(maxFileCount) || maxFileCount < 1) {
    throw new PackageDirectoryIntegrityError();
  }
  const rootInfo = await lstat(absoluteRoot).catch(() => null);
  if (
    rootInfo === null ||
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink()
  ) {
    throw new PackageDirectoryIntegrityError();
  }
  const files = await listFiles(absoluteRoot, absoluteRoot, maxFileCount);
  if (files.length === 0 || files.length > maxFileCount) {
    throw new PackageDirectoryIntegrityError();
  }
  return files.sort();
}

export function packageDigestMatches(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function listFiles(
  directory: string,
  root: string,
  maxFileCount: number,
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assertPathWithin(root, path);
    if (entry.isSymbolicLink()) {
      throw new PackageDirectoryIntegrityError();
    }
    if (entry.isDirectory()) {
      result.push(...(await listFiles(path, root, maxFileCount)));
    } else if (entry.isFile()) {
      result.push(relative(root, path).split(sep).join("/"));
    } else {
      throw new PackageDirectoryIntegrityError();
    }
    if (result.length > maxFileCount) {
      throw new PackageDirectoryIntegrityError();
    }
  }
  return result;
}

function assertPathWithin(root: string, target: string): void {
  const fromRoot = relative(resolve(root), resolve(target));
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(".." + sep) ||
    isAbsolute(fromRoot)
  ) {
    throw new PackageDirectoryIntegrityError();
  }
}
