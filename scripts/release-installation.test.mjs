import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const releaseDirectory = path.join(root, "deploy/release")

test("the five release entry scripts download only their matching release entry", async () => {
  const entries = [
    "install-core.sh",
    "install-full.sh",
    "repair-core.sh",
    "repair-full.sh",
    "upgrade.sh",
  ]

  for (const filename of entries) {
    const source = await readFile(path.join(root, filename), "utf8")
    assert.match(source, new RegExp(`\\$base/${filename.replace(".", "\\.")}`))
    assert.doesNotMatch(source, /linksense-installer\.sh/u)
    assert.doesNotMatch(source, /LINKSENSE_INSTALL_(?:ACTION|EDITION)/u)
    assert.doesNotMatch(source, /--edition|select.*edition/iu)
    execFileSync("sh", ["-n", path.join(root, filename)])
  }
  execFileSync("sh", [
    "-n",
    path.join(releaseDirectory, "linksense-installer.sh"),
  ])
  execFileSync("sh", ["-n", path.join(releaseDirectory, "linksense-cli.sh")])
})

test("the release gateway preserves the public protocol reported by a reverse proxy", async () => {
  const gateway = await readFile(
    path.join(releaseDirectory, "gateway.conf.template"),
    "utf8",
  )

  assert.match(
    gateway,
    /map \$http_x_forwarded_proto \$linksense_forwarded_proto \{[\s\S]*default \$\{NGINX_EXTERNAL_SCHEME\};[\s\S]*~\*\^http\$ http;[\s\S]*~\*\^https\$ https;[\s\S]*\}/u,
  )
  assert.equal(
    gateway.match(
      /proxy_set_header X-Forwarded-Proto \$linksense_forwarded_proto;/gu,
    )?.length,
    4,
  )
  assert.doesNotMatch(
    gateway,
    /proxy_set_header X-Forwarded-Proto \$\{NGINX_EXTERNAL_SCHEME\};/u,
  )
})

test("release entry scripts are self-contained and pinned to one mode and version", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-installers-"))
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/bundle-release-installers.mjs"), directory],
      { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
    )
    for (const [filename, [action, edition, selector]] of Object.entries({
      "install-core.sh": ["install", "core"],
      "install-full.sh": ["install", "full"],
      "repair-core.sh": ["repair", "core"],
      "repair-full.sh": ["repair", "full"],
      "upgrade.sh": ["upgrade", "", "latest"],
    })) {
      const output = path.join(directory, filename)
      const source = await readFile(output, "utf8")
      assert.match(source, new RegExp(`^ACTION=${action}$`, "mu"))
      assert.match(source, new RegExp(`^EDITION=${edition}$`, "mu"))
      const expectedSelector = selector ?? "v0.1.0"
      assert.match(
        source,
        new RegExp(
          `^RELEASE_SELECTOR=\\$\\{LINKSENSE_VERSION:-${expectedSelector.replaceAll(".", "\\.")}\\}$`,
          "mu",
        ),
      )
      assert.doesNotMatch(source, /LINKSENSE_INSTALL_(?:ACTION|EDITION)/u)
      execFileSync("sh", ["-n", output])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the installer checks the host before creating persistent state", async () => {
  const source = await readFile(
    path.join(releaseDirectory, "linksense-installer.sh"),
    "utf8",
  )
  assert.match(
    source,
    /log_stage "Stage 1: run the read-only host preflight\."\nvalidate_install_dir\nresolve_http_port\npreflight\nTMP_ROOT=\$\(mktemp -d\)/u,
  )
  assert.match(source, /REQUIRED_DOCKER_API=1\.45/u)
  assert.match(source, /REQUIRED_COMPOSE_VERSION=2\.24\.4/u)
  assert.match(source, /HTTP_PORT=\$\{REQUESTED_HTTP_PORT:-18081\}/u)
  assert.match(source, /LINKSENSE_HTTP_PORT must be an integer between 1 and 65535/u)
  assert.match(source, /STATE_HTTP_PORT/u)
  assert.doesNotMatch(source, /:2760\$/u)
  assert.doesNotMatch(source, /required_disk_kb|available_inodes|required_inodes/u)
  assert.doesNotMatch(source, /df -P[ki]/u)
  assert.match(source, /LINKSENSE_PLATFORM=linux-arm64/u)
  assert.match(source, /"LINKSENSE_MAX_CONCURRENT_CONVERSATIONS=500"/u)
  assert.match(source, /"LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT=20"/u)
  assert.match(
    source,
    /HOST_OS" = Darwin[\s\S]*LINKSENSE_DOCKER_SOCKET_SOURCE=\/var\/run\/docker\.sock/u,
  )
  assert.match(source, /verify_existing_volumes/u)
  assert.match(source, /dist\/release\/full-installation-probe\.js/u)
  assert.match(
    source,
    /local_health_url="http:\/\/127\.0\.0\.1:\$HTTP_PORT\/api\/v1\/system\/health\/ready"/u,
  )
  assert.match(source, /Repair stopped to avoid creating empty replacements/u)
  assert.match(source, /ensure_managed_volume linksense-user-data user-data/u)
  assert.match(source, /ensure_managed_volume linksense-backups backups/u)
  assert.match(
    source,
    /--label com\.linksense\.managed-by=linksense-production/u,
  )
  assert.match(source, /--label com\.linksense\.persistence=critical/u)
  assert.match(source, /--label "com\.linksense\.role=\$role"/u)
  assert.match(
    source,
    /validate_managed_volume linksense-user-data user-data/u,
  )
  assert.match(source, /validate_managed_volume linksense-backups backups/u)
  assert.match(source, /load_strict_env "\$INSTALL_DIR\/\.env" runtime/u)
  assert.match(
    source,
    /write_and_activate_runtime_env\(\) \{\n  write_runtime_env\n  load_runtime_env\n\}/u,
  )
  assert.match(
    source,
    /fetch_release_resources\n  write_and_activate_runtime_env\n  install_resources/u,
  )
  assert.match(source, /Required Full secret \$required_secret is missing/u)
  assert.match(
    source,
    /if \[ -n "\$\{LINKSENSE_RELEASE_BASE_URL:-\}" \]; then\n    base=\$\{LINKSENSE_RELEASE_BASE_URL%\/\}\n  else\n    base=\$RELEASE_ASSET_BASE_URL/u,
  )
  assert.match(
    source,
    /for resource in LICENSE LICENSE-EXCEPTIONS\.md ATTRIBUTION\.md TRADEMARK\.md NOTICE THIRD-PARTY-NOTICES\.md compose\.common\.yml "compose\.\$EDITION\.yml" gateway\.conf\.template linksense-cli\.sh "repair-\$EDITION\.sh" upgrade\.sh/u,
  )
  assert.match(source, /RESOURCE_LICENSE_SHA256/u)
  assert.match(source, /LICENSE-EXCEPTIONS\.md\|ATTRIBUTION\.md\|TRADEMARK\.md\|NOTICE\|THIRD-PARTY-NOTICES\.md\)\s+rm -f "\$INSTALL_DIR\/\$previous_file"/u)
  assert.match(source, /RESOURCE_THIRD_PARTY_NOTICES_SHA256/u)
  assert.match(source, /RESOURCE_CLI_SHA256/u)
  assert.match(source, /RESOURCE_UPGRADE_SHA256/u)
  assert.match(source, /activate_management_cli/u)
  assert.match(source, /STATE_RELEASE_BASE_URL=\$RELEASE_RESOURCE_BASE/u)
  assert.match(source, /\/usr\/local\/bin\/linksense/u)
  assert.match(source, /\$HOME\/\.local\/bin\/linksense/u)
  assert.match(source, /exec sudo env LINKSENSE_INSTALL_DIR=/u)
  assert.match(source, /LINKSENSE_CLI_LANGUAGE=/u)
  assert.match(source, /LINKSENSE_RELEASE_BASE_URL=/u)
  assert.doesNotMatch(source, /^\s*\. "\$INSTALL_DIR\/\.env"/mu)
  assert.doesNotMatch(source, /docker\s+(?:system\s+)?prune|compose\s+down\s+-v|volume\s+rm|reset --hard/iu)
})

test("the generated Linux management launcher elevates before entering the protected install directory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-launcher-"))
  try {
    const bin = path.join(directory, "bin")
    const installDirectory = path.join(directory, "install")
    const launcher = path.join(directory, "linksense")
    const trace = path.join(directory, "trace")
    await mkdir(bin)
    await mkdir(path.join(installDirectory, "bin"), { recursive: true })
    await writeExecutable(
      path.join(bin, "id"),
      '#!/bin/sh\nprintf "%s\\n" "${LINKSENSE_TEST_UID:-1000}"\n',
    )
    await writeExecutable(
      path.join(bin, "sudo"),
      '#!/bin/sh\nprintf "sudo %s\\n" "$*" >> "$LINKSENSE_TEST_TRACE"\n',
    )
    await writeExecutable(
      path.join(installDirectory, "bin", "linksense-cli.sh"),
      '#!/bin/sh\nprintf "cli language=%s args=%s\\n" "${LINKSENSE_CLI_LANGUAGE:-}" "$*" >> "$LINKSENSE_TEST_TRACE"\n',
    )

    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const functionStart = installer.indexOf("activate_management_cli() {")
    const functionEnd = installer.indexOf("\nvalidate_managed_volume() {", functionStart)
    assert.ok(functionStart > 0 && functionEnd > functionStart)
    const activateFunction = installer
      .slice(functionStart, functionEnd)
      .replace(
        "launcher_path=/usr/local/bin/linksense",
        `launcher_path=${launcher}`,
      )
      .replace("install -d -m 0755 /usr/local/bin", ":")
    const harness = path.join(directory, "generate-launcher.sh")
    await writeExecutable(
      harness,
      `#!/bin/sh
set -eu
HOST_OS=Linux
HOME=${directory}
INSTALL_DIR=${installDirectory}
TMP_ROOT=${directory}
log() { :; }
fail() { printf '%s\\n' "$*" >&2; exit 1; }
${activateFunction}
activate_management_cli
`,
    )
    execFileSync("/bin/sh", [harness])
    execFileSync("/bin/sh", ["-n", launcher])

    const userResult = spawnSync("/bin/sh", [launcher, "upgrade", "v0.3.0"], {
      encoding: "utf8",
      env: {
        ...process.env,
        LINKSENSE_CLI_LANGUAGE: "zh-CN",
        LINKSENSE_RELEASE_BASE_URL:
          "https://downloads.example/linksense-v0.3.0",
        LINKSENSE_TEST_TRACE: trace,
        PATH: `${bin}:/usr/bin:/bin`,
      },
    })
    assert.equal(userResult.status, 0, userResult.stderr)
    const userTrace = await readFile(trace, "utf8")
    assert.match(userTrace, /^sudo env LINKSENSE_INSTALL_DIR=/mu)
    assert.match(userTrace, /LINKSENSE_CLI_LANGUAGE=zh-CN/u)
    assert.match(userTrace, /LINKSENSE_RELEASE_BASE_URL=https:\/\/downloads\.example\/linksense-v0\.3\.0/u)
    assert.match(userTrace, /linksense-cli\.sh upgrade v0\.3\.0/u)

    await writeFile(trace, "")
    const rootResult = spawnSync("/bin/sh", [launcher, "status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        LINKSENSE_CLI_LANGUAGE: "en-US",
        LINKSENSE_TEST_TRACE: trace,
        LINKSENSE_TEST_UID: "0",
        PATH: `${bin}:/usr/bin:/bin`,
      },
    })
    assert.equal(rootResult.status, 0, rootResult.stderr)
    assert.match(await readFile(trace, "utf8"), /cli language=en-US args=status/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the generated macOS management launcher stays in the Docker Desktop user context", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-macos-launcher-"))
  try {
    const installDirectory = path.join(directory, "install")
    const trace = path.join(directory, "trace")
    await mkdir(path.join(installDirectory, "bin"), { recursive: true })
    await writeExecutable(
      path.join(installDirectory, "bin", "linksense-cli.sh"),
      '#!/bin/sh\nprintf "install=%s args=%s\\n" "$LINKSENSE_INSTALL_DIR" "$*" > "$LINKSENSE_TEST_TRACE"\n',
    )
    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const functionStart = installer.indexOf("activate_management_cli() {")
    const functionEnd = installer.indexOf("\nvalidate_managed_volume() {", functionStart)
    const activateFunction = installer.slice(functionStart, functionEnd)
    const harness = path.join(directory, "generate-launcher.sh")
    await writeExecutable(
      harness,
      `#!/bin/sh
set -eu
HOST_OS=Darwin
HOME=${directory}
PATH=/usr/bin:/bin
INSTALL_DIR=${installDirectory}
TMP_ROOT=${directory}
log() { :; }
fail() { printf '%s\\n' "$*" >&2; exit 1; }
${activateFunction}
activate_management_cli
`,
    )
    execFileSync("/bin/sh", [harness])
    const launcher = path.join(directory, ".local", "bin", "linksense")
    execFileSync("/bin/sh", ["-n", launcher])
    const result = spawnSync("/bin/sh", [launcher, "status"], {
      encoding: "utf8",
      env: { ...process.env, LINKSENSE_TEST_TRACE: trace },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      await readFile(trace, "utf8"),
      `install=${installDirectory} args=status\n`,
    )
    assert.doesNotMatch(await readFile(launcher, "utf8"), /sudo/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the installer validates custom ports and preserves an installed port", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-port-"))
  try {
    const bin = path.join(directory, "bin")
    const installDirectory = path.join(directory, "install")
    await mkdir(bin)
    await mkdir(installDirectory)
    await writeExecutable(
      path.join(bin, "id"),
      "#!/bin/sh\nprintf '%s\\n' 501\n",
    )
    await writeExecutable(
      path.join(bin, "uname"),
      "#!/bin/sh\ncase \"$1\" in -s) printf '%s\\n' Darwin ;; -m) printf '%s\\n' arm64 ;; *) exit 1 ;; esac\n",
    )
    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const mainPosition = installer.indexOf(
      'log_stage "Stage 1: run the read-only host preflight."',
    )
    const harness = path.join(directory, "port.sh")
    await writeExecutable(
      harness,
      `${installer.slice(0, mainPosition)}
verify_private_file() { :; }
resolve_http_port
printf '%s\\n' "$HTTP_PORT"
`,
    )
    const baseEnvironment = {
      ...process.env,
      HOME: directory,
      LINKSENSE_INSTALL_ACTION: "install",
      LINKSENSE_INSTALL_EDITION: "core",
      LINKSENSE_INSTALL_DIR: installDirectory,
      PATH: `${bin}:/usr/bin:/bin`,
    }

    const custom = spawnSync("/bin/sh", [harness], {
      encoding: "utf8",
      env: { ...baseEnvironment, LINKSENSE_HTTP_PORT: "19090" },
    })
    assert.equal(custom.status, 0, custom.stderr)
    assert.equal(custom.stdout.trim(), "19090")

    for (const invalidPort of ["0", "65536", "invalid"]) {
      const invalid = spawnSync("/bin/sh", [harness], {
        encoding: "utf8",
        env: { ...baseEnvironment, LINKSENSE_HTTP_PORT: invalidPort },
      })
      assert.notEqual(invalid.status, 0)
      assert.match(invalid.stderr, /between 1 and 65535/u)
    }

    await writeFile(
      path.join(installDirectory, "install-state.env"),
      "STATE_HTTP_PORT=23456\n",
      { mode: 0o600 },
    )
    const preserved = spawnSync("/bin/sh", [harness], {
      encoding: "utf8",
      env: baseEnvironment,
    })
    assert.equal(preserved.status, 0, preserved.stderr)
    assert.equal(preserved.stdout.trim(), "23456")

    const changed = spawnSync("/bin/sh", [harness], {
      encoding: "utf8",
      env: { ...baseEnvironment, LINKSENSE_HTTP_PORT: "19090" },
    })
    assert.notEqual(changed.status, 0)
    assert.match(changed.stderr, /dedicated port migration/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("upgrade drains writes and creates a validated atomic database backup before migration", async () => {
  const source = await readFile(
    path.join(releaseDirectory, "linksense-installer.sh"),
    "utf8",
  )
  const stopIndex = source.indexOf("stop_upgrade_runtime\n")
  const backupIndex = source.indexOf("create_upgrade_backup\n", stopIndex)
  const pendingIndex = source.indexOf("write_upgrade_pending false\n", backupIndex)
  const migrationIndex = source.indexOf("compose run --rm migrate\n", pendingIndex)
  assert.ok(stopIndex > 0)
  assert.ok(backupIndex > stopIndex)
  assert.ok(pendingIndex > backupIndex)
  assert.ok(migrationIndex > pendingIndex)
  assert.match(source, /conversation_turn_start_intents/u)
  assert.match(source, /pg_dump[\s\S]*--format=custom[\s\S]*--no-owner[\s\S]*--no-privileges/u)
  assert.ok((source.match(/pg_restore --list/gu) ?? []).length >= 3)
  assert.match(source, /partial_path="\$\{final_path\}\.partial"[\s\S]*mv "\$partial_path" "\$final_path"/u)
  assert.match(source, /volume:\/\/\$LINKSENSE_BACKUP_VOLUME\/postgres\/\$backup_name/u)
  assert.match(source, /UPGRADE_MIGRATION_STARTED=true[\s\S]*write_upgrade_pending true[\s\S]*compose run --rm migrate/u)
  assert.match(
    source,
    /UPGRADE_CONFIG_CHANGED=true\n  write_and_activate_runtime_env\n  install_resources/u,
  )
  assert.match(source, /UPGRADE_PREVIOUS_TOKENIZER_REVISION[\s\S]*\/tokenizer\/current/u)
  assert.match(source, /Only the published v0\.1\.0 installation state can be upgraded from format 1/u)
  assert.match(source, /load_runtime_env "\$STATE_FORMAT"/u)
  assert.match(source, /did not automatically roll back images or the database/u)
  assert.doesNotMatch(source, /compose\s+down\s+-v|docker\s+volume\s+rm|docker\s+(?:system\s+)?prune/iu)
})

test("upgrade detects the installed edition and leaves a healthy latest release untouched", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-upgrade-current-"))
  try {
    const bin = path.join(directory, "bin")
    const installDirectory = path.join(directory, "install")
    await mkdir(bin)
    await mkdir(installDirectory)
    await writeFile(
      path.join(installDirectory, "install-state.env"),
      "STATE_EDITION=core\n",
      { mode: 0o600 },
    )
    await writeExecutable(
      path.join(bin, "id"),
      "#!/bin/sh\nprintf '%s\\n' 501\n",
    )
    await writeExecutable(
      path.join(bin, "uname"),
      "#!/bin/sh\ncase \"$1\" in -s) printf '%s\\n' Darwin ;; -m) printf '%s\\n' arm64 ;; *) exit 1 ;; esac\n",
    )
    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const mainPosition = installer.indexOf(
      'log_stage "Stage 1: run the read-only host preflight."',
    )
    const harness = path.join(directory, "upgrade-current.sh")
    await writeExecutable(
      harness,
      `${installer.slice(0, mainPosition)}
verify_private_file() { :; }
load_strict_env() {
  STATE_FORMAT=2
  STATE_EDITION=core
  STATE_PLATFORM=linux-arm64
  STATE_RELEASE_VERSION=v0.1.0
  STATE_MANIFEST_SHA256=${"a".repeat(64)}
  STATE_INSTALL_DIR="$INSTALL_DIR"
  STATE_INSTALLED_AT=2026-01-01T00:00:00Z
}
require_loaded_keys() { :; }
load_runtime_env() {
  LINKSENSE_VERSION=v0.1.0
  LINKSENSE_PUBLIC_BASE_URL=http://127.0.0.1:10080
}
verify_existing_volumes() { :; }
fetch_manifest() {
  RELEASE_VERSION=v0.1.0
  MANIFEST_SHA256=${"a".repeat(64)}
}
curl() { :; }
fetch_release_resources() { exit 88; }
TMP_ROOT=$(mktemp -d)
upgrade_action
`,
    )
    const result = spawnSync("/bin/sh", [harness], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: directory,
        LINKSENSE_INSTALL_ACTION: "upgrade",
        LINKSENSE_INSTALL_DIR: installDirectory,
        PATH: `${bin}:/usr/bin:/bin`,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /LinkSense core is already running the latest release v0\.1\.0/u)
    assert.doesNotMatch(result.stdout, /PostgreSQL backup|Stage 4\/9/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a successful install ends with a prominent initialization credential", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-credential-prompt-"))
  try {
    const bin = path.join(directory, "bin")
    await mkdir(bin)
    await writeExecutable(
      path.join(bin, "id"),
      "#!/bin/sh\nprintf '%s\\n' 0\n",
    )
    await writeExecutable(
      path.join(bin, "uname"),
      "#!/bin/sh\ncase \"$1\" in -s) printf '%s\\n' Linux ;; -m) printf '%s\\n' x86_64 ;; *) exit 1 ;; esac\n",
    )
    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const mainPosition = installer.indexOf(
      'log_stage "Stage 1: run the read-only host preflight."',
    )
    assert.ok(mainPosition > 0)
    const diagnosticsPosition = installer.lastIndexOf(
      'log "Diagnostics:',
      mainPosition,
    )
    const promptPosition = installer.lastIndexOf(
      "\n  print_initialization_credential\n",
      mainPosition,
    )
    assert.ok(diagnosticsPosition > 0)
    assert.ok(
      promptPosition > diagnosticsPosition,
      "the credential prompt must be the final installation output",
    )

    const harness = path.join(directory, "credential-prompt.sh")
    await writeExecutable(
      harness,
      `${installer.slice(0, mainPosition)}print_initialization_credential\n`,
    )
    const result = spawnSync("/bin/sh", [harness], {
      encoding: "utf8",
      env: {
        ...process.env,
        LINKSENSE_INSTALL_ACTION: "install",
        LINKSENSE_INSTALL_EDITION: "core",
        LINKSENSE_INITIALIZATION_TOKEN: "test-initialization-credential",
        LINKSENSE_PUBLIC_BASE_URL: "http://192.0.2.10:18081",
        PATH: `${bin}:/usr/bin:/bin`,
        TERM: "dumb",
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      /ACTION REQUIRED: SAVE YOUR INITIALIZATION CREDENTIAL NOW/u,
    )
    assert.match(result.stdout, /LinkSense is ready at: http:\/\/192\.0\.2\.10:18081/u)
    assert.match(result.stdout, /^test-initialization-credential$/mu)
    assert.doesNotMatch(
      result.stdout,
      /initialization credential:\s*test-initialization-credential/iu,
    )
    assert.match(result.stdout, /create the first administrator/u)
    assert.match(result.stdout, /Do not share it/u)
    assert.match(result.stdout, /Future repair runs will not display it again/u)
    assert.match(
      result.stdout.trimEnd(),
      /========================================================================$/u,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("managed release volumes are labeled once and rejected when their identity is invalid", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-volume-contract-"))
  try {
    const bin = path.join(directory, "bin")
    const state = path.join(directory, "volume-exists")
    const trace = path.join(directory, "trace")
    await mkdir(bin)
    await writeExecutable(
      path.join(bin, "id"),
      "#!/bin/sh\nprintf '%s\\n' 0\n",
    )
    await writeExecutable(
      path.join(bin, "uname"),
      "#!/bin/sh\ncase \"$1\" in -s) printf '%s\\n' Linux ;; -m) printf '%s\\n' x86_64 ;; *) exit 1 ;; esac\n",
    )
    await writeExecutable(
      path.join(bin, "docker"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$LINKSENSE_TEST_TRACE"
case "$1:$2" in
  volume:inspect)
    if [ "$3" != --format ]; then
      [ -f "$LINKSENSE_TEST_STATE" ]
      exit
    fi
    case "$4" in
      '{{.Driver}}') printf '%s\\n' local ;;
      '{{json .Options}}') printf '%s\\n' null ;;
      *com.linksense.managed-by*) if [ "\${LINKSENSE_TEST_LABEL_MODE:-valid}" = valid ]; then printf '%s\\n' linksense-production; fi ;;
      *com.linksense.persistence*) if [ "\${LINKSENSE_TEST_LABEL_MODE:-valid}" = valid ]; then printf '%s\\n' critical; fi ;;
      *com.linksense.role*) if [ "\${LINKSENSE_TEST_LABEL_MODE:-valid}" = valid ]; then printf '%s\\n' user-data; fi ;;
      *) exit 64 ;;
    esac
    ;;
  volume:create)
    : > "$LINKSENSE_TEST_STATE"
    ;;
  *) exit 64 ;;
esac
`,
    )
    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const mainPosition = installer.indexOf(
      'log_stage "Stage 1: run the read-only host preflight."',
    )
    assert.ok(mainPosition > 0)
    const harness = path.join(directory, "volume-contract.sh")
    await writeExecutable(
      harness,
      `${installer.slice(0, mainPosition)}ensure_managed_volume "$LINKSENSE_TEST_VOLUME" user-data\n`,
    )
    const environment = {
      ...process.env,
      LINKSENSE_INSTALL_ACTION: "install",
      LINKSENSE_INSTALL_EDITION: "core",
      LINKSENSE_TEST_STATE: state,
      LINKSENSE_TEST_TRACE: trace,
      LINKSENSE_TEST_VOLUME: "linksense-user-data",
      PATH: `${bin}:/usr/bin:/bin`,
    }

    execFileSync("/bin/sh", [harness], { env: environment })
    execFileSync("/bin/sh", [harness], { env: environment })
    const recorded = await readFile(trace, "utf8")
    assert.equal((recorded.match(/^volume create /gmu) ?? []).length, 1)
    assert.match(recorded, /--driver local/u)
    assert.match(recorded, /--label com\.linksense\.managed-by=linksense-production/u)
    assert.match(recorded, /--label com\.linksense\.persistence=critical/u)
    assert.match(recorded, /--label com\.linksense\.role=user-data/u)

    const invalid = spawnSync("/bin/sh", [harness], {
      encoding: "utf8",
      env: { ...environment, LINKSENSE_TEST_LABEL_MODE: "missing" },
    })
    assert.notEqual(invalid.status, 0)
    assert.match(
      `${invalid.stdout}${invalid.stderr}`,
      /does not have the required LinkSense production labels/u,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("supported hosts map to the matching Linux container platform", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-platforms-"))
  try {
    const bin = path.join(directory, "bin")
    await mkdir(bin)
    await writeExecutable(
      path.join(bin, "uname"),
      `#!/bin/sh
case "$1" in
  -s) printf '%s\\n' "$LINKSENSE_TEST_OS" ;;
  -m) printf '%s\\n' "$LINKSENSE_TEST_ARCH" ;;
  *) exit 1 ;;
esac
`,
    )
    await writeExecutable(
      path.join(bin, "id"),
      "#!/bin/sh\nprintf '%s\\n' \"$LINKSENSE_TEST_UID\"\n",
    )
    const installer = await readFile(
      path.join(releaseDirectory, "linksense-installer.sh"),
      "utf8",
    )
    const mainPosition = installer.indexOf(
      'log_stage "Stage 1: run the read-only host preflight."',
    )
    const harness = path.join(directory, "platform.sh")
    await writeExecutable(
      harness,
      `${installer.slice(0, mainPosition)}printf '%s|%s\\n' "$LINKSENSE_PLATFORM" "$INSTALL_DIR"\n`,
    )

    for (const scenario of [
      { os: "Linux", arch: "x86_64", uid: "0", expected: "linux-amd64|/opt/linksense" },
      { os: "Linux", arch: "aarch64", uid: "0", expected: "linux-arm64|/opt/linksense" },
      { os: "Darwin", arch: "x86_64", uid: "501", expected: "linux-amd64|/Users/test/.linksense" },
      { os: "Darwin", arch: "arm64", uid: "501", expected: "linux-arm64|/Users/test/.linksense" },
    ]) {
      const result = spawnSync("/bin/sh", [harness], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: "/Users/test",
          LINKSENSE_INSTALL_ACTION: "install",
          LINKSENSE_INSTALL_EDITION: "core",
          LINKSENSE_TEST_OS: scenario.os,
          LINKSENSE_TEST_ARCH: scenario.arch,
          LINKSENSE_TEST_UID: scenario.uid,
          PATH: `${bin}:/usr/bin:/bin`,
        },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), scenario.expected)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test(
  "preflight failures never create LinkSense state or run Docker mutations",
  async () => {
    const bundleDirectory = await mkdtemp(
      path.join(tmpdir(), "linksense-preflight-bundle-"),
    )
    try {
      execFileSync(
        process.execPath,
        [path.join(root, "scripts/bundle-release-installers.mjs"), bundleDirectory],
        { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
      )
      const bundled = path.join(bundleDirectory, "install-core.sh")
      await Promise.all(
        [
          { name: "docker-missing", docker: null, message: /Docker CLI is not installed/u },
          { name: "daemon-stopped", docker: "daemon-stopped", message: /Docker Desktop is stopped/u },
          { name: "engine-old", docker: "engine-old", message: /API 1\.44 is too old/u },
          { name: "compose-missing", docker: "compose-missing", message: /Compose V2 is not installed/u },
          { name: "compose-old", docker: "compose-old", message: /Compose 2\.23\.0 is too old/u },
        ].map(async (scenario) => {
          const directory = await mkdtemp(
            path.join(tmpdir(), "linksense-preflight-"),
          )
          try {
            const bin = path.join(directory, "bin")
            const installDirectory = path.join(directory, "install")
            const trace = path.join(directory, "trace")
            await mkdir(bin)
            await writeExecutable(
              path.join(bin, "id"),
              "#!/bin/sh\nprintf '%s\\n' 501\n",
            )
            await writeExecutable(
              path.join(bin, "uname"),
              "#!/bin/sh\ncase \"$1\" in -s) printf '%s\\n' Darwin ;; -m) printf '%s\\n' x86_64 ;; *) exit 1 ;; esac\n",
            )
            await writeExecutable(
              path.join(bin, "curl"),
              "#!/bin/sh\nprintf 'curl %s\\n' \"$*\" >> \"$LINKSENSE_TEST_TRACE\"\nexit 99\n",
            )
            await Promise.all(
              ["awk", "grep", "head", "tr", "sed"].map((command) =>
                linkSystemCommand(command, bin),
              ),
            )
            if (scenario.docker !== null) {
              await writeExecutable(
                path.join(bin, "docker"),
                dockerPreflightStub(scenario.docker),
              )
            }
            const result = await spawnResult("/bin/sh", [bundled], {
              env: {
                HOME: directory,
                LINKSENSE_INSTALL_DIR: installDirectory,
                LINKSENSE_TEST_TRACE: trace,
                PATH: bin,
              },
            })
            assert.notEqual(result.status, 0, scenario.name)
            assert.match(`${result.stdout}${result.stderr}`, scenario.message)
            await assert.rejects(access(installDirectory))
            const recorded = await readFile(trace, "utf8").catch(() => "")
            assert.doesNotMatch(
              recorded,
              /\b(?:pull|up|run|create|rm|prune|stop|restart)\b/iu,
            )
            assert.doesNotMatch(recorded, /^curl /mu)
          } finally {
            await rm(directory, { recursive: true, force: true })
          }
        }),
      )
    } finally {
      await rm(bundleDirectory, { recursive: true, force: true })
    }
  },
)

test("Core and Full compose models expose only the gateway on the configured port", () => {
  const docker = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  })
  if (docker.status !== 0) return

  const core = renderCompose("core")
  const full = renderCompose("full")
  const coreServices = composeServices("core")
  const fullServices = composeServices("full")

  assert.deepEqual(
    coreServices.filter((service) =>
      ["elasticsearch", "elasticsearch-init", "docling-api", "docling-worker"].includes(
        service,
      ),
    ),
    [],
  )
  for (const service of [
    "elasticsearch",
    "elasticsearch-init",
    "docling-api",
    "docling-worker",
  ]) {
    assert.ok(fullServices.includes(service), `Full is missing ${service}`)
  }
  assert.match(core, /published: "18081"/u)
  assert.match(full, /published: "18081"/u)
  assert.match(renderCompose("core", { LINKSENSE_HTTP_PORT: "19090" }), /published: "19090"/u)
  assert.equal((core.match(/published:/gu) ?? []).length, 1)
  assert.equal((full.match(/published:/gu) ?? []).length, 1)
  assert.doesNotMatch(core, /DOCLING_SERVE_URL|LINKSENSE_KB_ELASTICSEARCH_URL/u)
  assert.doesNotMatch(core, /linksense-knowledge-internal/u)
  assert.match(full, /DOCLING_SERVE_URL/u)
  assert.match(full, /LINKSENSE_KB_ELASTICSEARCH_URL/u)
  assert.match(full, /name: linksense-knowledge-internal/u)
  assert.match(full, /internal: true/u)
})

test("release compose treats every persistent volume as externally managed", async () => {
  const docker = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  })
  if (docker.status !== 0) return

  const commonSource = await readFile(
    path.join(releaseDirectory, "compose.common.yml"),
    "utf8",
  )
  assert.match(
    commonSource,
    /backup-data:\n\s+external: true\n\s+name: \$\{LINKSENSE_BACKUP_VOLUME\}/u,
  )

  for (const edition of ["core", "full"]) {
    const compose = JSON.parse(
      execFileSync(
        "docker",
        composeArguments(edition, ["config", "--format", "json"]),
        { encoding: "utf8", env: composeEnvironment(edition) },
      ),
    )
    for (const volume of [
      "linksense-postgres",
      "linksense-redis",
      "linksense-minio",
      "linksense-user-data",
      ...(edition === "full"
        ? ["linksense-elasticsearch", "linksense-tokenizer"]
        : []),
    ]) {
      const declaration = Object.values(compose.volumes).find(
        (candidate) => candidate.name === volume,
      )
      assert.ok(declaration, `${volume} must be declared`)
      assert.equal(
        declaration.external,
        true,
        `${volume} must remain outside the Compose lifecycle`,
      )
    }
  }
})

test("release Web waits for a healthy API before Nginx resolves its upstream", () => {
  const docker = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  })
  if (docker.status !== 0) return

  for (const edition of ["core", "full"]) {
    const compose = JSON.parse(
      execFileSync(
        "docker",
        composeArguments(edition, ["config", "--format", "json"]),
        { encoding: "utf8", env: composeEnvironment(edition) },
      ),
    )
    assert.deepEqual(compose.services.web.depends_on.api, {
      condition: "service_healthy",
      required: true,
    })
    assert.equal(
      compose.services.api.depends_on.web,
      undefined,
      "the startup dependency graph must remain acyclic",
    )
  }
})

test("release API receives the immutable installed LinkSense version", () => {
  const docker = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  })
  if (docker.status !== 0) return

  for (const edition of ["core", "full"]) {
    const compose = JSON.parse(
      execFileSync(
        "docker",
        composeArguments(edition, ["config", "--format", "json"]),
        { encoding: "utf8", env: composeEnvironment(edition) },
      ),
    )
    assert.equal(compose.services.api.environment.LINKSENSE_VERSION, "v0.1.0")
  }
})

test("Full runs the official Docling image offline as a constrained non-root user", async () => {
  const compose = await readFile(
    path.join(releaseDirectory, "compose.full.yml"),
    "utf8",
  )
  assert.equal((compose.match(/user: "1001:0"/gu) ?? []).length, 2)
  assert.equal((compose.match(/no-new-privileges:true/gu) ?? []).length, 2)
  assert.equal((compose.match(/cap_drop:/gu) ?? []).length, 2)
  assert.match(compose, /HF_HUB_OFFLINE: "1"/u)
  assert.match(compose, /TRANSFORMERS_OFFLINE: "1"/u)
  assert.match(compose, /tokenizer-data:\$\{LINKSENSE_TOKENIZER_MOUNT_PATH\}:ro/u)
  assert.match(compose, /mem_limit: 8g/u)
  assert.match(compose, /pids_limit: 512/u)
})

test("every LinkSense release image contains the CPAL license and separate permissions", async () => {
  const [api, web, runner] = await Promise.all(
    ["Dockerfile.api", "Dockerfile.web", "Dockerfile.runner"].map((filename) =>
      readFile(path.join(root, filename), "utf8"),
    ),
  )
  const licenseCopy =
    /COPY --chmod=0444 LICENSE \/usr\/share\/licenses\/linksense\/LICENSE/gu
  assert.equal((api.match(licenseCopy) ?? []).length, 2)
  assert.equal((web.match(licenseCopy) ?? []).length, 2)
  assert.equal((runner.match(licenseCopy) ?? []).length, 2)
  const supplementalCopy =
    /COPY --chmod=0444 LICENSE-EXCEPTIONS\.md ATTRIBUTION\.md TRADEMARK\.md NOTICE \/usr\/share\/licenses\/linksense\//gu
  assert.equal((api.match(supplementalCopy) ?? []).length, 2)
  assert.equal((web.match(supplementalCopy) ?? []).length, 2)
  assert.equal((runner.match(supplementalCopy) ?? []).length, 2)
})

test("the release workflow reuses verified main checks before promotion", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  )
  for (const image of ["api", "web", "migrate", "runner"]) {
    assert.match(workflow, new RegExp(`name: ${image}`))
    assert.match(workflow, new RegExp(`linksense-\\$\\{\\{ matrix\\.name \\}\\}`))
  }
  assert.match(workflow, /name: Publish release/u)
  assert.match(workflow, /workflow_dispatch:/u)
  assert.doesNotMatch(workflow, /push:\n\s+tags:/u)
  assert.match(workflow, /LINKSENSE_RELEASE_ACTOR/u)
  assert.match(workflow, /private\|public\)/u)
  assert.match(workflow, /actions: read/u)
  assert.match(workflow, /require_successful_workflow ci\.yml CI/u)
  assert.match(workflow, /require_successful_workflow security\.yml Security/u)
  assert.match(workflow, /\.head_sha == env\.TARGET_SHA/u)
  assert.match(workflow, /\.conclusion == "success"/u)
  assert.match(workflow, /require_successful_workflow ci\.yml CI push/u)
  assert.match(workflow, /require_successful_workflow security\.yml Security push,public,workflow_dispatch,schedule/u)
  assert.match(workflow, /env\.WORKFLOW_EVENTS \| split\(","\) \| index\(\$event\)/u)
  assert.match(workflow, /\.name == "codeql" and \.conclusion == "success"/u)
  assert.match(workflow, /-f head_sha="\$GITHUB_SHA"/u)
  assert.match(workflow, /-f status=completed/u)
  assert.doesNotMatch(workflow, /^  verify:/mu)
  assert.doesNotMatch(workflow, /pnpm (?:install|test|typecheck|lint|build)/u)
  assert.doesNotMatch(workflow, /scripts\/run-gitleaks\.sh/u)
  assert.match(workflow, /candidate-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/u)
  assert.match(workflow, /worker-image:/u)
  assert.match(
    workflow,
    /linksense-worker:\$\{\{ needs\.prepare\.outputs\.candidate_tag \}\}-\$\{\{ matrix\.architecture \}\}/u,
  )
  assert.match(workflow, /packages: write/u)
  assert.match(workflow, /GITHUB_TOKEN/u)
  assert.match(workflow, /sbom: true/u)
  assert.match(workflow, /provenance: mode=min/u)
  assert.match(workflow, /org\.opencontainers\.image\.source/u)
  assert.match(workflow, /Verify anonymous access to every LinkSense image/u)
  assert.match(workflow, /docker logout ghcr\.io/u)
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/u)
  assert.match(workflow, /runner: ubuntu-24\.04-arm/u)
  assert.match(workflow, /platform: linux\/arm64/u)
  assert.match(workflow, /platforms: \$\{\{ matrix\.platform \}\}/u)
  assert.match(workflow, /image-indexes:/u)
  assert.equal(
    workflow.match(
      /docker\/login-action@74a5d142397b4f367a81961eba4e8cd7edddf772/gu,
    )?.length,
    4,
  )
  assert.match(workflow, /sh scripts\/prepare-release-inputs\.sh release-inputs/u)
  assert.match(workflow, /cd release-inputs && sha256sum -c SHA256SUMS/u)
  assert.match(workflow, /release-inputs\/identity\.env/u)
  assert.match(workflow, /release-inputs\/tokenizer release-assets/u)
  assert.match(workflow, /fail-fast: false/u)
  assert.doesNotMatch(workflow, /fail-fast: true/u)
  assert.match(workflow, /type=gha,scope=migrate-\{0\}/u)
  assert.equal((workflow.match(/timeout=2m,ignore-error=true/gu) ?? []).length, 2)
  assert.equal((workflow.match(/overwrite: true/gu) ?? []).length, 5)
  assert.doesNotMatch(workflow, /full-installation-smoke:/u)
  assert.doesNotMatch(workflow, /self-hosted|linksense-full-release/u)
  assert.match(workflow, /docker buildx imagetools create/u)
  assert.match(workflow, /node scripts\/publish-release\.mjs release-assets/u)
  assert.doesNotMatch(workflow, /gh release (?:create|upload|edit)/u)
  const assetsJob = workflow.split("\n  assets:")[1].split("\n  release:")[0]
  assert.doesNotMatch(assetsJob, /curl |resolve-release-image\.sh/u)
  assert.doesNotMatch(workflow, /environment: public-release/u)
  assert.doesNotMatch(workflow, /attestations: write/u)
  assert.doesNotMatch(workflow, /actions\/attest-build-provenance/u)
  assert.doesNotMatch(workflow, /cache-to: type=gha,mode=max/u)
  assert.doesNotMatch(workflow, /uses: [^\n]+@(v|main|master)\b/u)
})

test("private CI scans secrets and enables GitHub security gates only when public", async () => {
  const workflows = await Promise.all(
    ["ci.yml", "release.yml", "security.yml"].map((filename) =>
      readFile(path.join(root, ".github/workflows", filename), "utf8"),
    ),
  )
  const combined = workflows.join("\n")
  const securityTriggers = workflows[2].split("\npermissions:")[0]
  assert.match(securityTriggers, /^  public:$/mu)
  assert.match(securityTriggers, /^  workflow_dispatch:$/mu)
  assert.match(
    combined,
    /pnpm audit --registry=https:\/\/registry\.npmjs\.org --prod --audit-level high/u,
  )
  assert.match(combined, /github\/codeql-action\/analyze@[0-9a-f]{40}/u)
  assert.match(
    combined,
    /actions\/dependency-review-action@[0-9a-f]{40}/u,
  )
  assert.match(combined, /scripts\/run-gitleaks\.sh/u)
  assert.match(
    combined,
    /dependency-review:\n\s+if: github\.event_name == 'pull_request' && github\.event\.repository\.visibility == 'public'/u,
  )
  assert.match(
    combined,
    /codeql:\n\s+if: github\.event\.repository\.visibility == 'public'/u,
  )
  assert.doesNotMatch(combined, /uses: [^\n]+@(v|main|master)\b/u)
})

test("the secret scanner pins and verifies the downloaded Gitleaks binary", async () => {
  const source = await readFile(path.join(root, "scripts/run-gitleaks.sh"), "utf8")
  assert.match(source, /^GITLEAKS_VERSION=8\.30\.1$/mu)
  assert.match(source, /expected_sha256=[0-9a-f]{64}/u)
  assert.match(source, /github\.com\/gitleaks\/gitleaks\/releases\/download/u)
  assert.match(source, /--retry-all-errors/u)
  assert.match(source, /\[ "\$actual_sha256" = "\$expected_sha256" \]/u)
  assert.match(source, /gitleaks" git \\\n\s+--redact \\\n\s+--verbose/u)
  assert.match(source, /--log-opts=HEAD/u)
  execFileSync("sh", ["-n", path.join(root, "scripts/run-gitleaks.sh")])
})

test("the release manifest generator records immutable images and artifact hashes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-manifest-"))
  try {
    const assetDirectory = path.join(directory, "assets")
    await cp(releaseDirectory, assetDirectory, { recursive: true })
    await cp(path.join(root, "LICENSE"), path.join(assetDirectory, "LICENSE"))
    for (const file of ["LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "NOTICE", "THIRD-PARTY-NOTICES.md"]) {
      await cp(path.join(root, file), path.join(assetDirectory, file))
    }
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/bundle-release-installers.mjs"), assetDirectory],
      { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
    )
    await chmod(path.join(assetDirectory, "linksense-installer.sh"), 0o755)
    const tokenizerLock = JSON.parse(
      await readFile(path.join(releaseDirectory, "tokenizer.lock.json"), "utf8"),
    )
    for (const filename of tokenizerLock.files) {
      await writeFile(path.join(directory, filename), `fixture:${filename}\n`)
    }
    const output = path.join(directory, "release-manifest.env")
    const digest = "a".repeat(64)
    const imageEnvironment = Object.fromEntries(
      [
        "LINKSENSE_API",
        "LINKSENSE_WEB",
        "LINKSENSE_MIGRATE",
        "LINKSENSE_RUNNER",
        "LINKSENSE_WORKER",
        "POSTGRES",
        "REDIS",
        "MINIO",
        "MINIO_CLIENT",
        "BUSYBOX",
        "GATEWAY",
        "ELASTICSEARCH",
        "DOCLING",
      ].map((key) => [
        `IMAGE_${key}`,
        `ghcr.io/example/${key.toLowerCase().replaceAll("_", "-")}@sha256:${digest}`,
      ]),
    )
    execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/generate-release-manifest.mjs"),
        output,
        directory,
        assetDirectory,
      ],
      {
        env: {
          ...process.env,
          ...imageEnvironment,
          RELEASE_VERSION: "v0.1.0",
          RELEASE_GIT_COMMIT: "b".repeat(40),
          RELEASE_BUILD_TIME: "2026-08-27T00:00:00Z",
          RELEASE_WORKFLOW_ID: "https://github.com/LingX-AI/linksense/actions/runs/1",
        },
      },
    )
    const manifest = await readFile(output, "utf8")
    assert.match(manifest, /^MANIFEST_FORMAT=2$/mu)
    assert.match(manifest, /RELEASE_VERSION=v0\.1\.0/u)
    assert.doesNotMatch(manifest, /^(?:CORE|FULL)_MIN_DISK_GIB=/mu)
    assert.doesNotMatch(manifest, /^(?:CORE|FULL)_MIN_FREE_INODES=/mu)
    assert.match(
      manifest,
      /^RELEASE_PLATFORMS=linux-amd64,linux-arm64$/mu,
    )
    assert.match(manifest, new RegExp(`IMAGE_LINKSENSE_API=ghcr\\.io/example/linksense-api@sha256:${digest}`))
    assert.match(manifest, /TOKENIZER_REVISION=5cf2132abc99cad020ac570b19d031efec650f2b/u)
    assert.match(manifest, /TOKENIZER_FILE_5_SHA256=[0-9a-f]{64}/u)
    const license = await readFile(path.join(assetDirectory, "LICENSE"))
    assert.match(
      manifest,
      new RegExp(
        `RESOURCE_LICENSE_SHA256=${createHash("sha256").update(license).digest("hex")}`,
      ),
    )
    for (const [key, file] of [
      ["LICENSE_EXCEPTIONS", "LICENSE-EXCEPTIONS.md"],
      ["ATTRIBUTION", "ATTRIBUTION.md"],
      ["TRADEMARK", "TRADEMARK.md"],
      ["NOTICE", "NOTICE"],
      ["THIRD_PARTY_NOTICES", "THIRD-PARTY-NOTICES.md"],
    ]) {
      const content = await readFile(path.join(assetDirectory, file))
      assert.ok(manifest.includes(`RESOURCE_${key}_SHA256=${createHash("sha256").update(content).digest("hex")}`))
    }
    const commonCompose = await readFile(
      path.join(assetDirectory, "compose.common.yml"),
    )
    assert.match(
      manifest,
      new RegExp(
        `RESOURCE_COMPOSE_COMMON_SHA256=${createHash("sha256").update(commonCompose).digest("hex")}`,
      ),
    )
    const upgrade = await readFile(path.join(assetDirectory, "upgrade.sh"))
    assert.match(
      manifest,
      new RegExp(
        `RESOURCE_UPGRADE_SHA256=${createHash("sha256").update(upgrade).digest("hex")}`,
      ),
    )
    const cli = await readFile(path.join(assetDirectory, "linksense-cli.sh"))
    assert.match(
      manifest,
      new RegExp(
        `RESOURCE_CLI_SHA256=${createHash("sha256").update(cli).digest("hex")}`,
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("release image resolution requires one amd64 and one arm64 manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-image-index-"))
  try {
    const bin = path.join(directory, "bin")
    const fixture = path.join(directory, "index.json")
    await mkdir(bin)
    await writeExecutable(
      path.join(bin, "docker"),
      "#!/bin/sh\ncat \"$LINKSENSE_TEST_INDEX\"\n",
    )
    const index = `${JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        {
          digest: `sha256:${"a".repeat(64)}`,
          platform: { os: "linux", architecture: "amd64" },
        },
        {
          digest: `sha256:${"b".repeat(64)}`,
          platform: { os: "linux", architecture: "arm64", variant: "v8" },
        },
      ],
    })}\n`
    await writeFile(fixture, index)
    const environment = {
      ...process.env,
      LINKSENSE_TEST_INDEX: fixture,
      PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`,
    }
    const output = execFileSync(
      "sh",
      [
        path.join(root, "scripts/resolve-release-image.sh"),
        "ghcr.io/lingx-ai/linksense-api:v0.1.0",
        "linux/amd64",
        "linux/arm64",
      ],
      { encoding: "utf8", env: environment },
    )
    assert.equal(
      output.trim(),
      `ghcr.io/lingx-ai/linksense-api@sha256:${createHash("sha256").update(index).digest("hex")}`,
    )

    await writeFile(
      fixture,
      `${JSON.stringify({
        schemaVersion: 2,
        manifests: [
          {
            digest: `sha256:${"a".repeat(64)}`,
            platform: { os: "linux", architecture: "amd64" },
          },
        ],
      })}\n`,
    )
    const missing = spawnSync(
      "sh",
      [
        path.join(root, "scripts/resolve-release-image.sh"),
        "ghcr.io/lingx-ai/linksense-api:v0.1.0",
        "linux/amd64",
        "linux/arm64",
      ],
      { encoding: "utf8", env: environment },
    )
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /must contain exactly one linux\/arm64 image/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the public snapshot keeps AGENTS.md and excludes private planning material", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-snapshot-"))
  try {
    const source = path.join(directory, "private-source")
    const target = path.join(directory, "public-source")
    await mkdir(path.join(source, "requirements"), { recursive: true })
    await mkdir(path.join(source, "training"), { recursive: true })
    await mkdir(path.join(source, "output"), { recursive: true })
    await mkdir(path.join(source, "src"), { recursive: true })
    await writeFile(path.join(source, "AGENTS.md"), "public agent guidance\n")
    await writeFile(path.join(source, "LICENSE"), "CPAL-1.0\n")
    for (const file of ["LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "NOTICE", "THIRD-PARTY-NOTICES.md"]) {
      await writeFile(path.join(source, file), `${file}\n`)
    }
    await writeFile(path.join(source, "README.md"), "# LinkSense\n")
    await writeFile(path.join(source, "src/index.ts"), "export {}\n")
    await writeFile(path.join(source, "requirements/private.md"), "private\n")
    await writeFile(path.join(source, "training/private.md"), "private\n")
    await writeFile(path.join(source, "output/private.txt"), "private\n")
    await writeFile(path.join(source, "design-qa.md"), "private\n")
    execFileSync("git", ["init", "--quiet"], { cwd: source })
    execFileSync("git", ["add", "."], { cwd: source })

    execFileSync(
      "sh",
      [path.join(root, "scripts/create-public-snapshot.sh"), target],
      { cwd: source },
    )

    await access(path.join(target, "AGENTS.md"))
    await access(path.join(target, "LICENSE"))
    for (const file of ["LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "NOTICE", "THIRD-PARTY-NOTICES.md"]) {
      await access(path.join(target, file))
    }
    await access(path.join(target, "README.md"))
    await access(path.join(target, "src/index.ts"))
    for (const forbidden of [
      "requirements",
      "training",
      "output",
      "design-qa.md",
      ".git",
    ]) {
      await assert.rejects(access(path.join(target, forbidden)))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the public snapshot applies exclusions before the tar file list", async () => {
  const source = await readFile(
    path.join(root, "scripts/create-public-snapshot.sh"),
    "utf8",
  )
  const fileListPosition = source.indexOf("-T -")
  assert.ok(fileListPosition > 0)
  for (const exclusion of [
    "--exclude='requirements'",
    "--exclude='training'",
    "--exclude='design-qa.md'",
  ]) {
    const exclusionPosition = source.indexOf(exclusion)
    assert.ok(exclusionPosition >= 0)
    assert.ok(exclusionPosition < fileListPosition)
  }
})

test("workflows that install dependencies use the resolvable pinned pnpm setup action", async () => {
  const expectedReference =
    "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1"
  for (const workflow of ["ci.yml", "security.yml"]) {
    const source = await readFile(
      path.join(root, ".github/workflows", workflow),
      "utf8",
    )
    assert.match(source, new RegExp(expectedReference))
    assert.doesNotMatch(
      source,
      /pnpm\/action-setup@a7487c7e89a18df4991f222e4898a00d66ddda/u,
    )
  }
  const releaseWorkflow = await readFile(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  )
  assert.doesNotMatch(releaseWorkflow, /pnpm\/action-setup/u)
})

test("hosted workflows install the Redis runtime required by API tests", async () => {
  const source = await readFile(
    path.join(root, ".github/workflows/ci.yml"),
    "utf8",
  )
  const installPosition = source.indexOf(
    "sudo apt-get install --yes --no-install-recommends redis-server",
  )
  const testPosition = source.indexOf("pnpm --filter @linksense/api test")
  assert.ok(installPosition >= 0)
  assert.ok(testPosition > installPosition)
})

test("hosted workflows execute the privileged runner filesystem test as root", async () => {
  const source = await readFile(
    path.join(root, ".github/workflows/ci.yml"),
    "utf8",
  )
  assert.match(
    source,
    /sudo env "PATH=\$PATH" pnpm --filter @linksense\/runner exec vitest run test\/workspace-manager\.test\.ts/u,
  )
})

test("branch workflows cancel obsolete runs before consuming more hosted minutes", async () => {
  for (const workflow of ["ci.yml", "security.yml"]) {
    const source = await readFile(
      path.join(root, ".github/workflows", workflow),
      "utf8",
    )
    assert.match(source, /concurrency:/u)
    assert.match(source, /group: [^\n]+\$\{\{ github\.ref \}\}/u)
    assert.match(source, /cancel-in-progress: true/u)
  }
})

test("dependency auditing is not duplicated across CI and branch security runs", async () => {
  const ciWorkflow = await readFile(
    path.join(root, ".github/workflows/ci.yml"),
    "utf8",
  )
  const securityWorkflow = await readFile(
    path.join(root, ".github/workflows/security.yml"),
    "utf8",
  )
  const auditCommand =
    "pnpm audit --registry=https://registry.npmjs.org --prod --audit-level high"

  assert.match(ciWorkflow, new RegExp(auditCommand.replaceAll(".", "\\."), "u"))
  assert.match(
    securityWorkflow,
    /production-audit:\n(?:\s+#.*\n)*\s+if: github\.event_name == 'schedule'/u,
  )
  assert.match(
    securityWorkflow,
    new RegExp(auditCommand.replaceAll(".", "\\."), "u"),
  )
})

function composeEnvironment(edition) {
  const digest = "a".repeat(64)
  const image = (name) => `ghcr.io/example/${name}@sha256:${digest}`
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: "linksense",
    LINKSENSE_EDITION: edition,
    LINKSENSE_VERSION: "v0.1.0",
    LINKSENSE_PLATFORM: "linux-amd64",
    LINKSENSE_DOCKER_SOCKET_SOURCE: "/var/run/docker.sock",
    LINKSENSE_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
    LINKSENSE_PUBLIC_BASE_URL: "http://127.0.0.1:18081",
    LINKSENSE_PUBLIC_SCHEME: "http",
    LINKSENSE_HTTP_PORT: "18081",
    POSTGRES_DB: "linksense",
    POSTGRES_USER: "linksense",
    POSTGRES_PASSWORD: "postgres-secret",
    DATABASE_URL: "postgresql://linksense:postgres-secret@postgres:5432/linksense",
    REDIS_PASSWORD: "redis-secret",
    REDIS_URL: "redis://:redis-secret@redis:6379/0",
    DOCLING_REDIS_URL: "redis://:redis-secret@redis:6379/2",
    LINKSENSE_JWT_SECRET: "1".repeat(64),
    LINKSENSE_INITIALIZATION_TOKEN: "0".repeat(64),
    LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET: "2".repeat(64),
    LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET: "3".repeat(64),
    LINKSENSE_CREDENTIAL_MASTER_KEY: "4".repeat(64),
    LINKSENSE_CREDENTIAL_KEY_ID: "v1",
    LINKSENSE_RUNNER_SHARED_SECRET: "5".repeat(64),
    MINIO_ROOT_USER: "linksense-root",
    MINIO_ROOT_PASSWORD: "minio-root-secret",
    MINIO_ACCESS_KEY: "linksense-app",
    MINIO_SECRET_KEY: "minio-app-secret",
    MINIO_BUCKET: "linksense-files",
    MINIO_KNOWLEDGE_BUCKET: "linksense-knowledge",
    MINIO_ENDPOINT: "minio",
    MINIO_PORT: "9000",
    MINIO_USE_SSL: "false",
    MINIO_PUBLIC_URL: "http://127.0.0.1:18081",
    MINIO_REGION: "us-east-1",
    ELASTICSEARCH_ROOT_PASSWORD: "elastic-root-secret",
    ELASTICSEARCH_USERNAME: "linksense",
    ELASTICSEARCH_PASSWORD: "elastic-app-secret",
    DOCLING_SERVE_API_KEY: "docling-secret",
    LINKSENSE_KB_HYBRID_TOKENIZER:
      "/models/tokenizers/Qwen3-Embedding-4B/current",
    LINKSENSE_TOKENIZER_MOUNT_PATH: "/models/tokenizers/Qwen3-Embedding-4B",
    LINKSENSE_API_IMAGE: image("api"),
    LINKSENSE_WEB_IMAGE: image("web"),
    LINKSENSE_MIGRATE_IMAGE: image("migrate"),
    LINKSENSE_RUNNER_IMAGE: image("runner"),
    LINKSENSE_WORKER_IMAGE: image("worker"),
    LINKSENSE_WORKER_IMAGE_REVISION: `sha256:${digest}`,
    POSTGRES_IMAGE: image("postgres"),
    REDIS_IMAGE: image("redis"),
    MINIO_IMAGE: image("minio"),
    MINIO_CLIENT_IMAGE: image("minio-client"),
    BUSYBOX_IMAGE: image("busybox"),
    GATEWAY_IMAGE: image("gateway"),
    ELASTICSEARCH_IMAGE: image("elasticsearch"),
    DOCLING_IMAGE: image("docling"),
    LINKSENSE_POSTGRES_VOLUME: "linksense-postgres",
    LINKSENSE_REDIS_VOLUME: "linksense-redis",
    LINKSENSE_MINIO_VOLUME: "linksense-minio",
    LINKSENSE_USER_DATA_VOLUME: "linksense-user-data",
    LINKSENSE_BACKUP_VOLUME: "linksense-backups",
    LINKSENSE_ELASTICSEARCH_VOLUME: "linksense-elasticsearch",
    LINKSENSE_TOKENIZER_VOLUME: "linksense-tokenizer",
    LINKSENSE_KNOWLEDGE_NETWORK: "linksense-knowledge-internal",
    LINKSENSE_INTERNAL_NETWORK: "linksense-internal",
    LINKSENSE_WORKER_CONTROL_NETWORK: "linksense-worker-control",
    LINKSENSE_WORKER_EGRESS_NETWORK: "linksense-worker-egress",
  }
}

async function writeExecutable(file, source) {
  await writeFile(file, source, { mode: 0o755 })
  await chmod(file, 0o755)
}

async function linkSystemCommand(command, targetDirectory) {
  for (const prefix of ["/usr/bin", "/bin"]) {
    const source = path.join(prefix, command)
    try {
      await access(source)
      await symlink(source, path.join(targetDirectory, command))
      return
    } catch {
      // Try the next standard system path.
    }
  }
  throw new Error(`missing system command: ${command}`)
}

function dockerPreflightStub(scenario) {
  return `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$LINKSENSE_TEST_TRACE"
case "${scenario}:$1:$2:$3" in
  daemon-stopped:info::) exit 1 ;;
  *:info::) exit 0 ;;
  *:info:--format:'{{.OSType}}') printf '%s\\n' linux ;;
  *:info:--format:'{{.Architecture}}') printf '%s\\n' x86_64 ;;
  engine-old:version:--format:*) printf '%s\\n' 1.44 ;;
  *:version:--format:*) printf '%s\\n' 1.45 ;;
  compose-missing:compose:version:*) exit 1 ;;
  compose-old:compose:version:*) printf '%s\\n' 2.23.0 ;;
  *:compose:version:*) printf '%s\\n' 2.24.4 ;;
  *) exit 1 ;;
esac
`
}

function spawnResult(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { ...options, stdio: "pipe" })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr })
    })
  })
}

function composeArguments(edition, extra = []) {
  return [
    "compose",
    "-f",
    path.join(releaseDirectory, "compose.common.yml"),
    "-f",
    path.join(releaseDirectory, `compose.${edition}.yml`),
    ...extra,
  ]
}

function renderCompose(edition, environment = {}) {
  return execFileSync("docker", composeArguments(edition, ["config"]), {
    encoding: "utf8",
    env: { ...composeEnvironment(edition), ...environment },
  })
}

function composeServices(edition) {
  return execFileSync(
    "docker",
    composeArguments(edition, ["config", "--services"]),
    { encoding: "utf8", env: composeEnvironment(edition) },
  )
    .trim()
    .split("\n")
}
