import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

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
function run(source, environment = {}) {
  return spawnSync("/bin/sh", ["-c", `set -eu\n${helpers}\n${source}`], {
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

test("private GHCR repositories are not sent to public mirrors by default", () => {
  const result = run(`host_image_mirrors "ghcr.io/private/project@${digest}"`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "")
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

for (const [scenario, expected] of [["progress", 0], ["zero-bytes", 124], ["metadata", 124], ["ignores-term", 124], ["transfer-limit", 124], ["failure", 1]]) {
  test(`the PTY watchdog handles ${scenario} without using metadata as downloaded bytes`, t => {
    const dir = directory(t)
    const command = path.join(dir, "docker")
    writeFileSync(command, `#!/bin/sh
test -t 1 || exit 99
echo $$ > "$DIR/client-pid"
case "$SCENARIO" in
  progress) printf 'layer: Downloading [=>] 1kB/2MB\\r'; /bin/sleep 2; echo 'layer: Download complete' ;;
  zero-bytes) echo 'layer: Downloading [>] 0B/2MB'; /bin/sleep 8 ;;
  metadata) echo 'layer: Pulling fs layer'; /bin/sleep 8 ;;
  ignores-term) trap '' TERM HUP; while :; do :; done ;;
  transfer-limit) echo 'layer: Downloading 1kB/2MB'; while :; do :; done ;;
  failure) exit 1 ;;
esac
`, { mode: 0o755 })
    const result = run(`DOCKER_CLI="$DIR/docker"\nhost_pull_attempt "$IMAGE" ${scenario === "transfer-limit" ? 1 : 5} "$DIR/pull.log" 1`, {
      DIR: dir, SCENARIO: scenario, IMAGE: image,
    })
    assert.equal(result.status, expected, result.stderr)
    const pid = Number(readFileSync(path.join(dir, "client-pid"), "utf8").trim())
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  })
}

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
  writeFileSync(path.join(dir, ".env"), `LINKSENSE_API_IMAGE=${mirror}\n`)
  writeFileSync(path.join(dir, "previous.env"), `LINKSENSE_API_IMAGE=${image}\n`)
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
  echo "\${LINKSENSE_API_IMAGE:-$(read_key "$INSTALL_DIR/.env" LINKSENSE_API_IMAGE)}" > "$DIR/activated"
}
restore_pre_migration_upgrade
`, { DIR: dir, LINKSENSE_API_IMAGE: mirror })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(path.join(dir, "activated"), "utf8"), `${image}\n`)
})
