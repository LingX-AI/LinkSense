import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import pino from "pino"
import { afterEach, describe, expect, it, vi } from "vitest"
import { desktopExecutionCommandSchema } from "@linksense/shared"

import { DesktopWorkerProvider, desktopWorkerEnvironment } from "../src/controller/desktop-worker-provider.js"
import { StartOperationStore } from "../src/start-operation.js"
import { DesktopTurns } from "../src/desktop/turns.js"
import { WorkspaceManager } from "../src/workspace/workspace-manager.js"

const ownerId = "10000000-0000-4000-8000-000000000001"
const otherOwnerId = "10000000-0000-4000-8000-000000000005"
const firstId = "10000000-0000-4000-8000-000000000002"
const secondId = "10000000-0000-4000-8000-000000000003"
const thirdId = "10000000-0000-4000-8000-000000000004"
const fourthId = "10000000-0000-4000-8000-000000000006"
const turnId = "10000000-0000-4000-8000-000000000007"
const day = 86_400_000
const serverOrigin = "https://server.example.test"
const otherOrigin = "https://other.example.test"
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
    controlToken: "a".repeat(64), bridgeUrl: "http://127.0.0.1:49152/", serverOrigin,
  }
  const provider = new DesktopWorkerProvider(configuration, pino({ enabled: false }))
  cleanups.push(() => provider.shutdown())
  return { root, configuration, provider }
}

async function fixtureWithoutOrigin() {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-worker-no-origin-"))
  cleanups.push(() => rm(root, { force: true, recursive: true }))
  const configuration = {
    dataRoot: path.join(root, "data"), runtimeRoot: path.join(root, "runtime"),
    controlToken: "a".repeat(64),
  }
  const provider = new DesktopWorkerProvider(configuration, pino({ enabled: false }))
  cleanups.push(() => provider.shutdown())
  return { root, configuration, provider }
}

function input(sessionId: string, owner = ownerId): Parameters<DesktopWorkerProvider["acquire"]>[0] {
  return {
    serviceSessionId: sessionId, ownerId: owner, storageKey: "desktop-unit-storage", name: "desktop-test", probe: true,
    run: { turnId, runtimeGeneration: randomUUID() },
  }
}

async function writeMarker(
  provider: DesktopWorkerProvider, owner: string, sessionId: string, lastUsedAt: number,
  marker: Record<string, unknown> = { version: 2, origin: serverOrigin },
) {
  await writeFile(path.join(provider.pathsFor(owner, sessionId).owner, "desktop-session.json"),
    JSON.stringify({ ownerId: owner, conversationId: sessionId, lastUsedAt, ...marker }))
}

async function sessionFixture(
  provider: DesktopWorkerProvider, owner: string, sessionId: string, lastUsedAt: number,
  marker: Record<string, unknown> = { version: 2, origin: serverOrigin },
) {
  const paths = provider.pathsFor(owner, sessionId)
  await mkdir(path.join(paths.home, "workspace"), { recursive: true, mode: 0o700 })
  await mkdir(path.join(paths.control, "workspaces", sessionId), { recursive: true, mode: 0o700 })
  await mkdir(path.join(paths.managedAgents), { recursive: true, mode: 0o700 })
  await writeMarker(provider, owner, sessionId, lastUsedAt, marker)
  return paths
}

async function legacySessionFixture(
  provider: DesktopWorkerProvider, owner: string, sessionId: string, lastUsedAt: number,
) {
  return sessionFixture(provider, owner, sessionId, lastUsedAt, { version: 1 })
}

function journal(provider: DesktopWorkerProvider, owner: string, sessionId: string) {
  const paths = provider.pathsFor(owner, sessionId)
  const manager = new WorkspaceManager(paths.root, undefined, {
    fixedOwnerId: owner, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
  })
  return { manager, store: new StartOperationStore(manager), paths }
}

async function runtimeFixture(configuration: { runtimeRoot: string }) {
  const script = path.join(configuration.runtimeRoot, "runner", "dist", "index.js")
  await mkdir(path.dirname(script), { recursive: true })
  const bin = path.join(configuration.runtimeRoot, "bin")
  await mkdir(bin, { recursive: true })
  if (process.platform === "win32") await copyFile(process.execPath, path.join(bin, "node.exe"))
  else await symlink(process.execPath, path.join(bin, "node"))
  await writeFile(script, `
    const fs = require("node:fs");
    fs.writeFileSync("child-ready", "ready");
    process.on("disconnect", () => process.exit(0));
  `)
}

describe("desktop worker lifecycle", () => {
  it("isolates workspace paths, serializes concurrent acquisition and stops the real child on shutdown", async () => {
    const { configuration, provider } = await fixture()
    await runtimeFixture(configuration)
    const first = provider.pathsFor(ownerId, firstId)
    const second = provider.pathsFor(ownerId, secondId)
    await Promise.all([
      provider.prepareOwnerFilesystem(first), provider.prepareOwnerFilesystem(first),
      provider.prepareOwnerFilesystem(second),
    ])
    expect(first.home).not.toBe(second.home)
    expect(await realpath(first.homeAgentsMountpoint)).toBe(await realpath(first.managedAgents))
    expect(await realpath(second.homeAgentsMountpoint)).toBe(await realpath(second.managedAgents))
    expect(JSON.parse(await readFile(path.join(first.owner, "desktop-session.json"), "utf8")))
      .toMatchObject({ version: 2, origin: serverOrigin, ownerId, conversationId: firstId })
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
    vi.stubEnv("LINKSENSE_COMPUTER_SCREENSHOTS_ENABLED", "1")
    const env = desktopWorkerEnvironment(configuration, ownerId, firstId, paths, 49153, path.join(root, "tools"))
    expect(env).not.toHaveProperty("NODE_OPTIONS")
    expect(env).not.toHaveProperty("OPENAI_API_KEY")
    expect(env).not.toHaveProperty("LINKSENSE_COMPUTER_SCREENSHOTS_ENABLED")
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

  it("clears expired and least-recently-used origin-bound workspaces while preserving recovery state", async () => {
    const { configuration, provider } = await fixture()
    const now = Date.now()
    const paths = await Promise.all([firstId, secondId, thirdId].map((id, index) =>
      sessionFixture(provider, ownerId, id, now - [15 * day, day, 0][index]!)))
    for (const [index, session] of paths.entries()) {
      await writeFile(path.join(session.control, "workspaces", [firstId, secondId, thirdId][index]!, "history.json"), "history")
      await writeFile(path.join(session.managedAgents, "managed.txt"), "managed")
    }
    for (const session of paths.slice(1)) {
      const large = path.join(session.home, "workspace", "fixture")
      await writeFile(large, "")
      await truncate(large, 6 * 1024 * 1024 * 1024)
    }
    const legacy = await legacySessionFixture(provider, ownerId, fourthId, now - 30 * day)
    await writeFile(path.join(legacy.home, "workspace", "legacy.txt"), "legacy")
    const foreign = await sessionFixture(provider, ownerId, randomUUID(), now - 30 * day,
      { version: 2, origin: otherOrigin })
    await writeFile(path.join(foreign.home, "workspace", "foreign.txt"), "foreign")
    const unrelated = path.join(configuration.dataRoot, "unmanaged")
    await mkdir(unrelated)
    const result = await provider.pruneWorkspaces(now)
    expect(result.deleted).toBe(2)
    expect(result.freedBytes).toBeGreaterThanOrEqual(6 * 1024 * 1024 * 1024)
    expect(result.retainedBytes).toBeGreaterThanOrEqual(6 * 1024 * 1024 * 1024)
    for (const session of paths.slice(0, 2)) {
      await expect(realpath(path.join(session.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
      await expect(realpath(session.owner)).resolves.toBeTruthy()
      expect(await readFile(path.join(session.control, "workspaces",
        path.basename(session.owner), "history.json"), "utf8")).toBe("history")
      expect(await readFile(path.join(session.managedAgents, "managed.txt"), "utf8")).toBe("managed")
      expect(JSON.parse(await readFile(path.join(session.owner, "desktop-session.json"), "utf8"))).toMatchObject({
        version: 2, origin: serverOrigin, ownerId, conversationId: path.basename(session.owner),
      })
    }
    await expect(realpath(paths[2]!.home)).resolves.toBeTruthy()
    expect(await readFile(path.join(legacy.home, "workspace", "legacy.txt"), "utf8")).toBe("legacy")
    expect(await readFile(path.join(foreign.home, "workspace", "foreign.txt"), "utf8")).toBe("foreign")
    expect(JSON.parse(await readFile(path.join(legacy.owner, "desktop-session.json"), "utf8")))
      .toMatchObject({ version: 1 })
    expect(JSON.parse(await readFile(path.join(foreign.owner, "desktop-session.json"), "utf8")))
      .toMatchObject({ version: 2, origin: otherOrigin })
    await expect(realpath(unrelated)).resolves.toBeTruthy()
  })

  it("scopes usage and explicit cleanup to the signed-in account and origin", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const mine = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    await writeFile(path.join(mine.home, "workspace", "first.txt"), "12345")
    await writeFile(path.join(mine.home, "workspace", "second.txt"), "678")
    const other = await sessionFixture(provider, otherOwnerId, fourthId, now - 20 * day)
    await writeFile(path.join(other.home, "workspace", "other.txt"), "other")
    const foreign = await sessionFixture(provider, ownerId, secondId, now - 20 * day,
      { version: 2, origin: otherOrigin })
    await writeFile(path.join(foreign.home, "workspace", "foreign.txt"), "foreign")
    const legacy = await legacySessionFixture(provider, ownerId, thirdId, now - 20 * day)
    await writeFile(path.join(legacy.home, "workspace", "legacy.txt"), "legacy")

    expect(await provider.workspaceUsage(ownerId)).toEqual({ bytes: 8, files: 2, sessions: 1 })
    expect(await provider.workspaceUsage(otherOwnerId)).toEqual({ bytes: 5, files: 1, sessions: 1 })

    const result = await provider.pruneWorkspaces(now, { ownerId })
    expect(result.deleted).toBe(1)
    expect(result.freedBytes).toBe(8)
    await expect(realpath(path.join(mine.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(path.join(other.home, "workspace", "other.txt"), "utf8")).toBe("other")
    expect(await readFile(path.join(foreign.home, "workspace", "foreign.txt"), "utf8")).toBe("foreign")
    expect(await readFile(path.join(legacy.home, "workspace", "legacy.txt"), "utf8")).toBe("legacy")
    expect(await provider.workspaceUsage(ownerId)).toEqual({ bytes: 0, files: 0, sessions: 0 })

    // Device-wide startup retention reclaims another account's current-origin
    // workspace, but never foreign-origin or legacy data.
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 1 })
    await expect(realpath(path.join(other.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(path.join(foreign.home, "workspace", "foreign.txt"), "utf8")).toBe("foreign")
    expect(await readFile(path.join(legacy.home, "workspace", "legacy.txt"), "utf8")).toBe("legacy")
  })

  it("keeps an active worker and an unresolved start from being cleaned", async () => {
    const { configuration, provider } = await fixture()
    await runtimeFixture(configuration)

    const now = Date.now()
    const active = provider.pathsFor(ownerId, firstId)
    await provider.prepareOwnerFilesystem(active)
    await writeFile(path.join(active.home, "workspace", "live.txt"), "live")
    await writeMarker(provider, ownerId, firstId, now - 20 * day)
    const worker = await provider.acquire(input(firstId))
    try {
      expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
      expect(await readFile(path.join(active.home, "workspace", "live.txt"), "utf8")).toBe("live")
    } finally {
      await provider.release(worker)
    }

    const pending = await sessionFixture(provider, ownerId, secondId, now - 20 * day)
    const { store } = journal(provider, ownerId, secondId)
    const starting = await store.createStarting(secondId, turnId, ownerId, "f".repeat(64))
    if (!starting) throw new Error("fixture did not create a start journal")
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    await store.update(starting, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 1 })
    await expect(realpath(path.join(pending.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("retains corrupt, aliased, and unreadable start state", async () => {
    const { root, provider } = await fixture()
    const now = Date.now()
    const corrupt = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    const operations = path.join(corrupt.control, "workspaces", firstId, "start-operations")
    await mkdir(operations, { recursive: true })
    const corruptFile = path.join(operations, `${turnId}.json`)
    await writeFile(corruptFile, JSON.stringify({ status: "starting" }))
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    await rm(corruptFile)
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 1 })

    const aliased = await sessionFixture(provider, ownerId, secondId, now - 20 * day)
    const aliasedOperations = path.join(aliased.control, "workspaces", secondId, "start-operations")
    await mkdir(aliasedOperations, { recursive: true })
    const outside = path.join(root, "outside-journal.json")
    await writeFile(outside, "outside")
    await symlink(outside, path.join(aliasedOperations, `${turnId}.json`))
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    expect(await readFile(outside, "utf8")).toBe("outside")
  })

  it("preserves baseline v1 startup retention only when no server origin is configured", async () => {
    const { provider } = await fixtureWithoutOrigin()
    const now = Date.now()
    const legacy = await legacySessionFixture(provider, ownerId, firstId, now - 20 * day)
    await writeFile(path.join(legacy.home, "workspace", "legacy.txt"), "legacy")
    const bound = await sessionFixture(provider, ownerId, secondId, now - 20 * day,
      { version: 2, origin: serverOrigin })
    await writeFile(path.join(bound.home, "workspace", "bound.txt"), "bound")

    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 1 })
    // Baseline no-origin runtimes have no origin to bind against, so their v1
    // startup retention remains; a v2 marker cannot be verified without one.
    await expect(realpath(path.join(legacy.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(path.join(bound.home, "workspace", "bound.txt"), "utf8")).toBe("bound")
  })

  it("keeps legacy v1, absent, and foreign-origin workspaces unclaimed and untouched on touch", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const legacy = await legacySessionFixture(provider, ownerId, firstId, now - 40 * day)
    await writeFile(path.join(legacy.home, "workspace", "legacy.txt"), "legacy")
    await provider.prepareOwnerFilesystem(legacy)
    expect(JSON.parse(await readFile(path.join(legacy.owner, "desktop-session.json"), "utf8")))
      .toMatchObject({ version: 1 })
    const absent = provider.pathsFor(ownerId, secondId)
    await mkdir(path.join(absent.home, "workspace"), { recursive: true })
    await mkdir(path.join(absent.control), { recursive: true })
    await writeFile(path.join(absent.home, "workspace", "absent.txt"), "absent")
    await provider.prepareOwnerFilesystem(absent)
    await expect(readFile(path.join(absent.owner, "desktop-session.json")))
      .rejects.toMatchObject({ code: "ENOENT" })

    expect(await provider.workspaceUsage(ownerId)).toEqual({ bytes: 0, files: 0, sessions: 0 })
    expect(await provider.pruneWorkspaces(now + 60 * day)).toMatchObject({ deleted: 0 })
    expect(await readFile(path.join(legacy.home, "workspace", "legacy.txt"), "utf8")).toBe("legacy")
    expect(await readFile(path.join(absent.home, "workspace", "absent.txt"), "utf8")).toBe("absent")
    expect(JSON.parse(await readFile(path.join(legacy.owner, "desktop-session.json"), "utf8")))
      .toMatchObject({ version: 1 })
  })

  it("does not reclassify an existing session after its task directory was already evicted", async () => {
    const { provider } = await fixture()
    const paths = provider.pathsFor(ownerId, firstId)
    await mkdir(path.join(paths.control, "workspaces", firstId), { recursive: true, mode: 0o700 })
    await writeFile(path.join(paths.control, "workspaces", firstId, "history.json"), "history")
    await mkdir(paths.home, { recursive: true, mode: 0o700 })
    await provider.prepareOwnerFilesystem(paths)
    // The owner/session directory predates this preparation, so the rebuilt
    // empty workspace is not evidence that the session belongs to this origin.
    await expect(readFile(path.join(paths.owner, "desktop-session.json")))
      .rejects.toMatchObject({ code: "ENOENT" })
    expect(await provider.workspaceUsage(ownerId)).toEqual({ bytes: 0, files: 0, sessions: 0 })
    expect(await provider.pruneWorkspaces(Date.now() + 60 * 30 * day)).toMatchObject({ deleted: 0 })
    await expect(realpath(path.join(paths.home, "workspace"))).resolves.toBeTruthy()
    expect(await readFile(path.join(paths.control, "workspaces", firstId, "history.json"), "utf8"))
      .toBe("history")
  })

  it("retains a session with an unresolved event outbox in either layout", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const legacy = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    const legacyOutbox = path.join(legacy.control, "workspaces", firstId, "outbox")
    await mkdir(legacyOutbox, { recursive: true, mode: 0o700 })
    await writeFile(path.join(legacyOutbox, `0000000000000001-${randomUUID()}.json`), "{}")
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    await expect(realpath(path.join(legacy.home, "workspace"))).resolves.toBeTruthy()

    const scoped = await sessionFixture(provider, ownerId, secondId, now - 20 * day)
    const scopedOutbox = path.join(scoped.control, "workspaces", secondId,
      "desktop-outbox", randomUUID(), turnId)
    await mkdir(scopedOutbox, { recursive: true, mode: 0o700 })
    await writeFile(path.join(scopedOutbox, `0000000000000001-${randomUUID()}.json`), "{}")
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    await expect(realpath(path.join(scoped.home, "workspace"))).resolves.toBeTruthy()
  })

  it("does not retain an outbox that only has empty scopes", async () => {
    const { provider } = await fixture()
    const session = await sessionFixture(provider, ownerId, firstId, Date.now() - 20 * day)
    await mkdir(path.join(session.control, "workspaces", firstId,
      "desktop-outbox", randomUUID(), turnId), { recursive: true, mode: 0o700 })
    expect(await provider.pruneWorkspaces(Date.now())).toMatchObject({ deleted: 1 })
  })

  it("retains a settled journal that names another account", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const session = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    const { store } = journal(provider, ownerId, firstId)
    const starting = await store.createStarting(firstId, turnId, otherOwnerId, "f".repeat(64))
    if (!starting) throw new Error("fixture did not create a start journal")
    await store.update(starting, {
      status: "succeeded", result: { codexThreadId: randomUUID(), codexTurnId: randomUUID() },
    })
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    await expect(realpath(path.join(session.home, "workspace"))).resolves.toBeTruthy()
  })

  it("retains a settled journal whose runtime generation cannot be confirmed", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const writeGeneration = async (sessionId: string, generation: string) => {
      const control = path.join(provider.pathsFor(ownerId, sessionId).control, "workspaces", sessionId)
      await mkdir(control, { recursive: true, mode: 0o700 })
      await writeFile(path.join(control, "runtime-generation"), `${generation}\n`, { mode: 0o600 })
    }
    const foreign = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    await writeGeneration(firstId, randomUUID())
    const { store: foreignStore } = journal(provider, ownerId, firstId)
    expect(await foreignStore.createSealed(firstId, randomUUID(), ownerId, randomUUID())).not.toBeNull()
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    await expect(realpath(path.join(foreign.home, "workspace"))).resolves.toBeTruthy()

    const matching = await sessionFixture(provider, ownerId, secondId, now - 20 * day)
    const generation = randomUUID()
    await writeGeneration(secondId, generation)
    const { store: matchingStore } = journal(provider, ownerId, secondId)
    expect(await matchingStore.createSealed(secondId, randomUUID(), ownerId, generation)).not.toBeNull()
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 1 })
    await expect(realpath(path.join(matching.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("stops deleting when cancelled and records a confirmed clear for eligible sessions only", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const mine = await Promise.all([firstId, secondId].map(id =>
      sessionFixture(provider, ownerId, id, now - 20 * day)))
    for (const [index, session] of mine.entries()) {
      await writeFile(path.join(session.home, "workspace", `file-${index}.txt`), "kept")
    }
    const legacy = await legacySessionFixture(provider, ownerId, thirdId, now - 30 * day)
    await writeFile(path.join(legacy.home, "workspace", "legacy.txt"), "legacy")

    const cancelled = new AbortController()
    cancelled.abort()
    expect(await provider.pruneWorkspaces(now, { signal: cancelled.signal })).toMatchObject({ deleted: 0 })
    for (const [index, session] of mine.entries()) {
      expect(await readFile(path.join(session.home, "workspace", `file-${index}.txt`), "utf8")).toBe("kept")
    }

    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 2 })
    for (const session of mine) {
      expect(JSON.parse(await readFile(path.join(session.owner, "desktop-session.json"), "utf8")))
        .toMatchObject({ version: 2, clearedAt: now })
    }
    expect(JSON.parse(await readFile(path.join(legacy.owner, "desktop-session.json"), "utf8")))
      .not.toHaveProperty("clearedAt")

    // The next preparation rebuilds the empty workspace and drops the notice.
    await provider.prepareOwnerFilesystem(mine[0]!)
    expect(JSON.parse(await readFile(path.join(mine[0]!.owner, "desktop-session.json"), "utf8")))
      .not.toHaveProperty("clearedAt")
  })

  it("skips unreadable session evidence without aborting the scan", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const readable = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    const corrupt = await sessionFixture(provider, ownerId, secondId, now - 20 * day)
    await writeFile(path.join(corrupt.owner, "desktop-session.json"), "{")
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 1 })
    await expect(realpath(path.join(readable.home, "workspace"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(realpath(path.join(corrupt.home, "workspace"))).resolves.toBeTruthy()
  })

  it("rejects preparations and recoveries for a known foreign v2 origin", async () => {
    const { provider } = await fixture()
    const paths = provider.pathsFor(ownerId, firstId)
    await provider.prepareOwnerFilesystem(paths)
    await writeMarker(provider, ownerId, firstId, Date.now(), { version: 2, origin: otherOrigin })
    await expect(provider.prepareOwnerFilesystem(paths)).rejects.toThrow("different server origin")

    const acquire = vi.spyOn(provider, "acquire")
    const turns = new DesktopTurns(provider, provider.pathsFor(ownerId, firstId).root,
      serverOrigin, vi.fn(), pino({ enabled: false }))
    const expiresAt = new Date(Date.now() + 30_000).toISOString()
    const command = desktopExecutionCommandSchema.parse({
      type: "command", id: randomUUID(), owner_id: ownerId, conversation_id: firstId,
      runtime_generation: randomUUID(), turn_id: turnId, operation: "turn.start", expires_at: expiresAt,
      body: {
        native_thread_id: null, input: "Fixture", reasoning_effort: "low",
        credentials: {
          turn_id: turnId, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
          primary: {
            purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture",
            revision: 1, protocol_mode: "native_responses",
          },
        },
      },
    })
    await expect(turns.execute(command, AbortSignal.timeout(5_000))).resolves
      .toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
    expect(acquire).not.toHaveBeenCalled()
    await turns.shutdown()
  })

  it("reconciles staged attachments only during startup maintenance, not manual cleanup", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const session = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    const staged = path.join(session.control, `attachments-${turnId}-abcdef`)
    await mkdir(staged)
    const manual = await provider.pruneWorkspaces(now, { ownerId })
    expect(manual).toMatchObject({ deleted: 0 })
    await expect(realpath(staged)).resolves.toBeTruthy()
    const startup = await provider.pruneWorkspaces(now)
    expect(startup).toMatchObject({ deleted: 1 })
    await expect(realpath(staged)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("reports a failed cleanup without following an escaped workspace link", async () => {
    const { root, provider } = await fixture()
    const now = Date.now()
    const session = await sessionFixture(provider, ownerId, thirdId, now - 20 * day)
    const outside = path.join(root, "outside")
    await mkdir(path.join(outside, "workspace"), { recursive: true })
    await writeFile(path.join(outside, "workspace", "keep.txt"), "keep")
    await rm(session.home, { recursive: true })
    await symlink(outside, session.home, process.platform === "win32" ? "junction" : "dir")
    await expect(provider.pruneWorkspaces(now)).rejects.toThrow(/escapes its root|crosses an alias/u)
    expect(await readFile(path.join(outside, "workspace", "keep.txt"), "utf8")).toBe("keep")
  })

  it("stops scanning and deleting once shutdown begins", async () => {
    const { provider } = await fixture()
    const now = Date.now()
    const session = await sessionFixture(provider, ownerId, firstId, now - 20 * day)
    await writeFile(path.join(session.home, "workspace", "keep.txt"), "keep")
    expect(provider.beginMaintenance()).toBe(true)
    await provider.shutdown()
    expect(provider.beginMaintenance()).toBe(false)
    expect(await provider.pruneWorkspaces(now)).toMatchObject({ deleted: 0 })
    expect(await readFile(path.join(session.home, "workspace", "keep.txt"), "utf8")).toBe("keep")
    await expect(provider.workspaceUsage(ownerId)).rejects.toThrow("stopping")
  })
})
