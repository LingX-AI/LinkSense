import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { DockerEngineClient } from "../apps/runner/src/docker/engine-client.js"

const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  }).trim()
const name = "linksense-disk-test-" + randomUUID()
const volume = name + "-users"
const bindRoot = mkdtempSync(join(tmpdir(), name + "-"))
const image =
  process.env.LINKSENSE_TEST_WORKER_BASE_IMAGE ??
  "linksense-runner-worker:oss-local"
const context = z
  .array(
    z.object({
      Endpoints: z.object({ docker: z.object({ Host: z.string() }) }),
    }),
  )
  .parse(JSON.parse(docker("context", "inspect")))
const host = context[0]?.Endpoints.docker.Host
assert(
  host?.startsWith("unix://"),
  "This smoke requires a local Docker Unix socket",
)
const engine = new DockerEngineClient(host.slice("unix://".length), "1.45")
const containers: string[] = []
let volumeCreated = false
const seed = String.raw`
const fs = require("node:fs");
for (const path of ["/fixture/user-a/projects/project-a", "/fixture/user-b/archive/task-b", "/fixture/.object-storage/objects"]) fs.mkdirSync(path, { recursive: true });
fs.writeFileSync("/fixture/user-a/projects/project-a/artifact", Buffer.alloc(65536, 1));
fs.linkSync("/fixture/user-a/projects/project-a/artifact", "/fixture/user-b/archive/task-b/shared-artifact");
fs.symlinkSync("/etc", "/fixture/user-a/projects/project-a/external-link");
const fd = fs.openSync("/fixture/user-b/archive/task-b/sparse", "w");
fs.writeSync(fd, Buffer.from("end"), 0, 3, 128 * 1024 * 1024); fs.closeSync(fd);
fs.writeFileSync("/fixture/.object-storage/objects/attachment", Buffer.alloc(32768, 2));
`
try {
  docker(
    "volume",
    "create",
    "--label",
    "com.linksense.test.disposable=true",
    volume,
  )
  volumeCreated = true
  for (const kind of ["volume", "bind"] as const) {
    const project = name + "-" + kind
    const source = kind === "volume" ? volume : bindRoot
    const mount = "type=" + kind + ",source=" + source + ",target=/fixture"
    const create = (service: string, command: string) =>
      docker(
        "create",
        "--name",
        project + "-" + service,
        "--network",
        "none",
        "--label",
        "com.linksense.test.disposable=true",
        "--label",
        "com.docker.compose.project=" + project,
        "--label",
        "com.docker.compose.service=" + service,
        "--mount",
        mount,
        "--entrypoint",
        "node",
        image,
        "-e",
        command,
      )
    const seeded = create("api", seed)
    containers.push(seeded)
    docker("start", "--attach", seeded)
    containers.push(create("runner", "process.exit(0)"))
    const expected = Number(
      docker(
        "run",
        "--rm",
        "--network",
        "none",
        "--mount",
        mount + ",readonly",
        "--entrypoint",
        "du",
        image,
        "-B1",
        "-s",
        "/fixture",
      ).split(/\s/u)[0],
    )
    const snapshot = await engine.collectDiskUsage({
      project,
      instance: project,
      image,
      userDataRoot: "/fixture",
      userDataVolume: kind === "volume" ? volume : undefined,
    })
    assert.equal(snapshot.status, "available", JSON.stringify(snapshot))
    assert.equal(
      snapshot.categories.find((category) => category.key === "user_data")
        ?.used_bytes,
      expected,
    )
    assert(
      expected < 1024 * 1024,
      "Sparse files and hard links must use allocated space",
    )
    assert.equal(
      snapshot.total_bytes,
      snapshot.categories.reduce(
        (sum, category) => sum + (category.used_bytes ?? 0),
        0,
      ),
    )
    assert(
      (snapshot.categories.find((category) => category.key === "images")
        ?.used_bytes ?? 0) > 0,
    )
    assert.equal(
      docker(
        "ps",
        "-aq",
        "--filter",
        "label=com.linksense.health.disk-probe=true",
        "--filter",
        "label=com.linksense.runner.instance=" + project,
      ),
      "",
      "Probe containers must be removed after sampling",
    )
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        mount_type: kind,
        user_data_bytes: expected,
        probes_remaining: 0,
      }) + "\n",
    )
  }
} finally {
  for (const id of containers) docker("rm", "--force", "--volumes", id)
  if (volumeCreated) docker("volume", "rm", volume)
  rmSync(bindRoot, { recursive: true, force: true })
}
