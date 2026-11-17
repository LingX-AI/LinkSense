import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import pino from "pino"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesktopWorkerProvider, desktopWorkerEnvironment } from "../src/controller/desktop-worker-provider.js"

const ownerId = "10000000-0000-4000-8000-000000000001"
const firstId = "10000000-0000-4000-8000-000000000002"
const secondId = "10000000-0000-4000-8000-000000000003"
const thirdId = "10000000-0000-4000-8000-000000000004"
const day = 86_400_000
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-worker-"))
  cleanups.push(() => rm(root, { force: true, recursive: true }))
  const configuration = {
    dataRoot: path.join(root, "data"), runtimeRoot: path.join(root, "runtime"),
    controlToken: "a".repeat(64), bridgeUrl: "http://127.0.0.1:49152/",
  }
  const provider = new DesktopWorkerProvider(configuration, pino({ enabled: false }))
  cleanups.push(() => provider.shutdown())
  return { root, configuration, provider }
}

function input(sessionId: string) {
  return { serviceSessionId: sessionId, ownerId, storageKey: "desktop-unit-storage", name: "desktop-test", probe: true }
}

describe("desktop worker lifecycle", () => {
  it("isolates workspace paths, serializes concurrent acquisition and stops the real child on shutdown", async () => {
    const { configuration, provider } = await fixture()
    const script = path.join(configuration.runtimeRoot, "runner", "dist", "index.js")
    await mkdir(path.dirname(script), { recursive: true })
    const bin = path.join(configuration.runtimeRoot, "bin")
    await mkdir(bin)
    if (process.platform === "win32") await copyFile(process.execPath, path.join(bin, "node.exe"))
    else await symlink(process.execPath, path.join(bin, "node"))
    await writeFile(script, `
      const fs = require("node:fs");
      fs.writeFileSync("child-ready", "ready");
      process.on("disconnect", () => process.exit(0));
    `)
    const first = provider.pathsFor(ownerId, firstId)
    const second = provider.pathsFor(ownerId, secondId)
    await Promise.all([
      provider.prepareOwnerFilesystem(first), provider.prepareOwnerFilesystem(first),
      provider.prepareOwnerFilesystem(second),
    ])
    expect(first.home).not.toBe(second.home)
    expect(await realpath(first.homeAgentsMountpoint)).toBe(await realpath(first.managedAgents))
    expect(await realpath(second.homeAgentsMountpoint)).toBe(await realpath(second.managedAgents))
    const results = await Promise.allSettled([provider.acquire(input(firstId)), provider.acquire(input(firstId))])
    const started = results.find(result => result.status === "fulfilled")
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
    if (!started) throw new Error("fixture did not start a worker")
    await vi.waitFor(async () => expect(await readFile(path.join(first.home, "child-ready"), "utf8")).toBe("ready"))
    expect(await provider.inspect(started.value)).toBe("running")
    await provider.shutdown()
    expect(await provider.inspect(started.value)).toBe("stopped")
    await expect(provider.acquire(input(secondId))).rejects.toThrow()
    expect(await provider.discover()).toEqual([])
  })

  it("rejects escaping links and does not copy platform credentials into the runtime environment", async () => {
    const { root, configuration, provider } = await fixture()
    const paths = provider.pathsFor(ownerId, firstId)
    await mkdir(paths.owner, { recursive: true })
    const externalHome = path.join(root, "outside")
    await mkdir(externalHome)
    await symlink(externalHome, paths.home, process.platform === "win32" ? "junction" : "dir")
    await expect(provider.prepareOwnerFilesystem(paths)).rejects.toThrow("private directories")
    vi.stubEnv("NODE_OPTIONS", "--require fixture-disallowed")
    vi.stubEnv("OPENAI_API_KEY", "fixture-platform-secret")
    vi.stubEnv("LINKSENSE_RUNNER_SHARED_SECRET", "fixture-platform-secret")
    const env = desktopWorkerEnvironment(configuration, ownerId, firstId, paths, 49153, path.join(root, "tools"))
    expect(env).not.toHaveProperty("NODE_OPTIONS")
    expect(env).not.toHaveProperty("OPENAI_API_KEY")
    expect(env.LINKSENSE_RUNNER_SHARED_SECRET).not.toBe("fixture-platform-secret")
    expect(env.LINKSENSE_RUNNER_SHARED_SECRET).not.toBe(configuration.controlToken)
  })

  it("rejects a tools directory redirected outside the app's private runtime root", async () => {
    const { root, configuration, provider } = await fixture()
    const outside = path.join(root, "outside-tools")
    await Promise.all([mkdir(configuration.dataRoot), mkdir(outside)])
    await symlink(outside, path.join(configuration.dataRoot, "tools"), process.platform === "win32" ? "junction" : "dir")
    await expect(provider.initialize()).rejects.toThrow("private directories")
    await expect(realpath(path.join(outside, "bin"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("clears expired and least-recently-used managed workspaces while preserving unrelated directories", async () => {
    const { configuration, provider } = await fixture()
    const now = Date.now()
    const paths = [firstId, secondId, thirdId].map(id => provider.pathsFor(ownerId, id))
    await Promise.all(paths.map(async (session, index) => {
      await mkdir(session.home, { recursive: true })
      await writeFile(path.join(session.owner, "desktop-session.json"), JSON.stringify({
        version: 1, ownerId, conversationId: path.basename(session.owner),
        lastUsedAt: now - [15 * day, day, 0][index]!,
      }))
    }))
    for (const session of paths.slice(1)) {
      const large = path.join(session.home, "fixture")
      await writeFile(large, "")
      await truncate(large, 6 * 1024 * 1024 * 1024)
    }
    const unrelated = path.join(configuration.dataRoot, "unmanaged")
    await mkdir(unrelated)
    const result = await provider.pruneWorkspaces(now)
    expect(result.deleted).toBe(2)
    expect(result.retainedBytes).toBeGreaterThanOrEqual(6 * 1024 * 1024 * 1024)
    await expect(realpath(paths[0]!.owner)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(realpath(paths[1]!.owner)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(realpath(paths[2]!.owner)).resolves.toBeTruthy()
    await expect(realpath(unrelated)).resolves.toBeTruthy()
  })
})
