import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { parseRunnerConfig } from "../src/config.js"
import {
  controllerInstanceKey,
  ownerStorageKey,
  ownerWorkerSecret,
  WORKER_RUNTIME_LAYOUT,
  workerContractKey,
} from "../src/controller/storage-key.js"
import type {
  WorkerHttpResponse,
  WorkerTransport,
} from "../src/controller/worker-http-client.js"
import {
  buildWorkerContainerSpec,
  prepareTaskOwnedDirectory,
  removeUserDirectoryAfterContainerRelease,
  WorkerManager,
} from "../src/controller/worker-manager.js"
import type {
  DockerContainerCreate,
  DockerContainerResourceStats,
  DockerContainerSummary,
  DockerEngine,
} from "../src/docker/engine-client.js"
import { TURN_START_CONTRACT_VERSION } from "../src/turn-start-contract.js"

const ownerId = "01900000-0000-7000-8000-000000000002"
const secret = "runner-555555555555555555555555555555"

describe("controller user-directory cleanup", () => {
  it("retries a transient bind-mount release failure with bounded delays", async () => {
    const transient = Object.assign(new Error("mount is releasing"), {
      code: "EACCES",
    })
    const removeDirectory = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(undefined)
    const wait = vi.fn(async () => undefined)

    await expect(
      removeUserDirectoryAfterContainerRelease("/users/probe", {
        remove: removeDirectory,
        wait,
      }),
    ).resolves.toBeUndefined()
    expect(removeDirectory).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[50], [100]])
  })

  it("does not retry a non-transient directory removal error", async () => {
    const invalid = Object.assign(new Error("invalid path"), {
      code: "EINVAL",
    })
    const removeDirectory = vi.fn(async () => {
      throw invalid
    })
    const wait = vi.fn(async () => undefined)

    await expect(
      removeUserDirectoryAfterContainerRelease("/users/probe", {
        remove: removeDirectory,
        wait,
      }),
    ).rejects.toBe(invalid)
    expect(removeDirectory).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
  })

  it("stops retrying a persistent bind-mount release failure", async () => {
    const transient = Object.assign(new Error("mount remains busy"), {
      code: "EBUSY",
    })
    const removeDirectory = vi.fn(async () => {
      throw transient
    })
    const wait = vi.fn(async () => undefined)

    await expect(
      removeUserDirectoryAfterContainerRelease("/users/probe", {
        remove: removeDirectory,
        wait,
      }),
    ).rejects.toBe(transient)
    expect(removeDirectory).toHaveBeenCalledTimes(120)
    expect(wait).toHaveBeenCalledTimes(119)
  })
})

describe("controller task-owned directory preparation", () => {
  it("repairs a legacy directory for the shared worker identity", async () => {
    const createDirectory = vi.fn(async () => {
      throw Object.assign(new Error("already exists"), { code: "EEXIST" })
    })
    const assertDirectory = vi.fn(async () => undefined)
    const changeOwner = vi.fn(async () => undefined)
    const changeMode = vi.fn(async () => undefined)

    await prepareTaskOwnedDirectory("/users", "/users/owner/home/workspaces", {
      mkdir: createDirectory,
      assertSafeDirectory: assertDirectory,
      chown: changeOwner,
      chmod: changeMode,
    })

    expect(createDirectory).toHaveBeenCalledWith(
      "/users/owner/home/workspaces",
      { mode: 0o770 },
    )
    expect(assertDirectory).toHaveBeenCalledWith(
      "/users",
      "/users/owner/home/workspaces",
    )
    expect(changeOwner).toHaveBeenCalledWith(
      "/users/owner/home/workspaces",
      1001,
      1000,
    )
    expect(changeMode).toHaveBeenCalledWith(
      "/users/owner/home/workspaces",
      0o770,
    )
  })
})

describe("controller worker lifecycle", () => {
  it("cleans an absent worker task directly without starting a worker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-cleanup-controller-"))
    const userDataRoot = path.join(root, "users")
    const conversationId = "01900000-0000-7000-8000-000000000001"
    const workspace = path.join(
      userDataRoot,
      ownerId,
      "home",
      "workspaces",
      conversationId,
    )
    const taskControl = path.join(
      userDataRoot,
      ownerId,
      "control",
      "workspaces",
      conversationId,
    )
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(taskControl, { recursive: true }),
    ])
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = new WorkerManager(
      createConfig({ LINKSENSE_USER_DATA_ROOT: userDataRoot }),
      docker,
      transport,
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        removeUserDirectories: async () => undefined,
        probeWorkerRuntime: async () => undefined,
      },
    )
    await manager.initialize()

    await expect(
      manager.cleanupConversation(ownerId, conversationId),
    ).resolves.toMatchObject({ statusCode: 200 })
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(transport.calls).toEqual([])
    await expect(lstat(workspace)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(taskControl)).rejects.toMatchObject({ code: "ENOENT" })
    await rm(root, { recursive: true })
  })

  it("uses an existing owner worker for only the target task cleanup", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/other/runtime", "PUT")

    await manager.cleanupConversation(
      ownerId,
      "01900000-0000-7000-8000-000000000001",
    )

    expect(docker.createContainer).toHaveBeenCalledOnce()
    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(transport.calls.map((call) => call.path)).toContain(
      "/conversations/01900000-0000-7000-8000-000000000001/runtime",
    )
  })

  it("does not delete task paths when another controller may own the worker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-cleanup-foreign-"))
    const userDataRoot = path.join(root, "users")
    const conversationId = "01900000-0000-7000-8000-000000000001"
    const workspace = path.join(
      userDataRoot,
      ownerId,
      "home",
      "workspaces",
      conversationId,
    )
    await mkdir(workspace, { recursive: true })
    const docker = new FakeDocker([
      {
        Id: "foreign-worker",
        Names: ["/foreign-worker"],
        State: "running",
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.instance": "another-controller",
        },
      },
    ])
    const manager = new WorkerManager(
      createConfig({ LINKSENSE_USER_DATA_ROOT: userDataRoot }),
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        removeUserDirectories: async () => undefined,
        probeWorkerRuntime: async () => undefined,
      },
    )
    await manager.initialize()

    await expect(
      manager.cleanupConversation(ownerId, conversationId),
    ).rejects.toMatchObject({
      stage: "reconcile",
      reasonCode: "CLEANUP_RUNTIME_STATE_UNCERTAIN",
    })
    await expect(lstat(workspace)).resolves.toMatchObject({})
    expect(docker.stopContainer).not.toHaveBeenCalled()
    await rm(root, { recursive: true })
  })

  it("rejects a symlinked task parent without touching its destination", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-cleanup-boundary-"))
    const userDataRoot = path.join(root, "users")
    const ownerHome = path.join(userDataRoot, ownerId, "home")
    const outside = path.join(root, "outside")
    const conversationId = "01900000-0000-7000-8000-000000000001"
    await Promise.all([
      mkdir(ownerHome, { recursive: true }),
      mkdir(path.join(userDataRoot, ownerId, "control"), { recursive: true }),
      mkdir(path.join(outside, conversationId), { recursive: true }),
    ])
    await symlink(outside, path.join(ownerHome, "workspaces"))
    const manager = new WorkerManager(
      createConfig({ LINKSENSE_USER_DATA_ROOT: userDataRoot }),
      new FakeDocker(),
      new FakeTransport(),
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        removeUserDirectories: async () => undefined,
        probeWorkerRuntime: async () => undefined,
      },
    )
    await manager.initialize()

    await expect(
      manager.cleanupConversation(ownerId, conversationId),
    ).rejects.toMatchObject({
      stage: "reconcile",
      reasonCode: "CLEANUP_PATH_BOUNDARY_INVALID",
    })
    await expect(lstat(path.join(outside, conversationId))).resolves.toMatchObject(
      {},
    )
    await rm(root, { recursive: true })
  })

  it("repairs existing user permissions before probing the worker runtime", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const repairExistingUserDirectories = vi.fn(async () => undefined)
    const probeWorkerRuntime = vi.fn(async () => undefined)
    const manager = createManager(docker, transport, {
      repairExistingUserDirectories,
      probeWorkerRuntime,
    })

    await manager.initialize()

    expect(repairExistingUserDirectories).toHaveBeenCalledOnce()
    expect(probeWorkerRuntime).toHaveBeenCalledOnce()
    expect(
      repairExistingUserDirectories.mock.invocationCallOrder[0],
    ).toBeLessThan(probeWorkerRuntime.mock.invocationCallOrder[0]!)
  })

  it("creates only one worker for concurrent requests and uses a scoped secret", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()

    await Promise.all([
      manager.request(ownerId, "/conversations/one/runtime", "PUT"),
      manager.request(ownerId, "/conversations/two/runtime", "PUT"),
    ])

    expect(docker.createContainer).toHaveBeenCalledTimes(1)
    const workerRequests = transport.calls.filter(
      (call) => call.path.startsWith("/conversations/"),
    )
    expect(workerRequests).toHaveLength(2)
    expect(workerRequests[0]?.headers.authorization).toBe(
      `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
    )
    expect(workerRequests[0]?.headers.authorization).not.toContain(secret)
    expect(transport.calls.map((call) => call.path)).not.toContain(
      "/health/ready",
    )
  })

  it("prewarms only the owner worker and releases its lifecycle request", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()

    await manager.prewarm(ownerId)

    expect(docker.createContainer).toHaveBeenCalledOnce()
    expect(transport.calls.map((call) => call.path)).toEqual([
      "/health/state",
    ])
    await manager.sweepIdleWorkers(Date.now() + 1_100)
    expect(docker.stopContainer).toHaveBeenCalledOnce()
    expect(docker.removeContainer).toHaveBeenCalledOnce()
  })

  it("fails fast and removes a new worker whose turn-start contract version differs", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    transport.state = {
      ...stateHealth({}),
      turn_start_contract_version: "shared-user-home-v21",
    }
    const manager = createManager(docker, transport)
    await manager.initialize()

    await expect(
      manager.request(ownerId, "/conversations/one/runtime", "PUT"),
    ).rejects.toThrow("worker turn-start contract version mismatch")

    expect(
      transport.calls.filter((call) => call.path === "/health/state"),
    ).toHaveLength(1)
    expect(docker.removeContainer).toHaveBeenCalledWith("container-1")
  })

  it("routes the first request after shallow state readiness without waiting for a per-worker Codex probe", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    transport.state = stateHealth({})
    transport.ready = {
      ...stateHealth({}),
      status: "unavailable",
    }
    const manager = createManager(docker, transport)
    await manager.initialize()

    await expect(
      manager.request(ownerId, "/conversations/one/runtime", "PUT"),
    ).resolves.toMatchObject({ statusCode: 200 })

    expect(transport.calls.map((call) => call.path)).toEqual([
      "/health/state",
      "/conversations/one/runtime",
    ])
  })

  it("marks worker state unavailable when its turn-start contract version differs", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")
    transport.state = {
      ...stateHealth({}),
      turn_start_contract_version: "legacy",
    }

    const health = await manager.health()

    expect(health.statusCode).toBe(503)
    expect(health.body).toMatchObject({
      status: "unavailable",
      turn_start_contract_version: TURN_START_CONTRACT_VERSION,
    })
  })

  it("keeps active workers and removes a fully idle container", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")

    const firstExpiredAt = Date.now() + 60_000_000
    transport.state = stateHealth({ runningTurns: 1 })
    await manager.sweepIdleWorkers(firstExpiredAt)
    expect(docker.stopContainer).not.toHaveBeenCalled()

    transport.state = stateHealth({})
    await manager.sweepIdleWorkers(firstExpiredAt + 500)
    expect(docker.stopContainer).not.toHaveBeenCalled()
    await manager.sweepIdleWorkers(firstExpiredAt + 1_100)
    expect(docker.stopContainer).toHaveBeenCalledTimes(1)
    expect(docker.removeContainer).toHaveBeenCalledTimes(1)
  })

  it("removes all managed workers during an explicit development shutdown", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")

    await manager.stopAllWorkers()

    expect(docker.stopContainer).toHaveBeenCalledTimes(1)
    expect(docker.removeContainer).toHaveBeenCalledTimes(1)
    await manager.request(ownerId, "/conversations/two/runtime", "PUT")
    expect(docker.createContainer).toHaveBeenCalledTimes(2)
  })

  it("starts the worker idle TTL only after its last app-server process exits", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")

    const processActiveAt = Date.now() + 60_000_000
    transport.state = stateHealth({ appServerProcesses: 1 })
    await manager.sweepIdleWorkers(processActiveAt)
    transport.state = stateHealth({})
    await manager.sweepIdleWorkers(processActiveAt + 999)

    expect(docker.stopContainer).not.toHaveBeenCalled()
    await manager.sweepIdleWorkers(processActiveAt + 1_001)
    expect(docker.stopContainer).toHaveBeenCalledTimes(1)
  })

  it("does not remove a worker when readiness state probing fails transiently", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")
    transport.failNextStateRequest = true

    const health = await manager.health()

    expect(health.statusCode).toBe(503)
    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
    await manager.request(ownerId, "/conversations/two/runtime", "PUT")
    expect(docker.createContainer).toHaveBeenCalledTimes(1)
  })

  it("keeps an expired worker when the idle reaper cannot verify its state", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")
    transport.failNextStateRequest = true

    await manager.sweepIdleWorkers(Date.now() + 60_000_000)

    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it("does not reap a worker when a request starts while the idle state probe is pending", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")

    const stateStarted = deferred<void>()
    const stateGate = deferred<void>()
    transport.nextStateRequestStarted = stateStarted.resolve
    transport.nextStateRequestGate = stateGate.promise
    const sweep = manager.sweepIdleWorkers(Date.now() + 60_000_000)
    await stateStarted.promise

    const applicationStarted = deferred<void>()
    const applicationGate = deferred<void>()
    transport.nextApplicationRequestStarted = applicationStarted.resolve
    transport.nextApplicationRequestGate = applicationGate.promise
    const request = manager.request(
      ownerId,
      "/conversations/two/runtime",
      "PUT",
    )
    await applicationStarted.promise

    stateGate.resolve()
    await sweep
    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()

    applicationGate.resolve()
    await request
  })

  it("adopts a stopped worker after restart and uses shallow health", async () => {
    const storageKey = ownerStorageKey(ownerId, secret)
    const docker = new FakeDocker([
      {
        Id: "adopted-container",
        Names: [`/linksense-worker-${storageKey}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.contract": workerContractKey(createConfig()),
          "com.linksense.runner.instance": controllerInstanceKey(createConfig()),
        },
        State: "exited",
      },
    ])
    const transport = new FakeTransport()
    transport.state = stateHealth({})
    const prepareUserDirectories = vi.fn(async () => undefined)
    const assertManagedProjection = vi.fn(async () => undefined)
    const manager = createManager(docker, transport, {
      prepareUserDirectories,
      assertManagedProjection,
    })

    await manager.initialize()
    const health = await manager.health()

    expect(prepareUserDirectories).toHaveBeenCalledExactlyOnceWith(ownerId)
    expect(
      prepareUserDirectories.mock.invocationCallOrder[0],
    ).toBeLessThan(assertManagedProjection.mock.invocationCallOrder[0]!)
    expect(
      assertManagedProjection.mock.invocationCallOrder[0],
    ).toBeLessThan(docker.startContainer.mock.invocationCallOrder[0]!)
    expect(assertManagedProjection).toHaveBeenCalledExactlyOnceWith(ownerId)
    expect(docker.startContainer).toHaveBeenCalledWith("adopted-container")
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(health.statusCode).toBe(200)
    expect(transport.calls.map((call) => call.path)).not.toContain(
      "/health/ready",
    )
    expect(transport.calls.map((call) => call.path)).toContain("/health/state")
  })

  it("ignores workers managed by another controller instance", async () => {
    const docker = new FakeDocker([
      {
        Id: "foreign-container",
        Names: ["/foreign-worker"],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.instance": "another-instance",
        },
        State: "running",
      },
    ])
    const manager = createManager(docker, new FakeTransport())

    await manager.initialize()

    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it("creates an instance-scoped worker without removing a foreign active worker", async () => {
    const storageKey = ownerStorageKey(ownerId, secret)
    const docker = new FakeDocker([
      {
        Id: "worker-before-storage-domain-change",
        Names: [`/linksense-worker-${storageKey}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.contract": workerContractKey(createConfig()),
          "com.linksense.runner.instance": "previous-storage-domain",
        },
        State: "running",
      },
    ])
    const manager = createManager(docker, new FakeTransport())

    await manager.initialize()
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")

    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
    expect(docker.createContainer).toHaveBeenCalledOnce()
    const [containerName] = docker.createContainer.mock.calls[0]!
    expect(containerName).toMatch(/^linksense-worker-[0-9a-f]{32}$/u)
    expect(containerName).not.toBe(`linksense-worker-${storageKey}`)
    expect(containerName.length).toBeLessThanOrEqual(63)
  })

  it("uses distinct DNS-safe worker names for different storage domains", async () => {
    const configs = [
      createConfig(),
      createConfig({ LINKSENSE_USER_DATA_VOLUME: "linksense-user-data" }),
    ]
    const names: string[] = []

    for (const config of configs) {
      const docker = new FakeDocker()
      const manager = new WorkerManager(
        config,
        docker,
        new FakeTransport(),
        pino({ level: "silent" }),
        {
          assertUserDataRoot: async () => undefined,
          prepareUserDirectories: async () => undefined,
          removeUserDirectories: async () => undefined,
          probeWorkerRuntime: async () => undefined,
        },
      )
      await manager.initialize()
      await manager.request(ownerId, "/conversations/one/runtime", "PUT")
      names.push(docker.createContainer.mock.calls[0]![0])
    }

    expect(new Set(names)).toHaveProperty("size", 2)
    expect(
      names.every(
        (name) =>
          /^linksense-worker-[0-9a-f]{32}$/u.test(name) && name.length <= 63,
      ),
    ).toBe(true)
  })

  it("does not discard a differently named worker from another controller instance", async () => {
    const storageKey = ownerStorageKey(ownerId, secret)
    const docker = new FakeDocker([
      {
        Id: "foreign-namespaced-worker",
        Names: [`/another-controller-${storageKey}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.contract": workerContractKey(createConfig()),
          "com.linksense.runner.instance": "another-instance",
        },
        State: "running",
      },
    ])
    const manager = createManager(docker, new FakeTransport())

    await manager.initialize()

    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it("discards a same-storage worker whose owner key was derived from a rotated secret", async () => {
    const config = createConfig()
    const oldStorageKey = ownerStorageKey(
      ownerId,
      "runner-old-old-old-old-old-old-old-old",
    )
    const docker = new FakeDocker([
      {
        Id: "worker-before-secret-rotation",
        Names: [`/linksense-worker-${oldStorageKey}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": oldStorageKey,
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.contract": workerContractKey(config),
          "com.linksense.runner.instance": controllerInstanceKey(config),
        },
        State: "running",
      },
    ])
    const manager = createManager(docker, new FakeTransport())

    await manager.initialize()

    expect(docker.stopContainer).toHaveBeenCalledWith(
      "worker-before-secret-rotation",
    )
    expect(docker.removeContainer).toHaveBeenCalledWith(
      "worker-before-secret-rotation",
    )
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it("removes a confirmed stopped worker without replaying and rebuilds on the next request", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    transport.failNextApplicationRequest = true
    docker.containerRunning = false

    await expect(
      manager.request(ownerId, "/conversations/one/runtime", "PUT"),
    ).rejects.toThrow("worker unavailable")
    expect(docker.createContainer).toHaveBeenCalledTimes(1)

    await manager.request(ownerId, "/conversations/one/runtime", "PUT")
    expect(docker.createContainer).toHaveBeenCalledTimes(2)
  })

  it("discards a worker after package sources change without deleting its user runtime", async () => {
    const oldConfig = createConfig({
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
        "https://old-packages.example/pypi/simple/",
    })
    const config = createConfig({
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
        "https://new-packages.example/pypi/simple/",
    })
    const storageKey = ownerStorageKey(ownerId, secret)
    const docker = new FakeDocker([
      {
        Id: "worker-before-package-source-change",
        Names: [`/linksense-worker-${storageKey}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.contract": workerContractKey(oldConfig),
          "com.linksense.runner.instance": controllerInstanceKey(config),
        },
        State: "running",
      },
    ])
    const removeUserDirectories = vi.fn(async () => undefined)
    const manager = new WorkerManager(
      config,
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        removeUserDirectories,
        probeWorkerRuntime: async () => undefined,
      },
    )

    await manager.initialize()

    expect(workerContractKey(config)).not.toBe(workerContractKey(oldConfig))
    expect(docker.stopContainer).toHaveBeenCalledWith(
      "worker-before-package-source-change",
    )
    expect(docker.removeContainer).toHaveBeenCalledWith(
      "worker-before-package-source-change",
    )
    expect(removeUserDirectories).not.toHaveBeenCalled()
  })

  it("discards workers created before the fixed nested runtime mounts", async () => {
    const config = createConfig()
    const storageKey = ownerStorageKey(ownerId, secret)
    const docker = new FakeDocker([
      {
        Id: "worker-before-nested-runtime-mounts",
        Names: [`/linksense-worker-${storageKey}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": ownerId,
          "com.linksense.runner.contract": contractWithoutRuntimeLayout(config),
          "com.linksense.runner.instance": controllerInstanceKey(config),
        },
        State: "running",
      },
    ])
    const manager = createManager(docker, new FakeTransport())

    await manager.initialize()

    expect(WORKER_RUNTIME_LAYOUT).toBe(
      "task-codex-home-task-capability-projections-owner-volume-subpaths",
    )
    expect(workerContractKey(config)).not.toBe(
      contractWithoutRuntimeLayout(config),
    )
    expect(docker.stopContainer).toHaveBeenCalledWith(
      "worker-before-nested-runtime-mounts",
    )
    expect(docker.removeContainer).toHaveBeenCalledWith(
      "worker-before-nested-runtime-mounts",
    )
  })

  it("does not remove a running worker after a transient application transport failure", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const manager = createManager(docker, transport)
    await manager.initialize()
    transport.failNextApplicationRequest = true

    await expect(
      manager.request(ownerId, "/conversations/one/runtime", "PUT"),
    ).rejects.toThrow("worker unavailable")
    await manager.request(ownerId, "/conversations/one/runtime", "PUT")

    expect(docker.inspectContainerRunning).toHaveBeenCalledTimes(1)
    expect(docker.stopContainer).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
    expect(docker.createContainer).toHaveBeenCalledTimes(1)
  })

  it("reports unavailable with no workers when Docker or the worker image is unavailable", async () => {
    const docker = new FakeDocker()
    docker.assertCompatible.mockRejectedValueOnce(new Error("socket unavailable"))
    const manager = createManager(docker, new FakeTransport())

    const health = await manager.health()

    expect(health.statusCode).toBe(503)
    expect(health.body).toMatchObject({ status: "unavailable" })
  })

  it("reports Docker Compose service and worker-pool resource usage without container identities", async () => {
    const config = createConfig()
    const docker = new FakeDocker(
      [
        {
          Id: "worker-container-secret-id",
          Names: ["/linksense-worker-secret-name"],
          Labels: {
            "com.linksense.runner.managed": "true",
            "com.linksense.runner.instance": controllerInstanceKey(config),
          },
          State: "running",
        },
      ],
      [
        {
          Id: "api-container-secret-id",
          Names: ["/linksense-api-secret-name"],
          Labels: {
            "com.docker.compose.project": "linksense",
            "com.docker.compose.service": "api",
          },
          State: "running",
        },
        {
          Id: "other-container-id",
          Names: ["/other-service"],
          Labels: {
            "com.docker.compose.project": "linksense",
            "com.docker.compose.service": "unrelated",
          },
          State: "running",
        },
      ],
    )
    docker.resourceStats.set("api-container-secret-id", {
      readAt: "2026-08-05T08:00:00.000Z",
      cpuPercent: 12.5,
      memoryUsageBytes: 128 * 1024 * 1024,
      memoryLimitBytes: 1024 * 1024 * 1024,
      pidsCurrent: 18,
    })
    docker.resourceStats.set("worker-container-secret-id", {
      readAt: "2026-08-05T08:00:01.000Z",
      cpuPercent: 42,
      memoryUsageBytes: 512 * 1024 * 1024,
      memoryLimitBytes: 2 * 1024 * 1024 * 1024,
      pidsCurrent: 64,
    })
    const manager = new WorkerManager(
      config,
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      { assertUserDataRoot: async () => undefined },
    )

    const readiness = await manager.health({ includeResourceUsage: false })
    expect(readiness.body).not.toHaveProperty("docker_resource_usage")
    expect(docker.inspectContainerResourceStats).not.toHaveBeenCalled()
    const health = await manager.health()
    const cachedHealth = await manager.health()

    expect(docker.listContainersByLabels).toHaveBeenCalledWith([
      "com.docker.compose.project=linksense",
    ])
    expect(docker.listContainersByLabels).toHaveBeenCalledTimes(1)
    expect(docker.inspectContainerResourceStats).toHaveBeenCalledTimes(2)
    expect(health.body.docker_resource_usage).toMatchObject({
      status: "available",
      reason_code: null,
      services: [
        {
          key: "api",
          service_type: "compose",
          status: "available",
          container_count: 1,
          running_container_count: 1,
          cpu_percent: 12.5,
          memory_used_bytes: 128 * 1024 * 1024,
          memory_limit_bytes: 1024 * 1024 * 1024,
          memory_percent: 12.5,
          pids: 18,
          state: "running",
        },
        {
          key: "worker_pool",
          service_type: "worker_pool",
          status: "available",
          container_count: 1,
          running_container_count: 1,
          cpu_percent: 42,
          memory_used_bytes: 512 * 1024 * 1024,
          memory_limit_bytes: 2 * 1024 * 1024 * 1024,
          memory_percent: 25,
          pids: 64,
          state: "running",
        },
      ],
    })
    expect(cachedHealth.body.docker_resource_usage).toEqual(
      health.body.docker_resource_usage,
    )
    const serialized = JSON.stringify(health.body.docker_resource_usage)
    expect(serialized).not.toContain("api-container-secret-id")
    expect(serialized).not.toContain("linksense-worker-secret-name")
    expect(serialized).not.toContain(ownerId)
    expect(serialized).not.toContain("other-container-id")
  })

  it("reports unavailable before the first task when the user data root is unsafe", async () => {
    const docker = new FakeDocker()
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "linksense-controller-root-"),
    )
    const actualRoot = path.join(temporaryRoot, "actual")
    const linkedRoot = path.join(temporaryRoot, "linked")
    await symlink(actualRoot, linkedRoot, "dir")
    const manager = new WorkerManager(
      createConfig({ LINKSENSE_USER_DATA_ROOT: linkedRoot }),
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      { probeWorkerRuntime: async () => undefined },
    )

    try {
      const health = await manager.health()

      expect(health.statusCode).toBe(503)
      expect(docker.inspectNetwork).not.toHaveBeenCalled()
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("refuses an owner directory symlink before creating a worker", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "linksense-controller-owner-"),
    )
    const userDataRoot = path.join(temporaryRoot, "users")
    const outsideRoot = path.join(temporaryRoot, "outside")
    await Promise.all([mkdir(userDataRoot), mkdir(outsideRoot)])
    await symlink(outsideRoot, path.join(userDataRoot, ownerId), "dir")
    const docker = new FakeDocker()
    const manager = new WorkerManager(
      createConfig({ LINKSENSE_USER_DATA_ROOT: userDataRoot }),
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        removeUserDirectories: async () => undefined,
        probeWorkerRuntime: async () => undefined,
      },
    )

    try {
      await manager.initialize()
      await expect(manager.prewarm(ownerId)).rejects.toThrow(
        "user data paths must be real directories",
      )
      expect(docker.createContainer).not.toHaveBeenCalled()
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("probes Codex through a short-lived worker and removes its container and directories", async () => {
    const docker = new FakeDocker()
    const transport = new FakeTransport()
    const modelCatalog: NonNullable<
      Parameters<typeof stateHealth>[0]["modelCatalog"]
    > = {
      models: [
        {
          id: "gpt-test",
          supported_reasoning_efforts: ["low", "medium"],
          default_reasoning_effort: "medium",
        },
      ],
    }
    transport.ready = stateHealth({ modelCatalog })
    const prepareUserDirectories = vi.fn(async (owner: string) => {
      void owner
    })
    const removeUserDirectories = vi.fn(async (owner: string) => {
      void owner
    })
    const manager = new WorkerManager(
      createConfig(),
      docker,
      transport,
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories,
        removeUserDirectories,
      },
    )

    await manager.initialize()

    expect(docker.createContainer).toHaveBeenCalledTimes(1)
    const [containerName, spec] = docker.createContainer.mock.calls[0]!
    const probeOwnerId = prepareUserDirectories.mock.calls[0]?.[0]
    expect(probeOwnerId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(containerName).toMatch(/^linksense-worker-probe-[0-9a-f]{32}$/u)
    expect(containerName).not.toBe(`linksense-worker-probe-${probeOwnerId}`)
    expect(spec.Labels["com.linksense.runner.probe"]).toBe("true")
    expect(spec.HostConfig).toMatchObject({
      ReadonlyRootfs: true,
      Init: true,
      CapDrop: ["ALL"],
      CapAdd: ["SETUID", "KILL", "DAC_OVERRIDE", "FOWNER", "CHOWN"],
      SecurityOpt: ["no-new-privileges:true"],
      Binds: [],
    })
    expect(spec.HostConfig.Memory).toBe(4_096 * 1024 * 1024)
    expect(spec.HostConfig).not.toHaveProperty("Privileged", true)
    expect(spec.HostConfig.MemorySwap).toBe(spec.HostConfig.Memory)
    expect(spec.HostConfig.PidsLimit).toBe(4_096)
    expect(spec.HostConfig.Tmpfs["/tmp"]).toContain("size=4096m")
    expect(spec.HostConfig.Tmpfs["/dev/shm"]).toContain("size=2048m")
    expect(spec.HostConfig.Mounts).toEqual([
      {
        Type: "bind",
        Source: `/srv/linksense/users/${probeOwnerId}/home`,
        Target: "/home/linksense",
        ReadOnly: false,
      },
      {
        Type: "bind",
        Source: `/srv/linksense/users/${probeOwnerId}/managed/agents`,
        Target: "/home/linksense/.agents",
        ReadOnly: true,
      },
      {
        Type: "bind",
        Source: `/srv/linksense/users/${probeOwnerId}/control`,
        Target: "/run/linksense-control",
        ReadOnly: false,
      },
    ])
    expect(transport.calls.map((call) => call.path)).toEqual(["/health/ready"])
    expect(docker.stopContainer).toHaveBeenCalledWith("container-1")
    expect(docker.removeContainer).toHaveBeenCalledWith("container-1")
    expect(removeUserDirectories).toHaveBeenCalledWith(probeOwnerId)
    expect(manager.getModelCatalog()).toEqual(modelCatalog)

    const health = await manager.health()
    expect(health.statusCode).toBe(200)
    expect(health.body).toMatchObject({
      status: "available",
      codex_app_server: {
        status: "available",
        reason_code: null,
        cached: true,
      },
    })
  })

  it("fails immediately when the startup probe container exits before readiness", async () => {
    const docker = new FakeDocker()
    docker.containerRunning = false
    const transport = new FakeTransport()
    transport.readyStatusCode = 503
    const removeUserDirectories = vi.fn(async (owner: string) => {
      void owner
    })
    const manager = new WorkerManager(
      createConfig(),
      docker,
      transport,
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        removeUserDirectories,
      },
    )

    await expect(manager.initialize()).rejects.toThrow(
      "worker container exited before readiness",
    )

    expect(docker.inspectContainerRunning).toHaveBeenCalledOnce()
    expect(docker.removeContainer).toHaveBeenCalledWith("container-1")
    expect(removeUserDirectories).toHaveBeenCalledWith(
      "00000000-0000-7000-8000-000000000000",
    )
  })

  it("does not adopt a stale probe label or delete its non-reserved owner data", async () => {
    const probeOwnerId = "01900000-0000-7000-8000-000000000099"
    const config = createConfig()
    const storageKey = ownerStorageKey(probeOwnerId, secret)
    const docker = new FakeDocker([
      {
        Id: "stale-probe",
        Names: [`/linksense-worker-probe-${probeOwnerId}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": probeOwnerId,
          "com.linksense.runner.contract": workerContractKey(config),
          "com.linksense.runner.instance": controllerInstanceKey(config),
          "com.linksense.runner.probe": "true",
        },
        State: "running",
      },
    ])
    const removeUserDirectories = vi.fn(async (owner: string) => {
      void owner
    })
    const manager = createManager(docker, new FakeTransport(), {
      removeUserDirectories,
    })

    await manager.initialize()

    expect(docker.stopContainer).toHaveBeenCalledWith("stale-probe")
    expect(docker.removeContainer).toHaveBeenCalledWith("stale-probe")
    expect(removeUserDirectories).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it("keeps a foreign startup probe while creating the current instance probe", async () => {
    const config = createConfig()
    const probeOwnerId = "00000000-0000-7000-8000-000000000000"
    const storageKey = ownerStorageKey(probeOwnerId, secret)
    const docker = new FakeDocker([
      {
        Id: "foreign-startup-probe",
        Names: [`/linksense-worker-probe-${probeOwnerId}`],
        Labels: {
          "com.linksense.runner.managed": "true",
          "com.linksense.runner.storage-key": storageKey,
          "com.linksense.runner.owner-id": probeOwnerId,
          "com.linksense.runner.contract": workerContractKey(config),
          "com.linksense.runner.instance": "previous-storage-domain",
          "com.linksense.runner.probe": "true",
        },
        State: "running",
      },
    ])
    const manager = new WorkerManager(
      config,
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        removeUserDirectories: async () => undefined,
      },
    )

    await manager.initialize()

    expect(docker.stopContainer).not.toHaveBeenCalledWith(
      "foreign-startup-probe",
    )
    expect(docker.removeContainer).not.toHaveBeenCalledWith(
      "foreign-startup-probe",
    )
    const [containerName] = docker.createContainer.mock.calls[0]!
    expect(containerName).toMatch(/^linksense-worker-probe-[0-9a-f]{32}$/u)
    expect(containerName).not.toBe(`linksense-worker-probe-${probeOwnerId}`)
    expect(containerName.length).toBeLessThanOrEqual(63)
  })

  it("keeps readiness unavailable when the startup Codex probe fails", async () => {
    const docker = new FakeDocker()
    const probeWorkerRuntime = vi.fn(async () => {
      throw new Error("Codex initialize failed")
    })
    const manager = createManager(docker, new FakeTransport(), {
      probeWorkerRuntime,
    })

    await expect(manager.initialize()).rejects.toThrow("Codex initialize failed")
    const health = await manager.health()

    expect(probeWorkerRuntime).toHaveBeenCalledTimes(1)
    expect(health.statusCode).toBe(503)
    expect(health.body).toMatchObject({
      status: "unavailable",
      codex_app_server: {
        status: "unavailable",
        reason_code: "CODEX_APP_SERVER_HANDSHAKE_FAILED",
        cached: false,
      },
    })
  })

  it("does not report the cached startup probe as available when infrastructure is lost", async () => {
    const docker = new FakeDocker()
    const manager = createManager(docker, new FakeTransport())
    await manager.initialize()
    docker.inspectImage.mockRejectedValueOnce(new Error("image unavailable"))

    const health = await manager.health()

    expect(health.statusCode).toBe(503)
    expect(health.body).toMatchObject({
      codex_app_server: {
        status: "unavailable",
        reason_code: "CODEX_APP_SERVER_HANDSHAKE_FAILED",
        cached: false,
      },
    })
  })

  it("fails before the startup probe when the configured managed volume is unavailable", async () => {
    const docker = new FakeDocker()
    docker.inspectVolume.mockRejectedValueOnce(new Error("volume unavailable"))
    const manager = new WorkerManager(
      createConfig({ LINKSENSE_USER_DATA_VOLUME: "linksense-user-data" }),
      docker,
      new FakeTransport(),
      pino({ level: "silent" }),
      {
        assertUserDataRoot: async () => undefined,
        repairExistingUserDirectories: async () => undefined,
        probeWorkerRuntime: async () => undefined,
      },
    )

    await expect(manager.initialize()).rejects.toThrow("volume unavailable")

    expect(docker.inspectVolume).toHaveBeenCalledWith("linksense-user-data")
    expect(docker.createContainer).not.toHaveBeenCalled()
  })
})

describe("dynamic worker container contract", () => {
  it("rejects a non-UUID owner before resolving any storage path", () => {
    const config = createConfig()

    expect(() =>
      buildWorkerContainerSpec(config, "../other-user", "storage-key"),
    ).toThrow()
  })

  it("keeps owner-scoped bind mounts when no managed volume is configured", () => {
    const config = createConfig()
    const storageKey = ownerStorageKey(ownerId, secret)
    const spec = buildWorkerContainerSpec(
      config,
      ownerId,
      storageKey,
      undefined,
      {
        LINK_SENSE_API_KEY: "provider-key",
        HTTPS_PROXY: "http://proxy.internal",
        DATABASE_URL: "postgresql://forbidden",
        MINIO_SECRET_KEY: "forbidden",
      },
    )

    expect(spec.User).toBe("0:1000")
    expect(spec.HostConfig).toMatchObject({
      ReadonlyRootfs: true,
      Init: true,
      CapDrop: ["ALL"],
      CapAdd: ["SETUID", "KILL", "DAC_OVERRIDE", "FOWNER", "CHOWN"],
      SecurityOpt: ["no-new-privileges:true"],
      Binds: [],
    })
    expect(spec.HostConfig).not.toHaveProperty("Privileged", true)
    expect(spec.HostConfig.Mounts).toEqual([
      {
        Type: "bind",
        Source: `/srv/linksense/users/${ownerId}/home`,
        Target: "/home/linksense",
        ReadOnly: false,
      },
      {
        Type: "bind",
        Source: `/srv/linksense/users/${ownerId}/managed/agents`,
        Target: "/home/linksense/.agents",
        ReadOnly: true,
      },
      {
        Type: "bind",
        Source: `/srv/linksense/users/${ownerId}/control`,
        Target: "/run/linksense-control",
        ReadOnly: false,
      },
    ])
    expect(spec.Env).toContain("HOME=/home/linksense")
    expect(spec.Env).toContain("UV_THREADPOOL_SIZE=32")
    expect(spec.Env).toContain("CODEX_HOME=/run/linksense-control/supervisor-codex")
    expect(spec.Env).toContain("LINKSENSE_USER_DATA_ROOT=/home/linksense")
    expect(spec.Env).not.toContain("LINK_SENSE_API_KEY=provider-key")
    expect(spec.Env).toContain("HTTPS_PROXY=http://proxy.internal")
    expect(spec.Env.join("\n")).not.toContain("DATABASE_URL")
    expect(spec.Env.join("\n")).not.toContain("MINIO_SECRET_KEY")
    expect(spec.Env.join("\n")).not.toContain(secret)
    expect(spec.Env).toContain(
      `LINKSENSE_RUNNER_SHARED_SECRET=${ownerWorkerSecret(ownerId, secret)}`,
    )
    expect(spec.Env).toContain(
      "LINKSENSE_CODEX_HOME_TEMPLATE=/opt/linksense/codex-home-template",
    )
    expect(spec.Env).toContain("LINKSENSE_PNPM_VERSION=10.6.4")
    expect(spec.Env).toContain("LINKSENSE_BROWSER_SESSION_LIMIT=2")
    expect(spec.Env).toContain("LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS=200000")
    expect(spec.HostConfig.Tmpfs["/tmp"]).toBe(
      "rw,nosuid,nodev,noexec,size=4096m,uid=1000,gid=1000,mode=1777",
    )
    expect(spec.HostConfig.Tmpfs["/dev/shm"]).toBe(
      "rw,nosuid,nodev,noexec,size=2048m,uid=0,gid=0,mode=1777",
    )
    expect(spec.HostConfig.PidsLimit).toBe(4_096)
    expect(spec.Env).toContain(
      "LINKSENSE_PYTHON_PACKAGE_INDEX_URL=https://pypi.org/simple/",
    )
    expect(spec.Env).toContain(
      "LINKSENSE_NODE_PACKAGE_REGISTRY_URL=https://registry.npmjs.org/",
    )
    expect(spec.Labels["com.linksense.runner.contract"]).toBe(
      workerContractKey(config),
    )
    const rotatedSecretConfig = {
      ...config,
      LINKSENSE_RUNNER_SHARED_SECRET:
        "runner-rotated-555555555555555555555555",
    }
    expect(controllerInstanceKey(config)).toBe(
      controllerInstanceKey(rotatedSecretConfig),
    )
    expect(controllerInstanceKey(config)).not.toBe(
      controllerInstanceKey({
        ...config,
        LINKSENSE_USER_DATA_ROOT: "/srv/linksense/other-users",
      }),
    )
    expect(controllerInstanceKey(config)).not.toBe(
      controllerInstanceKey({
        ...config,
        LINKSENSE_USER_DATA_VOLUME: "linksense-user-data-next",
      }),
    )
    expect(workerContractKey(config)).not.toBe(
      workerContractKey({
        ...config,
        LINKSENSE_NODE_PACKAGE_REGISTRY_URL:
          "https://packages.example/npm/",
      }),
    )
    expect(workerContractKey(config)).not.toBe(
      workerContractKey({
        ...config,
        LINKSENSE_WORKER_IMAGE_REVISION: "sha256:new-worker-image",
      }),
    )
    expect(workerContractKey(config)).not.toBe(
      workerContractKey({
        ...config,
        LINKSENSE_WORKER_PIDS_LIMIT: 2_048,
      }),
    )
    expect(workerContractKey(config)).not.toBe(
      workerContractKey({
        ...config,
        LINKSENSE_WORKER_SHM_MB: 1_024,
      }),
    )
    expect(workerContractKey(config)).not.toBe(
      workerContractKey({
        ...config,
        LINKSENSE_BROWSER_SESSION_LIMIT: 4,
      }),
    )
    expect(workerContractKey(config)).not.toBe(
      workerContractKey({
        ...config,
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: 210_000,
      }),
    )
  })

  it("mounts only owner-scoped subpaths from the configured managed volume", () => {
    const config = createConfig({
      LINKSENSE_USER_DATA_VOLUME: "linksense-user-data",
    })
    const spec = buildWorkerContainerSpec(
      config,
      ownerId,
      ownerStorageKey(ownerId, secret),
    )

    expect(spec.HostConfig.Mounts).toEqual([
      {
        Type: "volume",
        Source: "linksense-user-data",
        Target: "/home/linksense",
        ReadOnly: false,
        VolumeOptions: { NoCopy: true, Subpath: `${ownerId}/home` },
      },
      {
        Type: "volume",
        Source: "linksense-user-data",
        Target: "/home/linksense/.agents",
        ReadOnly: true,
        VolumeOptions: {
          NoCopy: true,
          Subpath: `${ownerId}/managed/agents`,
        },
      },
      {
        Type: "volume",
        Source: "linksense-user-data",
        Target: "/run/linksense-control",
        ReadOnly: false,
        VolumeOptions: { NoCopy: true, Subpath: `${ownerId}/control` },
      },
    ])
    expect(
      spec.HostConfig.Mounts.every(
        (mount) =>
          mount.Type === "volume" &&
          mount.VolumeOptions?.NoCopy === true &&
          mount.VolumeOptions?.Subpath?.startsWith(`${ownerId}/`),
      ),
    ).toBe(true)
    expect(controllerInstanceKey(config)).not.toBe(
      controllerInstanceKey(createConfig()),
    )
    expect(controllerInstanceKey(config)).not.toBe(
      controllerInstanceKey({
        ...config,
        LINKSENSE_USER_DATA_VOLUME: "linksense-user-data-next",
      }),
    )
    expect(controllerInstanceKey(config)).toBe(
      controllerInstanceKey({
        ...config,
        LINKSENSE_USER_DATA_ROOT: "/srv/linksense/relocated-mountpoint",
      }),
    )
  })
})

class FakeDocker implements DockerEngine {
  readonly assertCompatible = vi.fn(async () => undefined)
  readonly inspectImage = vi.fn(async () => undefined)
  readonly inspectNetwork = vi.fn(async () => undefined)
  readonly inspectVolume = vi.fn(async () => undefined)
  readonly listManagedContainers = vi.fn(async () => this.containers)
  readonly listContainersByLabels = vi.fn(async (labels: string[]) =>
    labels.includes("com.docker.compose.project=linksense")
      ? this.composeContainers
      : [],
  )
  readonly inspectContainerRunning = vi.fn(async () => this.containerRunning)
  readonly inspectContainerResourceStats = vi.fn(async (id: string) => {
    const stats = this.resourceStats.get(id)
    if (!stats) throw new Error("missing resource stats")
    return stats
  })
  readonly createContainer = vi.fn(
    async (name: string, body: DockerContainerCreate) => {
      void name
      void body
      return `container-${this.createContainer.mock.calls.length}`
    },
  )
  readonly startContainer = vi.fn(async () => undefined)
  readonly stopContainer = vi.fn(async () => undefined)
  readonly removeContainer = vi.fn(async () => undefined)
  containerRunning = true
  readonly resourceStats = new Map<string, DockerContainerResourceStats>()

  constructor(
    private readonly containers: DockerContainerSummary[] = [],
    private readonly composeContainers: DockerContainerSummary[] = [],
  ) {}
}

class FakeTransport implements WorkerTransport {
  readonly calls: Array<{
    path: string
    headers: Record<string, string>
  }> = []
  state: unknown = stateHealth({})
  ready: unknown = stateHealth({})
  readyStatusCode = 200
  failNextApplicationRequest = false
  failNextStateRequest = false
  nextStateRequestStarted: (() => void) | undefined
  nextStateRequestGate: Promise<void> | undefined
  nextApplicationRequestStarted: (() => void) | undefined
  nextApplicationRequestGate: Promise<void> | undefined

  async request(
    _baseUrl: string,
    path: string,
    _method: string,
    headers: Record<string, string>,
  ): Promise<WorkerHttpResponse> {
    this.calls.push({ path, headers })
    if (path === "/health/state") {
      if (this.failNextStateRequest) {
        this.failNextStateRequest = false
        throw new Error("state unavailable")
      }
      this.nextStateRequestStarted?.()
      this.nextStateRequestStarted = undefined
      const stateGate = this.nextStateRequestGate
      this.nextStateRequestGate = undefined
      await stateGate
      return jsonResponse(this.state)
    }
    if (path === "/health/ready") {
      return jsonResponse(this.ready, this.readyStatusCode)
    }
    if (this.failNextApplicationRequest) {
      this.failNextApplicationRequest = false
      throw new Error("worker unavailable")
    }
    this.nextApplicationRequestStarted?.()
    this.nextApplicationRequestStarted = undefined
    const applicationGate = this.nextApplicationRequestGate
    this.nextApplicationRequestGate = undefined
    await applicationGate
    return jsonResponse({ success: true })
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createManager(
  docker: FakeDocker,
  transport: FakeTransport,
  options: {
    assertUserDataRoot?: () => Promise<void>
    prepareUserDirectories?: (ownerId: string) => Promise<void>
    assertManagedProjection?: (ownerId: string) => Promise<void>
    repairExistingUserDirectories?: () => Promise<void>
    removeUserDirectories?: (ownerId: string) => Promise<void>
    probeWorkerRuntime?: () => Promise<void>
  } = {},
) {
  return new WorkerManager(
    createConfig(),
    docker,
    transport,
    pino({ level: "silent" }),
    {
      assertUserDataRoot: async () => undefined,
      prepareUserDirectories: async () => undefined,
      removeUserDirectories: async () => undefined,
      probeWorkerRuntime: async () => undefined,
      ...options,
    },
  )
}

function createConfig(overrides: NodeJS.ProcessEnv = {}) {
  return parseRunnerConfig({
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_USER_DATA_ROOT: "/srv/linksense/users",
    LINKSENSE_RUNNER_SHARED_SECRET: secret,
    LINKSENSE_API_INTERNAL_URL: "http://api:4000",
    LINKSENSE_WORKER_IDLE_TTL_SECONDS: "1",
    ...overrides,
  })
}

function contractWithoutRuntimeLayout(
  config: ReturnType<typeof createConfig>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "linksense-runner-worker-contract",
        config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
        config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
        config.LINKSENSE_WORKER_IMAGE_REVISION,
        config.LINKSENSE_WORKER_PIDS_LIMIT,
        config.LINKSENSE_WORKER_SHM_MB,
        config.LINKSENSE_BROWSER_SESSION_LIMIT,
        config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
      ]),
    )
    .digest("hex")
    .slice(0, 32)
}

function stateHealth(
  options: {
    runningTurns?: number
    appServerProcesses?: number
    modelCatalog?: {
      models: Array<{
        id: string
        supported_reasoning_efforts: Array<"low" | "medium">
        default_reasoning_effort: "low" | "medium"
      }>
    }
  },
) {
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
    running_turns: options.runningTurns ?? 0,
    app_server_processes:
      options.appServerProcesses ?? options.runningTurns ?? 0,
    ...(options.modelCatalog ? { model_catalog: options.modelCatalog } : {}),
  }
}

function jsonResponse(body: unknown, statusCode = 200): WorkerHttpResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(body)),
  }
}
