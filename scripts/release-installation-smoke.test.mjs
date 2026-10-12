import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { assertCleanDaemon, assertPreserved, parseEnvironment, publishedInstallationFixture, redactOutput, requireProbeCompletion, verificationPassword, verifyInstalledContainers } from "./release-installation-smoke.mjs"

test("installation accounts use random passwords within the application's 8–16 character policy", () => {
  const passwords = Array.from({ length: 20 }, verificationPassword)
  assert.equal(new Set(passwords).size, passwords.length)
  for (const password of passwords) {
    assert.ok(password.length >= 8 && password.length <= 16)
    for (const required of [/[A-Z]/u, /[a-z]/u, /[0-9]/u, /[!@#$%^&*]/u]) assert.match(password, required)
  }
})

test("published-version fixtures preserve the verified Docker identity and use the old state writer after service startup", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-published-fixture-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const operations = ["fetch_manifest", "fetch_release_resources", "write_env", "write_pending_state", "load_runtime_env", "install_resources", "pull_images", "create_install_volumes", "prepare_tokenizer", "start_stack", "activate_management_cli", "write_success_state"]
  const source = `set -eu
release_base() { printf 'https://fixture.example'; }
${operations.map(name => `${name}() { printf '${name}\\n'; ${name === "write_pending_state" ? "STATE_STARTED_AT=fixture-started;" : name === "load_runtime_env" ? 'test "$docker_platform" = linux-arm64; test "$docker_endpoint" = unix:///var/run/docker.sock;' : name === "write_success_state" ? 'test "$1" = fixture-started;' : ""} }`).join("\n")}
log_stage "Stage 1: run the read-only host preflight."
exit 77
`
  const result = spawnSync("sh", ["-c", publishedInstallationFixture(source)], { encoding: "utf8", env: { ...process.env, TMPDIR: directory, INSTALL_DIR: path.join(directory, "installation"), LINKSENSE_PLATFORM: "linux-arm64", LINKSENSE_DOCKER_SOCKET_SOURCE: "/var/run/docker.sock" } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split("\n"), operations)
  assert.throws(() => publishedInstallationFixture("unsupported installer"), /Unsupported/u)
})

test("the installation gate refuses any existing container, volume, or custom network", () => {
  const clean = { containers: "", volumes: "", networks: "bridge\nhost\nnone\n" }
  assert.doesNotThrow(() => assertCleanDaemon(clean))
  for (const occupied of [{ containers: "business-api" }, { volumes: "customer-data" }, { networks: "bridge\ncustomer-network" }]) {
    assert.throws(() => assertCleanDaemon({ ...clean, ...occupied }), /disposable|existing/u)
  }
})

test("environment parsing preserves complete values without executing shell expressions", () => {
  assert.equal(parseEnvironment("# metadata\nPASSWORD=abc==\nCOMMAND=$(touch unexpected)\n").PASSWORD, "abc==")
  assert.equal(parseEnvironment("COMMAND=$(touch unexpected)\n").COMMAND, "$(touch unexpected)")
  for (const invalid of ["KEY=a\nKEY=b\n", "not an assignment\n", "KEY=value\rinjected"]) assert.throws(() => parseEnvironment(invalid))
})

test("logs redact credentials, credential-bearing URLs, and bearer tokens", () => {
  const password = "generated-test-password"
  const connection = `postgresql://user:${password}@postgres/linksense`
  const redacted = redactOutput(`${connection}\n${password}\nBearer fixture-token\nnormal status`, [password, connection])
  assert.equal(redacted, "[REDACTED]\n[REDACTED]\nBearer [REDACTED]\nnormal status")
})

test("repair and upgrade verification reject changed secrets or replaced persistent volumes without disclosing values", () => {
  const snapshot = { installedAt: "2026-10-01T00:00:00Z", secrets: { SECRET: "private-value" }, volumes: [{ Name: "data", CreatedAt: "original" }] }
  assert.doesNotThrow(() => assertPreserved(snapshot, structuredClone(snapshot)))
  for (const changed of [{ installedAt: "another-time" }, { secrets: { SECRET: "different-value" } }, { volumes: [{ Name: "data", CreatedAt: "replacement" }] }]) {
    assert.throws(() => assertPreserved(snapshot, { ...snapshot, ...changed }), error => !error.message.includes("private-value") && !error.message.includes("different-value"))
  }
})

test("a zero-exit runtime process is insufficient without its exact completion marker", () => {
  const marker = "Installed runtime persistence probe passed."
  assert.doesNotThrow(() => requireProbeCompletion(marker + "\n", marker))
  for (const output of ["", "processing", `not ${marker}`]) assert.throws(() => requireProbeCompletion(output, marker))
})

for (const edition of ["core", "full"]) {
  test(`${edition} checks every service and requires initialization containers to finish successfully`, () => {
    const roles = { api: "LINKSENSE_API", web: "LINKSENSE_WEB", runner: "LINKSENSE_RUNNER", postgres: "POSTGRES", redis: "REDIS", minio: "MINIO", gateway: "GATEWAY", migrate: "LINKSENSE_MIGRATE", "worker-image": "LINKSENSE_WORKER", "user-data-init": "BUSYBOX", "minio-init": "MINIO_CLIENT", ...(edition === "full" ? { elasticsearch: "ELASTICSEARCH", "elasticsearch-init": "ELASTICSEARCH", "docling-api": "DOCLING", "docling-worker": "DOCLING" } : {}) }
    const manifest = Object.fromEntries(Object.values(roles).map(role => [`IMAGE_${role}`, `registry.example/${role.toLowerCase()}@sha256:${"a".repeat(64)}`]))
    const containers = Object.entries(roles).map(([service, role]) => ({
      Config: { Labels: { "com.docker.compose.service": service }, Image: manifest[`IMAGE_${role}`] },
      State: { Status: ["migrate", "worker-image", "user-data-init", "minio-init", "elasticsearch-init"].includes(service) ? "exited" : "running", ExitCode: 0 },
    }))
    assert.doesNotThrow(() => verifyInstalledContainers(containers, manifest, edition))
    assert.throws(() => verifyInstalledContainers(containers.slice(1), manifest, edition), /services/u)
    for (const [service, field, value] of [["user-data-init", "ExitCode", 1], ["migrate", "Status", "running"], ["api", "Status", "exited"], ["api", "Health", { Status: "unhealthy" }]]) {
      const changed = structuredClone(containers)
      changed.find(container => container.Config.Labels["com.docker.compose.service"] === service).State[field] = value
      assert.throws(() => verifyInstalledContainers(changed, manifest, edition))
    }
    const changed = structuredClone(containers)
    changed[0].Config.Image = "registry.example/unverified:latest"
    assert.throws(() => verifyInstalledContainers(changed, manifest, edition), /image/u)
  })
}
