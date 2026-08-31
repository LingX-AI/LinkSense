import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  repairTaskOwnedRegularFileIfExists,
  repairWorkspacePermissionsOnce,
  workspacePermissionMarkerName,
} from "../src/controller/workspace-permission-repair.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("workspace permission repair", () => {
  it("repairs legacy shared directories and files exactly once without following links", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-permission-repair-"),
    )
    roots.push(root)
    const workspacesRoot = path.join(root, "workspaces")
    const controlRoot = path.join(root, "control")
    const workspace = path.join(workspacesRoot, "conversation")
    const artifact = path.join(workspace, "artifact.png")
    const executable = path.join(workspace, "script.sh")
    const outside = path.join(root, "outside")
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(controlRoot),
      mkdir(outside),
    ])
    await Promise.all([
      writeFile(artifact, "image"),
      writeFile(executable, "#!/bin/sh\n"),
      writeFile(path.join(outside, "untouched"), "outside"),
    ])
    await chmod(workspace, 0o755)
    await chmod(artifact, 0o600)
    await chmod(executable, 0o700)
    await symlink(outside, path.join(workspace, "linked"), "dir")
    const identities = {
      apiUid: process.getuid!(),
      taskUid: process.getuid!(),
      sharedGid: process.getgid!(),
    }
    const markerPath = path.join(controlRoot, workspacePermissionMarkerName)

    const first = await repairWorkspacePermissionsOnce({
      workspacesRoot,
      markerPath,
      identities,
    })
    const second = await repairWorkspacePermissionsOnce({
      workspacesRoot,
      markerPath,
      identities,
    })

    expect(first).toMatchObject({
      applied: true,
      summary: {
        directories: 2,
        files: 2,
        skippedLinks: 1,
      },
    })
    expect(second).toEqual({
      applied: false,
      summary: {
        directories: 0,
        files: 0,
        normalizedOwners: 0,
        skippedLinks: 0,
        skippedSpecialEntries: 0,
      },
    })
    expect((await lstat(workspacesRoot)).mode & 0o7777).toBe(0o2770)
    expect((await lstat(workspace)).mode & 0o7777).toBe(0o2770)
    expect((await lstat(artifact)).mode & 0o777).toBe(0o640)
    expect((await lstat(executable)).mode & 0o777).toBe(0o750)
    expect((await lstat(path.join(outside, "untouched"))).mode & 0o777).not.toBe(
      0o640,
    )
    expect(await readFile(markerPath, "utf8")).toBe("1\n")
    expect((await lstat(markerPath)).mode & 0o777).toBe(0o600)
  })

  it("forces managed Codex files back to the task owner", async () => {
    const target = "/users/owner/home/.codex/config.toml"
    const identities = {
      apiUid: 1000,
      taskUid: 1001,
      sharedGid: 1000,
    }
    const changeOwner = vi.fn(async () => undefined)
    const changeMode = vi.fn(async () => undefined)

    await expect(
      repairTaskOwnedRegularFileIfExists(
        target,
        identities,
        0o660,
        {
          lstat: vi.fn(async () => ({
            isFile: () => true,
            isSymbolicLink: () => false,
            uid: identities.apiUid,
            gid: identities.sharedGid,
            mode: 0o100600,
          })) as unknown as typeof lstat,
          chown: changeOwner,
          chmod: changeMode,
        },
      ),
    ).resolves.toBe(true)

    expect(changeOwner).toHaveBeenCalledWith(
      target,
      identities.taskUid,
      identities.sharedGid,
    )
    expect(changeMode).toHaveBeenCalledWith(target, 0o660)
  })

  it("repairs a stale marker instead of preventing the controller from starting", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-permission-stale-marker-"),
    )
    roots.push(root)
    const workspacesRoot = path.join(root, "workspaces")
    const controlRoot = path.join(root, "control")
    const markerPath = path.join(controlRoot, workspacePermissionMarkerName)
    await Promise.all([
      mkdir(workspacesRoot, { recursive: true }),
      mkdir(controlRoot, { recursive: true }),
    ])
    await writeFile(markerPath, "stale\n", { mode: 0o644 })
    const identities = {
      apiUid: process.getuid!(),
      taskUid: process.getuid!(),
      sharedGid: process.getgid!(),
    }

    await expect(
      repairWorkspacePermissionsOnce({
        workspacesRoot,
        markerPath,
        identities,
      }),
    ).resolves.toMatchObject({ applied: true })
    expect(await readFile(markerPath, "utf8")).toBe("1\n")
    expect((await lstat(markerPath)).mode & 0o777).toBe(0o600)
  })
})
