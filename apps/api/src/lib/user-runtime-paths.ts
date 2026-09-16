import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";
import { projectWorkspacePath, userWorkspacePathSchema, runtimeEnvironmentPath, type RuntimePlacement } from "@linksense/shared";

const uuidSchema = z.uuid();

export class UserRuntimePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserRuntimePathError";
  }
}

export function projectWorkspaceRelativePath(
  ownerId: string,
  projectId: string | null,
): string {
  return `${normalizeUuid(ownerId, "ownerId")}/home/${projectWorkspacePath(projectId)}`;
}

export function userWorkspacePath(ownerId: string, workspaceRelPath: string): string {
  return runtimePlacementForWorkspace(ownerId, workspaceRelPath).workspacePath;
}

export function serviceWorkspaceRelativePath(ownerId: string, serviceEnvironmentId: string): string {
  return `${runtimeEnvironmentPath(ownerId, serviceEnvironmentId)}/home/workspace`;
}

export function runtimePlacementForWorkspace(ownerId: string, workspaceRelPath: string): RuntimePlacement {
  const owner = normalizeUuid(ownerId, "ownerId");
  const service = workspaceRelPath.startsWith(`${owner}/services/`)
    ? workspaceRelPath.split("/")[2] : undefined;
  const prefix = `${runtimeEnvironmentPath(owner, service)}/home/`;
  if (!workspaceRelPath.startsWith(prefix)) throw new UserRuntimePathError("workspace belongs to another user");
  const parsed = userWorkspacePathSchema.safeParse(workspaceRelPath.slice(prefix.length));
  if (!parsed.success) throw new UserRuntimePathError("invalid project workspace");
  if (service && parsed.data !== "workspace") throw new UserRuntimePathError("invalid application workspace");
  return { workspacePath: parsed.data, ...(service ? { serviceSessionId: service } : {}) };
}

export function resolveConversationWorkspaceRoot(
  workspaceRoot: string,
  ownerId: string,
  workspaceRelPath: string,
): string {
  const root = resolve(workspaceRoot);
  const candidate = resolve(
    root,
    runtimeEnvironmentPath(ownerId, runtimePlacementForWorkspace(ownerId, workspaceRelPath).serviceSessionId),
    "home", userWorkspacePath(ownerId, workspaceRelPath),
  );
  assertDescendant(root, candidate, false);
  return candidate;
}

export function resolveConversationWorkspaceEntry(
  workspaceRoot: string,
  ownerId: string,
  workspaceRelPath: string,
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
    workspaceRelPath,
  );
  const candidate = resolve(root, workspaceRelativePath);
  assertDescendant(root, candidate, false);
  return candidate;
}

export function assertConversationWorkspacePath(
  workspaceRoot: string,
  ownerId: string,
  workspaceRelPath: string,
  candidate: string,
  options: { allowRoot?: boolean } = {},
): string {
  if (!isAbsolute(candidate)) {
    throw new UserRuntimePathError("workspace path must be absolute");
  }
  const root = resolveConversationWorkspaceRoot(
    workspaceRoot,
    ownerId,
    workspaceRelPath,
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
      "workspace path is outside its project root",
    );
  }
}

export function serviceSessionForWorkspace(ownerId: string, workspaceRelPath: string | undefined): string {
  if (!workspaceRelPath) throw new UserRuntimePathError("missing service workspace");
  const serviceSessionId = runtimePlacementForWorkspace(ownerId, workspaceRelPath).serviceSessionId;
  if (!serviceSessionId) throw new UserRuntimePathError("application service requires a service environment");
  return serviceSessionId;
}
