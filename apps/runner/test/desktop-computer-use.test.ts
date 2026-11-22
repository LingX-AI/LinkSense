import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import pino from "pino"
import { expect, it, vi } from "vitest"
import {
  desktopToolRequestSchema, desktopToolResultSchema,
  type DesktopToolRequest, type DesktopToolResult,
} from "@linksense/shared"

import { DesktopWorkerProvider } from "../src/controller/desktop-worker-provider.js"
import { desktopComputerUseExecutor } from "./functional/fixtures/desktop-computer-use-executor.js"
import { DesktopLink } from "../src/desktop/link.js"
import { DesktopTurns, type DesktopRuntimeRun } from "../src/desktop/turns.js"
import { ComputerUseFailureError } from "../src/mcp/core-services/computer-use-service.js"

const logger = pino({ enabled: false })
type ComputerToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>
const status = {
  available: true,
  permissions: { accessibility: "granted" as const },
  active_grant: true,
  agent_desktop_version: "fixture-1.0",
}
const observation = {
  observation_id: "obs-1",
  tree_quality: "good" as const,
  truncated: false,
  nodes: [{ ref: "e1", role: "button", name: "Continue" }],
}

async function fixture(respond: (request: ComputerToolRequest) => DesktopToolResult | undefined) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-computer-"))
  const fail = vi.fn()
  const provider = new DesktopWorkerProvider({
    dataRoot: path.join(root, "sessions"), runtimeRoot: root, controlToken: "a".repeat(64),
  }, logger)
  const turns = new DesktopTurns(provider, root, "https://server.example.test", fail, logger)
  const scope = {
    owner_id: randomUUID(), conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(),
  }
  const requests: ComputerToolRequest[] = []
  const cancels: unknown[] = []
  const link: DesktopLink = new DesktopLink(randomUUID(), scope.owner_id, turns, async output => {
    if (output.type !== "link.frame") return
    const frame = output.frame
    if (frame.type === "tool.cancel") { cancels.push(frame); return }
    if (frame.type !== "tool.request" || frame.operation !== "computer.execute") return
    requests.push(frame)
    const result = respond(frame)
    if (!result) return
    link.receive(result)
  }, fail, ["computer.execute"])
  const timer = setTimeout(() => {}, 60_000)
  timer.unref()
  const run: DesktopRuntimeRun = {
    scope, token: `lsdr_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000, timer,
  }
  return {
    link, run, requests, cancels, fail,
    close: async () => {
      clearTimeout(timer)
      await link.close()
      await provider.shutdown()
      await rm(root, { recursive: true, force: true })
    },
  }
}

function toolResult(request: ComputerToolRequest, data: unknown): DesktopToolResult {
  return desktopToolResultSchema.parse({
    type: "tool.result", id: request.id, operation: request.operation, ok: true, data,
  })
}

it("maps status, observe, and act onto the closed desktop tool channel and unwraps typed results", async () => {
  const state = await fixture(request => {
    if (request.body.kind === "status") return toolResult(request, { kind: "status", result: status })
    if (request.body.kind === "observe") return toolResult(request, { kind: "observe", result: observation })
    return toolResult(request, { kind: "act", result: { ok: true, effect: "done", waited_ms: 5 } })
  })
  const executor = desktopComputerUseExecutor(state.link, state.run)
  try {
    await expect(executor.status({ signal: AbortSignal.timeout(5_000) })).resolves.toEqual(status)
    await expect(executor.observe({ signal: AbortSignal.timeout(5_000) })).resolves.toEqual(observation)
    await expect(executor.act({
      nativeCallId: "call-9", observationId: "obs-1", ref: "e1",
      action: "type", text: "你好 👋", timeoutMs: 8_000, signal: AbortSignal.timeout(5_000),
    })).resolves.toEqual({ ok: true, effect: "done", waited_ms: 5 })

    expect(state.requests.map(request => request.operation)).toEqual([
      "computer.execute", "computer.execute", "computer.execute",
    ])
    expect(state.requests[0]).toMatchObject({ body: { kind: "status" } })
    expect(state.requests[1]).toMatchObject({ body: { kind: "observe" } })
    expect(state.requests[2]?.body).toEqual({
      kind: "act", native_call_id: "call-9",
      input: { action: "type", observation_id: "obs-1", ref: "e1", text: "你好 👋", timeout_ms: 8_000 },
    })
    for (const request of state.requests) {
      expect(desktopToolRequestSchema.parse(request)).toMatchObject({ operation: "computer.execute" })
      expect(JSON.stringify(request.body)).not.toMatch(/bundle_id|selection_id|holder_id|session_id|window_id|pid/u)
    }
    expect(state.fail).not.toHaveBeenCalled()
  } finally {
    await state.close()
  }
})

it("preserves stable failures and never retries after cancellation or a late result", async () => {
  let mode: "busy" | "changed" | "forbidden" | "pending" = "busy"
  const state = await fixture(request => {
    if (mode === "pending") return undefined
    if (mode === "forbidden") {
      return desktopToolResultSchema.parse({
        type: "tool.result", id: request.id, operation: request.operation, ok: false, error_code: "FORBIDDEN",
      })
    }
    return toolResult(request, {
      kind: "failure", error: mode === "busy" ? "DEVICE_BUSY" : "COMPUTER_TARGET_CHANGED",
    })
  })
  const executor = desktopComputerUseExecutor(state.link, state.run)
  try {
    await expect(executor.status({ signal: AbortSignal.timeout(5_000) }))
      .rejects.toMatchObject({ name: "ComputerUseFailureError", code: "DEVICE_BUSY" })
    mode = "changed"
    await expect(executor.observe({ signal: AbortSignal.timeout(5_000) }))
      .rejects.toBeInstanceOf(ComputerUseFailureError)
    await expect(executor.observe({ signal: AbortSignal.timeout(5_000) }))
      .rejects.toMatchObject({ code: "COMPUTER_TARGET_CHANGED" })
    mode = "forbidden"
    await expect(executor.status({ signal: AbortSignal.timeout(5_000) }))
      .rejects.toMatchObject({ code: "COMPUTER_ACCESS_DENIED" })

    mode = "pending"
    const controller = new AbortController()
    const pending = executor.act({
      nativeCallId: "call-1", observationId: "obs-1", ref: "e1",
      action: "click", timeoutMs: 8_000, signal: controller.signal,
    })
    await vi.waitFor(() => expect(state.requests).toHaveLength(5))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "RUNNER_OPERATION_UNCERTAIN" })
    expect(state.cancels).toMatchObject([{ type: "tool.cancel", operation: "computer.execute" }])
    // A late success for the canceled id cannot resolve anything or be retried.
    const request = state.requests.at(-1)
    if (!request) throw new Error("missing canceled request")
    state.link.receive(toolResult(request, {
      kind: "act", result: { ok: true, effect: "done", waited_ms: 1 },
    }))
    await Promise.resolve()
    expect(state.requests).toHaveLength(5)
    expect(state.fail).not.toHaveBeenCalled()
  } finally {
    await state.close()
  }
})
