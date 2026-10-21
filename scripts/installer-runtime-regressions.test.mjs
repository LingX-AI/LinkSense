import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const installer = readFileSync(new URL("../deploy/release/linksense-installer.sh", import.meta.url), "utf8")
const x86V2Flags = "fpu cx8 cmov mmx fxsr sse sse2 syscall lm cx16 lahf_lm pni popcnt ssse3 sse4_1 sse4_2"
const cpuDockerStub = `
docker() {
  printf '%s\\n' "$@" >> "$CPU_TRACE"
  [ "$CPU_DOCKER_EXIT" -eq 0 ] || return "$CPU_DOCKER_EXIT"
  while [ "$1" != "$IMAGE_BUSYBOX" ]; do shift; done
  shift
  awk "$1" "$CPU_FIXTURE"
}
`
function shellFunction(name) {
  const match = installer.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, "mu"))
  assert.ok(match, `${name} must exist`)
  return match[0]
}
function directory(t) {
  const value = mkdtempSync(path.join(tmpdir(), "linksense-installer-regression-"))
  t.after(() => rmSync(value, { recursive: true, force: true }))
  return value
}

for (const scenario of [
  { name: "accepts all x86-64-v2 features", flags: x86V2Flags },
  { name: "accepts the SSE3 alias", flags: x86V2Flags.replace("pni", "sse3") },
  ...["cx16", "lahf_lm", "pni", "popcnt", "ssse3", "sse4_1", "sse4_2"].map(feature => ({
    name: `rejects missing ${feature}`,
    flags: x86V2Flags.split(" ").filter(flag => flag !== feature).join(" "),
    missing: feature === "pni" ? "sse3" : feature,
  })),
  { name: "rejects partial feature-name matches", flags: x86V2Flags.replace("popcnt", "popcnt_extra"), missing: "popcnt" },
  { name: "checks every virtual CPU", flags: x86V2Flags, secondFlags: x86V2Flags.replace("popcnt", ""), missing: "popcnt" },
  { name: "rejects an unreadable feature set", flags: null, probeFailed: true },
  { name: "reports Docker failures separately", flags: x86V2Flags, dockerExit: 125, probeFailed: true },
  { name: "does not check Core on amd64", edition: "core", skip: true },
  { name: "does not check Full on ARM64", platform: "linux-arm64", skip: true },
  { name: "does not check Core on ARM64", edition: "core", platform: "linux-arm64", skip: true },
]) {
  test(`Full CPU preflight ${scenario.name}`, t => {
    const root = directory(t)
    const trace = path.join(root, "docker.trace")
    const fixture = path.join(root, "cpuinfo")
    const records = ["processor : 0"]
    if (scenario.flags !== null) records.push(`flags : ${scenario.flags ?? x86V2Flags}`)
    if (scenario.secondFlags) records.push("processor : 1", `flags : ${scenario.secondFlags}`)
    writeFileSync(fixture, `${records.join("\n")}\n`)
    const result = spawnSync("sh", ["-c", `
set -eu
${shellFunction("fail")}
${shellFunction("check_full_cpu")}
${cpuDockerStub}
log() { :; }
EDITION=$1
LINKSENSE_PLATFORM=$2
IMAGE_BUSYBOX=fixture-busybox
check_full_cpu
`, "sh", scenario.edition ?? "full", scenario.platform ?? "linux-amd64"], {
      encoding: "utf8",
      env: { ...process.env, CPU_TRACE: trace, CPU_FIXTURE: fixture, CPU_DOCKER_EXIT: String(scenario.dockerExit ?? 0) },
    })
    assert.equal(result.status, scenario.missing || scenario.probeFailed ? 1 : 0, result.stderr)
    if (scenario.skip) {
      assert.throws(() => readFileSync(trace), { code: "ENOENT" })
    } else {
      const recorded = readFileSync(trace, "utf8")
      assert.match(recorded, /^run\n--rm\n--network\nnone\n--read-only\n--cap-drop\nALL\n--security-opt\nno-new-privileges\n--entrypoint\nawk\nfixture-busybox\n/u)
      assert.match(recorded, /\n\/proc\/cpuinfo\n$/u)
      if (scenario.probeFailed) {
        assert.match(result.stderr, /Could not check CPU features inside Docker Engine/u)
        assert.doesNotMatch(result.stderr, /Missing CPU features/u)
      } else if (scenario.missing) {
        assert.match(result.stderr, /Full on linux\/amd64 requires x86-64-v2/u)
        assert.ok(result.stderr.includes(scenario.missing), result.stderr)
        assert.match(result.stderr, /Shut down.*VM.*host-passthrough/u)
        assert.match(result.stderr, /x86-64-v2-AES/u)
      }
    }
  })
}

for (const scenario of [
  { action: "install", format: 2, version: "v0.3.7" },
  { action: "repair", format: 2, version: "v0.3.7" },
  { action: "upgrade", format: 2, version: "v0.3.7" },
  { action: "upgrade", format: 1, version: "v0.1.0" },
]) {
  for (const supported of [false, true]) {
    test(`Full ${scenario.action} with state format ${scenario.format} ${supported ? "continues" : "stops before configuration changes"} after the CPU check`, t => {
      const root = directory(t)
      const installDirectory = path.join(root, "install")
      const stateFile = path.join(installDirectory, "install-state.env")
      const envFile = path.join(installDirectory, ".env")
      const state = [
        `STATE_FORMAT=${scenario.format}`,
        "STATE_EDITION=full",
        scenario.format === 2 ? "STATE_PLATFORM=linux-amd64" : null,
        `STATE_RELEASE_VERSION=${scenario.version}`,
        `STATE_MANIFEST_SHA256=${"a".repeat(64)}`,
        `STATE_INSTALL_DIR=${installDirectory}`,
        "STATE_INSTALLED_AT=2026-01-01T00:00:00Z",
        "",
      ].filter(line => line !== null).join("\n")
      const environment = `LINKSENSE_EDITION=full\nLINKSENSE_VERSION=${scenario.version}\n`
      if (scenario.action !== "install") {
        mkdirSync(installDirectory)
        writeFileSync(stateFile, state)
        writeFileSync(envFile, environment)
      }
      const fixture = path.join(root, "cpuinfo")
      writeFileSync(fixture, `flags : ${supported ? x86V2Flags : "fpu sse sse2"}\n`)
      const mainPosition = installer.lastIndexOf('\nif [ "$ACTION" = install ]; then')
      assert.ok(mainPosition > 0)
      const main = installer.slice(mainPosition)
      const result = spawnSync("sh", ["-c", `
set -eu
${["fail", "check_full_cpu", "load_strict_env", "require_loaded_keys", "version_ge", "repair_action", "upgrade_action"].map(shellFunction).join("\n")}
${cpuDockerStub}
log() { :; }
log_stage() { :; }
verify_private_file() { :; }
verify_existing_volumes() { :; }
validate_resource_budget() { :; }
load_runtime_env() { LINKSENSE_VERSION=$FIXTURE_VERSION; LINKSENSE_EDITION=full; }
release_base() { printf https://release.example; }
fetch_manifest() {
  RELEASE_VERSION=$FIXTURE_TARGET_VERSION
  MANIFEST_SHA256=$FIXTURE_MANIFEST_SHA
  IMAGE_BUSYBOX=fixture-busybox
}
fetch_release_resources() { printf 'release resources reached\\n'; exit 88; }
install_action() { printf 'installation changes reached\\n'; exit 88; }
EDITION=full
LINKSENSE_PLATFORM=linux-amd64
ACTION=$1
INSTALL_DIR=$2
UPGRADE_PENDING_EXISTED=false
${main}
`, "sh", scenario.action, installDirectory], {
        encoding: "utf8",
        env: {
          ...process.env,
          CPU_TRACE: path.join(root, "docker.trace"), CPU_FIXTURE: fixture, CPU_DOCKER_EXIT: "0",
          FIXTURE_VERSION: scenario.version,
          FIXTURE_TARGET_VERSION: scenario.action === "upgrade" ? "v0.3.8" : scenario.version,
          FIXTURE_MANIFEST_SHA: (scenario.action === "upgrade" ? "b" : "a").repeat(64),
        },
      })
      assert.equal(result.status, supported ? 88 : 1, result.stderr)
      if (supported) assert.match(result.stdout, /resources reached|changes reached/u)
      else {
        assert.match(result.stderr, /Full on linux\/amd64 requires x86-64-v2/u)
        assert.doesNotMatch(result.stdout, /resources reached|changes reached/u)
      }
      if (scenario.action === "install") assert.throws(() => readFileSync(stateFile), { code: "ENOENT" })
      else {
        assert.equal(readFileSync(stateFile, "utf8"), state)
        assert.equal(readFileSync(envFile, "utf8"), environment)
      }
    })
  }
}

for (const [current, required, accepted] of [
  ["v1.0.0", "v0.99.9", true],
  ["v0.99.9", "v1.0.0", false],
  ["v0.3.6", "v0.3.5", true],
  ["v0.3.5", "v0.3.6", false],
  ["v0.3.5", "v0.3.5", true],
  ["1.55", "1.45", true],
  ["2.24.3", "2.24.4", false],
]) {
  test(`version comparison ${current} >= ${required} is ${accepted}`, () => {
    const result = spawnSync("sh", ["-c", `${shellFunction("version_ge")}\nversion_ge "$1" "$2"`, "sh", current, required], { encoding: "utf8" })
    assert.equal(result.status, accepted ? 0 : 1, result.stderr)
  })
}

for (const [trustedState, expectedStatus] of [[true, 0], [false, 1]]) {
  test(`repeated installation ${trustedState ? "accepts" : "rejects"} an occupied LinkSense port ${trustedState ? "with" : "without"} trusted state`, t => {
    const installDirectory = directory(t)
    if (trustedState) writeFileSync(path.join(installDirectory, "install-state.env"), "STATE_FORMAT=2\n", { mode: 0o600 })
    const result = spawnSync("sh", ["-c", `
set -eu
${shellFunction("check_port")}
fail() { exit 1; }
docker() {
  case "$1" in
    ps) printf 'fixture-container linksense-gateway-1\\n' ;;
    inspect) printf 'linksense\\n' ;;
    *) exit 9 ;;
  esac
}
ss() { printf 'LISTEN 0 4096 0.0.0.0:18081 0.0.0.0:*\\n'; }
ACTION=install
HTTP_PORT=18081
INSTALL_DIR=$1
check_port
`, "sh", installDirectory], { encoding: "utf8" })
    assert.equal(result.status, expectedStatus, result.stderr)
  })
}

for (const [output, exitCode, accepted] of [
  ["Full release probe passed.", 0, true],
  ["", 0, false],
  ["Full release probe passed.", 1, false],
]) {
  test(`Full probe requires positive completion and a successful exit (${JSON.stringify(output)}, ${exitCode})`, t => {
    const root = directory(t)
    const result = spawnSync("sh", ["-c", `
set -eu
${shellFunction("run_full_release_probe")}
fail() { printf '%s\\n' "$*" >&2; exit 1; }
log() { printf '%s\\n' "$*"; }
compose() { printf '%s\\n' "$PROBE_OUTPUT"; return "$PROBE_EXIT"; }
compose_bounded() { shift; compose "$@"; }
EDITION=full
TMP_ROOT=$1
run_full_release_probe
`, "sh", root], { encoding: "utf8", env: { ...process.env, PROBE_OUTPUT: output, PROBE_EXIT: String(exitCode) } })
    assert.equal(result.status, accepted ? 0 : 1, result.stderr)
  })
}
