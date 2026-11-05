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

test("both READMEs retain centered introductions and link to matching public guides without product videos", async () => {
  const paths = [
    "", "deploy/", "deploy/core/", "deploy/full/", "deploy/first-setup/",
    "deploy/operations/", "deploy/development/", "deploy/architecture/",
    "user-guide/overview/", "admin-guide/overview/", "developer-guide/interactive-application/",
    "admin-guide/model-settings/", "user-guide/getting-started/first-task/",
    "user-guide/plugin-center/discover-and-install/", "user-guide/knowledge-bases/sharing/",
  ]
  for (const [file, localePath, operationAnchors] of [
    ["README.md", "", ["concurrency-and-workers", "virtual-machines-and-knowledge", "environment-and-network"]],
    ["README.zh-CN.md", "zh-CN/", ["并发与-worker", "虚拟机与知识库", "环境与网络"]],
  ]) {
    const source = await read(file)
    assert.match(source, /^<p align="center">/u)
    assert.match(source, /<h2 align="center">/u)
    assert.match(source, /raw\.githubusercontent\.com\/LingX-AI\/linksense\/main\/Install\.md/u)
    assert.doesNotMatch(source, /<video\b|<iframe\b|user-attachments\/assets\/|docs\/demo\/|VideoDemo|入口待提供|\/help\//iu)
    const targets = links(source)
    // Public deployment guides live in the separate linksense-site repository.
    for (const route of [...paths, ...operationAnchors.map((anchor) => `deploy/operations/#${anchor}`)]) {
      const url = `${website}/doc/${localePath}${route}`
      assert.ok(targets.includes(url), `${file}: missing ${route}`)
    }
  }
})

test("manual Core installation keeps matching Linux and macOS commands with download-before-execution", async () => {
  const commands = (source) => [...source.matchAll(/```bash\n([\s\S]*?)```/gu)].map(([, block]) => block)
  const englishCommands = commands(await read("README.md"))
  assert.deepEqual(commands(await read("README.zh-CN.md")), englishCommands)
  assert.equal(englishCommands.length, 3)
  assert.equal(englishCommands[0].trim(), "docker version\ndocker compose version\ncurl --version")
  for (const command of englishCommands.slice(1)) {
    assert.match(command, /^curl --http1\.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \\\n/u)
    assert.match(command, /-o install-core\.sh https:\/\/raw\.githubusercontent\.com\/LingX-AI\/linksense\/main\/install-core\.sh && (?:sudo --preserve-env=\S+ )?sh install-core\.sh\n$/u)
  }
  assert.match(englishCommands[1], /sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy/u)
  assert.doesNotMatch(englishCommands[2], /sudo/u)
})

test("README memory, Docker requirements, and startup output match the installer", async () => {
  const installer = await read("deploy/release/linksense-installer.sh")
  const manifest = await read("scripts/generate-release-manifest.mjs")
  const memory = manifest.match(/CORE_MIN_MEMORY_GIB=(\d+)/u)?.[1]
  const api = installer.match(/^REQUIRED_DOCKER_API=([\d.]+)$/mu)?.[1]
  const compose = installer.match(/^REQUIRED_COMPOSE_VERSION=([\d.]+)$/mu)?.[1]
  const port = installer.match(/^HTTP_PORT=\$\{REQUESTED_HTTP_PORT:-(\d+)\}$/mu)?.[1]
  assert.ok(memory && api && compose && port)
  assert.ok(installer.includes("LinkSense is ready at:"))
  for (const file of ["README.md", "README.zh-CN.md"]) {
    const source = await read(file)
    for (const detail of [`${memory} GiB`, `API version ≥ ${api}`, `≥ ${compose}`, `http://localhost:${port}`, "LinkSense is ready at:", "x86-64-v2"]) {
      assert.ok(source.includes(detail), `${file}: missing ${detail}`)
    }
    assert.ok(source.includes(`:${port}\``))
  }
})
