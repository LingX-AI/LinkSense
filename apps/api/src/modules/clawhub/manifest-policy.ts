import type { ClawHubInstallBlockReason } from "@linksense/shared";

import {
  CLAWHUB_FILE_BYTE_LIMIT,
  CLAWHUB_VERSION_FILE_COUNT_LIMIT,
  CLAWHUB_VERSION_TOTAL_BYTE_LIMIT,
  type ClawHubVersionFile,
} from "./types.js";

export interface ClawHubManifestInspection {
  totalFileBytes: number;
  installBlockReason: ClawHubInstallBlockReason | null;
}

export function inspectClawHubManifest(
  files: readonly ClawHubVersionFile[],
): ClawHubManifestInspection {
  if (files.length === 0) {
    return {
      totalFileBytes: 0,
      installBlockReason: "files_unavailable",
    };
  }
  const normalizedPaths = new Set<string>();
  let totalFileBytes = 0;
  let hasUnsafePath = false;
  let exceedsInstallLimits =
    files.length > CLAWHUB_VERSION_FILE_COUNT_LIMIT;

  for (const file of files) {
    if (!isSafeRelativeManifestPath(file.path)) {
      hasUnsafePath = true;
    }
    const collisionKey = file.path.normalize("NFC").toLowerCase();
    if (normalizedPaths.has(collisionKey)) {
      hasUnsafePath = true;
    }
    normalizedPaths.add(collisionKey);

    if (file.size > CLAWHUB_FILE_BYTE_LIMIT) {
      exceedsInstallLimits = true;
    }
    totalFileBytes = saturatingSafeIntegerAdd(totalFileBytes, file.size);
    if (totalFileBytes > CLAWHUB_VERSION_TOTAL_BYTE_LIMIT) {
      exceedsInstallLimits = true;
    }
  }

  return {
    totalFileBytes,
    installBlockReason: hasUnsafePath
      ? "manifest_unsafe"
      : exceedsInstallLimits
        ? "manifest_too_large"
        : null,
  };
}

function saturatingSafeIntegerAdd(left: number, right: number): number {
  return right > Number.MAX_SAFE_INTEGER - left
    ? Number.MAX_SAFE_INTEGER
    : left + right;
}

function isSafeRelativeManifestPath(path: string): boolean {
  const segments = path.split("/");
  return !(
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    hasAsciiControlCharacters(path) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    /^[a-zA-Z]:/u.test(path)
  );
}

function hasAsciiControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}
