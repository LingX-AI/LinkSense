import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const root = path.resolve(import.meta.dirname, "..")
const directory = await mkdtemp(path.join(tmpdir(), "linksense-gateway-"))
const project = `linksense-gateway-${randomUUID().slice(0, 8)}`
const blocker = `${project}-old-ip`
const environment = { ...process.env, LINKSENSE_VERSION: "v0.3.9" }
const docker = args => execFileSync("docker", args, { env: environment, encoding: "utf8", timeout: 120000 }).trim()
const compose = args => docker(["compose", "--project-directory", directory, "-p", project, "-f", path.join(directory, "compose.yml"), ...args])
const images = JSON.parse(await readFile(path.join(root, "deploy/baselines/images.lock.json"), "utf8")).services
let ownsStack = false
const blockers = []

async function web(origin) {
  return fetch(origin, { headers: { connection: "close" }, signal: AbortSignal.timeout(2000) })
}
async function requireWeb(origin, content) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await web(origin)
      if (response.status === 200 && (await response.text()).trim() === content) return
    } catch {}
    await delay(250)
  }
  assert.fail("The gateway did not serve the expected Web container within its readiness deadline")
}

try {
  for (const image of [images.BUSYBOX, images.GATEWAY]) {
    assert.match(image, /@sha256:[0-9a-f]{64}$/u)
    docker(["pull", image])
  }
  const server = createServer()
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const model = await readFile(path.join(root, "deploy/release/compose.common.yml"), "utf8")
  const releaseLabel = model.match(/^\s+com\.linksense\.release\.version:\s+(\$\{LINKSENSE_VERSION[^}]*\})$/mu)?.[1]
  assert.ok(releaseLabel, "Older upgrade scripts need a gateway config change for each release")
  await mkdir(path.join(directory, "html"))
  const index = path.join(directory, "html/index.html")
  await writeFile(index, "initial-web\n")
  await writeFile(path.join(directory, "compose.yml"), `services:
  web:
    image: ${images.BUSYBOX}
    command: [httpd, -f, -p, '80', -h, /www]
    volumes: [${JSON.stringify(`${directory}/html:/www:ro`)}]
    networks:
      default:
        aliases: [api, minio]
  gateway:
    image: ${images.GATEWAY}
    labels:
      com.linksense.release.version: ${releaseLabel}
    environment:
      NGINX_EXTERNAL_SCHEME: http
      NGINX_CLIENT_MAX_BODY_SIZE: 1m
      NGINX_MINIO_UPSTREAM: http://minio:9000
    ports: ['127.0.0.1:${port}:80']
    volumes: [${JSON.stringify(`${root}/deploy/release/gateway.conf.template:/etc/nginx/templates/default.conf.template:ro`)}]
    depends_on: [web]
`)
  ownsStack = true
  compose(["up", "-d"])
  await requireWeb(origin, "initial-web")
  const previous = JSON.parse(docker(["inspect", compose(["ps", "--quiet", "web"])]))[0]
  const [network, endpoint] = Object.entries(previous.NetworkSettings.Networks)[0]
  docker(["rm", "--force", previous.Id])
  // Reserve the retired IP so replacement cannot accidentally hide stale DNS.
  docker(["run", "-d", "--name", blocker, "--network", network, "--ip", endpoint.IPAddress, images.BUSYBOX, "sleep", "300"])
  blockers.push(blocker)
  await writeFile(index, "replacement-web\n")
  compose(["up", "-d", "web"])
  assert.equal((await web(origin)).status, 502, "The unchanged gateway must reproduce the retired Web address failure")
  const source = await readFile(path.join(root, "deploy/release/linksense-host.sh"), "utf8")
  const activation = source.match(/^activate_release_services\(\) \{\n[\s\S]*?^\}/mu)?.[0]
  assert.ok(activation)
  execFileSync("sh", ["-ec", `${activation}\ncompose() { docker compose --project-directory "$FIXTURE" -p "$PROJECT" -f "$FIXTURE/compose.yml" "$@"; }\nactivate_release_services`], {
    env: { ...environment, FIXTURE: directory, PROJECT: project }, timeout: 120000, stdio: "inherit",
  })
  await requireWeb(origin, "replacement-web")
  const current = JSON.parse(docker(["inspect", compose(["ps", "--quiet", "web"])]))[0]
  const currentEndpoint = current.NetworkSettings.Networks[network]
  docker(["rm", "--force", current.Id])
  const upgradeBlocker = `${project}-upgrade-old-ip`
  docker(["run", "-d", "--name", upgradeBlocker, "--network", network, "--ip", currentEndpoint.IPAddress, images.BUSYBOX, "sleep", "300"])
  blockers.push(upgradeBlocker)
  await writeFile(index, "upgraded-web\n")
  environment.LINKSENSE_VERSION = "v0.3.10"
  // A published older upgrader only runs plain Compose up; the version label must suffice.
  compose(["up", "-d", "--remove-orphans"])
  await requireWeb(origin, "upgraded-web")
  process.stdout.write("Gateway replacement-IP regression passed.\n")
} finally {
  try {
    for (const container of blockers) docker(["rm", "--force", container])
  } finally {
    try { if (ownsStack) compose(["down"]) } finally { await rm(directory, { recursive: true, force: true }) }
  }
}
