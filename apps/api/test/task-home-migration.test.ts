import { mkdir, mkdtemp, readFile, readdir, rm, symlink, chmod, writeFile, lstat } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { migrateTaskCodexHomes } from "../src/operations/task-home-migration.js"

const ownerId = "01900000-0000-7000-8000-000000000001"
const taskA = "01900000-0000-7000-8000-000000000002"
const taskB = "01900000-0000-7000-8000-000000000003"
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-task-migration-")); roots.push(root)
  const source = join(root, ownerId, "home", ".codex", "sessions", "2026", "09", "08", "rollout-thread-a.jsonl")
  const target = join(root, ownerId, "home", "task-homes", taskA, ".codex", "sessions", "2026", "09", "08", "rollout-thread-a.jsonl")
  await mkdir(dirname(source), { recursive: true })
  const contents = `${JSON.stringify({ type: "session_meta", payload: { id: "thread-a", cwd: `/home/linksense/workspaces/${taskA}` } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })}\n`
  await writeFile(source, contents)
  return { root, source, target, contents, tasks: [{ ownerId, conversationId: taskA, nativeThreadIds: ["thread-a"] }] }
}
describe("offline task CODEX_HOME migration", () => {
  it("copies only each task's native history, preserves ids and leaves the legacy source unchanged", async () => {
    const f = await fixture()
    const other = join(dirname(f.source), "rollout-thread-b.jsonl")
    await writeFile(other, `${JSON.stringify({ type: "session_meta", payload: { id: "thread-b", cwd: `/home/linksense/workspaces/${taskB}` } })}\n`)
    const input = { userDataRoot: f.root, tasks: f.tasks, dryRun: false }
    await expect(migrateTaskCodexHomes(input)).resolves.toMatchObject({ copied: 1, files: 1 })
    expect(await readFile(f.target, "utf8")).toBe(f.contents)
    expect(await readFile(f.source, "utf8")).toBe(f.contents)
    expect(await readdir(dirname(f.target))).toEqual(["rollout-thread-a.jsonl"])
    expect((await lstat(f.target)).mode & 0o777).toBe(0o600)
    await expect(migrateTaskCodexHomes(input)).resolves.toMatchObject({ copied: 0, unchanged: 1 })
  })
  it("repairs permissions on matching history left by a previous copy", async () => {
    const f = await fixture()
    await mkdir(dirname(f.target), { recursive: true })
    await writeFile(f.target, f.contents)
    await chmod(f.target, 0o644)
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).resolves.toMatchObject({ unchanged: 1 })
    expect((await lstat(f.target)).mode & 0o777).toBe(0o600)
  })
  it("keeps a dry run read-only", async () => {
    const f = await fixture()
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: true })).resolves.toMatchObject({ files: 1, copied: 0 })
    await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("refuses a missing historical thread before copying any task", async () => {
    const f = await fixture()
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: [...f.tasks, { ownerId, conversationId: taskB, nativeThreadIds: ["missing"] }], dryRun: false })).rejects.toThrow("MIGRATION_NATIVE_THREAD_MISSING")
    await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("never overwrites different history already present in the target", async () => {
    const f = await fixture()
    await mkdir(dirname(f.target), { recursive: true }); await writeFile(f.target, "existing task state")
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).rejects.toThrow("MIGRATION_TARGET_CONFLICT")
    expect(await readFile(f.target, "utf8")).toBe("existing task state")
  })
  it("rejects a symlink to another task or user directory", async () => {
    const f = await fixture()
    const external = join(f.root, "outside"); await mkdir(external)
    await symlink(external, join(f.root, ownerId, "home", "task-homes"))
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).rejects.toThrow("MIGRATION_PATH_INVALID")
    expect(await readdir(external)).toEqual([])
  })
  it("retires shared discovery paths into private control storage and is restartable", async () => {
    const f = await fixture()
    const legacy = join(f.root, ownerId, "managed/agents/skills")
    const backup = join(f.root, ownerId, "control/task-home-migration-backup/skills")
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, "old-skill.md"), "legacy skill")
    await migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: true })
    expect(await readFile(join(legacy, "old-skill.md"), "utf8")).toBe("legacy skill")
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).resolves.toMatchObject({ retired: 1 })
    await expect(lstat(legacy)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(join(backup, "old-skill.md"), "utf8")).toBe("legacy skill")
    expect((await lstat(dirname(backup))).mode & 0o777).toBe(0o700)
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).resolves.toMatchObject({ retired: 0, unchanged: 1 })
  })
  it("rejects conflicting legacy backups before copying any history", async () => {
    const f = await fixture()
    await mkdir(join(f.root, ownerId, "managed/agents/skills"), { recursive: true })
    await mkdir(join(f.root, ownerId, "control/task-home-migration-backup/skills"), { recursive: true })
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).rejects.toThrow("MIGRATION_BACKUP_CONFLICT")
    await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("preserves native Goal ids, budgets and usage without carrying another task's Goal", async () => {
    const f = await fixture()
    const source = join(f.root, ownerId, "home/.codex/goals_1.sqlite")
    const db = new DatabaseSync(source)
    db.exec("CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY, goal_id TEXT, objective TEXT, status TEXT, token_budget INTEGER, tokens_used INTEGER); CREATE TABLE thread_goal_continuation_deferrals (thread_id TEXT PRIMARY KEY)")
    db.prepare("INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?)").run("thread-a", "goal-a", "Preserve this goal", "paused", 100000, 12345)
    db.prepare("INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?)").run("thread-b", "goal-b", "Do not copy", "complete", 10, 5)
    db.exec("INSERT INTO thread_goal_continuation_deferrals VALUES ('thread-a'), ('thread-b')")
    db.close()
    const input = { userDataRoot: f.root, tasks: f.tasks, dryRun: false }
    await expect(migrateTaskCodexHomes(input)).resolves.toMatchObject({ copied: 2 })
    const target = join(f.root, ownerId, "home/task-homes", taskA, ".codex/goals_1.sqlite")
    const migrated = new DatabaseSync(target, { readOnly: true })
    try {
      expect(migrated.prepare("SELECT * FROM thread_goals").all()).toEqual([{ thread_id: "thread-a", goal_id: "goal-a", objective: "Preserve this goal", status: "paused", token_budget: 100000, tokens_used: 12345 }])
      expect(migrated.prepare("SELECT * FROM thread_goal_continuation_deferrals").all()).toEqual([{ thread_id: "thread-a" }])
    } finally { migrated.close() }
    await expect(migrateTaskCodexHomes(input)).resolves.toMatchObject({ copied: 0, unchanged: 2 })
    const original = new DatabaseSync(source, { readOnly: true })
    try { expect(original.prepare("SELECT * FROM thread_goals").all()).toHaveLength(2) } finally { original.close() }
  }, 20_000)
  it("refuses an unrecognized native database schema before writing task history", async () => {
    const f = await fixture()
    const db = new DatabaseSync(join(f.root, ownerId, "home/.codex/goals_1.sqlite"))
    db.exec("CREATE TABLE unknown_native_state (id TEXT)")
    db.close()
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).rejects.toThrow("MIGRATION_NATIVE_SCHEMA_UNSUPPORTED")
    await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("includes native subagent rollouts belonging to the same workspace", async () => {
    const f = await fixture()
    await writeFile(join(dirname(f.source), "rollout-child.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "child", cwd: `/home/linksense/workspaces/${taskA}` } })}\n`)
    await expect(migrateTaskCodexHomes({ userDataRoot: f.root, tasks: f.tasks, dryRun: false })).resolves.toMatchObject({ copied: 2 })
  })
})
