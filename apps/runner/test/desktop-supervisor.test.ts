import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import pino from "pino"
import { expect, it, vi } from "vitest"

import { DesktopWorkerProvider } from "../src/controller/desktop-worker-provider.js"
import { DesktopSupervisor } from "../src/desktop/supervisor.js"
import { deferred } from "./deferred.js"

const origin = "https://server.example.test"
const logger = pino({ enabled: false })

function pipeInput() {
  const values: unknown[] = []
  let wake: (() => void) | undefined
  let done = false
  return {
    push(value: unknown) {
      values.push(value)
      wake?.()
      wake = undefined
    },
    end() {
      done = true
      wake?.()
      wake = undefined
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const value = values.shift()
        if (value !== undefined) {
          yield value
          continue
        }
        if (done) return
        await new Promise<void>(resolve => { wake = resolve })
      }
    },
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-supervisor-"))
  const provider = new DesktopWorkerProvider({
    dataRoot: path.join(root, "data"), runtimeRoot: root, controlToken: "a".repeat(64),
    serverOrigin: origin,
  }, logger)
  const writes: unknown[] = []
  const fail = vi.fn()
  const supervisor = new DesktopSupervisor({
    provider, runtimeRoot: root, origin, logger, fail,
    write: async value => { writes.push(value) },
  })
  return {
    provider, supervisor, writes, fail,
    close: async () => { await provider.shutdown(); await rm(root, { recursive: true, force: true }) },
  }
}

function linkOpen(ownerId: string, linkId = randomUUID()) {
  return { type: "link.open", link_id: linkId, owner_id: ownerId }
}

function inspectCommand(ownerId: string) {
  return {
    type: "command", id: randomUUID(), owner_id: ownerId, conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(), operation: "turn.inspect",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  }
}

function startCommand(ownerId: string, conversationId = randomUUID()) {
  const turnId = randomUUID()
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  return {
    type: "command", id: randomUUID(), owner_id: ownerId, conversation_id: conversationId,
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
  }
}

function messagesOfType(writes: unknown[], type: string) {
  return writes.filter(value =>
    typeof value === "object" && value !== null && Reflect.get(value, "type") === type)
}

function commandResults(writes: unknown[]) {
  return messagesOfType(writes, "link.frame").flatMap(value => {
    const frame = Reflect.get(value as object, "frame")
    return typeof frame === "object" && frame !== null && Reflect.get(frame, "type") === "command.result"
      ? [frame] : []
  })
}

it("does not delay a command response or link close behind a slow usage scan", async () => {
  const { provider, supervisor, writes, close } = await fixture()
  const scan = deferred<void>()
  let usageSettled = false
  const usage = vi.spyOn(provider, "workspaceUsage").mockImplementation(async () => {
    await scan.promise
    usageSettled = true
    return { bytes: 0, files: 0, sessions: 0 }
  })
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  const linkId = randomUUID()
  input.push({ type: "workspace.usage", request_id: randomUUID(), owner_id: owner })
  input.push(linkOpen(owner, linkId))
  input.push({ type: "link.frame", link_id: linkId, frame: inspectCommand(owner) })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(1))
  expect(commandResults(writes)[0]).toMatchObject({ ok: true, result: null })
  expect(messagesOfType(writes, "workspace.usage.result")).toHaveLength(0)
  input.push({ type: "link.close", link_id: linkId })
  input.end()
  await running
  expect(usage).toHaveBeenCalledOnce()
  expect(usageSettled).toBe(false)
  scan.resolve()
  await close()
})

it("rejects starts and recoveries while cleanup holds exclusivity, including after link close", async () => {
  const { provider, supervisor, writes, fail, close } = await fixture()
  const cleanup = deferred<{ deleted: number; freedBytes: number; retainedBytes: number }>()
  const prune = vi.spyOn(provider, "pruneWorkspaces").mockImplementation(() => cleanup.promise)
  const acquire = vi.spyOn(provider, "acquire")
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  input.push({ type: "workspace.cleanup", request_id: randomUUID(), owner_id: owner })
  const firstLink = randomUUID()
  input.push(linkOpen(owner, firstLink))
  input.push({ type: "link.frame", link_id: firstLink, frame: startCommand(owner) })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(1))
  expect(commandResults(writes)[0]).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })

  input.push({ type: "link.close", link_id: firstLink })
  const secondLink = randomUUID()
  input.push(linkOpen(owner, secondLink))
  input.push({ type: "link.frame", link_id: secondLink, frame: startCommand(owner) })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(2))
  expect(commandResults(writes)[1]).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
  expect(acquire).not.toHaveBeenCalled()

  cleanup.resolve({ deleted: 1, freedBytes: 512, retainedBytes: 0 })
  await vi.waitFor(() => expect(writes).toContainEqual(expect.objectContaining({
    type: "workspace.cleanup.result", ok: true,
    cleanup: { status: "completed", deleted_sessions: 1, freed_bytes: 512, retained_bytes: 0 },
  })))
  input.end()
  await running
  expect(prune).toHaveBeenCalledWith(expect.any(Number), {
    ownerId: owner, signal: expect.any(AbortSignal),
  })
  expect(fail).not.toHaveBeenCalled()
  await close()
})

it("cancels only the active cleanup and keeps exclusivity until it settles", async () => {
  const { provider, supervisor, writes, fail, close } = await fixture()
  const cleanup = deferred<{ deleted: number; freedBytes: number; retainedBytes: number }>()
  let signal: AbortSignal | undefined
  const prune = vi.spyOn(provider, "pruneWorkspaces").mockImplementation((_now, options) => {
    signal = options?.signal
    return cleanup.promise
  })
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  const requestId = randomUUID()
  input.push({ type: "workspace.cleanup", request_id: requestId, owner_id: owner })
  await vi.waitFor(() => expect(prune).toHaveBeenCalledOnce())
  expect(provider.isMaintenanceActive()).toBe(true)

  // An unknown or stale id must not stop the cleanup that holds exclusivity.
  input.push({ type: "workspace.cancel", request_id: randomUUID() })
  expect(signal?.aborted).toBe(false)
  input.push({ type: "workspace.cancel", request_id: requestId })
  await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  // The scan may still be unwinding, but admission stays closed.
  expect(provider.beginMaintenance()).toBe(false)

  cleanup.resolve({ deleted: 0, freedBytes: 0, retainedBytes: 0 })
  await vi.waitFor(() => expect(writes).toContainEqual(expect.objectContaining({
    type: "workspace.cleanup.result", ok: true,
    cleanup: expect.objectContaining({ status: "completed" }),
  })))
  expect(provider.isMaintenanceActive()).toBe(false)
  expect(provider.beginMaintenance()).toBe(true)
  provider.endMaintenance()

  // A late cancel after the result is ignored and does not fail the supervisor.
  input.push({ type: "workspace.cancel", request_id: requestId })
  input.end()
  await running
  expect(fail).not.toHaveBeenCalled()
  await close()
})

it("bounds concurrent usage requests without delaying link frames", async () => {
  const { provider, supervisor, writes, close } = await fixture()
  const scan = deferred<void>()
  vi.spyOn(provider, "workspaceUsage").mockImplementation(async () => {
    await scan.promise
    return { bytes: 0, files: 0, sessions: 0 }
  })
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  for (let index = 0; index < 3; index++) {
    input.push({ type: "workspace.usage", request_id: randomUUID(), owner_id: owner })
  }
  const linkId = randomUUID()
  input.push(linkOpen(owner, linkId))
  input.push({ type: "link.frame", link_id: linkId, frame: inspectCommand(owner) })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(1))
  await vi.waitFor(() => expect(writes).toContainEqual(expect.objectContaining({
    type: "workspace.usage.result", ok: false, error_code: "DESKTOP_WORKSPACE_UNAVAILABLE",
  })))
  input.end()
  scan.resolve()
  await running
  await close()
})

it("lets a start already in asynchronous preparation win over update admission", async () => {
  const { provider, supervisor, writes, fail, close } = await fixture()
  const entered = deferred<void>()
  const preparation = deferred<void>()
  vi.spyOn(provider, "prepareOwnerFilesystem").mockImplementation(async () => {
    entered.resolve()
    await preparation.promise
    throw new Error("fixture preparation stopped")
  })
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  const linkId = randomUUID()
  input.push(linkOpen(owner, linkId))
  input.push({ type: "link.frame", link_id: linkId, frame: startCommand(owner) })
  // The session is reserved before preparation reaches this await, so update
  // admission must lose without waiting for the disk work to finish.
  await entered.promise
  input.push({ type: "update.acquire", request_id: randomUUID() })
  await vi.waitFor(() => expect(messagesOfType(writes, "update.acquire.result")).toHaveLength(1))
  expect(messagesOfType(writes, "update.acquire.result")[0]).toMatchObject({
    ok: false, error_code: "DESKTOP_UPDATE_BUSY",
  })
  expect(provider.isMaintenanceActive()).toBe(false)
  preparation.resolve()
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(1))
  input.end()
  await running
  expect(fail).not.toHaveBeenCalled()
  await close()
})

it("holds update admission across link replacement and blocks starts, recovery and cleanup", async () => {
  const { provider, supervisor, writes, fail, close } = await fixture()
  const acquire = vi.spyOn(provider, "acquire")
  const prune = vi.spyOn(provider, "pruneWorkspaces")
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  const requestId = randomUUID()
  input.push({ type: "update.acquire", request_id: requestId })
  await vi.waitFor(() => expect(messagesOfType(writes, "update.acquire.result")).toHaveLength(1))
  expect(messagesOfType(writes, "update.acquire.result")[0]).toEqual({
    type: "update.acquire.result", request_id: requestId, ok: true,
  })
  expect(provider.isMaintenanceActive()).toBe(true)

  const firstLink = randomUUID()
  input.push(linkOpen(owner, firstLink))
  input.push({ type: "link.frame", link_id: firstLink, frame: startCommand(owner) })
  input.push({ type: "link.frame", link_id: firstLink, frame: inspectCommand(owner) })
  input.push({ type: "link.frame", link_id: firstLink, frame: {
    type: "command", id: randomUUID(), owner_id: owner, conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(), operation: "turn.drain",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  } })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(3))
  for (const result of commandResults(writes)) {
    expect(result).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
  }
  expect(acquire).not.toHaveBeenCalled()

  // Workspace cleanup shares the same maintenance gate; it must report busy
  // and leave the update hold intact.
  input.push({ type: "workspace.cleanup", request_id: randomUUID(), owner_id: owner })
  await vi.waitFor(() => expect(writes).toContainEqual(expect.objectContaining({
    type: "workspace.cleanup.result", ok: true, cleanup: expect.objectContaining({ status: "busy" }),
  })))
  expect(prune).not.toHaveBeenCalled()
  expect(provider.isMaintenanceActive()).toBe(true)
  expect(provider.beginMaintenance()).toBe(false)

  // A device reconnect replaces the link, never the admission hold.
  input.push({ type: "link.close", link_id: firstLink })
  const secondLink = randomUUID()
  input.push(linkOpen(owner, secondLink))
  input.push({ type: "link.frame", link_id: secondLink, frame: startCommand(owner) })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(4))
  expect(commandResults(writes)[3]).toMatchObject({ ok: false, error_code: "RUNNER_UNAVAILABLE" })
  expect(acquire).not.toHaveBeenCalled()

  // A second acquire and a stale release cannot change the holder.
  input.push({ type: "update.acquire", request_id: randomUUID() })
  input.push({ type: "update.release", request_id: randomUUID() })
  input.push({ type: "update.acquire", request_id: randomUUID() })
  await vi.waitFor(() => expect(messagesOfType(writes, "update.acquire.result")).toHaveLength(3))
  expect(messagesOfType(writes, "update.acquire.result").slice(1)).toEqual([
    expect.objectContaining({ ok: false, error_code: "DESKTOP_UPDATE_BUSY" }),
    expect.objectContaining({ ok: false, error_code: "DESKTOP_UPDATE_BUSY" }),
  ])
  expect(provider.isMaintenanceActive()).toBe(true)

  input.push({ type: "update.release", request_id: requestId })
  await vi.waitFor(() => expect(provider.isMaintenanceActive()).toBe(false))
  // Releasing twice is harmless and does not fail the supervisor.
  input.push({ type: "update.release", request_id: requestId })
  const nextRequest = randomUUID()
  input.push({ type: "update.acquire", request_id: nextRequest })
  await vi.waitFor(() => expect(messagesOfType(writes, "update.acquire.result")).toHaveLength(4))
  expect(messagesOfType(writes, "update.acquire.result")[3]).toEqual({
    type: "update.acquire.result", request_id: nextRequest, ok: true,
  })
  input.push({ type: "update.release", request_id: nextRequest })
  await vi.waitFor(() => expect(provider.isMaintenanceActive()).toBe(false))

  // The same gate admits the existing workspace cleanup once update releases.
  const cleanupRequest = randomUUID()
  input.push({ type: "workspace.cleanup", request_id: cleanupRequest, owner_id: owner })
  await vi.waitFor(() => expect(writes).toContainEqual(expect.objectContaining({
    type: "workspace.cleanup.result", request_id: cleanupRequest, ok: true,
    cleanup: expect.objectContaining({ status: "completed" }),
  })))
  expect(prune).toHaveBeenCalledOnce()
  expect(provider.isMaintenanceActive()).toBe(false)

  input.end()
  await running
  expect(fail).not.toHaveBeenCalled()
  await close()
})

it("keeps Stop available while update admission is held and preserves its retry outcome", async () => {
  const { provider, supervisor, writes, fail, close } = await fixture()
  const input = pipeInput()
  const running = supervisor.run(input)
  const owner = randomUUID()
  const conversationId = randomUUID()
  const requestId = randomUUID()
  input.push({ type: "update.acquire", request_id: requestId })
  await vi.waitFor(() => expect(messagesOfType(writes, "update.acquire.result")).toHaveLength(1))
  const linkId = randomUUID()
  input.push(linkOpen(owner, linkId))
  const stop = {
    type: "command", id: randomUUID(), owner_id: owner, conversation_id: conversationId,
    runtime_generation: randomUUID(), turn_id: randomUUID(), operation: "turn.interrupt",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  }
  input.push({ type: "link.frame", link_id: linkId, frame: stop })
  // Stop is not workspace admission. Sealing an unstarted turn needs the
  // preparation that exclusivity excludes, so the first attempt is uncertain
  // for an idempotent retry; the update hold must remain untouched.
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(1))
  expect(commandResults(writes)[0]).toMatchObject({ operation: "turn.interrupt", ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" })
  expect(provider.isMaintenanceActive()).toBe(true)

  input.push({ type: "update.release", request_id: requestId })
  await vi.waitFor(() => expect(provider.isMaintenanceActive()).toBe(false))
  input.push({ type: "link.frame", link_id: linkId, frame: { ...stop, id: randomUUID() } })
  await vi.waitFor(() => expect(commandResults(writes)).toHaveLength(2))
  expect(commandResults(writes)[1]).toMatchObject({
    operation: "turn.interrupt", ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" },
  })

  input.end()
  await running
  expect(fail).not.toHaveBeenCalled()
  await close()
})
