import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const website = "https://linksense.guygubaby.top"
const docs = "apps/docs"
const english = `${docs}/i18n/en-US/docusaurus-plugin-content-docs`

test("local README, community, and legal links resolve", async () => {
  for (const file of [
    "README.md", "README.zh-CN.md", ".github/CONTRIBUTING.md",
    ".github/CODE_OF_CONDUCT.md", ".github/SECURITY.md", ".github/SUPPORT.md",
    "docs/community/ADOPTERS.md", "docs/legal/CLA.md",
  ]) {
    const source = await readFile(path.join(root, file), "utf8")
    const targets = [
      ...[...source.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]+)?\)/gu)].map(([, target]) => target),
      ...[...source.matchAll(/(?:src|href)="(\.\.?\/[^"#]+)(?:#[^"]+)?"/gu)].map(([, target]) => target),
    ]
    for (const target of targets) {
      if (target === "../../discussions") continue
      await access(path.resolve(root, path.dirname(file), target))
    }
  }
})

test("both READMEs link to matching locale guides without repeating deployment commands", async () => {
  const paths = [
    "", "deploy/", "deploy/core/", "deploy/full/", "deploy/first-setup/",
    "deploy/operations/", "deploy/development/", "deploy/architecture/",
    "user-guide/overview/", "admin-guide/overview/", "developer-guide/interactive-application/",
  ]
  for (const [file, localePath, guides, deployment] of [
    ["README.md", "en-US/", `${english}/current`, `${english}-deployment/current`],
    ["README.zh-CN.md", "", `${docs}/docs`, `${docs}/deployment`],
  ]) {
    const source = await readFile(path.join(root, file), "utf8")
    assert.match(source, /raw\.githubusercontent\.com\/LingX-AI\/linksense\/main\/Install\.md/u)
    assert.doesNotMatch(source, /```(?:bash|sh)|curl --|pnpm dev:prepare/u)
    for (const route of paths) {
      assert.ok(source.includes(`](${website}/help/${localePath}${route})`), `${file}: missing ${route}`)
      const docFile = route.startsWith("deploy/")
        ? `${deployment}/${route.slice("deploy/".length, -1) || "overview"}.md`
        : `${guides}/${route.slice(0, -1) || "introduction"}.md`
      await access(path.join(root, docFile))
    }
  }
})
