import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const installer = readFileSync(new URL("../deploy/release/linksense-installer.sh", import.meta.url), "utf8")
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
EDITION=full
TMP_ROOT=$1
run_full_release_probe
`, "sh", root], { encoding: "utf8", env: { ...process.env, PROBE_OUTPUT: output, PROBE_EXIT: String(exitCode) } })
    assert.equal(result.status, accepted ? 0 : 1, result.stderr)
  })
}
