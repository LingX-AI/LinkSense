import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, test } from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const cliPath = path.join(root, "deploy/release/linksense-cli.sh")
let commandDirectory

// Immutable command stubs are shared; every scenario still has independent
// installation state and log paths supplied through its child environment.
before(async () => {
  commandDirectory = await mkdtemp(
    path.join(tmpdir(), "linksense-cli-commands-"),
  )
  await createCommandStubs(commandDirectory)
})

after(async () => {
  if (commandDirectory)
    await rm(commandDirectory, { recursive: true, force: true })
})

function cliTest(name, run) {
  return test(name, { concurrency: true }, run)
}

describe("release management CLI", { concurrency: 4 }, () => {
  cliTest(
    "the management CLI supports Linux amd64, Linux ARM64, and both macOS architectures",
    async () => {
      for (const platform of [
        ["Linux", "x86_64", "linux-amd64", "0"],
        ["Linux", "aarch64", "linux-arm64", "0"],
        ["Darwin", "x86_64", "linux-amd64", "501"],
        ["Darwin", "arm64", "linux-arm64", "501"],
      ]) {
        const fixture = await createFixture({
          hostOs: platform[0],
          hostArchitecture: platform[1],
          statePlatform: platform[2],
          mockUid: platform[3],
        })
        try {
          const result = await runCli(fixture, ["version"])
          assert.equal(result.status, 0, result.stderr)
          assert.match(result.stdout, new RegExp(`${platform[2]}\\)`))
        } finally {
          await fixture.cleanup()
        }
      }
    },
  )

  cliTest(
    "the management CLI exposes interactive and automation-friendly commands",
    async () => {
      const fixture = await createFixture()
      try {
        const help = await runCli(fixture, ["--help"])
        assert.equal(help.status, 0, help.stderr)
        for (const command of [
          "status",
          "start",
          "stop",
          "restart",
          "port <port>",
          "credential",
          "logs [service]",
          "doctor",
          "repair",
          "upgrade [version]",
        ]) {
          assert.ok(help.stdout.includes(command), `help is missing ${command}`)
        }

        const menu = await runCli(fixture, [], { input: "0\n" })
        assert.equal(menu.status, 0, menu.stderr)
        assert.match(menu.stdout, /LinkSense Control/u)
        assert.match(menu.stdout, /Change access port/u)
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest("the management CLI provides a Chinese interface", async () => {
    const fixture = await createFixture()
    try {
      const menu = await runCli(fixture, [], {
        environment: { LINKSENSE_CLI_LANGUAGE: "zh-CN" },
        input: "0\n",
      })
      assert.equal(menu.status, 0, menu.stderr)
      assert.match(menu.stdout, /LinkSense 管理工具/u)
      assert.match(menu.stdout, /修改访问端口/u)
    } finally {
      await fixture.cleanup()
    }
  })

  cliTest(
    "status, start, stop, restart, logs, and diagnostics use the installed Compose project",
    async () => {
      const fixture = await createFixture()
      try {
        for (const command of [
          ["status"],
          ["start"],
          ["restart"],
          ["logs", "api"],
          ["doctor"],
          ["stop"],
        ]) {
          const result = await runCli(fixture, command)
          assert.equal(
            result.status,
            0,
            `${command.join(" ")}: ${result.stderr}`,
          )
        }
        const dockerLog = await readFile(fixture.dockerLog, "utf8")
        assert.match(dockerLog, /compose .* ps --all/u)
        assert.match(dockerLog, /compose .* up -d --remove-orphans/u)
        assert.match(dockerLog, /compose .* restart -t 60/u)
        assert.match(dockerLog, /compose .* logs --tail 200 api/u)
        assert.match(dockerLog, /volume inspect linksense-postgres/u)
        assert.match(dockerLog, /compose .* stop -t 60/u)

        const invalidService = await runCli(fixture, ["logs", "unknown"])
        assert.notEqual(invalidService.status, 0)
        assert.match(invalidService.stderr, /Unknown LinkSense service/u)

        const invalidVolume = await runCli(fixture, ["doctor"], {
          environment: { MOCK_VOLUME_LABELS: "invalid" },
        })
        assert.notEqual(invalidVolume.status, 0)
        assert.match(
          invalidVolume.stderr,
          /missing trusted LinkSense data labels/u,
        )
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "port migration updates runtime state, recreates only API and Gateway, and keeps backups",
    async () => {
      const fixture = await createFixture()
      try {
        const result = await runCli(fixture, ["port", "19090"])
        assert.equal(result.status, 0, result.stderr)
        assert.match(result.stdout, /Port changed from 18081 to 19090/u)
        const environment = await readFile(
          path.join(fixture.installDir, ".env"),
          "utf8",
        )
        const state = await readFile(
          path.join(fixture.installDir, "install-state.env"),
          "utf8",
        )
        assert.match(environment, /^LINKSENSE_HTTP_PORT=19090$/mu)
        assert.match(
          environment,
          /^LINKSENSE_PUBLIC_BASE_URL=http:\/\/127\.0\.0\.1:19090$/mu,
        )
        assert.match(
          environment,
          /^MINIO_PUBLIC_URL=http:\/\/127\.0\.0\.1:19090$/mu,
        )
        assert.match(state, /^STATE_HTTP_PORT=19090$/mu)
        assert.match(state, /^STATE_LAST_PORT_CHANGE_AT=/mu)
        const backupRoot = path.join(fixture.installDir, "backups")
        const backupEntries = await import("node:fs/promises").then(
          ({ readdir }) => readdir(backupRoot),
        )
        assert.equal(backupEntries.length, 1)
        const dockerLog = await readFile(fixture.dockerLog, "utf8")
        const apiRecreate = dockerLog.indexOf(
          "up -d --no-deps --force-recreate api",
        )
        const apiHealth = dockerLog.indexOf("ps -q api")
        const gatewayRecreate = dockerLog.indexOf(
          "up -d --no-deps --force-recreate gateway",
        )
        assert.ok(apiRecreate >= 0)
        assert.ok(apiHealth > apiRecreate)
        assert.ok(gatewayRecreate > apiHealth)
        assert.doesNotMatch(dockerLog, /down|-v|volume rm/u)
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "port migration rejects invalid, occupied, and browser-restricted ports",
    async () => {
      const fixture = await createFixture()
      try {
        for (const port of ["0", "65536", "invalid"]) {
          const result = await runCli(fixture, ["port", port])
          assert.notEqual(result.status, 0)
          assert.match(result.stderr, /between 1 and 65535/u)
        }
        const restricted = await runCli(fixture, ["port", "10080"])
        assert.notEqual(restricted.status, 0)
        assert.match(restricted.stderr, /restricted by major browsers/u)
        const occupied = await runCli(fixture, ["port", "19090"], {
          environment: { MOCK_PORT_IN_USE: "19090" },
        })
        assert.notEqual(occupied.status, 0)
        assert.match(occupied.stderr, /already in use/u)
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "a failed running port migration restores the previous configuration",
    async () => {
      const fixture = await createFixture()
      try {
        const originalEnvironment = await readFile(
          path.join(fixture.installDir, ".env"),
          "utf8",
        )
        const originalState = await readFile(
          path.join(fixture.installDir, "install-state.env"),
          "utf8",
        )
        const result = await runCli(fixture, ["port", "19090"], {
          environment: { MOCK_HEALTH_FAIL_PORT: "19090" },
        })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /previous configuration were restored/u)
        assert.equal(
          await readFile(path.join(fixture.installDir, ".env"), "utf8"),
          originalEnvironment,
        )
        assert.equal(
          await readFile(
            path.join(fixture.installDir, "install-state.env"),
            "utf8",
          ),
          originalState,
        )
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "port migration keeps an HTTPS reverse-proxy URL and does not start a stopped installation",
    async () => {
      const fixture = await createFixture({
        publicBaseUrl: "https://linksense.example.com",
      })
      try {
        const result = await runCli(fixture, ["port", "19090"], {
          environment: { MOCK_GATEWAY_RUNNING: "false" },
        })
        assert.equal(result.status, 0, result.stderr)
        const environment = await readFile(
          path.join(fixture.installDir, ".env"),
          "utf8",
        )
        assert.match(
          environment,
          /^LINKSENSE_PUBLIC_BASE_URL=https:\/\/linksense\.example\.com$/mu,
        )
        assert.match(
          environment,
          /^MINIO_PUBLIC_URL=https:\/\/linksense\.example\.com$/mu,
        )
        const dockerLog = await readFile(fixture.dockerLog, "utf8")
        assert.doesNotMatch(dockerLog, /force-recreate/u)
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "the one-time credential is shown only while initialization is pending",
    async () => {
      const fixture = await createFixture()
      try {
        const pending = await runCli(fixture, ["credential"], {
          environment: {
            MOCK_BOOTSTRAP_RESPONSE:
              '{"success":true,"data":{"initialized":false,"initialization_credential_required":true}}',
          },
        })
        assert.equal(pending.status, 0, pending.stderr)
        assert.match(pending.stdout, /test-initialization-credential/u)

        const initialized = await runCli(fixture, ["credential"], {
          environment: {
            MOCK_BOOTSTRAP_RESPONSE:
              '{"success":true,"data":{"initialized":true,"initialization_credential_required":false}}',
          },
        })
        assert.equal(initialized.status, 0, initialized.stderr)
        assert.match(initialized.stdout, /credential has expired/u)
        assert.doesNotMatch(
          initialized.stdout,
          /test-initialization-credential/u,
        )
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "repair and upgrade invoke only the trusted scripts from the installation",
    async () => {
      const fixture = await createFixture()
      try {
        const repair = await runCli(fixture, ["repair"])
        assert.equal(repair.status, 0, repair.stderr)
        const upgrade = await runCli(fixture, ["upgrade", "v0.3.0"])
        assert.equal(upgrade.status, 0, upgrade.stderr)
        const commandLog = await readFile(fixture.commandLog, "utf8")
        assert.match(
          commandLog,
          new RegExp(
            `repair install=${escapeRegularExpression(fixture.installDir)} base=https://downloads\\.example/linksense-v0\\.2\\.1`,
            "u",
          ),
        )
        assert.match(
          commandLog,
          new RegExp(
            `upgrade install=${escapeRegularExpression(fixture.installDir)} version=v0\\.3\\.0`,
            "u",
          ),
        )
      } finally {
        await fixture.cleanup()
      }
    },
  )

  cliTest(
    "Linux users are elevated through sudo while macOS rejects root execution",
    async () => {
      const linux = await createFixture({ mockUid: "1000" })
      try {
        const result = await runCli(linux, ["version"], {
          environment: {
            LINKSENSE_RELEASE_BASE_URL:
              "https://downloads.example/linksense-v0.3.0",
            MOCK_SUDO_EXIT: "73",
          },
        })
        assert.equal(result.status, 73)
        const sudoLog = await readFile(linux.sudoLog, "utf8")
        assert.match(sudoLog, /LINKSENSE_INSTALL_DIR=/u)
        assert.match(
          sudoLog,
          /LINKSENSE_RELEASE_BASE_URL=https:\/\/downloads\.example\/linksense-v0\.3\.0/u,
        )
        assert.match(sudoLog, /linksense-cli\.sh version/u)
      } finally {
        await linux.cleanup()
      }

      const mac = await createFixture({
        hostOs: "Darwin",
        hostArchitecture: "arm64",
        mockUid: "0",
        statePlatform: "linux-arm64",
      })
      try {
        const result = await runCli(mac, ["version"])
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /without sudo/u)
      } finally {
        await mac.cleanup()
      }
    },
  )
})

async function createFixture(overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-cli-"))
  const installDir = path.join(directory, "install")
  const bin = commandDirectory
  const dockerLog = path.join(directory, "docker.log")
  const commandLog = path.join(directory, "command.log")
  const sudoLog = path.join(directory, "sudo.log")
  const hostOs = overrides.hostOs ?? "Linux"
  const hostArchitecture = overrides.hostArchitecture ?? "x86_64"
  const statePlatform = overrides.statePlatform ?? "linux-amd64"
  const mockUid = overrides.mockUid ?? "0"
  const publicBaseUrl = overrides.publicBaseUrl ?? "http://127.0.0.1:18081"
  await mkdir(path.join(installDir, "bin"), { recursive: true })
  await writeFile(
    path.join(installDir, "install-state.env"),
    [
      "STATE_FORMAT=2",
      "STATE_EDITION=full",
      `STATE_PLATFORM=${statePlatform}`,
      "STATE_RELEASE_VERSION=v0.2.1",
      `STATE_INSTALL_DIR=${installDir}`,
      "STATE_HTTP_PORT=18081",
      "STATE_RELEASE_BASE_URL=https://downloads.example/linksense-v0.2.1",
      "STATE_DATA_VOLUMES=linksense-postgres,linksense-user-data",
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  await writeFile(
    path.join(installDir, ".env"),
    [
      "LINKSENSE_HTTP_PORT=18081",
      `LINKSENSE_PUBLIC_BASE_URL=${publicBaseUrl}`,
      `MINIO_PUBLIC_URL=${publicBaseUrl}`,
      "LINKSENSE_INITIALIZATION_TOKEN=test-initialization-credential",
      "LINKSENSE_WORKER_CONTROL_NETWORK=linksense-worker-control",
      "LINKSENSE_USER_DATA_VOLUME=linksense-user-data",
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  await writeFile(
    path.join(installDir, "compose.common.yml"),
    'services:\n  gateway:\n    ports:\n      - "0.0.0.0:${LINKSENSE_HTTP_PORT:?required}:80"\n',
  )
  await writeFile(path.join(installDir, "compose.full.yml"), "services: {}\n")
  await writeExecutable(
    path.join(installDir, "bin", "repair-full.sh"),
    '#!/bin/sh\nprintf "repair install=%s base=%s\\n" "${LINKSENSE_INSTALL_DIR:-}" "${LINKSENSE_RELEASE_BASE_URL:-}" >> "$MOCK_COMMAND_LOG"\n',
  )
  await writeExecutable(
    path.join(installDir, "bin", "upgrade.sh"),
    '#!/bin/sh\nprintf "upgrade install=%s version=%s\\n" "${LINKSENSE_INSTALL_DIR:-}" "${LINKSENSE_VERSION:-}" >> "$MOCK_COMMAND_LOG"\n',
  )
  await writeFile(dockerLog, "")
  await writeFile(commandLog, "")
  await writeFile(sudoLog, "")

  return {
    bin,
    commandLog,
    directory,
    dockerLog,
    hostArchitecture,
    hostOs,
    installDir,
    mockUid,
    sudoLog,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

function runCli(fixture, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [cliPath, ...arguments_], {
      cwd: fixture.directory,
      env: {
        PATH: `${fixture.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        HOME: fixture.directory,
        LANG: "en_US.UTF-8",
        LINKSENSE_CLI_LANGUAGE: "en-US",
        LINKSENSE_CLI_WAIT_ATTEMPTS: "1",
        LINKSENSE_CLI_WAIT_INTERVAL_SECONDS: "0",
        LINKSENSE_INSTALL_DIR: fixture.installDir,
        MOCK_DOCKER_LOG: fixture.dockerLog,
        MOCK_COMMAND_LOG: fixture.commandLog,
        MOCK_HOST_ARCH: fixture.hostArchitecture,
        MOCK_HOST_OS: fixture.hostOs,
        MOCK_SUDO_LOG: fixture.sudoLog,
        MOCK_UID: fixture.mockUid,
        ...options.environment,
      },
      stdio: "pipe",
    })
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
    child.stdin.end(options.input)
  })
}

async function writeExecutable(file, source) {
  await writeFile(file, source, { mode: 0o755 })
  await chmod(file, 0o755)
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

async function createCommandStubs(bin) {
  await writeExecutable(
    path.join(bin, "uname"),
    '#!/bin/sh\ncase "$1" in -s) printf "%s\\n" "$MOCK_HOST_OS" ;; -m) printf "%s\\n" "$MOCK_HOST_ARCH" ;; *) exit 1 ;; esac\n',
  )
  await writeExecutable(
    path.join(bin, "id"),
    '#!/bin/sh\n[ "$1" = -u ] && printf "%s\\n" "$MOCK_UID"\n',
  )
  await writeExecutable(
    path.join(bin, "stat"),
    '#!/bin/sh\ncase "$1:$2" in -c:%u|-f:%u) printf "%s\\n" "$MOCK_UID" ;; -c:%a|-f:%Lp) printf "600\\n" ;; *) exit 1 ;; esac\n',
  )
  await writeExecutable(
    path.join(bin, "sudo"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_SUDO_LOG"\nexit "${MOCK_SUDO_EXIT:-0}"\n',
  )
  await writeExecutable(
    path.join(bin, "ss"),
    '#!/bin/sh\ncase "$*" in *":$MOCK_PORT_IN_USE"*) [ -n "${MOCK_PORT_IN_USE:-}" ] && printf "LISTEN mock\\n" ;; esac\n',
  )
  await writeExecutable(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n")
  await writeExecutable(
    path.join(bin, "curl"),
    `#!/bin/sh
url=
for argument in "$@"; do url=$argument; done
case "$url" in
  */api/v1/system/bootstrap) printf '%s\\n' "\${MOCK_BOOTSTRAP_RESPONSE:-{\\"success\\":true,\\"data\\":{\\"initialized\\":false,\\"initialization_credential_required\\":true}}}" ;;
  *:\${MOCK_HEALTH_FAIL_PORT:-none}/api/v1/system/health/ready) exit 22 ;;
  */api/v1/system/health/ready) printf '%s\\n' '{"success":true,"data":{"status":"available"}}' ;;
  *) exit 22 ;;
esac
`,
  )
  await writeExecutable(
    path.join(bin, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"
case "$1:$2" in
  info:) exit 0 ;;
  compose:version) printf '2.40.3\\n'; exit 0 ;;
  ps:*)
    case "$*" in
      *"publish=$MOCK_PORT_IN_USE"*) [ -n "\${MOCK_PORT_IN_USE:-}" ] && printf 'occupied\\n' ;;
    esac
    exit 0
    ;;
  inspect:*)
    case "$*" in
      *State.Health*) printf '%s\\n' "\${MOCK_SERVICE_STATE:-healthy}" ;;
      *State.Running*) printf '%s\\n' "\${MOCK_GATEWAY_RUNNING:-true}" ;;
      *runner.managed*) printf 'true\\n' ;;
      *runner.instance*) printf 'mock-instance\\n' ;;
    esac
    exit 0
    ;;
  volume:inspect)
    [ "$3" = --format ] || exit 0
    case "$4" in
      *com.linksense.managed-by*)
        [ "\${MOCK_VOLUME_LABELS:-valid}" = valid ] && printf 'linksense-production\\n'
        ;;
      *com.linksense.persistence*)
        [ "\${MOCK_VOLUME_LABELS:-valid}" = valid ] && printf 'critical\\n'
        ;;
    esac
    exit 0
    ;;
esac
case "$*" in
  *"config --services"*) printf '%s\\n' api web runner gateway postgres redis minio ;;
  *"ps -q gateway"*) printf 'gateway-id\\n' ;;
  *"ps -q api"*) printf 'api-id\\n' ;;
  *"ps --all"*) printf 'mock compose status\\n' ;;
  *"logs --tail"*) printf 'mock logs\\n' ;;
esac
exit 0
`,
  )
}
