import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
} from "node:fs"
import { mkdir } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Logger } from "pino"

import type { RunnerConfig } from "../config.js"
import { ownerWorkerSecret } from "./storage-key.js"
import type {
  WorkerAcquireInput,
  WorkerInstance,
  WorkerOwnerPaths,
  WorkerProvider,
  WorkerProviderCapabilities,
} from "./worker-provider.js"
import { isNodeError } from "./worker-provider-utils.js"
import {
  prepareLocalProcessRuntimeTools,
  resolvePersonalStdioLauncher,
} from "./local-process-runtime-tools.js"

export interface LocalWorkerProcess {
  exitCode: number | null
  pid?: number | undefined
  signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: "error", listener: (error: Error) => void): this
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this
}

export type LocalProcessWorkerProviderOptions = {
  allocatePort?: () => Promise<number>
  processEnvironment?: NodeJS.ProcessEnv
  runnerEntry?: string
  spawnWorker?: (
    command: string,
    args: readonly string[],
    options: {
      cwd: string
      detached: boolean
      env: NodeJS.ProcessEnv
      shell: false
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    },
  ) => LocalWorkerProcess
  terminateWorker?: (child: LocalWorkerProcess) => Promise<void>
}

type ManagedLocalProcess = {
  child: LocalWorkerProcess
  error: Error | undefined
  worker: WorkerInstance
}

export class LocalProcessWorkerProvider implements WorkerProvider {
  readonly kind = "local-process" as const
  readonly capabilities: WorkerProviderCapabilities

  private readonly preparedPaths = new Map<string, WorkerOwnerPaths>()
  private readonly processes = new Map<string, ManagedLocalProcess>()
  private readonly releases = new Map<string, Promise<void>>()
  private initialized = false
  private readonly allocatePort: () => Promise<number>
  private readonly processEnvironment: NodeJS.ProcessEnv
  private readonly runnerEntry: string
  private readonly spawnWorker: NonNullable<
    LocalProcessWorkerProviderOptions["spawnWorker"]
  >
  private readonly terminateWorker: NonNullable<
    LocalProcessWorkerProviderOptions["terminateWorker"]
  >
  private readonly runtimeToolRoot: string
  private runtimeToolBin: string | undefined

  constructor(
    private readonly config: RunnerConfig,
    private readonly logger: Logger,
    options: LocalProcessWorkerProviderOptions = {},
  ) {
    const uid = process.getuid?.()
    const gid = process.getgid?.()
    this.capabilities = {
      isolation: "none",
      persistentWorkers: false,
      workspaceIdentity: {
        apiUid: uid ?? -1,
        taskUid: uid ?? -1,
        sharedGid: gid ?? -1,
      },
    }
    this.allocatePort = options.allocatePort ?? allocateLoopbackPort
    this.processEnvironment = options.processEnvironment ?? process.env
    this.runnerEntry = options.runnerEntry ?? resolveRunnerEntry(import.meta.url)
    this.spawnWorker = options.spawnWorker ?? spawnLocalWorker
    this.terminateWorker = options.terminateWorker ?? terminateLocalWorker
    this.runtimeToolRoot = path.join(
      config.LINKSENSE_USER_DATA_ROOT,
      ".local-process-runtime-tools",
    )
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (
      this.config.NODE_ENV !== "development" ||
      this.config.LINKSENSE_WORKER_PROVIDER !== "local-process"
    ) {
      throw new Error(
        "local-process workers are restricted to explicit development configuration",
      )
    }
    if (
      this.capabilities.workspaceIdentity.apiUid < 1 ||
      this.capabilities.workspaceIdentity.sharedGid < 1
    ) {
      throw new Error("local-process workers require a POSIX user identity")
    }
    await mkdir(this.config.LINKSENSE_USER_DATA_ROOT, {
      recursive: true,
      mode: 0o700,
    })
    this.runtimeToolBin = await prepareLocalProcessRuntimeTools({
      root: this.runtimeToolRoot,
      launcherCommand: process.execPath,
      launcherArgs: [
        ...process.execArgv,
        resolvePersonalStdioLauncher(import.meta.url),
      ],
    })
    this.logger.warn(
      { provider: this.kind, isolation: this.capabilities.isolation },
      "local-process workers are not isolated and must only run trusted development workloads",
    )
    this.initialized = true
  }

  async discover(): Promise<WorkerInstance[]> {
    // Host child processes intentionally die with their controller and are not
    // adopted across restarts. A fresh process is safer than trusting a PID.
    return []
  }

  async prepareOwnerFilesystem(paths: WorkerOwnerPaths): Promise<void> {
    prepareManagedAgentsLink(paths)
    this.preparedPaths.set(paths.owner, paths)
  }

  async acquire(input: WorkerAcquireInput): Promise<WorkerInstance> {
    const paths = this.preparedPaths.get(
      path.join(this.config.LINKSENSE_USER_DATA_ROOT, input.ownerId),
    )
    if (!paths) {
      throw new Error("local-process worker filesystem was not prepared")
    }
    const port = await this.allocatePort()
    const id = randomUUID()
    const worker: WorkerInstance = {
      id,
      name: input.name,
      endpoint: `http://127.0.0.1:${port}`,
      storageKey: input.storageKey,
      ownerId: input.ownerId,
      state: "running",
    }
    const child = this.spawnWorker(
      process.execPath,
      [...process.execArgv, this.runnerEntry],
      {
        cwd: repositoryRoot(import.meta.url),
        detached: true,
        env: localWorkerEnvironment(
          this.config,
          input.ownerId,
          port,
          paths,
          this.processEnvironment,
          this.requiredRuntimeToolBin(),
        ),
        shell: false,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    )
    const managed: ManagedLocalProcess = {
      child,
      error: undefined,
      worker,
    }
    child.once("error", (error) => {
      managed.error = error
      managed.worker.state = "failed"
    })
    child.once("exit", () => {
      if (!managed.error) managed.worker.state = "stopped"
    })
    this.processes.set(worker.id, managed)
    return worker
  }

  async resume(): Promise<WorkerInstance> {
    throw new Error("local-process workers cannot be adopted or resumed")
  }

  async inspect(worker: WorkerInstance) {
    const managed = this.processes.get(worker.id)
    if (!managed) return "stopped" as const
    if (managed.error) return "failed" as const
    if (
      managed.child.exitCode !== null ||
      managed.child.signalCode !== null
    ) {
      return "stopped" as const
    }
    return "running" as const
  }

  async release(worker: WorkerInstance): Promise<void> {
    const inFlight = this.releases.get(worker.id)
    if (inFlight) return inFlight
    const release = this.releaseOnce(worker)
    this.releases.set(worker.id, release)
    return release
  }

  async hasWorkerForOwner(ownerId: string): Promise<boolean> {
    return [...this.processes.values()].some(
      ({ worker }) =>
        worker.ownerId === ownerId && worker.state === "running",
    )
  }

  async healthDetails(): Promise<Record<string, unknown>> {
    return {
      worker_provider: {
        kind: this.kind,
        isolation: this.capabilities.isolation,
      },
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.processes.values()].map(({ worker }) => this.release(worker)),
    )
  }

  private async releaseOnce(worker: WorkerInstance): Promise<void> {
    const managed = this.processes.get(worker.id)
    if (!managed) return
    try {
      await this.terminateWorker(managed.child)
    } finally {
      managed.worker.state = "stopped"
      this.processes.delete(worker.id)
    }
  }

  private requiredRuntimeToolBin(): string {
    if (!this.runtimeToolBin) {
      throw new Error("local-process runtime tools are not initialized")
    }
    return this.runtimeToolBin
  }
}

function prepareManagedAgentsLink(paths: WorkerOwnerPaths): void {
  const sourceInfo = lstatSync(paths.managedAgents)
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error("managed agents projection must be a real directory")
  }
  let mountpoint
  try {
    mountpoint = lstatSync(paths.homeAgentsMountpoint)
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error
  }
  if (mountpoint?.isSymbolicLink()) {
    if (realpathSync(paths.homeAgentsMountpoint) !== realpathSync(paths.managedAgents)) {
      throw new Error("managed agents link has an unexpected target")
    }
    return
  }
  if (mountpoint) {
    if (!mountpoint.isDirectory() || readdirSync(paths.homeAgentsMountpoint).length > 0) {
      throw new Error("managed agents mountpoint must be an empty directory")
    }
    rmdirSync(paths.homeAgentsMountpoint)
  }
  symlinkSync(
    path.relative(path.dirname(paths.homeAgentsMountpoint), paths.managedAgents),
    paths.homeAgentsMountpoint,
    "dir",
  )
}

function localWorkerEnvironment(
  config: RunnerConfig,
  ownerId: string,
  port: number,
  paths: WorkerOwnerPaths,
  source: NodeJS.ProcessEnv,
  runtimeToolBin: string,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    [
      "LANG",
      "LC_ALL",
      "PATH",
      "SHELL",
      "TMPDIR",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "NODE_OPTIONS",
    ].flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  )
  return {
    ...environment,
    NODE_ENV: "development",
    HOME: paths.home,
    CODEX_HOME: path.join(paths.control, "supervisor-codex"),
    CODEX_BIN: config.CODEX_BIN,
    LINKSENSE_RUNNER_MODE: "worker",
    LINKSENSE_WORKER_PROVIDER: "local-process",
    LINKSENSE_WORKER_OWNER_ID: ownerId,
    LINKSENSE_USER_DATA_ROOT: paths.home,
    LINKSENSE_WORKER_CONTROL_ROOT: paths.control,
    LINKSENSE_RUNTIME_TOOL_BIN: runtimeToolBin,
    LINKSENSE_RUNNER_SHARED_SECRET: ownerWorkerSecret(
      ownerId,
      config.LINKSENSE_RUNNER_SHARED_SECRET,
    ),
    LINKSENSE_API_INTERNAL_URL: config.LINKSENSE_CONTROLLER_INTERNAL_URL,
    LINKSENSE_CONTROLLER_INTERNAL_URL:
      config.LINKSENSE_CONTROLLER_INTERNAL_URL,
    LINKSENSE_RUNNER_HOST: "127.0.0.1",
    LINKSENSE_RUNNER_PORT: String(port),
    LINKSENSE_WORKER_PORT: String(port),
    LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: String(
      config.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS,
    ),
    LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: String(
      config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
    ),
    LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS: String(
      config.LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS,
    ),
    LINKSENSE_WORKER_IDLE_TTL_SECONDS: String(
      config.LINKSENSE_WORKER_IDLE_TTL_SECONDS,
    ),
    LINKSENSE_WORKER_READY_TIMEOUT_SECONDS: String(
      config.LINKSENSE_WORKER_READY_TIMEOUT_SECONDS,
    ),
    LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: String(
      config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    ),
    LINKSENSE_AGENTS_TEMPLATE_VERSION: config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
    LINKSENSE_CODEX_HOME_TEMPLATE:
      config.LINKSENSE_CODEX_HOME_TEMPLATE ??
      path.join(repositoryRoot(import.meta.url), "deploy/codex-home-template"),
    LINKSENSE_PYTHON_BASE_SITE_PACKAGES:
      config.LINKSENSE_PYTHON_BASE_SITE_PACKAGES,
    LINKSENSE_NODE_BASE_PROJECT: config.LINKSENSE_NODE_BASE_PROJECT,
    LINKSENSE_NODE_REGISTER_HOOK: config.LINKSENSE_NODE_REGISTER_HOOK,
    LINKSENSE_PNPM_VERSION: config.LINKSENSE_PNPM_VERSION,
    LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
      config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
    LINKSENSE_NODE_PACKAGE_REGISTRY_URL:
      config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
    LINKSENSE_BROWSER_SESSION_LIMIT: String(
      config.LINKSENSE_BROWSER_SESSION_LIMIT,
    ),
  }
}

function resolveRunnerEntry(moduleUrl: string): string {
  const directory = path.dirname(fileURLToPath(moduleUrl))
  const built = path.resolve(directory, "../index.js")
  if (existsSync(built)) return built
  const source = path.resolve(directory, "../index.ts")
  if (existsSync(source)) return source
  throw new Error("LinkSense runner entrypoint was not found")
}

function repositoryRoot(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../../..")
}

function spawnLocalWorker(
  command: string,
  args: readonly string[],
  options: {
    cwd: string
    detached: boolean
    env: NodeJS.ProcessEnv
    shell: false
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  },
): LocalWorkerProcess {
  return spawn(command, [...args], options)
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.unref()
    server.once("error", rejectPort)
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        rejectPort(new Error("failed to allocate a local worker port"))
        return
      }
      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(address.port)
      })
    })
  })
}

async function terminateLocalWorker(child: LocalWorkerProcess): Promise<void> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    !child.pid
  ) {
    return
  }
  const exited = waitForExit(child)
  signalChildProcessGroup(child, "SIGTERM")
  if (await settleWithin(exited, 5_000)) return
  signalChildProcessGroup(child, "SIGKILL")
  await settleWithin(exited, 1_000)
}

function waitForExit(child: LocalWorkerProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()))
}

async function settleWithin(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function signalChildProcessGroup(
  child: LocalWorkerProcess,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-child.pid!, signal)
  } catch (error) {
    if (!isNodeError(error, "ESRCH")) throw error
    child.kill(signal)
  }
}
