import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"

import { consolidateUserToolHomes } from "../src/operations/shared-user-home-migration.js"

const roots: string[] = []
const ownerId = "01900000-0000-7000-8000-000000000211"
const ids = ["01900000-0000-7000-8000-000000000212", "01900000-0000-7000-8000-000000000213"]
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-tool-homes-")); roots.push(root)
  const home = path.join(root, ownerId, "home")
  const homes = ids.map(id => path.join(home, "task-homes", id))
  await Promise.all(homes.map(dir => mkdir(dir, { recursive: true })))
  return { root, home, homes, tasks: ids.map(conversationId => ({ ownerId, conversationId })) }
}
async function put(file: string, contents: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, contents, { mode: 0o600 })
}

it("previews and copies arbitrary tool state while retaining history, browser state and private modes", async () => {
  const f = await fixture()
  const source = path.join(f.homes[0]!, ".unknown-tool", "login.json")
  await put(source, "synthetic-session")
  await put(path.join(f.homes[0]!, ".codex", "sessions", "history.jsonl"), "history")
  await put(path.join(f.homes[0]!, ".local/share/linksense/browser/session"), "browser")
  await symlink("/unavailable-managed-projection", path.join(f.homes[0]!, ".agents"))
  const input = { userDataRoot: f.root, tasks: f.tasks }
  expect(await consolidateUserToolHomes({ ...input, dryRun: true })).toMatchObject({ units: 1, copied: 0, conflicts: [] })
  await expect(lstat(path.join(f.home, ".unknown-tool"))).rejects.toMatchObject({ code: "ENOENT" })
  expect(await consolidateUserToolHomes({ ...input, dryRun: false })).toMatchObject({ copied: 1 })
  const target = path.join(f.home, ".unknown-tool", "login.json")
  expect(await readFile(target, "utf8")).toBe("synthetic-session")
  expect((await lstat(target)).mode & 0o777).toBe(0o600)
  expect((await lstat(path.dirname(target))).mode & 0o777).toBe(0o700)
  expect(await readFile(source, "utf8")).toBe("synthetic-session")
  expect(await consolidateUserToolHomes({ ...input, dryRun: false })).toMatchObject({ copied: 0, unchanged: 1 })
  await expect(lstat(path.join(f.home, ".codex"))).rejects.toMatchObject({ code: "ENOENT" })
})

it("never combines conflicting accounts or overwrites an existing user login", async () => {
  const f = await fixture()
  await put(path.join(f.homes[0]!, ".config/tool/auth"), "synthetic-one")
  await put(path.join(f.homes[1]!, ".config/tool/auth"), "synthetic-two")
  await put(path.join(f.homes[0]!, ".other/auth"), "synthetic-other")
  const input = { userDataRoot: f.root, tasks: f.tasks }
  const preview = await consolidateUserToolHomes({ ...input, dryRun: true })
  expect(preview.conflicts).toEqual([{ ownerId, relativePath: ".config/tool", reason: "different_state" }])
  expect(JSON.stringify(preview)).not.toContain("synthetic-")
  await expect(consolidateUserToolHomes({ ...input, dryRun: false })).rejects.toThrow("MIGRATION_TOOL_STATE_CONFLICT")
  await expect(lstat(path.join(f.home, ".other"))).rejects.toMatchObject({ code: "ENOENT" })
  await rm(f.homes[1]!, { recursive: true })
  await put(path.join(f.home, ".config/tool/auth"), "synthetic-existing")
  await expect(consolidateUserToolHomes({ ...input, dryRun: false })).rejects.toThrow("MIGRATION_TOOL_STATE_CONFLICT")
  expect(await readFile(path.join(f.home, ".config/tool/auth"), "utf8")).toBe("synthetic-existing")
})

it("shares different XDG tools without merging a single tool's distinct state directories", async () => {
  const f = await fixture()
  await put(path.join(f.homes[0]!, ".config/first/auth"), "first")
  await put(path.join(f.homes[1]!, ".config/second/auth"), "second")
  await put(path.join(f.home, ".config/existing/auth"), "existing")
  await chmod(path.join(f.home, ".config"), 0o700)
  expect(await consolidateUserToolHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).toMatchObject({ copied: 2 })
  expect(await readFile(path.join(f.home, ".config/first/auth"), "utf8")).toBe("first")
  expect(await readFile(path.join(f.home, ".config/existing/auth"), "utf8")).toBe("existing")
  expect((await lstat(path.join(f.home, ".config"))).mode & 0o777).toBe(0o700)
})

it.each(["source", "target"])("rejects %s symlinks without following them or exposing contents", async (location) => {
  const f = await fixture()
  await put(path.join(f.homes[0]!, ".config/tool/auth"), "synthetic-auth")
  const external = path.join(f.root, "outside")
  await mkdir(external)
  const linked = location === "source" ? path.join(f.homes[0]!, ".config/tool/link") : path.join(f.home, ".config")
  await symlink(external, linked)
  await expect(consolidateUserToolHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).rejects.toThrow("MIGRATION_TOOL_PATH_INVALID")
  await expect(lstat(path.join(external, "tool"))).rejects.toMatchObject({ code: "ENOENT" })
})
