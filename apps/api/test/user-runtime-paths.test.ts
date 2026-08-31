import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertConversationWorkspacePath,
  conversationWorkspaceRelativePath,
  resolveConversationWorkspaceEntry,
  resolveConversationWorkspaceRoot,
} from "../src/lib/user-runtime-paths.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

describe("user runtime workspace paths", () => {
  it("resolves a conversation below its isolated user directory", () => {
    expect(
      conversationWorkspaceRelativePath(OWNER_ID, CONVERSATION_ID),
    ).toBe(`${OWNER_ID}/home/workspaces/${CONVERSATION_ID}`);
    expect(
      resolveConversationWorkspaceRoot("/srv/workspaces", OWNER_ID, CONVERSATION_ID),
    ).toBe(`/srv/workspaces/${OWNER_ID}/home/workspaces/${CONVERSATION_ID}`);
    expect(
      resolveConversationWorkspaceEntry(
        "/srv/workspaces",
        OWNER_ID,
        CONVERSATION_ID,
        "attachments/file.txt",
      ),
    ).toBe(
      `/srv/workspaces/${OWNER_ID}/home/workspaces/${CONVERSATION_ID}/attachments/file.txt`,
    );
  });

  it("rejects invalid owner and conversation identifiers", () => {
    expect(() =>
      resolveConversationWorkspaceRoot("/srv/workspaces", "../owner", CONVERSATION_ID),
    ).toThrow("ownerId must be a UUID");
    expect(() =>
      resolveConversationWorkspaceRoot("/srv/workspaces", OWNER_ID, "conversation"),
    ).toThrow("conversationId must be a UUID");
  });

  it("rejects absolute paths, parent traversal, the root itself, and sibling prefixes", () => {
    const root = resolveConversationWorkspaceRoot(
      "/srv/workspaces",
      OWNER_ID,
      CONVERSATION_ID,
    );
    expect(() =>
      resolveConversationWorkspaceEntry(
        "/srv/workspaces",
        OWNER_ID,
        CONVERSATION_ID,
        "/etc/passwd",
      ),
    ).toThrow("non-empty relative path");
    expect(() =>
      resolveConversationWorkspaceEntry(
        "/srv/workspaces",
        OWNER_ID,
        CONVERSATION_ID,
        "../other/file.txt",
      ),
    ).toThrow("outside its conversation root");
    expect(() =>
      assertConversationWorkspacePath(
        "/srv/workspaces",
        OWNER_ID,
        CONVERSATION_ID,
        root,
      ),
    ).toThrow("outside its conversation root");
    expect(() =>
      assertConversationWorkspacePath(
        "/srv/workspaces",
        OWNER_ID,
        CONVERSATION_ID,
        `${root}-other/file.txt`,
      ),
    ).toThrow("outside its conversation root");
    expect(
      assertConversationWorkspacePath(
        "/srv/workspaces",
        OWNER_ID,
        CONVERSATION_ID,
        join(root, "attachments", "file.txt"),
      ),
    ).toBe(join(root, "attachments", "file.txt"));
  });
});
