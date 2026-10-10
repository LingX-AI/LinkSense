import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { verifyReleaseAssets } from "./publish-release.mjs"

const root = path.resolve(import.meta.dirname, "..")
const volumeNames = ["postgres", "redis", "minio", "user-data", "backups", "elasticsearch", "tokenizer"].map(name => `linksense-${name}`)
const networkNames = ["linksense-internal", "linksense-worker-control", "linksense-worker-egress", "linksense-knowledge-internal"]
const secretKey = /PASSWORD|SECRET|TOKEN|(?:^|_)KEY(?:_ID)?$|^DATABASE_URL$|^REDIS_URL$|^DOCLING_REDIS_URL$/u
const resourceKey = /^LINKSENSE_(?:CPU_QUOTA_MODE|(?:API|RUNNER|POSTGRES|REDIS|MINIO|WORKER|ELASTICSEARCH)_MEMORY_MB|(?:API|RUNNER)_NODE_OPTIONS|MAX_CONCURRENT_CONVERSATIONS|RUNNER_APP_SERVER_PROCESS_LIMIT|(?:CODEX_APP_SERVER|WORKER)_IDLE_TTL_SECONDS|KB_[A-Z]+_CONCURRENCY)$/u
const hash = value => createHash("sha256").update(value).digest("hex")

export function verificationPassword() {
  return `Qa9!${randomBytes(6).toString("hex")}`
}

export function publishedInstallationFixture(source) {
  const position = source.indexOf('log_stage "Stage 1: run the read-only host preflight."')
  assert.ok(position > 0, "Unsupported previous installer fixture")
  // The candidate installation already verified the host's architecture and
  // socket. Preserve those identities while preparing the old persisted state.
  return `${source.slice(0, position)}
TMP_ROOT=$(mktemp -d)
docker_platform=$LINKSENSE_PLATFORM
docker_endpoint=unix://$LINKSENSE_DOCKER_SOCKET_SOURCE
fetch_manifest "$(release_base)"
fetch_release_resources
install -d -m 0700 "$INSTALL_DIR"
write_env
write_pending_state
load_runtime_env
install_resources
pull_images
create_install_volumes
prepare_tokenizer
start_stack
activate_management_cli
write_success_state "$STATE_STARTED_AT"
`
}

export function parseEnvironment(source) {
  const result = Object.create(null)
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue
    const match = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/u.exec(line)
    assert.ok(match && !Object.hasOwn(result, match[1]), "Invalid or duplicate environment entry")
    result[match[1]] = match[2]
  }
  return result
}

export function redactOutput(output, values) {
  let redacted = output
  for (const value of [...new Set(values)].filter(value => value.length >= 4).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(value, "[REDACTED]")
  }
  return redacted.replace(/(Bearer\s+)[^\s"']+/giu, "$1[REDACTED]")
}

export function assertPreserved(before, after) {
  assert.equal(after.installedAt, before.installedAt, "Original installation date changed")
  for (const [key, value] of Object.entries(before.secrets)) assert.ok(after.secrets[key] === value, `Protected setting changed: ${key}`)
  assert.ok(JSON.stringify(after.volumes) === JSON.stringify(before.volumes), "Persistent volumes were replaced")
  for (const [key, value] of Object.entries(before.resources ?? {})) assert.equal(after.resources[key], value, `Installed resource setting changed: ${key}`)
}

export function requireProbeCompletion(output, marker) {
  assert.ok(output.split(/\r?\n/u).includes(marker), "A runtime probe exited without completing its checks")
}

export function assertCleanDaemon({ containers, volumes, networks }) {
  assert.equal(containers.trim(), "", "Installation smoke tests require an empty disposable Docker daemon")
  assert.equal(volumes.trim(), "", "Installation smoke tests refuse a Docker daemon with existing data volumes")
  assert.ok(networks.trim().split(/\s+/u).every(name => ["", "bridge", "host", "none"].includes(name)), "Installation smoke tests refuse existing custom networks")
}

export function verifyInstalledContainers(containers, manifest, edition) {
  const roles = { api: "LINKSENSE_API", web: "LINKSENSE_WEB", runner: "LINKSENSE_RUNNER", migrate: "LINKSENSE_MIGRATE", "worker-image": "LINKSENSE_WORKER", "user-data-init": "BUSYBOX", postgres: "POSTGRES", redis: "REDIS", minio: "MINIO", "minio-init": "MINIO_CLIENT", gateway: "GATEWAY" }
  if (edition === "full") Object.assign(roles, { elasticsearch: "ELASTICSEARCH", "elasticsearch-init": "ELASTICSEARCH", "docling-api": "DOCLING", "docling-worker": "DOCLING" })
  const serviceName = container => container.Config.Labels["com.docker.compose.service"]
  assert.deepEqual(containers.map(serviceName).sort(), Object.keys(roles).sort(), "Installed services differ from the edition contract")
  for (const container of containers) {
    const service = serviceName(container)
    assert.equal(container.Config.Image, manifest[`IMAGE_${roles[service]}`], `Unexpected ${service} image`)
    if (["migrate", "minio-init", "user-data-init", "worker-image", "elasticsearch-init"].includes(service)) {
      assert.equal(container.State.Status, "exited", `${service} has not completed`)
      assert.equal(container.State.ExitCode, 0, `${service} failed`)
    } else assert.equal(container.State.Status, "running", `${service} is not running`)
    if (container.State.Health) assert.equal(container.State.Health.Status, "healthy", `${service} is unhealthy`)
  }
}

export function verifyInstalledResources(containers, env) {
  const memoryKeys = { api: "API", runner: "RUNNER", postgres: "POSTGRES", redis: "REDIS", minio: "MINIO", elasticsearch: "ELASTICSEARCH" }
  for (const container of containers) {
    const service = container.Config.Labels["com.docker.compose.service"]
    if (memoryKeys[service]) assert.equal(container.HostConfig.Memory, Number(env[`LINKSENSE_${memoryKeys[service]}_MEMORY_MB`] ?? 0) * 1024 ** 2, `${service} memory budget differs from the installed configuration`)
    if (["api", "runner"].includes(service)) assert.ok(container.Config.Env.includes(`NODE_OPTIONS=${env[`LINKSENSE_${service.toUpperCase()}_NODE_OPTIONS`] ?? ""}`), `${service} Node heap configuration changed`)
    if (service === "runner") assert.ok(container.Config.Env.includes(`LINKSENSE_CPU_QUOTA_MODE=${env.LINKSENSE_CPU_QUOTA_MODE}`), "Runner CPU mode changed")
    if (["docling-api", "docling-worker"].includes(service)) {
      assert.equal(container.HostConfig.Memory, (service === "docling-api" ? 2048 : 8192) * 1024 ** 2, `${service} memory budget changed`)
      assert.equal(container.HostConfig.NanoCpus, Number(env[`LINKSENSE_${service.toUpperCase().replaceAll("-", "_")}_CPUS`]) * 1e9, `${service} CPU mode changed`)
    }
  }
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function runInstallationSmoke({ assetDirectory, edition, reportDirectory, previousAssetDirectory }) {
  assert.ok(["core", "full"].includes(edition), "Edition must be core or full")
  assert.equal(process.platform, "linux", "Use a disposable Linux test host")
  assert.equal(process.getuid(), 0, "Run this test as root on its disposable host")
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-installation-smoke-"))
  const installDirectory = path.join(directory, "installation")
  await mkdir(reportDirectory, { recursive: true })
  const logPath = path.join(reportDirectory, `${edition}.log`)
  const certificate = path.join(directory, "certificate.pem")
  const privateKey = path.join(directory, "private-key.pem")
  const caBundle = path.join(directory, "ca-bundle.pem")
  const secrets = new Set()
  const assetServers = []
  let ownsInstallation = false
  let phase = "preflight"
  const report = { edition, architecture: process.arch, phases: [], success: false }

  async function readInstalled(name) {
    return parseEnvironment(await readFile(path.join(installDirectory, name), "utf8"))
  }
  async function collectSecrets() {
    try {
      const env = await readInstalled(".env")
      for (const [key, value] of Object.entries(env)) if (secretKey.test(key)) secrets.add(value)
    } catch (error) { if (error.code !== "ENOENT") throw error }
  }
  async function run(command, args, { input, env = {}, timeout = 120000, quiet = false } = {}) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, args, { env: { ...process.env, ...env }, detached: true, stdio: ["pipe", "pipe", "pipe"] })
      let output = ""
      let timedOut = false
      const append = chunk => { output = (output + chunk.toString()).slice(-2 * 1024 * 1024) }
      child.stdout.on("data", append)
      child.stderr.on("data", append)
      child.stdin.on("error", () => {})
      child.stdin.end(input)
      let forced
      const timer = setTimeout(() => {
        timedOut = true
        try { process.kill(-child.pid, "SIGTERM") } catch {}
        forced = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL") } catch {} }, 10000)
      }, timeout)
      child.once("error", error => { clearTimeout(timer); reject(error) })
      child.once("close", code => { clearTimeout(timer); clearTimeout(forced); resolve({ code, output, timedOut }) })
    })
    await collectSecrets()
    if (!quiet || result.code !== 0) await appendFile(logPath, `[${phase}] ${command}\n${redactOutput(result.output, secrets)}\n`)
    assert.ok(result.code === 0 && !result.timedOut, `${phase}: ${command} ${result.timedOut ? "timed out" : "failed"}; see the redacted installation report`)
    return result.output.trim()
  }
  const docker = (args, options = {}) => run("docker", args, { quiet: true, ...options })
  const composeArgs = ["compose", "--project-directory", installDirectory, "--env-file", path.join(installDirectory, ".env"), "-f", path.join(installDirectory, "compose.common.yml"), "-f", path.join(installDirectory, `compose.${edition}.yml`)]
  const compose = (args, options) => docker([...composeArgs, ...args], options)
  async function step(name, action) {
    phase = name
    process.stdout.write(`[${edition}/${process.arch}] ${name}\n`)
    const result = await action()
    report.phases.push(name)
    return result
  }
  async function serveAssets(assets) {
    const port = await availablePort()
    const child = spawn(process.execPath, [path.join(root, "scripts/serve-release-assets.mjs"), assets, String(port), certificate, privateKey], { stdio: ["ignore", "pipe", "pipe"] })
    assetServers.push(child)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Asset server startup timed out")), 10000)
      child.once("error", error => { clearTimeout(timer); reject(error) })
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Asset server exited")) })
      child.stdout.once("data", () => { clearTimeout(timer); resolve() })
    })
    return `https://127.0.0.1:${port}`
  }
  async function verifyAssets(assets, expected = {}) {
    const manifest = parseEnvironment(await readFile(path.join(assets, "release-manifest.env"), "utf8"))
    verifyReleaseAssets({ assetDirectory: assets, version: expected.version ?? manifest.RELEASE_VERSION, sourceSha: expected.sourceSha ?? manifest.RELEASE_GIT_COMMIT, workflowUrl: expected.workflowUrl ?? manifest.RELEASE_WORKFLOW_ID })
    return manifest
  }
  async function snapshot() {
    const env = await readInstalled(".env")
    const state = await readInstalled("install-state.env")
    const names = state.STATE_DATA_VOLUMES.split(",")
    assert.ok(names.every(name => volumeNames.includes(name)), "Unexpected data volume")
    const volumes = JSON.parse(await docker(["volume", "inspect", ...names])).map(({ Name, CreatedAt, Mountpoint, Driver }) => ({ Name, CreatedAt, Mountpoint, Driver })).sort((a, b) => a.Name.localeCompare(b.Name))
    return { installedAt: state.STATE_INSTALLED_AT, secrets: Object.fromEntries(Object.entries(env).filter(([key]) => secretKey.test(key)).map(([key, value]) => [key, hash(value)])), resources: Object.fromEntries(Object.entries(env).filter(([key]) => resourceKey.test(key))), volumes }
  }
  const httpPort = await availablePort()
  const origin = `http://127.0.0.1:${httpPort}`
  async function request(route, { body, token, status = 200 } = {}) {
    const response = await fetch(`${origin}/api/v1${route}`, { method: body ? "POST" : "GET", headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) })
    assert.equal(response.status, status, `Unexpected status for ${route}`)
    return (await response.json()).data
  }
  async function seedAccount() {
    const id = randomUUID()
    const account = { email: `release-${id}@example.org`, password: verificationPassword(), name: "Release verification" }
    secrets.add(account.password)
    await request("/system/initialize", { body: account, status: 403 })
    const env = await readInstalled(".env")
    const initialized = await request("/system/initialize", { body: { ...account, initialization_credential: env.LINKSENSE_INITIALIZATION_TOKEN }, status: 201 })
    const fixture = { id, userId: initialized.user.id, account }
    await verifyAccount(fixture)
    await runtimeProbe(fixture, "seed")
    return fixture
  }
  async function verifyAccount(fixture) {
    await request("/admin/model-provider-settings", { status: 401 })
    const session = await request("/auth/login", { body: { email: fixture.account.email, password: fixture.account.password } })
    secrets.add(session.access_token)
    assert.equal(session.user.id, fixture.userId, "Administrator identity changed")
    assert.equal(session.user.role, "admin")
    await request("/admin/model-provider-settings", { token: session.access_token })
    const page = await fetch(origin, { signal: AbortSignal.timeout(15000) })
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<html/iu)
  }
  async function runtimeProbe(fixture, operation) {
    const output = await compose(["exec", "-T", "api", "node", "--input-type=module", "-", operation, fixture.id, fixture.userId], { input: await readFile(path.join(root, "scripts/fixtures/installed-runtime-probe.mjs")), timeout: 180000 })
    requireProbeCompletion(output, "Installed runtime persistence probe passed.")
  }
  async function verifyInstallation(manifest) {
    const state = await readInstalled("install-state.env")
    const env = await readInstalled(".env")
    assert.equal(state.STATE_RELEASE_VERSION, manifest.RELEASE_VERSION)
    assert.equal(env.LINKSENSE_VERSION, manifest.RELEASE_VERSION)
    assert.equal((await stat(path.join(installDirectory, ".env"))).mode & 0o777, 0o600)
    let containers
    for (let attempt = 0; attempt < 150; attempt++) {
      containers = JSON.parse(await docker(["inspect", ...(await compose(["ps", "--all", "--quiet"])).split(/\s+/u)]))
      if (containers.every(container => !container.State.Health || container.State.Health.Status === "healthy")) break
      await delay(2000)
    }
    verifyInstalledContainers(containers, manifest, edition)
    if (manifest.RESOURCE_HOST_ADAPTATION_FORMAT === "1") {
      assert.equal(env.LINKSENSE_CPU_QUOTA_MODE, process.env.LINKSENSE_CPU_QUOTA_MODE ?? "strict")
      verifyInstalledResources(containers, env)
    }
    await request("/system/health/ready")
  }
  async function cleanupInstallation() {
    if (!ownsInstallation) return
    const containers = await docker(["ps", "--all", "--quiet", "--filter", "label=com.docker.compose.project=linksense"])
    if (containers) await docker(["rm", "--force", ...containers.split(/\s+/u)])
    for (const name of volumeNames) {
      if ((await docker(["volume", "ls", "--quiet", "--filter", `name=^${name}$`])).trim() === name) await docker(["volume", "rm", name])
    }
    for (const name of networkNames) {
      if ((await docker(["network", "ls", "--format", "{{.Name}}", "--filter", `name=^${name}$`])).trim() === name) await docker(["network", "rm", name])
    }
    const launcher = "/usr/local/bin/linksense"
    try { if ((await readFile(launcher, "utf8")).includes(installDirectory)) await rm(launcher) } catch (error) { if (error.code !== "ENOENT") throw error }
    await rm(installDirectory, { recursive: true, force: true })
    ownsInstallation = false
  }
  try {
    assertCleanDaemon({ containers: await docker(["ps", "--all", "--quiet"]), volumes: await docker(["volume", "ls", "--quiet"]), networks: await docker(["network", "ls", "--format", "{{.Name}}"] ) })
    const manifest = await verifyAssets(assetDirectory, { version: process.env.RELEASE_VERSION, sourceSha: process.env.SOURCE_SHA, workflowUrl: process.env.RELEASE_WORKFLOW_ID })
    report.version = manifest.RELEASE_VERSION
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", privateKey, "-out", certificate], { quiet: true })
    await chmod(privateKey, 0o600)
    await writeFile(caBundle, Buffer.concat([await readFile("/etc/ssl/certs/ca-certificates.crt"), await readFile(certificate)]))
    const base = await serveAssets(assetDirectory)
    const socket = process.env.DOCKER_HOST ?? await docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])
    assert.ok(socket.startsWith("unix://"), "Installation tests require a local Unix socket")
    const environment = { LINKSENSE_RELEASE_BASE_URL: base, LINKSENSE_VERSION: manifest.RELEASE_VERSION, LINKSENSE_INSTALL_DIR: installDirectory, LINKSENSE_HTTP_PORT: String(httpPort), CURL_CA_BUNDLE: caBundle, LINKSENSE_DOCKER_SOCKET_SOURCE: socket.slice(7), LINKSENSE_DOCKER_SOCKET_PATH: "/var/run/docker.sock" }
    async function entry(name, overrides = {}) {
      return run("sh", [path.join(root, name)], { env: { ...environment, ...overrides }, timeout: 1800000 })
    }
    await step("fresh installation", async () => {
      ownsInstallation = true
      const output = await entry(`install-${edition}.sh`)
      if (edition === "full") assert.match(output, /Full release probe passed\./u)
      await verifyInstallation(manifest)
    })
    const fixture = await step("initialize administrator and persistence fixtures", seedAccount)
    const before = await snapshot()
    await step("idempotent installation", async () => { await entry(`install-${edition}.sh`); assertPreserved(before, await snapshot()); await runtimeProbe(fixture, "verify") })
    await step("repair stopped services and tokenizer permissions", async () => {
      await compose(["stop", "api"])
      if (edition === "full") await docker(["run", "--rm", "--network", "none", "-v", "linksense-tokenizer:/tokenizer", manifest.IMAGE_BUSYBOX, "sh", "-ec", "find /tokenizer -type f -exec chmod 0400 {} +"])
      await appendFile(path.join(installDirectory, `compose.${edition}.yml`), "\n# installation verification: repair must restore this file\n")
      await entry(`repair-${edition}.sh`)
      assert.ok((await readFile(path.join(installDirectory, `compose.${edition}.yml`))).equals(await readFile(path.join(assetDirectory, `compose.${edition}.yml`))), "Repair did not restore the release configuration")
      await verifyInstallation(manifest)
      assertPreserved(before, await snapshot())
      await verifyAccount(fixture)
      await runtimeProbe(fixture, "verify")
    })
    await step("same-version upgrade", async () => {
      const ids = await compose(["ps", "--quiet"])
      await entry("upgrade.sh")
      assert.equal(await compose(["ps", "--quiet"]), ids, "Same-version upgrade restarted services")
      assertPreserved(before, await snapshot())
    })
    await cleanupInstallation()
    if (previousAssetDirectory) {
      const previous = await verifyAssets(previousAssetDirectory)
      assert.notEqual(previous.RELEASE_VERSION, manifest.RELEASE_VERSION, "Upgrade baseline must be an earlier published release")
      report.upgradeFrom = previous.RELEASE_VERSION
      const previousBase = await serveAssets(previousAssetDirectory)
      await step("prepare published-version upgrade fixture", async () => {
        // The previous Full installer has known broken readiness/OCR checks.
        // Build a fixture with its unmodified images, schema, configuration and
        // state writer; this does not certify that old installer as successful.
        const source = await readFile(path.join(previousAssetDirectory, "linksense-installer.sh"), "utf8")
        const script = path.join(directory, "prepare-previous.sh")
        await writeFile(script, publishedInstallationFixture(source), { mode: 0o700 })
        ownsInstallation = true
        await run("sh", [script], { timeout: 1800000, env: { ...environment, LINKSENSE_RELEASE_BASE_URL: previousBase, LINKSENSE_VERSION: previous.RELEASE_VERSION, LINKSENSE_INSTALL_ACTION: "install", LINKSENSE_INSTALL_EDITION: edition } })
        await verifyInstallation(previous)
      })
      const legacy = await step("seed published-version persistence fixtures", seedAccount)
      await step("configure custom published-version resource limits", async () => {
        const file = path.join(installDirectory, ".env")
        const custom = { LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: "7", LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: "3", LINKSENSE_WORKER_MEMORY_MB: "6144", LINKSENSE_WORKER_IDLE_TTL_SECONDS: "77" }
        const existing = parseEnvironment(await readFile(file, "utf8"))
        await writeFile(file, Object.entries({ ...existing, ...custom }).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 })
      })
      const legacyBefore = await snapshot()
      await step("upgrade persisted published-version data", async () => {
        await entry("upgrade.sh")
        await verifyInstallation(manifest)
        assertPreserved(legacyBefore, await snapshot())
        await verifyAccount(legacy)
        await runtimeProbe(legacy, "verify")
        const env = await readInstalled(".env")
        await docker(["run", "--rm", "--network", "none", "-v", "linksense-backups:/backups:ro", "--entrypoint", "sh", env.POSTGRES_IMAGE, "-ec", "set -- /backups/postgres/*.dump; test -f \"$1\"; for file do pg_restore --list \"$file\" >/dev/null; done"])
      })
      await step("repair upgraded installation", async () => { await entry(`repair-${edition}.sh`); assertPreserved(legacyBefore, await snapshot()); await runtimeProbe(legacy, "verify") })
    }
    report.success = true
  } catch (error) {
    report.failedPhase = phase
    report.error = redactOutput(error.message, secrets)
    throw new Error(report.error)
  } finally {
    try { await cleanupInstallation() } catch (error) {
      report.success = false
      report.failedPhase ??= "cleanup"
      report.error ??= redactOutput(error.message, secrets)
      throw new Error(report.error)
    } finally {
      for (const child of assetServers) child.kill("SIGTERM")
      await writeFile(path.join(reportDirectory, `${edition}.json`), JSON.stringify(report, null, 2) + "\n")
      await rm(directory, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [assetDirectory, edition, reportDirectory, previousAssetDirectory] = process.argv.slice(2)
  assert.ok(assetDirectory && edition && reportDirectory, "usage: release-installation-smoke.mjs <assets> <core|full> <reports> [previous-assets]")
  runInstallationSmoke({ assetDirectory: path.resolve(assetDirectory), edition, reportDirectory: path.resolve(reportDirectory), ...(previousAssetDirectory ? { previousAssetDirectory: path.resolve(previousAssetDirectory) } : {}) }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
