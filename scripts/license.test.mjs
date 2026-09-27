import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const read = (file) => readFile(path.join(root, file), "utf8")

test("the CPAL text is pinned and the 4.4 exhibits identify the shipped attribution mark", async () => {
  const [officialText, checksum, license, definition, component] = await Promise.all([
    read("vendor/CPAL-1.0.txt"),
    read("vendor/CPAL-1.0.txt.sha256"),
    read("LICENSE"),
    read("attribution.json").then(JSON.parse),
    read("apps/web/src/components/brand/powered-by-linksense.tsx"),
  ])

  assert.equal(createHash("sha256").update(officialText).digest("hex"), checksum.split(/\s/u)[0])
  assert.ok(license.startsWith(officialText.trimEnd()))
  assert.equal(definition.phrase, "Powered by")
  assert.equal(definition.imageAltText, "LinkSense")
  assert.equal(Object.hasOwn(definition, "url"), false)
  assert.match(license, /Attribution URL:\s+\(none\)/u)
  assert.doesNotMatch(license, /https:\/\/linksense\.org/u)
  assert.equal(definition.minMarkHeightPx, 18)
  assert.equal(definition.defaultMarkHeightPx, 20)
  assert.equal(definition.maxMarkHeightPx, 24)
  assert.match(license, /Attribution Phrase \(not exceeding 10 words\):\s+Powered by/u)
  assert.ok(license.includes(definition.graphicImage))
  assert.match(component, /<a\b/u)
  assert.ok(component.includes('href="https://linksense.org"'))
  assert.ok(component.includes(definition.imageAltText))
  for (const mark of Object.values(definition.variants)) {
    await read(mark)
  }
  for (const variant of ["lockup", "lockup-light"]) {
    assert.ok(component.includes(`${definition.publicBasePath}/${path.basename(definition.variants[variant])}`))
  }
})

test("the separate 4.4 permissions and trademark grant resolve from both READMEs", async () => {
  const [english, chinese, permissions, attribution, trademark] = await Promise.all([
    read("README.md"),
    read("README.zh-CN.md"),
    read("LICENSE-EXCEPTIONS.md"),
    read("ATTRIBUTION.md"),
    read("TRADEMARK.md"),
  ])
  for (const readme of [english, chinese]) {
    for (const file of ["LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md"]) {
      assert.ok(readme.includes(`./${file}`))
    }
  }
  assert.match(permissions, /Internal Deployment Exception/u)
  assert.match(permissions, /Your Own Branding/u)
  assert.match(attribution, /18px and 24px/u)
  assert.doesNotMatch(attribution, /<a\b|href=|https:\/\/linksense\.org/u)
  assert.doesNotMatch(permissions, /Attribution URL|linking to our site/u)
  assert.match(trademark, /Use required for attribution/u)
  for (const document of [permissions, attribution, trademark]) {
    assert.doesNotMatch(document, /\{\{(?:DOMAIN|YEAR|LEGAL_ENTITY|MARK_PATH)\}\}/u)
  }
})

test("the third-party notice matches every pinned release image and is linked by both READMEs", async () => {
  const [english, chinese, notice, projectNotice, preparation] = await Promise.all([
    read("README.md"),
    read("README.zh-CN.md"),
    read("THIRD-PARTY-NOTICES.md"),
    read("NOTICE"),
    read("scripts/prepare-release-inputs.sh"),
  ])

  for (const readme of [english, chinese]) {
    assert.ok(readme.includes("./THIRD-PARTY-NOTICES.md"))
  }
  assert.ok(projectNotice.includes("THIRD-PARTY-NOTICES.md"))

  const pinnedImages = [...preparation.matchAll(/^resolve (\w+) (\S+)$/gmu)]
  assert.equal(pinnedImages.length, 8)
  for (const [, , image] of pinnedImages) {
    assert.ok(notice.includes(`\`${image}\``), `${image} is absent from the third-party notice`)
  }
  assert.match(notice, /Redis 7\.4 is source-available under RSALv2 or SSPLv1/u)
  assert.match(notice, /Elasticsearch[\s\S]*?default distribution remains under ELv2/u)
  assert.match(notice, /LinkSense does not relicense them under CPAL-1\.0/u)
})
