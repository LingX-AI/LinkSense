import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const englishPath = path.join(root, "README.md")
const chinesePath = path.join(root, "README.zh-CN.md")

test("the concise bilingual READMEs expose the same public entry points", async () => {
  const [chinese, english] = await Promise.all([
    readFile(chinesePath, "utf8"),
    readFile(englishPath, "utf8"),
  ])

  // Count editorial content separately so new contributors cannot break this limit.
  for (const source of [chinese, english]) {
    const editorial = source.replace(
      /<!-- contributors:start -->[\s\S]*?<!-- contributors:end -->/u,
      "<!-- contributors -->",
    )
    assert.ok(editorial.split("\n").length <= 185)
  }
  assert.match(chinese, /\[English\]\(\.\/README\.md\)/u)
  assert.match(english, /\[简体中文\]\(\.\/README\.zh-CN\.md\)/u)
  assert.match(chinese, /我们/u)
  assert.match(english, /\b(?:We|Our)\b/u)
  assert.doesNotMatch(chinese, /它/u)
  assert.doesNotMatch(english, /\b(?:it|its)\b/iu)
  assert.match(english, /60\+ GiB/u)
  assert.match(english, /120\+ GiB/u)
  assert.match(chinese, /60 GiB\+/u)
  assert.match(chinese, /120 GiB\+/u)

  for (const heading of [
    "## 特性",
    "## 一键安装",
    "### 安装环境要求",
    "## 命令行管理",
    "## 推荐配置",
    "## 本地开发",
    "### AI 开发指南",
    "## 源码构建（Docker）",
    "## 开源协议",
    "## 贡献者",
  ]) {
    assert.match(chinese, new RegExp(`^${escapeRegExp(heading)}$`, "mu"))
  }
  for (const heading of [
    "## Features",
    "## One-line installation",
    "### Host requirements",
    "## Command-line management",
    "## Recommended configuration",
    "## Local development",
    "### AI development guide",
    "## Building from source with Docker",
    "## License",
    "## Contributors",
  ]) {
    assert.match(english, new RegExp(`^${escapeRegExp(heading)}$`, "mu"))
  }

  for (const source of [chinese, english]) {
    for (const required of [
      "install-core.sh | sudo sh",
      "install-full.sh | sudo sh",
      "repair-core.sh | sudo sh",
      "repair-full.sh | sudo sh",
      "upgrade.sh | sudo sh",
      "volume://linksense-backups/postgres/",
      "linux/amd64",
      "linux/arm64",
      "Intel Mac",
      "Apple Silicon",
      "v1.45",
      "v2.24.4",
      "18081",
      "LINKSENSE_HTTP_PORT=19090",
      "linksense port 19090",
      "linksense credential",
      "linksense upgrade v0.3.0",
      "pnpm dev",
      "AGENTS.md",
      "docker compose --env-file .env.example build",
      "CPAL-1.0",
      "developer@linksense.org",
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

test("both READMEs document the default HTTP and HTTPS entries and certificate setup", async () => {
  for (const readmePath of [englishPath, chinesePath]) {
    const source = await readFile(readmePath, "utf8")
    const development = source.split(/## (?:Local development|本地开发)\n/u)[1]?.split("\n## ")[0]
    assert.ok(development)
    for (const required of ["http://localhost:18172", "https://localhost:18173", "HTTP/2", "mkcert -install", "LINKSENSE_DEV_WEB_PORT", "LINKSENSE_DEV_WEB_HTTPS_PORT"]) {
      assert.ok(development.includes(required), `${path.basename(readmePath)} is missing ${required}`)
    }
    assert.doesNotMatch(development, /http:\/\/localhost:18173|https:\/\/localhost:18174/u)
    assert.ok(development.indexOf("mkcert -install") < development.indexOf("pnpm dev:prepare"))
  }
})

test("both READMEs end with the same accessible contributor avatars after the license", async () => {
  const [english, chinese] = await Promise.all([
    readFile(englishPath, "utf8"),
    readFile(chinesePath, "utf8"),
  ])
  const blocks = [english, chinese].map((source) => {
    assert.equal(source.split("<!-- contributors:start -->").length, 2)
    assert.equal(source.split("<!-- contributors:end -->").length, 2)
    assert.match(source, /<!-- contributors:end -->\s*$/u)
    const block = source.match(/<!-- contributors:start -->([\s\S]*?)<!-- contributors:end -->/u)?.[1]
    assert.ok(block)
    assert.match(block, /<a href="https:\/\/github\.com\/[A-Za-z0-9-]+"><img src="https:\/\/avatars\.githubusercontent\.com\/u\/\d+\?s=128" width="64" height="64" alt="[A-Za-z0-9-]+" title="[A-Za-z0-9-]+" \/><\/a>/u)
    assert.doesNotMatch(block, /contrib\.rocks|token=|access_token|\[bot\]/iu)
    return block
  })
  assert.equal(blocks[0], blocks[1])
  assert.ok(english.indexOf("## Contributors") > english.indexOf("## License"))
  assert.ok(chinese.indexOf("## 贡献者") > chinese.indexOf("## 开源协议"))
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
