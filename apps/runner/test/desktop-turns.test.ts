import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import pino from "pino"
import { expect, it, vi } from "vitest"
import { desktopExecutionCommandSchema } from "@linksense/shared"

import { DesktopWorkerProvider } from "../src/controller/desktop-worker-provider.js"
import { DesktopLink } from "../src/desktop/link.js"
import { DesktopTurns } from "../src/desktop/turns.js"
import { StartOperationStore } from "../src/start-operation.js"
import { prepareConversationControl, WorkspaceManager } from "../src/workspace/workspace-manager.js"
import { deferred } from "./deferred.js"

const logger = pino({ enabled: false })

it.each(["rejected", "canceled"] as const)("retires and seals a %s start before a journal was created", async failure => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-canceled-start-"))
  const runtimeRoot = path.join(root, "runtime")
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) }, logger)
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, runtimeRoot, "https://server.example.test", workerLost, logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])
  const worker = {
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running" as const,
  }
  const generation = "0".repeat(64)
  const started = deferred<void>()
  const release = vi.spyOn(provider, "release").mockResolvedValue()
  const acquire = vi.spyOn(provider, "acquire").mockResolvedValue(worker)
  vi.spyOn(provider, "request").mockImplementation(async (_worker, route, callerSignal) => {
    if (route === "/health/ready") return Response.json({ status: "available" })
    started.resolve()
    if (failure === "rejected") return Response.json({}, { status: 503 })
    return new Promise<Response>((_resolve, reject) => callerSignal.addEventListener("abort", () => reject(callerSignal.reason), { once: true }))
  })
  const command = desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.start", id: randomUUID(),
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    body: {
      native_thread_id: null, input: "Fixture", reasoning_effort: "low",
      credentials: {
        turn_id: scope.turn_id, expires_at: new Date(Date.now() + 30_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  try {
    const bundle = path.join(runtimeRoot, "capabilities")
    for (const directory of ["skills", "plugins", "plugin-sources"]) await mkdir(path.join(bundle, directory), { recursive: true })
    await writeFile(path.join(bundle, "capability-snapshot.json"), JSON.stringify({
      version: 1, id: `${generation}-${randomUUID()}`, generation, contentDigest: generation, sourceDigest: generation, pluginNames: [],
    }))
    const result = turns.execute(command, signal)
    if (failure === "canceled") {
      await started.promise
      controller.abort()
    }
    expect(await result).toMatchObject({ ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" })
    expect(release).toHaveBeenCalledWith(worker)
    expect(await turns.execute({ ...command, id: randomUUID() }, AbortSignal.timeout(5_000))).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" },
    })
    expect(acquire).toHaveBeenCalledOnce()
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    controller.abort()
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it("settles a journal left before native submission without starting a worker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-unsubmitted-"))
  const provider = new DesktopWorkerProvider({ dataRoot: root, runtimeRoot: root, controlToken: "a".repeat(64) }, logger)
  const acquire = vi.spyOn(provider, "acquire")
  const turns = new DesktopTurns(provider, root, "https://server.example.test", vi.fn(), logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
  try {
    await provider.prepareOwnerFilesystem(paths)
    await prepareConversationControl(paths, scope.conversation_id, "workspace", undefined, scope.runtime_generation)
    const store = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: scope.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    }))
    expect(await store.createStarting(scope.conversation_id, scope.turn_id, scope.owner_id, "0".repeat(64))).not.toBeNull()
    const command = desktopExecutionCommandSchema.parse({
      ...scope, type: "command", operation: "turn.inspect", id: randomUUID(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    })
    expect(await turns.execute(command, AbortSignal.timeout(5_000))).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_FAILED" },
    })
    expect(await store.read(scope.conversation_id, scope.turn_id)).toMatchObject({ status: "failed" })
    expect(acquire).not.toHaveBeenCalled()
  } finally {
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(["empty", "staged", "published state", "wrong generation", "corrupt generation"])(
  "preserves the generation boundary after interrupted control initialization (%s)", async state => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-generation-"))
    const runtimeRoot = path.join(root, "runtime")
    const origin = "https://server.example.test"
    const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) },
      logger)
    const turns = new DesktopTurns(provider, runtimeRoot, origin, vi.fn(), logger)
    const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
    const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
    const control = path.join(paths.control, "workspaces", scope.conversation_id)
    const marker = path.join(control, "runtime-generation")
    const value = state === "wrong generation" ? randomUUID() : "corrupt"
    try {
      await mkdir(control, { recursive: true, mode: 0o700 })
      if (state === "staged") await writeFile(path.join(control, `.${randomUUID()}.tmp`), "", { mode: 0o600 })
      if (state === "published state") await mkdir(path.join(control, "start-operations"), { mode: 0o700 })
      if (state === "wrong generation" || state === "corrupt generation") await writeFile(marker, value, { mode: 0o600 })
      const command = desktopExecutionCommandSchema.parse({ type: "command", ...scope, id: randomUUID(),
        operation: "turn.interrupt", expires_at: new Date(Date.now() + 30_000).toISOString() })
      const result = await turns.execute(command, AbortSignal.timeout(10_000))
      if (state === "empty" || state === "staged") {
        expect(result).toMatchObject({ ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" } })
        expect(await readFile(marker, "utf8")).toBe(`${scope.runtime_generation}\n`)
      } else {
        expect(result).toMatchObject({ ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" })
        if (state === "published state") await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" })
        else expect(await readFile(marker, "utf8")).toBe(value)
      }
    } finally {
      await turns.shutdown()
      await provider.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  },
)

it.each(["before start", "during start", "before workspace eviction"])("seals a cancellation %s without acquiring any worker", async order => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-interrupt-"))
  const dataRoot = path.join(root, "sessions")
  const origin = "https://server.example.test"
  const provider = new DesktopWorkerProvider({ dataRoot, runtimeRoot: root, controlToken: "a".repeat(64) },
    logger)
  const acquire = vi.spyOn(provider, "acquire")
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, root, origin, workerLost, logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const command = { type: "command", ...scope, expires_at: new Date(Date.now() + 30_000).toISOString() }
  const start = desktopExecutionCommandSchema.parse({
    ...command, id: randomUUID(), operation: "turn.start",
    body: {
      input: "Fixture", reasoning_effort: "low", native_thread_id: null,
      credentials: {
        turn_id: scope.turn_id, expires_at: command.expires_at, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  const signal = AbortSignal.timeout(10_000)
  try {
    const started = order === "during start" ? turns.execute(start, signal) : undefined
    const stop = desktopExecutionCommandSchema.parse({
      ...command, operation: "turn.interrupt", id: randomUUID(),
    })
    const interrupt = await turns.execute(stop, signal)
    expect(interrupt).toMatchObject({ ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" } })
    if (started) {
      expect(await started).toMatchObject({ ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" } })
    }
    await turns.shutdown()
    if (order === "before workspace eviction") {
      const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
      const history = path.join(paths.home, ".codex", "history-fixture")
      const workspace = path.join(paths.home, "workspace")
      await writeFile(history, "previous native history")
      await writeFile(path.join(workspace, "discarded"), "old workspace content")
      expect(await provider.pruneWorkspaces(Date.now() + 15 * 86_400_000)).toEqual({ deleted: 1, retainedBytes: 0 })
      await expect(readFile(path.join(workspace, "discarded"))).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(history, "utf8")).toBe("previous native history")
      await provider.prepareOwnerFilesystem(paths)
      await writeFile(path.join(workspace, "fresh"), "new workspace content", { flag: "wx" })
      await expect(readFile(path.join(workspace, "discarded"))).rejects.toMatchObject({ code: "ENOENT" })
    }
    const replacement = new DesktopTurns(provider, root, origin, workerLost, logger)
    try {
      expect(await replacement.execute(start, signal)).toMatchObject({
        ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" },
      })
    } finally {
      await replacement.shutdown()
    }
    expect(acquire).not.toHaveBeenCalled()
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it("does not dispatch a completed command ID again on the same connection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-dedup-"))
  const origin = "https://server.example.test"
  const provider = new DesktopWorkerProvider({ dataRoot: root, runtimeRoot: root, controlToken: "a".repeat(64) },
    logger)
  const fail = vi.fn()
  const turns = new DesktopTurns(provider, root, origin, fail, logger)
  const owner = randomUUID()
  const inspect = desktopExecutionCommandSchema.parse({
    type: "command", id: randomUUID(), owner_id: owner, conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(), operation: "turn.inspect",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  })
  const write = vi.fn(async () => {})
  const link = new DesktopLink(randomUUID(), owner, turns, write, fail)
  try {
    link.receive(inspect)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    link.receive(inspect)
    // A later distinct request is processed, but the duplicate produces no response.
    link.receive({ ...inspect, id: randomUUID() })
    await vi.waitFor(() => expect(write.mock.calls.length).toBeGreaterThanOrEqual(2))
    await link.close()
    expect(write).toHaveBeenCalledTimes(2)
    expect(fail).not.toHaveBeenCalled()
  } finally {
    await link.close()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})
