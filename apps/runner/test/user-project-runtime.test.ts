import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

const owner = "10000000-0000-4000-8000-000000000001";
const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const project = "30000000-0000-4000-8000-000000000001";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-user-project-"));
  roots.push(root);
  const manager = new WorkspaceManager(root);
  manager.bindOwner(first, owner);
  manager.bindOwner(second, owner);
  return { root, manager };
}

describe("user computer and project workspaces", () => {
  it("shares HOME, native state and project files while retaining separate task control state", async () => {
    const { manager } = await fixture();
    manager.bindWorkspace(first, `projects/${project}`);
    manager.bindWorkspace(second, `projects/${project}`);
    const [a, b] = await Promise.all([manager.ensureConversation(first), manager.ensureConversation(second)]);
    expect(a.home).toBe(b.home);
    expect(a.codexHome).toBe(path.join(a.home, ".codex"));
    expect(b.codexHome).toBe(a.codexHome);
    expect(a.workspace).toBe(b.workspace);
    expect(a.taskControl).not.toBe(b.taskControl);
    await writeFile(path.join(a.workspace, "shared.txt"), "project work");
    await writeFile(path.join(a.codexHome, "native-session-fixture"), "native state");
    expect(await readFile(path.join(b.workspace, "shared.txt"), "utf8")).toBe("project work");
    await manager.removeConversation(first);
    expect(await readFile(path.join(b.workspace, "shared.txt"), "utf8")).toBe("project work");
    expect(await readFile(path.join(b.codexHome, "native-session-fixture"), "utf8")).toBe("native state");
    expect(await manager.readRuntimeGeneration(second)).toBe(b.runtimeGeneration);
  });

  it("uses one common directory for projectless tasks and restores project assignments after a restart", async () => {
    const { root, manager } = await fixture();
    expect(manager.pathsFor(first).workspace).toBe(manager.pathsFor(second).workspace);
    expect(manager.pathsFor(first).workspace).toBe(path.join(root, owner, "home", "workspace"));
    manager.bindWorkspace(first, `projects/${project}`);
    const a = await manager.ensureConversation(first);
    await writeFile(path.join(a.workspace, "original.txt"), "retain");
    const restarted = new WorkspaceManager(root);
    expect(await restarted.listConversationIds()).toEqual([first]);
    expect(restarted.pathsFor(first).workspace).toBe(a.workspace);
    restarted.bindWorkspace(first, "workspace");
    const moved = await restarted.ensureConversation(first);
    expect(moved.workspace).not.toBe(a.workspace);
    expect(moved.codexHome).toBe(a.codexHome);
    expect(moved.runtimeGeneration).toBe(a.runtimeGeneration);
    expect(await readFile(path.join(a.workspace, "original.txt"), "utf8")).toBe("retain");
  });

  it("preserves user-authored project and native instructions", async () => {
    const { manager } = await fixture();
    const paths = manager.pathsFor(first);
    await Promise.all([paths.workspace, paths.codexHome].map(directory => mkdir(directory, { recursive: true })));
    await writeFile(path.join(paths.workspace, "AGENTS.md"), "Project instructions");
    await writeFile(path.join(paths.codexHome, "AGENTS.md"), "Personal instructions");
    await manager.ensureConversation(first);
    expect(await readFile(path.join(paths.workspace, "AGENTS.md"), "utf8")).toBe("Project instructions");
    expect(await readFile(path.join(paths.codexHome, "AGENTS.md"), "utf8")).toBe("Personal instructions");
    expect(() => manager.bindWorkspace(first, "../../another-user/home")).toThrow();
  });
});
