import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const website = "https://linksense.guygubaby.top"
const read = (file) => readFile(path.join(root, file), "utf8")

test("local README, community, and legal links resolve", async () => {
  for (const file of [
    "README.md", "README.zh-CN.md", ".github/CONTRIBUTING.md",
    ".github/CODE_OF_CONDUCT.md", ".github/SECURITY.md", ".github/SUPPORT.md",
    "docs/community/ADOPTERS.md", "docs/legal/CLA.md",
  ]) {
    const source = await read(file)
    const targets = [
      ...[...source.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]+)?\)/gu)].map(([, target]) => target),
      ...[...source.matchAll(/(?:src|href)="(\.\.?\/[^"#]+)(?:#[^"]+)?"/gu)].map(([, target]) => target),
    ]
    for (const target of targets) {
      if (target !== "../../discussions") {
        await access(path.resolve(root, path.dirname(file), target))
      }
    }
  }
})

test("both READMEs stay concise and link to matching public guides", async () => {
  const routes = [
    "", "deploy/", "deploy/core/", "deploy/full/", "deploy/first-setup/",
    "deploy/operations/", "deploy/development/", "deploy/architecture/",
    "user-guide/overview/", "admin-guide/overview/",
    "developer-guide/interactive-application/",
  ]
  for (const [file, locale] of [["README.md", ""], ["README.zh-CN.md", "zh-CN/"]]) {
    const source = await read(file)
    assert.ok(source.trim().split("\n").length <= 100, `${file} should remain concise`)
    assert.match(source, /raw\.githubusercontent\.com\/LingX-AI\/linksense\/main\/Install\.md/u)
    assert.doesNotMatch(source, /```(?:bash|sh)|curl --|pnpm dev:prepare|\/help\//u)
    for (const route of routes) {
      assert.ok(source.includes(`](${website}/doc/${locale}${route})`), `${file}: missing ${route}`)
    }
  }
})
