import { randomUUID } from "node:crypto"
import path from "node:path"
import { z } from "zod"
import {
  diskUsageCategoryKeys,
  type DiskUsage,
  type DiskUsageCategoryKey,
} from "@linksense/shared"

const projectLabel = "com.docker.compose.project"
const instanceLabel = "com.linksense.runner.instance"
const probeLabel = "com.linksense.health.disk-probe"
export const DISK_USAGE_COLLECTION_TIMEOUT_MS = 5 * 60_000
export const DISK_USAGE_PROBE_TIMEOUT_MS = 4 * 60_000
const absolutePath = z
  .string()
  .min(2)
  .max(4096)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.includes("\0") &&
      path.posix.normalize(value) === value,
  )
const mountSchema = z.object({
  Type: z.string(),
  Source: z.string().optional(),
  Destination: z.string(),
  Name: z.string().optional(),
})
const containerSchema = z.object({
  Id: z.string().min(1),
  ImageID: z.string().min(1),
  State: z.string(),
  Created: z.number().nonnegative().optional(),
  Labels: z.record(z.string(), z.string()).nullish(),
  Mounts: z.array(mountSchema).default([]),
})
const graphSchema = z
  .object({
    Data: z.record(z.string(), z.string()).nullish(),
  })
  .nullish()
const inspectSchema = z.object({
  GraphDriver: graphSchema,
  SizeRw: z.number().int().nonnegative().optional(),
  LogPath: z.string().optional(),
  HostConfig: z
    .object({ LogConfig: z.object({ Type: z.string() }).optional() })
    .optional(),
})
const imageSchema = z.object({
  GraphDriver: graphSchema,
  Size: z.number().int().nonnegative(),
})
const measurementSchema = z.object({
  id: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative().safe().nullable(),
  complete: z.boolean(),
})
const measurementsSchema = z.object({
  measurements: z.array(measurementSchema),
})

export type DockerDiskUsageInput = {
  project: string
  instance: string
  image: string
  userDataRoot: string
  userDataVolume?: string | undefined
  cpuQuotaMode?: "strict" | "compatible" | undefined
}
export type DockerDiskRequest = (
  method: string,
  requestPath: string,
  body?: unknown,
  timeoutMs?: number,
) => Promise<{ body: string }>
type Target = { source: string; key: DiskUsageCategoryKey }

/** Fixed, content-blind probe. du counts allocated blocks, sparse files and hard links correctly. */
export const diskUsageProbeScript = String.raw`
const { execFileSync } = require("node:child_process");
const { lstatSync } = require("node:fs");
const targets = JSON.parse(process.argv[1]);
const seen = new Set();
const measurements = [];
const selected = [];
for (let id = 0; id < targets.length; id++) {
  const target = "/measure/" + id;
  try {
    const stat = lstatSync(target, { bigint: true });
    if (!stat.isFile() && !stat.isDirectory()) {
      measurements.push({ id, bytes: null, complete: false });
      continue;
    }
    const inode = stat.dev + ":" + stat.ino;
    if (seen.has(inode)) {
      measurements.push({ id, bytes: 0, complete: true });
      continue;
    }
    seen.add(inode);
    selected.push(target);
  } catch { measurements.push({ id, bytes: null, complete: false }); }
}
let output = "";
let complete = true;
if (selected.length) {
  try {
    output = execFileSync("nice", ["-n", "19", "du", "-B1", "-s", "-P", "-x", "-0", "--", ...selected], {
      encoding: "utf8", timeout: ${DISK_USAGE_PROBE_TIMEOUT_MS}, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    complete = false;
    output = typeof error.stdout === "string" ? error.stdout : "";
  }
}
for (const target of selected) {
  const record = output.split("\0").find(line => line.slice(line.indexOf("\t") + 1) === target);
  const bytes = record ? Number(record.slice(0, record.indexOf("\t"))) : null;
  measurements.push({ id: Number(target.slice("/measure/".length)), bytes, complete: complete && bytes !== null });
}
process.stdout.write(JSON.stringify({ measurements }) + "\n");
`

/** Only the current Compose deployment and its execution workers contribute paths. */
export async function collectDockerDiskUsage(
  transport: DockerDiskRequest,
  input: DockerDiskUsageInput,
): Promise<DiskUsage> {
  const deadline = Date.now() + DISK_USAGE_COLLECTION_TIMEOUT_MS
  const request: DockerDiskRequest = (method, url, body, timeoutMs) => {
    // Cleanup keeps its own bounded timeout even when the collection budget is exhausted.
    if (method === "DELETE") return transport(method, url)
    const remaining = deadline - Date.now()
    if (remaining <= 0)
      return Promise.reject(new Error("Disk collection timed out"))
    return transport(
      method,
      url,
      body,
      Math.min(timeoutMs ?? 15_000, remaining),
    )
  }
  const containers = z
    .array(containerSchema)
    .max(4000)
    .parse(JSON.parse((await request("GET", "/containers/json?all=1")).body))
  const owned = containers.filter(
    (container) =>
      container.Labels?.[probeLabel] !== "true" &&
      (container.Labels?.[projectLabel] === input.project ||
        (container.Labels?.["com.linksense.runner.managed"] === "true" &&
          container.Labels[instanceLabel] === input.instance &&
          container.Labels["com.linksense.runner.probe"] !== "true")),
  )
  const ownedIds = new Set(owned.map((container) => container.Id))
  const foreignSources = containers
    .filter(
      (container) =>
        !ownedIds.has(container.Id) &&
        container.Labels?.[probeLabel] !== "true",
    )
    .flatMap((container) =>
      container.Mounts.filter((mount) => mount.Type !== "tmpfs")
        .map((mount) => mount.Source)
        .filter((source): source is string => Boolean(source)),
    )
  const root = absolutePath.parse(
    z
      .object({ DockerRootDir: absolutePath })
      .parse(JSON.parse((await request("GET", "/info")).body)).DockerRootDir,
  )
  const targets: Target[] = []
  const failures = new Set<DiskUsageCategoryKey>()
  const empty = new Set<DiskUsageCategoryKey>()
  const add = (
    source: string | undefined,
    key: DiskUsageCategoryKey,
    daemonPath = false,
  ) => {
    if (
      !source ||
      !absolutePath.safeParse(source).success ||
      (daemonPath && !isChild(root, source)) ||
      (!daemonPath && (source === root || isChild(source, root))) ||
      foreignSources.some((other) => overlaps(other, source))
    ) {
      failures.add(key)
      return
    }
    targets.push({ source, key })
  }

  // Reap only stopped probes belonging to this controller after an interrupted sample.
  for (const container of containers) {
    if (
      container.Labels?.[probeLabel] === "true" &&
      container.Labels[instanceLabel] === input.instance &&
      container.State !== "running" &&
      container.Created !== undefined &&
      Date.now() - container.Created * 1000 > 5 * 60_000
    ) {
      await request(
        "DELETE",
        `/containers/${encodeURIComponent(container.Id)}?v=0`,
      )
    }
  }
  let userDataFound = false
  for (const container of owned) {
    for (const mount of container.Mounts) {
      if (mount.Type === "tmpfs" || mount.Destination.endsWith("docker.sock"))
        continue
      const key = mountCategory(
        container.Labels?.["com.docker.compose.service"],
        mount.Destination,
      )
      if (
        (input.userDataVolume !== undefined &&
          mount.Name === input.userDataVolume) ||
        mount.Destination === input.userDataRoot
      ) {
        add(mount.Source, "user_data")
        userDataFound = true
      } else {
        add(mount.Source, key)
      }
    }
  }
  if (!userDataFound) {
    if (input.userDataVolume) {
      try {
        const volume = z
          .object({ Mountpoint: absolutePath })
          .parse(
            JSON.parse(
              (
                await request(
                  "GET",
                  `/volumes/${encodeURIComponent(input.userDataVolume)}`,
                )
              ).body,
            ),
          )
        add(volume.Mountpoint, "user_data")
      } catch {
        failures.add("user_data")
      }
    } else {
      add(input.userDataRoot, "user_data")
    }
  }

  await inBatches(owned, async (container) => {
    try {
      const inspected = inspectSchema.parse(
        JSON.parse(
          (
            await request(
              "GET",
              `/containers/${encodeURIComponent(container.Id)}/json?size=1`,
            )
          ).body,
        ),
      )
      const upper = inspected.GraphDriver?.Data?.UpperDir
      if (upper) add(upper, "runtime", true)
      else if (inspected.SizeRw === 0) empty.add("runtime")
      else failures.add("runtime")
      const work = inspected.GraphDriver?.Data?.WorkDir
      if (work) add(work, "runtime", true)
      for (const lower of inspected.GraphDriver?.Data?.LowerDir?.split(":") ??
        [])
        add(lower, "images", true)
      if (inspected.LogPath)
        add(path.posix.dirname(inspected.LogPath), "logs", true)
      else if (
        inspected.HostConfig?.LogConfig?.Type === "none" ||
        container.State === "created"
      )
        empty.add("logs")
      else failures.add("logs")
    } catch {
      failures.add("runtime")
      failures.add("logs")
    }
  })
  const images = [
    ...new Set([...owned.map((container) => container.ImageID), input.image]),
  ]
  await inBatches(images, async (image) => {
    try {
      const inspected = imageSchema.parse(
        JSON.parse(
          (await request("GET", `/images/${encodeURIComponent(image)}/json`))
            .body,
        ),
      )
      const directories = [
        inspected.GraphDriver?.Data?.UpperDir,
        ...(inspected.GraphDriver?.Data?.LowerDir?.split(":") ?? []),
      ].filter((directory): directory is string => Boolean(directory))
      if (directories.length)
        directories.forEach((directory) => add(directory, "images", true))
      else if (inspected.Size === 0) empty.add("images")
      else failures.add("images")
    } catch {
      failures.add("images")
    }
  })

  // Parent mounts cover their children. Never count a shared volume or image layer twice.
  const unique = new Map<string, Target>()
  for (const target of targets) {
    const previous = unique.get(target.source)
    if (
      !previous ||
      diskUsageCategoryKeys.indexOf(target.key) <
        diskUsageCategoryKeys.indexOf(previous.key)
    )
      unique.set(target.source, target)
  }
  const deduplicated: Target[] = []
  const includedRoots = new Set<string>()
  for (const target of [...unique.values()].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  )) {
    let ancestor = path.posix.dirname(target.source)
    while (ancestor !== "/" && !includedRoots.has(ancestor)) {
      ancestor = path.posix.dirname(ancestor)
    }
    if (!includedRoots.has(ancestor)) {
      deduplicated.push(target)
      includedRoots.add(target.source)
    }
  }
  const measurements = deduplicated.length
    ? await probePaths(request, input, deduplicated)
    : []
  const categories = diskUsageCategoryKeys.map((key) => {
    const values = measurements.filter(
      (entry) => deduplicated[entry.id]?.key === key,
    )
    const expected = deduplicated.filter((target) => target.key === key).length
    const observed = values.filter((entry) => entry.bytes !== null)
    const incomplete =
      failures.has(key) ||
      values.some((entry) => !entry.complete) ||
      values.length !== expected
    const present = expected > 0 || empty.has(key) || failures.has(key)
    const used_bytes =
      observed.length || empty.has(key)
        ? observed.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
        : present
          ? null
          : 0
    return {
      key,
      used_bytes,
      status: !present
        ? ("not_present" as const)
        : incomplete
          ? used_bytes === null
            ? ("unavailable" as const)
            : ("partial" as const)
          : ("available" as const),
    }
  })
  const observed = categories.filter(
    (category) =>
      category.status === "available" || category.status === "partial",
  )
  const incomplete = categories.some(
    (category) =>
      category.status === "partial" || category.status === "unavailable",
  )
  return {
    status: !observed.length
      ? "unavailable"
      : incomplete
        ? "partial"
        : "available",
    checked_at: new Date().toISOString(),
    refreshing: false,
    total_bytes:
      !incomplete && observed.length
        ? observed.reduce(
            (sum, category) => sum + (category.used_bytes ?? 0),
            0,
          )
        : null,
    categories,
  }
}

async function probePaths(
  request: DockerDiskRequest,
  input: DockerDiskUsageInput,
  targets: Target[],
): Promise<z.infer<typeof measurementSchema>[]> {
  if (targets.length > 2048) return []
  let id: string | undefined
  try {
    id = z.object({ Id: z.string().min(1) }).parse(
      JSON.parse(
        (
          await request(
            "POST",
            `/containers/create?name=linksense-disk-probe-${randomUUID()}`,
            {
              Image: input.image,
              User: "0:0",
              Entrypoint: ["node"],
              Cmd: [
                "-e",
                diskUsageProbeScript,
                JSON.stringify(targets.map((_, index) => index)),
              ],
              Env: ["LC_ALL=C"],
              Tty: true,
              Labels: { [probeLabel]: "true", [instanceLabel]: input.instance },
              HostConfig: {
                ReadonlyRootfs: true,
                NetworkMode: "none",
                CapDrop: ["ALL"],
                CapAdd: ["DAC_READ_SEARCH"],
                SecurityOpt: ["no-new-privileges:true"],
                PidsLimit: 32,
                Memory: 128 * 1024 * 1024,
                MemorySwap: 128 * 1024 * 1024,
                NanoCpus:
                  input.cpuQuotaMode === "compatible" ? 0 : 1_000_000_000,
                Mounts: targets.map((target, index) => ({
                  Type: "bind",
                  Source: target.source,
                  Target: `/measure/${index}`,
                  ReadOnly: true,
                  BindOptions: { NonRecursive: true },
                })),
                LogConfig: {
                  Type: "json-file",
                  Config: { "max-size": "1m", "max-file": "1" },
                },
              },
            },
          )
        ).body,
      ),
    ).Id
    await request("POST", `/containers/${encodeURIComponent(id)}/start`)
    const result = z
      .object({ StatusCode: z.number().int() })
      .parse(
        JSON.parse(
          (
            await request(
              "POST",
              `/containers/${encodeURIComponent(id)}/wait?condition=not-running`,
              undefined,
              DISK_USAGE_PROBE_TIMEOUT_MS + 15_000,
            )
          ).body,
        ),
      )
    if (result.StatusCode !== 0) return []
    const response = await request(
      "GET",
      `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=0&tail=1`,
    )
    const parsed = measurementsSchema.parse(
      JSON.parse(response.body.trim()),
    ).measurements
    if (
      parsed.length !== targets.length ||
      new Set(parsed.map((entry) => entry.id)).size !== targets.length ||
      parsed.some((entry) => entry.id >= targets.length)
    )
      return []
    return parsed
  } catch {
    return []
  } finally {
    if (id)
      await request(
        "DELETE",
        `/containers/${encodeURIComponent(id)}?force=1&v=0`,
      )
  }
}

function mountCategory(
  service: string | undefined,
  destination: string,
): DiskUsageCategoryKey {
  if (
    destination === "/srv/linksense/users" ||
    destination === "/home/linksense"
  )
    return "user_data"
  if (destination === "/var/lib/postgresql/data") return "database"
  if (service === "minio" || destination.includes("object-storage"))
    return "file_storage"
  if (
    service === "postgres-backup" ||
    service === "backup-init" ||
    destination.includes("backups")
  )
    return "backups"
  if (["postgres", "redis", "elasticsearch"].includes(service ?? ""))
    return "database"
  return "other"
}
function isChild(parent: string, child: string): boolean {
  return child.startsWith(`${parent}/`)
}
function overlaps(left: string, right: string): boolean {
  return left === right || isChild(left, right) || isChild(right, left)
}
async function inBatches<T>(
  items: T[],
  callback: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += 4)
    await Promise.all(items.slice(index, index + 4).map(callback))
}
