import {
  chmod,
  chown,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import type { Logger } from "pino"
import { z } from "zod"

import {
  codexModelReasoningCatalogSchema,
  runtimeWorkspaceHeader,
  runtimeEnvironmentPath,
  userWorkspacePathSchema,
  linksenseRuntimeIdentity,
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
  workspacePermissionPolicy,
  type CodexModelReasoningCatalog,
} from "@linksense/shared"

import type { RunnerConfig } from "../config.js"
import {
  controllerInstanceKey,
  ownerStorageKey,
  ownerWorkerSecret,
} from "./storage-key.js"
import type {
  WorkerHttpResponse,
  WorkerTransport,
} from "./worker-http-client.js"
import { TURN_START_CONTRACT_VERSION } from "../turn-start-contract.js"
import { prepareConversationControl } from "../workspace/workspace-manager.js"
import {
  userRuntimeDirectories,
  userRuntimePaths,
} from "../user-runtime.js"
import {
  repairWorkspacePermissionsOnce,
  workspacePermissionMarkerName,
} from "./workspace-permission-repair.js"
import {
  assertManagedProjectionBoundary,
  repairRootOwnedManagedProjectionBoundary,
} from "../workspace/shared-access-probe.js"
import {
  removeConversationRuntimeDirectories,
  RuntimeCleanupError,
} from "../runtime-cleanup.js"
import type {
  WorkerInstance,
  WorkerOwnerPaths,
  WorkerProvider,
} from "./worker-provider.js"
import {
  isNodeError,
  probeWorkerName,
  safeChildPath,
  workerName,
} from "./worker-provider-utils.js"

const STARTUP_PROBE_OWNER_ID = "00000000-0000-7000-8000-000000000000"
// Docker Desktop may keep nested bind mounts busy for several seconds after
// container removal has completed. Keep this bounded below the controller
// startup timeout while allowing the mount release to converge.
const USER_DIRECTORY_REMOVAL_ATTEMPTS = 120
const RETRYABLE_DIRECTORY_REMOVAL_CODES = new Set([
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
])
const ownerIdSchema = z.uuid()
const workerStateSchema = z
  .object({
    turn_start_contract_version: z.literal(TURN_START_CONTRACT_VERSION),
    status: z.enum(["available", "unavailable"]),
    checked_at: z.string(),
    workspace: z.object({
      status: z.enum(["available", "unavailable"]),
      reason_code: z.string().nullable(),
      checked_at: z.string(),
    }),
    codex_home: z.object({
      status: z.enum(["available", "unavailable"]),
      reason_code: z.string().nullable(),
      checked_at: z.string(),
    }),
    running_turns: z.number().int().nonnegative(),
    user_processes: z.number().int().nonnegative(),
    app_server_processes: z.number().int().nonnegative(),
    model_catalog: codexModelReasoningCatalogSchema.optional(),
  })
  .passthrough()

export type WorkerHealth = z.infer<typeof workerStateSchema>

type ManagedWorker = WorkerInstance & {
  lastUsedAt: number
  activeRequests: number
  cleanupPending: boolean
}

type TaskOwnedDirectoryPreparationDependencies = {
  mkdir: typeof mkdir
  assertSafeDirectory: typeof assertSafeDirectory
  chown: typeof chown
  chmod: typeof chmod
}

type RuntimeIdentities = {
  apiUid: number
  taskUid: number
  sharedGid: number
}

const taskOwnedDirectoryPreparationDependencies: TaskOwnedDirectoryPreparationDependencies = {
  mkdir,
  assertSafeDirectory,
  chown,
  chmod,
}

export class WorkerManager {
  private readonly workers = new Map<string, ManagedWorker>()
  private readonly locks = new Map<string, Promise<void>>()
  private idleTimer: NodeJS.Timeout | undefined
  private runtimeProbeCheckedAt: string | undefined
  private runtimeModelCatalog: CodexModelReasoningCatalog | undefined

  constructor(
    private readonly config: RunnerConfig,
    private readonly provider: WorkerProvider,
    private readonly transport: WorkerTransport,
    private readonly logger: Logger,
    private readonly options: {
      assertUserDataRoot?: () => Promise<void>
      prepareUserDirectories?: (ownerId: string) => Promise<void>
      assertManagedProjection?: (ownerId: string) => Promise<void>
      repairExistingUserDirectories?: () => Promise<void>
      removeUserDirectories?: (ownerId: string) => Promise<void>
      probeWorkerRuntime?: () => Promise<void>
    } = {},
  ) {}

  async initialize(): Promise<void> {
    this.runtimeProbeCheckedAt = undefined
    this.runtimeModelCatalog = undefined
    await this.assertInfrastructure()
    if (this.options.repairExistingUserDirectories) {
      await this.options.repairExistingUserDirectories()
    } else if (!this.options.prepareUserDirectories) {
      await this.prepareExistingUserDirectories()
    }
    const discoveredWorkers = await this.provider.discover()
    const tasks = discoveredWorkers.map(
      (discovered): (() => Promise<void>) => async () => {
        const worker: ManagedWorker = {
          ...discovered,
          lastUsedAt: Date.now(),
          activeRequests: 0,
          cleanupPending: false,
        }
        try {
          if (this.options.prepareUserDirectories) {
            await this.options.prepareUserDirectories(worker.ownerId)
          } else {
            await this.prepareUserDirectories(worker.ownerId, worker.serviceSessionId)
          }
          await this.assertUserManagedProjection(worker.ownerId, worker.serviceSessionId)
          await this.provider.prepareOwnerFilesystem(
            this.userDirectories(worker.ownerId, worker.serviceSessionId),
          )
          if (worker.state !== "running") {
            Object.assign(worker, await this.provider.resume(worker))
          }
          await this.waitUntilStateReady(worker)
          this.workers.set(worker.storageKey, worker)
        } catch {
          this.workers.set(worker.storageKey, worker)
          await this.releaseManagedWorker(worker)
        }
      },
    )
    await runWithConcurrency(
      tasks,
      Math.min(20, this.config.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS),
    )
    await this.probeWorkerRuntime()
    this.runtimeProbeCheckedAt = new Date().toISOString()
  }

  startIdleReaper(): void {
    if (this.idleTimer) return
    const intervalMs = Math.max(
      1_000,
      Math.min(this.config.LINKSENSE_WORKER_IDLE_TTL_SECONDS * 500, 30_000),
    )
    this.idleTimer = setInterval(() => {
      void this.sweepIdleWorkers().catch((error: unknown) => {
        this.logger.warn(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "worker idle sweep failed",
        )
      })
    }, intervalMs)
    this.idleTimer.unref()
  }

  stopIdleReaper(): void {
    if (!this.idleTimer) return
    clearInterval(this.idleTimer)
    this.idleTimer = undefined
  }

  async stopAllWorkers(): Promise<void> {
    this.stopIdleReaper()
    const workers = [...this.workers.values()]
    const results = await Promise.allSettled(
      workers.map((worker) =>
        this.withLock(worker.storageKey, () =>
          this.releaseManagedWorker(worker),
        ),
      ),
    )
    const failures = results.filter((result) => result.status === "rejected")
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "worker cleanup failed",
      )
    }
  }

  async shutdown(removeWorkers: boolean): Promise<void> {
    this.stopIdleReaper()
    if (removeWorkers || !this.provider.capabilities.persistentWorkers) {
      await this.stopAllWorkers()
    }
    await this.provider.shutdown()
  }

  async request(
    ownerId: string,
    requestPath: string,
    method: string,
    body?: Buffer,
    timeoutMs?: number,
    workspacePath?: string,
    serviceSessionId?: string,
  ): Promise<WorkerHttpResponse> {
    const storageRequest = method === "PUT"
      ? /^\/conversations\/([^/?]+)\/runtime$/u.exec(requestPath)
      : null
    const conversationId = ownerIdSchema.safeParse(storageRequest?.[1])
    if (conversationId.success) {
      const prepared = await this.prepareInactiveRuntime(
        ownerId, conversationId.data, workspacePath ?? "workspace", serviceSessionId,
      )
      if (prepared) return prepared
    }
    const worker = await this.ensureWorker(ownerId, serviceSessionId)
    try {
      return await this.transport.request(
        worker.endpoint,
        requestPath,
        method,
        {
          authorization: `Bearer ${ownerWorkerSecret(ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, serviceSessionId)}`,
          "x-linksense-owner-id": ownerId,
          ...(workspacePath === undefined ? {} : { [runtimeWorkspaceHeader]: userWorkspacePathSchema.parse(workspacePath) }),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body,
        timeoutMs,
      )
    } catch (error) {
      await this.removeStoppedWorker(worker)
      throw error
    } finally {
      await this.releaseWorkerRequest(worker)
    }
  }

  private async prepareInactiveRuntime(
    ownerId: string,
    conversationId: string,
    workspacePath: string,
    serviceSessionId?: string,
  ): Promise<WorkerHttpResponse | null> {
    ownerIdSchema.parse(ownerId)
    ownerIdSchema.optional().parse(serviceSessionId)
    userWorkspacePathSchema.parse(workspacePath)
    const key = ownerStorageKey(ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, serviceSessionId)
    return this.withLock(key, async () => {
      // Live or uncertain processes still need the worker's lifecycle/generation checks.
      if (this.workers.has(key) || await this.provider.hasWorkerForEnvironment(ownerId, serviceSessionId)) {
        return null
      }
      if (this.options.prepareUserDirectories) await this.options.prepareUserDirectories(ownerId)
      else await this.prepareUserDirectories(ownerId, serviceSessionId)
      const directories = this.userDirectories(ownerId, serviceSessionId)
      const identity = this.provider.capabilities.workspaceIdentity
      const workspace = path.join(directories.home, workspacePath)
      const workspaceDirectories = [workspace, ...["attachments", "artifacts", "temp"].map(name => path.join(workspace, name))]
      for (const directory of workspaceDirectories) {
        await prepareTaskOwnedDirectory(
          directories.root, directory, taskOwnedDirectoryPreparationDependencies,
          workspacePermissionPolicy.sharedDirectory, identity,
        )
      }
      const runtime = await prepareConversationControl(directories, conversationId, workspacePath, {
        uid: identity.apiUid, gid: identity.sharedGid,
      })
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          agentsTemplateVersion: this.config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
          ...runtime,
        })),
      }
    })
  }

  /** Publication closes existing processes; it must never provision a cold environment. */
  async closeConversationRuntime(ownerId: string, conversationId: string, serviceSessionId?: string): Promise<WorkerHttpResponse> {
    const validatedOwnerId = ownerIdSchema.parse(ownerId)
    const validatedConversationId = ownerIdSchema.parse(conversationId)
    const session = ownerIdSchema.optional().parse(serviceSessionId)
    const storageKey = ownerStorageKey(validatedOwnerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, session)
    const worker = await this.withLock(storageKey, async () => {
      const existing = this.workers.get(storageKey)
      if (existing?.cleanupPending) throw new RuntimeCleanupError("reconcile", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
      if (existing) {
        existing.activeRequests += 1
        existing.lastUsedAt = Date.now()
        return existing
      }
      try {
        if (await this.provider.hasWorkerForEnvironment(validatedOwnerId, session)) {
          throw new RuntimeCleanupError("reconcile", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
        }
      } catch {
        throw new RuntimeCleanupError("reconcile", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
      }
      return null
    })
    if (!worker) return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ success: true })) }
    try {
      return await this.transport.request(worker.endpoint, `/conversations/${validatedConversationId}/runtime/close`, "POST", {
        authorization: `Bearer ${ownerWorkerSecret(validatedOwnerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, session)}`,
        "x-linksense-owner-id": validatedOwnerId,
      })
    } catch (error) {
      await this.removeStoppedWorker(worker)
      throw error
    } finally {
      await this.releaseWorkerRequest(worker)
    }
  }

  async cleanupConversation(
    ownerId: string,
    conversationId: string,
    serviceSessionId?: string,
    removeServiceEnvironment = false,
  ): Promise<WorkerHttpResponse> {
    const validatedOwnerId = ownerIdSchema.parse(ownerId)
    const validatedConversationId = ownerIdSchema.parse(conversationId)
    if (removeServiceEnvironment) {
      if (!serviceSessionId) {
        throw new RuntimeCleanupError("reconcile", "CLEANUP_PATH_BOUNDARY_INVALID")
      }
      return this.cleanupServiceEnvironment(validatedOwnerId, validatedConversationId, ownerIdSchema.parse(serviceSessionId))
    }
    const storageKey = ownerStorageKey(
      validatedOwnerId,
      this.config.LINKSENSE_RUNNER_SHARED_SECRET,
      serviceSessionId,
    )
    const worker = await this.withLock(storageKey, async () => {
      const existing = this.workers.get(storageKey)
      if (existing?.cleanupPending) {
        await this.releaseManagedWorker(existing)
      } else if (existing) {
        existing.activeRequests += 1
        existing.lastUsedAt = Date.now()
        return existing
      }
      let hasProviderWorker: boolean
      try {
        hasProviderWorker =
          await this.provider.hasWorkerForEnvironment(validatedOwnerId, serviceSessionId)
      } catch {
        throw new RuntimeCleanupError(
          "reconcile",
          "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        )
      }
      if (
        hasProviderWorker
      ) {
        // A worker owned by another controller instance may still be serving
        // this user. Deleting host paths without consulting it could disrupt
        // an active task, so leave the cleanup pending for later reconciliation.
        throw new RuntimeCleanupError(
          "reconcile",
          "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        )
      }
      const directories = this.userDirectories(validatedOwnerId, serviceSessionId)
      try {
        await assertSafeDirectory(directories.root, directories.root)
        const ownerExists = await assertSafeDirectoryIfExists(
          directories.root,
          directories.owner,
        )
        if (ownerExists) {
          const controlExists = await assertSafeDirectoryIfExists(
            directories.root,
            directories.control,
          )
          if (controlExists) {
            await assertSafeDirectoryIfExists(
              directories.root,
              safeChildPath(directories.control, "workspaces"),
            )
          }
        }
        const result = await removeConversationRuntimeDirectories({
          taskControl: safeChildPath(
            safeChildPath(directories.control, "workspaces"),
            validatedConversationId,
          ),
        })
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              success: true,
              runtime: "absent",
              ...result,
            }),
          ),
        } satisfies WorkerHttpResponse
      } catch (error) {
        if (error instanceof RuntimeCleanupError) throw error
        throw new RuntimeCleanupError(
          "reconcile",
          "CLEANUP_PATH_BOUNDARY_INVALID",
        )
      }
    })
    if (!("id" in worker)) return worker
    try {
      return await this.transport.request(
        worker.endpoint,
        `/conversations/${validatedConversationId}/runtime`,
        "DELETE",
        {
          authorization: `Bearer ${ownerWorkerSecret(validatedOwnerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, serviceSessionId)}`,
          "x-linksense-owner-id": validatedOwnerId,
        },
      )
    } catch (error) {
      await this.removeStoppedWorker(worker)
      throw error
    } finally {
      await this.releaseWorkerRequest(worker)
    }
  }

  async prewarm(ownerId: string): Promise<void> {
    const worker = await this.ensureWorker(ownerId)
    await this.releaseWorkerRequest(worker)
  }

  /** The API authorizes this only after the last persisted reference is removed. */
  private async cleanupServiceEnvironment(
    ownerId: string,
    conversationId: string,
    serviceSessionId: string,
  ): Promise<WorkerHttpResponse> {
    const storageKey = ownerStorageKey(ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, serviceSessionId)
    return this.withLock(storageKey, async () => {
      const directories = this.userDirectories(ownerId, serviceSessionId)
      let existed = true
      try {
        await assertSafeDirectory(directories.root, directories.root)
        for (const directory of [
          path.join(directories.root, ownerId),
          path.join(directories.root, ownerId, "services"),
          directories.owner,
        ]) {
          if (!await assertSafeDirectoryIfExists(directories.root, directory)) {
            existed = false
            break
          }
        }
      } catch {
        throw new RuntimeCleanupError("reconcile", "CLEANUP_PATH_BOUNDARY_INVALID")
      }
      const worker = this.workers.get(storageKey)
      if (worker) {
        if (worker.activeRequests !== 0) {
          throw new RuntimeCleanupError("stop_runtime", "CLEANUP_RUNTIME_ACTIVE")
        }
        if (!worker.cleanupPending) {
          let response: WorkerHttpResponse
          try {
            response = await this.transport.request(worker.endpoint, `/conversations/${conversationId}/runtime`, "DELETE", {
              authorization: `Bearer ${ownerWorkerSecret(ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, serviceSessionId)}`,
              "x-linksense-owner-id": ownerId,
            })
          } catch {
            throw new RuntimeCleanupError("stop_runtime", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
          }
          if (response.statusCode !== 200) return response
          let accepted = false
          try {
            accepted = z.object({ success: z.literal(true) })
              .safeParse(JSON.parse(response.body.toString("utf8"))).success
          } catch {
            // Invalid replies cannot authorize filesystem removal.
          }
          if (!accepted) {
            throw new RuntimeCleanupError("stop_runtime", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
          }
        }
        try {
          await this.releaseManagedWorker(worker)
        } catch {
          throw new RuntimeCleanupError("stop_runtime", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
        }
      }
      // Include other controller instances and partially released containers.
      try {
        if (await this.provider.hasWorkerForEnvironment(ownerId, serviceSessionId)) {
          throw new RuntimeCleanupError("reconcile", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
        }
      } catch {
        throw new RuntimeCleanupError("reconcile", "CLEANUP_RUNTIME_STATE_UNCERTAIN")
      }
      if (existed) {
        try {
          await removeUserDirectoryAfterContainerRelease(directories.owner)
        } catch (error) {
          throw new RuntimeCleanupError(
            "delete_workspace",
            isNodeError(error, "EACCES") || isNodeError(error, "EPERM")
              ? "CLEANUP_PERMISSION_DENIED"
              : "CLEANUP_DIRECTORY_REMOVE_FAILED",
          )
        }
        try {
          if (await assertSafeDirectoryIfExists(directories.root, directories.owner)) {
            throw new Error("environment remains")
          }
        } catch {
          throw new RuntimeCleanupError("verify_absent", "CLEANUP_VERIFICATION_FAILED")
        }
      }
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          success: true,
          runtime: "absent",
          environment: existed ? "deleted" : "absent",
        })),
      }
    })
  }

  getModelCatalog(): CodexModelReasoningCatalog | undefined {
    return this.runtimeModelCatalog
  }

  async health(options: { includeResourceUsage?: boolean } = {}): Promise<{
    statusCode: 200 | 503
    body: Record<string, unknown>
  }> {
    const checkedAt = new Date().toISOString()
    let dependenciesAvailable = true
    try {
      await this.assertInfrastructure()
    } catch {
      dependenciesAvailable = false
    }
    const healthResults = await Promise.all(
      [...this.workers.values()].map(async (worker) => {
        if (!worker.ownerId || worker.cleanupPending) {
          return { worker, health: undefined }
        }
        try {
          const health = workerStateSchema.parse(
            JSON.parse(
              (
                await this.transport.request(
                  worker.endpoint,
                  "/health/state",
                  "GET",
                  {
                    authorization: `Bearer ${ownerWorkerSecret(worker.ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, worker.serviceSessionId)}`,
                  },
                )
              ).body.toString("utf8"),
            ),
          )
          return { worker, health }
        } catch {
          return { worker, health: undefined }
        }
      }),
    )
    const providerHealth = await this.provider.healthDetails(
      checkedAt,
      options,
    )
    const runtimeProbeAvailable =
      dependenciesAvailable && this.runtimeProbeCheckedAt !== undefined
    const available =
      runtimeProbeAvailable &&
      healthResults.every((result) => result.health?.status === "available")
    const component = (name: "workspace" | "codex_home") => ({
      status: available ? "available" : "unavailable",
      reason_code: available
        ? null
        : name === "workspace"
          ? "WORKSPACE_ROOT_UNAVAILABLE"
          : "CODEX_HOME_ROOT_UNAVAILABLE",
      checked_at: checkedAt,
    })
    const body = {
      status: available ? "available" : "unavailable",
      turn_start_contract_version: TURN_START_CONTRACT_VERSION,
      checked_at: checkedAt,
      workspace: component("workspace"),
      codex_home: component("codex_home"),
      codex_app_server: {
        status: runtimeProbeAvailable ? "available" : "unavailable",
        reason_code: runtimeProbeAvailable
          ? null
          : "CODEX_APP_SERVER_HANDSHAKE_FAILED",
        checked_at: this.runtimeProbeCheckedAt ?? checkedAt,
        cached: runtimeProbeAvailable,
      },
      running_turns: healthResults.reduce(
        (total, result) => total + (result.health?.running_turns ?? 0),
        0,
      ),
      app_server_processes: healthResults.reduce(
        (total, result) => total + (result.health?.app_server_processes ?? 0),
        0,
      ),
      concurrency_limit: this.config.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS,
      app_server_process_limit:
        this.config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
      process_limit: this.config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
      ...providerHealth,
    }
    return { statusCode: available ? 200 : 503, body }
  }

  async sweepIdleWorkers(now = Date.now()): Promise<void> {
    const ttlMs = this.config.LINKSENSE_WORKER_IDLE_TTL_SECONDS * 1000
    const failures: unknown[] = []
    for (const worker of [...this.workers.values()]) {
      try {
        await this.sweepWorker(worker, now, ttlMs)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, "worker idle cleanup failed")
    }
  }

  private async sweepWorker(
    worker: ManagedWorker,
    now: number,
    ttlMs: number,
  ): Promise<void> {
    if (worker.cleanupPending) {
      await this.withLock(worker.storageKey, () =>
        this.releaseManagedWorker(worker),
      )
      return
    }
    if (now - worker.lastUsedAt < ttlMs) return
    if (!worker.ownerId) return
    let health: WorkerHealth
    try {
      const response = await this.transport.request(
        worker.endpoint,
        "/health/state",
        "GET",
        {
          authorization: `Bearer ${ownerWorkerSecret(worker.ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, worker.serviceSessionId)}`,
        },
      )
      health = workerStateSchema.parse(JSON.parse(response.body.toString("utf8")))
    } catch {
      await this.removeStoppedWorker(worker)
      return
    }
    if (
      health.user_processes !== 0 ||
      health.running_turns !== 0 ||
      health.app_server_processes !== 0
    ) {
      worker.lastUsedAt = now
      return
    }
    await this.withLock(worker.storageKey, async () => {
      if (this.workers.get(worker.storageKey) !== worker) return
      if (worker.activeRequests !== 0) return
      if (now - worker.lastUsedAt < ttlMs) return
      await this.releaseManagedWorker(worker)
    })
  }

  private async assertInfrastructure(): Promise<void> {
    if (this.options.assertUserDataRoot) {
      await this.options.assertUserDataRoot()
    } else {
      await assertSafeDirectory(
        this.config.LINKSENSE_USER_DATA_ROOT,
        this.config.LINKSENSE_USER_DATA_ROOT,
      )
    }
    await this.provider.initialize()
  }

  private async ensureWorker(ownerId: string, serviceSessionId?: string): Promise<ManagedWorker> {
    ownerIdSchema.parse(ownerId)
    if (serviceSessionId) ownerIdSchema.parse(serviceSessionId)
    const storageKey = ownerStorageKey(
      ownerId,
      this.config.LINKSENSE_RUNNER_SHARED_SECRET,
      serviceSessionId,
    )
    return this.withLock(storageKey, async () => {
      const existing = this.workers.get(storageKey)
      if (existing?.cleanupPending) {
        await this.releaseManagedWorker(existing)
      } else if (existing) {
        existing.ownerId = ownerId
        existing.activeRequests += 1
        existing.lastUsedAt = Date.now()
        return existing
      }
      if (this.options.prepareUserDirectories) {
        await this.options.prepareUserDirectories(ownerId)
      } else {
        await this.prepareUserDirectories(ownerId, serviceSessionId)
      }
      await this.assertUserManagedProjection(ownerId, serviceSessionId)
      const name = workerName(
        storageKey,
        controllerInstanceKey(this.config),
      )
      await this.provider.prepareOwnerFilesystem(this.userDirectories(ownerId, serviceSessionId))
      const acquired = await this.provider.acquire({
        ownerId,
        ...(serviceSessionId ? { serviceSessionId } : {}),
        storageKey,
        name,
        probe: false,
      })
      const worker: ManagedWorker = {
        ...acquired,
        lastUsedAt: Date.now(),
        activeRequests: 1,
        cleanupPending: false,
      }
      try {
        // A newly created user worker only needs its HTTP contract and mounted
        // directories before the first request can be routed. The controller's
        // startup probe still performs the full Codex initialize handshake,
        // while the real turn startup remains the final fail-closed check.
        await this.waitUntilStateReady(worker)
        this.workers.set(storageKey, worker)
        return worker
      } catch (error) {
        worker.activeRequests = 0
        this.workers.set(storageKey, worker)
        await this.releaseManagedWorker(worker)
        throw error
      }
    })
  }

  private async removeStoppedWorker(worker: ManagedWorker): Promise<void> {
    let state: WorkerInstance["state"]
    try {
      state = await this.provider.inspect(worker)
    } catch {
      return
    }
    if (state === "running") return
    await this.withLock(worker.storageKey, async () => {
      if (this.workers.get(worker.storageKey) !== worker) return
      await this.releaseManagedWorker(worker)
    })
  }

  // Call under the storage-key lock once the controller is accepting requests.
  // Preserve the only retry handle until provider cleanup is confirmed.
  private async releaseManagedWorker(worker: ManagedWorker): Promise<void> {
    if (this.workers.get(worker.storageKey) !== worker) return
    worker.cleanupPending = true
    await this.provider.release(worker)
    this.workers.delete(worker.storageKey)
  }

  private async releaseWorkerRequest(worker: ManagedWorker): Promise<void> {
    await this.withLock(worker.storageKey, async () => {
      if (this.workers.get(worker.storageKey) !== worker) return
      worker.activeRequests = Math.max(0, worker.activeRequests - 1)
      worker.lastUsedAt = Date.now()
    })
  }

  private async prepareUserDirectories(ownerId: string, serviceSessionId?: string): Promise<void> {
    const directories = this.userDirectories(ownerId, serviceSessionId)
    const identities = this.provider.capabilities.workspaceIdentity
    await assertSafeDirectory(directories.root, directories.root)
    let parent = directories.root
    for (const segment of path.relative(directories.root, directories.owner).split(path.sep)) {
      parent = safeChildPath(parent, segment)
      await mkdir(parent, { mode: 0o770 }).catch(ignoreExistingDirectory)
      await assertSafeDirectory(directories.root, parent)
    }
    await assertSafeDirectory(directories.root, directories.owner)
    await chown(directories.owner, identities.apiUid, identities.sharedGid)
    await chmod(directories.owner, 0o770)

    await mkdir(directories.home, { mode: 0o770 }).catch(
      ignoreExistingDirectory,
    )
    await assertSafeDirectory(directories.root, directories.home)
    await chown(directories.home, identities.taskUid, identities.sharedGid)
    await chmod(directories.home, 0o770)

    const runtimeRoot = safeChildPath(
      safeChildPath(safeChildPath(directories.home, ".local"), "share"),
      "linksense",
    )
    await prepareTaskOwnedDirectory(
      directories.root,
      directories.workspaces,
      taskOwnedDirectoryPreparationDependencies,
      workspacePermissionPolicy.sharedDirectory,
      identities,
    )
    const taskOwnedDirectories = [
      // Health probes run as the supervisor before WorkspaceManager can
      // normalize these task-owned roots, including imported application homes.
      safeChildPath(directories.home, "workspace"),
      safeChildPath(directories.home, ".codex"),
      safeChildPath(directories.home, ".local"),
      safeChildPath(safeChildPath(directories.home, ".local"), "share"),
      ...userRuntimeDirectories(userRuntimePaths(runtimeRoot)),
    ]
    for (const directory of taskOwnedDirectories) {
      await prepareTaskOwnedDirectory(
        directories.root,
        directory,
        taskOwnedDirectoryPreparationDependencies,
        0o770,
        identities,
      )
    }

    await mkdir(directories.control, { mode: 0o700 }).catch(
      ignoreExistingDirectory,
    )
    await assertSafeDirectory(directories.root, directories.control)
    await chown(directories.control, identities.apiUid, identities.sharedGid)
    await chmod(directories.control, 0o700)

    const repair = await repairWorkspacePermissionsOnce({
      workspacesRoot: directories.workspaces,
      markerPath: safeChildPath(
        directories.control,
        workspacePermissionMarkerName,
      ),
      identities,
    })
    if (repair.applied) {
      this.logger.info(
        {
          directories: repair.summary.directories,
          files: repair.summary.files,
          normalizedOwners: repair.summary.normalizedOwners,
          skippedLinks: repair.summary.skippedLinks,
          skippedSpecialEntries: repair.summary.skippedSpecialEntries,
        },
        "repaired legacy workspace permissions",
      )
    }
  }

  private async prepareExistingUserDirectories(): Promise<void> {
    const root = path.resolve(this.config.LINKSENSE_USER_DATA_ROOT)
    const entries = await readdir(root, { withFileTypes: true })
    const ownerIds = entries
      .filter(
        (entry) =>
          entry.isDirectory() && ownerIdSchema.safeParse(entry.name).success,
      )
      .map((entry) => entry.name)
    await runWithConcurrency(
      ownerIds.map((ownerId) => () => this.prepareUserDirectories(ownerId)),
      Math.min(20, this.config.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS),
    )
  }

  private async assertUserManagedProjection(ownerId: string, serviceSessionId?: string): Promise<void> {
    if (this.options.assertManagedProjection) {
      await this.options.assertManagedProjection(ownerId)
      return
    }
    // Tests may replace the complete directory preparation boundary. In
    // production the controller never receives that override and always
    // validates the API-owned projection without changing it.
    if (this.options.prepareUserDirectories) return
    const managedAgentsRoot = this.userDirectories(ownerId, serviceSessionId).managedAgents
    const apiIdentity = {
      uid: this.provider.capabilities.workspaceIdentity.apiUid,
      gid: this.provider.capabilities.workspaceIdentity.sharedGid,
    }
    if (this.provider.capabilities.isolation === "container") {
      await repairRootOwnedManagedProjectionBoundary(
        managedAgentsRoot,
        apiIdentity,
      )
    }
    await assertManagedProjectionBoundary(managedAgentsRoot, apiIdentity, {
      requireExactOwnership:
        this.provider.capabilities.isolation === "container",
    })
  }

  private async prepareSyntheticProbeProjection(ownerId: string): Promise<void> {
    if (ownerId !== STARTUP_PROBE_OWNER_ID) {
      throw new Error("synthetic projection is reserved for the startup probe")
    }
    if (this.options.prepareUserDirectories) return
    const directories = this.userDirectories(ownerId)
    const identities = this.provider.capabilities.workspaceIdentity
    for (const directory of [
      directories.managed,
      directories.managedAgents,
      directories.managedSkills,
      directories.managedPluginSources,
      directories.managedPlugins,
    ]) {
      await prepareApiOwnedDirectory(directories.root, directory, identities)
    }
    const markerPath = safeChildPath(
      directories.managedAgents,
      managedProjectionProbeFileName,
    )
    await writeFile(markerPath, managedProjectionProbeContents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o640,
    }).catch((error: unknown) => {
      if (!isNodeError(error, "EEXIST")) throw error
    })
    await chown(markerPath, identities.apiUid, identities.sharedGid)
    await chmod(markerPath, 0o640)
    await assertManagedProjectionBoundary(
      directories.managedAgents,
      { uid: identities.apiUid, gid: identities.sharedGid },
      {
        requireExactOwnership:
          this.provider.capabilities.isolation === "container",
      },
    )
  }

  private async removeUserDirectories(ownerId: string): Promise<void> {
    if (this.options.removeUserDirectories) {
      await this.options.removeUserDirectories(ownerId)
      return
    }
    const directories = this.userDirectories(ownerId)
    const owner = await lstat(directories.owner).catch(
      (error: unknown) => {
        if (isNodeError(error, "ENOENT")) return undefined
        throw error
      },
    )
    if (!owner) return
    await assertSafeDirectory(directories.root, directories.owner)
    await removeUserDirectoryAfterContainerRelease(directories.owner)
  }

  private userDirectories(ownerId: string, serviceSessionId?: string): WorkerOwnerPaths {
    const validatedOwnerId = ownerIdSchema.parse(ownerId)
    const root = path.resolve(this.config.LINKSENSE_USER_DATA_ROOT)
    const owner = safeChildPath(root, runtimeEnvironmentPath(validatedOwnerId, serviceSessionId))
    const home = safeChildPath(owner, "home")
    const managed = safeChildPath(owner, "managed")
    const managedAgents = safeChildPath(managed, "agents")
    return {
      root,
      owner,
      home,
      homeAgentsMountpoint: safeChildPath(home, ".agents"),
      managed,
      managedAgents,
      managedSkills: safeChildPath(managedAgents, "skills"),
      managedPluginSources: safeChildPath(
        managedAgents,
        "plugin-sources",
      ),
      managedPlugins: safeChildPath(managedAgents, "plugins"),
      control: safeChildPath(owner, "control"),
      workspaces: safeChildPath(home, "projects"),
    }
  }

  private async probeWorkerRuntime(): Promise<void> {
    if (this.options.probeWorkerRuntime) {
      await this.options.probeWorkerRuntime()
      return
    }

    const ownerId = STARTUP_PROBE_OWNER_ID
    const storageKey = ownerStorageKey(
      ownerId,
      this.config.LINKSENSE_RUNNER_SHARED_SECRET,
    )
    const name = probeWorkerName(
      storageKey,
      controllerInstanceKey(this.config),
    )
    let worker: ManagedWorker | undefined
    let workerRemoved = true
    try {
      if (this.options.prepareUserDirectories) {
        await this.options.prepareUserDirectories(ownerId)
      } else {
        await this.prepareUserDirectories(ownerId)
      }
      await this.prepareSyntheticProbeProjection(ownerId)
      await this.provider.prepareOwnerFilesystem(this.userDirectories(ownerId))
      const acquired = await this.provider.acquire({
        ownerId,
        storageKey,
        name,
        probe: true,
      })
      worker = {
        ...acquired,
        lastUsedAt: Date.now(),
        activeRequests: 0,
        cleanupPending: false,
      }
      workerRemoved = false
      const health = await this.waitUntilReady(worker)
      this.runtimeModelCatalog = health.model_catalog
    } finally {
      if (worker) {
        this.workers.set(worker.storageKey, worker)
        await this.releaseManagedWorker(worker)
        workerRemoved = true
      }
      if (workerRemoved) await this.removeUserDirectories(ownerId)
    }
  }

  private async waitUntilReady(worker: ManagedWorker): Promise<WorkerHealth> {
    return this.waitForHealthPath(worker, "/health/ready")
  }

  private async waitUntilStateReady(worker: ManagedWorker): Promise<WorkerHealth> {
    return this.waitForHealthPath(worker, "/health/state")
  }

  private async waitForHealthPath(
    worker: ManagedWorker,
    healthPath: "/health/ready" | "/health/state",
  ): Promise<WorkerHealth> {
    const deadline =
      Date.now() + this.config.LINKSENSE_WORKER_READY_TIMEOUT_SECONDS * 1000
    while (Date.now() < deadline) {
      try {
        const response = await this.transport.request(
          worker.endpoint,
          healthPath,
          "GET",
          {
            authorization: `Bearer ${ownerWorkerSecret(worker.ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET, worker.serviceSessionId)}`,
          },
        )
        if (response.statusCode === 200) {
          return parseWorkerState(response)
        }
      } catch (error) {
        if (error instanceof WorkerContractVersionMismatchError) throw error
        // Provider networking and app startup become available asynchronously.
      }
      const state = await this.provider.inspect(worker).catch(() => "running" as const)
      if (state !== "running") {
        throw new WorkerExitedBeforeReadinessError()
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error("worker readiness timed out")
  }

  private withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.locks.set(key, tail)
    return previous.then(operation).finally(() => {
      release()
      if (this.locks.get(key) === tail) this.locks.delete(key)
    })
  }
}

export async function prepareTaskOwnedDirectory(
  userDataRoot: string,
  directory: string,
  dependencies: TaskOwnedDirectoryPreparationDependencies =
    taskOwnedDirectoryPreparationDependencies,
  mode = 0o770,
  identities: RuntimeIdentities = linksenseRuntimeIdentity,
): Promise<void> {
  await dependencies.mkdir(directory, { mode }).catch(
    ignoreExistingDirectory,
  )
  await dependencies.assertSafeDirectory(userDataRoot, directory)
  await dependencies.chown(
    directory,
    identities.taskUid,
    identities.sharedGid,
  )
  await dependencies.chmod(directory, mode)
}

async function prepareApiOwnedDirectory(
  userDataRoot: string,
  directory: string,
  identities: RuntimeIdentities = linksenseRuntimeIdentity,
): Promise<void> {
  await mkdir(directory, { mode: 0o750 }).catch(ignoreExistingDirectory)
  await assertSafeDirectory(userDataRoot, directory)
  await chown(directory, identities.apiUid, identities.sharedGid)
  await chmod(directory, 0o750)
}

export async function removeUserDirectoryAfterContainerRelease(
  directory: string,
  options: {
    remove?: (
      target: string,
      removeOptions: { recursive: true; force: true },
    ) => Promise<void>
    wait?: (milliseconds: number) => Promise<void>
  } = {},
): Promise<void> {
  const remove = options.remove ?? rm
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  for (let attempt = 1; attempt <= USER_DIRECTORY_REMOVAL_ATTEMPTS; attempt += 1) {
    try {
      await remove(directory, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        attempt === USER_DIRECTORY_REMOVAL_ATTEMPTS ||
        !isRetryableDirectoryRemovalError(error)
      ) {
        throw error
      }
      await wait(Math.min(50 * 2 ** (attempt - 1), 500))
    }
  }
}

function isRetryableDirectoryRemovalError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    RETRYABLE_DIRECTORY_REMOVAL_CODES.has(error.code)
  )
}

export class WorkerContractVersionMismatchError extends Error {
  constructor() {
    super("worker turn-start contract version mismatch")
    this.name = "WorkerContractVersionMismatchError"
  }
}

export class WorkerExitedBeforeReadinessError extends Error {
  constructor() {
    super("worker exited before readiness")
    this.name = "WorkerExitedBeforeReadinessError"
  }
}

export { WorkerExitedBeforeReadinessError as WorkerContainerExitedBeforeReadinessError }

function parseWorkerState(response: WorkerHttpResponse) {
  let body: unknown
  try {
    body = JSON.parse(response.body.toString("utf8"))
  } catch {
    return workerStateSchema.parse(body)
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).turn_start_contract_version !==
      TURN_START_CONTRACT_VERSION
  ) {
    throw new WorkerContractVersionMismatchError()
  }
  return workerStateSchema.parse(body)
}

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next++]!
        await task()
      }
    },
  )
  await Promise.all(workers)
}

async function assertSafeDirectory(root: string, candidate: string): Promise<void> {
  const [rootInfo, candidateInfo] = await Promise.all([
    lstat(root),
    lstat(candidate),
  ])
  if (
    rootInfo.isSymbolicLink() ||
    candidateInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    !candidateInfo.isDirectory()
  ) {
    throw new Error("user data paths must be real directories")
  }
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ])
  if (
    canonicalCandidate !== canonicalRoot &&
    !canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)
  ) {
    throw new Error("user data path resolves outside its configured root")
  }
}

async function assertSafeDirectoryIfExists(
  root: string,
  candidate: string,
): Promise<boolean> {
  try {
    await assertSafeDirectory(root, candidate)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw error
  }
}

function ignoreExistingDirectory(error: unknown): void {
  if (isNodeError(error, "EEXIST")) return
  throw error
}
