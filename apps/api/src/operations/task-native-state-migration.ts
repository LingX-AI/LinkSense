import { createHash } from "node:crypto"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import { backup, DatabaseSync } from "node:sqlite"
import { z } from "zod"

// Verified against Codex 0.150.1. This module is imported only by the offline
// migration command; application execution never reads or edits native SQLite.
const stores: Record<string, Record<string, string[]>> = {
  "goals_1.sqlite": {
    thread_goals: ["thread_id"],
    thread_goal_continuation_deferrals: ["thread_id"],
  },
  "memories_1.sqlite": { stage1_outputs: ["thread_id"], jobs: [] },
  "queue_1.sqlite": {
    queued_items: ["thread_id"], queued_thread_revisions: ["thread_id"],
  },
  "state_5.sqlite": {
    threads: ["id"], thread_dynamic_tools: ["thread_id"],
    thread_spawn_edges: ["parent_thread_id", "child_thread_id"],
    thread_artifacts: ["thread_id"],
    backfill_state: [], remote_control_enrollments: [],
    external_agent_config_imports: [], thread_sections: [],
    rollout_migration_state: [], rollout_migration_skipped_rollouts: [],
    projects: [], project_roots: [], project_idempotency_keys: [],
  },
}
const nativeTriggerHashes: Record<string, string> = {
  "queued_items_revision_after_insert": "f46950a026bb2b469ddcaa4eb7fb571b81bf677cdd6a0f2fac3296b6be53321b",
  "queued_items_revision_after_update": "ea686295126ec94453f2e86b482b024a4ed850f84541c534f6d467af9200abe8",
  "queued_items_revision_after_delete": "c9ff34ff13416354fdcaf71172c41495e49468fd334dfbce3dbac002fd65a648",
  "threads_created_at_ms_after_insert": "a2d069cabb0396cf00fe2275fdbd19cb259231a1aea82ecc3edf4935fd8d7c5c",
  "threads_updated_at_ms_after_insert": "46df6b8634993fad2bb6b9243c6eccb696eb659fb304039d5d9f5f95c2267fa1",
  "threads_created_at_ms_after_update": "4508e1771b42e6a9e4332fefdf16c1f8960f74d3d298f718b28ef928875e5e76",
  "threads_updated_at_ms_after_update": "4d54241e85f63e2c7db6ab7454238f367ebc89501ebfacad8bc790fdaf508595",
  "threads_recency_at_after_insert": "f8b489d82385b398c81354d7aeb0041164ea33e1f800be327708190ee83cf276",
}
const tableSchema = z.array(z.object({ name: z.string(), type: z.string(), sql: z.string().nullable() }))

export async function stageTaskNativeState(input: {
  sourceHome: string
  stagingRoot: string
  threadIds: string[]
  nativeCodexHome: string
}): Promise<Array<{ source: string; name: string }>> {
  if (!input.threadIds.length || !await inspect(input.sourceHome)) return []
  for (const name of await readdir(input.sourceHome)) {
    if (/^(?:state|goals|memories|queue)_\d+\.sqlite$/u.test(name) && !Object.hasOwn(stores, name)) throw new Error("MIGRATION_NATIVE_SCHEMA_UNSUPPORTED")
  }
  const result: Array<{ source: string; name: string }> = []
  for (const [name, policies] of Object.entries(stores)) {
    const source = path.join(input.sourceHome, name)
    const info = await inspect(source)
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID")
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = await inspect(`${source}${suffix}`)
      if (sidecar && (!sidecar.isFile() || sidecar.isSymbolicLink())) throw new Error("MIGRATION_PATH_INVALID")
    }
    const target = path.join(input.stagingRoot, name)
    const original = new DatabaseSync(source, { readOnly: true, allowExtension: false, timeout: 5_000 })
    try { await backup(original, target) } finally { original.close() }
    const staged = new DatabaseSync(target, { allowExtension: false, timeout: 5_000 })
    try {
      const objects = tableSchema.parse(staged.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'trigger', 'view')").all())
      if (objects.some((entry) => {
        if (entry.type === "trigger") return nativeTriggerHashes[entry.name] !== createHash("sha256").update(entry.sql ?? "").digest("hex")
        return entry.type !== "table" || (!entry.name.startsWith("sqlite_") && entry.name !== "_sqlx_migrations" && !Object.hasOwn(policies, entry.name))
      })) {
        throw new Error("MIGRATION_NATIVE_SCHEMA_UNSUPPORTED")
      }
      // Filtering applies only to a private scratch backup. VACUUM removes
      // discarded rows from free pages before the task receives the file.
      staged.exec("PRAGMA foreign_keys=OFF; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; BEGIN")
      staged.exec("CREATE TEMP TABLE retained_threads (id TEXT PRIMARY KEY)")
      const keep = staged.prepare("INSERT INTO retained_threads VALUES (?)")
      for (const id of new Set(input.threadIds)) keep.run(id)
      const names = new Set(objects.map((entry) => entry.name))
      for (const [table, columns] of Object.entries(policies)) {
        if (!names.has(table)) continue
        const where = columns.length ? ` WHERE ${columns.map((column) => `"${column}" NOT IN (SELECT id FROM retained_threads)`).join(" OR ")}` : ""
        staged.exec(`DELETE FROM "${table}"${where}`)
      }
      if (names.has("threads")) {
        const rows = z.array(z.object({ id: z.string(), rollout_path: z.string() })).parse(staged.prepare("SELECT id, rollout_path FROM threads").all())
        const update = staged.prepare("UPDATE threads SET rollout_path = ? WHERE id = ?")
        for (const row of rows) {
          const match = /(?:^|\/)((?:sessions|archived_sessions)\/[^\0]+\.jsonl)$/u.exec(row.rollout_path)
          if (!match?.[1] || match[1].split("/").some((segment) => segment === "..")) throw new Error("MIGRATION_PATH_INVALID")
          update.run(path.posix.join(input.nativeCodexHome, match[1]), row.id)
        }
        const columns = z.array(z.object({ name: z.string() })).parse(staged.prepare("PRAGMA table_info(threads)").all())
        for (const column of ["project_id", "thread_section_id"]) {
          if (columns.some((entry) => entry.name === column)) staged.exec(`UPDATE threads SET "${column}" = NULL`)
        }
      }
      staged.exec("COMMIT; VACUUM")
      const integrity = staged.prepare("PRAGMA integrity_check").get()
      if (integrity?.integrity_check !== "ok") throw new Error("MIGRATION_NATIVE_STATE_INVALID")
    } finally { staged.close() }
    result.push({ source: target, name })
  }
  return result
}

async function inspect(target: string) {
  try { return await lstat(target) } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}
