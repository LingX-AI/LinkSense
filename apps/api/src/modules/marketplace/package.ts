import { createHash, timingSafeEqual } from "node:crypto"
import { lstat, readFile, readdir } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

import { AppError } from "../../lib/errors.js"

const MAX_REVIEW_FILE_COUNT = 1_000

export async function hashMarketplacePackage(root: string): Promise<string> {
  const absoluteRoot = resolve(root)
  const files = await listMarketplacePackageFiles(absoluteRoot)
  const hash = createHash("sha256")
  hash.update("linksense-marketplace-release\n")
  for (const file of files) {
    const absolutePath = join(absoluteRoot, file)
    const info = await lstat(absolutePath)
    const bytes = await readFile(absolutePath)
    hash.update(`file\0${file}\0${info.mode & 0o111 ? "x" : "-"}\0`)
    hash.update(String(bytes.byteLength))
    hash.update("\0")
    hash.update(bytes)
    hash.update("\0")
  }
  return hash.digest("hex")
}

export async function assertMarketplacePackageIntegrity(
  root: string,
  expectedSha256: string,
): Promise<void> {
  const actual = await hashMarketplacePackage(root)
  const actualBytes = Buffer.from(actual, "hex")
  const expectedBytes = Buffer.from(expectedSha256, "hex")
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
  }
}

export async function listMarketplacePackageFiles(
  root: string,
): Promise<string[]> {
  const absoluteRoot = resolve(root)
  const rootInfo = await lstat(absoluteRoot).catch(() => null)
  if (
    rootInfo === null ||
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink()
  ) {
    throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
  }
  const files = await listFiles(absoluteRoot, absoluteRoot)
  if (files.length === 0 || files.length > MAX_REVIEW_FILE_COUNT) {
    throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
  }
  return files.sort()
}

async function listFiles(directory: string, root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    assertPathWithin(root, path)
    if (entry.isSymbolicLink()) {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
    }
    if (entry.isDirectory()) {
      result.push(...(await listFiles(path, root)))
    } else if (entry.isFile()) {
      result.push(relative(root, path).split(sep).join("/"))
    } else {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
    }
    if (result.length > MAX_REVIEW_FILE_COUNT) {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
    }
  }
  return result
}

function assertPathWithin(root: string, target: string): void {
  const fromRoot = relative(resolve(root), resolve(target))
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(".." + sep) ||
    isAbsolute(fromRoot)
  ) {
    throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
  }
}
