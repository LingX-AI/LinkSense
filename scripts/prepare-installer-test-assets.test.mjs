import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { prepareInstallerTestAssets } from "./prepare-installer-test-assets.mjs"

test("source installer tests preserve published runtime identity, reject corrupted inputs and never modify published assets", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-installer-assets-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const published = path.join(directory, "published")
  const output = path.join(directory, "candidate")
  await mkdir(published)
  const manifest = `RELEASE_VERSION=v0.3.9\nRELEASE_GIT_COMMIT=${"a".repeat(40)}\nRELEASE_WORKFLOW_ID=https://github.com/example/repo/actions/runs/123\nIMAGE_LINKSENSE_API=registry.example/api@sha256:${"b".repeat(64)}\n`
  const hash = value => createHash("sha256").update(value).digest("hex")
  await writeFile(path.join(published, "release-manifest.env"), manifest)
  await writeFile(path.join(published, "compose.core.yml"), "published-compose\n")
  await writeFile(path.join(published, "SHA256SUMS"), `${hash(manifest)}  release-manifest.env\n${hash("published-compose\n")}  compose.core.yml\n`)
  await prepareInstallerTestAssets(published, output, "c".repeat(40))
  assert.equal(await readFile(path.join(published, "release-manifest.env"), "utf8"), manifest)
  assert.equal(await readFile(path.join(output, "compose.core.yml"), "utf8"), "published-compose\n")
  assert.equal(await readFile(path.join(output, "compose.common.yml"), "utf8"), await readFile(new URL("../deploy/release/compose.common.yml", import.meta.url), "utf8"))
  const candidate = await readFile(path.join(output, "release-manifest.env"), "utf8")
  assert.ok(candidate.startsWith(manifest))
  assert.match(candidate, /RESOURCE_INSTALL_CORE_SHA256=[a-f0-9]{64}/u)
  assert.match(candidate, /RESOURCE_COMPOSE_COMMON_SHA256=[a-f0-9]{64}/u)
  assert.equal(JSON.parse(await readFile(path.join(output, "installer-test.json"), "utf8")).installerSourceSha, "c".repeat(40))
  await writeFile(path.join(published, "compose.core.yml"), "corrupt")
  await assert.rejects(prepareInstallerTestAssets(published, path.join(directory, "invalid"), "c".repeat(40)), /Invalid local asset/u)
})
