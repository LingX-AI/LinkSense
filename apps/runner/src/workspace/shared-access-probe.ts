import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, chown, lstat, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import {
  linksenseRuntimeIdentity,
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
  workspacePermissionPolicy,
} from "@linksense/shared"

export {
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
} from "@linksense/shared"

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js"

type SharedAccessProbeDependencies = {
  runTaskWriter?: typeof runTaskWriter
}

type ManagedProjectionProbeDependencies = {
  runTaskReader?: typeof runTaskReader
}

type ManagedProjectionBoundaryOptions = {
  requireExactOwnership?: boolean
}

type ManagedProjectionRepairDependencies = {
  lstat?: typeof lstat
  chown?: typeof chown
}

const execFileAsync = promisify(execFile)

export class SharedWorkspaceAccessProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SharedWorkspaceAccessProbeError"
  }
}

export class ManagedProjectionAccessProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ManagedProjectionAccessProbeError"
  }
}

export async function assertManagedProjectionBoundary(
  managedAgentsRoot: string,
  apiIdentity: ProcessIdentity = {
    uid: linksenseRuntimeIdentity.apiUid,
    gid: linksenseRuntimeIdentity.sharedGid,
  },
  options: ManagedProjectionBoundaryOptions = {},
): Promise<void> {
  const markerPath = path.join(
    managedAgentsRoot,
    managedProjectionProbeFileName,
  )
  const [rootInfo, markerInfo] = await Promise.all([
    lstat(managedAgentsRoot),
    lstat(markerPath),
  ])
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    ((options.requireExactOwnership ?? true) &&
      (rootInfo.uid !== apiIdentity.uid ||
        rootInfo.gid !== apiIdentity.gid)) ||
    (rootInfo.mode & 0o7777) !== 0o750 ||
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    ((options.requireExactOwnership ?? true) &&
      (markerInfo.uid !== apiIdentity.uid ||
        markerInfo.gid !== apiIdentity.gid)) ||
    (markerInfo.mode & 0o7777) !== 0o640 ||
    markerInfo.size > 128
  ) {
    throw new ManagedProjectionAccessProbeError(
      "managed projection boundary is invalid",
    )
  }
  if ((await readFile(markerPath, "utf8")) !== managedProjectionProbeContents) {
    throw new ManagedProjectionAccessProbeError(
      "managed projection marker contents are invalid",
    )
  }
}

export async function repairRootOwnedManagedProjectionBoundary(
  managedAgentsRoot: string,
  apiIdentity: ProcessIdentity = {
    uid: linksenseRuntimeIdentity.apiUid,
    gid: linksenseRuntimeIdentity.sharedGid,
  },
  dependencies: ManagedProjectionRepairDependencies = {},
): Promise<void> {
  const runLstat = dependencies.lstat ?? lstat
  const runChown = dependencies.chown ?? chown
  const markerPath = path.join(
    managedAgentsRoot,
    managedProjectionProbeFileName,
  )
  const [rootInfo, markerInfo] = await Promise.all([
    runLstat(managedAgentsRoot),
    runLstat(markerPath),
  ])
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (rootInfo.mode & 0o7777) !== 0o750 ||
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    (markerInfo.mode & 0o7777) !== 0o640 ||
    markerInfo.size > 128
  ) {
    throw new ManagedProjectionAccessProbeError(
      "managed projection boundary is invalid",
    )
  }
  if (
    !isApiOrRootOwned(rootInfo, apiIdentity) ||
    !isApiOrRootOwned(markerInfo, apiIdentity)
  ) {
    throw new ManagedProjectionAccessProbeError(
      "managed projection owner is invalid",
    )
  }
  if ((await readFile(markerPath, "utf8")) !== managedProjectionProbeContents) {
    throw new ManagedProjectionAccessProbeError(
      "managed projection marker contents are invalid",
    )
  }
  if (rootInfo.uid !== apiIdentity.uid || rootInfo.gid !== apiIdentity.gid) {
    await runChown(managedAgentsRoot, apiIdentity.uid, apiIdentity.gid)
  }
  if (markerInfo.uid !== apiIdentity.uid || markerInfo.gid !== apiIdentity.gid) {
    await runChown(markerPath, apiIdentity.uid, apiIdentity.gid)
  }
  // Keep the persisted mode explicit after a Docker Desktop fakeowner repair.
  await chmod(managedAgentsRoot, 0o750)
  await chmod(markerPath, 0o640)
}

export async function verifyManagedProjectionAccess(
  projectedAgentsRoot: string,
  taskIdentity: ProcessIdentity = {
    uid: linksenseRuntimeIdentity.taskUid,
    gid: linksenseRuntimeIdentity.sharedGid,
  },
  dependencies: ManagedProjectionProbeDependencies = {},
): Promise<void> {
  const markerPath = path.join(
    projectedAgentsRoot,
    managedProjectionProbeFileName,
  )
  const [rootInfo, markerInfo] = await Promise.all([
    lstat(projectedAgentsRoot),
    lstat(markerPath),
  ])
  // The controller verifies API ownership before publishing the projection.
  // Inside Docker Desktop, bind mounts may report remapped UIDs, so the worker
  // verifies the effective task identity by actually reading the marker and
  // treats the shared GID and exact modes as the portable mount contract.
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    rootInfo.gid !== taskIdentity.gid ||
    (rootInfo.mode & 0o7777) !== 0o750 ||
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    markerInfo.gid !== taskIdentity.gid ||
    (markerInfo.mode & 0o7777) !== 0o640
  ) {
    throw new ManagedProjectionAccessProbeError(
      "managed projection permissions are invalid",
    )
  }
  await (dependencies.runTaskReader ?? runTaskReader)(
    markerPath,
    taskIdentity,
  )
}

function isApiOrRootOwned(
  info: { uid: number; gid: number },
  apiIdentity: ProcessIdentity,
): boolean {
  return (
    (info.uid === apiIdentity.uid && info.gid === apiIdentity.gid) ||
    (info.uid === 0 && info.gid === 0)
  )
}

export async function verifySharedWorkspaceAccess(
  workspacesRoot: string,
  taskIdentity: ProcessIdentity = {
    uid: linksenseRuntimeIdentity.taskUid,
    gid: linksenseRuntimeIdentity.sharedGid,
  },
  dependencies: SharedAccessProbeDependencies = {},
): Promise<void> {
  const rootInfo = await lstat(workspacesRoot)
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    rootInfo.gid !== taskIdentity.gid ||
    (rootInfo.mode & 0o7777) !== workspacePermissionPolicy.sharedDirectory
  ) {
    throw new SharedWorkspaceAccessProbeError(
      "shared workspace root permissions are invalid",
    )
  }

  const probeDirectory = path.join(
    workspacesRoot,
    `.linksense-access-probe-${randomUUID()}`,
  )
  const probeFile = path.join(probeDirectory, "task-output")
  try {
    await (dependencies.runTaskWriter ?? runTaskWriter)(
      probeDirectory,
      probeFile,
      taskIdentity,
    )
    const [directoryInfo, fileInfo, contents] = await Promise.all([
      lstat(probeDirectory),
      lstat(probeFile),
      readFile(probeFile, "utf8"),
    ])
    // The child verifies its own uid/gid before writing. Validate the resulting
    // access contract here instead of the reported uid: Docker Desktop bind
    // mounts can remap a correctly isolated writer's new entries to uid 0.
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      directoryInfo.gid !== taskIdentity.gid ||
      (directoryInfo.mode & 0o7777) !==
        workspacePermissionPolicy.sharedDirectory ||
      !fileInfo.isFile() ||
      fileInfo.isSymbolicLink() ||
      fileInfo.gid !== taskIdentity.gid ||
      (fileInfo.mode & 0o777) !==
        workspacePermissionPolicy.sharedReadableFile ||
      contents !== "linksense-shared-access\n"
    ) {
      throw new SharedWorkspaceAccessProbeError(
        "cross-identity shared workspace access is invalid",
      )
    }
  } finally {
    await rm(probeDirectory, { recursive: true, force: true })
  }
}

async function runTaskWriter(
  probeDirectory: string,
  probeFile: string,
  identity: ProcessIdentity,
): Promise<void> {
  const invocation = isolatedChildInvocation(
    process.execPath,
    [
      "-e",
      [
        "const fs = require('node:fs')",
        "const directory = process.argv[1]",
        "const file = process.argv[2]",
        `if (process.getuid?.() !== ${String(identity.uid)} || process.getgid?.() !== ${String(identity.gid)}) throw new Error('task identity transition failed')`,
        `fs.mkdirSync(directory, { mode: ${String(workspacePermissionPolicy.sharedDirectory)} })`,
        `fs.chmodSync(directory, ${String(workspacePermissionPolicy.sharedDirectory)})`,
        `fs.writeFileSync(file, 'linksense-shared-', { flag: 'wx', mode: ${String(workspacePermissionPolicy.sharedReadableFile)} })`,
        "fs.appendFileSync(file, 'access\\n')",
        `fs.chmodSync(file, ${String(workspacePermissionPolicy.sharedReadableFile)})`,
      ].join("\n"),
      probeDirectory,
      probeFile,
    ],
    identity,
  )
  await execFileAsync(invocation.command, invocation.args, {
    timeout: 10_000,
    env: {},
  })
}

async function runTaskReader(
  markerPath: string,
  identity: ProcessIdentity,
): Promise<void> {
  const invocation = isolatedChildInvocation(
    process.execPath,
    [
      "-e",
      [
        "const fs = require('node:fs')",
        "const marker = process.argv[1]",
        `if (process.getuid?.() !== ${String(identity.uid)} || process.getgid?.() !== ${String(identity.gid)}) throw new Error('task identity transition failed')`,
        `if (fs.readFileSync(marker, 'utf8') !== ${JSON.stringify(managedProjectionProbeContents)}) throw new Error('managed projection marker contents are invalid')`,
      ].join("\n"),
      markerPath,
    ],
    identity,
  )
  await execFileAsync(invocation.command, invocation.args, {
    timeout: 10_000,
    env: {},
  })
}
