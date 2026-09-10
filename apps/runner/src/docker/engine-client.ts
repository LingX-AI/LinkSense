import { request as httpRequest, type IncomingMessage } from "node:http"

import { z } from "zod"

const versionSchema = z.object({ ApiVersion: z.string().regex(/^\d+\.\d+$/u) })
const createResponseSchema = z.object({ Id: z.string().min(1) })
const containerInspectSchema = z.object({
  State: z.object({ Running: z.boolean() }),
})
const containerSummarySchema = z.object({
  Id: z.string().min(1),
  Names: z.array(z.string()),
  Labels: z.record(z.string(), z.string()).default({}),
  State: z.string(),
})
const volumeInspectSchema = z.object({
  Name: z.string().min(1),
  Driver: z.string().min(1),
  Labels: z.record(z.string(), z.string()).nullish(),
  Options: z.record(z.string(), z.string()).nullish(),
})
const requiredUserDataVolumeLabels = {
  "com.linksense.managed-by": "linksense-production",
  "com.linksense.persistence": "critical",
  "com.linksense.role": "user-data",
} as const satisfies Readonly<Record<string, string>>
const containerStatsSchema = z
  .object({
    read: z.string().optional(),
    pids_stats: z
      .object({ current: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
    memory_stats: z
      .object({
        usage: z.number().nonnegative().optional(),
        limit: z.number().nonnegative().optional(),
        stats: z
          .object({
            cache: z.number().nonnegative().optional(),
            inactive_file: z.number().nonnegative().optional(),
            total_inactive_file: z.number().nonnegative().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    cpu_stats: z
      .object({
        cpu_usage: z
          .object({
            total_usage: z.number().nonnegative().optional(),
            percpu_usage: z.array(z.number().nonnegative()).optional(),
          })
          .passthrough()
          .optional(),
        system_cpu_usage: z.number().nonnegative().optional(),
        online_cpus: z.number().int().positive().optional(),
      })
      .passthrough()
      .optional(),
    precpu_stats: z
      .object({
        cpu_usage: z
          .object({
            total_usage: z.number().nonnegative().optional(),
          })
          .passthrough()
          .optional(),
        system_cpu_usage: z.number().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type DockerContainerSummary = z.infer<typeof containerSummarySchema>

export type DockerContainerResourceStats = {
  readAt: string | null
  cpuPercent: number | null
  memoryUsageBytes: number | null
  memoryLimitBytes: number | null
  pidsCurrent: number | null
}

export type DockerMount =
  | {
      Type: "volume"
      Source: string
      Target: string
      ReadOnly: boolean
      VolumeOptions?: { NoCopy?: boolean; Subpath?: string }
    }
  | {
      Type: "bind"
      Source: string
      Target: string
      ReadOnly: boolean
    }

export type DockerContainerCreate = {
  Image: string
  User: string
  Cmd?: string[]
  WorkingDir?: string
  Env: string[]
  Labels: Record<string, string>
  ExposedPorts: Record<string, Record<string, never>>
  HostConfig: {
    ReadonlyRootfs: boolean
    Init: boolean
    CapDrop: string[]
    CapAdd: string[]
    SecurityOpt: string[]
    PidsLimit: number
    Memory: number
    MemorySwap: number
    NanoCpus: number
    Tmpfs: Record<string, string>
    Mounts: DockerMount[]
    Binds: string[]
    NetworkMode: string
  }
  NetworkingConfig: {
    EndpointsConfig: Record<string, { Aliases?: string[] }>
  }
}

export interface DockerEngine {
  assertCompatible(): Promise<void>
  inspectImage(image: string): Promise<void>
  inspectNetwork(network: string): Promise<void>
  inspectVolume(volume: string): Promise<void>
  listManagedContainers(): Promise<DockerContainerSummary[]>
  listContainersByLabels(labels: string[]): Promise<DockerContainerSummary[]>
  inspectContainerRunning(id: string): Promise<boolean>
  inspectContainerResourceStats(id: string): Promise<DockerContainerResourceStats>
  createContainer(name: string, body: DockerContainerCreate): Promise<string>
  startContainer(id: string): Promise<void>
  stopContainer(id: string): Promise<void>
  removeContainer(id: string): Promise<void>
}

export class DockerEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DockerEngineError"
  }
}

export class DockerEngineClient implements DockerEngine {
  private readonly apiVersion: string

  constructor(
    private readonly socketPath: string,
    apiVersion: string,
    private readonly requestTimeoutMs = 15_000,
  ) {
    this.apiVersion = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`
  }

  async assertCompatible(): Promise<void> {
    if (compareVersions(this.apiVersion.slice(1), "1.45") < 0) {
      throw new DockerEngineError("Docker Engine API 1.45 or newer is required")
    }
    const ping = await this.request("GET", "/_ping")
    if (ping.body.trim() !== "OK") {
      throw new DockerEngineError("Docker Engine ping failed")
    }
    const version = versionSchema.parse(
      JSON.parse((await this.request("GET", "/version")).body),
    )
    if (compareVersions(version.ApiVersion, "1.45") < 0) {
      throw new DockerEngineError("Docker Engine API 1.45 or newer is required")
    }
  }

  async listManagedContainers(): Promise<DockerContainerSummary[]> {
    return this.listContainersByLabels(["com.linksense.runner.managed=true"])
  }

  async listContainersByLabels(labels: string[]): Promise<DockerContainerSummary[]> {
    const filters = encodeURIComponent(
      JSON.stringify({ label: labels }),
    )
    const response = await this.request(
      "GET",
      `${this.versionPath}/containers/json?all=1&filters=${filters}`,
    )
    return z.array(containerSummarySchema).parse(JSON.parse(response.body))
  }

  async inspectContainerRunning(id: string): Promise<boolean> {
    const response = await this.request(
      "GET",
      `${this.versionPath}/containers/${encodeURIComponent(id)}/json`,
    )
    return containerInspectSchema.parse(JSON.parse(response.body)).State.Running
  }

  async inspectContainerResourceStats(
    id: string,
  ): Promise<DockerContainerResourceStats> {
    const response = await this.request(
      "GET",
      `${this.versionPath}/containers/${encodeURIComponent(id)}/stats?stream=false`,
    )
    return mapContainerResourceStats(
      containerStatsSchema.parse(JSON.parse(response.body)),
    )
  }

  async inspectImage(image: string): Promise<void> {
    await this.request(
      "GET",
      `${this.versionPath}/images/${encodeURIComponent(image)}/json`,
    )
  }

  async inspectNetwork(network: string): Promise<void> {
    await this.request(
      "GET",
      `${this.versionPath}/networks/${encodeURIComponent(network)}`,
    )
  }

  async inspectVolume(volume: string): Promise<void> {
    const response = await this.request(
      "GET",
      `${this.versionPath}/volumes/${encodeURIComponent(volume)}`,
    )
    const inspected = volumeInspectSchema.parse(JSON.parse(response.body))
    if (
      inspected.Name !== volume ||
      inspected.Driver !== "local" ||
      Object.keys(inspected.Options ?? {}).length > 0 ||
      !hasRequiredUserDataVolumeLabels(inspected.Labels)
    ) {
      throw new DockerEngineError(
        "Docker user data volume must be an option-free local volume with production user-data labels",
      )
    }
  }

  async createContainer(
    name: string,
    body: DockerContainerCreate,
  ): Promise<string> {
    const response = await this.request(
      "POST",
      `${this.versionPath}/containers/create?name=${encodeURIComponent(name)}`,
      body,
    )
    return createResponseSchema.parse(JSON.parse(response.body)).Id
  }

  async startContainer(id: string): Promise<void> {
    await this.request("POST", `${this.versionPath}/containers/${encodeURIComponent(id)}/start`)
  }

  async stopContainer(id: string): Promise<void> {
    await this.request("POST", `${this.versionPath}/containers/${encodeURIComponent(id)}/stop?t=10`)
  }

  async removeContainer(id: string): Promise<void> {
    await this.request(
      "DELETE",
      `${this.versionPath}/containers/${encodeURIComponent(id)}?force=1&v=0`,
    )
  }

  private get versionPath(): string {
    return `/${this.apiVersion}`
  }

  private request(
    method: string,
    requestPath: string,
    body?: unknown,
  ): Promise<{ statusCode: number; body: string }> {
    const serialized = body === undefined ? undefined : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: requestPath,
          method,
          headers: serialized
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(serialized),
              }
            : undefined,
        },
        (response) => {
          response.once("error", () => fail(new DockerEngineError("Docker Engine response failed")))
          void readDockerResponse(response).then((result) => {
            clearTimeout(timeout)
            resolve(result)
          }, fail)
        },
      )
      const timeout = setTimeout(() => {
        request.destroy(new DockerEngineError("Docker Engine request timed out"))
      }, this.requestTimeoutMs)
      timeout.unref()
      const fail = (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      }
      request.once("error", fail)
      if (serialized) request.write(serialized)
      request.end()
    })
  }
}

async function readDockerResponse(
  response: IncomingMessage,
): Promise<{ statusCode: number; body: string }> {
  try {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      length += bytes.byteLength
      if (length > 4 * 1024 * 1024) {
        throw new DockerEngineError("Docker response is too large")
      }
      chunks.push(bytes)
    }
    const body = Buffer.concat(chunks, length).toString("utf8")
    const statusCode = response.statusCode ?? 500
    if (statusCode < 200 || statusCode >= 300) {
      throw new DockerEngineError(
        `Docker Engine returned ${statusCode}: ${body.slice(0, 500)}`,
      )
    }
    return { statusCode, body }
  } catch (error) {
    if (error instanceof DockerEngineError) throw error
    throw new DockerEngineError("Docker Engine response failed")
  } finally {
    response.destroy()
  }
}

function hasRequiredUserDataVolumeLabels(
  labels: Record<string, string> | null | undefined,
): boolean {
  if (!labels) return false
  return Object.entries(requiredUserDataVolumeLabels).every(
    ([key, expected]) => labels[key] === expected,
  )
}

function mapContainerResourceStats(
  stats: z.infer<typeof containerStatsSchema>,
): DockerContainerResourceStats {
  const cpuPercent = calculateCpuPercent(stats)
  const memoryUsageBytes = calculateMemoryUsage(stats)
  const memoryLimitBytes = integerOrNull(stats.memory_stats?.limit)
  return {
    readAt: stats.read ?? null,
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    pidsCurrent: integerOrNull(stats.pids_stats?.current),
  }
}

function calculateCpuPercent(
  stats: z.infer<typeof containerStatsSchema>,
): number | null {
  const totalUsage = stats.cpu_stats?.cpu_usage?.total_usage
  const previousTotalUsage = stats.precpu_stats?.cpu_usage?.total_usage
  const systemUsage = stats.cpu_stats?.system_cpu_usage
  const previousSystemUsage = stats.precpu_stats?.system_cpu_usage
  if (
    totalUsage === undefined ||
    previousTotalUsage === undefined ||
    systemUsage === undefined ||
    previousSystemUsage === undefined
  ) {
    return null
  }
  const cpuDelta = totalUsage - previousTotalUsage
  const systemDelta = systemUsage - previousSystemUsage
  if (cpuDelta <= 0 || systemDelta <= 0) return null
  const cpuCount =
    stats.cpu_stats?.online_cpus ??
    stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
    1
  return finiteNonNegativeOrNull((cpuDelta / systemDelta) * cpuCount * 100)
}

function calculateMemoryUsage(
  stats: z.infer<typeof containerStatsSchema>,
): number | null {
  const usage = stats.memory_stats?.usage
  if (usage === undefined) return null
  const inactiveFile =
    stats.memory_stats?.stats?.inactive_file ??
    stats.memory_stats?.stats?.total_inactive_file ??
    stats.memory_stats?.stats?.cache ??
    0
  return integerOrNull(Math.max(usage - inactiveFile, 0))
}

function integerOrNull(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null
  return Math.max(Math.round(value), 0)
}

function finiteNonNegativeOrNull(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

function compareVersions(left: string, right: string): number {
  const [leftMajor = 0, leftMinor = 0] = left.split(".").map(Number)
  const [rightMajor = 0, rightMinor = 0] = right.split(".").map(Number)
  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor
}
