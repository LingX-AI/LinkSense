import { z } from "zod"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import {
  collectDockerDiskUsage,
  type DockerDiskRequest,
  diskUsageProbeScript,
  DISK_USAGE_COLLECTION_TIMEOUT_MS,
} from "../src/docker/disk-usage.js"

const input = {
  project: "fixture",
  instance: "instance",
  image: "worker-image",
  userDataRoot: "/srv/linksense/users",
}
function fixture() {
  const mount = (Source: string, Destination: string) => ({
    Type: "volume",
    Source,
    Destination,
  })
  const containers = [
    {
      Id: "api",
      ImageID: "image-a",
      State: "running",
      Labels: {
        "com.docker.compose.project": "fixture",
        "com.docker.compose.service": "api",
      },
      Mounts: [mount("/vol/users", input.userDataRoot)],
    },
    {
      Id: "runner",
      ImageID: "image-a",
      State: "running",
      Labels: {
        "com.docker.compose.project": "fixture",
        "com.docker.compose.service": "runner",
      },
      Mounts: [
        mount("/vol/users", input.userDataRoot),
        {
          Type: "bind",
          Source: "/var/run/docker.sock",
          Destination: "/var/run/docker.sock",
        },
      ],
    },
    {
      Id: "minio",
      ImageID: "image-b",
      State: "exited",
      Labels: {
        "com.docker.compose.project": "fixture",
        "com.docker.compose.service": "minio",
      },
      Mounts: [mount("/vol/files", "/data")],
    },
    {
      Id: "postgres",
      ImageID: "image-a",
      State: "running",
      Labels: {
        "com.docker.compose.project": "fixture",
        "com.docker.compose.service": "postgres",
      },
      Mounts: [mount("/vol/database", "/var/lib/postgresql/data")],
    },
    {
      Id: "backup",
      ImageID: "image-a",
      State: "exited",
      Labels: {
        "com.docker.compose.project": "fixture",
        "com.docker.compose.service": "postgres-backup",
      },
      Mounts: [mount("/vol/backup", "/backups")],
    },
    {
      Id: "worker",
      ImageID: "worker-image",
      State: "exited",
      Labels: {
        "com.linksense.runner.managed": "true",
        "com.linksense.runner.instance": "instance",
      },
      Mounts: [mount("/vol/users", "/home/linksense")],
    },
    {
      Id: "foreign",
      ImageID: "foreign-image",
      State: "running",
      Labels: { "com.docker.compose.project": "another-deployment" },
      Mounts: [mount("/vol/foreign", "/data")],
    },
  ]
  let sources: string[] = []
  let failedPath: string | undefined
  let unsupportedImages = false
  const request = vi.fn<DockerDiskRequest>(async (method, url, body) => {
    if (url === "/containers/json?all=1") return json(containers)
    if (url === "/info") return json({ DockerRootDir: "/docker" })
    if (url.startsWith("/images/")) {
      if (unsupportedImages)
        return json({ Size: 100, GraphDriver: { Data: null } })
      const image = url.split("/")[2]
      return json({
        Size: 100,
        GraphDriver: {
          Data: {
            UpperDir: `/docker/images/${image}/diff`,
            LowerDir: "/docker/images/base/diff",
          },
        },
      })
    }
    if (method === "GET" && url.includes("/json?size=1")) {
      const id = url.split("/")[2]
      return json({
        GraphDriver: { Data: { UpperDir: `/docker/writable/${id}/diff` } },
        LogPath: `/docker/containers/${id}/log.json`,
      })
    }
    if (method === "POST" && url.startsWith("/containers/create")) {
      const parsed = probeSpec.parse(body)
      sources = parsed.HostConfig.Mounts.map((entry) => entry.Source)
      return json({ Id: "disk-probe" })
    }
    if (url.includes("/wait?")) return json({ StatusCode: 0 })
    if (url.includes("/logs?"))
      return json({
        measurements: sources.map((source, id) => ({
          id,
          bytes: source === failedPath ? null : 1024,
          complete: source !== failedPath,
        })),
      })
    return { body: "" }
  })
  return {
    request,
    containers,
    sources: () => sources,
    fail: (source: string) => {
      failedPath = source
    },
    unsupportedImages: () => {
      unsupportedImages = true
    },
  }
}
const probeSpec = z.object({
  HostConfig: z.object({ Mounts: z.array(z.object({ Source: z.string() })) }),
})
function json(value: unknown) {
  return { body: JSON.stringify(value) }
}

describe("deployment disk usage", () => {
  it("allows large bind-directory scans beyond one minute with a finite deadline and low scheduling priority", () => {
    const execute = vi.fn<(...args: unknown[]) => string>(
      () => "20998828032\t/measure/0\0",
    )
    const write = vi.fn<(value: string) => void>()
    runInNewContext(diskUsageProbeScript, {
      require: (name: string) =>
        name === "node:child_process"
          ? { execFileSync: execute }
          : {
              lstatSync: () => ({
                dev: 1n,
                ino: 1n,
                isFile: () => false,
                isDirectory: () => true,
              }),
            },
      process: { argv: ["node", "[0]"], stdout: { write } },
    })
    expect(execute).toHaveBeenCalledWith(
      "nice",
      expect.arrayContaining(["-n", "19", "du", "/measure/0"]),
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    const options = z
      .object({ timeout: z.number() })
      .parse(execute.mock.calls[0]?.[2])
    expect(options.timeout).toBeGreaterThan(60_000)
    expect(options.timeout).toBeLessThanOrEqual(5 * 60_000)
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      measurements: [{ id: 0, bytes: 20998828032, complete: true }],
    })
  })
  it("includes all users, stopped workers, artifacts, databases and backups while counting shared storage and image layers once", async () => {
    const f = fixture()
    const result = await collectDockerDiskUsage(f.request, input)
    expect(result.status).toBe("available")
    expect(
      f.sources().filter((source) => source === "/vol/users"),
    ).toHaveLength(1)
    expect(
      f.sources().filter((source) => source === "/docker/images/base/diff"),
    ).toHaveLength(1)
    expect(f.sources()).toEqual(
      expect.arrayContaining([
        "/vol/files",
        "/vol/database",
        "/vol/backup",
        "/docker/writable/worker/diff",
        "/docker/containers/minio",
      ]),
    )
    expect(
      f
        .sources()
        .some(
          (source) =>
            source.includes("foreign") || source.endsWith("docker.sock"),
        ),
    ).toBe(false)
    expect(result.total_bytes).toBe(f.sources().length * 1024)
    expect(
      result.categories.find((category) => category.key === "user_data")
        ?.used_bytes,
    ).toBe(1024)
    expect(
      result.categories.find((category) => category.key === "images")
        ?.used_bytes,
    ).toBe(4 * 1024)
    expect(JSON.stringify(result)).not.toMatch(
      /\/vol\/|\/docker\/|image-a|instance|foreign/u,
    )
  })

  it("uses a network-isolated read-only probe with bounded resources and removes only that probe", async () => {
    const f = fixture()
    await collectDockerDiskUsage(f.request, input)
    const creation = f.request.mock.calls.find(([, url]) =>
      url.startsWith("/containers/create"),
    )
    expect(creation?.[2]).toMatchObject({
      Entrypoint: ["node"],
      User: "0:0",
      HostConfig: {
        ReadonlyRootfs: true,
        NetworkMode: "none",
        CapDrop: ["ALL"],
        CapAdd: ["DAC_READ_SEARCH"],
        SecurityOpt: ["no-new-privileges:true"],
        PidsLimit: 32,
        Memory: 134217728,
        Mounts: f.sources().map((Source, index) => ({
          Source,
          Type: "bind",
          ReadOnly: true,
          Target: `/measure/${index}`,
          BindOptions: { NonRecursive: true },
        })),
      },
    })
    expect(
      f.request.mock.calls.filter(([method]) => method === "DELETE"),
    ).toEqual([["DELETE", "/containers/disk-probe?force=1&v=0"]])
  })

  it("reports missing permission as incomplete instead of a complete total or zero usage", async () => {
    const f = fixture()
    f.fail("/vol/users")
    const result = await collectDockerDiskUsage(f.request, input)
    expect(result.status).toBe("partial")
    expect(
      result.categories.find((category) => category.key === "user_data"),
    ).toMatchObject({ status: "unavailable", used_bytes: null })
    expect(result.total_bytes).toBeNull()
  })

  it("marks image storage unavailable when the engine cannot expose image layer locations", async () => {
    const f = fixture()
    f.unsupportedImages()
    const result = await collectDockerDiskUsage(f.request, input)
    expect(result.status).toBe("partial")
    expect(
      result.categories.find((category) => category.key === "images"),
    ).toMatchObject({ status: "unavailable", used_bytes: null })
  })

  it("excludes a volume also mounted by another deployment and reports the missing attribution", async () => {
    const f = fixture()
    f.containers
      .find((container) => container.Id === "foreign")
      ?.Mounts.push({
        Type: "volume",
        Source: "/vol/users",
        Destination: "/shared",
      })
    const result = await collectDockerDiskUsage(f.request, input)
    expect(result.status).toBe("partial")
    expect(f.sources()).not.toContain("/vol/users")
    expect(
      result.categories.find((category) => category.key === "user_data")
        ?.used_bytes,
    ).toBeNull()
  })

  it("counts nested mounts once rather than summing the parent and its subdirectory", async () => {
    const f = fixture()
    f.containers[0]?.Mounts.push({
      Type: "volume",
      Source: "/vol/users/project",
      Destination: "/project",
    })
    const result = await collectDockerDiskUsage(f.request, input)
    expect(result.status).toBe("available")
    expect(f.sources()).not.toContain("/vol/users/project")
  })

  it.each(["/vol/users-another", "/vol/users.version"])(
    "still deduplicates nested mounts when sibling %s sorts between the parent and child",
    async (sibling) => {
      const f = fixture()
      f.containers[0]?.Mounts.push(
        { Type: "volume", Source: sibling, Destination: "/sibling" },
        {
          Type: "volume",
          Source: "/vol/users/project",
          Destination: "/project",
        },
      )
      const result = await collectDockerDiskUsage(f.request, input)
      expect(result.status).toBe("available")
      expect(f.sources()).toContain(sibling)
      expect(f.sources()).not.toContain("/vol/users/project")
    },
  )

  it("keeps missing paths incomplete and cleans the probe when it fails to start", async () => {
    const f = fixture()
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation((method, url, ...rest) =>
      url.endsWith("/start")
        ? Promise.reject(new Error("private directory denied"))
        : original(method, url, ...rest),
    )
    const result = await collectDockerDiskUsage(f.request, input)
    expect(result.status).toBe("unavailable")
    expect(result.total_bytes).toBeNull()
    expect(f.request).toHaveBeenCalledWith(
      "DELETE",
      "/containers/disk-probe?force=1&v=0",
    )
    expect(JSON.stringify(result)).not.toContain("private directory")
  })

  it("rejects malformed Docker inventory before launching any scan", async () => {
    const request = vi
      .fn<DockerDiskRequest>()
      .mockResolvedValue(json([{ Id: "invalid" }]))
    await expect(collectDockerDiskUsage(request, input)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("ends sampling when its total time budget expires rather than continuing to launch probes", async () => {
    const f = fixture()
    const now = vi.spyOn(Date, "now").mockReturnValue(0)
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation(async (...args) => {
      const response = await original(...args)
      if (args[1] === "/info")
        now.mockReturnValue(DISK_USAGE_COLLECTION_TIMEOUT_MS + 1)
      return response
    })
    try {
      const result = await collectDockerDiskUsage(f.request, input)
      expect(result.status).toBe("unavailable")
      expect(
        f.request.mock.calls.some(([, url]) =>
          url.startsWith("/containers/create"),
        ),
      ).toBe(false)
    } finally {
      now.mockRestore()
    }
  })

  it.each(["/", "/docker"])(
    "never scans an overly broad host mount %s",
    async (source) => {
      const f = fixture()
      const api = f.containers.find((container) => container.Id === "api")
      api?.Mounts.push({ Type: "bind", Source: source, Destination: "/host" })
      const result = await collectDockerDiskUsage(f.request, input)
      expect(result.status).toBe("partial")
      expect(f.sources()).not.toContain(source)
    },
  )
})
