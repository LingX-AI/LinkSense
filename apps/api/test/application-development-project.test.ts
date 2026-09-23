import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_DEVELOPMENT_PROJECT_NAME } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { ApplicationDevelopmentRepository } from "../src/modules/applications/development-repository.js";
import { applicationDevelopmentTemplate } from "../src/modules/applications/development-template.js";
import { actor, OWNER, TASK, DEVELOPMENT_PROJECT, developmentFixture } from "./application-development.fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() { const f = await developmentFixture(); roots.push(f.root); return f; }

describe("dedicated application development project", () => {
  it.each(["zh-CN", "en-US"] as const)("creates a new task in the dedicated project in %s", async locale => {
    const f = await setup();
    await f.service.create(actor, { name: "Example" }, locale);
    expect(f.store.ensureProject).toHaveBeenCalledWith(OWNER);
    expect(f.conversations.create).toHaveBeenCalledWith(OWNER, { collaborationMode: "default", fallbackLocale: locale, projectId: DEVELOPMENT_PROJECT });
    expect(f.row()).toMatchObject({ projectId: DEVELOPMENT_PROJECT, workspaceRelPath: `${OWNER}/home/projects/${DEVELOPMENT_PROJECT}` });
  });

  it("does not create a project or task for invalid input or an inactive user", async () => {
    const f = await setup();
    await expect(f.service.create(actor, { name: " " }, "zh-CN")).rejects.toThrow();
    await expect(f.service.create({ ...actor, status: "disabled" }, { name: "App" }, "zh-CN")).rejects.toMatchObject({ code: "USER_DISABLED" });
    expect(f.store.ensureProject).not.toHaveBeenCalled();
    expect(f.conversations.create).not.toHaveBeenCalled();
  });

  it.each([null, TASK])("registers a running ordinary task from project %s and returns its source location", async projectId => {
    const f = await setup();
    Object.assign(f.conversation, { projectId, workspaceRelPath: `${OWNER}/home/${projectId ? `projects/${projectId}` : "workspace"}` });
    const opened = await f.service.toolForOwner(OWNER, TASK, OWNER, { operation: "open", name: "App" }, projectId ? `projects/${projectId}` : "workspace");
    expect(opened).toMatchObject({ conversation_id: TASK, workspace_path: `projects/${DEVELOPMENT_PROJECT}` });
    expect(f.conversation.projectId).toBe(DEVELOPMENT_PROJECT);
    expect(f.conversations.create).not.toHaveBeenCalled();
    expect(await readFile(join(f.workspace, f.row().directory, "app.js"), "utf8")).toContain("window.LinkSense");
  });

  it("imports an existing static directory into a unique location without modifying shared originals", async () => {
    const f = await setup();
    f.conversation.projectId = null;
    f.conversation.workspaceRelPath = `${OWNER}/home/workspace`;
    const original = join(f.root, f.conversation.workspaceRelPath, "existing");
    await mkdir(original, { recursive: true });
    const files = applicationDevelopmentTemplate("Imported", TASK, "en-US");
    for (const [path, value] of Object.entries(files)) await writeFile(join(original, path), value);
    await mkdir(join(f.workspace, "existing"));
    await writeFile(join(f.workspace, "existing", "sentinel"), "another application");
    const opened = await f.service.open(actor, TASK, { name: "Imported", directory: "existing" }, "en-US");
    expect(opened.directory).toBe(`applications/${opened.id}`);
    expect(await readFile(join(f.workspace, opened.directory, "app.js"), "utf8")).toBe(files["app.js"]);
    expect(await readFile(join(original, "app.js"), "utf8")).toBe(files["app.js"]);
    expect(await readFile(join(f.workspace, "existing", "sentinel"), "utf8")).toBe("another application");
  });

  it("opens a task only once when simultaneous tool calls first register its application", async () => {
    const f = await setup();
    const opened = await Promise.all(Array.from({ length: 3 }, () => f.service.open(actor, TASK, { name: "Shared" }, "en-US")));
    expect(new Set(opened.map(item => item.id)).size).toBe(1);
    expect(f.store.create).toHaveBeenCalledOnce();
    expect(f.applications.importInteractive).toHaveBeenCalledOnce();
  });

  it("reads an uploaded icon from the active turn's original workspace after registration", async () => {
    const f = await setup();
    f.conversation.projectId = null;
    f.conversation.workspaceRelPath = `${OWNER}/home/workspace`;
    const source = join(f.root, f.conversation.workspaceRelPath);
    await mkdir(source, { recursive: true });
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await writeFile(join(source, "logo.png"), image);
    await f.service.toolForOwner(OWNER, TASK, OWNER, { operation: "open", name: "App" }, "workspace");
    const changed = await f.service.toolForOwner(OWNER, TASK, OWNER, { operation: "metadata", source_hash: f.row().sourceHash!, icon: { type: "file", path: "logo.png" } }, "workspace");
    expect(changed).toMatchObject({ manifest: { icon: expect.stringMatching(/\.png$/u) }, workspace_path: `projects/${DEVELOPMENT_PROJECT}` });
    expect(await readFile(join(source, "logo.png"))).toEqual(image);
  });

  it("keeps historical development, source, test identity and restored tasks in their original project", async () => {
    const f = await setup();
    const opened = await f.service.create(actor, { name: "Historical" }, "en-US");
    const originalPath = `${OWNER}/home/projects/${TASK}`;
    await rename(f.workspace, join(f.root, originalPath));
    Object.assign(f.row(), { projectId: TASK, workspaceRelPath: originalPath });
    Object.assign(f.conversation, { projectId: TASK, workspaceRelPath: originalPath });
    f.store.ensureProject.mockClear();
    expect(await f.service.open(actor, TASK, { name: "Ignored" }, "en-US")).toMatchObject({ id: opened.id, source_hash: opened.source_hash });
    expect(await f.service.sync(actor, opened.id)).toMatchObject({ source_hash: opened.source_hash, preview_conversation_id: opened.preview_conversation_id });
    f.row().conversationId = null;
    await f.service.reopen(actor, opened.id, "en-US");
    expect(f.store.ensureProject).not.toHaveBeenCalled();
    expect(f.conversations.createDevelopmentConversation).toHaveBeenCalledWith(OWNER, { id: opened.id, projectId: TASK, workspaceRelPath: originalPath }, "en-US");
    expect(await readFile(join(f.root, originalPath, opened.directory, "app.js"), "utf8")).toContain("window.LinkSense");
  });
});

describe("development project persistence", () => {
  it("upserts by owner and fixed name without resetting appearance or project ordering", async () => {
    const query = vi.fn().mockResolvedValue([{ id: DEVELOPMENT_PROJECT }]);
    const store = new ApplicationDevelopmentRepository({ $queryRaw: query } as unknown as PrismaClient);
    await expect(store.ensureProject(OWNER)).resolves.toEqual({ id: DEVELOPMENT_PROJECT });
    expect(query.mock.calls[0]?.[0]).toMatchObject({ values: [expect.any(String), OWNER, APPLICATION_DEVELOPMENT_PROJECT_NAME] });
    expect(query.mock.calls[0]?.[0].sql).toContain("ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name");
    expect(query.mock.calls[0]?.[0].sql).not.toMatch(/icon|color|sort_order/u);
  });

  function fixture() {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: DEVELOPMENT_PROJECT, projectId: null, workspaceRelPath: `${OWNER}/home/workspace` }]),
      conversation: { update: vi.fn() },
      applicationDevelopment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => data) },
    };
    const transaction = vi.fn(async (action: (client: typeof tx) => Promise<unknown>) => action(tx));
    const store = new ApplicationDevelopmentRepository({ $transaction: transaction } as unknown as PrismaClient);
    const input = { id: TASK, ownerId: OWNER, conversationId: TASK, name: "App", directory: "applications/app", projectId: DEVELOPMENT_PROJECT };
    return { tx, store, input, transaction };
  }

  it("atomically assigns a task and registers development without changing native thread or history", async () => {
    const { tx, store, input, transaction } = fixture();
    await store.create(input);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.conversation.update).toHaveBeenCalledWith({ where: { id: TASK }, data: { projectId: DEVELOPMENT_PROJECT, workspaceRelPath: `${OWNER}/home/projects/${DEVELOPMENT_PROJECT}`, sortOrder: null } });
    expect(tx.applicationDevelopment.create).toHaveBeenCalledWith({ data: { ...input, workspaceRelPath: `${OWNER}/home/projects/${DEVELOPMENT_PROJECT}` } });
  });

  it("reuses an existing draft without moving historical sources or task membership", async () => {
    const { tx, store, input } = fixture();
    const existing = { id: "existing", projectId: null };
    tx.applicationDevelopment.findUnique.mockResolvedValue(existing);
    expect(await store.create(input)).toBe(existing);
    expect(tx.conversation.update).not.toHaveBeenCalled();
    expect(tx.applicationDevelopment.create).not.toHaveBeenCalled();
  });

  it.each(["project", "task"])("does not write when the %s is missing or belongs to another owner", async missing => {
    const { tx, store, input } = fixture();
    if (missing === "task") tx.$queryRaw.mockResolvedValueOnce([{ id: DEVELOPMENT_PROJECT }]);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(store.create(input)).rejects.toMatchObject({ code: missing === "project" ? "PROJECT_NOT_FOUND" : "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    expect(tx.conversation.update).not.toHaveBeenCalled();
    expect(tx.applicationDevelopment.create).not.toHaveBeenCalled();
  });
});
