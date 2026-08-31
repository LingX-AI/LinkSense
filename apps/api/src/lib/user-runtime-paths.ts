import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

const uuidSchema = z.uuid();

export class UserRuntimePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserRuntimePathError";
  }
}

export function conversationWorkspaceRelativePath(
  ownerId: string,
  conversationId: string,
): string {
  return `${normalizeUuid(ownerId, "ownerId")}/home/workspaces/${normalizeUuid(
    conversationId,
    "conversationId",
  )}`;
}

export function resolveConversationWorkspaceRoot(
  workspaceRoot: string,
  ownerId: string,
  conversationId: string,
): string {
  const root = resolve(workspaceRoot);
  const candidate = resolve(
    root,
    conversationWorkspaceRelativePath(ownerId, conversationId),
  );
  assertDescendant(root, candidate, false);
  return candidate;
}

export function resolveConversationWorkspaceEntry(
  workspaceRoot: string,
  ownerId: string,
  conversationId: string,
  workspaceRelativePath: string,
): string {
  if (!workspaceRelativePath || isAbsolute(workspaceRelativePath)) {
    throw new UserRuntimePathError(
      "workspace-relative path must be a non-empty relative path",
    );
  }
  const root = resolveConversationWorkspaceRoot(
    workspaceRoot,
    ownerId,
    conversationId,
  );
  const candidate = resolve(root, workspaceRelativePath);
  assertDescendant(root, candidate, false);
  return candidate;
}

export function assertConversationWorkspacePath(
  workspaceRoot: string,
  ownerId: string,
  conversationId: string,
  candidate: string,
  options: { allowRoot?: boolean } = {},
): string {
  if (!isAbsolute(candidate)) {
    throw new UserRuntimePathError("workspace path must be absolute");
  }
  const root = resolveConversationWorkspaceRoot(
    workspaceRoot,
    ownerId,
    conversationId,
  );
  const normalized = resolve(candidate);
  assertDescendant(root, normalized, options.allowRoot ?? false);
  return normalized;
}

function normalizeUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new UserRuntimePathError(`${label} must be a UUID`);
  }
  return parsed.data.toLowerCase();
}

function assertDescendant(
  root: string,
  candidate: string,
  allowRoot: boolean,
): void {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  if (
    (!allowRoot && !pathFromRoot) ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new UserRuntimePathError(
      "workspace path is outside its conversation root",
    );
  }
}
