import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { parseRunnerConfig } from "../src/config.js"
import type {
  WorkerAcquireInput,
  WorkerOwnerPaths,
  WorkerInstance,
  WorkerProvider,
} from "../src/controller/worker-provider.js"
import { WorkerManager } from "../src/controller/worker-manager.js"
import { TURN_START_CONTRACT_VERSION } from "../src/turn-start-contract.js"

const ownerId = "01900000-0000-7000-8000-000000000002"

describe("user and service worker reuse", () => {
  it("reuses a personal worker while keeping two service workers independent", async () => {
    const provider = fakeProvider()
    const transport = { request: vi.fn(async () => ({ statusCode: 200, headers: {}, body: Buffer.from(JSON.stringify(workerHealth())) })) }
    const manager = new WorkerManager(createConfig(), provider, transport, pino({ level: "silent" }), testManagerOptions())
    const session = "01900000-0000-7000-8000-000000000011", other = "01900000-0000-7000-8000-000000000012"
    await manager.initialize()
    try {
      await manager.request(ownerId, `/conversations/${session}/runtime`, "GET", undefined, undefined, "workspace")
      await manager.request(ownerId, `/conversations/${other}/runtime`, "GET", undefined, undefined, "workspace")
      await manager.request(ownerId, `/conversations/${session}/runtime`, "GET", undefined, undefined, "workspace", session)
      await manager.request(ownerId, `/conversations/${other}/runtime`, "GET", undefined, undefined, "workspace", other)
      await manager.request(ownerId, `/conversations/${session}/runtime`, "GET", undefined, undefined, "workspace", session)
      expect(provider.acquire).toHaveBeenCalledTimes(3)
      expect(new Set(provider.acquire.mock.calls.map(([input]) => input.storageKey)).size).toBe(3)
      expect(provider.prepareOwnerFilesystem.mock.calls.map(([paths]) => paths.owner)).toEqual([
        `/tmp/linksense/users/${ownerId}`, `/tmp/linksense/users/${ownerId}/services/${session}`, `/tmp/linksense/users/${ownerId}/services/${other}`,
      ])
    } finally { await manager.shutdown(false) }
  })
})
describe("WorkerProvider contract", () => {
  it("routes through the acquired endpoint and releases non-persistent workers on shutdown", async () => {
    const provider = fakeProvider()
    const transport = {
      request: vi.fn(async (endpoint: string, requestPath: string) => ({
        statusCode: 200,
        headers: {},
        body: Buffer.from(
          requestPath.startsWith("/health/")
            ? JSON.stringify(workerHealth())
            : JSON.stringify({ endpoint }),
        ),
      })),
    }
    const manager = new WorkerManager(
      createConfig(),
      provider,
      transport,
      pino({ level: "silent" }),
      testManagerOptions(),
    )
    await manager.initialize()

    await manager.request(ownerId, "/conversations/task/runtime", "PUT")
    await manager.shutdown(false)

    expect(provider.acquire).toHaveBeenCalledOnce()
    expect(transport.request).toHaveBeenCalledWith(
      "http://127.0.0.1:45123",
      "/conversations/task/runtime",
      "PUT",
      expect.any(Object),
      undefined,
      undefined,
    )
    expect(provider.release).toHaveBeenCalledOnce()
    expect(provider.shutdown).toHaveBeenCalledOnce()
  })

  it("propagates provider acquisition failure without switching providers or retrying", async () => {
    const provider = fakeProvider()
    provider.acquire.mockRejectedValueOnce(new Error("provider unavailable"))
    const manager = new WorkerManager(
      createConfig(),
      provider,
      { request: vi.fn() },
      pino({ level: "silent" }),
      testManagerOptions(),
    )
    await manager.initialize()

    await expect(
      manager.request(ownerId, "/conversations/task/runtime", "PUT"),
    ).rejects.toThrow("provider unavailable")
    expect(provider.acquire).toHaveBeenCalledOnce()
  })
})

function fakeProvider() {
  const acquire = vi.fn(async (input: WorkerAcquireInput) => ({
    id: "local-worker-1",
    name: input.name,
    endpoint: "http://127.0.0.1:45123",
    storageKey: input.storageKey,
    ownerId: input.ownerId,
    ...(input.serviceSessionId ? { serviceSessionId: input.serviceSessionId } : {}),
    state: "running" as const,
  }))
  return {
    kind: "local-process",
    capabilities: {
      isolation: "none",
      persistentWorkers: false,
      workspaceIdentity: {
        apiUid: 501,
        taskUid: 501,
        sharedGid: 20,
      },
    },
    initialize: vi.fn(async () => undefined),
    discover: vi.fn(async () => []),
    prepareOwnerFilesystem: vi.fn(async (paths: WorkerOwnerPaths) => { void paths }),
    acquire,
    resume: vi.fn(async (worker: WorkerInstance) => worker),
    inspect: vi.fn(async () => "running" as const),
    release: vi.fn(async () => undefined),
    hasWorkerForEnvironment: vi.fn(async () => false),
    healthDetails: vi.fn(async () => ({})),
    shutdown: vi.fn(async () => undefined),
  } satisfies WorkerProvider & { acquire: typeof acquire }
}

function testManagerOptions() {
  return {
    assertUserDataRoot: async () => undefined,
    prepareUserDirectories: async () => undefined,
    removeUserDirectories: async () => undefined,
    probeWorkerRuntime: async () => undefined,
  }
}

function createConfig() {
  return parseRunnerConfig({
    NODE_ENV: "development",
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_RUNNER_HOST: "127.0.0.1",
    LINKSENSE_WORKER_PROVIDER: "local-process",
    LINKSENSE_USER_DATA_ROOT: "/tmp/linksense/users",
    LINKSENSE_RUNNER_SHARED_SECRET:
      "runner-555555555555555555555555555555",
    LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000",
    LINKSENSE_CONTROLLER_INTERNAL_URL: "http://127.0.0.1:4010",
  })
}

function workerHealth() {
  const checkedAt = new Date().toISOString()
  return {
    turn_start_contract_version: TURN_START_CONTRACT_VERSION,
    status: "available",
    checked_at: checkedAt,
    workspace: {
      status: "available",
      reason_code: null,
      checked_at: checkedAt,
    },
    codex_home: {
      status: "available",
      reason_code: null,
      checked_at: checkedAt,
    },
    running_turns: 0,
    user_processes: 0,
    app_server_processes: 0,
  }
}
