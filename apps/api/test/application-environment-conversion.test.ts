import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertApplicationEnvironments, planApplicationEnvironments, recoverApplicationEnvironments, stageApplicationEnvironment } from "../src/operations/application-environment-conversion.js";
import { applicationEnvironmentConversionMarker } from "../src/operations/runtime-layout-readiness.js";
import { serviceWorkspaceRelativePath } from "../src/lib/user-runtime-paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-app-homes-")); roots.push(root);
  const ownerId = randomUUID(), applicationId = randomUUID();
  const tasks = [randomUUID(), randomUUID()].map(id => ({ id, ownerId, applicationId, workspaceRelPath: serviceWorkspaceRelativePath(ownerId, id) }));
  const sources = join(root, "users"), target = join(root, "staged");
  for (const task of tasks) {
    const home = join(sources, ownerId, "services", task.id, "home");
    await mkdir(join(home, "workspace/artifacts"), { recursive: true });
    await mkdir(join(home, ".codex/sessions"), { recursive: true });
    await writeFile(join(home, ".codex/auth.json"), JSON.stringify({ fixture: "same-account" }));
    await writeFile(join(home, ".codex/sessions", `${task.id}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: task.id } }) + "\n");
    await writeFile(join(home, "workspace/artifacts/result.txt"), task.id);
  }
  const group = planApplicationEnvironments(tasks)[0]!;
  return { root, ownerId, applicationId, tasks, sources, target, group };
}

describe("application environment conversion", () => {
  it("groups by execution user and application while keeping personal tasks and already shared environments intact", () => {
    const ownerId = randomUUID(), otherOwner = randomUUID(), app = randomUUID(), otherApp = randomUUID();
    const task = (owner: string, applicationId: string, environment = randomUUID()) => ({ id: randomUUID(), ownerId: owner, applicationId, workspaceRelPath: serviceWorkspaceRelativePath(owner, environment) });
    const rows = [task(ownerId, app), task(ownerId, app), task(otherOwner, app), task(ownerId, otherApp), task(otherOwner, otherApp, otherApp), { id: randomUUID(), ownerId, applicationId: null, workspaceRelPath: `${ownerId}/home/workspace` }];
    const groups = planApplicationEnvironments(rows);
    expect(groups).toHaveLength(3);
    expect(groups.find(group => group.ownerId === ownerId && group.applicationId === app)?.tasks).toHaveLength(2);
    expect(planApplicationEnvironments([...rows].reverse())).toEqual(groups);
  });

  it("retains both native histories, credentials and colliding workspace filenames without changing either original", async () => {
    const f = await fixture();
    await stageApplicationEnvironment(f.sources, f.target, f.group);
    for (const task of f.tasks) {
      await expect(readFile(join(f.target, "home/workspace/imports", task.id, "artifacts/result.txt"), "utf8")).resolves.toBe(task.id);
      await expect(readFile(join(f.target, "home/.codex/sessions", `${task.id}.jsonl`), "utf8")).resolves.toContain(task.id);
      await expect(readFile(join(f.sources, task.workspaceRelPath, "artifacts/result.txt"), "utf8")).resolves.toBe(task.id);
    }
    await expect(readFile(join(f.target, "home/.codex/auth.json"), "utf8")).resolves.toBe(JSON.stringify({ fixture: "same-account" }));
  });

  it("refuses to choose between different credentials and preserves all source data", async () => {
    const f = await fixture();
    const different = join(f.sources, f.ownerId, "services", f.tasks[1]!.id, "home/.codex/auth.json");
    await writeFile(different, JSON.stringify({ fixture: "different-account" }));
    await expect(stageApplicationEnvironment(f.sources, f.target, f.group)).rejects.toThrow("MIGRATION_FILE_CONFLICT");
    await expect(readFile(different, "utf8")).resolves.toContain("different-account");
    for (const task of f.tasks) await expect(readFile(join(f.sources, task.workspaceRelPath, "artifacts/result.txt"), "utf8")).resolves.toBe(task.id);
  });

  it("merges native-upgraded copies and preserves originals and previous conversion archives", async () => {
    const f = await fixture();
    for (const task of f.tasks) {
      const source = join(f.sources, f.ownerId, "services", task.id);
      await writeFile(join(source, "home/.codex/native-state"), "old schema");
      await mkdir(join(source, "control/native-home-imports"), { recursive: true });
      await writeFile(join(source, "control/native-home-imports/archive"), task.id);
    }
    const normalize = vi.fn(async (source: string) => {
      const target = join(f.root, "normalized", randomUUID(), ".codex");
      await cp(source, target, { recursive: true });
      await writeFile(join(target, "native-state"), "upgraded schema");
      return target;
    });
    await stageApplicationEnvironment(f.sources, f.target, f.group, "/home/linksense", normalize);
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(await readFile(join(f.target, "home/.codex/native-state"), "utf8")).toBe("upgraded schema");
    for (const task of f.tasks) {
      expect(await readFile(join(f.sources, f.ownerId, "services", task.id, "home/.codex/native-state"), "utf8")).toBe("old schema");
      expect(await readFile(join(f.target, "control/previous-native-home-imports", task.id, "archive"), "utf8")).toBe(task.id);
    }
  });

  it("retains the worker's managed Node dependency links when moving old workspaces into imports", async () => {
    const f = await fixture();
    for (const task of f.tasks) {
      const home = join(f.sources, f.ownerId, "services", task.id, "home");
      await mkdir(join(home, ".local/share/linksense/node/node_modules/example"), { recursive: true });
      await writeFile(join(home, ".local/share/linksense/node/node_modules/example/index.js"), "retained dependency");
      await symlink("/home/linksense/.local/share/linksense/node/node_modules", join(home, "workspace/node_modules"));
    }
    await stageApplicationEnvironment(f.sources, f.target, f.group);
    for (const task of f.tasks) await expect(readFile(join(f.target, "home/workspace/imports", task.id, "node_modules/example/index.js"), "utf8")).resolves.toBe("retained dependency");
  });

  it("retains nested managed dependency links and leaves unrelated personal files untouched", async () => {
    const f = await fixture();
    const personal = { id: randomUUID(), ownerId: f.ownerId, applicationId: f.applicationId, workspaceRelPath: `${f.ownerId}/home/workspace` };
    const home = join(f.sources, f.ownerId, "home");
    await mkdir(join(home, "workspace/example"), { recursive: true });
    await writeFile(join(home, "workspace/example/result.txt"), "personal original");
    await symlink("/home/linksense/.local/share/linksense/node/node_modules", join(home, "workspace/example/node_modules"));
    const group = planApplicationEnvironments([personal])[0]!;
    await stageApplicationEnvironment(f.sources, f.target, group);
    expect(await readlink(join(f.target, "home/workspace/imports/personal/workspace/example/node_modules"))).toBe("/home/linksense/.local/share/linksense/node/node_modules");
    expect(await readFile(join(f.target, "home/workspace/imports/personal/workspace/example/result.txt"), "utf8")).toBe("personal original");
    expect(await readFile(join(home, "workspace/example/result.txt"), "utf8")).toBe("personal original");
  });

  it("rejects a shared directory referenced by different applications", () => {
    const ownerId = randomUUID(), id = randomUUID(), app = randomUUID();
    const task = { id, ownerId, applicationId: app, workspaceRelPath: serviceWorkspaceRelativePath(ownerId, id) };
    expect(() => planApplicationEnvironments([task, { ...task, id: randomUUID(), applicationId: randomUUID() }])).toThrow("MIGRATION_APPLICATION_REFERENCE_CONFLICT");
  });

  it("rejects a symlinked environment before reading or moving its contents", async () => {
    const f = await fixture();
    const source = join(f.sources, f.ownerId, "services", f.tasks[0]!.id);
    await rm(source, { recursive: true });
    await symlink(join(f.sources, f.ownerId, "services", f.tasks[1]!.id), source);
    await expect(stageApplicationEnvironment(f.sources, f.target, f.group)).rejects.toThrow("MIGRATION_PATH_INVALID");
    await expect(readFile(join(f.sources, f.tasks[1]!.workspaceRelPath, "artifacts/result.txt"), "utf8")).resolves.toBe(f.tasks[1]!.id);
  });

  it("rejects a symlinked native HOME before invoking its native upgrade", async () => {
    const f = await fixture();
    const native = join(f.sources, f.ownerId, "services", f.tasks[0]!.id, "home/.codex");
    await rename(native, native + ".original");
    await symlink(native + ".original", native);
    const normalize = vi.fn(async (source: string) => source);
    await expect(stageApplicationEnvironment(f.sources, f.target, f.group, "/home/linksense", normalize)).rejects.toThrow("MIGRATION_PATH_INVALID");
    expect(normalize).not.toHaveBeenCalledWith(native);
    expect(await readFile(join(native + ".original", "auth.json"), "utf8")).toContain("same-account");
  });

  it.each(["running", "starting"])("refuses conversion while a task is %s before creating staging", async state => {
    const f = await fixture();
    const prisma = recoveryPrisma(f.tasks);
    (state === "running" ? prisma.conversationTurn : prisma.conversationTurnStartIntent).count.mockResolvedValue(1);
    await expect(convertApplicationEnvironments({ prisma: prisma as never, userDataRoot: f.sources, outputRoot: f.target, apply: true })).rejects.toThrow("MIGRATION_ACTIVE_TASKS");
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it("restores every original after filesystem swaps when the database transaction did not commit", async () => {
    const f = await swappedFixture();
    await recoverApplicationEnvironments(recoveryPrisma(f.tasks) as never, f.output);
    for (const task of f.tasks) await expect(readFile(join(f.sources, task.workspaceRelPath, "artifacts/result.txt"), "utf8")).resolves.toBe(task.id);
    await expect(readFile(join(f.sources, applicationEnvironmentConversionMarker))).rejects.toMatchObject({ code: "ENOENT" });
    await recoverApplicationEnvironments(recoveryPrisma(f.tasks) as never, f.output);
  });

  it("keeps the merged home after an uncertain commit when durable rows already reference it", async () => {
    const f = await swappedFixture();
    const rows = f.tasks.map(task => ({ ...task, workspaceRelPath: serviceWorkspaceRelativePath(f.ownerId, f.applicationId) }));
    await recoverApplicationEnvironments(recoveryPrisma(rows) as never, f.output);
    for (const task of f.tasks) await expect(readFile(join(f.canonical, "home/workspace/imports", task.id, "artifacts/result.txt"), "utf8")).resolves.toBe(task.id);
    await expect(readFile(join(f.sources, applicationEnvironmentConversionMarker))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps startup fenced when durable rows reference a missing merged home", async () => {
    const f = await swappedFixture();
    await rename(f.canonical, f.canonical + ".missing");
    const rows = f.tasks.map(task => ({ ...task, workspaceRelPath: serviceWorkspaceRelativePath(f.ownerId, f.applicationId) }));
    await expect(recoverApplicationEnvironments(recoveryPrisma(rows) as never, f.output)).rejects.toThrow("MIGRATION_RECOVERY_CONFLICT");
    await expect(readFile(join(f.sources, applicationEnvironmentConversionMarker), "utf8")).resolves.toContain(f.output);
  });

  it("refuses a partial database result without restoring or removing either home", async () => {
    const f = await swappedFixture();
    const rows = f.tasks.map((task, index) => index === 0 ? { ...task, workspaceRelPath: serviceWorkspaceRelativePath(f.ownerId, f.applicationId) } : task);
    await expect(recoverApplicationEnvironments(recoveryPrisma(rows) as never, f.output)).rejects.toThrow("MIGRATION_RECOVERY_CONFLICT");
    for (const task of f.tasks) await expect(readFile(join(f.canonical, "home/workspace/imports", task.id, "artifacts/result.txt"), "utf8")).resolves.toBe(task.id);
  });
});

function recoveryPrisma(tasks: Array<{ id: string; workspaceRelPath: string }>) {
  return { conversation: { findMany: vi.fn(async () => tasks) }, conversationTurn: { count: vi.fn(async () => 0) }, conversationTurnStartIntent: { count: vi.fn(async () => 0) } };
}

async function swappedFixture() {
  const f = await fixture();
  const output = join(f.root, "conversion"), canonical = join(f.sources, f.ownerId, "services", f.applicationId);
  const staged = join(output, "staged", f.ownerId, "services", f.applicationId);
  await stageApplicationEnvironment(f.sources, staged, f.group);
  await mkdir(join(output, "originals", f.ownerId, "services"), { recursive: true });
  for (const task of f.tasks) await rename(join(f.sources, f.ownerId, "services", task.id), join(output, "originals", f.ownerId, "services", task.id));
  await rename(staged, canonical);
  await writeFile(join(output, "journal.json"), JSON.stringify({ version: 1, root: f.sources, outputRoot: output, phase: "swapping", groups: [f.group] }));
  await writeFile(join(f.sources, applicationEnvironmentConversionMarker), JSON.stringify({ outputRoot: output }));
  return { ...f, output, canonical };
}
