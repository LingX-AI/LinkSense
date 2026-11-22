import {
  computerScreenshotMaxResultBytes,
  computerScreenshotSchema,
  type ComputerObservation,
} from "@linksense/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ComputerUseFailureError,
  createComputerUseCoreMcpModule,
  type ComputerUseExecutor,
} from "../src/mcp/core-services/computer-use-service.js"
import { createCoreMcpRegistry } from "../src/mcp/core-service-registry.js"
import { deferred } from "./deferred.js"

const sharpControl = vi.hoisted(() => ({
  created: 0,
  decoding: 0,
  gate: undefined as Promise<void> | undefined,
}))

/**
 * Delegating sharp mock at the module boundary: a test can hold the pixel
 * pipeline while metadata resolves, and can assert the loader was never
 * invoked. Production code has no seam purely for tests.
 */
vi.mock("sharp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sharp")>()
  const create = actual.default
  const factory = (
    input: Parameters<typeof create>[0],
    options?: Parameters<typeof create>[1],
  ) => {
    sharpControl.created += 1
    const image = create(input, options)
    const pipeline = {
      metadata: () => image.metadata(),
      timeout: (options: Parameters<typeof image.timeout>[0]) => {
        image.timeout(options)
        return pipeline
      },
      raw: () => {
        image.raw()
        return pipeline
      },
      toBuffer: async () => {
        sharpControl.decoding += 1
        await sharpControl.gate
        return image.toBuffer({ resolveWithObject: true })
      },
    }
    return pipeline
  }
  return { ...actual, default: factory }
})

beforeEach(() => {
  sharpControl.created = 0
  sharpControl.decoding = 0
  sharpControl.gate = undefined
})

const observation = {
  observation_id: "obs-1",
  tree_quality: "good" as const,
  truncated: false,
  nodes: [
    { ref: "e1", role: "button", name: "Continue" },
    { ref: "e2", role: "text_field", name: "Name" },
  ],
}
/** Synthetic 2x3 PNG; 74 decoded bytes. */
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D8IMGAwAWwsHY6MDm74AAAAASUVORK5CYII="
/** Synthetic 1x1 JPEG; 159 decoded bytes. */
const jpeg =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z"
/** Signature, IHDR and dimensions survive; IDAT pixel data does not. */
const truncatedPng = Buffer.from(png, "base64").subarray(0, 50).toString("base64")
/** Missing EOI after a readable header. */
const truncatedJpeg = Buffer.from(jpeg, "base64").subarray(0, 158).toString("base64")
/** Valid header and CRC; one compressed IDAT byte is corrupt. */
const corruptPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D5gMGAwAWwsHY0R/UFYAAAAASUVORK5CYII="
/** Declared as PNG but not a raster; must not reach a sharp loader. */
const disguisedSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>',
).toString("base64")
const fallbackScreenshot = {
  mime_type: "image/png" as const,
  data_base64: png,
  width: 2,
  height: 3,
}
const fallbackObservation: ComputerObservation = {
  observation_id: "obs-fallback",
  tree_quality: "unusable",
  truncated: false,
  nodes: [],
  screenshot: fallbackScreenshot,
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

function moduleFor(
  executor: ComputerUseExecutor,
  mode: "default" | "plan" = "default",
  screenshots = true,
) {
  return createComputerUseCoreMcpModule({ mode, executor, screenshots })
}

function toolFor(
  executor: ComputerUseExecutor,
  mode: "default" | "plan" = "default",
  screenshots = true,
) {
  return moduleFor(executor, mode, screenshots).create({ environment: {}, workspaceRoot: "/tmp" })
}

describe("computer_use Core MCP module", () => {
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

  it("accepts no extra arguments on status and observe", async () => {
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

    expect(executor.status).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(executor.observe).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(executor.status).toHaveBeenCalledTimes(1)
    expect(executor.observe).toHaveBeenCalledTimes(1)
  })

  it("keeps the existing text-only tree result unchanged", async () => {
    const result = await observeWith(fakeExecutor())

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(observation) }],
      isError: false,
    })
  })

  it("strips a fallback screenshot when the host has not proven raster support", async () => {
    const result = await observeWith(
      fakeExecutor({ observe: vi.fn(async () => fallbackObservation) }),
      "default",
      false,
    )

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{
      type: "text",
      text: JSON.stringify({
        observation_id: "obs-fallback",
        tree_quality: "unusable",
        truncated: false,
        nodes: [],
      }),
    }])
    expect(JSON.stringify(result.content)).not.toContain(png)
    expect(sharpControl.created).toBe(0)
  })

  it("serializes an eligible fallback as text plus one image and no structuredContent", async () => {
    const result = await observeWith(
      fakeExecutor({ observe: vi.fn(async () => fallbackObservation) }),
    )

    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          observation_id: "obs-fallback",
          tree_quality: "unusable",
          truncated: false,
          nodes: [],
          screenshot: { mime_type: "image/png", width: 2, height: 3 },
        }),
      },
      { type: "image", data: png, mimeType: "image/png" },
    ])
    expect(result.isError).toBe(false)
    expect("structuredContent" in result).toBe(false)
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
      computerScreenshotMaxResultBytes,
    )
  })

  it("emits an eligible fallback in Plan mode", async () => {
    const result = await observeWith(
      fakeExecutor({ observe: vi.fn(async () => fallbackObservation) }),
      "plan",
    )

    expect(result.isError).toBe(false)
    expect(result.content.some((part) => part.type === "image")).toBe(true)
  })

  it.each([
    ["PNG", truncatedPng, "image/png", 2, 3],
    ["JPEG", truncatedJpeg, "image/jpeg", 1, 1],
  ] as const)(
    "rejects a valid-header but truncated %s image",
    async (_name, data, mimeType, width, height) => {
      const screenshot = {
        mime_type: mimeType,
        data_base64: data,
        width,
        height,
      }
      // The transport metadata is valid; only a real decode can reject this.
      expect(computerScreenshotSchema.safeParse(screenshot).success).toBe(true)

      const result = await observeWith(
        fakeExecutor({
          observe: vi.fn(async () => ({ ...fallbackObservation, screenshot })),
        }),
      )

      expect(result.isError).toBe(true)
      expect(result.content.some((part) => part.type === "image")).toBe(false)
      expect(JSON.stringify(result.content)).toContain("COMPUTER_INVALID")
    },
  )

  it("rejects a corrupt pixel payload under valid PNG metadata", async () => {
    const screenshot = {
      mime_type: "image/png" as const,
      data_base64: corruptPng,
      width: 2,
      height: 3,
    }
    // The transport metadata is valid; only the full pixel decode can reject this.
    expect(computerScreenshotSchema.safeParse(screenshot).success).toBe(true)

    const result = await observeWith(
      fakeExecutor({
        observe: vi.fn(async () => ({ ...fallbackObservation, screenshot })),
      }),
    )

    expect(sharpControl.created).toBe(1)
    expect(result.isError).toBe(true)
    expect(result.content.some((part) => part.type === "image")).toBe(false)
    expect(JSON.stringify(result.content)).toContain("COMPUTER_INVALID")
  })

  it("rejects disguised non-raster bytes before sharp selects a loader", async () => {
    const screenshot = {
      mime_type: "image/png" as const,
      data_base64: disguisedSvg,
      width: 2,
      height: 3,
    }
    expect(computerScreenshotSchema.safeParse(screenshot).success).toBe(true)

    const result = await observeWith(
      fakeExecutor({
        observe: vi.fn(async () => ({ ...fallbackObservation, screenshot })),
      }),
    )

    expect(sharpControl.created).toBe(0)
    expect(result.isError).toBe(true)
    expect(result.content.some((part) => part.type === "image")).toBe(false)
  })

  it("returns no image when the caller cancels while the decoder is queued", async () => {
    const gate = deferred<void>()
    sharpControl.gate = gate.promise
    const controller = new AbortController()
    const executor = fakeExecutor({
      observe: vi.fn(async () => fallbackObservation),
    })
    const pending = toolFor(executor).callTool({
      toolName: "computer_observe",
      argumentsValue: {},
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(sharpControl.decoding).toBe(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    gate.resolve()
  })

  it.each([
    ["a healthy tree", () => ({ ...fallbackObservation, tree_quality: "good" })],
    ["a mismatched image type", () => ({
      ...fallbackObservation,
      screenshot: { ...fallbackScreenshot, mime_type: "image/jpeg" },
    })],
    ["mismatched dimensions", () => ({
      ...fallbackObservation,
      screenshot: { ...fallbackScreenshot, width: 4 },
    })],
    ["permission metadata", () => ({
      ...fallbackObservation,
      screenshot: {
        ...fallbackScreenshot,
        capture: { user_opt_in: true, screen_recording: "granted" },
      },
    })],
    ["an oversized image", () => ({
      ...fallbackObservation,
      screenshot: { ...fallbackScreenshot, data_base64: "A".repeat(300_000) },
    })],
  ])("rejects %s without emitting an image", async (_name, candidate) => {
    const result = await observeWith(
      fakeExecutor({ observe: vi.fn(async () => candidate() as never) }),
    )

    expect(result.isError).toBe(true)
    expect(result.content.some((part) => part.type === "image")).toBe(false)
    expect(JSON.stringify(result.content)).toContain("COMPUTER_INVALID")
  })
})

async function observeWith(
  executor: ComputerUseExecutor,
  mode: "default" | "plan" = "default",
  screenshots = true,
) {
  return toolFor(executor, mode, screenshots).callTool({
    toolName: "computer_observe",
    argumentsValue: {},
    signal: signal(),
  })
}

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
