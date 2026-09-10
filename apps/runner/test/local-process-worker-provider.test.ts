import { EventEmitter } from "node:events"
import { lstat, mkdir, mkdtemp, readlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import pino from "pino"
import { afterEach, describe, expect, it, vi } from "vitest"

import { parseRunnerConfig } from "../src/config.js"
import { LocalProcessWorkerProvider } from "../src/controller/local-process-worker-provider.js"
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js"

const ownerId = "01900000-0000-7000-8000-000000000002"
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  )
})

describe("LocalProcessWorkerProvider", () => {
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

function fakeChild(pid: number) {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    killed: false,
    pid,
    signalCode: null,
    kill: vi.fn(() => true),
  })
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
