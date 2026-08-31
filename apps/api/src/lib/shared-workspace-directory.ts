import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { workspacePermissionPolicy } from "@linksense/shared";

export class SharedWorkspaceDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedWorkspaceDirectoryError";
  }
}

export async function ensureSharedWorkspaceDirectory(
  workspaceRoot: string,
  directory: string,
): Promise<void> {
  const root = resolve(workspaceRoot);
  const target = resolve(directory);
  const relativeTarget = relative(root, target);
  if (
    !relativeTarget ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new SharedWorkspaceDirectoryError(
      "shared workspace directory boundary is invalid",
    );
  }

  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new SharedWorkspaceDirectoryError(
      "shared workspace root boundary is invalid",
    );
  }
  const canonicalRoot = await realpath(root);
  let current = root;
  for (const segment of relativeTarget.split(sep)) {
    current = join(current, segment);
    await mkdir(current, {
      mode: workspacePermissionPolicy.sharedDirectory,
    }).catch((error: unknown) => {
      if (!isNodeError(error, "EEXIST")) throw error;
    });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new SharedWorkspaceDirectoryError(
        "shared workspace directory boundary is invalid",
      );
    }
    const canonicalCurrent = await realpath(current);
    const canonicalRelative = relative(canonicalRoot, canonicalCurrent);
    if (
      !canonicalRelative ||
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(canonicalRelative)
    ) {
      throw new SharedWorkspaceDirectoryError(
        "shared workspace directory resolves outside its root",
      );
    }
    if (
      (info.mode & 0o7777) !== workspacePermissionPolicy.sharedDirectory
    ) {
      await chmod(current, workspacePermissionPolicy.sharedDirectory);
    }
  }
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
