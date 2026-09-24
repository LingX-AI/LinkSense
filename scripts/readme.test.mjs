import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const englishPath = path.join(root, "README.md")
const chinesePath = path.join(root, "README.zh-CN.md")

test("the bilingual READMEs describe the open-source workspace and its public entry points", async () => {
  const [chinese, english] = await Promise.all([
    readFile(chinesePath, "utf8"),
    readFile(englishPath, "utf8"),
  ])
  assert.match(chinese, /\[English\]\(\.\/README\.md\)/u)
  assert.match(english, /\[简体中文\]\(\.\/README\.zh-CN\.md\)/u)
  assert.match(english, /60\+ GiB/u)
  assert.match(english, /120\+ GiB/u)
  assert.match(chinese, /60 GiB\+/u)
  assert.match(chinese, /120 GiB\+/u)

  const pairedHeadings = [
    ["## Why LinkSense", "## 为什么选择 LinkSense"],
    ["## Organizational Capabilities", "## 组织能力"],
    ["## Built with the Open-source Codex Runtime", "## 基于开源 Codex 运行时"],
    ["## Quick Start", "## 快速开始"],
    ["## Architecture", "## 系统架构"],
    ["## Build with LinkSense", "## 基于 LinkSense 扩展"],
    ["## Local Development", "## 本地开发"],
    ["## License", "## 开源协议"],
    ["## Contributors", "## 贡献者"],
  ]
  for (const [englishHeading, chineseHeading] of pairedHeadings) {
    assert.match(english, new RegExp(`^${escapeRegExp(englishHeading)}$`, "mu"))
    assert.match(chinese, new RegExp(`^${escapeRegExp(chineseHeading)}$`, "mu"))
  }

  for (const source of [chinese, english]) {
    for (const required of [
      "codex app-server --stdio",
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
      "linksense upgrade",
      "pnpm dev",
      "AGENTS.md",
      "docker compose --env-file .env.example build",
      "CPAL-1.0",
      "developer@linksense.org",
    ]) {
      assert.ok(source.includes(required), `README is missing ${required}`)
    }
    assert.doesNotMatch(source, /linksense upgrade v\d|README-v\d|v4\.2/iu)
    assert.doesNotMatch(source, /sandboxed iframes?|沙箱化的 iframe/iu)
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

test("both READMEs distinguish installer, source, Docker development, and host development ports", async () => {
  const [installer, exampleEnvironment, hostEnvironment, sourceCompose, productionCompose, ...readmes] = await Promise.all([
    readFile(path.join(root, "deploy/release/linksense-installer.sh"), "utf8"),
    readFile(path.join(root, ".env.example"), "utf8"),
    readFile(path.join(root, "deploy/development/env.host.example"), "utf8"),
    readFile(path.join(root, "docker-compose.yml"), "utf8"),
    readFile(path.join(root, "docker-compose.production.yml"), "utf8"),
    readFile(englishPath, "utf8"),
    readFile(chinesePath, "utf8"),
  ])
  const installerPort = installer.match(/^HTTP_PORT=\$\{REQUESTED_HTTP_PORT:-(\d+)\}$/mu)?.[1]
  const sourcePort = exampleEnvironment.match(/^LINKSENSE_HTTP_PORT=(\d+)$/mu)?.[1]
  const developmentHttpPort = exampleEnvironment.match(/^LINKSENSE_DEV_WEB_PORT=(\d+)$/mu)?.[1]
  const developmentHttpsPort = exampleEnvironment.match(/^LINKSENSE_DEV_WEB_HTTPS_PORT=(\d+)$/mu)?.[1]
  const hostPort = hostEnvironment.match(/^LINKSENSE_DEV_WEB_PORT=(\d+)$/mu)?.[1]

  assert.ok(installerPort && sourcePort && developmentHttpPort && developmentHttpsPort && hostPort)
  assert.ok(sourceCompose.includes(`\${LINKSENSE_HTTP_PORT:-${sourcePort}}:80`))
  assert.ok(productionCompose.includes(`\${LINKSENSE_GATEWAY_BIND_ADDRESS:-127.0.0.1}:\${LINKSENSE_HTTP_PORT:-${sourcePort}}:80`))
  for (const readme of readmes) {
    for (const address of [
      `http://localhost:${installerPort}`,
      `http://localhost:${sourcePort}`,
      `http://localhost:${developmentHttpPort}`,
      `https://localhost:${developmentHttpsPort}`,
      `http://localhost:${hostPort}`,
      `127.0.0.1:${sourcePort}`,
    ]) {
      assert.ok(readme.includes(address), `README is missing ${address}`)
    }
    assert.match(readme, /LINKSENSE_HTTP_PORT/u)
    assert.match(readme, /LINKSENSE_DEV_WEB_HTTPS_PORT/u)
    assert.match(readme, /pnpm dev:host/u)
  }
})

test("both READMEs document the default HTTP and HTTPS entries and certificate setup", async () => {
  for (const readmePath of [englishPath, chinesePath]) {
    const source = await readFile(readmePath, "utf8")
    const development = source.split(/## (?:Local Development|本地开发)\n/u)[1]?.split("\n## ")[0]
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
