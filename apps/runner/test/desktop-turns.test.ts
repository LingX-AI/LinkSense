import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import pino from "pino"
import { expect, it, vi } from "vitest"
import { desktopExecutionAckSchema, desktopExecutionCommandSchema } from "@linksense/shared"

import { DesktopWorkerProvider } from "../src/controller/desktop-worker-provider.js"
import { DesktopLink } from "../src/desktop/link.js"
import { DesktopTurns } from "../src/desktop/turns.js"
import { desktopWorkerCallbacks } from "../src/desktop/worker-callbacks.js"
import { StartOperationStore } from "../src/start-operation.js"
import { prepareConversationControl, WorkspaceManager } from "../src/workspace/workspace-manager.js"
import { deferred } from "./deferred.js"

const logger = pino({ enabled: false })

it("reports app-server exit on the same link after retiring the actual worker process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-exit-"))
  const runtimeRoot = path.join(root, "runtime")
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const controlToken = "a".repeat(64)
  const fail = vi.fn()
  const state: { current?: { link: DesktopLink; turns: DesktopTurns } } = {}
  const callbacks = desktopWorkerCallbacks(controlToken, () => state.current)
  const origin = await callbacks.listen({ host: "127.0.0.1", port: 0 })
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken, bridgeUrl: `${origin}/` }, logger, fail)
  const turns = new DesktopTurns(provider, runtimeRoot, origin, fail, logger)
  const started = vi.fn()
  const exited = vi.fn()
  const link = new DesktopLink(randomUUID(), scope.owner_id, turns, async output => {
    if (output.type !== "link.frame") return
    const frame = output.frame
    if (frame.type === "command.result" && frame.operation === "turn.start") {
      expect(frame.ok).toBe(true)
      started()
    }
    if (frame.type !== "execution.callback") return
    expect(frame).toMatchObject({
      operation: "turn.exited", conversation_id: scope.conversation_id,
      turn_id: scope.turn_id, runtime_generation: scope.runtime_generation,
    })
    expect(await provider.hasWorkerForEnvironment(scope.owner_id, scope.conversation_id)).toBe(false)
    link.receive(desktopExecutionAckSchema.parse({
      type: "execution.ack", id: frame.id, operation: "turn.exited", ok: true,
    }))
    exited()
  }, fail)
  state.current = { link, turns }
  try {
    const generation = "0".repeat(64)
    const bundle = path.join(runtimeRoot, "capabilities")
    const script = path.join(runtimeRoot, "runner", "dist", "index.js")
    for (const directory of ["skills", "plugins", "plugin-sources"].map(name => path.join(bundle, name))
      .concat(path.dirname(script), path.join(runtimeRoot, "bin"))) await mkdir(directory, { recursive: true })
    await symlink(process.execPath, path.join(runtimeRoot, "bin", "node"))
    await writeFile(path.join(bundle, "capability-snapshot.json"), JSON.stringify({
      version: 1, id: `${generation}-${randomUUID()}`, generation, contentDigest: generation, sourceDigest: generation, pluginNames: [],
    }))
    await writeFile(script, `
      const { existsSync } = require("node:fs")
      const { createServer } = require("node:http")
      const env = process.env
      const server = createServer((request, response) => {
        response.setHeader("content-type", "application/json")
        if (request.url === "/health/ready") return response.end('{"status":"available"}')
        if (request.url !== "/conversations/" + env.LINKSENSE_SERVICE_SESSION_ID + "/turns/start") {
          response.statusCode = 404
          return response.end()
        }
        const now = new Date().toISOString()
        response.end(JSON.stringify({
          status: "starting", createdAt: now, updatedAt: now,
          conversationId: env.LINKSENSE_SERVICE_SESSION_ID, projectionTurnId: env.LINKSENSE_DESKTOP_TURN_ID,
        }))
        const exit = setInterval(() => {
          if (!existsSync("fixture-exit")) return
          clearInterval(exit)
          fetch(env.LINKSENSE_API_INTERNAL_URL + "internal/runner/process-exit", {
            method: "POST",
            headers: {
              authorization: "Bearer " + env.LINKSENSE_RUNNER_SHARED_SECRET,
              "x-linksense-owner-id": env.LINKSENSE_WORKER_OWNER_ID,
              "x-linksense-service-session": env.LINKSENSE_SERVICE_SESSION_ID,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              conversationId: env.LINKSENSE_SERVICE_SESSION_ID, projectionTurnId: env.LINKSENSE_DESKTOP_TURN_ID,
              capabilityGeneration: "0".repeat(64),
            }),
          }).then(reply => reply.arrayBuffer()).catch(() => process.exit(1))
        }, 10).unref()
      }).listen({ fd: 4 })
      process.on("disconnect", () => server.close(() => process.exit(0)))
    `)
    const expiresAt = new Date(Date.now() + 10_000).toISOString()
    link.receive(desktopExecutionCommandSchema.parse({
      ...scope, type: "command", operation: "turn.start", id: randomUUID(), expires_at: expiresAt,
      body: { native_thread_id: null, input: "Fixture", reasoning_effort: "low", credentials: {
        turn_id: scope.turn_id, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      } },
    }))
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce(), { timeout: 2_000 })
    await writeFile(path.join(provider.pathsFor(scope.owner_id, scope.conversation_id).home, "fixture-exit"), "")
    await vi.waitFor(() => expect(exited).toHaveBeenCalledOnce(), { timeout: 2_000 })
    expect(fail).not.toHaveBeenCalled()
  } finally {
    await link.close()
    await provider.shutdown()
    await callbacks.close()
    await rm(root, { recursive: true, force: true })
  }
})

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

it("keeps lifecycle callbacks available when the search lane is full", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-tools-"))
  const origin = "https://server.example.test"
  const fail = vi.fn()
  const provider = new DesktopWorkerProvider({ dataRoot: root, runtimeRoot: root, controlToken: "a".repeat(64) }, logger)
  const turns = new DesktopTurns(provider, root, origin, fail, logger)
  const scope = {
    owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID(),
  }
  const timer = setTimeout(() => {}, 1_000)
  const run = { scope, token: `lsdr_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000, timer }
  const controller = new AbortController()
  const searchIds = new Set<string>()
  const link = new DesktopLink(randomUUID(), scope.owner_id, turns, async ({ frame }) => {
    if (frame.type === "tool.request") searchIds.add(frame.id)
    if (frame.type === "execution.callback" && frame.operation === "turn.exited") {
      link.receive({ type: "execution.ack", id: frame.id, operation: "turn.exited", ok: true })
    }
  }, fail, ["web.search"])
  const pending = Promise.allSettled(Array.from({ length: 5 }, () =>
    link.requestTool(run, { operation: "web.search", body: { query: "sample" } }, controller.signal)))
  try {
    expect(searchIds.size).toBe(4)
    await expect(link.callback(run, "turn.exited")).resolves.toMatchObject({ ok: true, operation: "turn.exited" })
  } finally {
    clearTimeout(timer)
    controller.abort()
    await pending
    await link.close()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
  expect((await pending).at(-1)).toMatchObject({ status: "fulfilled", value: { ok: false, error_code: "RUNNER_UNAVAILABLE" } })
})
