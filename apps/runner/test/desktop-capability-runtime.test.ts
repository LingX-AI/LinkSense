import { createHash, randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { builtInSkillNames, capabilitySnapshotDirectory } from "@linksense/shared"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js"

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const cleanups: (() => Promise<void>)[] = []

beforeEach(() => vi.resetModules())

afterEach(async () => {
  vi.mocked(lstat).mockReset()
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  vi.mocked(lstat).mockImplementation(actual.lstat)
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-capability-runtime-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

async function mockStatAttributes(attributes: { uid?: number; gid?: number }): Promise<void> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  vi.mocked(lstat).mockImplementation(async target => {
    const info = await actual.lstat(target)
    if (attributes.uid !== undefined) {
      Object.defineProperty(info, "uid", { value: attributes.uid, enumerable: true, configurable: true })
    }
    if (attributes.gid !== undefined) {
      Object.defineProperty(info, "gid", { value: attributes.gid, enumerable: true, configurable: true })
    }
    return info
  })
}

async function initializeCapabilities(runtimeRoot: string, paths: WorkerOwnerPaths): Promise<string> {
  return (await import("../src/desktop/capabilities.js")).initializeDesktopCapabilities(runtimeRoot, paths)
}

async function capabilityRuntime() {
  return import("../src/workspace/capability-runtime.js")
}

async function fixture() {
  const root = await scratchRoot()
  const runtimeRoot = path.join(root, "runtime")
  const source = path.join(runtimeRoot, "capabilities")
  const sourceSkills = path.join(source, "skills")
  const sourcePlugins = path.join(source, "plugin-sources")
  const marketplace = path.join(source, "plugins", "marketplace.json")
  await mkdir(sourceSkills, { recursive: true })
  await mkdir(sourcePlugins, { recursive: true })
  await mkdir(path.dirname(marketplace), { recursive: true })
  for (const name of builtInSkillNames) {
    await mkdir(path.join(sourceSkills, name), { recursive: true })
    await writeFile(path.join(sourceSkills, name, "SKILL.md"), `${name}\n`, { mode: 0o640 })
  }
  await writeFile(marketplace, `${JSON.stringify({ name: "linksense-personal", plugins: [] })}\n`, { mode: 0o640 })
  const contentDigest = await capabilityContentDigest({
    skillsRoot: sourceSkills,
    pluginSourceRoot: sourcePlugins,
    marketplacePath: marketplace,
  })
  const generation = "e".repeat(64)
  const id = `${generation}-${randomUUID()}`
  await writeFile(path.join(source, "capability-snapshot.json"), JSON.stringify({
    version: 1, id, generation, contentDigest, sourceDigest: "f".repeat(64), pluginNames: [],
  }), { mode: 0o640 })

  const owner = path.join(root, "owner")
  const home = path.join(owner, "home")
  const managed = path.join(owner, "managed")
  const managedAgents = path.join(managed, "agents")
  const control = path.join(owner, "control")
  await mkdir(owner, { mode: 0o700 })
  await mkdir(home, { mode: 0o700 })
  await chmod(home, 0o770)
  await mkdir(path.join(home, ".codex"), { mode: 0o770 })
  await chmod(path.join(home, ".codex"), 0o770)
  await mkdir(managed, { mode: 0o700 })
  await mkdir(managedAgents, { mode: 0o700 })
  await chmod(managedAgents, 0o750)
  await mkdir(control, { mode: 0o700 })
  await symlink(path.relative(home, managedAgents), path.join(home, ".agents"), "dir")
  const paths: WorkerOwnerPaths = {
    root, owner, home, homeAgentsMountpoint: path.join(home, ".agents"),
    managed, managedAgents,
    managedSkills: path.join(managedAgents, "skills"),
    managedPluginSources: path.join(managedAgents, "plugin-sources"),
    managedPlugins: path.join(managedAgents, "plugins"),
    control, workspaces: path.join(home, "projects"),
  }
  return {
    runtimeRoot, paths, generation, contentDigest,
    snapshot: path.join(managedAgents, capabilitySnapshotDirectory, id),
  }
}

async function capabilityContentDigest(input: {
  skillsRoot: string
  pluginSourceRoot: string
  marketplacePath: string
}): Promise<string> {
  const hash = createHash("sha256")
  hash.update("linksense-capability-content\n")
  await hashTree(input.skillsRoot, "skills", hash)
  hash.update("directory\0plugins\0")
  await hashTree(input.marketplacePath, "marketplace.json", hash)
  return hash.digest("hex")
}

async function hashTree(
  currentPath: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const info = await lstat(currentPath)
  if (info.isFile()) {
    hash.update(`file\0${relativePath}\0${info.mode & 0o111 ? "x" : "-"}\0`)
    hash.update(await readFile(currentPath))
    hash.update("\0")
    return
  }
  hash.update(`directory\0${relativePath}\0`)
  for (const entry of (await readdir(currentPath)).sort()) {
    await hashTree(path.join(currentPath, entry), `${relativePath}/${entry}`, hash)
  }
}

it("leases and reuses a full built-in snapshot when desktop directories carry a different group", async () => {
  const { runtimeRoot, paths, generation, contentDigest, snapshot } = await fixture()
  const primaryGid = process.getgid?.() ?? 0
  const inheritedGid = primaryGid + 1
  expect(inheritedGid).not.toBe(primaryGid)
  await mockStatAttributes({ gid: inheritedGid })
  expect(await initializeCapabilities(runtimeRoot, paths)).toBe(generation)
  expect((await readdir(path.join(snapshot, "skills"))).sort())
    .toEqual([...builtInSkillNames].sort())

  const { CapabilityRuntimeManager, CapabilityRuntimeError } = await capabilityRuntime()
  const onFullVerification = vi.fn()
  const manager = new CapabilityRuntimeManager({ desktop: true, onFullVerification })
  const lease = await manager.acquireLease({ controlRoot: paths.control, expectedGeneration: generation })
  expect(lease.generation).toBe(generation)
  await lease.release()
  expect(await manager.existing(paths.home, paths.control)).toMatchObject({ contentDigest, generation })
  const input = {
    userHome: paths.home, controlRoot: paths.control, expectedGeneration: generation,
    capabilities: [], reuseImmutableSnapshot: true,
  }
  const first = await manager.resolvePublished(input)
  expect(first).toMatchObject({ contentDigest, generation })
  expect(onFullVerification).toHaveBeenCalledOnce()

  const inode = (await lstat(snapshot)).ino
  expect(await initializeCapabilities(runtimeRoot, paths)).toBe(generation)
  expect((await lstat(snapshot)).ino).toBe(inode)
  expect(await manager.resolvePublished(input)).toEqual(first)
  expect(onFullVerification).toHaveBeenCalledOnce()

  const shared = new CapabilityRuntimeManager({
    apiIdentity: { uid: process.geteuid?.() ?? 0, gid: primaryGid },
    taskIdentity: { uid: process.geteuid?.() ?? 0, gid: primaryGid },
  })
  await expect(shared.acquireLease({
    controlRoot: paths.control, expectedGeneration: generation,
  })).rejects.toBeInstanceOf(CapabilityRuntimeError)
})

it("rejects a desktop projection owned by another uid even when the group matches", async () => {
  const { runtimeRoot, paths, generation } = await fixture()
  expect(await initializeCapabilities(runtimeRoot, paths)).toBe(generation)
  const effectiveUid = process.geteuid?.() ?? 0
  await mockStatAttributes({ uid: effectiveUid + 1, gid: process.getgid?.() ?? 0 })
  const { CapabilityRuntimeManager, CapabilityRuntimeError } = await capabilityRuntime()
  const manager = new CapabilityRuntimeManager({ desktop: true })

  await expect(manager.acquireLease({
    controlRoot: paths.control, expectedGeneration: generation,
  })).rejects.toBeInstanceOf(CapabilityRuntimeError)
})

it("rejects incorrect desktop modes and snapshot content", async () => {
  const { runtimeRoot, paths, generation, snapshot } = await fixture()
  expect(await initializeCapabilities(runtimeRoot, paths)).toBe(generation)
  const { CapabilityRuntimeManager, CapabilityRuntimeError } = await capabilityRuntime()
  const manager = new CapabilityRuntimeManager({ desktop: true })
  const input = {
    userHome: paths.home, controlRoot: paths.control, expectedGeneration: generation,
    capabilities: [],
  }
  const capabilityControl = path.join(paths.control, "capabilities")
  await chmod(capabilityControl, 0o750)
  await expect(manager.acquireLease({
    controlRoot: paths.control, expectedGeneration: generation,
  })).rejects.toBeInstanceOf(CapabilityRuntimeError)
  await chmod(capabilityControl, 0o700)

  const snapshots = path.join(paths.managedAgents, capabilitySnapshotDirectory)
  await chmod(snapshots, 0o770)
  await expect(manager.resolvePublished(input)).rejects.toBeInstanceOf(CapabilityRuntimeError)
  await chmod(snapshots, 0o750)

  await writeFile(path.join(snapshot, "skills", builtInSkillNames[0]!, "SKILL.md"), "tampered\n")
  await expect(manager.resolvePublished(input)).rejects.toBeInstanceOf(CapabilityRuntimeError)
})

it("fails closed when the desktop effective uid is unavailable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "geteuid")
  Object.defineProperty(process, "geteuid", { value: undefined, configurable: true })
  try {
    const { CapabilityRuntimeManager } = await capabilityRuntime()
    expect(() => new CapabilityRuntimeManager({ desktop: true })).toThrow("effective user")
  } finally {
    if (descriptor) Object.defineProperty(process, "geteuid", descriptor)
    else Reflect.deleteProperty(process, "geteuid")
  }
})
