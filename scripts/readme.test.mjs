import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const chinesePath = path.join(root, "README.md")
const englishPath = path.join(root, "README.en.md")

test("the concise bilingual READMEs expose the same public entry points", async () => {
  const [chinese, english] = await Promise.all([
    readFile(chinesePath, "utf8"),
    readFile(englishPath, "utf8"),
  ])

  assert.ok(chinese.split("\n").length <= 150)
  assert.ok(english.split("\n").length <= 150)
  assert.match(chinese, /\[English\]\(\.\/README\.en\.md\)/u)
  assert.match(english, /\[简体中文\]\(\.\/README\.md\)/u)
  assert.match(chinese, /我们/u)
  assert.match(english, /\b(?:We|Our)\b/u)
  assert.doesNotMatch(chinese, /它/u)
  assert.doesNotMatch(english, /\b(?:it|its)\b/iu)

  for (const heading of [
    "## 特性",
    "## 一键安装",
    "## 推荐配置",
    "## 本地开发",
    "### AI 开发指南",
    "## 源码构建（Docker）",
    "## 开源协议",
  ]) {
    assert.match(chinese, new RegExp(`^${escapeRegExp(heading)}$`, "mu"))
  }
  for (const heading of [
    "## Features",
    "## One-line installation",
    "## Recommended configuration",
    "## Local development",
    "### AI development guide",
    "## Building from source with Docker",
    "## License",
  ]) {
    assert.match(english, new RegExp(`^${escapeRegExp(heading)}$`, "mu"))
  }

  for (const source of [chinese, english]) {
    for (const required of [
      "install-core.sh | sudo sh",
      "install-full.sh | sudo sh",
      "repair-core.sh | sudo sh",
      "repair-full.sh | sudo sh",
      "linux/amd64",
      "10080",
      "pnpm dev",
      "AGENTS.md",
      "docker compose --env-file .env.example build",
      "CPAL-1.0",
      "developer@infocare.org.cn",
    ]) {
      assert.ok(source.includes(required), `README is missing ${required}`)
    }
    assert.doesNotMatch(source, /private-source|私有源码|未来公开|internal HTTPS/iu)
  }
})

test("every relative README link resolves to a repository file", async () => {
  for (const readmePath of [chinesePath, englishPath]) {
    const source = await readFile(readmePath, "utf8")
    const links = [...source.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]+)?\)/gu)].map(
      ([, target]) => target,
    )
    assert.ok(links.length > 0)
    for (const target of links) {
      await access(path.resolve(path.dirname(readmePath), target))
    }
  }
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
