import { describe, expect, it, vi } from "vitest";
import { taskReferencesInputSchema, readConversationReferenceInputSchema, type ReadConversationReferenceInput } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { prepareTaskReferences, readTaskReference } from "../src/modules/conversations/task-references.js";
import { OFFICE_ANNOTATION_PROMPT_MARKER } from "../src/modules/conversations/annotation-prompt.js";

const owner = "11111111-1111-4111-8111-111111111111";
const task = "22222222-2222-4222-8222-222222222222";
const source = "33333333-3333-4333-8333-333333333333";
const turn = "44444444-4444-4444-8444-444444444444";
const message = "55555555-5555-4555-8555-555555555555";
const olderMessage = "66666666-6666-4666-8666-666666666666";
const emptyMessage = "77777777-7777-4777-8777-777777777777";
type HistoryMessage = { id: string; role: string; sequenceNo: number; turnId: string; contentText: string };
function fixture(history?: HistoryMessage[]) {
  const display = { kind: "task_references", request: "Compare these tasks", conversation_ids: [source], sources: [{ id: source, title: "Research" }] };
  const db = {
    conversation: { findUnique: vi.fn().mockResolvedValue({ ownerId: owner }), findMany: vi.fn().mockResolvedValue([{ id: source, title: "Research" }]), findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id === task ? { codexThreadId: "native-current" } : { id: source, title: "Research", codexThreadId: "native-source" })) },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue({ id: turn }), findMany: vi.fn().mockResolvedValue([{ id: turn }]) },
    conversationEvent: { findMany: vi.fn().mockResolvedValue([{ payloadJson: { schema_version: 1, display } }]) },
    conversationPlanReview: { findMany: vi.fn().mockResolvedValue([]) },
    conversationMessage: { findMany: vi.fn().mockImplementation(({ where, orderBy, take }) => {
      const rows = history ?? [{ id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "A finding" }];
      const sequence = where.sequenceNo;
      return Promise.resolve(rows.filter(row => where.turnId.in.includes(row.turnId) && where.role.in.includes(row.role)
        && (typeof sequence !== "number" || row.sequenceNo === sequence)
        && (sequence?.gt === undefined || row.sequenceNo > sequence.gt)
        && (sequence?.gte === undefined || row.sequenceNo >= sequence.gte)
        && (sequence?.lt === undefined || row.sequenceNo < sequence.lt)
        && (sequence?.lte === undefined || row.sequenceNo <= sequence.lte))
        .sort((left, right) => orderBy.sequenceNo === "desc" ? right.sequenceNo - left.sequenceNo : left.sequenceNo - right.sequenceNo).slice(0, take));
    }) },
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
  it.each([undefined, "latest_assistant"] as const)("does not grant access from a pasted ID or prompt without a sidecar in mode %s", async mode => {
    const { db, prisma } = fixture(); db.conversationEvent.findMany.mockResolvedValue([]);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0, mode })).rejects.toMatchObject({ code: "FORBIDDEN" });
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
  it.each([undefined, "latest_assistant"] as const)("rejects an unselected source and an inactive turn in mode %s", async mode => {
    const { db, prisma } = fixture();
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: task, cursor: "0", offset: 0, mode })).rejects.toMatchObject({ code: "FORBIDDEN" });
    db.conversationTurn.findFirst.mockResolvedValue(null);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0, mode })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([undefined, "latest_assistant"] as const)("rejects a source unavailable to the current owner in mode %s", async mode => {
    const { db, prisma } = fixture();
    db.conversation.findFirst.mockResolvedValueOnce({ codexThreadId: "native-current" }).mockResolvedValueOnce(null);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0, mode })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(db.conversationMessage.findMany).not.toHaveBeenCalled();
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
  it.each([undefined, "latest_assistant"] as const)("fails closed if a source disappears while being read in mode %s", async mode => {
    const { db, prisma } = fixture();
    db.conversation.findFirst.mockResolvedValueOnce({ codexThreadId: "native-current" }).mockResolvedValueOnce({ id: source, title: "Research", codexThreadId: "native-source" }).mockResolvedValueOnce(null);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, cursor: "0", offset: 0, mode })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
  it("reads the latest assistant reply in one call despite a long initial message and later user/tool messages", async () => {
    const history = [
      { id: olderMessage, role: "user", sequenceNo: 1, turnId: turn, contentText: "x".repeat(1_016_050) },
      ...Array.from({ length: 10 }, (_, index) => ({ id: index === 9 ? message : `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`, role: "assistant", sequenceNo: index + 2, turnId: turn, contentText: `OK${index + 1}` })),
      { id: "88888888-8888-4888-8888-888888888888", role: "assistant", sequenceNo: 12, turnId: "99999999-9999-4999-8999-999999999999", contentText: "Old thread reply" },
      { id: emptyMessage, role: "user", sequenceNo: 13, turnId: turn, contentText: "A newer question" },
      { id: "99999999-9999-4999-8999-999999999999", role: "tool", sequenceNo: 14, turnId: turn, contentText: "Private tool output" },
    ];
    const { db, prisma } = fixture(history);
    const result = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 });
    expect(result).toMatchObject({ messages: [{ id: message, role: "assistant", text: "OK10" }], next_cursor: null, next_offset: 0 });
    expect(db.conversationMessage.findMany).toHaveBeenCalledTimes(1);
    expect(db.conversationMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { in: ["assistant"] } }), orderBy: { sequenceNo: "desc" } }));
    expect(db.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: source, ownerId: owner, sideChatParentId: null, applicationId: null } }));
  });
  it("continues only the chosen latest reply, preserving its text when a newer reply arrives", async () => {
    const text = `  Original reply\n${"正文\n".repeat(11_000)}  `;
    const history = [
      { id: olderMessage, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "Older reply" },
      { id: message, role: "assistant", sequenceNo: 2, turnId: turn, contentText: text },
    ];
    const { prisma } = fixture(history);
    let input: ReadConversationReferenceInput = { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 };
    const parts: string[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await readTaskReference(prisma, owner, task, turn, input);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toMatchObject({ id: message, role: "assistant" });
      parts.push(result.messages[0]!.text);
      if (page === 2) expect(result).toMatchObject({ next_cursor: null, next_offset: 0 });
      else {
        expect(result).toMatchObject({ next_cursor: "2", next_offset: (page + 1) * 16_000 });
        input = readConversationReferenceInputSchema.parse({ ...input, cursor: result.next_cursor, offset: result.next_offset });
        if (page === 0) history.push({ id: emptyMessage, role: "assistant", sequenceNo: 3, turnId: turn, contentText: "A newly appended reply" });
      }
    }
    expect(parts.join("")).toBe(text);
  });
  it("skips superseded and empty assistant messages when choosing the latest visible reply", async () => {
    const { db, prisma, display } = fixture([
      { id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "Visible reply" },
      { id: emptyMessage, role: "assistant", sequenceNo: 2, turnId: turn, contentText: "" },
      { id: olderMessage, role: "assistant", sequenceNo: 3, turnId: turn, contentText: "Superseded plan" },
    ]);
    db.conversationPlanReview.findMany.mockResolvedValue([{ sourceTurnId: turn }]);
    db.conversationEvent.findMany.mockImplementation(({ where }) => Promise.resolve(where.eventType === "hook/completed"
      ? [{ turnId: turn, payloadJson: { method: "hook/completed", params: { run: { eventName: "stop", status: "blocked" }, supersededItemId: "draft" }, local: { superseded_item_id: "draft", superseded_message_id: olderMessage } } }]
      : [{ payloadJson: { schema_version: 1, display } }]));
    const result = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 });
    expect(result).toMatchObject({ messages: [{ id: message, role: "assistant", text: "Visible reply" }], next_cursor: null, next_offset: 0 });
  });
  it("returns no latest reply when the source has only user messages", async () => {
    const { prisma } = fixture([{ id: message, role: "user", sequenceNo: 1, turnId: turn, contentText: "A question" }]);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 })).resolves.toMatchObject({ messages: [], next_cursor: null, next_offset: 0 });
  });
  it("continues past a full page of hidden candidates before choosing the latest visible reply", async () => {
    const hidden = Array.from({ length: 21 }, (_, index) => ({ id: `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`, role: "assistant", sequenceNo: index + 2, turnId: turn, contentText: "Superseded plan" }));
    const { db, prisma, display } = fixture([{ id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "Visible reply" }, ...hidden]);
    db.conversationPlanReview.findMany.mockResolvedValue([{ sourceTurnId: turn }]);
    db.conversationEvent.findMany.mockImplementation(({ where }) => Promise.resolve(where.eventType === "hook/completed"
      ? hidden.map(row => ({ turnId: turn, payloadJson: { method: "hook/completed", params: { run: { eventName: "stop", status: "blocked" }, supersededItemId: row.id }, local: { superseded_item_id: row.id, superseded_message_id: row.id } } }))
      : [{ payloadJson: { schema_version: 1, display } }]));
    const first = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 });
    expect(first).toMatchObject({ messages: [], next_cursor: "3", next_offset: 0 });
    const second = await readTaskReference(prisma, owner, task, turn, readConversationReferenceInputSchema.parse({ conversation_id: source, mode: "latest_assistant", cursor: first.next_cursor, offset: first.next_offset }));
    expect(second).toMatchObject({ messages: [{ id: message, role: "assistant", text: "Visible reply" }], next_cursor: null, next_offset: 0 });
  });
  it("preserves literal annotation markers and metadata that belong to the original assistant text", async () => {
    const text = `${OFFICE_ANNOTATION_PROMPT_MARKER}\n\nExample metadata: next_cursor and next_offset.\n  `;
    const { prisma } = fixture([{ id: message, role: "assistant", sequenceNo: 1, turnId: turn, contentText: text }]);
    await expect(readTaskReference(prisma, owner, task, turn, { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 })).resolves.toMatchObject({ messages: [{ id: message, role: "assistant", text }], next_cursor: null, next_offset: 0 });
  });
  it("does not splice an older reply into a continuation when the chosen reply disappears", async () => {
    const history = [
      { id: olderMessage, role: "assistant", sequenceNo: 1, turnId: turn, contentText: "Older reply" },
      { id: message, role: "assistant", sequenceNo: 2, turnId: turn, contentText: "x".repeat(16_100) },
    ];
    const { prisma } = fixture(history);
    const first = await readTaskReference(prisma, owner, task, turn, { conversation_id: source, mode: "latest_assistant", cursor: "0", offset: 0 });
    history.pop();
    await expect(readTaskReference(prisma, owner, task, turn, readConversationReferenceInputSchema.parse({ conversation_id: source, mode: "latest_assistant", cursor: first.next_cursor, offset: first.next_offset }))).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
  it.each([undefined, "history"] as const)("preserves pre-change chronological history and continuation in mode %s", async mode => {
    const history = Array.from({ length: 22 }, (_, index) => ({ id: `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`, role: index % 2 ? "assistant" : "user", sequenceNo: index + 1, turnId: turn, contentText: index === 0 ? "x".repeat(16_005) : `Original message ${index}` }));
    const { prisma } = fixture(history);
    let input = readConversationReferenceInputSchema.parse({ conversation_id: source, ...(mode ? { mode } : {}) });
    const collected = new Map<string, string>();
    for (let page = 0; page < 3; page++) {
      const result = await readTaskReference(prisma, owner, task, turn, input);
      for (const row of result.messages) collected.set(row.id, (collected.get(row.id) ?? "") + row.text);
      if (page === 2) expect(result).toMatchObject({ next_cursor: null, next_offset: 0 });
      else {
        expect(result.next_cursor).not.toBeNull();
        input = readConversationReferenceInputSchema.parse({ ...input, cursor: result.next_cursor, offset: result.next_offset });
      }
    }
    expect([...collected]).toEqual(history.map(row => [row.id, row.contentText]));
  });
});
