import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const editions = ["core", "full"]
const suffixes = ["", ".zh-CN"]
const files = suffixes.flatMap((suffix) => [
  `README${suffix}.md`, `docs/architecture${suffix}.md`, `docs/capabilities${suffix}.md`,
  `docs/product-guide${suffix}.md`, `docs/license-guide${suffix}.md`,
  ...[...editions, "operations", "development"].map((name) => `docs/setup/${name}${suffix}.md`),
])
const read = (file) => readFile(path.join(root, file), "utf8").then((text) => text.replaceAll("\r\n", "\n"))
const commands = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/gu)]
  .map(([, block]) => block.replace(/^\s*#.*\n/gmu, ""))

test("both READMEs retain the description and route to separate edition guides", async () => {
  for (const suffix of suffixes) {
    const source = await read(`README${suffix}.md`)
    assert.ok(source.includes(suffix ? "面向组织的开源Agent工作平台" : "Open-source agentic work platform for organizations."))
    for (const name of [...editions, "operations", "development"]) assert.ok(source.includes(`./docs/setup/${name}${suffix}.md`))
    assert.ok(source.includes(`./docs/architecture${suffix}.md`))
    assert.doesNotMatch(source, /curl --|pnpm dev:prepare/u)
    for (const file of ["LICENSE-EXCEPTIONS.md", "ATTRIBUTION.md", "TRADEMARK.md", "THIRD-PARTY-NOTICES.md", "ADOPTERS.md", "CLA.md"]) assert.ok(source.includes(`./${file}`))
  }
})

test("edition guides isolate installers and preserve download-before-execution", async () => {
  for (const edition of editions) {
    const english = await read(`docs/setup/${edition}.md`)
    const chinese = await read(`docs/setup/${edition}.zh-CN.md`)
    assert.deepEqual(commands(chinese), commands(english))
    const blocks = commands(english)
    assert.equal(blocks.length, 2)
    for (const block of blocks) {
      assert.match(block, /curl --http1\.1 --retry 3/u)
      assert.ok(block.includes(`https://raw.githubusercontent.com/LingX-AI/linksense/main/install-${edition}.sh && `))
      assert.ok(block.includes(`sh install-${edition}.sh`))
      assert.doesNotMatch(block, /\n\+/u)
      assert.ok(!block.includes(`install-${edition === "core" ? "full" : "core"}.sh`))
    }
    assert.match(blocks[0], /sudo --preserve-env=/u)
    assert.doesNotMatch(blocks[1], /sudo/u)
  }
})

test("resource floors agree with the current release manifest generator", async () => {
  const manifest = await read("scripts/generate-release-manifest.mjs")
  const core = manifest.match(/CORE_MIN_MEMORY_GIB=(\d+)/u)?.[1]
  const full = manifest.match(/RESOURCE_FULL_FRESH_MIN_MEMORY_GIB=(\d+)/u)?.[1]
  assert.ok(core && full)
  for (const suffix of suffixes) {
    const readme = await read(`README${suffix}.md`)
    assert.ok(readme.includes(`${core}+ GiB`))
    assert.ok(readme.includes(`${full}+ GiB`))
  }
  assert.ok((await read("Install.md")).includes(`${core} GiB usable memory for Core or ${full} GiB`))
})

test("reference material preserves bilingual commands, diagrams and execution boundaries", async () => {
  for (const name of ["operations", "development"]) assert.deepEqual(commands(await read(`docs/setup/${name}.zh-CN.md`)), commands(await read(`docs/setup/${name}.md`)))
  for (const suffix of suffixes) {
    const readme = await read(`README${suffix}.md`)
    const architecture = await read(`docs/architecture${suffix}.md`)
    const operations = await read(`docs/setup/operations${suffix}.md`)
    const capabilities = await read(`docs/capabilities${suffix}.md`)
    const product = await read(`docs/product-guide${suffix}.md`)
    for (const name of ["organizational-capability-lifecycle", "application-composition", "finance-application", "open-capability-layer", "system-architecture", "realtime-execution-path", "event-delivery", "skill-directory-structure", "plugin-package-structure"]) assert.ok((readme + architecture + capabilities + product).includes(`/diagrams/${name}.svg`), name)
    assert.ok(architecture.includes("approvalPolicy: never"))
    assert.ok(architecture.includes("CODEX_HOME"))
    for (const detail of ["v1.45+", "v2.24.4+", "linksense status", "linksense doctor --network", "linksense upgrade", "volume://linksense-backups/postgres/", "x86-64-v2", "host-passthrough", "Fatal glibc error: CPU does not support x86-64-v2"]) assert.ok(operations.includes(detail), detail)
  }
})

const slug = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replaceAll(" ", "-")
test("local navigation and images resolve, including relocated heading anchors", async () => {
  for (const file of [...files, "Install.md", "deploy/production/README.md"]) {
    const source = await read(file)
    const links = [
      ...[...source.matchAll(/\]\(([^\s)]+)\)/gu)].map(([, target]) => target),
      ...[...source.matchAll(/(?:src|href)="([^"\s]+)"/gu)].map(([, target]) => target),
    ]
    for (const target of links) {
      if (/^[a-z]+:/iu.test(target) || target === "../../discussions") continue
      const [pathname, anchor] = target.split("#")
      const destination = pathname ? path.resolve(path.dirname(path.join(root, file)), pathname) : path.join(root, file)
      await access(destination)
      if (anchor && destination.endsWith(".md") && !/^L\d/u.test(anchor)) {
        const content = await readFile(destination, "utf8")
        const anchors = [...content.matchAll(/^#{1,6} (.+)$/gmu)].map(([, title]) => slug(title.trim()))
        assert.ok(anchors.includes(decodeURIComponent(anchor)), `${file}: unresolved ${target}`)
      }
    }
  }
})

test("installation and development addresses match their configurations", async () => {
  const installer = await read("deploy/release/linksense-installer.sh")
  const environment = await read(".env.example")
  const port = installer.match(/^HTTP_PORT=\$\{REQUESTED_HTTP_PORT:-(\d+)\}$/mu)?.[1]
  assert.ok(port)
  for (const suffix of suffixes) {
    const readme = await read(`README${suffix}.md`)
    assert.ok(readme.includes(`http://localhost:${port}`))
    assert.ok(readme.includes(`http://<server-address>:${port}`))
    const development = await read(`docs/setup/development${suffix}.md`)
    for (const [name, protocol] of [["LINKSENSE_DEV_WEB_PORT", "http"], ["LINKSENSE_DEV_WEB_HTTPS_PORT", "https"], ["LINKSENSE_DEV_API_PORT", "http"], ["LINKSENSE_DEV_RUNNER_PORT", "http"]]) {
      const value = environment.match(new RegExp(`^${name}=(\\d+)$`, "mu"))?.[1]
      assert.ok(value)
      assert.ok(development.includes(`${protocol}://localhost:${value}`))
    }
  }
})
