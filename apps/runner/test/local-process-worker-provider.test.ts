import { EventEmitter } from "node:events"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import pino from "pino"
import { afterEach, describe, expect, it, vi } from "vitest"

import { parseRunnerConfig } from "../src/config.js"
import {
  LocalProcessWorkerProvider,
  type LocalWorkerProcess,
  type LocalProcessWorkerProviderOptions,
} from "../src/controller/local-process-worker-provider.js"
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js"
import { WorkerManager } from "../src/controller/worker-manager.js"
import { TURN_START_CONTRACT_VERSION } from "../src/turn-start-contract.js"
import type { WorkerTransport } from "../src/controller/worker-http-client.js"

const ownerId = "01900000-0000-7000-8000-000000000002"
const temporaryRoots: string[] = []
const temporaryProcessIds = new Set<number>()

afterEach(async () => {
  for (const pid of temporaryProcessIds) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // The provider already cleaned up the process.
    }
  }
  temporaryProcessIds.clear()
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  )
})

describe("LocalProcessWorkerProvider", () => {
  it.each([
    ["request", "request"],
    ["readiness", "request"],
    ["request", "sweep"],
    ["shutdown", "shutdown"],
    ["request", "conversation-cleanup"],
  ])(
    "recovers through the controller after %s cleanup failure using %s",
    async (failurePath, recoveryPath) => {
      const paths = await createOwnerPaths()
      const child = fakeChild(41005)
      const replacement = fakeChild(41006)
      const spawnWorker = vi.fn().mockReturnValueOnce(child).mockReturnValueOnce(replacement)
      const terminateWorker = vi.fn()
        .mockRejectedValueOnce(new Error("cleanup unavailable"))
        .mockRejectedValueOnce(new Error("cleanup unavailable"))
        .mockResolvedValue(undefined)
      const config = createConfig(paths.root)
      const provider = new LocalProcessWorkerProvider(config, pino({ level: "silent" }), {
        allocatePort: async () => 45129,
        runnerEntry: "/repo/apps/runner/src/index.ts",
        spawnWorker,
        terminateWorker,
      })
      let failReadiness = failurePath === "readiness"
      let failRequest = failurePath === "request"
      const request = vi.fn<WorkerTransport["request"]>(async (_endpoint, requestPath) => {
        if ((failReadiness && requestPath === "/health/state") || (failRequest && !requestPath.startsWith("/health/"))) {
          failReadiness = false
          failRequest = false
          child.exitCode = 1
          child.emit("exit", 1, null)
          throw new Error("worker unavailable")
        }
        return {
          statusCode: 200,
          headers: {},
          body: Buffer.from(JSON.stringify(requestPath.startsWith("/health/") ? {
            turn_start_contract_version: TURN_START_CONTRACT_VERSION,
            status: "available",
            checked_at: "2026-09-14T00:00:00.000Z",
            workspace: { status: "available", reason_code: null, checked_at: "2026-09-14T00:00:00.000Z" },
            codex_home: { status: "available", reason_code: null, checked_at: "2026-09-14T00:00:00.000Z" },
            running_turns: 0,
            app_server_processes: 0,
          } : { success: true })),
        }
      })
      const manager = new WorkerManager(config, provider, { request }, pino({ level: "silent" }), {
        assertUserDataRoot: async () => undefined,
        prepareUserDirectories: async () => undefined,
        probeWorkerRuntime: async () => undefined,
      })
      await manager.initialize()

      if (failurePath === "shutdown") {
        await manager.prewarm(ownerId)
        await expect(manager.stopAllWorkers()).rejects.toThrow("worker cleanup failed")
      } else {
        await expect(manager.request(ownerId, "/task", "POST")).rejects.toThrow()
      }
      const callsAfterFailure = request.mock.calls.length
      await expect(provider.hasWorkerForOwner(ownerId)).resolves.toBe(true)
      const retry = recoveryPath === "conversation-cleanup"
        ? manager.cleanupConversation(ownerId, "01900000-0000-7000-8000-000000000011")
        : manager.request(ownerId, "/task", "POST")
      await expect(retry).rejects.toThrow("cleanup unavailable")
      expect(request).toHaveBeenCalledTimes(callsAfterFailure)
      expect(spawnWorker).toHaveBeenCalledOnce()

      if (recoveryPath === "sweep") await manager.sweepIdleWorkers()
      if (recoveryPath === "shutdown") await manager.stopAllWorkers()
      await expect(manager.request(ownerId, "/task", "POST")).resolves.toMatchObject({ statusCode: 200 })
      expect(spawnWorker).toHaveBeenCalledTimes(2)
      expect(terminateWorker).toHaveBeenCalledTimes(3)
      expect(request.mock.calls.filter(([, requestPath]) => requestPath === "/task"))
        .toHaveLength(failurePath === "request" ? 2 : 1)
      await manager.shutdown(true)
      await expect(provider.hasWorkerForOwner(ownerId)).resolves.toBe(false)
    },
  )

  it("launches a complete worker child on loopback with a sanitized environment", async () => {
    const paths = await createOwnerPaths()
    const child = fakeChild(41001)
    const spawnWorker = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: {
          cwd: string
          detached: boolean
          env: NodeJS.ProcessEnv
          shell: false
          stdio: ["ignore", "inherit", "inherit", "ipc"]
        },
      ) => {
        void _command
        void _args
        void _options
        return child
      },
    )
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
      {
        allocatePort: async () => 45123,
        processEnvironment: {
          PATH: "/usr/bin",
          DATABASE_URL: "postgresql://must-not-leak",
        },
        runnerEntry: "/repo/apps/runner/src/index.ts",
        spawnWorker,
        terminateWorker: async () => undefined,
      },
    )

    await provider.initialize()
    const runtimeToolBin = path.join(
      paths.root,
      ".local-process-runtime-tools",
      "bin",
    )
    await provider.prepareOwnerFilesystem(paths)
    const worker = await provider.acquire({
      ownerId,
      storageKey: "owner-storage-key",
      name: "linksense-worker-local",
      probe: false,
    })

    expect(worker).toMatchObject({
      endpoint: "http://127.0.0.1:45123",
      ownerId,
      state: "running",
    })
    expect(spawnWorker).toHaveBeenCalledWith(
      process.execPath,
      [...process.execArgv, "/repo/apps/runner/src/index.ts"],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: expect.objectContaining({
          HOME: paths.home,
          LINKSENSE_RUNNER_HOST: "127.0.0.1",
          LINKSENSE_RUNNER_MODE: "worker",
          LINKSENSE_WORKER_PROVIDER: "local-process",
          LINKSENSE_WORKER_CONTROL_ROOT: paths.control,
          LINKSENSE_RUNTIME_TOOL_BIN: runtimeToolBin,
          LINKSENSE_MANAGED_BROWSER_ENABLED: "false",
          CODEX_HOME: path.join(paths.control, "supervisor-codex"),
        }),
      }),
    )
    expect(spawnWorker.mock.calls[0]?.[2].env).not.toHaveProperty(
      "DATABASE_URL",
    )
    expect(await readlink(paths.homeAgentsMountpoint)).toBe(
      path.relative(path.dirname(paths.homeAgentsMountpoint), paths.managedAgents),
    )
    expect(
      (await lstat(path.join(runtimeToolBin, "linksense-plugin-stdio"))).mode &
        0o777,
    ).toBe(0o700)
  })

  it("releases a child process exactly once", async () => {
    const paths = await createOwnerPaths()
    const child = fakeChild(41002)
    const terminateWorker = vi.fn(async () => undefined)
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
      {
        allocatePort: async () => 45124,
        runnerEntry: "/repo/apps/runner/src/index.ts",
        spawnWorker: () => child,
        terminateWorker,
      },
    )
    await provider.initialize()
    await provider.prepareOwnerFilesystem(paths)
    const worker = await provider.acquire({
      ownerId,
      storageKey: "owner-storage-key",
      name: "linksense-worker-local",
      probe: false,
    })

    await Promise.all([provider.release(worker), provider.release(worker)])

    expect(terminateWorker).toHaveBeenCalledOnce()
    await expect(provider.inspect(worker)).resolves.toBe("stopped")
  })

  it("releases a surviving descendant after the local worker leader exits", async () => {
    const paths = await createOwnerPaths()
    const descendantPidFile = path.join(paths.root, "descendant.pid")
    const runnerEntry = path.join(paths.root, "crashed-worker.cjs")
    await writeFile(
      runnerEntry,
      [
        'const { spawn } = require("node:child_process")',
        'const { writeFileSync } = require("node:fs")',
        'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], { stdio: "ignore" })',
        `writeFileSync(${JSON.stringify(descendantPidFile)}, String(child.pid))`,
        "process.exit(1)",
      ].join("\n"),
    )
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
      {
        allocatePort: async () => 45126,
        runnerEntry,
      },
    )
    await provider.initialize()
    await provider.prepareOwnerFilesystem(paths)
    const worker = await provider.acquire({
      ownerId,
      storageKey: "owner-storage-key",
      name: "linksense-worker-local",
      probe: false,
    })
    await waitUntil(async () => (await provider.inspect(worker)) === "stopped")
    const descendantPid = Number(await readFile(descendantPidFile, "utf8"))
    temporaryProcessIds.add(descendantPid)
    expect(isProcessAlive(descendantPid)).toBe(true)

    await provider.release(worker)

    await waitUntil(() => !isProcessAlive(descendantPid))
    temporaryProcessIds.delete(descendantPid)
    await expect(provider.hasWorkerForOwner(ownerId)).resolves.toBe(false)
  })

  it("retains a local worker for retry when process-group cleanup fails", async () => {
    const paths = await createOwnerPaths()
    const child = fakeChild(41003)
    const terminateWorker = vi
      .fn<NonNullable<LocalProcessWorkerProviderOptions["terminateWorker"]>>()
      .mockRejectedValueOnce(new Error("process group is still alive"))
      .mockResolvedValueOnce(undefined)
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
      {
        allocatePort: async () => 45127,
        runnerEntry: "/repo/apps/runner/src/index.ts",
        spawnWorker: () => child,
        terminateWorker,
      },
    )
    await provider.initialize()
    await provider.prepareOwnerFilesystem(paths)
    const worker = await provider.acquire({
      ownerId,
      storageKey: "owner-storage-key",
      name: "linksense-worker-local",
      probe: false,
    })

    await expect(provider.release(worker)).rejects.toThrow(
      "process group is still alive",
    )
    await expect(provider.hasWorkerForOwner(ownerId)).resolves.toBe(true)
    await expect(
      provider.acquire({
        ownerId,
        storageKey: "replacement-storage-key",
        name: "linksense-worker-local-replacement",
        probe: false,
      }),
    ).rejects.toThrow("cleanup must complete before replacement")

    await provider.release(worker)

    expect(terminateWorker).toHaveBeenCalledTimes(2)
    await expect(provider.hasWorkerForOwner(ownerId)).resolves.toBe(false)
  })

  it("does not signal a missing-PID spawn and handles its asynchronous error before retry", async () => {
    const paths = await createOwnerPaths()
    const child = fakeChild(undefined)
    const spawnWorker = vi.fn().mockReturnValueOnce(child).mockReturnValueOnce(fakeChild(41004))
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
      {
        allocatePort: async () => 45128,
        runnerEntry: "/repo/apps/runner/src/index.ts",
        spawnWorker,
        terminateWorker: async () => undefined,
      },
    )
    await provider.initialize()
    await provider.prepareOwnerFilesystem(paths)
    const input = { ownerId, storageKey: "owner-storage-key", name: "local-worker", probe: false }

    await expect(provider.acquire(input)).rejects.toThrow("process group ID")

    expect(child.kill).not.toHaveBeenCalled()
    await expect(new Promise<void>((resolveError, rejectError) => {
      setImmediate(() => {
        try {
          child.emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" }))
          resolveError()
        } catch (error) {
          rejectError(error)
        }
      })
    })).resolves.toBeUndefined()
    await expect(provider.hasWorkerForOwner(ownerId)).resolves.toBe(false)
    const worker = await provider.acquire(input)
    await expect(provider.inspect(worker)).resolves.toBe("running")
    await provider.release(worker)
  })

  it("fails closed when the child cannot be spawned", async () => {
    const paths = await createOwnerPaths()
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
      {
        allocatePort: async () => 45125,
        runnerEntry: "/repo/apps/runner/src/index.ts",
        spawnWorker: () => {
          throw new Error("spawn failed")
        },
      },
    )
    await provider.initialize()
    await provider.prepareOwnerFilesystem(paths)

    await expect(
      provider.acquire({
        ownerId,
        storageKey: "owner-storage-key",
        name: "linksense-worker-local",
        probe: false,
      }),
    ).rejects.toThrow("spawn failed")
    await expect(provider.discover()).resolves.toEqual([])
  })

  it("refuses to replace a non-empty managed-agent mountpoint", async () => {
    const paths = await createOwnerPaths()
    await mkdir(path.join(paths.homeAgentsMountpoint, "unexpected"))
    const provider = new LocalProcessWorkerProvider(
      createConfig(paths.root),
      pino({ level: "silent" }),
    )

    await expect(provider.prepareOwnerFilesystem(paths)).rejects.toThrow(
      "managed agents mountpoint must be an empty directory",
    )
    await expect(lstat(paths.homeAgentsMountpoint)).resolves.toMatchObject({})
  })
})

function fakeChild(pid: number | undefined) {
  const state: Pick<LocalWorkerProcess, "pid" | "exitCode" | "signalCode"> = {
    pid,
    exitCode: null,
    signalCode: null,
  }
  return Object.assign(new EventEmitter(), {
    ...state,
    killed: false,
    kill: vi.fn(() => true),
  })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error("condition was not met before timeout")
}

async function createOwnerPaths(): Promise<WorkerOwnerPaths> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-local-worker-"))
  temporaryRoots.push(root)
  const owner = path.join(root, ownerId)
  const home = path.join(owner, "home")
  const managed = path.join(owner, "managed")
  const managedAgents = path.join(managed, "agents")
  const control = path.join(owner, "control")
  const workspaces = path.join(home, "workspaces")
  const paths = {
    root,
    owner,
    home,
    homeAgentsMountpoint: path.join(home, ".agents"),
    taskHomes: path.join(home, "task-homes"),
    managed,
    managedAgents,
    managedSkills: path.join(managedAgents, "skills"),
    managedPluginSources: path.join(managedAgents, "plugin-sources"),
    managedPlugins: path.join(managedAgents, "plugins"),
    control,
    workspaces,
  } satisfies WorkerOwnerPaths
  await Promise.all([
    mkdir(paths.homeAgentsMountpoint, { recursive: true }),
    mkdir(paths.taskHomes, { recursive: true }),
    mkdir(paths.managedSkills, { recursive: true }),
    mkdir(paths.managedPluginSources, { recursive: true }),
    mkdir(paths.managedPlugins, { recursive: true }),
    mkdir(paths.control, { recursive: true }),
    mkdir(paths.workspaces, { recursive: true }),
  ])
  return paths
}

function createConfig(userDataRoot: string) {
  return parseRunnerConfig({
    NODE_ENV: "development",
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_RUNNER_HOST: "127.0.0.1",
    LINKSENSE_WORKER_PROVIDER: "local-process",
    LINKSENSE_USER_DATA_ROOT: userDataRoot,
    LINKSENSE_RUNNER_SHARED_SECRET:
      "runner-555555555555555555555555555555",
    LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000",
    LINKSENSE_CONTROLLER_INTERNAL_URL: "http://127.0.0.1:4010",
  })
}
