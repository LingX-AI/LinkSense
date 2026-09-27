import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const englishPath = path.join(root, "README.md")
const chinesePath = path.join(root, "README.zh-CN.md")
const readBoth = () => Promise.all([
  readFile(englishPath, "utf8"),
  readFile(chinesePath, "utf8"),
])

test("the bilingual READMEs follow the complete 4.4 section order", async () => {
  const [english, chinese] = await readBoth()
  assert.match(chinese, /\[English\]\(\.\/README\.md\)/u)
  assert.match(english, /\[简体中文\]\(\.\/README\.zh-CN\.md\)/u)

  const pairedHeadings = [
    ["Why LinkSense", "为什么选择 LinkSense"],
    ["Quick Start", "快速开始"],
    ["See LinkSense in Action", "看看 LinkSense 如何工作"],
    ["Organizational Capabilities", "组织能力"],
    ["Built on the Open-source Codex Runtime", "基于开源 Codex 运行时"],
    ["Open Source. Self-hosted. Under Your Control.", "开源。自主部署。由你掌控。"],
    ["Architecture", "系统架构"],
    ["Build with LinkSense", "基于 LinkSense 扩展"],
    ["Deployment reference", "部署参考"],
    ["Technology Stack", "技术栈"],
    ["Local Development", "本地开发"],
    ["Building from Source with Docker", "使用 Docker 从源码构建"],
    ["Security", "安全"],
    ["Contributing", "贡献"],
    ["Who is using LinkSense", "谁在使用 LinkSense"],
    ["Support", "获取支持"],
    ["License", "开源协议"],
  ]
  const headings = (source) => [...source.matchAll(/^## (.+)$/gmu)].map(([, title]) => title)
  assert.deepEqual(headings(english), pairedHeadings.map(([title]) => title))
  assert.deepEqual(headings(chinese), pairedHeadings.map(([, title]) => title))

  for (const source of [chinese, english]) {
    for (const required of [
      "60+ GiB", "120+ GiB", "Intel", "Apple Silicon", "v1.45", "v2.24.4",
      "CPAL-1.0", "Apache-2.0", "18–24px", "security@linksense.org",
      "hello@linksense.org", "licensing@linksense.org", "./ADOPTERS.md",
      "./CLA.md", "./THIRD-PARTY-NOTICES.md", "../../discussions",
      "volume://linksense-backups/postgres/", "linux/amd64", "linux/arm64",
    ]) {
      assert.ok(source.includes(required), `README is missing ${required}`)
    }
  }
})

test("the Chinese translation preserves every 4.4 command block and diagram", async () => {
  const [english, chinese] = await readBoth()
  const commands = (source) => [...source.matchAll(/```bash\n([\s\S]*?)```/gu)].map(([, block]) => block)
  assert.equal(commands(english).length, 12)
  assert.deepEqual(commands(chinese), commands(english))
  const images = (source) => [...source.matchAll(/<img src="([^"]+)" alt="([^"]+)" width="(\d+)"\s*\/>/gu)]
  assert.equal(images(english).length, 13)
  assert.equal(images(chinese).length, 13)
  assert.deepEqual(
    images(chinese).map(([, src, , width]) => [src, width]),
    images(english).map(([, src, , width]) => [src, width]),
  )
  for (const [, , alt] of images(chinese)) assert.match(alt, /\p{Script=Han}/u)
})

test("every local README link and HTML image resolves to a repository file", async () => {
  for (const readmePath of [chinesePath, englishPath]) {
    const source = await readFile(readmePath, "utf8")
    const targets = [
      ...[...source.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]+)?\)/gu)].map(([, target]) => target),
      ...[...source.matchAll(/(?:src|href)="(\.\/[^"#]+)(?:#[^"]+)?"/gu)].map(([, target]) => target),
    ]
    assert.ok(targets.length > 12)
    for (const target of targets) {
      await access(path.resolve(path.dirname(readmePath), target))
    }
  }
})

test("both READMEs use the configured installer and Docker development ports", async () => {
  const [installer, environment, english, chinese] = await Promise.all([
    readFile(path.join(root, "deploy/release/linksense-installer.sh"), "utf8"),
    readFile(path.join(root, ".env.example"), "utf8"),
    ...[englishPath, chinesePath].map((file) => readFile(file, "utf8")),
  ])
  const installerPort = installer.match(/^HTTP_PORT=\$\{REQUESTED_HTTP_PORT:-(\d+)\}$/mu)?.[1]
  assert.ok(installerPort)
  const configuredPort = (name) => {
    const value = environment.match(new RegExp(`^${name}=(\\d+)$`, "mu"))?.[1]
    assert.ok(value, `Missing configured port: ${name}`)
    return value
  }
  const developmentAddresses = [
    `http://localhost:${configuredPort("LINKSENSE_DEV_WEB_PORT")}`,
    `https://localhost:${configuredPort("LINKSENSE_DEV_WEB_HTTPS_PORT")}`,
    `http://localhost:${configuredPort("LINKSENSE_DEV_API_PORT")}`,
    `http://localhost:${configuredPort("LINKSENSE_DEV_RUNNER_PORT")}`,
  ]
  for (const source of [english, chinese]) {
    assert.ok(source.includes(`http://localhost:${installerPort}`))
    assert.ok(source.includes(`http://<server-address>:${installerPort}`))
    assert.match(source, /LINKSENSE_HTTP_PORT=19090/u)
    assert.match(source, /linksense port 19090/u)
    const development = source.split(/## (?:Local Development|本地开发)\n/u)[1]?.split("\n## ")[0]
    assert.ok(development)
    for (const address of developmentAddresses) {
      assert.ok(development.includes(address), `README is missing ${address}`)
    }
    assert.doesNotMatch(development, /localhost:5173|http:\/\/localhost:18173|https:\/\/localhost:18174/u)
  }
})
