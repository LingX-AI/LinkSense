import { describe, expect, it, vi } from "vitest"

import {
  ComputerUseFailureError,
  createComputerUseCoreMcpModule,
  type ComputerUseExecutor,
  type ComputerUseTarget,
} from "../src/mcp/core-services/computer-use-service.js"
import { createCoreMcpRegistry } from "../src/mcp/core-service-registry.js"

const target: ComputerUseTarget = { bundleId: "com.example.Fixture" }
const observation = {
  observation_id: "obs-1",
  tree_quality: "good" as const,
  truncated: false,
  nodes: [
    { ref: "e1", role: "button", name: "Continue" },
    { ref: "e2", role: "text_field", name: "Name" },
  ],
}
const status = {
  available: true,
  permissions: { accessibility: "granted" as const },
  active_grant: true,
  agent_desktop_version: "fixture-1.0",
}
const signal = () => new AbortController().signal

function fakeExecutor(overrides: Partial<ComputerUseExecutor> = {}) {
  const executor: ComputerUseExecutor = {
    status: vi.fn(async () => status),
    observe: vi.fn(async () => observation),
    act: vi.fn(async () => ({ ok: true, effect: "done" as const, waited_ms: 10 })),
    ...overrides,
  }
  return executor
}

function moduleFor(executor: ComputerUseExecutor, mode: "default" | "plan" = "default") {
  return createComputerUseCoreMcpModule({ mode, target, executor })
}

function toolFor(executor: ComputerUseExecutor, mode: "default" | "plan" = "default") {
  return moduleFor(executor, mode).create({ environment: {}, workspaceRoot: "/tmp" })
}

describe("computer_use Core MCP module", () => {
  it("rejects a malformed host-selected target before registration", () => {
    expect(() =>
      createComputerUseCoreMcpModule({
        mode: "default",
        target: { bundleId: "*" },
        executor: fakeExecutor(),
      }),
    ).toThrow()
  })

  it("registers status and observe in Plan mode and never exposes act", () => {
    const executor = fakeExecutor()
    const definition = moduleFor(executor, "plan")
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: planEnvironment(),
      extraModules: [definition],
    })

    expect(definition.toolNames).toEqual(["computer_status", "computer_observe"])
    expect(registry.tools.map((tool) => tool.name)).toContain("computer_status")
    expect(registry.tools.map((tool) => tool.name)).toContain("computer_observe")
    expect(registry.tools.map((tool) => tool.name)).not.toContain("computer_act")
  })

  it("rejects a direct Plan-mode act without calling the executor", async () => {
    const executor = fakeExecutor()
    const result = await toolFor(executor, "plan").callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(executor.act).not.toHaveBeenCalled()
  })

  it("requires the native call identity before acting", async () => {
    const executor = fakeExecutor()
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ code: "COMPUTER_ACCESS_DENIED", retryable: false }),
      },
    ])
    expect(executor.act).not.toHaveBeenCalled()
  })

  it.each([
    { bundle_id: "com.example.Other" },
    { window_id: 1 },
    { pid: 42 },
    { x: 10, y: 20 },
    { path: "/tmp/secret" },
    { command: "open -a Calculator" },
    { grant_id: "10000000-0000-4000-8000-000000000001" },
  ])("rejects a model-supplied selector or authority field %j", async (extra) => {
    const executor = fakeExecutor()
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: { ...clickArguments(), ...extra },
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(executor.act).not.toHaveBeenCalled()
  })

  it("rejects click arguments carrying text and type arguments without text", async () => {
    const executor = fakeExecutor()
    for (const argumentsValue of [
      { ...clickArguments(), text: "unexpected" },
      { action: "type", observation_id: "obs-1", ref: "e2" },
    ]) {
      const result = await toolFor(executor).callTool({
        toolName: "computer_act",
        argumentsValue,
        nativeCallId: "call-1",
        signal: signal(),
      })
      expect(result.isError).toBe(true)
    }
    expect(executor.act).not.toHaveBeenCalled()
  })

  it("passes the latest observation binding, native call id and UTF-8 text to the executor", async () => {
    const executor = fakeExecutor()
    const text = "你好，LinkSense 👋"
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: { action: "type", observation_id: "obs-1", ref: "e2", text },
      nativeCallId: "call-42",
      signal: signal(),
    })

    expect(executor.act).toHaveBeenCalledTimes(1)
    expect(executor.act).toHaveBeenCalledWith(expect.objectContaining({
      target,
      nativeCallId: "call-42",
      observationId: "obs-1",
      ref: "e2",
      action: "type",
      text,
      timeoutMs: 8_000,
    }))
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ ok: true, effect: "done", waited_ms: 10 }),
    })
  })

  it("reports no_effect as an executed action with a no-repeat instruction", async () => {
    const executor = fakeExecutor({
      act: vi.fn(async () => ({ ok: true, effect: "no_effect" as const, waited_ms: 8_000 })),
    })
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain("Do not repeat the same action")
    expect(executor.act).toHaveBeenCalledTimes(1)
  })

  it.each(["DEVICE_BUSY", "COMPUTER_TARGET_CHANGED"] as const)(
    "preserves the stable %s failure from the executor",
    async code => {
      const executor = fakeExecutor({
        status: vi.fn(async () => { throw new ComputerUseFailureError(code) }),
        observe: vi.fn(async () => { throw new ComputerUseFailureError(code) }),
      })
      for (const toolName of ["computer_status", "computer_observe"] as const) {
        const result = await toolFor(executor).callTool({
          toolName,
          argumentsValue: {},
          signal: signal(),
        })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toContain(code)
      }
    },
  )

  it.each([
    ["RUNNER_OPERATION_UNCERTAIN", "Do not repeat it"],
    ["COMPUTER_STALE_REF", "observe the current state first"],
  ] as const)("reports %s once without retrying", async (code, guidance) => {    const executor = fakeExecutor({
      act: vi.fn(async () => ({ ok: false as const, error: code, waited_ms: 0 })),
    })
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain(guidance)
    expect(executor.act).toHaveBeenCalledTimes(1)
  })

  it("reports uncertainty for an invalid executor outcome after dispatch", async () => {
    const executor = fakeExecutor({
      act: vi.fn(async () => ({ ok: true, waited_ms: 1 }) as never),
    })
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("RUNNER_OPERATION_UNCERTAIN")
    expect(JSON.stringify(result.content)).toContain("Do not repeat it")
    expect(executor.act).toHaveBeenCalledTimes(1)
  })

  it("propagates caller cancellation to the executor and never returns success", async () => {
    const controller = new AbortController()
    let executorSignal: AbortSignal | undefined
    const executor = fakeExecutor({
      act: vi.fn<ComputerUseExecutor["act"]>(({ signal: executorSignalSignal }) => {
        executorSignal = executorSignalSignal
        return new Promise((_, reject) => {
          executorSignalSignal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          )
        })
      }),
    })
    const pending = toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(executor.act).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(executorSignal?.aborted).toBe(true)
    expect(executor.act).toHaveBeenCalledTimes(1)
  })

  it("reports uncertainty when the executor rejects after dispatch", async () => {
    const executor = fakeExecutor({
      act: vi.fn(async () => {
        throw new Error("engine unavailable")
      }),
    })
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("RUNNER_OPERATION_UNCERTAIN")
    expect(JSON.stringify(result.content)).toContain("Do not repeat it")
    expect(executor.act).toHaveBeenCalledTimes(1)
  })

  it.each(["computer_status", "computer_observe"] as const)(
    "does not return a late %s success after caller cancellation",
    async (toolName) => {
      const controller = new AbortController()
      const deferred = deferredResult<never>()
      const executor = fakeExecutor({
        ...(toolName === "computer_status"
          ? { status: vi.fn<ComputerUseExecutor["status"]>(() => deferred.promise) }
          : { observe: vi.fn<ComputerUseExecutor["observe"]>(() => deferred.promise) }),
      })
      const pending = toolFor(executor).callTool({
        toolName,
        argumentsValue: {},
        signal: controller.signal,
      })
      const handler = toolName === "computer_status" ? executor.status : executor.observe
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
      controller.abort()
      deferred.resolve(observation as never)

      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    },
  )

  it("does not return a late act success after caller cancellation", async () => {
    const controller = new AbortController()
    const deferred = deferredResult<{ ok: true; effect: "done"; waited_ms: number }>()
    const executor = fakeExecutor({
      act: vi.fn<ComputerUseExecutor["act"]>(() => deferred.promise),
    })
    const pending = toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: clickArguments(),
      nativeCallId: "call-1",
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(executor.act).toHaveBeenCalledTimes(1))
    controller.abort()
    deferred.resolve({ ok: true, effect: "done", waited_ms: 1 })

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("does not accept a late act success after its own deadline", async () => {
    const executor = fakeExecutor({
      act: vi.fn<ComputerUseExecutor["act"]>(
        () =>
          new Promise((resolve) => {
            const timer = setTimeout(
              () => resolve({ ok: true, effect: "done", waited_ms: 1 }),
              3_000,
            )
            timer.unref()
          }),
      ),
    })
    const result = await toolFor(executor).callTool({
      toolName: "computer_act",
      argumentsValue: { ...clickArguments(), timeout_ms: 100 },
      nativeCallId: "call-1",
      signal: signal(),
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("RUNNER_OPERATION_UNCERTAIN")
    expect(JSON.stringify(result.content)).toContain("Do not repeat it")
    expect(executor.act).toHaveBeenCalledTimes(1)
  })

  it("rejects explicit null for no-argument read tools", async () => {
    const executor = fakeExecutor()
    for (const toolName of ["computer_status", "computer_observe"] as const) {
      const result = await toolFor(executor).callTool({
        toolName,
        argumentsValue: null,
        signal: signal(),
      })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain("COMPUTER_INVALID")
    }
    expect(executor.status).not.toHaveBeenCalled()
    expect(executor.observe).not.toHaveBeenCalled()
  })

  it("binds status and observe to the host-selected target and accepts no extra arguments", async () => {
    const executor = fakeExecutor()
    const tool = toolFor(executor)

    for (const [toolName, argumentsValue] of [
      ["computer_status", {}],
      ["computer_observe", {}],
    ] as const) {
      const result = await tool.callTool({
        toolName,
        argumentsValue,
        nativeCallId: "call-1",
        signal: signal(),
      })
      expect(result.isError).toBe(false)
      const extra = await tool.callTool({
        toolName,
        argumentsValue: { bundle_id: "com.example.Other" },
        nativeCallId: "call-1",
        signal: signal(),
      })
      expect(extra.isError).toBe(true)
    }

    expect(executor.status).toHaveBeenCalledWith(expect.objectContaining({ target }))
    expect(executor.observe).toHaveBeenCalledWith(expect.objectContaining({ target }))
    expect(executor.status).toHaveBeenCalledTimes(1)
    expect(executor.observe).toHaveBeenCalledTimes(1)
  })
})

function clickArguments() {
  return { action: "click" as const, observation_id: "obs-1", ref: "e1" }
}

function deferredResult<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function planEnvironment(): NodeJS.ProcessEnv {
  return {
    LINKSENSE_COLLABORATION_MODE: "plan",
    LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:4000/search",
    LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
    LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: "turn-token-00000000000000000000000000000000",
    LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
    LINKSENSE_FORM_SERVICE_TOKEN: "turn-token-00000000000000000000000000000000",
    LINKSENSE_WEB_SEARCH_ENDPOINT: "http://127.0.0.1:4000/web-search",
    LINKSENSE_WEB_SEARCH_TOKEN: "synthetic-web-search-token-000000000000000000000",
    LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
    LINKSENSE_CURRENT_USER_TOKEN: "turn-token-00000000000000000000000000000000",
  }
}
