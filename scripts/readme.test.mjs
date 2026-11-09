import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const website = "https://linksense.guygubaby.top"
const read = (file) => readFile(path.join(root, file), "utf8")
const links = (source) => [
  ...[...source.matchAll(/\]\(([^\s)]+)\)/gu)].map(([, target]) => target),
  ...[...source.matchAll(/(?:src|href)="([^"\s]+)"/gu)].map(([, target]) => target),
]
const slug = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replaceAll(" ", "-")

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
    assert.ok(source.trim().split("\n").length <= 100, `${file} should stay within 100 lines`)
    assert.match(source, /raw\.githubusercontent\.com\/LingX-AI\/linksense\/main\/Install\.md/u)
    assert.doesNotMatch(source, /```(?:bash|sh)|curl --|pnpm dev:prepare|\/help\//u)
    const targets = links(source)
    for (const route of routes) {
      assert.ok(targets.includes(`${website}/doc/${locale}${route}`), `${file}: missing ${route}`)
    }
  }
})
