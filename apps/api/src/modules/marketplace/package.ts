import { timingSafeEqual } from "node:crypto"

import { AppError } from "../../lib/errors.js"
import {
  hashPackageDirectory,
  listPackageDirectoryFiles,
  PackageDirectoryIntegrityError,
} from "../../lib/package-directory-integrity.js"

const MAX_REVIEW_FILE_COUNT = 1_000

export async function hashMarketplacePackage(root: string): Promise<string> {
  try {
    return await hashPackageDirectory(root, {
      maxFileCount: MAX_REVIEW_FILE_COUNT,
    })
  } catch (error) {
    if (error instanceof PackageDirectoryIntegrityError) {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
    }
    throw error
  }
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
  try {
    return await listPackageDirectoryFiles(root, {
      maxFileCount: MAX_REVIEW_FILE_COUNT,
    })
  } catch (error) {
    if (error instanceof PackageDirectoryIntegrityError) {
      throw new AppError("MARKETPLACE_RELEASE_INTEGRITY_FAILED")
    }
    throw error
  }
}
