import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, cp, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { verifyReleaseAssets } from "./publish-release.mjs"
import { parseEnvironment } from "./release-installation-smoke.mjs"

const root = path.resolve(import.meta.dirname, "..")
const sha256 = value => createHash("sha256").update(value).digest("hex")

export async function prepareInstallerTestAssets(publishedDirectory, outputDirectory, sourceSha) {
  assert.match(sourceSha, /^[0-9a-f]{40}$/u)
  assert.notEqual(path.resolve(publishedDirectory), path.resolve(outputDirectory))
  const published = parseEnvironment(await readFile(path.join(publishedDirectory, "release-manifest.env"), "utf8"))
  verifyReleaseAssets({ assetDirectory: publishedDirectory, version: published.RELEASE_VERSION, sourceSha: published.RELEASE_GIT_COMMIT, workflowUrl: published.RELEASE_WORKFLOW_ID })
  // Exercise source scripts and the shared deployment model with frozen runtime images.
  await cp(publishedDirectory, outputDirectory, { recursive: true, errorOnExist: true, force: false })
  await copyFile(path.join(root, "deploy/release/compose.common.yml"), path.join(outputDirectory, "compose.common.yml"))
  execFileSync(process.execPath, [path.join(root, "scripts/bundle-release-installers.mjs"), outputDirectory], {
    env: { ...process.env, RELEASE_VERSION: published.RELEASE_VERSION },
  })
  const resources = {
    COMPOSE_COMMON: "compose.common.yml",
    CLI: "linksense-cli.sh", INSTALLER_ENGINE: "linksense-installer.sh",
    INSTALL_CORE: "install-core.sh", INSTALL_FULL: "install-full.sh",
    REPAIR_CORE: "repair-core.sh", REPAIR_FULL: "repair-full.sh", UPGRADE: "upgrade.sh",
  }
  for (const [key, file] of Object.entries(resources)) published[`RESOURCE_${key}_SHA256`] = sha256(await readFile(path.join(outputDirectory, file)))
  const manifest = Object.entries(published).map(([key, value]) => `${key}=${value}`).join("\n") + "\n"
  await writeFile(path.join(outputDirectory, "release-manifest.env"), manifest)
  await writeFile(path.join(outputDirectory, "release-manifest.env.sha256"), `${sha256(manifest)}  release-manifest.env\n`)
  await writeFile(path.join(outputDirectory, "installer-test.json"), JSON.stringify({ scope: "source-installer-with-published-runtime", sourceFiles: Object.values(resources), installerSourceSha: sourceSha, runtimeSourceSha: published.RELEASE_GIT_COMMIT, version: published.RELEASE_VERSION }, null, 2) + "\n")
  const hashes = []
  for (const file of (await readdir(outputDirectory)).filter(file => file !== "SHA256SUMS").sort()) hashes.push(`${sha256(await readFile(path.join(outputDirectory, file)))}  ${file}`)
  await writeFile(path.join(outputDirectory, "SHA256SUMS"), hashes.join("\n") + "\n")
  verifyReleaseAssets({ assetDirectory: outputDirectory, version: published.RELEASE_VERSION, sourceSha: published.RELEASE_GIT_COMMIT, workflowUrl: published.RELEASE_WORKFLOW_ID })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [published, output] = process.argv.slice(2)
  assert.ok(published && output && process.env.GITHUB_SHA, "usage: GITHUB_SHA=<commit> prepare-installer-test-assets.mjs <published-assets> <test-assets>")
  await prepareInstallerTestAssets(published, output, process.env.GITHUB_SHA)
}
