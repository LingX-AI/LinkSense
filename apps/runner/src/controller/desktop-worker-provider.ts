import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, opendir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import * as net from "node:net"
import path from "node:path"
import type { Logger } from "pino"
import { z } from "zod"
import { desktopServerOriginSchema, runtimeEnvironmentPath } from "@linksense/shared"
import { pruneDesktopAttachments } from "../desktop/attachments.js"
import { ownerWorkerSecret } from "./storage-key.js"
import { isNodeError, safeChildPath } from "./worker-provider-utils.js"
import { prepareLocalProcessRuntimeTools } from "./local-process-runtime-tools.js"
import type { WorkerAcquireInput, WorkerInstance, WorkerInstanceState, WorkerOwnerPaths, WorkerProvider } from "./worker-provider.js"

const markerName = "desktop-session.json"
const retentionMilliseconds = 14 * 24 * 60 * 60 * 1000
const workspaceBudgetBytes = 10 * 1024 * 1024 * 1024
const sessionMarkerSchema = z.strictObject({
  version: z.literal(1), ownerId: z.uuid(), conversationId: z.uuid(), lastUsedAt: z.number().int().nonnegative(),
})
const configurationSchema = z.strictObject({
  dataRoot: z.string().refine(path.isAbsolute),
  runtimeRoot: z.string().refine(path.isAbsolute),
  controlToken: z.string().regex(/^[a-f0-9]{64}$/u),
  serverOrigin: desktopServerOriginSchema.optional(),
  bridgeUrl: z.url().refine(value => {
    const url = URL.parse(value)
    return url !== null && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"
  }).optional(),
})
export type DesktopWorkerConfiguration = z.infer<typeof configurationSchema>
type ManagedDesktopWorker = {
  child: ChildProcess
  worker: WorkerInstance
  paths: WorkerOwnerPaths
  exited: Promise<void>
  lifetime: AbortController
  run: DesktopWorkerRun | undefined
}
type DesktopWorkerRun = {
  turnId: string
  runtimeGeneration: string
  toolOperations?: readonly import("@linksense/shared").DesktopToolOperation[]
}
type DesktopListener = { address: () => net.AddressInfo; fd: () => number; close: () => void }
export const desktopWorkerListenerFd = 4

export class DesktopWorkerProvider implements WorkerProvider {
  readonly kind = "desktop" as const
  readonly capabilities = { isolation: "none" as const, persistentWorkers: false as const, workspaceIdentity: null }
  private readonly configuration: DesktopWorkerConfiguration
  private readonly prepared = new Map<string, WorkerOwnerPaths>()
  private readonly preparations = new Map<string, Promise<void>>()
  private readonly acquisitions = new Map<string, Promise<WorkerInstance>>()
  private readonly workers = new Map<string, ManagedDesktopWorker>()
  private readonly releases = new Map<string, Promise<void>>()
  private runtimeToolBin: string | null = null
  private initializing: Promise<void> | null = null
  private closing = false
  private failed = false

  constructor(
    configuration: DesktopWorkerConfiguration,
    private readonly logger: Logger,
    private readonly workerLost?: () => void,
  ) {
    this.configuration = configurationSchema.parse(configuration)
  }

  initialize(): Promise<void> {
    if (!this.initializing) {
      this.initializing = this.initializeOnce().catch((error: unknown) => {
        this.initializing = null
        throw error
      })
    }
    return this.initializing
  }

  private async initializeOnce(): Promise<void> {
    if (this.closing) throw new Error("desktop runtime is stopping")
    await mkdir(this.configuration.dataRoot, { recursive: true, mode: 0o700 })
    await assertPrivateDirectory(this.configuration.dataRoot, this.configuration.dataRoot)
    await chmod(this.configuration.dataRoot, 0o700)
    await this.pruneWorkspaces(Date.now(), { startup: true })
    const root = path.join(this.configuration.dataRoot, "tools")
    await ensureDesktopDirectory(this.configuration.dataRoot, root)
    const mcp = path.join(this.configuration.runtimeRoot, "runner/dist/mcp")
    this.runtimeToolBin = await prepareLocalProcessRuntimeTools({
      root, launcherCommand: desktopNodeBinary(this.configuration.runtimeRoot),
      launcherArgs: [path.join(mcp, "personal-stdio-launcher.js")],
      connectionLauncherArgs: [path.join(mcp, "connection-service-server.js")],
    })
  }

  async discover(): Promise<WorkerInstance[]> {
    // Only live children of this controller are trusted; saved PIDs are never adopted.
    return []
  }

  pathsFor(ownerId: string, conversationId: string): WorkerOwnerPaths {
    z.uuid().parse(ownerId)
    z.uuid().parse(conversationId)
    const root = path.resolve(this.configuration.dataRoot)
    const owner = safeChildPath(root, runtimeEnvironmentPath(ownerId, conversationId))
    const home = safeChildPath(owner, "home")
    const managed = safeChildPath(owner, "managed")
    const managedAgents = safeChildPath(managed, "agents")
    return {
      root, owner, home, homeAgentsMountpoint: safeChildPath(home, ".agents"), managed, managedAgents,
      managedSkills: safeChildPath(managedAgents, "skills"),
      managedPluginSources: safeChildPath(managedAgents, "plugin-sources"),
      managedPlugins: safeChildPath(managedAgents, "plugins"),
      control: safeChildPath(owner, "control"), workspaces: safeChildPath(home, "projects"),
    }
  }

  prepareOwnerFilesystem(paths: WorkerOwnerPaths): Promise<void> {
    const relative = path.relative(this.configuration.dataRoot, paths.owner).split(path.sep)
    const [ownerId, directory, sessionId] = relative
    if (relative.length !== 3 || directory !== "services" || !ownerId || !sessionId) {
      return Promise.reject(new Error("desktop session directory is invalid"))
    }
    const expected = this.pathsFor(ownerId, sessionId)
    if (Object.entries(expected).some(([key, value]) => Reflect.get(paths, key) !== value)) {
      return Promise.reject(new Error("desktop worker paths are not canonical"))
    }
    if (this.closing) return Promise.reject(new Error("desktop runtime is stopping"))
    const pending = this.preparations.get(paths.owner)
    if (pending) return pending
    const preparing = this.prepareFilesystem(expected, ownerId, sessionId)
      .finally(() => { this.preparations.delete(paths.owner) })
    this.preparations.set(paths.owner, preparing)
    return preparing
  }

  private async prepareFilesystem(paths: WorkerOwnerPaths, ownerId: string, sessionId: string): Promise<void> {
    await this.initialize()
    for (const directory of [paths.owner, paths.home, paths.managed, paths.managedAgents, paths.control, paths.workspaces,
      path.join(paths.home, ".codex"), path.join(paths.home, "workspace")]) {
      await ensureDesktopDirectory(paths.root, directory)
    }
    await chmod(paths.managedAgents, 0o750)
    let link
    try { link = await lstat(paths.homeAgentsMountpoint) } catch (error) { if (!isNodeError(error, "ENOENT")) throw error }
    if (link) {
      if (!link.isSymbolicLink() || await realpath(paths.homeAgentsMountpoint) !== await realpath(paths.managedAgents)) {
        throw new Error("desktop managed projection link is invalid")
      }
    } else {
      await symlink(process.platform === "win32" ? paths.managedAgents : path.relative(paths.home, paths.managedAgents),
        paths.homeAgentsMountpoint, process.platform === "win32" ? "junction" : "dir")
    }
    await this.touch(paths, ownerId, sessionId)
    this.prepared.set(paths.owner, paths)
  }

  async acquire(input: WorkerAcquireInput & { run?: DesktopWorkerRun }): Promise<WorkerInstance> {
    const conversationId = z.uuid().parse(input.serviceSessionId)
    const canonical = this.pathsFor(input.ownerId, conversationId)
    if (this.closing || this.failed || this.acquisitions.has(canonical.owner) || this.findWorker(input.ownerId, conversationId)) {
      throw new Error("desktop worker cleanup must complete before replacement")
    }
    const acquisition = this.acquireOnce(input, conversationId, canonical)
    this.acquisitions.set(canonical.owner, acquisition)
    try {
      return await acquisition
    } finally {
      this.acquisitions.delete(canonical.owner)
    }
  }

  private async acquireOnce(input: WorkerAcquireInput & { run?: DesktopWorkerRun }, conversationId: string, canonical: WorkerOwnerPaths): Promise<WorkerInstance> {
    await this.initialize()
    if (this.closing || !this.runtimeToolBin) throw new Error("desktop runtime is not accepting workers")
    await this.preparations.get(canonical.owner)
    const paths = this.prepared.get(canonical.owner)
    if (!paths) throw new Error("desktop session filesystem has not been prepared")
    await assertPrivateDirectory(paths.root, paths.home)
    const bridgeUrl = this.configuration.bridgeUrl
    if (!bridgeUrl) throw new Error("desktop device bridge is unavailable")
    if (this.configuration.serverOrigin && !input.run) throw new Error("desktop worker needs a fixed run scope")
    const listener = input.run ? bindDesktopListener() : undefined
    const port = listener?.address().port ?? await allocateDesktopPort()
    if (this.closing || this.failed) {
      listener?.close()
      throw new Error("desktop runtime is stopping")
    }
    const worker: WorkerInstance = {
      id: randomUUID(), ownerId: input.ownerId, serviceSessionId: conversationId,
      storageKey: input.storageKey, name: input.name, endpoint: `http://127.0.0.1:${port}`, state: "running",
    }
    let child: ChildProcess
    try {
      child = spawn(desktopNodeBinary(this.configuration.runtimeRoot), [path.join(this.configuration.runtimeRoot, "runner/dist/index.js")], {
        cwd: paths.home, shell: false,
        env: desktopWorkerEnvironment({ ...this.configuration, bridgeUrl }, input.ownerId, conversationId, paths, port, this.runtimeToolBin, input.run),
        stdio: ["ignore", "ignore", "pipe", "ipc", ...(listener ? [listener.fd()] : [])], windowsHide: true,
      })
    } catch (error) {
      listener?.close()
      throw error
    }
    // Keep the parent descriptor until exit; no process can bind between allocation and startup.
    const lifetime = new AbortController()
    child.once("close", () => {
      lifetime.abort()
      listener?.close()
    })
    let stderrBytes = 0
    child.stderr?.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength })
    const exited = new Promise<void>(resolve => {
      child.on("error", () => {
        lifetime.abort()
        worker.state = "failed"
        if (child.pid === undefined) resolve()
      })
      child.once("exit", code => {
        lifetime.abort()
        worker.state = code === 0 ? "stopped" : "failed"
        if (stderrBytes > 0) this.logger.warn({ bytes: stderrBytes, workerId: worker.id }, "desktop worker emitted diagnostics")
        if (!this.closing && (code !== 0 || !this.releases.has(worker.id))) {
          this.failed = true
          this.workerLost?.()
        }
        resolve()
      })
    })
    if (!child.pid) {
      await exited
      throw new Error("desktop worker failed to start")
    }
    this.workers.set(worker.id, { child, worker, paths, exited, lifetime, run: input.run })
    return worker
  }

  request(worker: WorkerInstance, route: string, signal: AbortSignal, body?: unknown): Promise<Response> {
    const managed = this.workers.get(worker.id)
    if (!managed?.run || managed.worker !== worker || worker.state !== "running" || this.releases.has(worker.id)) {
      throw new Error("desktop worker is unavailable")
    }
    const url = new URL(worker.endpoint)
    url.pathname = route
    return fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error", signal: AbortSignal.any([signal, managed.lifetime.signal, AbortSignal.timeout(15_000)]),
      headers: {
        authorization: `Bearer ${desktopWorkerSecret(worker.ownerId, this.configuration.controlToken,
          z.uuid().parse(worker.serviceSessionId), managed.run)}`,
        "x-linksense-owner-id": worker.ownerId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async resume(): Promise<WorkerInstance> {
    throw new Error("desktop workers are never resumed across controller restarts")
  }

  async inspect(worker: WorkerInstance): Promise<WorkerInstanceState> {
    return this.workers.get(worker.id)?.worker.state ?? "stopped"
  }

  release(worker: WorkerInstance): Promise<void> {
    const pending = this.releases.get(worker.id)
    if (pending) return pending
    const release = this.releaseOnce(worker).finally(() => { this.releases.delete(worker.id) })
    this.releases.set(worker.id, release)
    return release
  }

  private async releaseOnce(worker: WorkerInstance): Promise<void> {
    const managed = this.workers.get(worker.id)
    if (!managed) return
    const { child, exited, lifetime } = managed
    lifetime.abort()
    if (child.connected) child.disconnect()
    if (!await waitForExit(exited, 5000)) {
      this.failed = true
      if (!this.closing && this.workerLost) {
        this.workerLost()
        throw new Error("desktop worker exit requires process tree cleanup")
      }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      if (!await waitForExit(exited, 2000)) throw new Error("desktop worker did not stop")
    }
    try {
      await this.touch(managed.paths, managed.worker.ownerId, z.uuid().parse(managed.worker.serviceSessionId))
    } finally {
      worker.state = "stopped"
      managed.worker.state = "stopped"
      this.workers.delete(worker.id)
      this.prepared.delete(managed.paths.owner)
    }
  }

  async hasWorkerForEnvironment(ownerId: string, serviceSessionId?: string): Promise<boolean> {
    if (!serviceSessionId) return false
    return this.acquisitions.has(this.pathsFor(ownerId, serviceSessionId).owner) || this.findWorker(ownerId, serviceSessionId)
  }

  private findWorker(ownerId: string, serviceSessionId: string): boolean {
    return [...this.workers.values()].some(current =>
      current.worker.ownerId === ownerId && current.worker.serviceSessionId === serviceSessionId)
  }

  async healthDetails(): Promise<Record<string, unknown>> {
    return { worker_provider: { kind: this.kind, isolation: this.capabilities.isolation }, workers: this.workers.size }
  }

  async shutdown(): Promise<void> {
    this.closing = true
    await this.stopWorkers()
  }

  async stopWorkers(): Promise<void> {
    await Promise.allSettled([...this.preparations.values(), ...this.acquisitions.values()])
    const results = await Promise.allSettled([...this.workers.values()].map(current => this.release(current.worker)))
    const failed = results.filter(result => result.status === "rejected")
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), "desktop worker cleanup failed")
  }

  private async touch(paths: WorkerOwnerPaths, ownerId: string, conversationId: string): Promise<void> {
    await assertPrivateDirectory(paths.root, paths.owner)
    const marker = sessionMarkerSchema.parse({ version: 1, ownerId, conversationId, lastUsedAt: Date.now() })
    const temporary = path.join(paths.owner, `.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(marker), { mode: 0o600, flag: "wx" })
      await rename(temporary, path.join(paths.owner, markerName))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async pruneWorkspaces(now = Date.now(), options?: { startup: true }): Promise<{ deleted: number; retainedBytes: number }> {
    const root = this.configuration.dataRoot
    const sessions: Array<{ directory: string; ownerId: string; conversationId: string; lastUsedAt: number; bytes: number }> = []
    for await (const owner of await opendir(root)) {
      if (!owner.isDirectory() || !z.uuid().safeParse(owner.name).success) continue
      const services = path.join(root, owner.name, "services")
      const info = await lstat(services).catch((error: unknown) => { if (!isNodeError(error, "ENOENT")) throw error; return null })
      if (!info?.isDirectory() || info.isSymbolicLink()) continue
      await assertPrivateDirectory(root, services)
      for await (const entry of await opendir(services)) {
        if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue
        if (await this.hasWorkerForEnvironment(owner.name, entry.name)) continue
        const paths = this.pathsFor(owner.name, entry.name)
        const markerFile = path.join(paths.owner, markerName)
        let marker
        try {
          const markerInfo = await lstat(markerFile)
          if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size > 4096) continue
          marker = sessionMarkerSchema.safeParse(JSON.parse(await readFile(markerFile, "utf8")))
        } catch (error) { if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) continue; throw error }
        if (!marker.success || marker.data.ownerId !== owner.name || marker.data.conversationId !== entry.name) continue
        if (options?.startup) await pruneDesktopAttachments(paths, owner.name, entry.name)
        // Control and Codex history are needed for idempotency and read-only recovery;
        // eviction applies only to task files once this runtime has a control directory.
        const control = await lstat(path.join(paths.control, "workspaces", entry.name)).catch((error: unknown) => {
          if (!isNodeError(error, "ENOENT")) throw error
          return null
        })
        const directory = control ? path.join(paths.home, "workspace") : paths.owner
        const present = await lstat(directory).catch((error: unknown) => {
          if (!isNodeError(error, "ENOENT")) throw error
          return null
        })
        if (!present?.isDirectory()) continue
        await assertPrivateDirectory(root, directory)
        sessions.push({
          directory, ownerId: owner.name, conversationId: entry.name,
          lastUsedAt: marker.data.lastUsedAt, bytes: await desktopDirectoryBytes(directory),
        })
      }
    }
    sessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.directory.localeCompare(b.directory))
    let retainedBytes = sessions.reduce((sum, session) => sum + session.bytes, 0), deleted = 0
    for (const session of sessions) {
      if (now - session.lastUsedAt < retentionMilliseconds && retainedBytes <= workspaceBudgetBytes) continue
      await assertPrivateDirectory(root, session.directory)
      const owner = this.pathsFor(session.ownerId, session.conversationId).owner
      if (this.preparations.has(owner) || this.acquisitions.has(owner) || this.findWorker(session.ownerId, session.conversationId)) continue
      await rm(session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      retainedBytes -= session.bytes
      deleted++
    }
    return { deleted, retainedBytes }
  }
}

function desktopNodeBinary(runtimeRoot: string): string {
  return path.join(runtimeRoot, "bin", process.platform === "win32" ? "node.exe" : "node")
}

export function desktopWorkerEnvironment(
  configuration: DesktopWorkerConfiguration & { bridgeUrl: string }, ownerId: string, conversationId: string,
  paths: WorkerOwnerPaths, port: number, runtimeToolBin: string, run?: DesktopWorkerRun,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(["PATH", "LANG", "LC_ALL", "SHELL", "TMPDIR", "TMP", "TEMP",
    "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]
    .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]))
  return {
    ...environment, NODE_ENV: "production", HOME: paths.home, USERPROFILE: paths.home,
    PATH: [path.join(configuration.runtimeRoot, "bin"), environment.PATH].filter(Boolean).join(path.delimiter),
    CODEX_HOME: path.join(paths.control, "supervisor-codex"),
    CODEX_BIN: path.join(configuration.runtimeRoot, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
    LINKSENSE_RUNNER_MODE: "worker", LINKSENSE_WORKER_PROVIDER: "desktop",
    LINKSENSE_WORKER_OWNER_ID: ownerId, LINKSENSE_SERVICE_SESSION_ID: conversationId,
    LINKSENSE_DESKTOP_DATA_ROOT: paths.root,
    LINKSENSE_USER_DATA_ROOT: paths.home, LINKSENSE_WORKER_CONTROL_ROOT: paths.control,
    LINKSENSE_RUNTIME_TOOL_BIN: runtimeToolBin,
    LINKSENSE_CODEX_HOME_TEMPLATE: path.join(configuration.runtimeRoot, "template"),
    LINKSENSE_RUNNER_HOST: "127.0.0.1", LINKSENSE_RUNNER_PORT: String(port),
    LINKSENSE_RUNNER_SHARED_SECRET: desktopWorkerSecret(ownerId, configuration.controlToken, conversationId, run),
    LINKSENSE_API_INTERNAL_URL: configuration.bridgeUrl, LINKSENSE_CONTROLLER_INTERNAL_URL: configuration.bridgeUrl,
    LINKSENSE_MANAGED_BROWSER_ENABLED: "false", LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: "1",
    LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: "1",
    ...(configuration.serverOrigin ? { LINKSENSE_DESKTOP_PROXY_ORIGIN: configuration.serverOrigin } : {}),
    ...(run ? { LINKSENSE_DESKTOP_TURN_ID: run.turnId, LINKSENSE_DESKTOP_RUNTIME_GENERATION: run.runtimeGeneration } : {}),
    ...(run?.toolOperations?.includes("connection.execute") ? { LINKSENSE_DESKTOP_CONNECTIONS_ENABLED: "true" } : {}),
    ...(run?.toolOperations?.includes("browser.execute") ? { LINKSENSE_DESKTOP_BROWSER_ENABLED: "true" } : {}),
    ...(run?.toolOperations?.includes("artifact.prepare") ? { LINKSENSE_DESKTOP_ARTIFACTS_ENABLED: "true" } : {}),
  }
}

export function desktopWorkerSecret(ownerId: string, secret: string, conversationId: string, run?: DesktopWorkerRun): string {
  return ownerWorkerSecret(ownerId, secret, run
    ? `${conversationId}:${run.runtimeGeneration}:${run.turnId}` : conversationId)
}

function bindDesktopListener(): DesktopListener {
  // The bundled Node supports BoundSocket; @types/node 24 does not yet expose it.
  const BoundSocket = z.custom<new (options: { host: string; port: number }) => DesktopListener>(
    value => typeof value === "function",
  ).parse(Reflect.get(net, "BoundSocket"))
  return new BoundSocket({ host: "127.0.0.1", port: 0 })
}

async function assertPrivateDirectory(root: string, directory: string): Promise<void> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("desktop runtime requires real private directories")
  const canonicalRoot = await realpath(root), canonicalDirectory = await realpath(directory)
  const relative = path.relative(root, directory)
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ||
      path.resolve(canonicalRoot, relative) !== canonicalDirectory) {
    throw new Error("desktop directory escapes its root or crosses an alias")
  }
}

async function ensureDesktopDirectory(root: string, directory: string): Promise<void> {
  const relative = path.relative(root, directory)
  if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) throw new Error("invalid desktop directory")
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = safeChildPath(current, segment)
    await mkdir(current, { mode: 0o700 }).catch((error: unknown) => { if (!isNodeError(error, "EEXIST")) throw error })
    await assertPrivateDirectory(root, current)
  }
}

async function desktopDirectoryBytes(directory: string): Promise<number> {
  let bytes = 0
  for await (const entry of await opendir(directory)) {
    const filename = path.join(directory, entry.name)
    const info = await lstat(filename)
    bytes += info.isDirectory() && !info.isSymbolicLink() ? await desktopDirectoryBytes(filename) : info.size
  }
  return bytes
}

async function allocateDesktopPort(): Promise<number> {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") { server.close(); reject(new Error("desktop worker port is unavailable")); return }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForExit(exited: Promise<void>, milliseconds: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([exited.then(() => true), new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), milliseconds) })])
  } finally { if (timeout) clearTimeout(timeout) }
}
