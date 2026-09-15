import { isDeepStrictEqual } from "node:util";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const objectSchema = z.array(z.object({ type: z.string(), name: z.string(), sql: z.string().nullable() }));
const columnsSchema = z.array(z.object({ name: z.string(), pk: z.number() }));
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Offline only: SQLite VACUUM INTO makes a consistent compact copy, including WAL data.
 * Conflicting records or different native schemas require explicit operator review.
 * Never guess which account, queued input or Goal the user wants to retain. */
export async function mergeNativeDatabases(sourceHome: string, targetHome: string, options: { sourceIsTaskHome?: boolean } = {}): Promise<void> {
  for (const name of await readdir(sourceHome)) {
    if (!name.endsWith(".sqlite")) continue;
    // Log IDs are local auto-increment counters, not thread identities. The
    // directory converter archives these stores without opening damaged logs.
    if (/^logs_\d+\.sqlite$/u.test(name)) continue;
    const sourcePath = join(sourceHome, name);
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error("MIGRATION_NATIVE_PATH_INVALID");
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = await lstat(sourcePath + suffix).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (sidecar && (!sidecar.isFile() || sidecar.isSymbolicLink())) throw new Error("MIGRATION_NATIVE_PATH_INVALID");
    }
    const targetPath = join(targetHome, name);
    const temporary = targetPath + ".incoming";
    const source = new DatabaseSync(sourcePath, { readOnly: true, allowExtension: false });
    try { source.prepare("VACUUM INTO ?").run(temporary); } finally { source.close(); }
    try {
      if (!await lstat(targetPath).catch(error => { if (error.code === "ENOENT") return null; throw error; })) {
        await rename(temporary, targetPath);
        continue;
      }
      const incoming = new DatabaseSync(temporary, { readOnly: true, allowExtension: false });
      const target = new DatabaseSync(targetPath, { allowExtension: false });
      try {
        const schemaSql = "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name";
        const objects = objectSchema.parse(target.prepare(schemaSql).all());
        if (!isDeepStrictEqual(objects, objectSchema.parse(incoming.prepare(schemaSql).all()))) throw new Error("MIGRATION_NATIVE_SCHEMA_CONFLICT", { cause: { sourceHome, name } });
        target.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=OFF; PRAGMA journal_mode=DELETE; BEGIN");
        // Native triggers must not turn a copied queue/history record into new work.
        const triggers = objects.filter(object => object.type === "trigger");
        for (const trigger of triggers) target.exec(`DROP TRIGGER ${quote(trigger.name)}`);
        for (const table of objects.filter(object => object.type === "table")) {
          // These cursors describe scans of one physical HOME. The target keeps
          // its own cursor; every original store is retained in the import archive.
          if (name === "state_5.sqlite" && ["backfill_state", "rollout_migration_state", "rollout_migration_skipped_rollouts"].includes(table.name)) continue;
          if (name === "queue_1.sqlite" && table.name === "queued_thread_revisions" &&
            target.prepare("SELECT count(*) AS n FROM queued_items").get()?.n === 0 &&
            incoming.prepare("SELECT count(*) AS n FROM queued_items").get()?.n === 0) continue;
          const columns = columnsSchema.parse(incoming.prepare(`PRAGMA table_info(${quote(table.name)})`).all());
          const primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk);
          const names = columns.map(column => column.name);
          const key = primary.length ? primary.map(column => column.name) : names;
          const find = target.prepare(`SELECT * FROM ${quote(table.name)} WHERE ${key.map(name => `${quote(name)} IS ?`).join(" AND ")}`);
          const insert = target.prepare(`INSERT INTO ${quote(table.name)} (${names.map(quote).join(",")}) VALUES (${names.map(() => "?").join(",")})`);
          for (const row of incoming.prepare(`SELECT * FROM ${quote(table.name)}`).iterate()) {
            const existing = find.get(...key.map(name => row[name] as SQLInputValue));
            if (existing) {
              if (name === "memories_1.sqlite" && table.name === "jobs" && row.kind === "memory_consolidate_global" && row.job_key === "global") continue;
              const ignored = table.name === "_sqlx_migrations" ? ["installed_on", "execution_time"] : [];
              const comparable = (value: typeof row) => Object.fromEntries(Object.entries(value).filter(([name]) => !ignored.includes(name)));
              if (!isDeepStrictEqual(comparable(existing), comparable(row))) {
                const fields = names.filter(name => !ignored.includes(name) && !isDeepStrictEqual(existing[name], row[name]));
                const sameRollout = fields.length === 1 && fields[0] === "rollout_path" &&
                  typeof row.rollout_path === "string" && typeof existing.rollout_path === "string" &&
                  /(?:^|\/)((?:sessions|archived_sessions)\/.+\.jsonl)$/u.exec(row.rollout_path)?.[1] ===
                    /(?:^|\/)((?:sessions|archived_sessions)\/.+\.jsonl)$/u.exec(existing.rollout_path)?.[1] &&
                  /(?:^|\/)(?:sessions|archived_sessions)\/.+\.jsonl$/u.test(row.rollout_path);
                // The former shared HOME is an earlier copy. A task's dedicated
                // store is its authoritative current row, provided it is newer.
                if (options.sourceIsTaskHome && name === "state_5.sqlite" && table.name === "threads" &&
                  typeof row.updated_at_ms === "number" && typeof existing.updated_at_ms === "number" &&
                  (row.updated_at_ms > existing.updated_at_ms || (row.updated_at_ms === existing.updated_at_ms && sameRollout))) {
                  target.prepare(`UPDATE ${quote(table.name)} SET ${names.map(name => `${quote(name)} = ?`).join(",")} WHERE ${key.map(name => `${quote(name)} IS ?`).join(" AND ")}`)
                    .run(...names.map(name => row[name] as SQLInputValue), ...key.map(name => row[name] as SQLInputValue));
                } else throw new Error("MIGRATION_NATIVE_RECORD_CONFLICT", { cause: { sourceHome, name, table: table.name, fields } });
              }
            } else insert.run(...names.map(name => row[name] as SQLInputValue));
          }
        }
        for (const trigger of triggers) {
          if (!trigger.sql) throw new Error("MIGRATION_NATIVE_SCHEMA_CONFLICT");
          target.exec(trigger.sql);
        }
        target.exec("COMMIT");
        if (target.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("MIGRATION_NATIVE_INTEGRITY_FAILED");
      } finally { incoming.close(); target.close(); }
    } finally { await rm(temporary, { force: true }); }
  }
}

export function rewriteNativeRolloutPaths(codexHome: string, nativeHome: string, exists: boolean): void {
  if (!exists) return;
  const database = new DatabaseSync(join(codexHome, "state_5.sqlite"), { allowExtension: false });
  try {
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'").get()) return;
    const rows = z.array(z.object({ id: z.string(), rollout_path: z.string() })).parse(database.prepare("SELECT id, rollout_path FROM threads").all());
    const update = database.prepare("UPDATE threads SET rollout_path = ? WHERE id = ?");
    database.exec("BEGIN");
    for (const row of rows) {
      const suffix = /(?:^|\/)((?:sessions|archived_sessions)\/[^\0]+\.jsonl)$/u.exec(row.rollout_path)?.[1];
      if (!suffix || suffix.split("/").includes("..")) throw new Error("MIGRATION_NATIVE_PATH_INVALID");
      update.run(`${nativeHome}/.codex/${suffix}`, row.id);
    }
    database.exec("COMMIT");
  } finally { database.close(); }
}
