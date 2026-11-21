import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, opendir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import * as net from "node:net"
import path from "node:path"
import type { Logger } from "pino"
import { z } from "zod"
import { desktopServerOriginSchema, runtimeEnvironmentPath } from "@linksense/shared"
import { pruneDesktopAttachments } from "../desktop/attachments.js"
import { StartOperationStore, type StartOperationState } from "../start-operation.js"
import { WorkspaceManager } from "../workspace/workspace-manager.js"
import { ownerWorkerSecret } from "./storage-key.js"
import { isNodeError, safeChildPath } from "./worker-provider-utils.js"
import { prepareLocalProcessRuntimeTools } from "./local-process-runtime-tools.js"
import type { WorkerAcquireInput, WorkerInstance, WorkerInstanceState, WorkerOwnerPaths, WorkerProvider } from "./worker-provider.js"

const markerName = "desktop-session.json"
export const desktopWorkspaceRetentionDays = 14
export const desktopWorkspaceBudgetBytes = 10 * 1024 * 1024 * 1024
const retentionMilliseconds = desktopWorkspaceRetentionDays * 24 * 60 * 60 * 1000
const maxSessionMarkerBytes = 4096
const maxStartOperationBytes = 64 * 1024
// Version 1 predates server-origin binding. Its paths stay untouched and
// unmeasured: the origin cannot be proven without guessing.
const sessionMarkerV1Schema = z.strictObject({
  version: z.literal(1), ownerId: z.uuid(), conversationId: z.uuid(), lastUsedAt: z.number().int().nonnegative(),
})
// Version 2 binds a newly created workspace to the configured server origin.
// clearedAt records a confirmed eviction of the task files; it is removed when
// preparation rebuilds the empty workspace, and it never applies to v1 data.
const sessionMarkerV2Schema = z.strictObject({
  version: z.literal(2), origin: desktopServerOriginSchema, ownerId: z.uuid(),
  conversationId: z.uuid(), lastUsedAt: z.number().int().nonnegative(),
  clearedAt: z.number().int().nonnegative().optional(),
})
type SessionMarkerV1 = z.infer<typeof sessionMarkerV1Schema>
type SessionMarkerV2 = z.infer<typeof sessionMarkerV2Schema>
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
  toolOperations?: readonly import("@linksense/shared").DesktopNegotiatedOperation[]
}
export type DesktopWorkspaceUsage = { bytes: number; files: number; sessions: number }
export type DesktopWorkspacePruneResult = { deleted: number; freedBytes: number; retainedBytes: number }
type DesktopWorkspaceSession = {
  directory: string
  ownerId: string
  conversationId: string
  lastUsedAt: number
  bytes: number
  files: number
  active: boolean
}
type SessionMarkerState =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "valid"; marker: SessionMarkerV1 | SessionMarkerV2 }
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
  private pruning: Promise<void> = Promise.resolve()
  private runtimeToolBin: string | null = null
  private initializing: Promise<void> | null = null
  private closing = false
  private failed = false
  private maintenance = false

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
    // Startup is device-wide, before any link exists. Attachment staging from
    // a previous crash is reconciled here only; manual cleanup never does it.
    await this.pruneWorkspaces(Date.now(), { reconcileAttachments: true })
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
    // Cleanup holds exclusivity from its synchronous admission until every
    // deletion check has finished; no preparation may slip in between.
    if (this.maintenance) return Promise.reject(new Error("desktop maintenance is in progress"))
    const pending = this.preparations.get(paths.owner)
    if (pending) return pending
    const preparing = this.prepareFilesystem(expected, ownerId, sessionId)
      .finally(() => { this.preparations.delete(paths.owner) })
    this.preparations.set(paths.owner, preparing)
    return preparing
  }

  private async prepareFilesystem(paths: WorkerOwnerPaths, ownerId: string, sessionId: string): Promise<void> {
    await this.initialize()
    // Only a session directory this preparation creates from absence may be
    // claimed for the configured origin. If the owner/session directory
    // already exists, its control, history or journals may be older data whose
    // task directory was evicted; creating a fresh workspace there is not
    // evidence that the session belongs to this server.
    const ownerExisted = await existingPrivateDirectory(paths.root, paths.owner)
    const homeExisted = await existingPrivateDirectory(paths.root, paths.home)
    const workspaceExisted = homeExisted &&
      await existingPrivateDirectory(paths.root, path.join(paths.home, "workspace"))
    await this.assertSessionOrigin(ownerId, sessionId)
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
    await this.touch(paths, ownerId, sessionId, !ownerExisted, workspaceExisted)
    this.prepared.set(paths.owner, paths)
  }

  async acquire(input: WorkerAcquireInput & { run?: DesktopWorkerRun }): Promise<WorkerInstance> {
    const conversationId = z.uuid().parse(input.serviceSessionId)
    const canonical = this.pathsFor(input.ownerId, conversationId)
    if (this.closing || this.failed || this.maintenance || this.acquisitions.has(canonical.owner) ||
        this.findWorker(input.ownerId, conversationId)) {
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
      await this.touch(managed.paths, managed.worker.ownerId, z.uuid().parse(managed.worker.serviceSessionId), false, true)
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

  /** A cleanup owns workspace admission from its synchronous start. */
  beginMaintenance(): boolean {
    if (this.maintenance || this.closing || this.failed) return false
    this.maintenance = true
    return true
  }

  endMaintenance(): void {
    this.maintenance = false
  }

  isMaintenanceActive(): boolean {
    return this.maintenance
  }

  /**
   * Stop admitting new work and let a running scan detach, without stopping
   * workers before the link has delivered its own shutdown.
   */
  beginShutdown(): void {
    this.closing = true
  }

  async shutdown(): Promise<void> {
    this.closing = true
    try {
      await this.stopWorkers()
    } finally {
      // A scan that already started rechecks closing between sessions and
      // stops deleting; wait for it so shutdown returns with no side effect.
      await this.pruning
    }
  }

  async stopWorkers(): Promise<void> {
    await Promise.allSettled([...this.preparations.values(), ...this.acquisitions.values()])
    const results = await Promise.allSettled([...this.workers.values()].map(current => this.release(current.worker)))
    const failed = results.filter(result => result.status === "rejected")
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), "desktop worker cleanup failed")
  }

  private async touch(
    paths: WorkerOwnerPaths, ownerId: string, conversationId: string,
    created: boolean, workspaceExisted: boolean,
  ): Promise<void> {
    await assertPrivateDirectory(paths.root, paths.owner)
    const now = Date.now()
    const existing = await this.readSessionMarker(paths, ownerId, conversationId)
    let marker: SessionMarkerV1 | SessionMarkerV2
    if (existing.state === "valid") {
      // Never relabel a v1 session with this origin: it may have been created
      // by a build targeting another server. Only a v2 marker carries a proven
      // origin, and it must still match.
      if (existing.marker.version === 1) {
        marker = { ...existing.marker, lastUsedAt: now }
      } else {
        this.assertMarkerOrigin(existing.marker)
        const { clearedAt, ...rest } = existing.marker
        // Rebuilding an empty workspace makes a past eviction notice stale.
        marker = workspaceExisted
          ? { ...rest, lastUsedAt: now, ...(clearedAt === undefined ? {} : { clearedAt }) }
          : { ...rest, lastUsedAt: now }
      }
    } else if (existing.state === "invalid") {
      // A corrupt, oversized, or aliased marker is evidence this build cannot
      // interpret. Leave it and the workspace unclaimed rather than replacing it.
      return
    } else {
      // Only a session directory created from absence becomes origin-bound. An
      // existing directory without a marker may be legacy data and stays untouched.
      if (!created) return
      marker = this.configuration.serverOrigin
        ? { version: 2, origin: this.configuration.serverOrigin, ownerId, conversationId, lastUsedAt: now }
        : { version: 1, ownerId, conversationId, lastUsedAt: now }
    }
    await writeSessionMarker(paths, marker)
  }

  /**
   * Persist a confirmed eviction of this session's task files. Only a v2 marker
   * for this exact origin and owner is evidence; v1, foreign, corrupt, or
   * unreadable markers are left untouched, so no notice is inferred from them.
   */
  private async markWorkspaceCleared(
    paths: WorkerOwnerPaths, ownerId: string, conversationId: string, clearedAt: number,
  ): Promise<void> {
    try {
      await assertPrivateDirectory(paths.root, paths.owner)
      const existing = await this.readSessionMarker(paths, ownerId, conversationId)
      if (existing.state !== "valid" || existing.marker.version !== 2) return
      this.assertMarkerOrigin(existing.marker)
      await writeSessionMarker(paths, {
        ...existing.marker,
        clearedAt: Math.max(existing.marker.clearedAt ?? 0, clearedAt),
      })
    } catch (error) {
      // The files were already evicted; a failed notice write must not turn a
      // completed cleanup into a claim that nothing was removed.
      this.logger.warn({ err: error }, "desktop workspace clear marker was not persisted")
    }
  }

  private async readSessionMarker(paths: WorkerOwnerPaths, ownerId: string, conversationId: string): Promise<SessionMarkerState> {
    const markerFile = path.join(paths.owner, markerName)
    let info
    try {
      info = await lstat(markerFile)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { state: "absent" }
      throw error
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxSessionMarkerBytes) return { state: "invalid" }
    let value: unknown
    try {
      value = JSON.parse(await readFile(markerFile, "utf8"))
    } catch (error) {
      if (error instanceof SyntaxError) return { state: "invalid" }
      throw error
    }
    const marker = z.union([sessionMarkerV1Schema, sessionMarkerV2Schema]).safeParse(value)
    if (!marker.success || marker.data.ownerId !== ownerId || marker.data.conversationId !== conversationId) {
      return { state: "invalid" }
    }
    return { state: "valid", marker: marker.data }
  }

  private assertMarkerOrigin(marker: SessionMarkerV2): void {
    if (this.configuration.serverOrigin !== undefined && marker.origin !== this.configuration.serverOrigin) {
      throw new Error("desktop session belongs to a different server origin")
    }
  }

  /**
   * Reject a workspace known to be bound to another configured origin before a
   * preparation or recovery reads or writes it. Legacy v1 and absent markers
   * stay usable: their origin was never recorded and is not guessed.
   */
  async assertSessionOrigin(ownerId: string, conversationId: string): Promise<void> {
    const owner = z.uuid().parse(ownerId).toLowerCase()
    const session = z.uuid().parse(conversationId).toLowerCase()
    const paths = this.pathsFor(owner, session)
    // Validate the canonical owner chain before following the marker path. A
    // missing owner means there is no evidence to interpret; an alias or
    // non-directory is unsafe and must fail rather than be guessed around.
    await existingPrivateDirectory(paths.root, paths.owner)
    const marker = await this.readSessionMarker(paths, owner, session)
    if (marker.state === "valid" && marker.marker.version === 2) this.assertMarkerOrigin(marker.marker)
  }

  /** Aggregate task-workspace bytes and files for one account; control and history are excluded. */
  async workspaceUsage(ownerId: string): Promise<DesktopWorkspaceUsage> {
    const owner = z.uuid().parse(ownerId).toLowerCase()
    // Report a coherent aggregate rather than a directory being evicted.
    await this.pruning
    if (this.closing) throw new Error("desktop runtime is stopping")
    const sessions = await this.collectWorkspaceSessions(owner)
    if (this.closing) throw new Error("desktop runtime is stopping")
    return {
      bytes: sessions.reduce((sum, session) => sum + session.bytes, 0),
      files: sessions.reduce((sum, session) => sum + session.files, 0),
      sessions: sessions.length,
    }
  }

  /**
   * Startup retention covers the whole device. The settings action passes one
   * owner id so the user's account is the only workspace scope measured and
   * evicted; the same 14-day/10-GiB thresholds and oldest-first order apply.
   * With a configured origin (every macOS run) only origin-bound v2 sessions
   * are eligible, so legacy v1 and foreign-origin data are never touched.
   * Without an origin (Windows startup and origin-less development) baseline
   * v1 retention is preserved because there is no origin to bind against.
   */
  pruneWorkspaces(now = Date.now(), options?: {
    ownerId?: string
    reconcileAttachments?: boolean
    signal?: AbortSignal
  }): Promise<DesktopWorkspacePruneResult> {
    const run = this.pruning.then(
      () => this.pruneOnce(now, options),
      () => this.pruneOnce(now, options),
    )
    this.pruning = run.then(() => undefined, () => undefined)
    return run
  }

  private async pruneOnce(now: number, options?: {
    ownerId?: string
    reconcileAttachments?: boolean
    signal?: AbortSignal
  }): Promise<DesktopWorkspacePruneResult> {
    const root = this.configuration.dataRoot
    const stopped = () => this.closing || options?.signal?.aborted === true
    // Attachment staging is reconciled only by startup maintenance (device
    // wide), never by an explicit account-scoped user cleanup.
    const reconcileAttachments = options?.reconcileAttachments ??
      (options?.ownerId === undefined)
    const sessions = await this.collectWorkspaceSessions(options?.ownerId, { reconcileAttachments, stopped })
    sessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.directory.localeCompare(b.directory))
    let retainedBytes = sessions.reduce((sum, session) => sum + session.bytes, 0)
    let deleted = 0, freedBytes = 0
    for (const session of sessions) {
      if (stopped()) break
      if (now - session.lastUsedAt < retentionMilliseconds && retainedBytes <= desktopWorkspaceBudgetBytes) continue
      if (session.active) continue
      const owner = this.pathsFor(session.ownerId, session.conversationId).owner
      if (this.preparations.has(owner) || this.acquisitions.has(owner) ||
          this.findWorker(session.ownerId, session.conversationId)) continue
      // Ambiguous starts and retained attachment publications must survive so a
      // recovery or idempotent replay never loses its inputs. An unreadable or
      // aliased control entry is retained rather than treated as settled.
      let pending: boolean
      try {
        pending = await this.hasPendingWorkspaceWork(session)
      } catch {
        pending = true
      }
      // A cancel may arrive while the pending-work evidence is being read.
      if (pending || stopped()) continue
      await assertPrivateDirectory(root, session.directory)
      // Deletion is the only destructive operation; check immediately before it.
      // A cancel after this point may let this one rm finish but never starts
      // another, because the loop checks again at its top.
      if (stopped()) break
      await rm(session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      await this.markWorkspaceCleared(
        this.pathsFor(session.ownerId, session.conversationId), session.ownerId, session.conversationId, now,
      )
      retainedBytes -= session.bytes
      freedBytes += session.bytes
      deleted++
    }
    return { deleted, freedBytes, retainedBytes }
  }

  private async collectWorkspaceSessions(ownerId?: string, options: {
    reconcileAttachments: boolean
    stopped?: () => boolean
  } = { reconcileAttachments: false }): Promise<DesktopWorkspaceSession[]> {
    const root = this.configuration.dataRoot
    const stopped = options.stopped ?? (() => this.closing)
    const selectedOwner = ownerId === undefined ? undefined : z.uuid().parse(ownerId).toLowerCase()
    const origin = this.configuration.serverOrigin
    const sessions: DesktopWorkspaceSession[] = []
    const owners = await opendir(root).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error
      return null
    })
    if (!owners) return sessions
    for await (const owner of owners) {
      if (stopped()) break
      if (!owner.isDirectory() || !z.uuid().safeParse(owner.name).success) continue
      if (selectedOwner !== undefined && owner.name !== selectedOwner) continue
      const services = path.join(root, owner.name, "services")
      const info = await lstat(services).catch((error: unknown) => { if (!isNodeError(error, "ENOENT")) throw error; return null })
      if (!info?.isDirectory() || info.isSymbolicLink()) continue
      await assertPrivateDirectory(root, services)
      for await (const entry of await opendir(services)) {
        if (stopped()) break
        if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue
        const paths = this.pathsFor(owner.name, entry.name)
        try {
          // Read the canonical owner chain before interpreting its marker or
          // recovery state. Unsafe aliases fail the scan; an unreadable marker
          // or control entry only makes this session ineligible and retained.
          await assertPrivateDirectory(root, paths.owner)
          const marker = await this.readSessionMarker(paths, owner.name, entry.name)
          if (marker.state !== "valid") continue
          const bound = marker.marker.version === 2 && origin !== undefined && marker.marker.origin === origin
          // A runtime without a configured server origin (Windows startup and
          // origin-less development) has nothing to bind against. Preserve its
          // baseline v1 startup retention; Mac always supplies an origin, so
          // legacy v1 task files are never measured or evicted there.
          const legacy = marker.marker.version === 1 && origin === undefined
          const active = await this.hasWorkerForEnvironment(owner.name, entry.name)
          if (options.reconcileAttachments && !active) {
            // Keep the pre-existing startup reconciliation for compatible v1
            // data. A v2 workspace for another origin is never touched.
            if (bound || marker.marker.version === 1) {
              await pruneDesktopAttachments(paths, owner.name, entry.name)
            }
          }
          if (!bound && !legacy) continue
          // Eviction applies only to task files. Control state, Codex history,
          // managed files, the session marker and pending outboxes stay because
          // recovery, artifact registration and idempotency still depend on them.
          const directory = path.join(paths.home, "workspace")
          const present = await lstat(directory).catch((error: unknown) => {
            if (!isNodeError(error, "ENOENT")) throw error
            return null
          })
          if (!present?.isDirectory()) continue
          await assertPrivateDirectory(root, directory)
          const usage = await desktopDirectoryUsage(directory, stopped)
          sessions.push({
            directory, ownerId: owner.name, conversationId: entry.name,
            lastUsedAt: marker.marker.lastUsedAt, bytes: usage.bytes, files: usage.files, active,
          })
        } catch (error) {
          if (error instanceof UnsafeDesktopPathError) throw error
          // Corrupt or unreadable evidence is retained, never guessed around.
          continue
        }
      }
    }
    return sessions
  }

  /**
   * A session is retained when any part of its start or attachment state is
   * uncertain. Journals are validated with the same StartOperationStore the
   * worker uses; corrupt, oversized, aliased, or unreadable entries are kept.
   */
  private async hasPendingWorkspaceWork(session: DesktopWorkspaceSession): Promise<boolean> {
    const paths = this.pathsFor(session.ownerId, session.conversationId)
    // Validate the canonical owner chain before reading control or journals.
    await assertPrivateDirectory(paths.root, paths.owner)
    let control
    try {
      control = await lstat(paths.control)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false
      throw error
    }
    if (!control.isDirectory() || control.isSymbolicLink()) return true
    await assertPrivateDirectory(paths.root, paths.control)
    for await (const entry of await opendir(paths.control)) {
      // Staging directories and publication markers that survived attachment
      // pruning still belong to an unresolved start operation.
      if (entry.name.startsWith("attachments-") || entry.name.startsWith("published-")) return true
    }
    const manager = new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: session.ownerId, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    })
    const taskControl = manager.pathsFor(session.conversationId).taskControl
    let taskInfo
    try {
      taskInfo = await lstat(taskControl)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false
      throw error
    }
    if (!taskInfo.isDirectory() || taskInfo.isSymbolicLink()) return true
    await assertPrivateDirectory(paths.root, taskControl)
    // Unresolved delivery work is retained in either the legacy or the
    // generation/turn-scoped outbox. The stores remove entry files but leave
    // their empty directories, so only files (at any depth) count.
    if (await hasUnresolvedOutbox(paths.root, path.join(taskControl, "outbox"), 0)) return true
    if (await hasUnresolvedOutbox(paths.root, path.join(taskControl, "desktop-outbox"), 0)) return true
    const operations = path.join(taskControl, "start-operations")
    const operationsInfo = await lstat(operations).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error
      return null
    })
    if (!operationsInfo) return false
    if (!operationsInfo.isDirectory() || operationsInfo.isSymbolicLink()) return true
    const entries = await opendir(operations)
    const store = new StartOperationStore(manager)
    for await (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) return true
      const journal = startOperationEntry(entry.name)
      if (!journal) return true
      const file = path.join(operations, entry.name)
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxStartOperationBytes) return true
      let state: StartOperationState | null
      try {
        state = await store.read(session.conversationId, journal.turnId)
      } catch {
        return true
      }
      // A journal that names another account or a runtime generation that this
      // session cannot confirm cannot prove its start is settled, even when the
      // status looks final. Missing or mismatched generation evidence is
      // retained; a valid matching generation is the only confirmed case.
      if (state && state.ownerId !== undefined && state.ownerId !== session.ownerId) return true
      if (state?.runtimeGeneration !== undefined &&
          await manager.readRuntimeGeneration(session.conversationId, state.runtimeGeneration) === null) return true
      if (journal.interrupt) {
        // A stop that never reached a settled journal still owns its inputs.
        if (!state || state.status === "starting" || state.status === "uncertain") return true
        continue
      }
      // A vanished journal during the scan is treated as uncertain, not settled.
      if (!state || state.status === "starting" || state.status === "uncertain") return true
    }
    return false
  }
}

function startOperationEntry(name: string): { turnId: string; interrupt: boolean } | null {
  const interrupt = name.endsWith(".json.interrupt")
  const base = interrupt
    ? name.slice(0, -".json.interrupt".length)
    : name.endsWith(".json") ? name.slice(0, -".json".length) : null
  if (base === null) return null
  const turnId = z.uuid().safeParse(base)
  return turnId.success ? { turnId: turnId.data, interrupt } : null
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
    ...(run?.toolOperations?.includes("approval.respond") ? { LINKSENSE_DESKTOP_NATIVE_APPROVALS_ENABLED: "true" } : {}),
    ...(run?.toolOperations?.some(operation => operation === "artifact.prepare" || operation === "artifact.website")
      ? { LINKSENSE_DESKTOP_ARTIFACTS_ENABLED: "true" } : {}),
    ...(run?.toolOperations?.includes("artifact.website") ? { LINKSENSE_DESKTOP_ARTIFACTS_WEBSITE_ENABLED: "true" } : {}),
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

class UnsafeDesktopPathError extends Error {}

async function assertPrivateDirectory(root: string, directory: string): Promise<void> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new UnsafeDesktopPathError("desktop runtime requires real private directories")
  }
  const canonicalRoot = await realpath(root), canonicalDirectory = await realpath(directory)
  const relative = path.relative(root, directory)
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ||
      path.resolve(canonicalRoot, relative) !== canonicalDirectory) {
    throw new UnsafeDesktopPathError("desktop directory escapes its root or crosses an alias")
  }
}

/** True only for an existing real directory under root; a missing path is false. */
async function existingPrivateDirectory(root: string, directory: string): Promise<boolean> {
  try {
    await assertPrivateDirectory(root, directory)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw error
  }
}

async function writeSessionMarker(
  paths: WorkerOwnerPaths, marker: SessionMarkerV1 | SessionMarkerV2,
): Promise<void> {
  const temporary = path.join(paths.owner, `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(marker), { mode: 0o600, flag: "wx" })
    await rename(temporary, path.join(paths.owner, markerName))
  } finally {
    await rm(temporary, { force: true })
  }
}

async function ensureDesktopDirectory(root: string, directory: string): Promise<void> {
  const relative = path.relative(root, directory)
  if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new UnsafeDesktopPathError("invalid desktop directory")
  }
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = safeChildPath(current, segment)
    await mkdir(current, { mode: 0o700 }).catch((error: unknown) => { if (!isNodeError(error, "EEXIST")) throw error })
    await assertPrivateDirectory(root, current)
  }
}

/** Missing or empty directories are settled; any file or alias is unresolved. */
async function hasUnresolvedOutbox(root: string, directory: string, depth: number): Promise<boolean> {
  if (depth > 4) return true
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) return true
    await assertPrivateDirectory(root, directory)
    for await (const entry of await opendir(directory)) {
      if (entry.isFile()) return true
      if (entry.isDirectory()) {
        if (await hasUnresolvedOutbox(root, path.join(directory, entry.name), depth + 1)) return true
      } else {
        return true
      }
    }
    return false
  } catch (error) {
    return !isNodeError(error, "ENOENT")
  }
}

async function desktopDirectoryUsage(
  directory: string, stopped?: () => boolean,
): Promise<{ bytes: number; files: number }> {
  let bytes = 0, files = 0
  for await (const entry of await opendir(directory)) {
    if (stopped?.()) break
    const filename = path.join(directory, entry.name)
    const info = await lstat(filename).catch((error: unknown) => {
      // A read-only usage request may overlap a workspace write.
      if (isNodeError(error, "ENOENT")) return null
      throw error
    })
    if (!info) continue
    if (info.isDirectory() && !info.isSymbolicLink()) {
      const nested = await desktopDirectoryUsage(filename, stopped)
      bytes += nested.bytes
      files += nested.files
    } else {
      bytes += info.size
      files++
    }
  }
  return { bytes, files }
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
