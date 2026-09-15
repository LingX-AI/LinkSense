import { describe, expect, it } from "vitest";

import { projectWorkspacePath, userWorkspacePathSchema } from "./runtime-workspace.js";

describe("personal project workspace", () => {
  it("gives all projectless tasks one workspace and each project a stable directory", () => {
    expect(projectWorkspacePath(null)).toBe("workspace");
    expect(projectWorkspacePath("AAAAAAAA-1111-4111-8111-111111111111")).toBe("projects/aaaaaaaa-1111-4111-8111-111111111111");
  });

  it.each(["../other", "/tmp/project", "projects/../workspace", "projects/invalid", "workspace/child", "task-homes/aaaaaaaa-1111-4111-8111-111111111111"])("rejects invalid or task-specific directory %s", value => {
    expect(userWorkspacePathSchema.safeParse(value).success).toBe(false);
  });
});
