import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes, randomUUID } from "node:crypto"
import pino from "pino"
import { expect, it, vi } from "vitest"
import {
  desktopExecutionAckSchema, desktopExecutionCommandSchema, desktopModelSwitchOperation, type DesktopExecutionCommand,
} from "@linksense/shared"

import { DesktopWorkerProvider, desktopWorkerSecret } from "../src/controller/desktop-worker-provider.js"
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
  const callbacks = desktopWorkerCallbacks(controlToken, () => state.current, "https://server.example.test")
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

it.each(["undelivered", "uncertain"] as const)("fences Mac answers according to %s Stop delivery", async outcome => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-stop-delivery-"))
  const origin = "https://server.example.test"
  const workerLost = vi.fn()
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot: root, controlToken: "a".repeat(64) }, logger)
  const turns = new DesktopTurns(provider, root, origin, workerLost, logger, ["browser.execute"])
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const worker = {
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running" as const,
  }
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const command = { ...scope, type: "command", expires_at: expiresAt }
  const signal = AbortSignal.timeout(5_000)
  const answers = vi.fn(() => Response.json({ accepted: true }))
  vi.spyOn(provider, "acquire").mockResolvedValue(worker)
  vi.spyOn(provider, "request").mockImplementation((_worker, route) => {
    if (route.endsWith("/interrupt")) {
      if (outcome === "undelivered") throw new Error("fixture dispatch rejected")
      return Promise.reject(new Error("fixture receipt lost"))
    }
    if (route.endsWith("/user-input/respond")) return Promise.resolve(answers())
    return Promise.resolve(Response.json(route === "/health/ready" ? { status: "available" } : {
      status: "starting", createdAt: expiresAt, updatedAt: expiresAt,
      conversationId: scope.conversation_id, projectionTurnId: scope.turn_id,
    }))
  })
  try {
    const generation = "0".repeat(64)
    const bundle = path.join(root, "capabilities")
    for (const name of ["skills", "plugins", "plugin-sources"]) await mkdir(path.join(bundle, name), { recursive: true })
    await writeFile(path.join(bundle, "capability-snapshot.json"), JSON.stringify({
      version: 1, id: `${generation}-${randomUUID()}`, generation, contentDigest: generation, sourceDigest: generation, pluginNames: [],
    }))
    await expect(turns.execute(desktopExecutionCommandSchema.parse({
      ...command, id: randomUUID(), operation: "turn.start",
      body: { native_thread_id: null, input: "Fixture", reasoning_effort: "low", credentials: {
        turn_id: scope.turn_id, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      } },
    }), signal)).resolves.toMatchObject({ ok: true })
    await expect(turns.execute(desktopExecutionCommandSchema.parse({
      ...command, id: randomUUID(), operation: "turn.interrupt",
    }), signal)).resolves.toMatchObject({
      ok: false, error_code: outcome === "undelivered" ? "RUNNER_UNAVAILABLE" : "RUNNER_OPERATION_UNCERTAIN",
    })
    await expect(turns.execute(desktopExecutionCommandSchema.parse({
      ...command, id: randomUUID(), operation: "user-input.respond",
      body: { codexThreadId: "native-thread", codexTurnId: "native-turn", itemId: "native-item", requestId: 7, response: { action: "cancel" } },
    }), signal)).resolves.toMatchObject(outcome === "undelivered"
      ? { ok: true, result: { accepted: true } }
      : { ok: false, error_code: "USER_INPUT_REQUEST_UNAVAILABLE" })
    expect(answers).toHaveBeenCalledTimes(Number(outcome === "undelivered"))
  } finally {
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

it("defers a failed direct start receipt until its owning worker retires", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-direct-retire-"))
  const runtimeRoot = path.join(root, "runtime")
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) }, logger)
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, runtimeRoot, "https://server.example.test", workerLost, logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const signal = AbortSignal.timeout(10_000)
  const worker = {
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running" as const,
  }
  const acquire = vi.spyOn(provider, "acquire").mockResolvedValue(worker)
  const startedTurns: string[] = []
  const releaseStarted = deferred<void>()
  const releaseGate = deferred<void>()
  let releaseCompleted = false
  vi.spyOn(provider, "release").mockImplementation(async () => {
    releaseStarted.resolve()
    await releaseGate.promise
    releaseCompleted = true
  })
  const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
  const store = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
    fixedOwnerId: scope.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
  }))
  vi.spyOn(provider, "request").mockImplementation(async (_worker, route, _signal, body) => {
    if (route === "/health/ready") return Response.json({ status: "available" })
    if (!route.endsWith("/turns/start")) throw new Error(`unexpected route ${route}`)
    const turnId = (body as { projectionTurnId?: string } | undefined)?.projectionTurnId
    if (!turnId) throw new Error("start body has no turn")
    startedTurns.push(turnId)
    // Production persists the failed sealed journal before the failed wire reply.
    const starting = await store.createStarting(scope.conversation_id, turnId, scope.owner_id)
    if (!starting) throw new Error("fixture start journal was not created")
    await store.update(starting, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    return Response.json({
      conversationId: scope.conversation_id, projectionTurnId: turnId, status: "failed",
      errorCode: "RUNNER_TURN_START_SEALED", createdAt: expiresAt, updatedAt: expiresAt,
    })
  })
  const start = (turnId: string) => desktopExecutionCommandSchema.parse({
    ...scope, turn_id: turnId, type: "command", operation: "turn.start", id: randomUUID(), expires_at: expiresAt,
    body: {
      native_thread_id: null, input: "Fixture", reasoning_effort: "low",
      credentials: {
        turn_id: turnId, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  const inspect = () => desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.inspect", id: randomUUID(), expires_at: expiresAt,
  })
  try {
    await prepareCapabilitySnapshot(runtimeRoot)
    const result = await turns.execute(start(scope.turn_id), signal)
    await releaseStarted.promise

    expect(result).toMatchObject({ ok: true, result: { status: "starting", projectionTurnId: scope.turn_id } })
    const run = turns.scopedRun(scope.conversation_id)
    if (!run) throw new Error("fixture start has no run")
    expect(await turns.inspectRun(run)).toMatchObject({ status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    expect(await turns.execute(inspect(), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(releaseCompleted).toBe(false)
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])

    releaseGate.resolve()
    await vi.waitFor(() => expect(turns.scopedRun(scope.conversation_id)).toBeUndefined())
    expect(releaseCompleted).toBe(true)
    expect(await turns.execute(inspect(), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    releaseGate.resolve()
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it("settles a failed start callback only after the owning worker retires", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-callback-retire-"))
  const runtimeRoot = path.join(root, "runtime")
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) }, logger)
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, runtimeRoot, "https://server.example.test", workerLost, logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const signal = AbortSignal.timeout(10_000)
  const worker = {
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running" as const,
  }
  const acquire = vi.spyOn(provider, "acquire").mockResolvedValue(worker)
  const startedTurns: string[] = []
  const releaseStarted = deferred<void>()
  const releaseGate = deferred<void>()
  let releaseStartedResolved = false
  let releaseStartedBeforeAck = true
  let releaseCompleted = false
  vi.spyOn(provider, "release").mockImplementation(async () => {
    releaseStartedResolved = true
    releaseStarted.resolve()
    await releaseGate.promise
    releaseCompleted = true
  })
  vi.spyOn(provider, "request").mockImplementation(async (_worker, route, _signal, body) => {
    if (route === "/health/ready") return Response.json({ status: "available" })
    if (!route.endsWith("/turns/start")) throw new Error(`unexpected route ${route}`)
    const turnId = (body as { projectionTurnId?: string } | undefined)?.projectionTurnId
    if (!turnId) throw new Error("start body has no turn")
    startedTurns.push(turnId)
    return Response.json({
      conversationId: scope.conversation_id, projectionTurnId: turnId, status: "starting", createdAt: expiresAt, updatedAt: expiresAt,
    })
  })
  const start = (turnId: string) => desktopExecutionCommandSchema.parse({
    ...scope, turn_id: turnId, type: "command", operation: "turn.start", id: randomUUID(), expires_at: expiresAt,
    body: {
      native_thread_id: null, input: "Fixture", reasoning_effort: "low",
      credentials: {
        turn_id: turnId, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  const inspect = () => desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.inspect", id: randomUUID(), expires_at: expiresAt,
  })
  const state: { current?: { link: DesktopLink; turns: DesktopTurns } } = {}
  let callbacks: ReturnType<typeof desktopWorkerCallbacks> | undefined
  let link: DesktopLink | undefined
  let inspectedInCallback: Awaited<ReturnType<DesktopTurns["execute"]>> | undefined
  try {
    await prepareCapabilitySnapshot(runtimeRoot)
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
    const store = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: scope.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    }))
    const starting = await store.createStarting(scope.conversation_id, scope.turn_id, scope.owner_id)
    if (!starting) throw new Error("fixture start journal was not created")
    await store.update(starting, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })

    callbacks = desktopWorkerCallbacks("a".repeat(64), () => state.current, "https://server.example.test")
    const address = await callbacks.listen({ host: "127.0.0.1", port: 0 })
    const created = new DesktopLink(randomUUID(), scope.owner_id, turns, async output => {
      const frame = output.frame
      if (frame.type !== "execution.callback" || frame.operation !== "start.settled") return
      inspectedInCallback = await turns.execute(inspect(), signal)
      releaseStartedBeforeAck = releaseStartedResolved
      created.receive(desktopExecutionAckSchema.parse({
        type: "execution.ack", id: frame.id, operation: "start.settled", ok: true, data: { settled: false },
      }))
    }, vi.fn())
    link = created
    state.current = { link: created, turns }
    const response = await fetch(`${address}/internal/runner/start-settled`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${desktopWorkerSecret(scope.owner_id, "a".repeat(64), scope.conversation_id, {
          turnId: scope.turn_id, runtimeGeneration: scope.runtime_generation,
        })}`,
        "content-type": "application/json",
        "x-linksense-owner-id": scope.owner_id,
        "x-linksense-service-session": scope.conversation_id,
      },
      body: JSON.stringify({ conversationId: scope.conversation_id, projectionTurnId: scope.turn_id,
        runtimeGeneration: scope.runtime_generation }),
      signal: AbortSignal.timeout(5_000),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { settled: false } })
    await releaseStarted.promise

    expect(inspectedInCallback).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(releaseStartedBeforeAck).toBe(false)
    expect(releaseCompleted).toBe(false)
    const run = turns.scopedRun(scope.conversation_id)
    if (!run) throw new Error("fixture start has no run")
    expect(await turns.inspectRun(run)).toMatchObject({ status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    expect(await turns.execute(inspect(), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])

    releaseGate.resolve()
    await vi.waitFor(() => expect(turns.scopedRun(scope.conversation_id)).toBeUndefined())
    expect(releaseCompleted).toBe(true)
    expect(await turns.execute(inspect(), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    releaseGate.resolve()
    await callbacks?.close()
    if (link) await link.close()
    else await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it("defers a seal receipt while a late same-turn start still owns the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-seal-retire-"))
  const runtimeRoot = path.join(root, "runtime")
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) }, logger)
  const acquire = vi.spyOn(provider, "acquire")
  const turns = new DesktopTurns(provider, runtimeRoot, "https://server.example.test", vi.fn(), logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const signal = AbortSignal.timeout(10_000)
  const seal = desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.seal", id: randomUUID(), expires_at: expiresAt,
  })
  const start = desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.start", id: randomUUID(), expires_at: expiresAt,
    body: {
      native_thread_id: null, input: "Fixture", reasoning_effort: "low",
      credentials: {
        turn_id: scope.turn_id, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  const inspect = desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.inspect", id: randomUUID(), expires_at: expiresAt,
  })
  const sealEntered = deferred<void>()
  const sealGate = deferred<void>()
  const original = StartOperationStore.prototype.createSealed
  const sealed = vi.spyOn(StartOperationStore.prototype, "createSealed").mockImplementation(
    async function (this: StartOperationStore, ...args: Parameters<StartOperationStore["createSealed"]>) {
      sealEntered.resolve()
      await sealGate.promise
      return original.apply(this, args)
    })
  try {
    const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
    await provider.prepareOwnerFilesystem(paths)
    await prepareConversationControl(paths, scope.conversation_id, "workspace", undefined, scope.runtime_generation)
    const sealing = turns.execute(seal, signal)
    await sealEntered.promise
    // This reserves its session synchronously and waits for the pending seal.
    const starting = turns.execute(start, signal)
    sealGate.resolve()

    expect(await sealing).toMatchObject({
      ok: true, result: { status: "uncertain", errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN", projectionTurnId: scope.turn_id },
    })
    expect(await starting).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
    expect(acquire).not.toHaveBeenCalled()
    const store = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: scope.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    }))
    expect(await store.read(scope.conversation_id, scope.turn_id)).toMatchObject({
      status: "failed", errorCode: "RUNNER_TURN_START_SEALED",
    })
    expect(await turns.execute(inspect, signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
  } finally {
    sealGate.resolve()
    sealed.mockRestore()
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it("keeps Stop scoped while a failed owner retires and seals a turn stopped before its start", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-stop-scope-"))
  const runtimeRoot = path.join(root, "runtime")
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) }, logger)
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, runtimeRoot, "https://server.example.test", workerLost, logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const freshTurnId = randomUUID()
  const laterTurnId = randomUUID()
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const signal = AbortSignal.timeout(10_000)
  const startedTurns: string[] = []
  const interruptAttempts: string[] = []
  const worker = {
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running" as const,
  }
  const acquire = vi.spyOn(provider, "acquire").mockResolvedValue(worker)
  const releases = [
    { started: deferred<void>(), gate: deferred<void>() },
    { started: deferred<void>(), gate: deferred<void>() },
  ] as const
  let releaseCalls = 0
  let releaseDepth = 0
  vi.spyOn(provider, "release").mockImplementation(async () => {
    const release = releases[releaseCalls]
    if (!release) throw new Error("unexpected worker release")
    releaseCalls += 1
    releaseDepth += 1
    release.started.resolve()
    try {
      await release.gate.promise
    } finally {
      releaseDepth -= 1
    }
  })
  vi.spyOn(provider, "request").mockImplementation((_worker, route, _signal, body) => {
    if (route === "/health/ready") return Promise.resolve(Response.json({ status: "available" }))
    if (route.endsWith("/interrupt")) {
      interruptAttempts.push(route)
      // Match DesktopWorkerProvider.request: a worker in release is unavailable synchronously.
      if (releaseDepth > 0) throw new Error("desktop worker is unavailable")
      return Promise.resolve(Response.json({ code: "TURN_INTERRUPT_REQUESTED" }))
    }
    if (!route.endsWith("/turns/start")) throw new Error(`unexpected route ${route}`)
    const turnId = (body as { projectionTurnId?: string } | undefined)?.projectionTurnId
    if (!turnId) throw new Error("start body has no turn")
    startedTurns.push(turnId)
    return Promise.resolve(Response.json({
      conversationId: scope.conversation_id, projectionTurnId: turnId, status: "starting", createdAt: expiresAt, updatedAt: expiresAt,
    }))
  })
  const start = (turnId: string) => desktopExecutionCommandSchema.parse({
    ...scope, turn_id: turnId, type: "command", operation: "turn.start", id: randomUUID(), expires_at: expiresAt,
    body: {
      native_thread_id: null, input: "Fixture", reasoning_effort: "low",
      credentials: {
        turn_id: turnId, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  const stop = (turnId: string, runtimeGeneration = scope.runtime_generation, ownerId = scope.owner_id) => desktopExecutionCommandSchema.parse({
    ...scope, owner_id: ownerId, turn_id: turnId, runtime_generation: runtimeGeneration,
    type: "command", operation: "turn.interrupt", id: randomUUID(), expires_at: expiresAt,
  })
  const inspect = () => desktopExecutionCommandSchema.parse({
    ...scope, type: "command", operation: "turn.inspect", id: randomUUID(), expires_at: expiresAt,
  })
  try {
    await prepareCapabilitySnapshot(runtimeRoot)
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
    const store = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: scope.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    }))
    const starting = await store.createStarting(scope.conversation_id, scope.turn_id, scope.owner_id)
    if (!starting) throw new Error("fixture start journal was not created")
    expect(await turns.execute(stop(scope.turn_id), signal)).toMatchObject({
      ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" },
    })
    expect(releaseCalls).toBe(0)
    expect(interruptAttempts).toEqual([`/conversations/${scope.conversation_id}/turns/start/${scope.turn_id}/interrupt`])
    await store.update(starting, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    const run = turns.scopedRun(scope.conversation_id)
    if (!run) throw new Error("fixture start has no run")
    turns.finishAfterAcknowledgement(run)
    await releases[0].started.promise

    expect(await turns.execute(stop(scope.turn_id), signal)).toMatchObject({
      ok: true, result: { code: "TURN_INTERRUPT_NOT_ACTIVE" },
    })
    expect(interruptAttempts).toHaveLength(1)
    expect(await turns.inspectRun(run)).toMatchObject({ status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    expect(await turns.execute(inspect(), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    expect(await turns.execute(stop(freshTurnId), signal)).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
    expect(await store.read(scope.conversation_id, freshTurnId)).toBeNull()
    expect(await turns.execute(stop(scope.turn_id, randomUUID()), signal)).toMatchObject({
      ok: false, error_code: "RUNNER_UNAVAILABLE",
    })
    expect(await turns.execute(stop(scope.turn_id, scope.runtime_generation, randomUUID()), signal)).toMatchObject({
      ok: false, error_code: "RUNNER_UNAVAILABLE",
    })
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])
    expect(interruptAttempts).toHaveLength(1)

    releases[0].gate.resolve()
    await vi.waitFor(() => expect(turns.scopedRun(scope.conversation_id)).toBeUndefined())
    expect(await turns.execute(inspect(), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: scope.turn_id },
    })
    expect(await turns.execute(stop(freshTurnId), signal)).toMatchObject({
      ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" },
    })
    expect(await store.read(scope.conversation_id, freshTurnId)).toMatchObject({
      status: "failed", errorCode: "RUNNER_TURN_START_SEALED",
      ownerId: scope.owner_id, runtimeGeneration: scope.runtime_generation,
    })
    expect(await turns.execute(start(freshTurnId), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: freshTurnId },
    })
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])

    expect(await turns.execute(start(laterTurnId), signal)).toMatchObject({
      ok: true, result: { status: "starting", projectionTurnId: laterTurnId },
    })
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(startedTurns).toEqual([scope.turn_id, laterTurnId])

    const laterStarting = await store.createStarting(scope.conversation_id, laterTurnId, scope.owner_id)
    if (!laterStarting) throw new Error("fixture later start journal was not created")
    const laterRun = turns.scopedRun(scope.conversation_id)
    if (!laterRun) throw new Error("fixture later start has no run")
    turns.finishAfterAcknowledgement(laterRun)
    await releases[1].started.promise

    expect(await turns.execute(stop(laterTurnId), signal)).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
    expect(interruptAttempts.at(-1)).toBe(`/conversations/${scope.conversation_id}/turns/start/${laterTurnId}/interrupt`)
    await store.update(laterStarting, { status: "uncertain", errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN" })
    expect(await turns.inspectRun(laterRun)).toMatchObject({ status: "uncertain", errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN" })
    expect(await turns.execute(stop(laterTurnId), signal)).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
    expect(interruptAttempts).toHaveLength(3)
    expect(interruptAttempts.at(-1)).toBe(`/conversations/${scope.conversation_id}/turns/start/${laterTurnId}/interrupt`)

    releases[1].gate.resolve()
    await vi.waitFor(() => expect(turns.scopedRun(scope.conversation_id)).toBeUndefined())
    expect(releaseCalls).toBe(2)
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    for (const release of releases) release.gate.resolve()
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it("does not mask another turn's failed or uncertain receipt behind a retiring owner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-retire-scope-"))
  const runtimeRoot = path.join(root, "runtime")
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot, controlToken: "a".repeat(64) }, logger)
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, runtimeRoot, "https://server.example.test", workerLost, logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const staleTurnId = randomUUID()
  const uncertainTurnId = randomUUID()
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const signal = AbortSignal.timeout(10_000)
  const startedTurns: string[] = []
  const worker = {
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running" as const,
  }
  const acquire = vi.spyOn(provider, "acquire").mockResolvedValue(worker)
  const releaseStarted = deferred<void>()
  const releaseGate = deferred<void>()
  vi.spyOn(provider, "release").mockImplementation(async () => {
    releaseStarted.resolve()
    await releaseGate.promise
  })
  vi.spyOn(provider, "request").mockImplementation(async (_worker, route, _signal, body) => {
    if (route === "/health/ready") return Response.json({ status: "available" })
    if (!route.endsWith("/turns/start")) throw new Error(`unexpected route ${route}`)
    const turnId = (body as { projectionTurnId?: string } | undefined)?.projectionTurnId
    if (!turnId) throw new Error("start body has no turn")
    startedTurns.push(turnId)
    return Response.json({
      conversationId: scope.conversation_id, projectionTurnId: turnId, status: "starting", createdAt: expiresAt, updatedAt: expiresAt,
    })
  })
  const start = (turnId: string, runtimeGeneration = scope.runtime_generation, ownerId = scope.owner_id) => desktopExecutionCommandSchema.parse({
    ...scope, owner_id: ownerId, turn_id: turnId, runtime_generation: runtimeGeneration,
    type: "command", operation: "turn.start", id: randomUUID(), expires_at: expiresAt,
    body: {
      native_thread_id: null, input: "Fixture", reasoning_effort: "low",
      credentials: {
        turn_id: turnId, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  })
  const inspect = (turnId: string, runtimeGeneration = scope.runtime_generation, ownerId = scope.owner_id) => desktopExecutionCommandSchema.parse({
    ...scope, owner_id: ownerId, turn_id: turnId, runtime_generation: runtimeGeneration,
    type: "command", operation: "turn.inspect", id: randomUUID(), expires_at: expiresAt,
  })
  try {
    await prepareCapabilitySnapshot(runtimeRoot)
    expect(await turns.execute(start(scope.turn_id), signal)).toMatchObject({ ok: true, result: { status: "starting" } })
    const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
    const store = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: scope.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    }))
    const active = await store.createStarting(scope.conversation_id, scope.turn_id, scope.owner_id)
    if (!active) throw new Error("fixture start journal was not created")
    expect(await turns.execute(inspect(scope.turn_id), signal)).toMatchObject({
      ok: true, result: { status: "starting", projectionTurnId: scope.turn_id },
    })
    await store.update(active, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    const run = turns.scopedRun(scope.conversation_id)
    if (!run) throw new Error("fixture start has no run")
    turns.finishAfterAcknowledgement(run)
    await releaseStarted.promise

    expect(await store.createSealed(scope.conversation_id, staleTurnId, scope.owner_id, scope.runtime_generation)).not.toBeNull()
    expect(await turns.execute(inspect(staleTurnId), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: staleTurnId },
    })
    expect(await turns.execute(start(staleTurnId), signal)).toMatchObject({
      ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED", projectionTurnId: staleTurnId },
    })
    const uncertain = await store.createStarting(scope.conversation_id, uncertainTurnId, scope.owner_id)
    if (!uncertain) throw new Error("fixture uncertain journal was not created")
    const correlated = await store.updateCorrelation(uncertain, {
      codexThreadId: randomUUID(), baselineTurnIds: [], preparedAt: expiresAt,
    })
    await store.update(correlated, { status: "uncertain", errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN" })
    expect(await turns.execute(inspect(uncertainTurnId), signal)).toMatchObject({
      ok: true, result: { status: "uncertain", errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN", projectionTurnId: uncertainTurnId },
    })
    expect(await turns.execute(inspect(scope.turn_id, randomUUID()), signal)).toMatchObject({
      ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
    })
    expect(await turns.execute(inspect(scope.turn_id, scope.runtime_generation, randomUUID()), signal)).toMatchObject({
      ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
    })
    expect(acquire).toHaveBeenCalledOnce()
    expect(startedTurns).toEqual([scope.turn_id])
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    releaseGate.resolve()
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

async function prepareCapabilitySnapshot(runtimeRoot: string): Promise<void> {
  const generation = "0".repeat(64)
  const bundle = path.join(runtimeRoot, "capabilities")
  for (const name of ["skills", "plugins", "plugin-sources"]) await mkdir(path.join(bundle, name), { recursive: true })
  await writeFile(path.join(bundle, "capability-snapshot.json"), JSON.stringify({
    version: 1, id: `${generation}-${randomUUID()}`, generation, contentDigest: generation, sourceDigest: generation, pluginNames: [],
  }))
}

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
  const provider = new DesktopWorkerProvider({ dataRoot, runtimeRoot: root, controlToken: "a".repeat(64),
    serverOrigin: origin }, logger)
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
      expect(await provider.pruneWorkspaces(Date.now() + 15 * 86_400_000)).toEqual({
        deleted: 1, freedBytes: Buffer.byteLength("old workspace content"), retainedBytes: 0,
      })
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

it("rejects new starts and recovery reads but keeps Stop available during cleanup maintenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-maintenance-"))
  const origin = "https://server.example.test"
  const provider = new DesktopWorkerProvider({ dataRoot: root, runtimeRoot: root, controlToken: "a".repeat(64), serverOrigin: origin },
    logger)
  const acquire = vi.spyOn(provider, "acquire")
  const turns = new DesktopTurns(provider, root, origin, vi.fn(), logger)
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  const command = { type: "command", ...scope, expires_at: expiresAt }
  const signal = AbortSignal.timeout(5_000)
  try {
    expect(provider.beginMaintenance()).toBe(true)
    const start = desktopExecutionCommandSchema.parse({
      ...command, id: randomUUID(), operation: "turn.start",
      body: {
        native_thread_id: null, input: "Fixture", reasoning_effort: "low",
        credentials: {
          turn_id: scope.turn_id, expires_at: expiresAt, run_token: `lsdr_${"a".repeat(43)}`,
          primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
        },
      },
    })
    expect(await turns.execute(start, signal)).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
    const inspect = desktopExecutionCommandSchema.parse({ ...command, id: randomUUID(), operation: "turn.inspect" })
    expect(await turns.execute(inspect, signal)).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
    expect(acquire).not.toHaveBeenCalled()
    // Stop is not workspace admission: it receives its receipt immediately and
    // never waits for the cleanup. Sealing an unstarted turn needs the same
    // filesystem preparation that exclusivity excludes, so this attempt is
    // reported as uncertain for an idempotent retry, not silently dropped.
    const stop = desktopExecutionCommandSchema.parse({ ...command, id: randomUUID(), operation: "turn.interrupt" })
    expect(await turns.execute(stop, signal)).toMatchObject({
      ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
    })
    provider.endMaintenance()
    expect(await turns.execute(stop, signal)).toMatchObject({
      ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" },
    })
    expect(acquire).not.toHaveBeenCalled()
  } finally {
    provider.endMaintenance()
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

it("admits Stop when ordinary attachment-capable commands fill their slots", async () => {
  const owner = randomUUID()
  const provider = new DesktopWorkerProvider({
    dataRoot: tmpdir(), runtimeRoot: tmpdir(), controlToken: randomBytes(32).toString("hex"),
  }, logger)
  const turns = new DesktopTurns(provider, tmpdir(), "https://server.example.test", vi.fn(), logger)
  const finish = deferred<void>()
  const execute = vi.spyOn(turns, "execute").mockImplementation(async command => {
    await finish.promise
    return { type: "command.result", id: command.id, operation: command.operation, ok: false, error_code: "RUNNER_UNAVAILABLE" }
  })
  const write = vi.fn(async () => {})
  const link = new DesktopLink(randomUUID(), owner, turns, write, vi.fn(), [], true)
  const inspect = desktopExecutionCommandSchema.parse({
    type: "command", id: randomUUID(), owner_id: owner, conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(), operation: "turn.inspect",
    expires_at: new Date(Date.now() + 10_000).toISOString(),
  })
  try {
    for (let index = 0; index < 7; index++) link.receive({ ...inspect, id: randomUUID() })
    link.receive(inspect)
    expect(execute).toHaveBeenCalledTimes(7)
    const stop = { ...inspect, id: randomUUID(), operation: "turn.interrupt" } as const
    link.receive(stop)
    expect(execute).toHaveBeenCalledWith(stop, expect.any(AbortSignal), expect.any(Object))
    link.receive({ ...stop, id: randomUUID() })
    expect(execute).toHaveBeenCalledTimes(8)
  } finally {
    finish.resolve()
    await link.close()
    await provider.shutdown()
  }
})

it("fails a structured quote closed unless this exact link negotiated it", async () => {
  const owner = randomUUID()
  const provider = new DesktopWorkerProvider({
    dataRoot: tmpdir(), runtimeRoot: tmpdir(), controlToken: randomBytes(32).toString("hex"),
  }, logger)
  const turns = new DesktopTurns(provider, tmpdir(), "https://server.example.test", vi.fn(), logger)
  const execute = vi.spyOn(turns, "execute")
  const write = vi.fn<(output: unknown) => Promise<void>>(async () => {})
  const command = quoteCommand(owner)
  const legacy = new DesktopLink(randomUUID(), owner, turns, write, vi.fn(), [], true, false)
  const negotiated = new DesktopLink(randomUUID(), owner, turns, write, vi.fn(), [], true, true)
  try {
    legacy.receive(command)
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(execute).not.toHaveBeenCalled()
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      frame: { type: "command.result", operation: "turn.start", ok: false, error_code: "RUNNER_UNAVAILABLE" },
    })
    negotiated.receive(command)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    execute.mockClear()
    const chat = desktopExecutionCommandSchema.parse({
      ...command, id: randomUUID(),
      body: { ...command.body, credentials: {
        ...command.body.credentials,
        primary: { ...command.body.credentials.primary, protocol_mode: "chat_completions_bridge" },
      } },
    })
    negotiated.receive(chat)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(execute).not.toHaveBeenCalled()
  } finally {
    await legacy.close()
    await negotiated.close()
    await provider.shutdown()
  }
})

it("rejects model switches from a legacy API before a worker starts and keeps ordinary inspection compatible", async () => {
  const owner = randomUUID()
  const provider = new DesktopWorkerProvider({
    dataRoot: tmpdir(), runtimeRoot: tmpdir(), controlToken: randomBytes(32).toString("hex"),
  }, logger)
  const turns = new DesktopTurns(provider, tmpdir(), "https://server.example.test", vi.fn(), logger)
  const { body, ...scope } = quoteCommand(owner)
  const source = randomUUID()
  const timestamp = new Date().toISOString()
  const result = { codexThreadId: randomUUID(), codexTurnId: randomUUID() }
  const execute = vi.spyOn(turns, "execute").mockImplementation(async command => {
    if (command.operation !== "turn.start" && command.operation !== "turn.inspect") throw new Error("unexpected command")
    return { type: "command.result", id: command.id, operation: command.operation, ok: true, result: {
      conversationId: scope.conversation_id, projectionTurnId: scope.turn_id, status: "succeeded",
      createdAt: timestamp, updatedAt: timestamp,
      result: command.operation === "turn.inspect" && command.body ? { ...result, forkedFromId: source } : result,
    } }
  })
  const write = vi.fn<(output: unknown) => Promise<void>>(async () => {})
  const legacy = new DesktopLink(randomUUID(), owner, turns, write, vi.fn())
  const upgraded = new DesktopLink(randomUUID(), owner, turns, write, vi.fn(), [desktopModelSwitchOperation])
  const start = desktopExecutionCommandSchema.parse({
    ...scope, body: { ...body, native_thread_id: source, conversation_reference_context: undefined, credentials: {
      ...body.credentials, transition_source: { ...body.credentials.primary, model: "previous", purpose: "transition_source" },
    } },
  })
  try {
    legacy.receive(start)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(execute).not.toHaveBeenCalled()
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      frame: { operation: "turn.start", ok: false, error_code: "RUNNER_UNAVAILABLE" },
    })
    upgraded.receive(start)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[1]?.[0]).toMatchObject({ frame: { result: { result } } })
    const inspect = { ...scope, id: randomUUID(), operation: "turn.inspect" } as const
    const inspectTransition = { ...inspect, body: { transition_source_thread_id: source } }
    legacy.receive(inspectTransition)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[2]?.[0]).toMatchObject({
      frame: { operation: "turn.inspect", ok: false, error_code: "RUNNER_UNAVAILABLE" },
    })
    upgraded.receive(inspectTransition)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(4))
    expect(write.mock.calls[3]?.[0]).toMatchObject({ frame: { result: { result: { ...result, forkedFromId: source } } } })
    legacy.receive({ ...inspect, id: randomUUID() })
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(5))
    expect(write.mock.calls[4]?.[0]).toMatchObject({
      frame: { result: { result: { codexThreadId: result.codexThreadId, codexTurnId: result.codexTurnId } } },
    })
    expect(write.mock.calls[4]?.[0]).not.toHaveProperty("frame.result.result.forkedFromId")
  } finally {
    await legacy.close()
    await upgraded.close()
    await provider.shutdown()
  }
})

it("serializes the bounded quote into the existing untrusted office additional context", () => {
  const provider = new DesktopWorkerProvider({
    dataRoot: tmpdir(), runtimeRoot: tmpdir(), controlToken: randomBytes(32).toString("hex"),
  }, logger)
  const turns = new DesktopTurns(provider, tmpdir(), "https://server.example.test", vi.fn(), logger)
  const command = quoteCommand(randomUUID())
  const startBody = (turns as unknown as {
    startBody: (input: Extract<DesktopExecutionCommand, { operation: "turn.start" }>, capabilityGeneration: string) => {
      context: { userInput: string; officeSelectionContext?: string }
    }
  }).startBody(command, "0".repeat(64))
  expect(startBody.context.userInput).toBe("Explain this claim")
  expect(startBody.context.officeSelectionContext).toContain('"selection_text":"quoted 😀 claim"')
  expect(startBody.context.officeSelectionContext).not.toContain("[LinkSense office annotation]")
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

it("never treats the fixture computer.execute command as a turn interrupt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-computer-command-"))
  const provider = new DesktopWorkerProvider({ dataRoot: root, runtimeRoot: root, controlToken: "a".repeat(64) }, logger)
  const acquire = vi.spyOn(provider, "acquire")
  const request = vi.spyOn(provider, "request")
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, root, "https://server.example.test", workerLost, logger)
  const scope = {
    owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID(),
  }
  const command = desktopExecutionCommandSchema.parse({
    ...scope, type: "command", id: randomUUID(), operation: "computer.execute",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    body: {
      session_id: randomUUID(), selection_id: randomUUID(), holder_id: null,
      request: { kind: "status" },
    },
  })
  try {
    await expect(turns.execute(command, AbortSignal.timeout(2_000))).resolves.toEqual({
      type: "command.result", id: command.id, operation: "computer.execute",
      ok: false, error_code: "RUNNER_UNAVAILABLE",
    })
    expect(acquire).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(workerLost).not.toHaveBeenCalled()
  } finally {
    await turns.shutdown()
    await provider.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

function quoteCommand(owner: string): Extract<DesktopExecutionCommand, { operation: "turn.start" }> {
  const expires_at = new Date(Date.now() + 10_000).toISOString()
  const turn_id = randomUUID()
  return desktopExecutionCommandSchema.parse({
    type: "command", id: randomUUID(), operation: "turn.start", owner_id: owner,
    conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id, expires_at,
    body: {
      native_thread_id: null, input: "Explain this claim", reasoning_effort: "low",
      conversation_reference_context: {
        selection_text: "quoted 😀 claim",
        recent_messages: [{ role: "assistant", text: "recent context" }],
      },
      credentials: {
        turn_id, expires_at, run_token: `lsdr_${"a".repeat(43)}`,
        primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
      },
    },
  }) as Extract<DesktopExecutionCommand, { operation: "turn.start" }>
}
