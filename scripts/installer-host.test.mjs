import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const helpers = readFileSync(new URL("../deploy/release/linksense-host.sh", import.meta.url), "utf8")
const installer = readFileSync(new URL("../deploy/release/linksense-installer.sh", import.meta.url), "utf8")
function fn(name) {
  const match = installer.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, "mu"))
  assert.ok(match, name)
  return match[0]
}
function run(source, environment = {}) {
  return spawnSync("sh", ["-c", `set -eu\n${helpers}\n${source}`], {
    encoding: "utf8", timeout: 10000, env: { ...process.env, LINKSENSE_CLI_LANGUAGE: "en-US", ...environment },
  })
}
function directory(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "linksense-host-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

for (const [mode, quota, memory, pids, status] of [
  ["strict", "true", "true", "true", 0],
  ["strict", "false", "true", "true", 1],
  ["compatible", "false", "true", "true", 0],
  ["compatible", "false", "false", "true", 1],
  ["compatible", "false", "true", "false", 1],
  ["disabled", "false", "true", "true", 1],
]) {
  test(`CPU mode=${mode}, quota=${quota}, memory=${memory}, pids=${pids} admits only the intended capabilities`, () => {
    const result = run(`
docker() {
  case "$3" in
    '{{.MemoryLimit}}') echo "$MEMORY" ;; '{{.PidsLimit}}') echo "$PIDS" ;;
    '{{.CPUCfsQuota}}'|'{{.CPUCfsPeriod}}') echo "$QUOTA" ;; *) exit 9 ;;
  esac
}
host_capabilities`, { LINKSENSE_CPU_QUOTA_MODE: mode, MEMORY: memory, PIDS: pids, QUOTA: quota })
    assert.equal(result.status, status, result.stderr)
    if (mode === "compatible") assert.match(result.stderr, /memory, PID and other isolation/u)
    if (mode === "strict" && quota === "false") assert.match(result.stderr, /LINKSENSE_CPU_QUOTA_MODE=compatible/u)
  })
}

for (const locale of ["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"]) {
  test(`host diagnostics have complete ${locale} translations with consistent interpolation`, () => {
    const keys = [...new Set([...helpers.matchAll(/^    (\w+):zh-CN\)/gmu)].map(match => match[1]))]
    for (const key of keys) {
      const template = helpers.match(new RegExp(`^    ${key}:${locale}\\) host_message='([^']*)'`, "mu"))
      const baseline = helpers.match(new RegExp(`^    ${key}:zh-CN\\) host_message='([^']*)'`, "mu"))
      assert.ok(template, `${locale}:${key}`)
      assert.equal(template[1].match(/%s/gu)?.length, baseline[1].match(/%s/gu)?.length)
    }
    const result = run("host_text cpu_required", { LINKSENSE_CLI_LANGUAGE: locale })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /LINKSENSE_CPU_QUOTA_MODE=compatible/u)
  })
}

test("CentOS 7 Docker guidance explains the unsupported distribution instead of suggesting unavailable dnf or the latest install script", () => {
  const result = run(`${fn("docker_help")}\nHOST_OS=Linux\nOS_ID=centos\nOS_VERSION_ID=7\ndocker_help`)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /CentOS 7/u)
  assert.match(result.stdout, /https:\/\/docs\.docker\.com\/engine\/install\/centos\//u)
  assert.doesNotMatch(result.stdout, /sudo dnf|sudo yum|https:\/\/get\.docker\.com/u)
})

for (const [mode, succeeds] of [["strict", true], ["strict", false], ["compatible", false]]) {
  test(`the PostgreSQL runtime probe ${succeeds ? "passes" : "blocks startup"} in ${mode} mode and cleans up without touching existing data`, t => {
    const dir = directory(t)
    const executable = path.join(dir, "docker")
    writeFileSync(executable, `#!/bin/sh
echo "$*" >> "$DIR/calls"
case "$1" in
  create) echo postgres-probe ;;
  start) echo 'Operation not permitted private-diagnostic'; exit "$PROBE_EXIT" ;;
  rm) : ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 })
    const result = run(`
${fn("cleanup")}
${fn("probe_postgres_runtime")}
DOCKER_CLI=$DIR/docker
TMP_ROOT=$DIR/tmp
mkdir "$TMP_ROOT"
trap cleanup EXIT
host_bounded() { echo "deadline=$1" >> "$DIR/calls"; shift; "$@"; }
probe_postgres_runtime
touch "$DIR/started"
`, { DIR: dir, PROBE_EXIT: succeeds ? "0" : "1", LINKSENSE_CPU_QUOTA_MODE: mode, IMAGE_POSTGRES: "registry.example/postgres@sha256:fixture" })
    assert.equal(result.status, succeeds ? 0 : 1, result.stderr)
    assert.equal(existsSync(path.join(dir, "started")), succeeds)
    const calls = readFileSync(path.join(dir, "calls"), "utf8")
    assert.match(calls, /--network none --read-only --user postgres --cap-drop ALL/u)
    assert.match(calls, /--security-opt no-new-privileges=true/u)
    assert.match(calls, /--memory 256m --memory-swap 256m --pids-limit 64/u)
    assert.match(calls, /initdb.*\/tmp\/linksense-pg-probe/su)
    assert.match(calls, /deadline=60/u)
    assert.match(calls, /rm (?:-f )?-v postgres-probe/u)
    assert.doesNotMatch(calls, /--privileged|seccomp=unconfined|--volume|^create .* -v /mu)
    assert.doesNotMatch(result.stdout + result.stderr, /private-diagnostic/u)
    if (!succeeds) assert.match(result.stderr, /LS_HOST_postgres_runtime/u)
  })
}

test("HTTP/2 download failure retries with HTTP/1.1 and keeps TLS/redirect checks and a total request timeout", t => {
  const dir = directory(t)
  const result = run(`
curl() {
  echo "$*" >> "$DIR/calls"
  for arg in "$@"; do case "$arg" in *.part) target=$arg ;; esac; done
  if [ ! -f "$DIR/attempted" ]; then touch "$DIR/attempted"; return 92; fi
  echo verified > "$target"
}
sleep() { :; }
host_download https://example.test/file "$DIR/file"
cat "$DIR/file"`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /verified/u)
  const calls = readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n")
  assert.equal(calls.length, 2)
  assert.doesNotMatch(calls[0], /--http1\.1/u)
  assert.match(calls[1], /--http1\.1/u)
  for (const call of calls) {
    assert.match(call, /--max-time 300/u)
    assert.match(call, /--proto-redir =https/u)
    assert.doesNotMatch(call, /--insecure| -k /u)
  }
})

for (const [exit, error, attempts] of [[28, "timeout", 3], [22, "HTTP 503", 3], [22, "HTTP 401", 1], [60, "certificate", 1]]) {
  test(`download error ${exit}/${error} is bounded to ${attempts} attempts and redacts the URL`, t => {
    const dir = directory(t)
    const result = run(`
curl() { echo attempt >> "$DIR/calls"; echo "$ERROR https://user:secret@example.test" >&2; return "$EXIT"; }
sleep() { :; }
host_download https://user:secret@example.test/file "$DIR/file"`, { DIR: dir, ERROR: error, EXIT: String(exit) })
    assert.equal(result.status, 1)
    assert.equal(readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n").length, attempts)
    assert.doesNotMatch(result.stderr, /secret|user:/u)
  })
}

test("verified downloads resume partial data and restart safely when the server rejects ranges", t => {
  const dir = directory(t)
  writeFileSync(path.join(dir, "file.part"), "partial")
  const result = run(`
curl() {
  echo "$*" >> "$DIR/calls"
  case "$*" in *'--continue-at -'*) return 33 ;; esac
  echo complete > "$DIR/file.part"
}
sleep() { :; }
host_download https://example.test/file "$DIR/file" resume`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  const calls = readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n")
  assert.equal(calls.length, 2)
  assert.match(calls[0], /--continue-at -/u)
  assert.doesNotMatch(calls[1], /--continue-at/u)
  assert.equal(readFileSync(path.join(dir, "file"), "utf8"), "complete\n")
})

for (const [free, inodes, status] of [[1000, "100", 0], [999, "100", 1], [1000, "99", 1], [1000, "-", 0]]) {
  test(`storage preflight space=${free} inodes=${inodes} checks the actual Docker filesystem`, () => {
    const result = run(`
df() { echo 'Filesystem blocks used available capacity mounted'; case "$1" in -Pk) echo "disk 2000 0 $FREE 0% /docker" ;; -Pi) echo "disk 2000 0 $INODES 0% /docker" ;; *) exit 9 ;; esac; }
host_storage /docker 1000 100`, { FREE: String(free), INODES: inodes })
    assert.equal(result.status, status, result.stderr)
  })
}

test("bounded clients finish normally and hanging clients are terminated", () => {
  assert.equal(run("host_bounded 2 /bin/echo completed").stdout, "completed\n")
  const start = Date.now()
  const result = run("host_bounded 1 /bin/sleep 30")
  assert.notEqual(result.status, 0)
  assert.ok(Date.now() - start < 5000)
})

test("bounded Docker clients preserve the PostgreSQL backup stream on standard input", t => {
  const dir = directory(t)
  writeFileSync(path.join(dir, "docker-cli"), '#!/bin/sh\ncat > "$DIR/backup.dump"\ntest -s "$DIR/backup.dump"\n', { mode: 0o700 })
  const result = run(`
${fn("create_upgrade_backup")}
DOCKER_CLI=$DIR/docker-cli
POSTGRES_IMAGE=fixture-postgres
LINKSENSE_BACKUP_VOLUME=fixture-backups
UPGRADE_FROM_VERSION=v0.3.6
RELEASE_VERSION=v0.3.7
validate_managed_volume() { :; }
log() { :; }
compose() { printf 'PGDMP\\000fixture\\377'; }
create_upgrade_backup`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(path.join(dir, "backup.dump")), Buffer.from([80, 71, 68, 77, 80, 0, ...Buffer.from("fixture"), 255]))
})

test("immutable cached resources are reused, but corrupt entries must be downloaded and checked", t => {
  const dir = directory(t)
  const result = run(`
${fn("sha256_file")}
${fn("verify_file")}
${fn("download_verified")}
fail() { echo "$*" >&2; exit 1; }
host_download() { echo downloaded >> "$DIR/calls"; printf valid > "$2"; }
INSTALL_DIR=$DIR/install
TMP_ROOT=$DIR/tmp
mkdir "$INSTALL_DIR" "$TMP_ROOT"
touch "$INSTALL_DIR/install.pending"
printf valid > "$DIR/original"
sha=$(sha256_file "$DIR/original")
download_verified https://example.test/file "$DIR/first" "$sha"
download_verified https://example.test/file "$DIR/second" "$sha"
printf corrupt > "$INSTALL_DIR/cache/$sha"
download_verified https://example.test/file "$DIR/third" "$sha"
cmp "$DIR/first" "$DIR/second"
cmp "$DIR/second" "$DIR/third"`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n").length, 2)
})

test("only a fresh installation without an explicit port or origin selects another port", t => {
  const dir = directory(t)
  for (const [action, requested, existing, status, port] of [["install", "", false, 0, 18082], ["install", "18081", false, 1, 18081], ["repair", "", true, 1, 18081]]) {
    const result = run(`
${fn("select_available_port")}
fail() { exit 1; }
check_port() { [ "$HTTP_PORT" != 18081 ] || fail occupied; }
ACTION=$ACTION_VALUE
REQUESTED_HTTP_PORT=$REQUESTED
HTTP_PORT=18081
INSTALL_DIR=$DIR/instance
[ "$EXISTING" != true ] || mkdir -p "$INSTALL_DIR"
select_available_port
echo "$HTTP_PORT"`, { DIR: dir, ACTION_VALUE: action, REQUESTED: requested, EXISTING: String(existing) })
    assert.equal(result.status, status, result.stderr)
    if (status === 0) assert.ok(result.stdout.endsWith(`${port}\n`))
  }
})

test("deployment locks reject a live owner and are released after the operation", t => {
  const dir = directory(t)
  const result = run(`
INSTALL_DIR=$DIR/instance
host_lock_installation
if (host_lock_installation); then exit 9; fi
test -d "$HOST_LOCK_DIR"
host_unlock_installation
test ! -d "$HOST_LOCK_DIR"`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /LS_HOST_locked/u)
})

test("trailing directory separators share one external instance lock without creating a fresh install directory", t => {
  const dir = directory(t)
  const result = run(`
INSTALL_DIR=$DIR/instance///
host_lock_installation
test ! -d "$DIR/instance"
if (INSTALL_DIR=$DIR/instance; host_lock_installation); then exit 9; fi
host_unlock_installation
test ! -d "$DIR/instance.install-lock"`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /LS_HOST_locked/u)
})

test("installer reads mutable instance settings and tools only after acquiring its lock", t => {
  const dir = directory(t)
  const main = installer.slice(installer.indexOf('log_stage "Stage 1: run the read-only host preflight."'))
  const result = run(`
INSTALL_DIR=$DIR/instance
ACTION=repair
log_stage() { :; }
validate_install_dir() { :; }
resolve_http_port() { [ "\${HOST_LOCK_HELD:-false}" = true ]; }
resolve_cpu_mode() { [ "\${HOST_LOCK_HELD:-false}" = true ]; }
preflight() { [ "\${HOST_LOCK_HELD:-false}" = true ]; }
repair_action() { :; }
trap 'host_unlock_installation; [ -z "\${TMP_ROOT:-}" ] || rm -r "$TMP_ROOT"' EXIT
${main}`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(path.join(dir, "instance.install-lock")), false)
})

test("only a trusted stale lock can be recovered; foreign entries and symlinks remain untouched", t => {
  const dir = directory(t)
  for (const type of ["stale", "foreign", "symlink"]) {
    const result = run(`
INSTALL_DIR=$DIR/$TYPE
lock=$INSTALL_DIR.install-lock
mkdir -m 700 "$lock"
printf '99999999\nold process\n' > "$lock/owner"
case "$TYPE" in foreign) touch "$lock/foreign" ;; symlink) rm "$lock/owner"; ln -s "$DIR/target" "$lock/owner" ;; esac
host_lock_installation
host_unlock_installation`, { DIR: dir, TYPE: type })
    assert.equal(result.status, type === "stale" ? 0 : 1, result.stderr)
    if (type !== "stale") assert.ok(existsSync(`${dir}/${type}.install-lock`))
  }
})

test("private tools survive installer cleanup and tampered or linked tools are rejected", t => {
  const dir = directory(t)
  const result = run(`
INSTALL_DIR=$DIR/install
TMP_ROOT=$DIR/tmp
mkdir -p "$TMP_ROOT/tools" "$INSTALL_DIR"
printf '#!/bin/sh\necho private-tool\n' > "$TMP_ROOT/tools/docker-cli"
host_save_tools
rm -r "$TMP_ROOT"
host_use_saved_tools
docker version
printf corrupt >> "$DOCKER_CLI"
if (host_use_saved_tools); then exit 9; fi
rm "$DOCKER_CLI"
ln -s /bin/sh "$DOCKER_CLI"
if (host_use_saved_tools); then exit 9; fi`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "private-tool\n")
  assert.match(result.stderr, /docker\/checksum/u)
  assert.match(result.stderr, /docker\/type/u)
})

for (const [memory, kind, status] of [[16, "existing", 0], [14, "existing", 1], [24, "fresh", 1]]) {
  test(`Full ${kind} budget with absent legacy limits and ${memory} GiB ${status === 0 ? "passes" : "fails"} without imposing the new-install floor`, () => {
    const result = run(`
${fn("validate_resource_budget")}
${fn("host_available_memory_mib")}
EDITION=full
HOST_OS=Darwin
docker() { echo "$MEMORY_BYTES"; }
validate_resource_budget "$KIND"`, { MEMORY_BYTES: String(memory * 1024 ** 3), KIND: kind })
    assert.equal(result.status, status, result.stderr)
  })
}

test("resource budgets include configured services and reject oversized Node heaps", () => {
  const result = run(`${fn("host_available_memory_mib")}\n${fn("validate_resource_budget")}
EDITION=full
HOST_OS=Darwin
docker() { echo 25769803776; }
LINKSENSE_API_MEMORY_MB=2048
LINKSENSE_API_NODE_OPTIONS=--max-old-space-size=1536
LINKSENSE_RUNNER_MEMORY_MB=512
LINKSENSE_RUNNER_NODE_OPTIONS=--max-old-space-size=256
LINKSENSE_POSTGRES_MEMORY_MB=768
LINKSENSE_REDIS_MEMORY_MB=512
LINKSENSE_MINIO_MEMORY_MB=512
LINKSENSE_ELASTICSEARCH_MEMORY_MB=2048
validate_resource_budget fresh
LINKSENSE_API_NODE_OPTIONS=--max-old-space-size=2048
validate_resource_budget fresh`)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /API heap_mib=2048 limit_mib=2048/u)
})

for (const [limit, status] of [[0, 0], [1024, 1], [2048, 0]]) {
  test(`Elasticsearch limit=${limit} MiB preserves unlimited legacy installs or leaves room for its fixed JVM heap`, () => {
    const result = run(`${fn("validate_resource_budget")}
EDITION=full
LINKSENSE_ELASTICSEARCH_MEMORY_MB=$LIMIT
docker() { echo 25769803776; }
validate_resource_budget`, { LIMIT: String(limit) })
    assert.equal(result.status, status, result.stderr)
  })
}

test("configuration regeneration preserves custom credentials, concurrency, limits and volumes and updates release-owned fields", t => {
  const dir = directory(t)
  const writer = fn("write_runtime_env")
  const fixture = Object.fromEntries([...writer.matchAll(/\$([A-Z][A-Z_0-9]*)\b/gu)].map(match => [match[1], "fixture"]))
  const previous = "LINKSENSE_VERSION=v0.3.6\nLINKSENSE_API_IMAGE=old-image\nLINKSENSE_MAX_CONCURRENT_CONVERSATIONS=7\nLINKSENSE_WORKER_MEMORY_MB=6144\nLINKSENSE_API_MEMORY_MB=3072\nLINKSENSE_API_NODE_OPTIONS=--max-old-space-size=2048\nPOSTGRES_USER=custom-user\nDATABASE_URL=custom-url\nLINKSENSE_CREDENTIAL_KEY_ID=custom-key\nLINKSENSE_USER_DATA_VOLUME=custom-volume\nLINKSENSE_KB_EMBEDDING_CONCURRENCY=3\nLINKSENSE_CPU_QUOTA_MODE=strict\n"
  writeFileSync(path.join(dir, ".env"), previous)
  const result = run(`${writer}\nwrite_runtime_env`, { ...fixture, INSTALL_DIR: dir, EDITION: "full", RELEASE_VERSION: "v0.3.7", IMAGE_LINKSENSE_API: "new-image", LINKSENSE_CPU_QUOTA_MODE: "compatible" })
  assert.equal(result.status, 0, result.stderr)
  const current = Object.fromEntries(readFileSync(path.join(dir, ".env"), "utf8").trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
  for (const line of previous.trim().split("\n")) {
    const key = line.slice(0, line.indexOf("="))
    if (["LINKSENSE_VERSION", "LINKSENSE_API_IMAGE", "LINKSENSE_CPU_QUOTA_MODE"].includes(key)) continue
    assert.equal(current[key], line.slice(key.length + 1), key)
  }
  assert.equal(current.LINKSENSE_VERSION, "v0.3.7")
  assert.equal(current.LINKSENSE_API_IMAGE, "new-image")
  assert.equal(current.LINKSENSE_CPU_QUOTA_MODE, "compatible")
  assert.equal(current.LINKSENSE_DOCLING_WORKER_CPUS, "0")
})

test("persisted CPU mode is reused, and changing it requires an explicit upgrade", t => {
  const dir = directory(t)
  writeFileSync(path.join(dir, "install-state.env"), "")
  writeFileSync(path.join(dir, ".env"), "LINKSENSE_CPU_QUOTA_MODE=compatible\n")
  for (const [action, requested, status, expected] of [["repair", "", 0, "compatible"], ["repair", "strict", 1], ["upgrade", "strict", 0, "strict"]]) {
    const result = run(`${fn("resolve_cpu_mode")}\nverify_private_file() { :; }\nresolve_cpu_mode\necho "$LINKSENSE_CPU_QUOTA_MODE"`, { INSTALL_DIR: dir, ACTION: action, REQUESTED_CPU_QUOTA_MODE: requested })
    assert.equal(result.status, status, result.stderr)
    if (status === 0) assert.equal(result.stdout.trim(), expected)
  }
})

for (const [free, status] of [[5000000, 0], [262143, 1]]) {
  test(`upgrade checks database-sized dump/backup space before stopping writes, available=${free} KiB`, () => {
    const result = run(`
${fn("check_upgrade_backup_storage")}
LINKSENSE_BACKUP_VOLUME=fixture-backups
IMAGE_BUSYBOX=fixture-image
compose_bounded() { case "$*" in *pg_database_size*) echo 1073741824 ;; *) echo "$FREE" ;; esac; }
docker() { echo "$FREE"; }
check_upgrade_backup_storage`, { FREE: String(free) })
    assert.equal(result.status, status, result.stderr)
    assert.ok(installer.indexOf("check_upgrade_backup_storage\n") < installer.indexOf("stop_upgrade_runtime\n"))
  })
}

test("service snapshots check every replica and reject OOM, missing and unhealthy services", () => {
  for (const state of ["healthy", "oom", "missing", "unhealthy", "stopped"]) {
    const result = run(`
EDITION=core
compose() {
  for service in "$@"; do :; done
  if [ "$STATE" = missing ] && [ "$service" = api ]; then return; fi
  echo "$service-1"
  [ "$service" = api ] || return 0
  if [ "$STATE" = stopped ]; then case "$*" in *--all*) echo api-2 ;; esac
  else echo api-2; fi
}
docker() {
  case "$STATE:$4" in
    oom:api-2) echo 'api-2 started 1 true true healthy' ;;
    unhealthy:api-2) echo 'api-2 started 0 true false unhealthy' ;;
    stopped:api-2) echo 'api-2 started 0 false false healthy' ;;
    *) echo "$4 started 0 true false healthy" ;;
  esac
}
host_service_snapshot`, { STATE: state })
    assert.equal(result.status, state === "healthy" ? 0 : 1, result.stderr)
    if (state === "healthy") assert.match(result.stdout, /api api-2/u)
  }
})

test("the stability window fails when a previously ready container restarts", t => {
  const dir = directory(t)
  const result = run(`
${fn("verify_service_stability")}
TMP_ROOT=$DIR
date() { echo 1; }
sleep() { :; }
service_snapshot() { if [ -f "$DIR/services.before" ] && [ -s "$DIR/services.before" ]; then echo 'api started 1'; else echo 'api started 0'; fi; }
verify_service_stability`, { DIR: dir })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /container_state_changed/u)
})

test("service snapshots tolerate Docker inspect states without a healthcheck", () => {
  const result = run(`
EDITION=full
compose() { for service in "$@"; do :; done; echo "$service-1"; }
docker() {
  # Docker templates use missingkey=error; accessing absent State.Health fails.
  case "$3" in *'.State.Health'*) echo 'map has no entry for key "Health"' >&2; return 1 ;; esac
  echo "$4 started 0 true false none"
}
host_service_snapshot`)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /docling-worker docling-worker-1 started 0 true false none/u)
})

for (const [edition, available, api, heap, budget] of [["core", 7680, 1280, 896, 7488], ["core", 12288, 1536, 1024, 8192], ["full", 24576, 2048, 1536, 21504]]) {
  test(`${edition} fresh profile fits ${available} MiB while preserving a 4 GiB Worker and a bounded Node heap`, () => {
    const result = run(`
${fn("write_env")}
${fn("validate_resource_budget")}
host_available_memory_mib() { echo "$AVAILABLE"; }
docker() { case "$3" in '{{.NCPU}}') echo 2 ;; '{{.MemTotal}}') echo "$((AVAILABLE * 1024 * 1024))" ;; *) exit 9 ;; esac; }
random_hex() { printf fixture; }
detect_public_url() { echo http://localhost:18081; }
write_and_activate_runtime_env() { echo "$LINKSENSE_API_MEMORY_MB $LINKSENSE_API_NODE_OPTIONS $budget_mib $LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT $LINKSENSE_WORKER_CPUS \${LINKSENSE_ELASTICSEARCH_MEMORY_MB:-0}"; }
EDITION=$PROFILE
HOST_OS=Darwin
write_env`, { PROFILE: edition, AVAILABLE: String(available) })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), `${api} --max-old-space-size=${heap} ${budget} 2 2 ${edition === "full" ? 2048 : 0}`)
  })
}

for (const [behavior, attempts, status] of [["transient", 3, 0], ["permanent", 1, 1], ["cached", 0, 0]]) {
  test(`image pulling handles ${behavior} failures with bounded retries and retains verified cached images`, t => {
    const dir = directory(t)
    const result = run(`
${fn("pull_image")}
log() { :; }
sleep() { :; }
TMP_ROOT=$DIR
pull_deadline=9999999999
docker() { [ "$BEHAVIOR" = cached ]; }
host_bounded() {
  echo call >> "$DIR/calls"
  if [ "$BEHAVIOR" = permanent ]; then echo 'unauthorized' >&2; return 1; fi
  if [ "$(wc -l < "$DIR/calls")" -lt 3 ]; then echo 'connection reset by peer' >&2; return 1; fi
}
pull_image registry.example/image@sha256:fixture`, { DIR: dir, BEHAVIOR: behavior })
    assert.equal(result.status, status, result.stderr)
    assert.equal(existsSync(path.join(dir, "calls")) ? readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n").length : 0, attempts)
  })
}

test("new host metadata remains readable by the published strict manifest parser", t => {
  const dir = directory(t)
  const manifest = "MANIFEST_FORMAT=2\nRELEASE_VERSION=v0.3.7\nFULL_MIN_MEMORY_GIB=10\nRESOURCE_HOST_ADAPTATION_FORMAT=1\nRESOURCE_FULL_FRESH_MIN_MEMORY_GIB=24\n"
  writeFileSync(path.join(dir, "manifest"), manifest)
  const legacy = readFileSync(new URL("./fixtures/pre-host-adaptation-env-parser.sh", import.meta.url), "utf8")
  const result = run(`${legacy}\nfail() { echo "$*" >&2; exit 1; }\nload_strict_env "$DIR/manifest" manifest\necho "$FULL_MIN_MEMORY_GIB/$RESOURCE_FULL_FRESH_MIN_MEMORY_GIB/$RESOURCE_HOST_ADAPTATION_FORMAT"`, { DIR: dir })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "10/24/1\n")
})
