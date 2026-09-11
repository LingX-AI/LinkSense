import { chmod, chown, lstat, mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"

import type { Logger } from "pino"
import { z } from "zod"

import {
  linksenseRuntimeIdentity,
  RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT,
} from "@linksense/shared"

import type { RunnerConfig } from "../config.js"
import {
  DockerEngineError,
  type DockerContainerCreate,
  type DockerContainerResourceStats,
  type DockerContainerSummary,
  type DockerEngine,
} from "../docker/engine-client.js"
import {
  controllerInstanceKey,
  ownerStorageKey,
  ownerWorkerSecret,
  workerContractKey,
} from "./storage-key.js"
import type {
  WorkerAcquireInput,
  WorkerInstance,
  WorkerOwnerPaths,
  WorkerProvider,
  WorkerProviderCapabilities,
} from "./worker-provider.js"
import {
  isNodeError,
  safeChildPath,
  workerName,
} from "./worker-provider-utils.js"

const MANAGED_LABEL = "com.linksense.runner.managed"
const STORAGE_KEY_LABEL = "com.linksense.runner.storage-key"
const OWNER_ID_LABEL = "com.linksense.runner.owner-id"
const CONTRACT_LABEL = "com.linksense.runner.contract"
const INSTANCE_LABEL = "com.linksense.runner.instance"
const PROBE_LABEL = "com.linksense.runner.probe"
const COMPOSE_PROJECT_LABEL = "com.docker.compose.project"
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service"
const DOCKER_RESOURCE_USAGE_CACHE_TTL_MS = 60_000
const ownerIdSchema = z.uuid()

const TRUSTED_WORKER_SUPERVISOR_CAPABILITIES = [
  "SETUID",
  "KILL",
  "DAC_OVERRIDE",
  "FOWNER",
  "CHOWN",
] as const

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

export class DockerWorkerProvider implements WorkerProvider {
  readonly kind = "docker" as const
  readonly capabilities: WorkerProviderCapabilities = {
    isolation: "container",
    persistentWorkers: true,
    workspaceIdentity: {
      apiUid: linksenseRuntimeIdentity.apiUid,
      taskUid: linksenseRuntimeIdentity.taskUid,
      sharedGid: linksenseRuntimeIdentity.sharedGid,
    },
  }

  private dockerResourceUsageCache:
    | { expiresAt: number; snapshot: DockerResourceUsageSnapshot }
    | undefined
  private dockerResourceUsageInFlight:
    | Promise<DockerResourceUsageSnapshot>
    | undefined

  constructor(
    private readonly config: RunnerConfig,
    private readonly docker: DockerEngine,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    await this.docker.assertCompatible()
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

  async discover(): Promise<WorkerInstance[]> {
    const containers = await this.docker.listManagedContainers()
    const instanceKey = controllerInstanceKey(this.config)
    const seenStorageKeys = new Set<string>()
    const workers: WorkerInstance[] = []
    for (const container of containers) {
      if (container.Labels[INSTANCE_LABEL] !== instanceKey) continue
      const storageKey = container.Labels[STORAGE_KEY_LABEL]
      const ownerId = ownerIdSchema.safeParse(container.Labels[OWNER_ID_LABEL])
      const probe = container.Labels[PROBE_LABEL] === "true"
      const compatible =
        storageKey !== undefined &&
        ownerId.success &&
        container.Labels[CONTRACT_LABEL] === workerContractKey(this.config) &&
        storageKey ===
          ownerStorageKey(
            ownerId.data,
            this.config.LINKSENSE_RUNNER_SHARED_SECRET,
          ) &&
        !seenStorageKeys.has(storageKey)
      if (probe || !compatible) {
        await this.releaseContainer(container.Id, container.State)
        continue
      }
      seenStorageKeys.add(storageKey)
      workers.push(toWorkerInstance(container, ownerId.data, storageKey, this.config))
    }
    return workers
  }

  async prepareOwnerFilesystem(paths: WorkerOwnerPaths): Promise<void> {
    const mountpoint = await lstat(paths.homeAgentsMountpoint).catch(
      (error: unknown) => {
        if (isNodeError(error, "ENOENT")) return undefined
        throw error
      },
    )
    if (mountpoint?.isSymbolicLink()) {
      const [actual, expected] = await Promise.all([
        realpath(paths.homeAgentsMountpoint),
        realpath(paths.managedAgents),
      ])
      if (actual !== expected) {
        throw new Error("managed agents mountpoint has an unexpected target")
      }
      await rm(paths.homeAgentsMountpoint)
    } else if (mountpoint && !mountpoint.isDirectory()) {
      throw new Error("managed agents mountpoint must be a directory")
    }
    await mkdir(paths.homeAgentsMountpoint, { mode: 0o750 }).catch(
      ignoreExistingDirectory,
    )
    await Promise.all([
      chown(
        paths.homeAgentsMountpoint,
        this.capabilities.workspaceIdentity.taskUid,
        this.capabilities.workspaceIdentity.sharedGid,
      ),
      chmod(paths.homeAgentsMountpoint, 0o750),
    ])
  }

  async acquire(input: WorkerAcquireInput): Promise<WorkerInstance> {
    const containerId = await this.docker.createContainer(
      input.name,
      buildWorkerContainerSpec(
        this.config,
        input.ownerId,
        input.storageKey,
        input.name,
        process.env,
        input.probe,
      ),
    )
    try {
      await this.docker.startContainer(containerId)
      return {
        id: containerId,
        name: input.name,
        endpoint: `http://${input.name}:${this.config.LINKSENSE_WORKER_PORT}`,
        storageKey: input.storageKey,
        ownerId: input.ownerId,
        state: "running",
      }
    } catch (error) {
      await this.docker.removeContainer(containerId).catch(() => undefined)
      throw error
    }
  }

  async resume(worker: WorkerInstance): Promise<WorkerInstance> {
    await this.docker.startContainer(worker.id)
    return { ...worker, state: "running" }
  }

  async inspect(worker: WorkerInstance) {
    return (await this.docker.inspectContainerRunning(worker.id))
      ? ("running" as const)
      : ("stopped" as const)
  }

  async release(worker: WorkerInstance): Promise<void> {
    const running = await this.docker
      .inspectContainerRunning(worker.id)
      .catch(() => worker.state === "running")
    await releaseDockerContainer(this.docker, worker.id, running)
  }

  async hasWorkerForOwner(ownerId: string): Promise<boolean> {
    return (await this.docker.listManagedContainers()).some(
      (container) =>
        container.Labels[OWNER_ID_LABEL] === ownerId &&
        container.Labels[PROBE_LABEL] !== "true",
    )
  }

  async healthDetails(
    checkedAt: string,
    options: { includeResourceUsage?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (options.includeResourceUsage === false) return {}
    return { docker_resource_usage: await this.cachedResourceUsage(checkedAt) }
  }

  async shutdown(): Promise<void> {}

  private async releaseContainer(id: string, state: string): Promise<void> {
    await releaseDockerContainer(this.docker, id, state === "running")
  }

  private async collectResourceUsage(
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
          this.observeContainerResource(group, container),
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

  private async cachedResourceUsage(
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
    this.dockerResourceUsageInFlight = this.collectResourceUsage(checkedAt)
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

  private async observeContainerResource(
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
}

async function releaseDockerContainer(
  docker: DockerEngine,
  id: string,
  running: boolean,
): Promise<void> {
  let stopFailure: unknown
  if (running) {
    try {
      await docker.stopContainer(id)
    } catch (error) {
      if (isAbsentContainerError(error)) return
      stopFailure = error
    }
  }
  try {
    await docker.removeContainer(id)
  } catch (error) {
    if (isAbsentContainerError(error)) return
    if (stopFailure !== undefined) {
      throw new AggregateError(
        [stopFailure, error],
        "Docker container release failed",
        { cause: error },
      )
    }
    throw error
  }
}

function isAbsentContainerError(error: unknown): boolean {
  return error instanceof DockerEngineError && error.statusCode === 404
}

function toWorkerInstance(
  container: DockerContainerSummary,
  ownerId: string,
  storageKey: string,
  config: RunnerConfig,
): WorkerInstance {
  const name =
    container.Names[0]?.replace(/^\//u, "") ?? `linksense-worker-${storageKey}`
  return {
    id: container.Id,
    name,
    endpoint: `http://${name}:${config.LINKSENSE_WORKER_PORT}`,
    storageKey,
    ownerId,
    state: container.State === "running" ? "running" : "stopped",
  }
}

export function buildWorkerContainerSpec(
  config: RunnerConfig,
  ownerId: string,
  storageKey: string,
  containerName = workerName(storageKey, controllerInstanceKey(config)),
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
  probe = false,
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
      : bindMount(safeChildPath(ownerRoot, relativePath), target, readOnly)
  return {
    Image: config.LINKSENSE_WORKER_IMAGE,
    // Docker starts the command as 0:1000. With Init enabled, docker-init stays
    // PID 1 and the image CMD drops the Node supervisor to 1000:1000 while
    // retaining only the capabilities needed to launch and reap uid 1001 tasks.
    User: "0:1000",
    Env: Object.entries({
      HOME: workerHome,
      // Set before Node starts: each file in one durable batch must be able to
      // sync concurrently instead of waiting behind the default four threads.
      UV_THREADPOOL_SIZE: String(RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT),
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
      ...(probe ? { [PROBE_LABEL]: "true" } : {}),
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
      Mounts: [
        ownerMount("home", workerHome),
        ownerMount("managed/agents", `${workerHome}/.agents`, true),
        ownerMount("control", workerControlRoot),
      ],
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
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"] as const
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
  const group = groups.get(key) ?? createResourceAccumulator(key, serviceType)
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
  const status =
    group.observedStatsCount > 0
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

function ignoreExistingDirectory(error: unknown): void {
  if (isNodeError(error, "EEXIST")) return
  throw error
}
