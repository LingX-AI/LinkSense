import { createHash } from "node:crypto"
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
  linksenseRuntimeIdentity,
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
  workspacePermissionPolicy,
  type CodexModelReasoningCatalog,
} from "@linksense/shared"

import type { RunnerConfig } from "../config.js"
import type {
  DockerContainerCreate,
  DockerContainerResourceStats,
  DockerContainerSummary,
  DockerEngine,
} from "../docker/engine-client.js"
import {
  controllerInstanceKey,
  ownerStorageKey,
  ownerWorkerSecret,
  workerContractKey,
} from "./storage-key.js"
import type {
  WorkerHttpResponse,
  WorkerTransport,
} from "./worker-http-client.js"
import { TURN_START_CONTRACT_VERSION } from "../turn-start-contract.js"
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

const MANAGED_LABEL = "com.linksense.runner.managed"
const STORAGE_KEY_LABEL = "com.linksense.runner.storage-key"
const OWNER_ID_LABEL = "com.linksense.runner.owner-id"
const CONTRACT_LABEL = "com.linksense.runner.contract"
const INSTANCE_LABEL = "com.linksense.runner.instance"
const PROBE_LABEL = "com.linksense.runner.probe"
const COMPOSE_PROJECT_LABEL = "com.docker.compose.project"
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service"
const STARTUP_PROBE_OWNER_ID = "00000000-0000-7000-8000-000000000000"
const USER_HOME_UID = linksenseRuntimeIdentity.taskUid
const SHARED_GROUP_GID = linksenseRuntimeIdentity.sharedGid
const API_UID = linksenseRuntimeIdentity.apiUid
const TRUSTED_WORKER_SUPERVISOR_CAPABILITIES = [
  "SETUID",
  "KILL",
  "DAC_OVERRIDE",
  "FOWNER",
  "CHOWN",
] as const
// Docker Desktop may keep nested bind mounts busy for several seconds after
// container removal has completed. Keep this bounded below the controller
// startup timeout while allowing the mount release to converge.
const USER_DIRECTORY_REMOVAL_ATTEMPTS = 120
const DOCKER_RESOURCE_USAGE_CACHE_TTL_MS = 60_000
const RETRYABLE_DIRECTORY_REMOVAL_CODES = new Set([
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
])
const observedComposeServices = new Set([
  "api",
  "backup-init",
  "gateway",
  "migrate",
  "postgres",
  "postgres-backup",
  "redis",
  "runner",
  "runner-worker-image",
  "storage-init",
  "web",
])
const resourceServiceOrder = new Map(
  [
    "api",
    "runner",
    "worker_pool",
    "web",
    "gateway",
    "postgres",
    "redis",
    "postgres-backup",
    "migrate",
    "backup-init",
    "storage-init",
    "runner-worker-image",
  ].map((key, index) => [key, index]),
)
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
    app_server_processes: z.number().int().nonnegative(),
    model_catalog: codexModelReasoningCatalogSchema.optional(),
  })
  .passthrough()

export type WorkerHealth = z.infer<typeof workerStateSchema>

type ManagedWorker = {
  containerId: string
  containerName: string
  storageKey: string
  lastUsedAt: number
  activeRequests: number
  ownerId?: string
}

type DockerResourceStatus = "available" | "unavailable" | "not_observed"

type DockerResourceServiceUsage = {
  key: string
  service_type: "compose" | "worker_pool"
  status: DockerResourceStatus
  container_count: number
  running_container_count: number
  cpu_percent: number | null
  memory_used_bytes: number | null
  memory_limit_bytes: number | null
  memory_percent: number | null
  pids: number | null
  state: string | null
}

type DockerResourceUsageSnapshot = {
  status: DockerResourceStatus
  checked_at: string
  reason_code: string | null
  services: DockerResourceServiceUsage[]
}

type ResourceAccumulator = {
  key: string
  serviceType: "compose" | "worker_pool"
  containerCount: number
  runningContainerCount: number
  observedStatsCount: number
  failedStatsCount: number
  cpuObservedCount: number
  memoryUsageObservedCount: number
  memoryLimitObservedCount: number
  pidsObservedCount: number
  cpuPercent: number
  memoryUsedBytes: number
  memoryLimitBytes: number
  pids: number
  states: Set<string>
}

type TaskOwnedDirectoryPreparationDependencies = {
  mkdir: typeof mkdir
  assertSafeDirectory: typeof assertSafeDirectory
  chown: typeof chown
  chmod: typeof chmod
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
  private dockerResourceUsageCache:
    | { expiresAt: number; snapshot: DockerResourceUsageSnapshot }
    | undefined
  private dockerResourceUsageInFlight:
    | Promise<DockerResourceUsageSnapshot>
    | undefined

  constructor(
    private readonly config: RunnerConfig,
    private readonly docker: DockerEngine,
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
    const containers = await this.docker.listManagedContainers()
    const seenStorageKeys = new Set<string>()
    const tasks: Array<() => Promise<void>> = []
    for (const container of containers) {
      const storageKey = container.Labels[STORAGE_KEY_LABEL]
      const ownerId = ownerIdSchema.safeParse(container.Labels[OWNER_ID_LABEL])
      if (
        container.Labels[INSTANCE_LABEL] !==
        controllerInstanceKey(this.config)
      ) {
        continue
      }
      if (container.Labels[PROBE_LABEL] === "true") {
        const probeOwnerId = ownerIdSchema.safeParse(
          container.Labels[OWNER_ID_LABEL],
        )
        tasks.push(() =>
          this.discardProbeContainer(
            container.Id,
            container.State,
            probeOwnerId.success ? probeOwnerId.data : undefined,
          ),
        )
        continue
      }
      if (!storageKey || !ownerId.success) {
        tasks.push(() => this.discardContainer(container.Id, container.State))
        continue
      }
      if (
        container.Labels[CONTRACT_LABEL] !== workerContractKey(this.config) ||
        storageKey !==
          ownerStorageKey(
            ownerId.data,
            this.config.LINKSENSE_RUNNER_SHARED_SECRET,
          )
      ) {
        tasks.push(() => this.discardContainer(container.Id, container.State))
        continue
      }
      if (seenStorageKeys.has(storageKey)) {
        tasks.push(() => this.discardContainer(container.Id, container.State))
        continue
      }
      seenStorageKeys.add(storageKey)
      const worker: ManagedWorker = {
        containerId: container.Id,
        containerName:
          container.Names[0]?.replace(/^\//u, "") ??
          workerName(storageKey, controllerInstanceKey(this.config)),
        storageKey,
        lastUsedAt: Date.now(),
        activeRequests: 0,
        ownerId: ownerId.data,
      }
      tasks.push(async () => {
        try {
          if (this.options.prepareUserDirectories) {
            await this.options.prepareUserDirectories(ownerId.data)
          } else {
            await this.prepareUserDirectories(ownerId.data)
          }
          await this.assertUserManagedProjection(ownerId.data)
          if (container.State !== "running") {
            await this.docker.startContainer(container.Id)
          }
          await this.waitUntilStateReady(worker)
          this.workers.set(storageKey, worker)
        } catch {
          await this.discardContainer(container.Id, container.State)
        }
      })
    }
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
    this.workers.clear()
    await Promise.all(
      workers.map(async (worker) => {
        await this.docker.stopContainer(worker.containerId).catch(() => undefined)
        await this.docker.removeContainer(worker.containerId).catch(() => undefined)
      }),
    )
  }

  async request(
    ownerId: string,
    requestPath: string,
    method: string,
    body?: Buffer,
    timeoutMs?: number,
  ): Promise<WorkerHttpResponse> {
    const worker = await this.ensureWorker(ownerId)
    try {
      return await this.transport.request(
        workerBaseUrl(worker, this.config.LINKSENSE_WORKER_PORT),
        requestPath,
        method,
        {
          authorization: `Bearer ${ownerWorkerSecret(ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET)}`,
          "x-linksense-owner-id": ownerId,
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

  async cleanupConversation(
    ownerId: string,
    conversationId: string,
  ): Promise<WorkerHttpResponse> {
    const validatedOwnerId = ownerIdSchema.parse(ownerId)
    const validatedConversationId = ownerIdSchema.parse(conversationId)
    const storageKey = ownerStorageKey(
      validatedOwnerId,
      this.config.LINKSENSE_RUNNER_SHARED_SECRET,
    )
    const worker = await this.withLock(storageKey, async () => {
      const existing = this.workers.get(storageKey)
      if (existing) {
        existing.activeRequests += 1
        existing.lastUsedAt = Date.now()
        return existing
      }
      let managedContainers: DockerContainerSummary[]
      try {
        managedContainers = await this.docker.listManagedContainers()
      } catch {
        throw new RuntimeCleanupError(
          "reconcile",
          "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        )
      }
      if (
        managedContainers.some(
          (container) =>
            container.Labels[OWNER_ID_LABEL] === validatedOwnerId &&
            container.Labels[PROBE_LABEL] !== "true",
        )
      ) {
        // A worker owned by another controller instance may still be serving
        // this user. Deleting host paths without consulting it could disrupt
        // an active task, so leave the cleanup pending for later reconciliation.
        throw new RuntimeCleanupError(
          "reconcile",
          "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        )
      }
      const directories = this.userDirectories(validatedOwnerId)
      try {
        await assertSafeDirectory(directories.root, directories.root)
        const ownerExists = await assertSafeDirectoryIfExists(
          directories.root,
          directories.owner,
        )
        if (ownerExists) {
          const homeExists = await assertSafeDirectoryIfExists(
            directories.root,
            directories.home,
          )
          if (homeExists) {
            await assertSafeDirectoryIfExists(
              directories.root,
              safeChildPath(directories.home, "task-homes"),
            )
            await assertSafeDirectoryIfExists(
              directories.root,
              directories.workspaces,
            )
          }
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
          home: safeChildPath(safeChildPath(directories.home, "task-homes"), validatedConversationId),
          workspace: safeChildPath(
            directories.workspaces,
            validatedConversationId,
          ),
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
    if (!("containerId" in worker)) return worker
    try {
      return await this.transport.request(
        workerBaseUrl(worker, this.config.LINKSENSE_WORKER_PORT),
        `/conversations/${validatedConversationId}/runtime`,
        "DELETE",
        {
          authorization: `Bearer ${ownerWorkerSecret(validatedOwnerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET)}`,
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
        if (!worker.ownerId) return { worker, health: undefined }
        try {
          const health = workerStateSchema.parse(
            JSON.parse(
              (
                await this.transport.request(
                  workerBaseUrl(worker, this.config.LINKSENSE_WORKER_PORT),
                  "/health/state",
                  "GET",
                  {
                    authorization: `Bearer ${ownerWorkerSecret(worker.ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET)}`,
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
    const dockerResourceUsage = options.includeResourceUsage === false
      ? undefined
      : await this.cachedDockerResourceUsage(checkedAt)
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
      ...(dockerResourceUsage ? { docker_resource_usage: dockerResourceUsage } : {}),
    }
    return { statusCode: available ? 200 : 503, body }
  }

  async sweepIdleWorkers(now = Date.now()): Promise<void> {
    const ttlMs = this.config.LINKSENSE_WORKER_IDLE_TTL_SECONDS * 1000
    for (const worker of [...this.workers.values()]) {
      if (now - worker.lastUsedAt < ttlMs) continue
      if (!worker.ownerId) continue
      let health: WorkerHealth
      try {
        const response = await this.transport.request(
          workerBaseUrl(worker, this.config.LINKSENSE_WORKER_PORT),
          "/health/state",
          "GET",
          {
            authorization: `Bearer ${ownerWorkerSecret(worker.ownerId, this.config.LINKSENSE_RUNNER_SHARED_SECRET)}`,
          },
        )
        health = workerStateSchema.parse(JSON.parse(response.body.toString("utf8")))
      } catch {
        await this.removeStoppedWorker(worker)
        continue
      }
      if (
        health.running_turns !== 0 ||
        health.app_server_processes !== 0
      ) {
        worker.lastUsedAt = now
        continue
      }
      await this.withLock(worker.storageKey, async () => {
        if (this.workers.get(worker.storageKey) !== worker) return
        if (worker.activeRequests !== 0) return
        if (now - worker.lastUsedAt < ttlMs) return
        await this.docker.stopContainer(worker.containerId)
        await this.docker.removeContainer(worker.containerId)
        this.workers.delete(worker.storageKey)
      })
    }
  }

  private async assertInfrastructure(): Promise<void> {
    await this.docker.assertCompatible()
    if (this.options.assertUserDataRoot) {
      await this.options.assertUserDataRoot()
    } else {
      await assertSafeDirectory(
        this.config.LINKSENSE_USER_DATA_ROOT,
        this.config.LINKSENSE_USER_DATA_ROOT,
      )
    }
    const checks = [
      this.docker.inspectImage(this.config.LINKSENSE_WORKER_IMAGE),
      this.docker.inspectNetwork(this.config.LINKSENSE_WORKER_CONTROL_NETWORK),
      this.docker.inspectNetwork(this.config.LINKSENSE_WORKER_EGRESS_NETWORK),
    ]
    if (this.config.LINKSENSE_USER_DATA_VOLUME) {
      checks.push(
        this.docker.inspectVolume(this.config.LINKSENSE_USER_DATA_VOLUME),
      )
    }
    await Promise.all(checks)
  }

  private async collectDockerResourceUsage(
    checkedAt: string,
  ): Promise<DockerResourceUsageSnapshot> {
    try {
      const [composeContainers, managedContainers] = await Promise.all([
        this.docker.listContainersByLabels([
          `${COMPOSE_PROJECT_LABEL}=${this.config.LINKSENSE_DOCKER_COMPOSE_PROJECT_NAME}`,
        ]),
        this.docker.listManagedContainers(),
      ])
      const groups = new Map<string, ResourceAccumulator>()
      const observedContainers: Array<{
        group: ResourceAccumulator
        container: DockerContainerSummary
      }> = []
      for (const container of composeContainers) {
        const service = container.Labels[COMPOSE_SERVICE_LABEL]
        if (!isObservedComposeService(service)) continue
        observedContainers.push({
          group: addContainerToResourceGroup(
            groups,
            service,
            "compose",
            container,
          ),
          container,
        })
      }
      const instanceKey = controllerInstanceKey(this.config)
      for (const container of managedContainers) {
        if (container.Labels[INSTANCE_LABEL] !== instanceKey) continue
        if (container.Labels[PROBE_LABEL] === "true") continue
        observedContainers.push({
          group: addContainerToResourceGroup(
            groups,
            "worker_pool",
            "worker_pool",
            container,
          ),
          container,
        })
      }
      if (!groups.has("worker_pool")) {
        groups.set(
          "worker_pool",
          createResourceAccumulator("worker_pool", "worker_pool"),
        )
      }
      await Promise.all(
        observedContainers.map(({ group, container }) =>
          this.observeDockerContainerResource(group, container),
        ),
      )
      const services = [...groups.values()]
        .map(toDockerResourceServiceUsage)
        .sort(compareResourceServices)
      const status = services.some((service) => service.status === "available")
        ? "available"
        : services.some((service) => service.status === "unavailable")
          ? "unavailable"
          : "not_observed"
      return {
        status,
        checked_at: checkedAt,
        reason_code:
          status === "unavailable" ? "DOCKER_RESOURCE_USAGE_UNAVAILABLE" : null,
        services,
      }
    } catch (error) {
      this.logger.debug(
        { errorClass: error instanceof Error ? error.name : "unknown" },
        "docker resource usage probe failed",
      )
      return {
        status: "unavailable",
        checked_at: checkedAt,
        reason_code: "DOCKER_RESOURCE_USAGE_UNAVAILABLE",
        services: [],
      }
    }
  }

  private async cachedDockerResourceUsage(
    checkedAt: string,
  ): Promise<DockerResourceUsageSnapshot> {
    const now = Date.now()
    if (
      this.dockerResourceUsageCache &&
      this.dockerResourceUsageCache.expiresAt > now
    ) {
      return this.dockerResourceUsageCache.snapshot
    }
    if (this.dockerResourceUsageInFlight) {
      return this.dockerResourceUsageInFlight
    }
    this.dockerResourceUsageInFlight = this.collectDockerResourceUsage(checkedAt)
    try {
      const snapshot = await this.dockerResourceUsageInFlight
      this.dockerResourceUsageCache = {
        expiresAt: Date.now() + DOCKER_RESOURCE_USAGE_CACHE_TTL_MS,
        snapshot,
      }
      return snapshot
    } finally {
      this.dockerResourceUsageInFlight = undefined
    }
  }

  private async observeDockerContainerResource(
    group: ResourceAccumulator,
    container: DockerContainerSummary,
  ): Promise<void> {
    if (container.State !== "running") return
    try {
      const stats = await this.docker.inspectContainerResourceStats(container.Id)
      applyContainerResourceStats(group, stats)
    } catch {
      group.failedStatsCount += 1
    }
  }

  private async ensureWorker(ownerId: string): Promise<ManagedWorker> {
    ownerIdSchema.parse(ownerId)
    const storageKey = ownerStorageKey(
      ownerId,
      this.config.LINKSENSE_RUNNER_SHARED_SECRET,
    )
    return this.withLock(storageKey, async () => {
      const existing = this.workers.get(storageKey)
      if (existing) {
        existing.ownerId = ownerId
        existing.activeRequests += 1
        existing.lastUsedAt = Date.now()
        return existing
      }
      if (this.options.prepareUserDirectories) {
        await this.options.prepareUserDirectories(ownerId)
      } else {
        await this.prepareUserDirectories(ownerId)
      }
      await this.assertUserManagedProjection(ownerId)
      const containerName = workerName(
        storageKey,
        controllerInstanceKey(this.config),
      )
      const containerId = await this.docker.createContainer(
        containerName,
        buildWorkerContainerSpec(this.config, ownerId, storageKey, containerName),
      )
      try {
        await this.docker.startContainer(containerId)
        const worker: ManagedWorker = {
          containerId,
          containerName,
          storageKey,
          lastUsedAt: Date.now(),
          activeRequests: 1,
          ownerId,
        }
        // A newly created user worker only needs its HTTP contract and mounted
        // directories before the first request can be routed. The controller's
        // startup probe still performs the full Codex initialize handshake,
        // while the real turn startup remains the final fail-closed check.
        await this.waitUntilStateReady(worker)
        this.workers.set(storageKey, worker)
        return worker
      } catch (error) {
        await this.docker.removeContainer(containerId).catch(() => undefined)
        throw error
      }
    })
  }

  private async discardContainer(id: string, state: string): Promise<void> {
    if (state === "running") {
      await this.docker.stopContainer(id).catch(() => undefined)
    }
    await this.docker.removeContainer(id).catch(() => undefined)
  }

  private async discardProbeContainer(
    id: string,
    state: string,
    ownerId: string | undefined,
  ): Promise<void> {
    if (state === "running") {
      await this.docker.stopContainer(id).catch(() => undefined)
    }
    await this.docker.removeContainer(id)
    // Only the fixed, controller-reserved probe owner may be deleted here.
    // A stale or forged probe label must never turn container cleanup into
    // deletion of an arbitrary real user's persistent storage domain.
    if (ownerId === STARTUP_PROBE_OWNER_ID) {
      await this.removeUserDirectories(ownerId)
    }
  }

  private async removeStoppedWorker(worker: ManagedWorker): Promise<void> {
    let running: boolean
    try {
      running = await this.docker.inspectContainerRunning(worker.containerId)
    } catch {
      return
    }
    if (running) return
    await this.withLock(worker.storageKey, async () => {
      if (this.workers.get(worker.storageKey) !== worker) return
      this.workers.delete(worker.storageKey)
      await this.docker.removeContainer(worker.containerId).catch(() => undefined)
    })
  }

  private async releaseWorkerRequest(worker: ManagedWorker): Promise<void> {
    await this.withLock(worker.storageKey, async () => {
      if (this.workers.get(worker.storageKey) !== worker) return
      worker.activeRequests = Math.max(0, worker.activeRequests - 1)
      worker.lastUsedAt = Date.now()
    })
  }

  private async prepareUserDirectories(ownerId: string): Promise<void> {
    const directories = this.userDirectories(ownerId)
    await assertSafeDirectory(directories.root, directories.root)
    await mkdir(directories.owner, { mode: 0o770 }).catch(
      ignoreExistingDirectory,
    )
    await assertSafeDirectory(directories.root, directories.owner)
    await chown(directories.owner, API_UID, SHARED_GROUP_GID)
    await chmod(directories.owner, 0o770)

    await mkdir(directories.home, { mode: 0o770 }).catch(
      ignoreExistingDirectory,
    )
    await assertSafeDirectory(directories.root, directories.home)
    await chown(directories.home, USER_HOME_UID, SHARED_GROUP_GID)
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
    )
    const taskOwnedDirectories = [
      safeChildPath(directories.home, ".local"),
      safeChildPath(safeChildPath(directories.home, ".local"), "share"),
      ...userRuntimeDirectories(userRuntimePaths(runtimeRoot)),
    ]
    for (const directory of taskOwnedDirectories) {
      await prepareTaskOwnedDirectory(directories.root, directory)
    }

    await prepareTaskOwnedDirectory(
      directories.root,
      directories.homeAgentsMountpoint,
      taskOwnedDirectoryPreparationDependencies,
      0o750,
    )
    await prepareTaskOwnedDirectory(directories.root, directories.taskHomes)

    await mkdir(directories.control, { mode: 0o700 }).catch(
      ignoreExistingDirectory,
    )
    await assertSafeDirectory(directories.root, directories.control)
    await chown(directories.control, API_UID, SHARED_GROUP_GID)
    await chmod(directories.control, 0o700)

    const repair = await repairWorkspacePermissionsOnce({
      workspacesRoot: directories.workspaces,
      markerPath: safeChildPath(
        directories.control,
        workspacePermissionMarkerName,
      ),
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

  private async assertUserManagedProjection(ownerId: string): Promise<void> {
    if (this.options.assertManagedProjection) {
      await this.options.assertManagedProjection(ownerId)
      return
    }
    // Tests may replace the complete directory preparation boundary. In
    // production the controller never receives that override and always
    // validates the API-owned projection without changing it.
    if (this.options.prepareUserDirectories) return
    const managedAgentsRoot = this.userDirectories(ownerId).managedAgents
    await repairRootOwnedManagedProjectionBoundary(managedAgentsRoot)
    await assertManagedProjectionBoundary(managedAgentsRoot)
  }

  private async prepareSyntheticProbeProjection(ownerId: string): Promise<void> {
    if (ownerId !== STARTUP_PROBE_OWNER_ID) {
      throw new Error("synthetic projection is reserved for the startup probe")
    }
    if (this.options.prepareUserDirectories) return
    const directories = this.userDirectories(ownerId)
    for (const directory of [
      directories.managed,
      directories.managedAgents,
      directories.managedSkills,
      directories.managedPluginSources,
      directories.managedPlugins,
    ]) {
      await prepareApiOwnedDirectory(directories.root, directory)
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
    await chown(markerPath, API_UID, SHARED_GROUP_GID)
    await chmod(markerPath, 0o640)
    await assertManagedProjectionBoundary(directories.managedAgents)
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

  private userDirectories(ownerId: string): {
    root: string
    owner: string
    home: string
    homeAgentsMountpoint: string
    taskHomes: string
    managed: string
    managedAgents: string
    managedSkills: string
    managedPluginSources: string
    managedPlugins: string
    control: string
    workspaces: string
  } {
    const validatedOwnerId = ownerIdSchema.parse(ownerId)
    const root = path.resolve(this.config.LINKSENSE_USER_DATA_ROOT)
    const owner = safeChildPath(root, validatedOwnerId)
    const home = safeChildPath(owner, "home")
    const managed = safeChildPath(owner, "managed")
    const managedAgents = safeChildPath(managed, "agents")
    return {
      root,
      owner,
      home,
      homeAgentsMountpoint: safeChildPath(home, ".agents"),
      taskHomes: safeChildPath(home, "task-homes"),
      managed,
      managedAgents,
      managedSkills: safeChildPath(managedAgents, "skills"),
      managedPluginSources: safeChildPath(
        managedAgents,
        "plugin-sources",
      ),
      managedPlugins: safeChildPath(managedAgents, "plugins"),
      control: safeChildPath(owner, "control"),
      workspaces: safeChildPath(home, "workspaces"),
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
    const containerName = probeWorkerName(
      storageKey,
      controllerInstanceKey(this.config),
    )
    let containerId: string | undefined
    let containerRemoved = true
    try {
      if (this.options.prepareUserDirectories) {
        await this.options.prepareUserDirectories(ownerId)
      } else {
        await this.prepareUserDirectories(ownerId)
      }
      await this.prepareSyntheticProbeProjection(ownerId)
      const spec = buildWorkerContainerSpec(
        this.config,
        ownerId,
        storageKey,
        containerName,
      )
      spec.Labels[PROBE_LABEL] = "true"
      containerId = await this.docker.createContainer(containerName, spec)
      containerRemoved = false
      await this.docker.startContainer(containerId)
      const health = await this.waitUntilReady({
        containerId,
        containerName,
        storageKey,
        lastUsedAt: Date.now(),
        activeRequests: 0,
        ownerId,
      })
      this.runtimeModelCatalog = health.model_catalog
    } finally {
      if (containerId) {
        await this.docker.stopContainer(containerId).catch(() => undefined)
        await this.docker.removeContainer(containerId)
        containerRemoved = true
      }
      if (containerRemoved) await this.removeUserDirectories(ownerId)
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
          workerBaseUrl(worker, this.config.LINKSENSE_WORKER_PORT),
          healthPath,
          "GET",
          {
            authorization: `Bearer ${ownerWorkerSecret(worker.ownerId!, this.config.LINKSENSE_RUNNER_SHARED_SECRET)}`,
          },
        )
        if (response.statusCode === 200) {
          return parseWorkerState(response)
        }
      } catch (error) {
        if (error instanceof WorkerContractVersionMismatchError) throw error
        // Container DNS and app startup become available asynchronously.
      }
      const containerRunning = await this.docker
        .inspectContainerRunning(worker.containerId)
        .catch(() => true)
      if (!containerRunning) {
        throw new WorkerContainerExitedBeforeReadinessError()
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
): Promise<void> {
  await dependencies.mkdir(directory, { mode }).catch(
    ignoreExistingDirectory,
  )
  await dependencies.assertSafeDirectory(userDataRoot, directory)
  await dependencies.chown(
    directory,
    USER_HOME_UID,
    SHARED_GROUP_GID,
  )
  await dependencies.chmod(directory, mode)
}

async function prepareApiOwnedDirectory(
  userDataRoot: string,
  directory: string,
): Promise<void> {
  await mkdir(directory, { mode: 0o750 }).catch(ignoreExistingDirectory)
  await assertSafeDirectory(userDataRoot, directory)
  await chown(directory, API_UID, SHARED_GROUP_GID)
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

export class WorkerContainerExitedBeforeReadinessError extends Error {
  constructor() {
    super("worker container exited before readiness")
    this.name = "WorkerContainerExitedBeforeReadinessError"
  }
}

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

export function buildWorkerContainerSpec(
  config: RunnerConfig,
  ownerId: string,
  storageKey: string,
  containerName = workerName(storageKey, controllerInstanceKey(config)),
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
): DockerContainerCreate {
  const validatedOwnerId = ownerIdSchema.parse(ownerId)
  const userDataRoot = path.resolve(config.LINKSENSE_USER_DATA_ROOT)
  if (!path.isAbsolute(config.LINKSENSE_USER_DATA_ROOT)) {
    throw new Error("LINKSENSE_USER_DATA_ROOT must be absolute")
  }
  const ownerRoot = safeChildPath(userDataRoot, validatedOwnerId)
  const workerHome = "/home/linksense"
  const workerControlRoot = "/run/linksense-control"
  const ownerMount = (
    relativePath: string,
    target: string,
    readOnly = false,
  ) =>
    config.LINKSENSE_USER_DATA_VOLUME
      ? volumeMount(
          config.LINKSENSE_USER_DATA_VOLUME,
          safeVolumeSubpath(validatedOwnerId, relativePath),
          target,
          readOnly,
        )
      : bindMount(
          safeChildPath(ownerRoot, relativePath),
          target,
          readOnly,
        )
  const mounts = [
    ownerMount("home", workerHome),
    ownerMount("managed/agents", `${workerHome}/.agents`, true),
    ownerMount("control", workerControlRoot),
  ]
  return {
    Image: config.LINKSENSE_WORKER_IMAGE,
    // Docker starts the command as 0:1000. With Init enabled, docker-init stays
    // PID 1 and the image CMD drops the Node supervisor to 1000:1000 while
    // retaining only the capabilities needed to launch and reap uid 1001 tasks.
    User: "0:1000",
    Env: Object.entries({
      HOME: workerHome,
      CODEX_HOME: `${workerControlRoot}/supervisor-codex`,
      LINKSENSE_RUNNER_MODE: "worker",
      LINKSENSE_WORKER_OWNER_ID: validatedOwnerId,
      LINKSENSE_USER_DATA_ROOT: workerHome,
      LINKSENSE_RUNNER_SHARED_SECRET: ownerWorkerSecret(
        ownerId,
        config.LINKSENSE_RUNNER_SHARED_SECRET,
      ),
      LINKSENSE_API_INTERNAL_URL: config.LINKSENSE_CONTROLLER_INTERNAL_URL,
      LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: String(
        config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
      ),
      LINKSENSE_RUNNER_HOST: "0.0.0.0",
      LINKSENSE_RUNNER_PORT: String(config.LINKSENSE_WORKER_PORT),
      LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: String(
        config.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS,
      ),
      LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: String(
        config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
      ),
      LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS: String(
        config.LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS,
      ),
      LINKSENSE_AGENTS_TEMPLATE_VERSION:
        config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
      LINKSENSE_CODEX_HOME_TEMPLATE: "/opt/linksense/codex-home-template",
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
      CODEX_BIN: config.CODEX_BIN,
      ...allowedWorkerEnvironment(sourceEnvironment),
    }).map(([key, value]) => `${key}=${value}`),
    Labels: {
      [MANAGED_LABEL]: "true",
      [STORAGE_KEY_LABEL]: storageKey,
      [OWNER_ID_LABEL]: ownerId,
      [CONTRACT_LABEL]: workerContractKey(config),
      [INSTANCE_LABEL]: controllerInstanceKey(config),
    },
    ExposedPorts: { [`${config.LINKSENSE_WORKER_PORT}/tcp`]: {} },
    HostConfig: {
      ReadonlyRootfs: true,
      Init: true,
      CapDrop: ["ALL"],
      // The trusted supervisor must be able to normalize task-owned mounted
      // entries even after Codex atomically replaces them with mode 0600/0000.
      // Task children separately clear every capability before becoming uid 1001.
      CapAdd: [...TRUSTED_WORKER_SUPERVISOR_CAPABILITIES],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: config.LINKSENSE_WORKER_PIDS_LIMIT,
      Memory: config.LINKSENSE_WORKER_MEMORY_MB * 1024 * 1024,
      // Equal memory and memory+swap limits disable additional container swap,
      // so the configured worker ceiling is not silently doubled by Docker.
      MemorySwap: config.LINKSENSE_WORKER_MEMORY_MB * 1024 * 1024,
      NanoCpus: Math.round(config.LINKSENSE_WORKER_CPUS * 1_000_000_000),
      Tmpfs: {
        "/tmp": `rw,nosuid,nodev,noexec,size=${config.LINKSENSE_WORKER_TMPFS_MB}m,uid=1000,gid=1000,mode=1777`,
        "/run": "rw,nosuid,nodev,noexec,size=16m,uid=0,gid=1000,mode=770",
        "/dev/shm": `rw,nosuid,nodev,noexec,size=${config.LINKSENSE_WORKER_SHM_MB}m,uid=0,gid=0,mode=1777`,
      },
      Mounts: mounts,
      Binds: [],
      NetworkMode: config.LINKSENSE_WORKER_CONTROL_NETWORK,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [config.LINKSENSE_WORKER_CONTROL_NETWORK]: { Aliases: [containerName] },
        [config.LINKSENSE_WORKER_EGRESS_NETWORK]: {},
      },
    },
  }
}

function allowedWorkerEnvironment(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const keys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ] as const
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]!]],
    ),
  )
}

function isObservedComposeService(value: unknown): value is string {
  return typeof value === "string" && observedComposeServices.has(value)
}

function addContainerToResourceGroup(
  groups: Map<string, ResourceAccumulator>,
  key: string,
  serviceType: "compose" | "worker_pool",
  container: DockerContainerSummary,
): ResourceAccumulator {
  const group =
    groups.get(key) ?? createResourceAccumulator(key, serviceType)
  groups.set(key, group)
  group.containerCount += 1
  if (container.State === "running") group.runningContainerCount += 1
  if (container.State) group.states.add(container.State)
  return group
}

function createResourceAccumulator(
  key: string,
  serviceType: "compose" | "worker_pool",
): ResourceAccumulator {
  return {
    key,
    serviceType,
    containerCount: 0,
    runningContainerCount: 0,
    observedStatsCount: 0,
    failedStatsCount: 0,
    cpuObservedCount: 0,
    memoryUsageObservedCount: 0,
    memoryLimitObservedCount: 0,
    pidsObservedCount: 0,
    cpuPercent: 0,
    memoryUsedBytes: 0,
    memoryLimitBytes: 0,
    pids: 0,
    states: new Set(),
  }
}

function applyContainerResourceStats(
  group: ResourceAccumulator,
  stats: DockerContainerResourceStats,
): void {
  group.observedStatsCount += 1
  if (stats.cpuPercent !== null) {
    group.cpuObservedCount += 1
    group.cpuPercent += stats.cpuPercent
  }
  if (stats.memoryUsageBytes !== null) {
    group.memoryUsageObservedCount += 1
    group.memoryUsedBytes += stats.memoryUsageBytes
  }
  if (stats.memoryLimitBytes !== null) {
    group.memoryLimitObservedCount += 1
    group.memoryLimitBytes += stats.memoryLimitBytes
  }
  if (stats.pidsCurrent !== null) {
    group.pidsObservedCount += 1
    group.pids += stats.pidsCurrent
  }
}

function toDockerResourceServiceUsage(
  group: ResourceAccumulator,
): DockerResourceServiceUsage {
  const status = group.observedStatsCount > 0
    ? "available"
    : group.runningContainerCount > 0 && group.failedStatsCount > 0
      ? "unavailable"
      : "not_observed"
  const memoryPercent =
    group.memoryUsageObservedCount > 0 &&
    group.memoryLimitObservedCount > 0 &&
    group.memoryLimitBytes > 0
      ? (group.memoryUsedBytes / group.memoryLimitBytes) * 100
      : null
  return {
    key: group.key,
    service_type: group.serviceType,
    status,
    container_count: group.containerCount,
    running_container_count: group.runningContainerCount,
    cpu_percent: group.cpuObservedCount > 0 ? group.cpuPercent : null,
    memory_used_bytes:
      group.memoryUsageObservedCount > 0
        ? Math.round(group.memoryUsedBytes)
        : null,
    memory_limit_bytes:
      group.memoryLimitObservedCount > 0
        ? Math.round(group.memoryLimitBytes)
        : null,
    memory_percent: memoryPercent,
    pids: group.pidsObservedCount > 0 ? group.pids : null,
    state: group.states.size > 0 ? [...group.states].sort().join(",") : null,
  }
}

function compareResourceServices(
  left: DockerResourceServiceUsage,
  right: DockerResourceServiceUsage,
): number {
  const leftOrder = resourceServiceOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = resourceServiceOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER
  return leftOrder === rightOrder
    ? left.key.localeCompare(right.key)
    : leftOrder - rightOrder
}

function volumeMount(
  source: string,
  subpath: string,
  target: string,
  readOnly = false,
) {
  return {
    Type: "volume" as const,
    Source: source,
    Target: target,
    ReadOnly: readOnly,
    VolumeOptions: { NoCopy: true, Subpath: subpath },
  }
}

function bindMount(source: string, target: string, readOnly = false) {
  return {
    Type: "bind" as const,
    Source: source,
    Target: target,
    ReadOnly: readOnly,
  }
}

function safeVolumeSubpath(parent: string, child: string): string {
  if (
    path.posix.isAbsolute(parent) ||
    path.posix.isAbsolute(child) ||
    parent === "." ||
    child === "." ||
    parent.split("/").includes("..") ||
    child.split("/").includes("..")
  ) {
    throw new Error("user data volume subpath must stay inside its owner root")
  }
  const candidate = path.posix.join(parent, child)
  if (candidate === parent || !candidate.startsWith(`${parent}/`)) {
    throw new Error("user data volume subpath escapes its owner root")
  }
  return candidate
}

function safeChildPath(parent: string, child: string): string {
  const candidate = path.resolve(parent, child)
  if (candidate === parent || !candidate.startsWith(`${parent}${path.sep}`)) {
    throw new Error("user data path escapes its configured root")
  }
  return candidate
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function workerName(storageKey: string, instanceKey: string): string {
  return `linksense-worker-${containerNameKey(instanceKey, storageKey)}`
}

function probeWorkerName(storageKey: string, instanceKey: string): string {
  return `linksense-worker-probe-${containerNameKey(instanceKey, storageKey)}`
}

function containerNameKey(instanceKey: string, storageKey: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "linksense-runner-container-name",
        instanceKey,
        storageKey,
      ]),
    )
    .digest("hex")
    .slice(0, 32)
}

function workerBaseUrl(worker: ManagedWorker, port: number): string {
  return `http://${worker.containerName}:${port}`
}
