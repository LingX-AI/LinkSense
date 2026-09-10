import { lstat, rm } from "node:fs/promises"

import {
  makeDirectoryTreeRemovable,
  type DirectoryCleanupIdentity,
} from "./workspace/filesystem.js"

export const runtimeCleanupStages = [
  "reconcile",
  "stop_runtime",
  "delete_workspace",
  "delete_control",
  "verify_absent",
] as const

export type RuntimeCleanupStage = (typeof runtimeCleanupStages)[number]

export const runtimeCleanupReasonCodes = [
  "CLEANUP_RUNNER_UNAVAILABLE",
  "CLEANUP_RUNTIME_ACTIVE",
  "CLEANUP_RUNTIME_STATE_UNCERTAIN",
  "CLEANUP_PERMISSION_DENIED",
  "CLEANUP_PATH_BOUNDARY_INVALID",
  "CLEANUP_DIRECTORY_REMOVE_FAILED",
  "CLEANUP_VERIFICATION_FAILED",
] as const

export type RuntimeCleanupReasonCode =
  (typeof runtimeCleanupReasonCodes)[number]

export class RuntimeCleanupError extends Error {
  constructor(
    readonly stage: RuntimeCleanupStage,
    readonly reasonCode: RuntimeCleanupReasonCode,
  ) {
    super(reasonCode)
    this.name = "RuntimeCleanupError"
  }
}

export type RuntimeCleanupDirectoryResult = {
  workspace: "absent" | "deleted"
  control: "absent" | "deleted"
}

type RuntimeCleanupDependencies = {
  makeRemovable?: typeof makeDirectoryTreeRemovable
  remove?: typeof rm
  inspect?: typeof lstat
}

export async function removeConversationRuntimeDirectories(
  input: {
    home: string
    workspace: string
    taskControl: string
    directoryCleanupIdentity?: DirectoryCleanupIdentity
  },
  dependencies: RuntimeCleanupDependencies = {},
): Promise<RuntimeCleanupDirectoryResult> {
  const makeRemovable =
    dependencies.makeRemovable ?? makeDirectoryTreeRemovable
  const remove = dependencies.remove ?? rm
  const inspect = dependencies.inspect ?? lstat

  await removeDirectory(
    input.home,
    "delete_workspace",
    input.directoryCleanupIdentity,
    makeRemovable,
    remove,
    inspect,
  )
  const workspace = await removeDirectory(
    input.workspace,
    "delete_workspace",
    input.directoryCleanupIdentity,
    makeRemovable,
    remove,
    inspect,
  )
  const control = await removeDirectory(
    input.taskControl,
    "delete_control",
    input.directoryCleanupIdentity,
    makeRemovable,
    remove,
    inspect,
  )
  return { workspace, control }
}

async function removeDirectory(
  target: string,
  stage: "delete_workspace" | "delete_control",
  identity: DirectoryCleanupIdentity | undefined,
  makeRemovable: typeof makeDirectoryTreeRemovable,
  remove: typeof rm,
  inspect: typeof lstat,
): Promise<"absent" | "deleted"> {
  const existed = await pathExists(target, inspect, stage)
  try {
    await makeRemovable(target, identity)
    await remove(target, { recursive: true, force: true })
  } catch (error) {
    throw cleanupFilesystemError(stage, error)
  }
  if (await pathExists(target, inspect, "verify_absent")) {
    throw new RuntimeCleanupError(
      "verify_absent",
      "CLEANUP_VERIFICATION_FAILED",
    )
  }
  return existed ? "deleted" : "absent"
}

async function pathExists(
  target: string,
  inspect: typeof lstat,
  stage: RuntimeCleanupStage,
): Promise<boolean> {
  try {
    await inspect(target)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw cleanupFilesystemError(stage, error)
  }
}

function cleanupFilesystemError(
  stage: RuntimeCleanupStage,
  error: unknown,
): RuntimeCleanupError {
  if (isNodeError(error, "EACCES") || isNodeError(error, "EPERM")) {
    return new RuntimeCleanupError(stage, "CLEANUP_PERMISSION_DENIED")
  }
  return new RuntimeCleanupError(stage, "CLEANUP_DIRECTORY_REMOVE_FAILED")
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}
