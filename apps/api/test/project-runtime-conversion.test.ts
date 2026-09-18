import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageProjectHomes, type ConversionTask } from "../src/operations/project-home-conversion.js";
import { mergeNativeDatabases } from "../src/operations/native-home-merge.js";
import { assertRuntimeLayoutReady } from "../src/operations/runtime-layout-readiness.js";
import { convertProjectRuntime, recoverProjectConversion } from "../src/operations/project-runtime-conversion.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-project-conversion-")); roots.push(root);
  const source = join(root, "users"), stage = join(root, "stage"), owner = randomUUID(), project = randomUUID();
  await mkdir(source);
  const tasks: ConversionTask[] = [0, 1, 2].map(index => {
    const id = randomUUID();
    return { id, ownerId: owner, projectId: index < 2 ? project : null, applicationId: index === 2 ? randomUUID() : null,
      workspaceRelPath: `${owner}/home/workspaces/${id}`, nativeThreadIds: [randomUUID()] };
  });
  for (const task of tasks) {
    const workspace = join(source, task.workspaceRelPath), home = join(source, owner, "home", "task-homes", task.id);
    await mkdir(join(workspace, "attachments"), { recursive: true });
    await writeFile(join(workspace, "attachments", "report.txt"), task.id);
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    const rollout = `sessions/${task.nativeThreadIds[0]}.jsonl`;
    await writeFile(join(home, ".codex", rollout), JSON.stringify({ type: "session_meta", payload: { id: task.nativeThreadIds[0] } }) + "\n");
    const db = new DatabaseSync(join(home, ".codex", "state_5.sqlite"));
    db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)");
    db.prepare("INSERT INTO threads VALUES (?, ?)").run(task.nativeThreadIds[0]!, `/home/linksense/task-homes/${task.id}/.codex/${rollout}`);
    db.close();
    const control = join(source, owner, "control", "workspaces", task.id);
    await mkdir(control, { recursive: true }); await writeFile(join(control, "runtime-generation"), "preserved-generation");
  }
  return { root, source, stage, owner, project, tasks };
}

describe("offline project conversion", () => {
  it("requires partly accepted starts to settle before staging or changing history", async () => {
    const f = await fixture();
    const prisma = { conversationTurn: { count: vi.fn(async () => 0) }, conversationTurnStartIntent: { count: vi.fn(async () => 1) } };
    await expect(convertProjectRuntime({ prisma: prisma as never, userDataRoot: f.source, capabilityRoot: join(f.source, ".capabilities"), backupRoot: join(f.root, "backup"), apply: true })).rejects.toThrow("MIGRATION_ACTIVE_TASKS");
    expect(await readdir(f.root)).not.toContain("backup");
    expect(await readdir(join(f.source, f.owner, "home"))).toContain("task-homes");
  });

  it("merges personal native sessions, keeps service sessions separate and preserves same-name project files and control state", async () => {
    const f = await fixture();
    const result = await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks });
    expect(result[0]?.workspace).toBe(result[1]?.workspace);
    expect(result[2]?.workspace).toContain(`/services/${f.tasks[2]!.id}/`);
    for (const task of result) {
      expect(await readFile(join(f.stage, task.workspace, task.importedDirectory, "attachments/report.txt"), "utf8")).toBe(task.id);
      expect(await readFile(join(f.source, task.oldWorkspace, "attachments/report.txt"), "utf8")).toBe(task.id);
      const scope = task.workspace.split("/home/")[0]!;
      expect(await readFile(join(f.stage, scope, "control/workspaces", task.id, "runtime-generation"), "utf8")).toBe("preserved-generation");
      expect(await readFile(join(f.stage, scope, "control/workspaces", task.id, "workspace.json"), "utf8")).toBe(JSON.stringify(task.workspace.split("/home/")[1]));
    }
    const personal = new DatabaseSync(join(f.stage, f.owner, "home/.codex/state_5.sqlite"));
    try {
      const rows = personal.prepare("SELECT id, rollout_path FROM threads ORDER BY id").all();
      expect(rows.map(row => row.id).sort()).toEqual(f.tasks.slice(0, 2).map(task => task.nativeThreadIds[0]).sort());
      expect(rows.every(row => String(row.rollout_path).startsWith("/home/linksense/.codex/sessions/"))).toBe(true);
    } finally { personal.close(); }
    expect(await readdir(join(f.stage, f.owner, "home"))).not.toContain("task-homes");
    expect(await readdir(join(f.stage, f.owner, "home"))).not.toContain("workspaces");
  });

  it("rejects different account profiles before changing either source", async () => {
    const f = await fixture();
    const first = join(f.source, f.owner, "home/task-homes", f.tasks[0]!.id, ".login");
    const second = join(f.source, f.owner, "home/task-homes", f.tasks[1]!.id, ".login");
    await writeFile(first, "fixture-profile-a"); await writeFile(second, "fixture-profile-b");
    await expect(stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks })).rejects.toThrow("MIGRATION_FILE_CONFLICT");
    expect(await readFile(first, "utf8")).toBe("fixture-profile-a"); expect(await readFile(second, "utf8")).toBe("fixture-profile-b");
  });

  it("archives per-process logs and installation identities while merging portable native settings", async () => {
    const f = await fixture();
    for (const [index, task] of f.tasks.entries()) {
      const native = join(f.source, f.owner, "home/task-homes", task.id, ".codex");
      await writeFile(join(native, "logs_2.sqlite"), `damaged legacy log ${index}`);
      await writeFile(join(native, "installation_id"), `installation-${index}`);
      await writeFile(join(native, "AGENTS.md"), `<!-- linksense-personalization:v1 revision:${randomUUID()} -->\nKeep these personal instructions.\n`);
      await mkdir(join(native, "memories/.git"), { recursive: true });
      await writeFile(join(native, "memories/MEMORY.md"), `Rendered memory ${index}`);
      await writeFile(join(native, "memories/.git/HEAD"), `baseline-${index}`);
      await writeFile(join(native, "config.toml"), `[model_providers.link-sense]\nbase_url="http://127.0.0.1:${4000 + index}"\n[projects."/project-${index}"]\ntrust_level="trusted"\n[skills]\ninclude_instructions=${index === 0}\n[skills.bundled]\nenabled=${index === 0}\n[marketplaces.linksense-personal]\nsource="/old-task-${index}"\n[plugins."managed@linksense-personal"]\nenabled=${index === 0}\n[plugins."custom@private"]\nenabled=true\n`);
    }
    await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks });
    const home = join(f.stage, f.owner, "home");
    const config = parse(await readFile(join(home, ".codex/config.toml"), "utf8"));
    expect(config.projects).toEqual({ "/project-0": { trust_level: "trusted" }, "/project-1": { trust_level: "trusted" } });
    const template = parse(await readFile(new URL("../../../deploy/codex-home-template/config.toml", import.meta.url), "utf8"));
    expect(config.model_providers).toEqual(template.model_providers);
    expect(config.skills).toEqual({ bundled: {} });
    expect(config.marketplaces).toEqual({});
    expect(config.plugins).toEqual({ "custom@private": { enabled: true } });
    expect(await readFile(join(home, ".codex/AGENTS.md"), "utf8")).toContain("Keep these personal instructions.");
    expect(await readFile(join(home, ".codex/installation_id"), "utf8")).toBe("installation-0");
    expect(await readdir(join(home, ".codex"))).not.toContain("logs_2.sqlite");
    expect(await readFile(join(home, ".codex/memories/MEMORY.md"), "utf8")).toBe("Rendered memory 0");
    expect(await readFile(join(home, ".codex/memories/.git/HEAD"), "utf8")).toBe("baseline-0");
    const archives = join(f.stage, f.owner, "control/native-home-imports");
    const logs = await Promise.all((await readdir(archives)).map(name => readFile(join(archives, name, "logs_2.sqlite"), "utf8")));
    expect(logs.sort()).toEqual(["damaged legacy log 0", "damaged legacy log 1"]);
    const memories = await Promise.all((await readdir(archives)).map(name => readFile(join(archives, name, "memories/MEMORY.md"), "utf8")));
    expect(memories.sort()).toEqual(["Rendered memory 0", "Rendered memory 1"]);
  });

  it("rejects conflicting private MCP settings instead of choosing an account", async () => {
    const f = await fixture();
    for (const [index, task] of f.tasks.entries()) await writeFile(join(f.source, f.owner, "home/task-homes", task.id, ".codex/config.toml"), `[mcp_servers.personal]\nurl="https://example.test/account-${index}"\n`);
    await expect(stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks })).rejects.toThrow("MIGRATION_NATIVE_CONFIG_CONFLICT");
  });

  it("keeps migrated personal and application homes usable by native plugin commands without process overrides", async () => {
    const f = await fixture();
    const template = parse(await readFile(new URL("../../../deploy/codex-home-template/config.toml", import.meta.url), "utf8"));
    const sources = await Promise.all(f.tasks.map(async (task, index) => {
      const source = `model_provider="link-sense"\n[model_providers.link-sense]\nname="LinkSense"\nbase_url="http://127.0.0.1:${4000 + index}"\nwire_api="responses"\nexperimental_bearer_token="expired-process-token-${index}"\n[model_providers.private]\nname="Private"\nbase_url="https://example.test/v1"\nwire_api="responses"\nenv_key="PRIVATE_PROVIDER_TOKEN"\n`;
      await writeFile(join(f.source, f.owner, "home/task-homes", task.id, ".codex/config.toml"), source);
      return source;
    }));

    const result = await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks });
    for (const task of result) {
      const scope = task.workspace.split("/home/")[0]!;
      const config = parse(await readFile(join(f.stage, scope, "home/.codex/config.toml"), "utf8"));
      expect(config.model_provider).toBe("link-sense");
      expect(config).toMatchObject({ model_providers: template.model_providers });
      expect(config.model_providers).toHaveProperty("private", { name: "Private", base_url: "https://example.test/v1", wire_api: "responses", env_key: "PRIVATE_PROVIDER_TOKEN" });
      expect(JSON.stringify(config)).not.toContain("expired-process-token");
      const archives = join(f.stage, scope, "control/native-home-imports");
      const originals = await Promise.all((await readdir(archives)).map(name => readFile(join(archives, name, "config.toml"), "utf8")));
      expect(originals).toContain(sources[f.tasks.findIndex(source => source.id === task.id)]);
    }
  });

  it.each(["link-sense", "private"])("preserves the selected %s provider when its configuration has no managed provider table", async selected => {
    const f = await fixture();
    const original = `model_provider="${selected}"\n[model_providers.private]\nname="Private"\nbase_url="https://example.test/v1"\nwire_api="responses"\n`;
    for (const task of f.tasks) await writeFile(join(f.source, f.owner, "home/task-homes", task.id, ".codex/config.toml"), original);
    await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks });
    const config = parse(await readFile(join(f.stage, f.owner, "home/.codex/config.toml"), "utf8"));
    expect(config).toMatchObject(parse(original));
    if (selected === "link-sense") {
      const template = parse(await readFile(new URL("../../../deploy/codex-home-template/config.toml", import.meta.url), "utf8"));
      expect(config).toMatchObject({ model_providers: template.model_providers });
    } else {
      expect(config).toEqual(parse(original));
    }
  });

  it("rebases container HOME cache links and preserves the bundled Python interpreter link", async () => {
    const f = await fixture();
    const home = join(f.source, f.owner, "home");
    await mkdir(join(home, ".local/share/linksense/cache/archive"), { recursive: true });
    await writeFile(join(home, ".local/share/linksense/cache/archive/package"), "installed package");
    await symlink("/home/linksense/.local/share/linksense/cache/archive", join(home, ".local/share/linksense/cache/current"));
    await mkdir(join(home, ".local/share/linksense/python/.venv/bin"), { recursive: true });
    await symlink("/usr/local/bin/python3.12", join(home, ".local/share/linksense/python/.venv/bin/python3.12"));
    await symlink(`../../task-homes/${f.tasks[0]!.id}/.agents/skills`, join(f.source, f.tasks[0]!.workspaceRelPath, "skills"));
    await symlink("../../.agents/skills", join(f.source, f.tasks[2]!.workspaceRelPath, "skills"));
    await symlink("/home/linksense/.local/share/linksense/node/node_modules", join(f.source, f.tasks[0]!.workspaceRelPath, "node_modules"));
    await mkdir(join(f.source, f.tasks[0]!.workspaceRelPath, "nested"));
    await symlink(`/home/linksense/workspaces/${f.tasks[0]!.id}/node_modules`, join(f.source, f.tasks[0]!.workspaceRelPath, "nested/node_modules"));
    await symlink("/home/linksense/.local/share/linksense/node/node_modules", join(f.source, f.tasks[0]!.workspaceRelPath, "nested/shared-modules"));
    await mkdir(join(f.source, f.tasks[1]!.workspaceRelPath, "skills"));
    await writeFile(join(f.source, f.tasks[1]!.workspaceRelPath, "skills/custom.txt"), "user file");
    await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks });
    const migrated = join(f.stage, f.owner, "home");
    expect(await readlink(join(migrated, ".local/share/linksense/cache/current"))).toBe("archive");
    expect(await readFile(join(migrated, ".local/share/linksense/cache/current/package"), "utf8")).toBe("installed package");
    expect(await readlink(join(migrated, ".local/share/linksense/python/.venv/bin/python3.12"))).toBe("/usr/local/bin/python3.12");
    expect(await readdir(join(migrated, "projects", f.project, "imports", f.tasks[0]!.id))).not.toContain("skills");
    expect(await readlink(join(migrated, "projects", f.project, "imports", f.tasks[0]!.id, "nested/node_modules"))).toBe("/home/linksense/.local/share/linksense/node/node_modules");
    expect(await readlink(join(migrated, "projects", f.project, "imports", f.tasks[0]!.id, "nested/shared-modules"))).toBe("/home/linksense/.local/share/linksense/node/node_modules");
    expect(await readdir(join(f.stage, f.owner, "services", f.tasks[2]!.id, "home/workspace/imports", f.tasks[2]!.id))).not.toContain("skills");
    expect(await readFile(join(migrated, "projects", f.project, "imports", f.tasks[1]!.id, "skills/custom.txt"), "utf8")).toBe("user file");
  });

  it("takes newer thread metadata from its dedicated task home while retaining the shared scan cursor", async () => {
    const f = await fixture();
    const source = join(f.root, "native-source"), target = join(f.root, "native-target");
    await mkdir(source); await mkdir(target);
    for (const [directory, time, title] of [[source, 20, "continued task"], [target, 10, "old shared copy"]] as const) {
      const db = new DatabaseSync(join(directory, "state_5.sqlite"));
      db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, title TEXT, updated_at_ms INTEGER); CREATE TABLE backfill_state(id INTEGER PRIMARY KEY, updated_at INTEGER)");
      db.prepare("INSERT INTO threads VALUES ('thread',?,?)").run(title, time);
      db.prepare("INSERT INTO backfill_state VALUES (1,?)").run(time);
      db.close();
    }
    await mergeNativeDatabases(source, target, { sourceIsTaskHome: true });
    const copy = new DatabaseSync(join(target, "state_5.sqlite"));
    expect(copy.prepare("SELECT title FROM threads").get()?.title).toBe("continued task");
    expect(copy.prepare("SELECT updated_at FROM backfill_state").get()?.updated_at).toBe(10);
    copy.close();
  });

  it("preserves appended task history when its old shared rollout is an exact prefix", async () => {
    const f = await fixture(), task = f.tasks[0]!;
    const native = join(f.source, f.owner, "home/task-homes", task.id, ".codex/sessions", `${task.nativeThreadIds[0]}.jsonl`);
    const common = join(f.source, f.owner, "home/.codex/sessions");
    await mkdir(common, { recursive: true });
    const initial = await readFile(native, "utf8");
    await writeFile(join(common, `${task.nativeThreadIds[0]}.jsonl`), initial);
    await writeFile(native, initial + JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }) + "\n");
    await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks });
    expect(await readFile(join(f.stage, f.owner, "home/.codex/sessions", `${task.nativeThreadIds[0]}.jsonl`), "utf8")).toBe(await readFile(native, "utf8"));
    expect(await readFile(join(common, `${task.nativeThreadIds[0]}.jsonl`), "utf8")).toBe(initial);
  });

  it.each([10, 9])("rejects conflicting thread content with an equal or older update time (%s)", async time => {
    const f = await fixture(), source = join(f.root, "older-source"), target = join(f.root, "newer-target");
    await mkdir(source); await mkdir(target);
    for (const [directory, updated, title] of [[source, time, "conflicting"], [target, 10, "retained"]] as const) {
      const db = new DatabaseSync(join(directory, "state_5.sqlite"));
      db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, title TEXT, updated_at_ms INTEGER)");
      db.prepare("INSERT INTO threads VALUES ('thread',?,?)").run(title, updated); db.close();
    }
    await expect(mergeNativeDatabases(source, target, { sourceIsTaskHome: true })).rejects.toThrow("MIGRATION_NATIVE_RECORD_CONFLICT");
    const db = new DatabaseSync(join(target, "state_5.sqlite"));
    expect(db.prepare("SELECT title FROM threads").get()?.title).toBe("retained"); db.close();
  });

  it("accepts an unchanged thread whose dedicated home only relocated the same rollout", async () => {
    const f = await fixture(), source = join(f.root, "moved-source"), target = join(f.root, "original-target");
    await mkdir(source); await mkdir(target);
    for (const [directory, prefix] of [[source, "/task"], [target, "/shared"]] as const) {
      const db = new DatabaseSync(join(directory, "state_5.sqlite"));
      db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, updated_at_ms INTEGER)");
      db.prepare("INSERT INTO threads VALUES ('thread',?,10)").run(`${prefix}/.codex/sessions/thread.jsonl`); db.close();
    }
    await mergeNativeDatabases(source, target, { sourceIsTaskHome: true });
    const db = new DatabaseSync(join(target, "state_5.sqlite"));
    expect(db.prepare("SELECT rollout_path FROM threads").get()?.rollout_path).toBe("/task/.codex/sessions/thread.jsonl"); db.close();
  });

  it("does not discard conflicting revisions when a native queue still contains input", async () => {
    const f = await fixture(), source = join(f.root, "queued-source"), target = join(f.root, "queued-target");
    await mkdir(source); await mkdir(target);
    for (const [directory, revision] of [[source, 2], [target, 1]] as const) {
      const db = new DatabaseSync(join(directory, "queue_1.sqlite"));
      db.exec("CREATE TABLE queued_items(id TEXT PRIMARY KEY, input TEXT); CREATE TABLE queued_thread_revisions(id TEXT PRIMARY KEY, revision INTEGER); INSERT INTO queued_items VALUES ('input','Keep this pending input')");
      db.prepare("INSERT INTO queued_thread_revisions VALUES ('thread',?)").run(revision); db.close();
    }
    await expect(mergeNativeDatabases(source, target)).rejects.toThrow("MIGRATION_NATIVE_RECORD_CONFLICT");
    const db = new DatabaseSync(join(target, "queue_1.sqlite"));
    expect(db.prepare("SELECT input FROM queued_items").get()?.input).toBe("Keep this pending input"); db.close();
  });

  it("rejects different personal instructions even when both files have generated revision headers", async () => {
    const f = await fixture();
    for (const [index, task] of f.tasks.entries()) await writeFile(join(f.source, f.owner, "home/task-homes", task.id, ".codex/AGENTS.md"), `<!-- linksense-personalization:v1 revision:${randomUUID()} -->\nPreference ${index}\n`);
    await expect(stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks })).rejects.toThrow("MIGRATION_FILE_CONFLICT");
  });

  it("rejects cross-owner paths, escaping symlinks and missing native history", async () => {
    const f = await fixture();
    await expect(stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: [{ ...f.tasks[0]!, workspaceRelPath: `${randomUUID()}/home/workspaces/${f.tasks[0]!.id}` }] })).rejects.toThrow("MIGRATION_WORKSPACE_LAYOUT_CONFLICT");
    await rm(f.stage, { recursive: true, force: true });
    await symlink("/etc", join(f.source, f.tasks[0]!.workspaceRelPath, "external"));
    await expect(stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks })).rejects.toThrow("MIGRATION_SYMLINK_CONFLICT");
    await rm(f.stage, { recursive: true, force: true }); await rm(join(f.source, f.tasks[0]!.workspaceRelPath, "external"));
    await expect(stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: [{ ...f.tasks[0]!, nativeThreadIds: [randomUUID()] }] })).rejects.toThrow("MIGRATION_NATIVE_THREAD_MISSING");
  });

  it("preserves files belonging to previously deleted tasks in the common workspace", async () => {
    const f = await fixture();
    const deleted = f.tasks[2]!;
    await writeFile(join(f.source, f.owner, "home/task-homes", deleted.id, ".login"), "deleted-service-account");
    await writeFile(join(f.source, f.owner, "home/task-homes", deleted.id, ".codex/logs_2.sqlite"), "original damaged diagnostic database");
    await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks.slice(0, 2) });
    expect(await readFile(join(f.stage, f.owner, "home/workspace/imports", deleted.id, "attachments/report.txt"), "utf8")).toBe(deleted.id);
    expect(await readFile(join(f.stage, f.owner, "control/recovered-task-homes", deleted.id, ".login"), "utf8")).toBe("deleted-service-account");
    expect(await readFile(join(f.stage, f.owner, "control/recovered-task-homes", deleted.id, ".codex/logs_2.sqlite"), "utf8")).toBe("original damaged diagnostic database");
    expect(await readdir(join(f.stage, f.owner, "home"))).not.toContain(".login");
  });

  it("omits disposable native caches from active and recovered homes while retaining installed plugins, credentials and original files", async () => {
    const f = await fixture();
    for (const task of f.tasks) {
      const home = join(f.source, f.owner, "home/task-homes", task.id);
      for (const name of ["tmp", ".tmp", "thread-writer-locks", "plugins/custom"]) {
        await mkdir(join(home, ".codex", name), { recursive: true });
        await writeFile(join(home, ".codex", name, "fixture"), name);
      }
      await writeFile(join(home, ".codex/auth.json"), '{"fixture":"personal account"}');
      await mkdir(join(home, "tmp"));
      await writeFile(join(home, "tmp/user-file.txt"), "keep user files outside native caches");
    }
    await stageProjectHomes({ sourceRoot: f.source, stagingRoot: f.stage, tasks: f.tasks.slice(0, 2) });
    const recovered = join(f.stage, f.owner, "control/recovered-task-homes", f.tasks[2]!.id);
    for (const home of [join(f.stage, f.owner, "home"), recovered]) {
      for (const name of ["tmp", ".tmp", "thread-writer-locks"]) expect(await readdir(join(home, ".codex"))).not.toContain(name);
      expect(await readFile(join(home, ".codex/plugins/custom/fixture"), "utf8")).toBe("plugins/custom");
      expect(await readFile(join(home, ".codex/auth.json"), "utf8")).toBe('{"fixture":"personal account"}');
      expect(await readFile(join(home, "tmp/user-file.txt"), "utf8")).toBe("keep user files outside native caches");
    }
    const imports = join(f.stage, f.owner, "control/native-home-imports");
    for (const id of await readdir(imports)) {
      for (const name of ["tmp", ".tmp", "thread-writer-locks"]) expect(await readdir(join(imports, id))).not.toContain(name);
    }
    for (const task of f.tasks) {
      const original = join(f.source, f.owner, "home/task-homes", task.id, ".codex");
      expect(await readFile(join(original, ".tmp/fixture"), "utf8")).toBe(".tmp");
    }
  });

  it("includes committed WAL records and fails on conflicting native records or schemas", async () => {
    const f = await fixture(), source = join(f.root, "sqlite-source"), target = join(f.root, "sqlite-target");
    await mkdir(source); await mkdir(target);
    const db = new DatabaseSync(join(source, "goals_1.sqlite"));
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE goals(id TEXT PRIMARY KEY, objective TEXT); INSERT INTO goals VALUES ('one','Keep history')");
      await mergeNativeDatabases(source, target);
      const copy = new DatabaseSync(join(target, "goals_1.sqlite"));
      expect(copy.prepare("SELECT objective FROM goals").get()?.objective).toBe("Keep history"); copy.close();
      await mergeNativeDatabases(source, target);
      db.exec("UPDATE goals SET objective='Different objective'");
      await expect(mergeNativeDatabases(source, target)).rejects.toThrow("MIGRATION_NATIVE_RECORD_CONFLICT");
      db.exec("ALTER TABLE goals ADD COLUMN changed TEXT");
      await expect(mergeNativeDatabases(source, target)).rejects.toThrow("MIGRATION_NATIVE_SCHEMA_CONFLICT");
    } finally { db.close(); }
  });

  it("blocks startup until old paths, pending publications and conversion markers are resolved", async () => {
    const f = await fixture();
    const prisma = { $queryRaw: vi.fn(async () => []), conversation: { count: vi.fn(async () => 1) }, applicationVersion: { count: vi.fn(async () => 0) } };
    await expect(assertRuntimeLayoutReady(prisma as never, f.source)).rejects.toThrow("MIGRATION_PROJECT_RUNTIME_REQUIRED");
    prisma.conversation.count.mockResolvedValue(0); prisma.applicationVersion.count.mockResolvedValue(1);
    await expect(assertRuntimeLayoutReady(prisma as never, f.source)).rejects.toThrow("MIGRATION_PROJECT_RUNTIME_REQUIRED");
    prisma.applicationVersion.count.mockResolvedValue(0);
    await expect(assertRuntimeLayoutReady(prisma as never, f.source)).resolves.toBeUndefined();
    await writeFile(join(f.source, ".runtime-conversion.json"), "{}");
    await expect(assertRuntimeLayoutReady(prisma as never, f.source)).rejects.toThrow("MIGRATION_PROJECT_RUNTIME_REQUIRED");
  });

  it("restores the original directory after a crash before the database commit", async () => {
    const f = await fixture(), backup = join(f.root, "backup"), original = join(backup, "original-users", f.owner);
    await mkdir(original, { recursive: true }); await writeFile(join(original, "original"), "retained");
    await mkdir(join(backup, "staged-users"));
    const task = f.tasks[0]!;
    await writeFile(join(backup, "journal.json"), JSON.stringify({ phase: "swapping", sourceRoot: f.source, backupRoot: backup, swapped: [f.owner], owners: [f.owner], tasks: [{ id: task.id, ownerId: f.owner, oldWorkspace: task.workspaceRelPath, workspace: `${f.owner}/home/workspace`, importedDirectory: `imports/${task.id}` }] }));
    const prisma = { conversation: { findMany: vi.fn(async () => [{ id: task.id, workspaceRelPath: task.workspaceRelPath }]) } };
    await recoverProjectConversion(prisma as never, backup);
    expect(await readFile(join(f.source, f.owner, "original"), "utf8")).toBe("retained");
    expect(await readdir(join(backup, "staged-users", f.owner))).toContain("home");
  });
});
