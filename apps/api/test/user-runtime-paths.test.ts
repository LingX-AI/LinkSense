import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertConversationWorkspacePath,
  projectWorkspaceRelativePath,
  resolveConversationWorkspaceEntry,
  resolveConversationWorkspaceRoot,
} from "../src/lib/user-runtime-paths.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_PATH = `${OWNER_ID}/home/projects/${PROJECT_ID}`;

describe("user runtime workspace paths", () => {
  it("resolves shared project files below their owning user directory", () => {
    expect(
      projectWorkspaceRelativePath(OWNER_ID, PROJECT_ID),
    ).toBe(`${OWNER_ID}/home/projects/${PROJECT_ID}`);
    expect(
      resolveConversationWorkspaceRoot("/srv/workspaces", OWNER_ID, WORKSPACE_PATH),
    ).toBe(`/srv/workspaces/${OWNER_ID}/home/projects/${PROJECT_ID}`);
    expect(
      resolveConversationWorkspaceEntry(
        "/srv/workspaces",
        OWNER_ID,
        WORKSPACE_PATH,
        "attachments/file.txt",
      ),
    ).toBe(
      `/srv/workspaces/${OWNER_ID}/home/projects/${PROJECT_ID}/attachments/file.txt`,
    );
  });

  it("rejects invalid owner and conversation identifiers", () => {
    expect(() =>
      resolveConversationWorkspaceRoot("/srv/workspaces", "../owner", WORKSPACE_PATH),
    ).toThrow("ownerId must be a UUID");
    expect(() =>
      resolveConversationWorkspaceRoot("/srv/workspaces", OWNER_ID, "conversation"),
    ).toThrow("workspace belongs to another user");
  });

  it("rejects absolute paths, parent traversal, the root itself, and sibling prefixes", () => {
    const root = resolveConversationWorkspaceRoot(
      "/srv/workspaces",
      OWNER_ID,
      WORKSPACE_PATH,
    );
    expect(() =>
      resolveConversationWorkspaceEntry(
        "/srv/workspaces",
        OWNER_ID,
        WORKSPACE_PATH,
        "/etc/passwd",
      ),
    ).toThrow("non-empty relative path");
    expect(() =>
      resolveConversationWorkspaceEntry(
        "/srv/workspaces",
        OWNER_ID,
        WORKSPACE_PATH,
        "../other/file.txt",
      ),
    ).toThrow("outside its project root");
    expect(() =>
      assertConversationWorkspacePath(
        "/srv/workspaces",
        OWNER_ID,
        WORKSPACE_PATH,
        root,
      ),
    ).toThrow("outside its project root");
    expect(() =>
      assertConversationWorkspacePath(
        "/srv/workspaces",
        OWNER_ID,
        WORKSPACE_PATH,
        `${root}-other/file.txt`,
      ),
    ).toThrow("outside its project root");
    expect(
      assertConversationWorkspacePath(
        "/srv/workspaces",
        OWNER_ID,
        WORKSPACE_PATH,
        join(root, "attachments", "file.txt"),
      ),
    ).toBe(join(root, "attachments", "file.txt"));
  });
});
