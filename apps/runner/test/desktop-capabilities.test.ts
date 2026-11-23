import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js"

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const cleanups: (() => Promise<void>)[] = []

// The runtime project shares modules across files; reload under the focused
// lstat mock even when another spec already cached the capabilities module.
beforeEach(() => vi.resetModules())

afterEach(async () => {
  vi.mocked(lstat).mockReset()
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  vi.mocked(lstat).mockImplementation(actual.lstat)
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function scratchRoot(parent = tmpdir()): Promise<string> {
  const root = await mkdtemp(path.join(parent, "linksense-desktop-capabilities-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

async function mockStatAttributes(overrides: ReadonlyMap<string, { uid?: number; gid?: number }>): Promise<void> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  vi.mocked(lstat).mockImplementation(async target => {
    const info = await actual.lstat(target)
    const attributes = overrides.get(String(target))
    if (attributes?.uid !== undefined) Object.defineProperty(info, "uid", { value: attributes.uid, enumerable: true, configurable: true })
    if (attributes?.gid !== undefined) Object.defineProperty(info, "gid", { value: attributes.gid, enumerable: true, configurable: true })
    return info
  })
}

async function initializeCapabilities(runtimeRoot: string, paths: WorkerOwnerPaths): Promise<string> {
  return (await import("../src/desktop/capabilities.js")).initializeDesktopCapabilities(runtimeRoot, paths)
}

async function fixture(root: string) {
  const runtimeRoot = path.join(root, "runtime")
  const source = path.join(runtimeRoot, "capabilities")
  for (const name of ["skills", "plugins", "plugin-sources"]) await mkdir(path.join(source, name), { recursive: true })
  const generation = "0".repeat(64)
  const id = `${generation}-${randomUUID()}`
  await writeFile(path.join(source, "skills", "example.md"), "fixture capability\n")
  await writeFile(path.join(source, "capability-snapshot.json"), JSON.stringify({
    version: 1, id, generation, contentDigest: generation, sourceDigest: generation, pluginNames: [],
  }))
  const owner = path.join(root, "owner")
  const managedAgents = path.join(root, "managed", "agents")
  const control = path.join(owner, "control")
  await mkdir(owner, { recursive: true, mode: 0o700 })
  await mkdir(control, { recursive: true, mode: 0o700 })
  await mkdir(managedAgents, { recursive: true, mode: 0o700 })
  const paths: WorkerOwnerPaths = {
    root, owner, home: path.join(root, "home"), homeAgentsMountpoint: path.join(root, "home", ".agents"),
    managed: path.join(root, "managed"), managedAgents,
    managedSkills: path.join(managedAgents, "skills"),
    managedPluginSources: path.join(managedAgents, "plugin-sources"),
    managedPlugins: path.join(managedAgents, "plugins"),
    control, workspaces: path.join(root, "home", "projects"),
  }
  return { runtimeRoot, paths, id, generation }
}

it("installs and reuses a snapshot when an owned restrictive directory reports a different gid", async () => {
  const { runtimeRoot, paths, id, generation } = await fixture(await scratchRoot())
  const snapshots = path.join(paths.managedAgents, "snapshots")
  const control = path.join(paths.control, "capabilities")
  await mkdir(snapshots, { mode: 0o700 })
  await mkdir(control, { mode: 0o700 })
  const gid = (process.getgid?.() ?? 0) + 1
  // The real directories keep the process primary gid; only these two validated
  // leaves report the parent-inherited gid macOS can assign to them.
  await mockStatAttributes(new Map([
    [snapshots, { gid }],
    [control, { gid }],
  ]))
  expect(gid).not.toBe(process.getgid?.())

  expect(await initializeCapabilities(runtimeRoot, paths)).toBe(generation)
  const snapshot = path.join(snapshots, id)
  expect(await readFile(path.join(snapshot, "skills", "example.md"), "utf8")).toBe("fixture capability\n")
  expect(await readlink(path.join(paths.managedAgents, "current"))).toBe(`snapshots/${id}`)
  const inode = (await lstat(snapshot)).ino
  await writeFile(path.join(snapshot, "keep.txt"), "keep\n")

  expect(await initializeCapabilities(runtimeRoot, paths)).toBe(generation)
  expect((await lstat(snapshot)).ino).toBe(inode)
  expect(await readFile(path.join(snapshot, "keep.txt"), "utf8")).toBe("keep\n")
  expect((await lstat(snapshots)).gid).toBe(gid)
  expect((await lstat(control)).gid).toBe(gid)
  expect((await lstat(snapshots)).mode & 0o777).toBe(0o750)
  expect((await lstat(control)).mode & 0o777).toBe(0o700)
})

it("rejects a directory owned by another uid with the same gid before changing its mode", async () => {
  const { runtimeRoot, paths } = await fixture(await scratchRoot())
  const snapshots = path.join(paths.managedAgents, "snapshots")
  await mkdir(snapshots, { mode: 0o700 })
  const gid = (await lstat(snapshots)).gid
  const uid = (process.geteuid?.() ?? 0) + 1
  await mockStatAttributes(new Map([[snapshots, { uid }]]))
  expect((await lstat(snapshots)).uid).toBe(uid)
  expect((await lstat(snapshots)).gid).toBe(gid)

  await expect(initializeCapabilities(runtimeRoot, paths)).rejects.toThrow("invalid desktop capability directory")
  expect((await lstat(snapshots)).mode & 0o777).toBe(0o700)
})

it("rejects a directory when the effective uid is unavailable", async () => {
  const { runtimeRoot, paths } = await fixture(await scratchRoot())
  const snapshots = path.join(paths.managedAgents, "snapshots")
  await mkdir(snapshots, { mode: 0o700 })
  const descriptor = Object.getOwnPropertyDescriptor(process, "geteuid")
  Object.defineProperty(process, "geteuid", { value: undefined, configurable: true })
  try {
    await expect(initializeCapabilities(runtimeRoot, paths)).rejects.toThrow("invalid desktop capability directory")
    expect((await lstat(snapshots)).mode & 0o777).toBe(0o700)
  } finally {
    if (descriptor) Object.defineProperty(process, "geteuid", descriptor)
    else Reflect.deleteProperty(process, "geteuid")
  }
})

it("rejects a symlink without changing its target", async () => {
  const { runtimeRoot, paths } = await fixture(await scratchRoot())
  const snapshots = path.join(paths.managedAgents, "snapshots")
  const victim = path.join(paths.root, "victim")
  await mkdir(victim, { mode: 0o700 })
  await chmod(victim, 0o755)
  await symlink(victim, snapshots, "dir")

  await expect(initializeCapabilities(runtimeRoot, paths)).rejects.toThrow("invalid desktop capability directory")
  expect((await lstat(snapshots)).isSymbolicLink()).toBe(true)
  expect((await lstat(victim)).mode & 0o777).toBe(0o755)
})

it.each([0o770, 0o707] as const)("rejects a uid-owned directory with writable mode %o without changing it", async mode => {
  const { runtimeRoot, paths } = await fixture(await scratchRoot())
  const snapshots = path.join(paths.managedAgents, "snapshots")
  await mkdir(snapshots, { mode: 0o700 })
  await chmod(snapshots, mode)
  const inode = (await lstat(snapshots)).ino

  await expect(initializeCapabilities(runtimeRoot, paths)).rejects.toThrow("invalid desktop capability directory")
  expect((await lstat(snapshots)).ino).toBe(inode)
  expect((await lstat(snapshots)).mode & 0o777).toBe(mode)
})
