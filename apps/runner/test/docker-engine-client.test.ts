import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  DockerEngineClient,
  DockerEngineError,
} from "../src/docker/engine-client.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("Docker Engine client", () => {
  it("inspects a configured managed volume by its exact name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-socket-"))
    roots.push(root)
    const socket = path.join(root, "docker.sock")
    let requestPath: string | undefined
    const server = createServer((request, response) => {
      requestPath = request.url
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          Name: "linksense/user-data",
          Driver: "local",
          Labels: managedUserDataVolumeLabels(),
          Options: null,
        }),
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, resolve)
    })
    try {
      const client = new DockerEngineClient(socket, "v1.45", 100)
      await expect(
        client.inspectVolume("linksense/user-data"),
      ).resolves.toBeUndefined()
      expect(requestPath).toBe("/v1.45/volumes/linksense%2Fuser-data")
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    [
      "a bind-backed local volume",
      "local",
      { type: "none", o: "bind", device: "/srv/users" },
    ],
    ["a local volume with an arbitrary mount option", "local", { o: "uid=1000" }],
    ["a non-local volume driver", "nfs", null],
  ])("rejects %s", async (_case, driver, options) => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-socket-"))
    roots.push(root)
    const socket = path.join(root, "docker.sock")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          Name: "linksense-user-data",
          Driver: driver,
          Labels: managedUserDataVolumeLabels(),
          Options: options,
        }),
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, resolve)
    })
    try {
      const client = new DockerEngineClient(socket, "v1.45", 100)
      await expect(
        client.inspectVolume("linksense-user-data"),
      ).rejects.toThrow(
        "Docker user data volume must be an option-free local volume with production user-data labels",
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    ["missing labels", undefined],
    ["null labels", null],
    [
      "a wrong manager label",
      managedUserDataVolumeLabels({
        "com.linksense.managed-by": "manual",
      }),
    ],
    [
      "a wrong persistence label",
      managedUserDataVolumeLabels({
        "com.linksense.persistence": "temporary",
      }),
    ],
    [
      "a wrong role label",
      managedUserDataVolumeLabels({
        "com.linksense.role": "backups",
      }),
    ],
  ])("rejects a local volume with %s", async (_case, labels) => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-socket-"))
    roots.push(root)
    const socket = path.join(root, "docker.sock")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          Name: "linksense-user-data",
          Driver: "local",
          Labels: labels,
          Options: null,
        }),
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, resolve)
    })
    try {
      const client = new DockerEngineClient(socket, "v1.45", 100)
      await expect(
        client.inspectVolume("linksense-user-data"),
      ).rejects.toThrow(
        "Docker user data volume must be an option-free local volume with production user-data labels",
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("reads the authoritative container running state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-socket-"))
    roots.push(root)
    const socket = path.join(root, "docker.sock")
    let requestPath: string | undefined
    const server = createServer((request, response) => {
      requestPath = request.url
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ State: { Running: true } }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, resolve)
    })
    try {
      const client = new DockerEngineClient(socket, "v1.45", 100)
      await expect(
        client.inspectContainerRunning("container/id"),
      ).resolves.toBe(true)
      expect(requestPath).toBe("/v1.45/containers/container%2Fid/json")
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("reads a container resource stats snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-socket-"))
    roots.push(root)
    const socket = path.join(root, "docker.sock")
    let requestPath: string | undefined
    const server = createServer((request, response) => {
      requestPath = request.url
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          read: "2026-08-05T08:00:00.000Z",
          cpu_stats: {
            cpu_usage: {
              total_usage: 300,
              percpu_usage: [0, 0],
            },
            system_cpu_usage: 2_000,
            online_cpus: 2,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 100 },
            system_cpu_usage: 1_000,
          },
          memory_stats: {
            usage: 100 * 1024 * 1024,
            limit: 512 * 1024 * 1024,
            stats: { inactive_file: 4 * 1024 * 1024 },
          },
          pids_stats: { current: 17 },
        }),
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, resolve)
    })
    try {
      const client = new DockerEngineClient(socket, "v1.45", 100)

      await expect(
        client.inspectContainerResourceStats("container/id"),
      ).resolves.toEqual({
        readAt: "2026-08-05T08:00:00.000Z",
        cpuPercent: 40,
        memoryUsageBytes: 96 * 1024 * 1024,
        memoryLimitBytes: 512 * 1024 * 1024,
        pidsCurrent: 17,
      })
      expect(requestPath).toBe(
        "/v1.45/containers/container%2Fid/stats?stream=false",
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("fails a half-open Unix socket request within the configured deadline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-socket-"))
    roots.push(root)
    const socket = path.join(root, "docker.sock")
    const server = createServer(() => {
      // Intentionally keep the response open to exercise the total deadline.
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, resolve)
    })
    try {
      const client = new DockerEngineClient(socket, "v1.45", 20)
      await expect(client.assertCompatible()).rejects.toBeInstanceOf(
        DockerEngineError,
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("rejects a configured API version that cannot express volume subpaths", async () => {
    const client = new DockerEngineClient("/missing/docker.sock", "v1.44", 20)
    await expect(client.assertCompatible()).rejects.toThrow(
      "Docker Engine API 1.45 or newer is required",
    )
  })
})

function managedUserDataVolumeLabels(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "com.linksense.managed-by": "linksense-production",
    "com.linksense.persistence": "critical",
    "com.linksense.role": "user-data",
    ...overrides,
  }
}
