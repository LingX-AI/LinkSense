import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  desktopExecutionAckSchema,
  type ComputerExecuteInput,
  type DesktopNegotiatedOperation,
  type DesktopToolRequest,
} from "@linksense/shared"
import pino from "pino"
import { afterEach, expect, it, vi } from "vitest"

import { desktopWorkerSecret } from "../src/controller/desktop-worker-provider.js"
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js"
import { HttpRunnerEventSink } from "../src/event-sink.js"
import { DesktopLink } from "../src/desktop/link.js"
import { DesktopTurns, type DesktopRuntimeRun } from "../src/desktop/turns.js"
import { desktopWorkerCallbacks } from "../src/desktop/worker-callbacks.js"
import { WorkspaceManager } from "../src/workspace/workspace-manager.js"

const logger = pino({ enabled: false })
const localSecret = "b".repeat(64)
const roots: string[] = []
const status = { available: true, permissions: { accessibility: "granted" as const }, active_grant: true }
const observation = {
  observation_id: "obs-1", tree_quality: "good" as const, truncated: false,
  nodes: [{ ref: "e1", role: "button", name: "Continue" }],
}

type ComputerToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function createProvider(root: string): ConstructorParameters<typeof DesktopTurns>[0] {
  return {
    pathsFor(ownerId: string, conversationId: string): WorkerOwnerPaths {
      const owner = path.join(root, ownerId, "services", conversationId)
      const home = path.join(owner, "home")
      const managed = path.join(owner, "managed")
      const managedAgents = path.join(managed, "agents")
      return {
        root, owner, home, homeAgentsMountpoint: path.join(home, ".agents"), managed, managedAgents,
        managedSkills: path.join(managedAgents, "skills"),
        managedPluginSources: path.join(managedAgents, "plugin-sources"),
        managedPlugins: path.join(managedAgents, "plugins"),
        control: path.join(owner, "control"),
        workspaces: path.join(home, "projects"),
      }
    },
    prepareOwnerFilesystem: async () => {},
    assertSessionOrigin: async () => {},
    isMaintenanceActive: () => false,
    acquire: async () => { throw new Error("computer fixture must not acquire a worker") },
    inspect: async () => "running" as const,
    request: async () => { throw new Error("computer fixture must not reach a worker") },
    release: async () => {},
    stopWorkers: async () => {},
  }
}

function defaultResponse(frame: ComputerToolRequest): unknown {
  if (frame.body.kind === "status") return { kind: "status", result: status }
  if (frame.body.kind === "observe") return { kind: "observe", result: observation }
  if (frame.body.kind === "wait") {
    return { kind: "wait", result: { result: "met", waited_ms: 3 } }
  }
  return { kind: "act", result: { ok: true, effect: "done", waited_ms: 5 } }
}

async function fixture(
  operations: readonly DesktopNegotiatedOperation[] = ["computer.execute"],
  respond: (frame: ComputerToolRequest) => unknown | undefined = defaultResponse,
) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-computer-callback-"))
  roots.push(root)
  const provider = createProvider(root)
  const turns = new DesktopTurns(provider, root, "https://server.example.test", vi.fn(), logger, operations)
  const scope = {
    owner_id: randomUUID(), conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(),
  }
  const timer = setTimeout(() => {}, 60_000)
  timer.unref()
  const run: DesktopRuntimeRun = {
    scope, token: `lsdr_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000, timer,
  }
  let activeRun: DesktopRuntimeRun | undefined = run
  vi.spyOn(turns, "scopedRun").mockImplementation(() => activeRun)
  const requests: ComputerToolRequest[] = []
  const cancels: unknown[] = []
  const fail = vi.fn()
  const link: DesktopLink = new DesktopLink(
    randomUUID(), scope.owner_id, turns,
    async output => {
      const frame = output.frame
      if (frame.type === "tool.cancel") {
        cancels.push(frame)
        return
      }
      if (frame.type !== "tool.request" || frame.operation !== "computer.execute") return
      requests.push(frame)
      const data = respond(frame)
      if (data === undefined) return
      link.receive(desktopExecutionAckSchema.parse({
        type: "tool.result", id: frame.id, operation: "computer.execute", ok: true, data,
      }))
    },
    fail, operations,
  )
  const workspaceManager = new WorkspaceManager(root, undefined, { fixedOwnerId: scope.owner_id })
  const callbacks = desktopWorkerCallbacks(localSecret, () => ({ link, turns }), "https://server.example.test")
  const origin = new URL(await callbacks.listen({ host: "127.0.0.1", port: 0 })).origin
  const authorization = `Bearer ${desktopWorkerSecret(scope.owner_id, localSecret, scope.conversation_id, {
    turnId: scope.turn_id, runtimeGeneration: scope.runtime_generation,
  })}`
  const httpCalls = vi.fn<typeof fetch>((input, init) => fetch(input, init))
  const sink = new HttpRunnerEventSink(origin, authorization.slice("Bearer ".length), workspaceManager, {
    serviceSessionId: scope.conversation_id,
    desktopOutboxScope: { turnId: scope.turn_id, generation: scope.runtime_generation },
    fetch: httpCalls,
  })
  return {
    scope, run, requests, cancels, fail, origin, authorization, sink, httpCalls,
    setRun: (value: DesktopRuntimeRun | undefined) => { activeRun = value },
    async post(body: unknown, headers: Record<string, string> = {}) {
      return fetch(`${origin}/internal/computer-use/execute`, {
        method: "POST",
        headers: {
          authorization, "x-linksense-owner-id": scope.owner_id,
          "x-linksense-service-session": scope.conversation_id, "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      })
    },
    close: async () => {
      clearTimeout(timer)
      await sink.close()
      await callbacks.close()
      await link.close()
    },
  }
}

function actInput(): ComputerExecuteInput {
  return {
    kind: "act", native_call_id: "call-1",
    input: { action: "click", observation_id: "obs-1", ref: "e1", timeout_ms: 8_000 },
  }
}

it("relays an approved act from the real event sink through the worker-secret callback into DesktopLink once", async () => {
  const state = await fixture()
  try {
    const input = actInput()
    const result = await state.sink.computerExecute({
      conversationId: state.scope.conversation_id,
      turnId: state.scope.turn_id,
      input,
    })
    expect(result).toEqual({ kind: "act", result: { ok: true, effect: "done", waited_ms: 5 } })

    // Exactly the closed request crossed the supervisor callback, and the link
    // received exactly the act body the upstream pool had already approved.
    expect(state.httpCalls).toHaveBeenCalledOnce()
    expect(new URL(String(state.httpCalls.mock.calls[0]?.[0])).pathname)
      .toBe("/internal/computer-use/execute")
    const posted = JSON.parse(String(state.httpCalls.mock.calls[0]?.[1]?.body))
    expect(posted).toEqual({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input,
    })
    expect(posted).not.toHaveProperty("nativeCallId")
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toMatchObject({
      type: "tool.request", operation: "computer.execute",
      conversation_id: state.scope.conversation_id, turn_id: state.scope.turn_id,
      runtime_generation: state.scope.runtime_generation,
      body: input,
    })
    expect(state.requests[0]?.body).not.toHaveProperty("nativeCallId")
    expect(state.fail).not.toHaveBeenCalled()
  } finally {
    await state.close()
  }
})

it("binds the callback to the current supervisor run and never dispatches for a foreign scope", async () => {
  const state = await fixture()
  try {
    // No live run: the worker-scoped token cannot be used at all.
    state.setRun(undefined)
    await expect(state.sink.computerExecute({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input: actInput(),
    })).resolves.toEqual({ kind: "failure", error: "RUNNER_OPERATION_UNCERTAIN" })
    expect(state.requests).toHaveLength(0)

    const staleTimer = setTimeout(() => {}, 1_000)
    staleTimer.unref()
    state.setRun({
      scope: { ...state.scope, turn_id: randomUUID() },
      token: `lsdr_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000, timer: staleTimer,
    })
    await expect(state.sink.computerExecute({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input: actInput(),
    })).resolves.toEqual({ kind: "failure", error: "RUNNER_OPERATION_UNCERTAIN" })
    expect(state.requests).toHaveLength(0)

    // Restore the live run so the remaining checks exercise body scope only.
    state.setRun(state.run)
    const body = {
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input: actInput(),
    }
    expect((await state.post({ ...body, conversationId: randomUUID() })).status).toBe(403)
    expect((await state.post({ ...body, turnId: randomUUID() })).status).toBe(403)
    // The callback has no duplicate native-call wrapper field.
    expect((await state.post({ ...body, nativeCallId: "call-1" })).status).toBe(400)
    expect((await state.post(body, { authorization: `Bearer ${localSecret}` })).status).toBe(503)
    expect(state.requests).toHaveLength(0)
    clearTimeout(staleTimer)
  } finally {
    await state.close()
  }
})

it("refuses an act when computer.execute was not negotiated", async () => {
  const state = await fixture([])
  try {
    await expect(state.sink.computerExecute({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input: actInput(),
    })).resolves.toEqual({ kind: "failure", error: "COMPUTER_UNAVAILABLE" })
    expect(state.requests).toHaveLength(0)
    expect(state.httpCalls).toHaveBeenCalledOnce()
  } finally {
    await state.close()
  }
})

it("admits the wait kind only through the additive link marker", async () => {
  const input: ComputerExecuteInput = {
    kind: "wait",
    input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 8_000 },
  }
  const legacy = await fixture(["computer.execute"])
  try {
    await expect(legacy.sink.computerExecute({
      conversationId: legacy.scope.conversation_id, turnId: legacy.scope.turn_id, input,
    })).resolves.toEqual({ kind: "failure", error: "COMPUTER_UNAVAILABLE" })
    expect(legacy.requests).toHaveLength(0)
  } finally {
    await legacy.close()
  }
  const negotiated = await fixture(["computer.execute", "computer.wait"])
  try {
    await expect(negotiated.sink.computerExecute({
      conversationId: negotiated.scope.conversation_id, turnId: negotiated.scope.turn_id, input,
    })).resolves.toEqual({ kind: "wait", result: { result: "met", waited_ms: 3 } })
    expect(negotiated.requests).toHaveLength(1)
    expect(negotiated.requests[0]?.body).toEqual(input)
    expect(negotiated.requests[0]?.body).not.toHaveProperty("native_call_id")
    expect(negotiated.cancels).toHaveLength(0)
  } finally {
    await negotiated.close()
  }
})

it("reports a delivered act as uncertain on abort and never retries it", async () => {
  const state = await fixture(["computer.execute"], () => undefined)
  try {
    const controller = new AbortController()
    const pending = state.sink.computerExecute({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id,
      input: actInput(), signal: controller.signal,
    })
    await vi.waitFor(() => expect(state.requests).toHaveLength(1))
    controller.abort()
    await expect(pending).resolves.toEqual({ kind: "failure", error: "RUNNER_OPERATION_UNCERTAIN" })
    await vi.waitFor(() => expect(state.cancels).toHaveLength(1))
    expect(state.cancels[0]).toMatchObject({ type: "tool.cancel", operation: "computer.execute" })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(state.httpCalls).toHaveBeenCalledOnce()
    expect(state.requests).toHaveLength(1)
  } finally {
    await state.close()
  }
})

it("keeps direct status reads inside the run binding", async () => {
  const state = await fixture()
  try {
    const input: ComputerExecuteInput = { kind: "status" }
    const response = await state.post({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input,
    })
    await expect(response.json()).resolves.toMatchObject({ kind: "status" })
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]?.body).toEqual({ kind: "status" })
    expect(state.fail).not.toHaveBeenCalled()
  } finally {
    await state.close()
  }
})
