export type WorkerProviderKind = "docker" | "local-process"

export type WorkerProviderCapabilities = {
  isolation: "container" | "none"
  persistentWorkers: boolean
  workspaceIdentity: {
    apiUid: number
    taskUid: number
    sharedGid: number
  }
}

export type WorkerOwnerPaths = {
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
}

export type WorkerInstanceState = "running" | "stopped" | "failed"

export type WorkerInstance = {
  id: string
  name: string
  endpoint: string
  storageKey: string
  ownerId: string
  state: WorkerInstanceState
}

export type WorkerAcquireInput = {
  ownerId: string
  storageKey: string
  name: string
  probe: boolean
}

/**
 * Owns the placement and lifecycle of a complete LinkSense execution worker.
 * Codex tool and turn semantics stay inside that worker and never leak into a
 * provider implementation.
 */
export interface WorkerProvider {
  readonly kind: WorkerProviderKind
  readonly capabilities: WorkerProviderCapabilities

  initialize(): Promise<void>
  discover(): Promise<WorkerInstance[]>
  prepareOwnerFilesystem(paths: WorkerOwnerPaths): Promise<void>
  acquire(input: WorkerAcquireInput): Promise<WorkerInstance>
  resume(worker: WorkerInstance): Promise<WorkerInstance>
  inspect(worker: WorkerInstance): Promise<WorkerInstanceState>
  release(worker: WorkerInstance): Promise<void>
  hasWorkerForOwner(ownerId: string): Promise<boolean>
  healthDetails(
    checkedAt: string,
    options?: { includeResourceUsage?: boolean },
  ): Promise<Record<string, unknown>>
  shutdown(): Promise<void>
}
