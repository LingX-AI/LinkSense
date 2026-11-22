import { describe, expect, it, vi } from "vitest"

import {
  computerUseRelayCoreMcpModules,
  createComputerUseRelayExecutor,
} from "../src/mcp/core-services/computer-use-relay.js"
import { createComputerUseCoreMcpModule } from "../src/mcp/core-services/computer-use-service.js"
import { createCoreMcpRegistry } from "../src/mcp/core-service-registry.js"
import { computerFixtureEnvironment } from "./functional/fixtures/fixture-environment.js"

const endpoint = "http://127.0.0.1:4000/mcp-current-user/task/computer-execute"
const token = "computer-token-000000000000000000000000000000"
const observation = {
  observation_id: "obs-1",
  tree_quality: "good" as const,
  truncated: false,
  nodes: [{ ref: "e1", role: "button", name: "Continue" }],
}
const status = {
  available: true,
  permissions: { accessibility: "granted" as const },
  active_grant: true,
}

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...computerFixtureEnvironment("default"),
    LINKSENSE_COMPUTER_ENDPOINT: endpoint,
    LINKSENSE_COMPUTER_TOKEN: token,
    ...overrides,
  }
}

function json(value: unknown, statusCode = 200) {
  return Response.json(value, { status: statusCode })
}

describe("computer_use production relay registration", () => {
  it("advertises nothing without the negotiated worker environment", () => {
    for (const mode of ["default", "plan"] as const) {
      const registry = createCoreMcpRegistry({
        mode,
        environment: computerFixtureEnvironment(mode),
      })
      expect(registry.tools.map(tool => tool.name)).not.toContain("computer_status")
      expect(registry.tools.map(tool => tool.name)).not.toContain("computer_observe")
      expect(registry.tools.map(tool => tool.name)).not.toContain("computer_act")
    }
  })

  it("advertises the full default tool set from computer.execute alone", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: { kind: string } }
      if (body.input.kind === "status") return json({ kind: "status", result: status })
      if (body.input.kind === "observe") return json({ kind: "observe", result: observation })
      return json({ kind: "act", result: { ok: true, effect: "done", waited_ms: 4 } })
    })
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: environment(),
      fetch: fetchMock,
    })
    const names = registry.tools.map(tool => tool.name)
    expect(names).toContain("computer_status")
    expect(names).toContain("computer_observe")
    expect(names).toContain("computer_act")
    expect(names).toContain("browser_use")

    const signal = () => new AbortController().signal
    expect((await registry.callTool({ toolName: "computer_status", argumentsValue: {}, signal: signal() })).isError).toBe(false)
    expect((await registry.callTool({ toolName: "computer_observe", argumentsValue: {}, signal: signal() })).isError).toBe(false)
    const act = await registry.callTool({
      toolName: "computer_act",
      argumentsValue: { action: "click", observation_id: "obs-1", ref: "e1" },
      nativeCallId: "call-1",
      signal: signal(),
    })
    expect(act.isError).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies[0]).toEqual({ input: { kind: "status" } })
    expect(bodies[1]).toEqual({ input: { kind: "observe" } })
    expect(bodies[2]).toEqual({
      input: {
        kind: "act",
        native_call_id: "call-1",
        input: { action: "click", observation_id: "obs-1", ref: "e1", timeout_ms: 8_000 },
      },
      nativeCallId: "call-1",
    })
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`)
      expect(String(init?.body)).not.toMatch(/bundle_id|selection_id|holder_id|session_id|window_id|pid/u)
    }
  })

  it("keeps Plan read-only and refuses a direct act without a request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: { kind: string } }
      return body.input.kind === "status" ? json({ kind: "status", result: status }) : json({ kind: "observe", result: observation })
    })
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: environment({ LINKSENSE_COLLABORATION_MODE: "plan" }),
      fetch: fetchMock,
    })
    expect(registry.tools.map(tool => tool.name)).toContain("computer_status")
    expect(registry.tools.map(tool => tool.name)).toContain("computer_observe")
    expect(registry.tools.map(tool => tool.name)).not.toContain("computer_act")

    const result = await registry.callTool({
      toolName: "computer_act",
      argumentsValue: { action: "click", observation_id: "obs-1", ref: "e1" },
      nativeCallId: "call-1",
      signal: new AbortController().signal,
    }).catch(error => error as Error)
    expect(result).toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never emits production raster from an environment flag and keeps the synthetic probe explicit", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D8IMGAwAWwsHY6MDm74AAAAASUVORK5CYII="
    const fallback = {
      observation_id: "obs-2",
      tree_quality: "unusable" as const,
      truncated: false,
      nodes: [],
      screenshot: { mime_type: "image/png" as const, data_base64: png, width: 2, height: 3 },
    }
    const observe = vi.fn<typeof fetch>(async () => json({ kind: "observe", result: fallback }))

    // Even an inherited or injected environment flag cannot select raster in
    // the production relay; the desktop worker never sets one.
    const textOnly = createCoreMcpRegistry({
      mode: "default",
      environment: environment({ LINKSENSE_COMPUTER_SCREENSHOTS_ENABLED: "1" }),
      fetch: observe,
    })
    const textResult = await textOnly.callTool({
      toolName: "computer_observe", argumentsValue: {}, signal: new AbortController().signal,
    })
    expect(textResult.content.some(part => part.type === "image")).toBe(false)
    expect(JSON.stringify(textResult.content)).not.toContain(png)

    // The synthetic probe injects the capability explicitly, like the fixture.
    const synthetic = createComputerUseCoreMcpModule({
      mode: "default",
      executor: createComputerUseRelayExecutor({ endpoint, token, fetch: observe }),
      screenshots: true,
    }).create({ environment: {}, workspaceRoot: "/tmp" })
    const imageResult = await synthetic.callTool({
      toolName: "computer_observe", argumentsValue: {}, signal: new AbortController().signal,
    })
    expect(imageResult.content).toContainEqual({ type: "image", data: png, mimeType: "image/png" })
    expect(JSON.stringify(imageResult.content)).not.toContain("data_base64")
  })
})

describe("computer_use relay failure semantics", () => {
  it("maps a definite pre-relay denial without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ error_code: "COMPUTER_ACCESS_DENIED" }, 403))
    const executor = createComputerUseRelayExecutor({ endpoint, token, fetch: fetchMock })
    await expect(executor.status({ signal: AbortSignal.timeout(1_000) }))
      .rejects.toMatchObject({ name: "ComputerUseFailureError", code: "COMPUTER_ACCESS_DENIED" })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("keeps reads unavailable when the relay response is unusable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ invalid: true }))
    const executor = createComputerUseRelayExecutor({ endpoint, token, fetch: fetchMock })
    await expect(executor.observe({ signal: AbortSignal.timeout(1_000) }))
      .rejects.toMatchObject({ name: "ComputerUseFailureError", code: "COMPUTER_UNAVAILABLE" })
    expect(fetchMock).toHaveBeenCalledOnce()

    const readFailure = vi.fn<typeof fetch>(async () =>
      json({ kind: "failure", error: "RUNNER_OPERATION_UNCERTAIN" }))
    const reads = createComputerUseRelayExecutor({ endpoint, token, fetch: readFailure })
    await expect(reads.status({ signal: AbortSignal.timeout(1_000) }))
      .rejects.toMatchObject({ name: "ComputerUseFailureError", code: "COMPUTER_UNAVAILABLE" })
    expect(readFailure).toHaveBeenCalledOnce()
  })

  it("never retries an effect and reports transport ambiguity once", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("connection reset")
    })
    const executor = createComputerUseRelayExecutor({ endpoint, token, fetch: fetchMock })
    await expect(executor.act({
      nativeCallId: "call-1",
      observationId: "obs-1",
      ref: "e1",
      action: "click",
      timeoutMs: 8_000,
      signal: AbortSignal.timeout(1_000),
    })).resolves.toMatchObject({ ok: false, error: "RUNNER_OPERATION_UNCERTAIN" })
    expect(fetchMock).toHaveBeenCalledOnce()

    const definite = vi.fn<typeof fetch>(async () =>
      json({ kind: "failure", error: "DEVICE_BUSY" }))
    const denied = createComputerUseRelayExecutor({ endpoint, token, fetch: definite })
    await expect(denied.act({
      nativeCallId: "call-1",
      observationId: "obs-1",
      ref: "e1",
      action: "click",
      timeoutMs: 8_000,
      signal: AbortSignal.timeout(1_000),
    })).resolves.toMatchObject({ ok: false, error: "DEVICE_BUSY" })
    expect(definite).toHaveBeenCalledOnce()
  })

  it("does not require a target, browser, artifact or approval environment", () => {
    const modules = computerUseRelayCoreMcpModules({
      environment: {
        LINKSENSE_COLLABORATION_MODE: "default",
        LINKSENSE_COMPUTER_ENDPOINT: endpoint,
        LINKSENSE_COMPUTER_TOKEN: token,
      },
      mode: "default",
    })
    expect(modules.map(module => module.key)).toEqual(["computer_use"])
    expect(modules[0]?.toolNames).toEqual(["computer_status", "computer_observe", "computer_act"])
  })
})
