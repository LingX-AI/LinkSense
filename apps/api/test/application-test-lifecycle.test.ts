import { afterEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import type { Prisma } from "../src/generated/prisma/client.js";
import { actor, developmentFixture, TASK } from "./application-development.fixture.js";
import { AppError } from "../src/lib/errors.js";
import { assertCurrentDevelopmentPreview, assertNotDevelopmentPreview, lockDevelopmentPreview } from "../src/modules/applications/development-preview-lifecycle.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() { const f = await developmentFixture(); roots.push(f.root); const project = await f.service.create(actor, { name: "Test" }, "zh-CN"); return { ...f, project }; }
describe("application test sessions", () => {
  it("starts a fresh context without publishing source and rejects duplicate or stale restart requests", async () => {
    const f = await setup(); const before = f.project;
    f.submittedTests.add(before.preview_conversation_id!);
    const input = { revision: before.revision, preview_conversation_id: before.preview_conversation_id };
    const next = await f.service.restartTest(actor, before.id, input);
    expect(next.preview_conversation_id).not.toBe(before.preview_conversation_id);
    expect(next.source_hash).toBe(before.source_hash);
    expect(f.applications.importInteractive).toHaveBeenCalledTimes(1);
    await expect(f.service.restartTest(actor, before.id, input)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
  });
  it("keeps the unused context when starting over before any test is submitted", async () => {
    const f = await setup();
    const next = await f.service.restartTest(actor, f.project.id, { revision: f.project.revision, preview_conversation_id: f.project.preview_conversation_id });
    expect(next.preview_conversation_id).toBe(f.project.preview_conversation_id);
    expect(next.revision).toBe(f.project.revision);
    expect(await f.service.testSessions(actor, f.project.id, { limit: 20 })).toEqual({ items: [], next_cursor: null });
  });
  it("allows another test with the same snapshot and surfaces missing resources", async () => {
    const f = await setup(); const input = { revision: f.project.revision, preview_conversation_id: f.project.preview_conversation_id };
    f.store.isRunning.mockResolvedValue(true);
    await expect(f.service.restartTest(actor, f.project.id, input)).resolves.toMatchObject({ source_hash: f.project.source_hash });
    f.store.isRunning.mockResolvedValue(false);
    f.applications.resolvePreviewRuntime.mockRejectedValue(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    await expect(f.service.restartTest(actor, f.project.id, input)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.conversations.createDevelopmentPreview).toHaveBeenCalledTimes(2);
  });
  it("rejects restart when the preview has been removed instead of reporting a new context", async () => {
    const f = await setup();
    f.store.previewState.mockResolvedValueOnce({ application: null, package_: null, conversation: null });
    await expect(f.service.restartTest(actor, f.project.id, { revision: f.project.revision, preview_conversation_id: f.project.preview_conversation_id }))
      .rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });
    expect(f.conversations.createDevelopmentPreview).toHaveBeenCalledTimes(1);
  });
  it("checks ownership for reads, inspection and deletion and never deletes the current session", async () => {
    const f = await setup();
    await expect(f.service.testSessions({ ...actor, id: TASK }, f.project.id, { limit: 20 })).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    await expect(f.service.deleteTest(actor, f.project.id, f.project.preview_conversation_id!)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
    f.store.assertTestSession.mockRejectedValueOnce(new AppError("CONVERSATION_NOT_FOUND"));
    await expect(f.service.deleteTest(actor, f.project.id, TASK)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(f.conversations.delete).not.toHaveBeenCalled();
    await f.service.deleteTest(actor, f.project.id, TASK);
    expect(f.conversations.delete).toHaveBeenCalledWith(actor.id, TASK, {});
    await f.service.tool(actor, TASK, TASK, { operation: "tests", conversation_id: TASK }, "zh-CN");
    expect(f.store.inspectTest).toHaveBeenCalledWith(expect.objectContaining({ id: f.project.id }), TASK);
  });
});

describe("preview admission boundaries", () => {
  function txFixture() {
    const db = { conversation: { findUnique: vi.fn(async () => ({ interactiveApplicationPackageId: null })) }, $queryRaw: vi.fn(async () => [{ id: TASK }]), conversationTurn: { count: vi.fn(async () => 0) }, conversationTurnStartIntent: { count: vi.fn(async () => 0) }, pendingRequest: { count: vi.fn(async () => 0) } };
    return { db, tx: db as unknown as Prisma.TransactionClient };
  }
  it("rejects a project removed or changed after runtime preparation", async () => {
    const { db, tx } = txFixture(); db.$queryRaw.mockResolvedValueOnce([]);
    await expect(lockDevelopmentPreview(tx, actor.id, TASK, TASK, { id: TASK, revision: 1, previousConversationId: null })).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it.each(["conversationTurn", "conversationTurnStartIntent", "pendingRequest"] as const)("checks %s again while holding the session lock", async kind => {
    const { db, tx } = txFixture(); db[kind].count.mockResolvedValueOnce(1);
    await expect(lockDevelopmentPreview(tx, actor.id, TASK, TASK, { id: TASK, revision: 1, previousConversationId: TASK })).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_BUSY" });
  });
  it("rejects stale test turns and generic creation of preview tasks", async () => {
    const { tx } = txFixture();
    await expect(assertCurrentDevelopmentPreview(tx, actor.id, TASK, TASK, TASK)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_CHANGED" });
    await expect(assertNotDevelopmentPreview(tx, TASK)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
