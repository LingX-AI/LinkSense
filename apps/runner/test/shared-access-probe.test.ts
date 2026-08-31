import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ManagedProjectionAccessProbeError,
  SharedWorkspaceAccessProbeError,
  assertManagedProjectionBoundary,
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
  repairRootOwnedManagedProjectionBoundary,
  verifyManagedProjectionAccess,
  verifySharedWorkspaceAccess,
} from "../src/workspace/shared-access-probe.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("shared workspace access probe", () => {
  it("verifies that task-owned output is readable by the supervisor", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-access-probe-"),
    )
    roots.push(root)
    await chmod(root, 0o2770)
    const identity = { uid: process.getuid!(), gid: process.getgid!() }
    const runTaskWriter = vi.fn(
      async (probeDirectory: string, probeFile: string) => {
        await mkdir(probeDirectory, { mode: 0o2770 })
        await chmod(probeDirectory, 0o2770)
        await writeFile(probeFile, "linksense-shared-access\n", {
          mode: 0o640,
        })
        await chmod(probeFile, 0o640)
      },
    )

    await verifySharedWorkspaceAccess(root, identity, { runTaskWriter })

    expect(runTaskWriter).toHaveBeenCalledOnce()
    expect(await lstat(root)).toBeDefined()
    await expect(readdir(root)).resolves.toEqual([])
  })

  it("fails before spawning when the shared root mode is unsafe", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-access-probe-"),
    )
    roots.push(root)
    await chmod(root, 0o755)
    const runTaskWriter = vi.fn()

    await expect(
      verifySharedWorkspaceAccess(
        root,
        { uid: process.getuid!(), gid: process.getgid!() },
        { runTaskWriter },
      ),
    ).rejects.toBeInstanceOf(SharedWorkspaceAccessProbeError)
    expect(runTaskWriter).not.toHaveBeenCalled()
  })

  it("accepts ownership remapping when the isolated task can write and the supervisor can read", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-access-probe-remapped-"),
    )
    roots.push(root)
    await chmod(root, 0o2770)
    const runTaskWriter = vi.fn(
      async (probeDirectory: string, probeFile: string) => {
        await mkdir(probeDirectory, { mode: 0o2770 })
        await chmod(probeDirectory, 0o2770)
        await writeFile(probeFile, "linksense-shared-access\n", {
          mode: 0o640,
        })
        await chmod(probeFile, 0o640)
      },
    )

    await verifySharedWorkspaceAccess(
      root,
      { uid: process.getuid!() + 10_000, gid: process.getgid!() },
      { runTaskWriter },
    )

    expect(runTaskWriter).toHaveBeenCalledOnce()
    await expect(readdir(root)).resolves.toEqual([])
  })
})

describe("managed capability projection access probe", () => {
  it("validates an API-owned marker without modifying the projection and proves task-identity read access", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-managed-projection-probe-"),
    )
    roots.push(root)
    await chmod(root, 0o750)
    const identity = { uid: process.getuid!(), gid: process.getgid!() }
    const markerPath = path.join(root, managedProjectionProbeFileName)
    await writeFile(markerPath, managedProjectionProbeContents, {
      mode: 0o640,
    })
    await chmod(markerPath, 0o640)
    await assertManagedProjectionBoundary(root, identity)
    expect((await lstat(markerPath)).mode & 0o777).toBe(0o640)
    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      managedProjectionProbeContents,
    )
    const runTaskReader = vi.fn(async (target: string) => {
      expect(target).toBe(markerPath)
      await expect(readFile(target, "utf8")).resolves.toBe(
        managedProjectionProbeContents,
      )
    })

    await verifyManagedProjectionAccess(
      root,
      identity,
      { runTaskReader },
    )

    expect(runTaskReader).toHaveBeenCalledOnce()
  })

  it("can accept Docker bind-mount ownership remapping while preserving the marker and mode contract", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-managed-projection-probe-"),
    )
    roots.push(root)
    await chmod(root, 0o750)
    const markerPath = path.join(root, managedProjectionProbeFileName)
    await writeFile(markerPath, managedProjectionProbeContents, {
      mode: 0o640,
    })
    await chmod(markerPath, 0o640)
    const remappedIdentity = {
      uid: process.getuid!() + 10_000,
      gid: process.getgid!() + 10_000,
    }

    await expect(
      assertManagedProjectionBoundary(root, remappedIdentity),
    ).rejects.toBeInstanceOf(ManagedProjectionAccessProbeError)
    await expect(
      assertManagedProjectionBoundary(root, remappedIdentity, {
        requireExactOwnership: false,
      }),
    ).resolves.toBeUndefined()
  })

  it("repairs Docker Desktop root-owned projection boundaries before the strict controller check", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-managed-projection-repair-"),
    )
    roots.push(root)
    await chmod(root, 0o750)
    const markerPath = path.join(root, managedProjectionProbeFileName)
    await writeFile(markerPath, managedProjectionProbeContents, {
      mode: 0o640,
    })
    await chmod(markerPath, 0o640)
    const rootStats = await lstat(root)
    const markerStats = await lstat(markerPath)
    const chown = vi.fn(async () => undefined)
    const lstatMock = vi.fn(async (target: Parameters<typeof lstat>[0]) => {
      const targetPath = String(target)
      const stats = targetPath === root ? rootStats : markerStats
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        uid: 0,
        gid: 0,
      })
    }) as unknown as typeof lstat
    const identity = { uid: process.getuid!(), gid: process.getgid!() }

    await repairRootOwnedManagedProjectionBoundary(root, identity, {
      lstat: lstatMock,
      chown,
    })

    expect(chown.mock.calls).toEqual([
      [root, identity.uid, identity.gid],
      [markerPath, identity.uid, identity.gid],
    ])
    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      managedProjectionProbeContents,
    )
  })

  it("rejects a projection whose root permissions do not preserve group read access", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linksense-managed-projection-probe-"),
    )
    roots.push(root)
    const identity = { uid: process.getuid!(), gid: process.getgid!() }
    await chmod(root, 0o750)
    await writeFile(
      path.join(root, managedProjectionProbeFileName),
      managedProjectionProbeContents,
      { mode: 0o640 },
    )
    await chmod(root, 0o700)
    const runTaskReader = vi.fn()

    await expect(
      verifyManagedProjectionAccess(
        root,
        identity,
        { runTaskReader },
      ),
    ).rejects.toBeInstanceOf(ManagedProjectionAccessProbeError)
    expect(runTaskReader).not.toHaveBeenCalled()
  })
})
