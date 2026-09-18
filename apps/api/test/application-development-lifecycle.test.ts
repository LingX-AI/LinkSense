import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../src/generated/prisma/client.js";
import { detachConversationDevelopment } from "../src/modules/applications/development-cleanup.js";
import { lockDetachedDevelopment } from "../src/modules/applications/development-conversation-lifecycle.js";
import { assertProjectHasNoApplicationSources } from "../src/modules/projects/runtime-state.js";

describe("independent application lifecycle", () => {
  it("only detaches the conversation when a developer task is deleted, preserving draft, application and tests", async () => {
    const db = { applicationDevelopment: { updateMany: vi.fn(), deleteMany: vi.fn() }, application: { updateMany: vi.fn() }, conversation: { deleteMany: vi.fn() } };
    await detachConversationDevelopment(db as unknown as Prisma.TransactionClient, "development-task");
    expect(db.applicationDevelopment.updateMany.mock.calls).toEqual([
      [{ where: { conversationId: "development-task" }, data: { conversationId: null } }],
      [{ where: { previewConversationId: "development-task" }, data: { previewConversationId: null } }],
    ]);
    expect(db.applicationDevelopment.deleteMany).not.toHaveBeenCalled();
    expect(db.application.updateMany).not.toHaveBeenCalled();
    expect(db.conversation.deleteMany).not.toHaveBeenCalled();
  });

  it.each([true, false])("locks only an owned detached draft before creating a conversation (available: %s)", async available => {
    const query = vi.fn<(query: Prisma.Sql) => Promise<Array<{ id: string }>>>().mockResolvedValue(available ? [{ id: "draft" }] : []);
    const result = lockDetachedDevelopment({ $queryRaw: query } as unknown as Prisma.TransactionClient, "owner",
      { id: "draft", projectId: "project", workspaceRelPath: "source" });
    if (available) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
    expect(query.mock.calls[0]?.[0]).toMatchObject({ values: ["draft", "owner", "source", "project"] });
    expect(query.mock.calls[0]?.[0].sql).toContain("conversation_id IS NULL");
  });

  it.each([true, false])("protects source projects even without any remaining developer task (has sources: %s)", async hasSources => {
    const query = vi.fn<(query: Prisma.Sql) => Promise<Array<{ id: string }>>>().mockResolvedValue(hasSources ? [{ id: "draft" }] : []);
    const result = assertProjectHasNoApplicationSources({ $queryRaw: query } as unknown as Prisma.TransactionClient, "owner", "project");
    if (hasSources) await expect(result).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_WORKSPACE_BOUND" });
    else await expect(result).resolves.toBeUndefined();
    expect(query.mock.calls[0]?.[0]).toMatchObject({ values: ["owner", "project"] });
  });
});
