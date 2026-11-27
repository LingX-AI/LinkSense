import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const script = path.join(root, "deploy/docker/prune-production-deploy.sh")

function deployFixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "linksense-deploy-prune-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const modules = path.join(directory, "node_modules")
  const store = path.join(modules, ".pnpm")
  for (const entry of [
    "prisma@7.8.0",
    "@prisma+studio-core@0.27.3",
    "@prisma+dev@0.24.3",
    "@electric-sql+pglite@0.4.1",
    "@electric-sql+pglite-socket@0.1.1",
    "effect@3.20.0",
    "typescript@6.0.3",
    "@prisma+client@7.8.0",
    "@prisma+adapter-pg@7.8.0",
  ]) {
    mkdirSync(path.join(store, entry), { recursive: true })
  }
  symlinkSync(path.join(store, "prisma@7.8.0"), path.join(modules, "prisma"))
  symlinkSync(path.join(store, "typescript@6.0.3"), path.join(modules, "typescript"))
  symlinkSync(path.join(store, "@prisma+client@7.8.0"), path.join(modules, "client"))
  symlinkSync(path.join(store, "missing-package@1.0.0"), path.join(modules, "dangling"))
  for (const source of ["src", "test", "scripts"]) mkdirSync(path.join(directory, source))
  writeFileSync(path.join(directory, "vitest.config.ts"), "export {}\n")
  writeFileSync(path.join(directory, "package.json"), "{}\n")
  return { directory, modules, store }
}

test("production deploys drop build-time Prisma peers and dead sources but keep the client", t => {
  const { directory, modules, store } = deployFixture(t)
  const result = spawnSync("/bin/sh", [script, directory], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  for (const entry of [
    "prisma@7.8.0",
    "@prisma+studio-core@0.27.3",
    "@prisma+dev@0.24.3",
    "@electric-sql+pglite@0.4.1",
    "@electric-sql+pglite-socket@0.1.1",
    "effect@3.20.0",
    "typescript@6.0.3",
  ]) {
    assert.equal(existsSync(path.join(store, entry)), false, entry)
  }
  for (const entry of ["@prisma+client@7.8.0", "@prisma+adapter-pg@7.8.0"]) {
    assert.equal(existsSync(path.join(store, entry)), true, entry)
  }
  assert.equal(existsSync(path.join(modules, "prisma")), false)
  assert.equal(existsSync(path.join(modules, "typescript")), false)
  assert.equal(existsSync(path.join(modules, "client")), true)
  assert.equal(existsSync(path.join(modules, "dangling")), false)
  for (const source of ["src", "test", "scripts", "vitest.config.ts"]) {
    assert.equal(existsSync(path.join(directory, source)), false, source)
  }
  assert.equal(existsSync(path.join(directory, "package.json")), true)
})

test("production deploys reject a missing application tree", () => {
  const result = spawnSync("/bin/sh", [script, path.join(tmpdir(), "linksense-missing-deploy")], { encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing node_modules/u)
})

test("application Dockerfiles prune production deploys and the API baseline mounts uv", () => {
  const api = readFileSync(path.join(root, "deploy/docker/Dockerfile.api"), "utf8")
  const runner = readFileSync(path.join(root, "deploy/docker/Dockerfile.runner"), "utf8")
  const runtime = readFileSync(path.join(root, "deploy/baselines/Dockerfile.runtime"), "utf8")
  assert.match(api, /prune-production-deploy \/opt\/linksense-api/u)
  assert.match(api, /require\('\.\/dist\/generated\/prisma\/client\.js'\)/u)
  assert.match(runner, /prune-production-deploy \/opt\/linksense-runner[\s\S]*runner-runtime-smoke\.mjs/u)
  assert.match(runtime, /--mount=type=bind,from=uv,source=\/uv,target=\/usr\/local\/bin\/uv/u)
  assert.doesNotMatch(runtime, /COPY --from=uv \/uv \/usr\/local\/bin\/uv/u)
})
