import { describe, expect, it, vi } from "vitest";
import { taskReferencesInputSchema, readConversationReferenceInputSchema } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { prepareTaskReferences, readTaskReference } from "../src/modules/conversations/task-references.js";

const owner = "11111111-1111-4111-8111-111111111111";
const task = "22222222-2222-4222-8222-222222222222";
const source = "33333333-3333-4333-8333-333333333333";
const turn = "44444444-4444-4444-8444-444444444444";
const message = "55555555-5555-4555-8555-555555555555";
function fixture() {
  const display = { kind: "task_references", request: "Compare these tasks", conversation_ids: [source], sources: [{ id: source, title: "Research" }] };
  const db = {
    conversation: { findUnique: vi.fn().mockResolvedValue({ ownerId: owner }), findMany: vi.fn().mockResolvedValue([{ id: source, title: "Research" }]), findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id === task ? { codexThreadId: "native-current" } : { id: source, title: "Research", codexThreadId: "native-source" })) },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue({ id: turn }), findMany: vi.fn().mockResolvedValue([{ id: turn }]) },
    conversationEvent: { findMany: vi.fn().mockResolvedValue([{ payloadJson: { schema_version: 1, display } }]) },
    conversationPlanReview: { findMany: vi.fn().mockResolvedValue([]) },
    conversationMessage: { findMany: vi.fn().mockResolvedValue([{ id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "A finding" }]) },
  };
  return { db, prisma: db as unknown as PrismaClient, display };
}
describe("explicit task references", () => {
  it("validates the source owner and does not copy its history into the submitted prompt", async () => {
    const { db, prisma } = fixture();
    const result = await prepareTaskReferences(prisma, task, taskReferencesInputSchema.parse({ kind: "task_references", request: "Compare", conversation_ids: [source] }));
    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: owner, sideChatParentId: null, applicationId: null }) }));
    expect(result.inputText).toContain("read_referenced_conversation");
    expect(result.inputText).not.toContain("A finding");
    expect(db.conversationMessage.findMany).not.toHaveBeenCalled();
  });
  it("rejects a source owned by another account", async () => {
    const { db, prisma } = fixture(); db.conversation.findMany.mockResolvedValue([]);
    await expect(prepareTaskReferences(prisma, task, taskReferencesInputSchema.parse({ kind: "task_references", request: "Compare", conversation_ids: [source] }))).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
  it("does not grant access from a pasted ID or prompt when no host-written sidecar exists", async () => {
    const { db, prisma } = fixture(); db.conversationEvent.findMany.mockResolvedValue([]);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.conversationMessage.findMany).not.toHaveBeenCalled();
  });
  it("reads only the selected source and current native history with an explicit continuation", async () => {
    const { db, prisma } = fixture();
    db.conversationMessage.findMany.mockResolvedValue([{ id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "x".repeat(16_100) }]);
    const first = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0 });
    expect(first.messages[0]?.text).toHaveLength(16_000);
    expect(first).toMatchObject({ next_cursor: "1", next_offset: 16_000 });
    const second = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: first.next_cursor!, offset: first.next_offset });
    expect(second.messages[0]?.text).toHaveLength(100);
    expect(second.next_cursor).toBeNull();
    expect(db.conversationTurn.findMany).toHaveBeenCalledWith({ where: { conversationId: source, codexThreadId: "native-source" }, select: { id: true } });
  });
  it("rejects an unselected source and an inactive turn", async () => {
    const { db, prisma } = fixture();
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: task, cursor: "0", offset: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    db.conversationTurn.findFirst.mockResolvedValue(null);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("can continue an existing native message beyond one million characters", async () => {
    const { db, prisma } = fixture();
    db.conversationMessage.findMany.mockResolvedValue([{ id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "x".repeat(1_016_000) }]);
    const first = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "1", offset: 992_000 });
    const continuation = readConversationReferenceInputSchema.parse({ conversation_id: source, cursor: first.next_cursor, offset: first.next_offset });
    const second = await readTaskReference(prisma, owner, task, turn, continuation);
    expect(second.messages[0]?.text).toHaveLength(8_000);
    expect(second.next_cursor).toBeNull();
  });
  it("fails closed if a source disappears while its history is being read", async () => {
    const { db, prisma } = fixture();
    db.conversation.findFirst.mockResolvedValueOnce({ codexThreadId: "native-current" }).mockResolvedValueOnce({ id: source, title: "Research", codexThreadId: "native-source" }).mockResolvedValueOnce(null);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0 })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
});
