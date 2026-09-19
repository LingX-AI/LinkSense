import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";
import { actor, OWNER, TASK, developmentFixture } from "./application-development.fixture.js";
import { applicationDevelopmentTemplate } from "../src/modules/applications/development-template.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() { const f = await developmentFixture(); roots.push(f.root); return f; }
describe("conversational application development", () => {
  it("reopens an existing draft with one authorized project read and one task read, without rebuilding runtime", async () => {
    const f = await setup();
    const first = await f.service.create(actor, { name: "Retained app" }, "en-US");
    f.store.owned.mockClear(); f.store.conversation.mockClear();
    f.conversations.createDevelopmentPreview.mockClear(); f.applications.importInteractive.mockClear();
    const reopened = await f.service.reopen(actor, first.id, "en-US");
    expect(reopened).toMatchObject({ id: first.id, conversation_id: first.conversation_id, revision: first.revision });
    expect(f.store.owned).toHaveBeenCalledExactlyOnceWith(OWNER, first.id);
    expect(f.store.conversation).toHaveBeenCalledExactlyOnceWith(OWNER, TASK);
    expect(f.conversations.createDevelopmentPreview).not.toHaveBeenCalled();
    expect(f.applications.importInteractive).not.toHaveBeenCalled();
    await expect(f.service.reopen({ ...actor, id: TASK }, first.id, "en-US")).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
  });

  it("opens an existing published application without reporting unpublished changes, then detects real edits", async () => {
    const f = await setup();
    const files = applicationDevelopmentTemplate("Published application", OWNER, "en-US");
    f.store.sourceApplication.mockResolvedValue({ application: { id: OWNER, name: "Published application", interactiveDependencyBindings: [] }, assets: Object.entries(files).map(([path, content]) => ({ path, objectKey: path, byteSize: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") })) });
    f.assets.get.mockImplementation(async (key: string) => Readable.from([Buffer.from(files[key]!)]));
    const opened = await f.service.resume(actor, OWNER, "en-US");
    expect(opened.installed_source_hash).toBe(opened.source_hash);
    expect(f.installed.size).toBe(0);
    await writeFile(join(f.workspace, opened.directory, "app.js"), "document.title='Real edit'");
    const changed = await f.service.sync(actor, opened.id);
    expect(changed.installed_source_hash).toBe(opened.source_hash);
    expect(changed.source_hash).not.toBe(opened.source_hash);
  });
  it("reports missing source workspaces without losing the last successful preview", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Missing files" }, "en-US");
    await rm(f.workspace, { recursive: true, force: true });
    expect(await f.service.sync(actor, first.id)).toMatchObject({ source_error: "APPLICATION_PACKAGE_INVALID", revision: first.revision, preview_conversation_id: first.preview_conversation_id });
  });
  it("reads and syncs retained source after task deletion and reopens the same draft with its existing test", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Retained app" }, "en-US");
    f.row().conversationId = null;
    f.store.conversation.mockClear();
    expect(await f.service.get(actor, first.id)).toMatchObject({ id: first.id, conversation_id: null, preview_conversation_id: first.preview_conversation_id });
    expect(await f.service.sync(actor, first.id)).toMatchObject({ revision: first.revision, source_hash: first.source_hash, conversation_id: null });
    expect(f.store.conversation).not.toHaveBeenCalled();
    const resumed = await f.service.reopen(actor, first.id, "en-US");
    expect(resumed.conversation_id).toBeTruthy(); expect(resumed.conversation_id).not.toBe(TASK);
    expect(resumed).toMatchObject({ id: first.id, directory: first.directory, preview_conversation_id: first.preview_conversation_id });
    expect(f.conversations.createDevelopmentConversation).toHaveBeenCalledWith(OWNER, { id: first.id, workspaceRelPath: `${OWNER}/home/workspace`, projectId: null }, "en-US");
    await f.service.reopen(actor, first.id, "en-US");
    expect(f.conversations.createDevelopmentConversation).toHaveBeenCalledOnce();
  });
  it("uses the conversation attached by a concurrent reopen and rejects a stale deleted draft", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Retained app" }, "en-US");
    f.row().conversationId = null;
    f.conversations.createDevelopmentConversation.mockImplementationOnce(async () => {
      f.row().conversationId = OWNER;
      throw new AppError("CONFLICT");
    });
    expect((await f.service.reopen(actor, first.id, "en-US")).conversation_id).toBe(OWNER);
    f.row().conversationId = null;
    f.conversations.createDevelopmentConversation.mockRejectedValueOnce(new AppError("CONFLICT"));
    await expect(f.service.reopen(actor, first.id, "en-US")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([null, OWNER])("deletes only the owned draft and preserves its published application (%s)", async applicationId => {
    const f = await setup(); const first = await f.service.create(actor, { name: "App" }, "en-US");
    await expect(f.service.delete({ ...actor, id: TASK }, first.id)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    await expect(f.service.reopen({ ...actor, status: "disabled" }, first.id, "en-US")).rejects.toMatchObject({ code: "USER_DISABLED" });
    await expect(f.service.delete({ ...actor, status: "disabled" }, first.id)).rejects.toMatchObject({ code: "USER_DISABLED" });
    f.row().applicationId = applicationId;
    await f.service.delete(actor, first.id);
    expect(f.applications.delete).not.toHaveBeenCalled();
    expect(f.store.deleteDraft).toHaveBeenCalledWith(OWNER, first.id);
    expect(f.conversations.delete).not.toHaveBeenCalled();
  });
  it("creates a working starter, reuses its project, and isolates the real test conversation", async () => {
    const f = await setup();
    const project = await f.service.create(actor, { name: "Test application" }, "zh-CN");
    expect(project).toMatchObject({ name: "Test application", conversation_id: TASK, application_id: null, revision: 1, preview_current: true });
    expect(project.preview_conversation_id).not.toBe(TASK);
    expect(project.icon).toEqual({ type: "preset", preset: "bot" });
    expect(f.applications.importInteractive).toHaveBeenCalledWith(actor, expect.any(Buffer), {}, [], expect.objectContaining({ developmentOnly: true }));
    expect(await readFile(join(f.workspace, project.directory, "app.js"), "utf8")).toContain("window.LinkSense.tasks.run");
    expect((await f.service.open(actor, TASK, { name: "Ignored" }, "en-US")).id).toBe(project.id);
    expect((await f.service.sync(actor, project.id)).revision).toBe(1);
    expect(f.applications.importInteractive).toHaveBeenCalledTimes(1);
    expect(f.conversations.createDevelopmentPreview).toHaveBeenCalledTimes(1);
  });
  it("detects file edits independently of the development turn and recovers from incomplete writes", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Example" }, "en-US");
    const manifest = join(f.workspace, first.directory, "manifest.json"); const original = await readFile(manifest);
    await writeFile(manifest, "{");
    expect(await f.service.sync(actor, first.id)).toMatchObject({ source_error: "APPLICATION_PACKAGE_INVALID", revision: 1, preview_conversation_id: first.preview_conversation_id });
    await writeFile(manifest, original);
    await writeFile(join(f.workspace, first.directory, "app.js"), "document.title='New version'");
    const updated = await f.service.sync(actor, first.id);
    expect(updated).toMatchObject({ source_error: null, revision: 2, preview_current: true });
    expect(updated.source_hash).not.toBe(first.source_hash);
    expect(updated.preview_conversation_id).toBe(first.preview_conversation_id);
    expect(f.conversations.createDevelopmentPreview).toHaveBeenLastCalledWith(OWNER, expect.objectContaining({ kind: "interactive" }), { id: first.id, revision: updated.revision, previousConversationId: first.preview_conversation_id });
  });
  it("does not replace a running test or mislabel its diagnostics; switches when it finishes", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Example" }, "en-US");
    f.store.isRunning.mockResolvedValue(true);
    await writeFile(join(f.workspace, first.directory, "app.js"), "document.title='New'");
    const next = await f.service.sync(actor, first.id);
    expect(next).toMatchObject({ revision: 2, preview_current: false, preview_conversation_id: first.preview_conversation_id });
    expect((await f.service.install(actor, next.id, next.source_hash!, { version_number: "1.0.0", usage_instructions: "" })).installed_source_hash).toBe(next.source_hash);
    expect((await f.service.get(actor, next.id)).preview_conversation_id).toBe(first.preview_conversation_id);
    f.store.isRunning.mockResolvedValue(false);
    expect(await f.service.sync(actor, first.id)).toMatchObject({ revision: 2, preview_current: true });
  });
  it("installs exactly the reviewed snapshot, keeps it immutable while editing, and updates in place", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Example" }, "en-US");
    const installed = await f.service.install(actor, first.id, first.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    expect(installed.application_id).not.toBe(first.preview_application_id);
    const bytes = f.installed.get(installed.application_id!)!;
    expect((await inspectInteractiveApplicationArchive(bytes)).manifest.version).toBe("1.0.0");
    expect(f.installed.size).toBe(1);
    await writeFile(join(f.workspace, first.directory, "app.js"), "document.title='Updated'");
    const updated = await f.service.sync(actor, first.id);
    expect(f.installed.get(installed.application_id!)).toEqual(bytes);
    const reinstalled = await f.service.install(actor, first.id, updated.source_hash!, { version_number: "1.0.1", usage_instructions: "" });
    expect(reinstalled.application_id).toBe(installed.application_id);
    expect(reinstalled.installed_source_hash).toBe(updated.source_hash);
    expect((await inspectInteractiveApplicationArchive(f.installed.get(installed.application_id!)!)).manifest.version).toBe("1.0.1");
  });
  it("rejects source changes that arrive after the last preview, without installing anything", async () => {
    const f = await setup(); const project = await f.service.create(actor, { name: "Example" }, "en-US");
    await writeFile(join(f.workspace, project.directory, "app.js"), "document.title='Unreviewed'");
    await expect(f.service.install(actor, project.id, project.source_hash!, { version_number: "1.0.0", usage_instructions: "" })).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });
    expect(f.installed.size).toBe(0);
  });
  it("preserves the published bytes and pending draft when publishing an update fails", async () => {
    const f = await setup();
    const first = await f.service.create(actor, { name: "Published" }, "en-US");
    const installed = await f.service.install(actor, first.id, first.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    const bytes = f.installed.get(installed.application_id!)!;
    await writeFile(join(f.workspace, first.directory, "app.js"), "document.title='Unpublished'");
    const changed = await f.service.sync(actor, first.id);
    f.applications.updateInteractivePackage.mockRejectedValueOnce(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    await expect(f.service.install(actor, first.id, changed.source_hash!, { version_number: "1.0.0", usage_instructions: "" })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.installed.get(installed.application_id!)).toEqual(bytes);
    expect(await f.service.get(actor, first.id)).toMatchObject({ source_hash: changed.source_hash, installed_source_hash: first.source_hash, application_id: installed.application_id });
  });
  it("keeps an unbound project editable and checks resources again before installation", async () => {
    const f = await setup(); f.applications.resolvePreviewRuntime.mockRejectedValue(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    const project = await f.service.create(actor, { name: "Example" }, "en-US");
    expect(project.preview_conversation_id).toBeNull();
    expect(project.preview_current).toBe(false);
    f.applications.resolvePreviewRuntime.mockResolvedValue({});
    const bound = await f.service.sync(actor, project.id);
    expect(bound.preview_current).toBe(true);
    f.applications.resolvePreviewRuntime.mockRejectedValue(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    await expect(f.service.install(actor, project.id, project.source_hash!, { version_number: "1.0.0", usage_instructions: "" })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("redacts secrets and internal paths from diagnostics and rejects stale reports", async () => {
    const f = await setup(); const project = await f.service.create(actor, { name: "Example" }, "en-US");
    await f.service.reportDiagnostics(actor, project.id, 1, [{ message: "token=private Bearer hidden /home/secret/file https://private.test/token", file: "https://example.test/a.js?secret=123", line: 2 }]);
    const diagnostics = (await f.service.get(actor, project.id)).diagnostics;
    expect(diagnostics[0]).toEqual({ message: "token=[redacted] Bearer [redacted] [path] [resource]", file: "a.js", line: 2 });
    await expect(f.service.reportDiagnostics(actor, project.id, 0, [])).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("checks owner, active account, current turn and collaboration mode before allowing tools", async () => {
    const f = await setup(); const project = await f.service.create(actor, { name: "Example" }, "en-US");
    await expect(f.service.sync({ ...actor, id: TASK }, project.id)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    await expect(f.service.create({ ...actor, status: "disabled" }, { name: "No" }, "en-US")).rejects.toMatchObject({ code: "USER_DISABLED" });
    f.store.assertActiveTurn.mockRejectedValue(new AppError("FORBIDDEN"));
    await expect(f.service.tool(actor, TASK, OWNER, { operation: "inspect" }, "en-US")).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.store.conversation.mockResolvedValue({ id: TASK, ownerId: OWNER, applicationId: null, collaborationMode: "plan", workspaceRelPath: `${OWNER}/home/workspace`, title: "Example" });
    await expect(f.service.open(actor, TASK, { name: "No" }, "en-US")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("returns the winning snapshot when concurrent preview publication loses its optimistic write", async () => {
    const f = await setup(); const first = await f.service.create(actor, { name: "Example" }, "en-US");
    await writeFile(join(f.workspace, first.directory, "app.js"), "document.title='New'");
    f.applications.updateInteractivePackage.mockRejectedValueOnce(new AppError("CONFLICT"));
    expect((await f.service.sync(actor, first.id)).revision).toBe(1);
    expect((await f.service.sync(actor, first.id)).revision).toBe(2);
  });
});
