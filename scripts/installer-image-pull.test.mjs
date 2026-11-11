import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { applicationImages } from "./release-image-inventory.mjs"

const helpers = readFileSync(new URL("../deploy/release/linksense-host.sh", import.meta.url), "utf8")
const installer = readFileSync(new URL("../deploy/release/linksense-installer.sh", import.meta.url), "utf8")
const digest = `sha256:${"a".repeat(64)}`
const image = `ghcr.io/lingx-ai/linksense-api@${digest}`
const mirror = `ghcr.nju.edu.cn/lingx-ai/linksense-api@${digest}`
function fn(name) {
  const match = installer.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, "mu"))
  assert.ok(match, name)
  return match[0]
}
function directory(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "linksense-image-pull-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function run(source, environment = {}, args = []) {
  return spawnSync("/bin/sh", ["-c", `set -eu\n${helpers}\n${source}`, "sh", ...args], {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, LINKSENSE_CLI_LANGUAGE: "en-US", LINKSENSE_IMAGE_MIRRORS: "", ...environment },
  })
}
const pulls = `
docker() { [ "$1:$2" = image:inspect ] && grep -Fqx "$3" "$DIR/cache" 2>/dev/null; }
curl() {
  for endpoint in "$@"; do :; done
  echo "$endpoint" >> "$DIR/probes"
  case "$endpoint" in *nju.edu.cn*) printf '200 0.010' ;; *) printf '200 0.100' ;; esac
}
host_pull_attempt() {
  echo "$1" >> "$DIR/pulls"
  case "$MODE" in
    interrupted) return 130 ;;
    credential)
      if [ "$1" = "$IMAGE" ]; then
        printf '%s\\n' 'exec: "docker-credential-missing": executable file not found' > "$3"
        return 1
      fi ;;
  esac
  if [ "$MODE" = failed ] || { [ "$MODE" != official ] && [ "$1" = "$IMAGE" ]; } ||
    { [ "$MODE" = second ] && [ "\${1%%/*}" = ghcr.nju.edu.cn ]; }; then
    echo 'connection refused private-proxy-value' > "$3"
    return 124
  fi
  if [ "$MODE" != wrong-digest ]; then echo "$1" >> "$DIR/cache"; fi
}
`

test("the origin is tried before probing public mirrors, and the fastest working mirror keeps the digest", t => {
  const dir = directory(t)
  const result = run(`${pulls}
host_pull_image "$IMAGE"
echo "$HOST_PULLED_IMAGE"
IMAGE=ghcr.io/lingx-ai/linksense-worker@${digest}
host_pull_image "$IMAGE"
echo "$HOST_PULLED_IMAGE"
`, { DIR: dir, MODE: "mirror", IMAGE: image })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split("\n"), [
    mirror, `ghcr.nju.edu.cn/lingx-ai/linksense-worker@${digest}`,
  ])
  assert.deepEqual(readFileSync(path.join(dir, "pulls"), "utf8").trim().split("\n"), [
    image, mirror, `ghcr.nju.edu.cn/lingx-ai/linksense-worker@${digest}`,
  ])
  assert.doesNotMatch(result.stdout + result.stderr, /private-proxy-value/u)
})

test("a successful origin never contacts public mirrors", t => {
  const dir = directory(t)
  const result = run(`${pulls}\nhost_pull_image "$IMAGE"`, { DIR: dir, MODE: "official", IMAGE: image })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(path.join(dir, "probes")), false)
  assert.equal(readFileSync(path.join(dir, "pulls"), "utf8"), `${image}\n`)
})

test("a responsive manifest endpoint is skipped if Docker cannot pull its layers", t => {
  const dir = directory(t)
  const result = run(`${pulls}\nhost_pull_image "$IMAGE"\necho "$HOST_PULLED_IMAGE"`, {
    DIR: dir, MODE: "second", IMAGE: image,
  })
  const second = `ghcr.dockerproxy.net/lingx-ai/linksense-api@${digest}`
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), second)
  assert.deepEqual(readFileSync(path.join(dir, "pulls"), "utf8").trim().split("\n"), [image, mirror, second])
})

test("a missing origin credential helper does not prevent a working mirror pull", t => {
  const dir = directory(t)
  const result = run(`${pulls}\nhost_pull_image "$IMAGE"\necho "$HOST_PULLED_IMAGE"`, {
    DIR: dir, MODE: "credential", IMAGE: image,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), mirror)
})

test("a missing credential helper is reported after fallback and does not abort other network checks", t => {
  const dir = directory(t)
  const result = run(`${pulls}
host_network_request() { return 0; }
host_check_docker_credentials() { :; }
docker() { [ "$1" = info ]; }
host_pull_attempt() {
  printf '%s\\n' "$1" >> "$DIR/pulls"
  printf '%s\\n' 'exec: "docker-credential-missing": executable file not found' > "$3"
  return 1
}
DOCKER_CLI=docker
host_network_diagnostics https://release.example "$IMAGE" "docker.io/library/busybox@${digest}"
`, { DIR: dir, IMAGE: image })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /\[LS_HOST_credential\].*docker-credential-missing/u)
  assert.match(result.stdout, /FAIL.*docker-pull:docker\.io\/library\/busybox/u)
  assert.deepEqual(readFileSync(path.join(dir, "pulls"), "utf8").trim().split("\n"), [
    image, mirror, `ghcr.dockerproxy.net/lingx-ai/linksense-api@${digest}`, `docker.io/library/busybox@${digest}`,
  ])
})

test("an interrupted pull does not try the next registry", t => {
  const dir = directory(t)
  const result = run(`${pulls}\nhost_pull_image "$IMAGE"`, {
    DIR: dir, MODE: "interrupted", IMAGE: image,
  })
  assert.equal(result.status, 130, result.stderr)
  assert.equal(readFileSync(path.join(dir, "pulls"), "utf8"), `${image}\n`)
  assert.equal(existsSync(path.join(dir, "probes")), false)
})

test("all failed routes ask for a trusted mirror and never accept a missing digest", t => {
  for (const mode of ["failed", "wrong-digest"]) {
    const dir = directory(t)
    const result = run(`${pulls}\nhost_pull_image "$IMAGE"`, { DIR: dir, MODE: mode, IMAGE: image })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Unable to download.*Docker image/u)
    assert.match(result.stderr, /LINKSENSE_IMAGE_MIRRORS/u)
    assert.doesNotMatch(result.stderr, /private-proxy-value/u)
    const attempts = readFileSync(path.join(dir, "pulls"), "utf8").trim().split("\n")
    assert.equal(attempts.length, 3)
    for (const reference of attempts) assert.ok(reference.endsWith(`@${digest}`))
  }
})

test("a configured Docker Hub mirror preserves the repository prefix and immutable digest", t => {
  const dir = directory(t)
  const reference = `docker.io/library/busybox@${digest}`
  const result = run(`${pulls}\nhost_pull_image "$IMAGE"\necho "$HOST_PULLED_IMAGE"`, {
    DIR: dir, MODE: "mirror", IMAGE: reference,
    LINKSENSE_IMAGE_MIRRORS: "docker.io=registry.example:5000/hub",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), `registry.example:5000/hub/library/busybox@${digest}`)
  assert.doesNotMatch(readFileSync(path.join(dir, "probes"), "utf8"), /nju|dockerproxy/u)
})

test("all public GHCR release images have default mirrors without sending other repositories", () => {
  const { services } = JSON.parse(readFileSync(new URL("../deploy/baselines/images.lock.json", import.meta.url), "utf8"))
  const references = [
    ...applicationImages.map(name => `ghcr.io/lingx-ai/linksense-${name}@${digest}`),
    ...Object.values(services).filter(reference => reference.startsWith("ghcr.io/")),
  ]
  const result = run(`
for reference do host_image_mirrors "$reference"; done
host_image_mirrors "ghcr.io/lingx-ai/linksense-private@${digest}"
host_image_mirrors "ghcr.io/private/project@${digest}"
`, {}, references)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split("\n"), references.flatMap(reference =>
    ["ghcr.nju.edu.cn", "ghcr.dockerproxy.net"].map(host => reference.replace("ghcr.io", host)),
  ))
})

test("invalid mirror mappings and mutable image tags fail before pulling or probing", t => {
  for (const mapping of [
    "ghcr.io=https://mirror.example", "ghcr.io=user:secret@mirror.example", "ghcr.io=mirror.example; touch /tmp/injected",
    "ghcr.io=mirror.example/../private", "ghcr.io=mirror.example\nx", "ghcr.io=mirror.example;;",
    Array(9).fill("ghcr.io=mirror.example").join(";"),
  ]) {
    const dir = directory(t)
    const result = run(`${pulls}\nhost_pull_image "$IMAGE"`, { DIR: dir, MODE: "official", IMAGE: image, LINKSENSE_IMAGE_MIRRORS: mapping })
    assert.equal(result.status, 1, result.stderr)
    assert.equal(existsSync(path.join(dir, "pulls")), false)
    assert.equal(existsSync(path.join(dir, "probes")), false)
    assert.doesNotMatch(result.stderr, /user:secret/u)
  }
  const result = run(`host_pull_image ghcr.io/lingx-ai/linksense-api:latest`)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /image_digest/u)
})

test("a cached mirror digest is reused without network requests, but diagnostics still pull", t => {
  const dir = directory(t)
  writeFileSync(path.join(dir, "cache"), `${mirror}\n`)
  const result = run(`${pulls}
host_pull_image "$IMAGE"
echo "$HOST_PULLED_IMAGE"
test ! -f "$DIR/pulls"
host_pull_image "$IMAGE" "$(($(date +%s) + 120))" probe
`, { DIR: dir, MODE: "mirror", IMAGE: image })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), mirror)
  assert.deepEqual(readFileSync(path.join(dir, "pulls"), "utf8").trim().split("\n"), [mirror])
})

const waitForPullClient = `
fixture_wait_for_pull_client() {
  fixture_wait=0
  while [ ! -s "$DIR/client-pid" ]; do
    fixture_wait=$((fixture_wait + 1))
    [ "$fixture_wait" -lt 500 ] || return 1
    /bin/sleep 0.01
  done
}
`

for (const [scenario, expected] of [["progress", 0], ["unterminated-progress", 0], ["extracting", 0], ["zero-bytes", 124], ["metadata", 124], ["cached-layer", 124], ["ignores-term", 124], ["transfer-limit", 124], ["failure", 1]]) {
  test(`the PTY watchdog handles ${scenario} without using metadata as downloaded bytes`, t => {
    const dir = directory(t)
    const command = path.join(dir, "docker")
    writeFileSync(command, `#!/bin/sh
test -t 1 || exit 99
echo $$ > "$DIR/client-pid"
case "$SCENARIO" in
  progress) printf 'layer: Downloading [=>] 1kB/2MB\\r'; /bin/sleep 2; echo 'layer: Download complete' ;;
  unterminated-progress) printf 'layer: Downloading 1kB/2MB'; /bin/sleep 2; echo 'layer: Download complete' ;;
  extracting) printf 'layer: Extracting 1 s\\r'; /bin/sleep 2; echo 'layer: Pull complete' ;;
  zero-bytes) echo 'layer: Downloading [>] 0B/2MB'; /bin/sleep 8 ;;
  metadata) echo 'layer: Pulling fs layer'; /bin/sleep 8 ;;
  cached-layer) echo 'layer: Pull complete'; /bin/sleep 3 ;;
  ignores-term) trap '' TERM HUP; while :; do :; done ;;
  transfer-limit) echo 'layer: Downloading 1kB/2MB'; while :; do :; done ;;
  failure) exit 1 ;;
esac
`, { mode: 0o755 })
    // Measure watchdog deadlines after the real PTY client is running, so
    // macOS process startup does not consume the fixture's one-second window.
    const result = run(`${waitForPullClient}
date() {
  if [ ! -f "$DIR/clock-started" ]; then
    fixture_wait_for_pull_client
    touch "$DIR/clock-started"
  fi
  command date "$@"
}
DOCKER_CLI="$DIR/docker"
host_pull_attempt "$IMAGE" ${scenario === "transfer-limit" ? 1 : 5} "$DIR/pull.log" 1`, {
      DIR: dir, SCENARIO: scenario, IMAGE: image,
    })
    assert.equal(result.status, expected, result.stderr)
    const pid = Number(readFileSync(path.join(dir, "client-pid"), "utf8").trim())
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  })
}

for (const [elapsed, expected] of [[1, 0], [5, 124]]) {
  test(`the PTY watchdog checks fresh progress at elapsed second ${elapsed}`, t => {
    const dir = directory(t)
    writeFileSync(path.join(dir, "docker"), `#!/bin/sh
echo $$ > "$DIR/client-pid"
/bin/sleep 2
echo 'layer: Pull complete'
`, { mode: 0o755 })
    const result = run(`${waitForPullClient}
date() {
  if [ ! -f "$DIR/clock" ]; then
    fixture_wait_for_pull_client
    touch "$DIR/clock"
    printf '100\\n'
  else
    printf 'layer: Extracting 1 s\\r' >> "$DIR/pull.log"
    printf '%s\\n' ${100 + elapsed}
  fi
}
DOCKER_CLI="$DIR/docker"
host_pull_attempt "$IMAGE" 5 "$DIR/pull.log" 1
`, { DIR: dir, IMAGE: image })
    assert.equal(result.status, expected, result.stderr)
    const pid = Number(readFileSync(path.join(dir, "client-pid"), "utf8").trim())
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  })
}

test("the PTY watchdog gives a pull one polling interval to start across a clock-second boundary", t => {
  const dir = directory(t)
  writeFileSync(path.join(dir, "docker"), `#!/bin/sh
echo $$ > "$DIR/client-pid"
/bin/sleep 0.3
echo 'layer: Download complete'
`, { mode: 0o755 })
  const result = run(`${waitForPullClient}
date() {
  if [ ! -f "$DIR/clock" ]; then
    fixture_wait_for_pull_client
    touch "$DIR/clock"
    printf '100\\n'
  else
    printf '101\\n'
  fi
}
DOCKER_CLI="$DIR/docker"
host_pull_attempt "$IMAGE" 5 "$DIR/pull.log" 1
`, { DIR: dir, IMAGE: image })
  assert.equal(result.status, 0, result.stderr)
  const pid = Number(readFileSync(path.join(dir, "client-pid"), "utf8").trim())
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
})

test("disk preflight counts exact mirror digests already cached before the runtime config was saved", t => {
  const dir = directory(t)
  writeFileSync(path.join(dir, "cache"), `${mirror}\n`)
  const result = run(`
${fn("check_release_storage")}
${fn("reuse_installed_image")}
release_image_keys() { echo IMAGE_LINKSENSE_API; }
host_storage() { echo "$2 $3"; }
docker() {
  case "$1:$2" in
    info:--format) echo "$DIR" ;;
    image:inspect) grep -Fqx "$3" "$DIR/cache" ;;
    *) return 1 ;;
  esac
}
check_release_storage
echo "$IMAGE_LINKSENSE_API"
`, { DIR: dir, EDITION: "full", HOST_OS: "Linux", IMAGE_LINKSENSE_API: image })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^2097152 10000$/mu)
  assert.ok(result.stdout.endsWith(`${image}\n`))
})

test("installed mirror references survive repair and reach the runtime without changing credentials", t => {
  const dir = directory(t)
  const writer = fn("write_runtime_env")
  const fixture = Object.fromEntries([...writer.matchAll(/\$([A-Z][A-Z_0-9]*)\b/gu)].map(match => [match[1], "fixture"]))
  writeFileSync(path.join(dir, ".env"), `POSTGRES_PASSWORD=keep-me\nLINKSENSE_API_IMAGE=${image}\n`)
  const result = run(`${pulls}
${fn("reuse_installed_image")}
${fn("pull_image")}
${fn("pull_images")}
${writer}
compose() { :; }
pull_release_images() { pull_image IMAGE_LINKSENSE_API; }
write_and_activate_runtime_env() { write_runtime_env; }
pull_images
`, { ...fixture, DIR: dir, INSTALL_DIR: dir, EDITION: "core", MODE: "mirror", IMAGE: image, IMAGE_LINKSENSE_API: image, RESOURCE_HOST_ADAPTATION_FORMAT: "1" })
  assert.equal(result.status, 0, result.stderr)
  const environment = readFileSync(path.join(dir, ".env"), "utf8")
  assert.ok(environment.includes(`LINKSENSE_API_IMAGE=${mirror}\n`))
  assert.match(environment, /^POSTGRES_PASSWORD=keep-me$/mu)
  writeFileSync(path.join(dir, "cache"), `${mirror}\n`)
  const cached = run(`${pulls}
${fn("reuse_installed_image")}
${fn("pull_image")}
pull_image IMAGE_LINKSENSE_API
echo "$IMAGE_LINKSENSE_API"
`, { DIR: dir, MODE: "failed", IMAGE: image, IMAGE_LINKSENSE_API: image, LINKSENSE_API_IMAGE: mirror })
  assert.equal(cached.status, 0, cached.stderr)
  assert.equal(cached.stdout.trim(), mirror)
})

test("pre-migration rollback starts the previous image even when the target used a mirror", t => {
  const dir = directory(t)
  const previous = {
    LINKSENSE_API_IMAGE: image,
    LINKSENSE_WORKER_IMAGE_REVISION: digest,
    LINKSENSE_VERSION: "v0.3.13",
    LINKSENSE_CPU_QUOTA_MODE: "strict",
  }
  const target = {
    LINKSENSE_API_IMAGE: mirror,
    LINKSENSE_WORKER_IMAGE_REVISION: `sha256:${"b".repeat(64)}`,
    LINKSENSE_VERSION: "v0.3.14",
    LINKSENSE_CPU_QUOTA_MODE: "compatible",
  }
  const envFile = entries => Object.entries(entries).map(([key, value]) => `${key}=${value}\n`).join("")
  writeFileSync(path.join(dir, ".env"), envFile(target))
  writeFileSync(path.join(dir, "previous.env"), envFile(previous))
  const result = run(`${fn("restore_pre_migration_upgrade")}
${fn("release_image_keys")}
mkdir "$DIR/previous"
cp "$DIR/previous.env" "$DIR/previous/.env"
ACTION=upgrade
EDITION=core
UPGRADE_RUNTIME_STOPPED=true
UPGRADE_CONFIG_CHANGED=true
UPGRADE_PENDING_EXISTED=false
UPGRADE_MIGRATION_STARTED=false
UPGRADE_PREVIOUS_DIR=$DIR/previous
UPGRADE_BACKUP_URI=
INSTALL_DIR=$DIR
activate_release_services() {
  for key in LINKSENSE_API_IMAGE LINKSENSE_WORKER_IMAGE_REVISION LINKSENSE_VERSION LINKSENSE_CPU_QUOTA_MODE; do
    value=$(eval "printf '%s' \\"\\\${$key:-}\\"")
    printf '%s=%s\\n' "$key" "\${value:-$(read_key "$INSTALL_DIR/.env" "$key")}"
  done > "$DIR/activated"
}
restore_pre_migration_upgrade
`, { DIR: dir, ...target })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(path.join(dir, "activated"), "utf8"), envFile(previous))
})
