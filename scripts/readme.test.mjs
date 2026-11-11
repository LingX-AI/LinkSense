import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { contributorEnd, contributorStart, readmeFiles } from "./update-contributors.mjs"

const root = path.resolve(import.meta.dirname, "..")
const website = "https://linksense.org"
const read = (file) => readFile(path.join(root, file), "utf8")
const links = (source) => [
  ...[...source.matchAll(/\]\(([^\s)]+)\)/gu)].map(([, target]) => target),
  ...[...source.matchAll(/(?:src|href)="([^"\s]+)"/gu)].map(([, target]) => target),
]
const slug = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replaceAll(" ", "-")

test("package homepage points to the official website", async () => {
  assert.equal(JSON.parse(await read("package.json")).homepage, website)
})

test("README images, local links, and heading anchors resolve", async () => {
  for (const file of [
    "README.md", "README.zh-CN.md", "docs/contact.zh-CN.md", ".github/CONTRIBUTING.md",
    ".github/CODE_OF_CONDUCT.md", ".github/SECURITY.md", ".github/SUPPORT.md",
    "docs/community/ADOPTERS.md", "docs/legal/CLA.md",
  ]) {
    for (const target of links(await read(file))) {
      if (/^[a-z]+:/iu.test(target) || target === "../../discussions") continue
      const [pathname, anchor] = target.split("#")
      const destination = pathname ? path.resolve(root, path.dirname(file), pathname) : path.join(root, file)
      await access(destination)
      if (anchor && destination.endsWith(".md")) {
        const content = await readFile(destination, "utf8")
        const headings = [...content.matchAll(/^#{1,6} (.+)$/gmu)].map(([, title]) => slug(title.trim()))
        assert.ok(headings.includes(decodeURIComponent(anchor)), `${file}: unresolved ${target}`)
      }
    }
  }
})

test("both READMEs stay concise and defer product documentation to the public site", async () => {
  const routes = [
    "", "deploy/", "deploy/core/", "deploy/full/", "deploy/first-setup/",
    "deploy/operations/", "deploy/development/", "deploy/architecture/",
    "user-guide/overview/", "admin-guide/overview/",
    "developer-guide/interactive-application/",
  ]

  for (const [file, locale] of [["README.md", ""], ["README.zh-CN.md", "zh-CN/"]]) {
    const source = await read(file)
    // The generated roster grows with the community; keep the README prose within its existing budget.
    const prose = source.replace(/<!-- contributors:start -->[\s\S]*?<!-- contributors:end -->\n?/u, "")
    assert.ok(prose.trim().split("\n").length <= 100, `${file} prose should stay within 100 lines`)
    assert.match(source, /raw\.githubusercontent\.com\/LingX-AI\/linksense\/main\/Install\.md/u)
    assert.doesNotMatch(source, /```(?:bash|sh)|curl --|pnpm dev:prepare|\/help\//u)
    const targets = links(source)
    for (const route of routes) {
      assert.ok(targets.includes(`${website}/doc/${locale}${route}`), `${file}: missing ${route}`)
    }
  }
})

test("both READMEs include the same contributor avatars and visible usernames at the bottom", async () => {
  const blocks = []
  for (const file of readmeFiles) {
    const source = await read(file)
    assert.equal(source.split(contributorStart).length, 2, `${file}: missing or duplicate start marker`)
    assert.equal(source.split(contributorEnd).length, 2, `${file}: missing or duplicate end marker`)
    assert.ok(source.indexOf(contributorStart) < source.indexOf(contributorEnd))
    assert.ok(source.trimEnd().endsWith(contributorEnd), `${file}: contributors must be at the bottom`)
    const block = source.slice(source.indexOf(contributorStart) + contributorStart.length, source.indexOf(contributorEnd)).trim()
    assert.match(block, /<img [^>]+alt=""/u)
    assert.match(block, /<br \/>@[a-z\d-]+<\/a>/iu)
    assert.doesNotMatch(block, /<(?:sub|sup)\b/u)
    assert.equal([...block.matchAll(/<img /gu)].length, [...block.matchAll(/<br \/>@/gu)].length)
    blocks.push(block)
  }
  assert.equal(blocks[0], blocks[1])
})
