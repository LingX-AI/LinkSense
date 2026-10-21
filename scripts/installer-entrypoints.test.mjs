import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const releaseDirectory = path.join(root, "deploy/release")

async function writeExecutable(file, source) {
  await writeFile(file, source, { mode: 0o755 })
  await chmod(file, 0o755)
}

test("bootstrap forwards supported diagnostics and fails closed when legacy diagnostics cannot be downloaded", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-bootstrap-diagnostics-"))
  try {
    const bin = path.join(directory, "bin")
    await mkdir(bin)
    await writeFile(path.join(bin, "curl"), `#!/bin/sh
target=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in -o) target=$2; shift 2 ;; *) url=$1; shift ;; esac
done
case "$url" in
  */linksense-host.sh)
    printf '%s\\n' 'touch "$MOCK_EXECUTED"' > "$target"
    printf '%s\\n' 'https://user:private-proxy-value@proxy.example' >&2
    exit 22 ;;
esac
cp "$MOCK_DOWNLOADED_INSTALLER" "$target"
`, { mode: 0o755 })
    const downloaded = path.join(directory, "downloaded.sh")
    const failureMessages = new Map()
    for (const [source, expected] of [
      ['#!/bin/sh\nprintf "%s\\n" "$*" > "$MOCK_EXECUTED"\n# --check-network)\n', 0],
      ['#!/bin/sh\ntouch "$MOCK_EXECUTED"\n', 1],
    ]) {
      await writeFile(downloaded, source)
      for (const entry of ["install-core.sh", "install-full.sh", "repair-core.sh", "repair-full.sh", "upgrade.sh"]) {
        for (const locale of expected === 0 ? ["en-US"] : ["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP", "unknown"]) {
          const marker = path.join(directory, `${entry}.executed`)
          const result = spawnSync("sh", [path.join(root, entry), "--check-network"], {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              LINKSENSE_RELEASE_BASE_URL: "https://downloads.example/v0.3.8",
              LINKSENSE_CLI_LANGUAGE: locale,
              MOCK_DOWNLOADED_INSTALLER: downloaded,
              MOCK_EXECUTED: marker,
            },
          })
          assert.equal(result.status, expected, result.stderr)
          if (expected === 0) {
            assert.equal(await readFile(marker, "utf8"), "--check-network\n")
            await rm(marker)
          } else {
            await assert.rejects(access(marker))
            assert.match(result.stderr, /--check-network/u)
            assert.doesNotMatch(result.stderr, /private-proxy-value/u)
            failureMessages.set(locale, result.stderr)
          }
        }
      }
    }
    assert.equal(new Set(failureMessages.values()).size, 6)
    assert.equal(failureMessages.get("unknown"), failureMessages.get("zh-CN"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


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


test("bootstrap and bundled network diagnostics work before installation without creating state or starting containers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-network-bundle-"))
  try {
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/bundle-release-installers.mjs"), directory],
      { env: { ...process.env, RELEASE_VERSION: "v0.1.0" } },
    )
    const bin = path.join(directory, "bin")
    await mkdir(bin)
    const manifest = `IMAGE_BUSYBOX=docker.io/library/busybox@sha256:${"a".repeat(64)}\nIMAGE_LINKSENSE_API=ghcr.io/lingx-ai/linksense-api@sha256:${"b".repeat(64)}\n`
    await writeFile(path.join(directory, "manifest"), manifest)
    const legacyInstaller = path.join(directory, "legacy-installer.sh")
    const installerExecuted = path.join(directory, "installer-executed")
    await writeFile(legacyInstaller, '#!/bin/sh\ntouch "$MOCK_INSTALLER_EXECUTED"\n')
    await writeFile(path.join(directory, "checksum"), `${createHash("sha256").update(manifest).digest("hex")}  release-manifest.env\n`)
    await writeExecutable(path.join(bin, "uname"), `#!/bin/sh
case "$1" in -s) echo "$MOCK_OS" ;; -m) echo arm64 ;; *) exit 1 ;; esac
`)
    await writeExecutable(path.join(bin, "id"), '#!/bin/sh\necho 501\n')
    await writeExecutable(path.join(bin, "curl"), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$MOCK_TRACE"
target=
while [ "$#" -gt 0 ]; do
  case "$1" in -o) target=$2; shift 2 ;; *) url=$1; shift ;; esac
done
case "$url" in
  */linksense-host.sh) cp "$MOCK_HOST_HELPERS" "$target" ;;
  */install-core.sh|*/install-full.sh|*/repair-core.sh|*/repair-full.sh|*/upgrade.sh) cp "$MOCK_LEGACY_INSTALLER" "$target" ;;
  *)
    echo 'https://user:private-proxy-value@proxy.example' >&2
    [ "$MOCK_CURL_STATUS" = 0 ] || exit "$MOCK_CURL_STATUS"
    case "$url" in *.sha256) cp "$MOCK_CHECKSUM" "$target" ;; *) cp "$MOCK_MANIFEST" "$target" ;; esac ;;
esac
`)
    await writeExecutable(path.join(bin, "docker"), `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$MOCK_TRACE"
case "$1:$2" in pull:ghcr.io/*) exit "$MOCK_GHCR_STATUS" ;; info:*|pull:*) exit "$MOCK_DOCKER_STATUS" ;; *) exit 99 ;; esac
`)
    for (const scenario of [
      { os: "Darwin", curl: 0, docker: 0 },
      { os: "Linux", curl: 0, docker: 0 },
      { os: "Darwin", curl: 0, docker: 0, entry: "upgrade.sh" },
      { os: "Darwin", curl: 28, docker: 0 },
      { os: "Darwin", curl: 0, docker: 1 },
      { os: "Darwin", curl: 0, docker: 0, ghcr: 1 },
      { os: "Darwin", curl: 0, docker: 0, invalid: "checksum" },
      { os: "Darwin", curl: 0, docker: 0, invalid: "image" },
      { os: "Darwin", curl: 0, docker: 0, invalid: "duplicate" },
      ...["install-core.sh", "install-full.sh", "repair-core.sh", "repair-full.sh", "upgrade.sh"]
        .map(bootstrap => ({ os: "Linux", curl: 0, docker: 0, bootstrap })),
      { os: "Linux", curl: 0, docker: 0, bootstrap: "install-core.sh", invalid: "checksum" },
      { os: "Linux", curl: 0, docker: 0, bootstrap: "install-core.sh", ghcr: 1 },
      { os: "Linux", curl: 0, docker: 0, bootstrap: "install-core.sh", invalid: "arguments" },
    ]) {
      const manifestSource = scenario.invalid === "image"
        ? manifest.replace(/IMAGE_LINKSENSE_API=.*/u, "IMAGE_LINKSENSE_API=--all-tags")
        : scenario.invalid === "duplicate"
          ? `${manifest}IMAGE_LINKSENSE_API=ghcr.io/untrusted/api@sha256:${"c".repeat(64)}\n`
          : manifest
      await writeFile(path.join(directory, "manifest"), manifestSource)
      const checksum = scenario.invalid === "checksum" ? "0".repeat(64) : createHash("sha256").update(manifestSource).digest("hex")
      await writeFile(path.join(directory, "checksum"), `${checksum}  release-manifest.env\n`)
      const trace = path.join(directory, "trace")
      const installDirectory = path.join(directory, "installation")
      const entry = scenario.bootstrap ? path.join(root, scenario.bootstrap) : path.join(directory, scenario.entry ?? "install-core.sh")
      const args = scenario.invalid === "arguments" ? ["--check-network", "--unexpected"] : ["--check-network"]
      const result = spawnSync("/bin/sh", [entry, ...args], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          HOME: directory,
          DOCKER_CONFIG: directory,
          PATH: `${bin}:/usr/bin:/bin`,
          LINKSENSE_INSTALL_DIR: installDirectory,
          LINKSENSE_RELEASE_BASE_URL: "https://downloads.example/v0.1.0",
          LINKSENSE_CLI_LANGUAGE: "en-US",
          MOCK_OS: scenario.os,
          MOCK_CURL_STATUS: String(scenario.curl),
          MOCK_DOCKER_STATUS: String(scenario.docker),
          MOCK_GHCR_STATUS: String(scenario.ghcr ?? 0),
          MOCK_MANIFEST: path.join(directory, "manifest"),
          MOCK_CHECKSUM: path.join(directory, "checksum"),
          MOCK_TRACE: trace,
          MOCK_LEGACY_INSTALLER: legacyInstaller,
          MOCK_INSTALLER_EXECUTED: installerExecuted,
          MOCK_HOST_HELPERS: path.join(releaseDirectory, "linksense-host.sh"),
        },
      })
      assert.equal(result.status, scenario.curl || scenario.docker || scenario.ghcr || scenario.invalid ? 1 : 0, result.stderr)
      await assert.rejects(access(installDirectory))
      await assert.rejects(access(installerExecuted))
      const calls = await readFile(trace, "utf8")
      if (scenario.invalid === "arguments") {
        assert.match(result.stderr, /installer_arguments/u)
        assert.doesNotMatch(calls, /release-manifest\.env|docker /u)
        await rm(trace)
        continue
      }
      assert.match(result.stdout, /(?:PASS|FAIL) terminal-release/u)
      assert.match(result.stdout, /(?:PASS|FAIL) docker-engine/u)
      assert.doesNotMatch(result.stdout + result.stderr, /private-proxy-value/u)
      assert.match(calls, /https:\/\/downloads.example\/v0\.1\.0\/release-manifest.env/u)
      assert.doesNotMatch(calls, /docker (?:run|create|start|stop|compose|volume)/u)
      if (scenario.bootstrap) assert.match(calls, /https:\/\/raw\.githubusercontent\.com\/LingX-AI\/linksense\/[0-9a-f]{40}\/deploy\/release\/linksense-host\.sh/u)
      else assert.doesNotMatch(calls, /raw\.githubusercontent\.com/u)
      if (scenario.docker === 0 && scenario.curl === 0 && !scenario.invalid) {
        assert.match(calls, /docker pull docker.io\/library\/busybox@sha256:/u)
        assert.match(calls, /docker pull ghcr.io\/lingx-ai\/linksense-api@sha256:/u)
      } else if (scenario.docker === 0) assert.match(calls, /docker pull hello-world:latest/u)
      else assert.doesNotMatch(calls, /docker pull/u)
      assert.doesNotMatch(calls, /docker pull --all-tags|docker pull ghcr.io\/untrusted/u)
      await rm(trace)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
