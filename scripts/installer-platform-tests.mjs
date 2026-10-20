import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { release, version } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const installerTestFiles = [
  "scripts/installer-entrypoints.test.mjs",
  "scripts/installer-host.test.mjs",
  "scripts/installer-runtime-regressions.test.mjs",
  "scripts/release-installation-smoke.test.mjs",
  "scripts/installer-platform-tests.test.mjs",
  "scripts/prepare-installer-test-assets.test.mjs",
]

export async function runPlatformTests(reportDirectory, files = installerTestFiles) {
  await mkdir(reportDirectory, { recursive: true })
  const report = {
    scope: process.env.LINKSENSE_TEST_SCOPE ?? "native-script-compatibility",
    dockerRuntimeTested: false,
    sourceSha: process.env.GITHUB_SHA,
    platform: process.platform, architecture: process.arch,
    kernel: release(), osVersion: version(), node: process.version,
    runnerImage: process.env.ImageOS, runnerImageVersion: process.env.ImageVersion,
    containerImage: process.env.LINKSENSE_TEST_IMAGE,
    files,
  }
  if (process.platform === "linux") report.distribution = (await readFile("/etc/os-release", "utf8")).trim()
  const environment = { ...process.env }
  delete environment.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", "--test-reporter=tap", ...files], {
    env: environment, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024,
  })
  const output = (result.stdout ?? "") + (result.stderr ?? "")
  process.stdout.write(output)
  report.success = result.status === 0 && !result.error
  report.exitCode = result.status
  report.error = result.error?.code ?? result.signal
  await writeFile(path.join(reportDirectory, "tests.tap"), output, { mode: 0o600 })
  await writeFile(path.join(reportDirectory, "platform.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
  return report.success ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("usage: installer-platform-tests.mjs <report-directory>")
  process.exitCode = await runPlatformTests(process.argv[2])
}
