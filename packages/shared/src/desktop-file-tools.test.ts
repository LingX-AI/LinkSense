import { describe, expect, it } from "vitest";

import {
  desktopCloudToolInvocationSchema,
  desktopCloudToolOperationSchema,
} from "./desktop-cloud-tools.js";
import {
  desktopRelativePathSchema,
  localFilesWriteInputSchema,
} from "./desktop-file-tools.js";

const root = "50000000-0000-4000-8000-000000000001";

describe("desktop file tool inputs", () => {
  it("accepts only root-relative portable paths", () => {
    for (const value of ["notes.txt", "src/app.ts", "a b/c-d.md", "目录/文件.txt"]) {
      expect(desktopRelativePathSchema.parse(value)).toBe(value);
    }
    for (const value of ["", "/etc/passwd", "../secret", "a/../b", "a//b", "a/./b", "a\\b", "a\0b"]) {
      expect(desktopRelativePathSchema.safeParse(value).success).toBe(false);
    }
  });

  it("defaults write conflict and parent behavior without accepting unknown fields", () => {
    expect(localFilesWriteInputSchema.parse({
      root_id: root, path: "notes.txt", content: "",
    })).toEqual({
      root_id: root, path: "notes.txt", content: "", create_parents: false,
    });
    expect(localFilesWriteInputSchema.safeParse({
      root_id: root, path: "notes.txt", content: "", secret: true,
    }).success).toBe(false);
  });

  it("round-trips the root listing and file invocations", () => {
    expect(desktopCloudToolOperationSchema.parse("local_files.roots"))
      .toBe("local_files.roots");
    expect(desktopCloudToolInvocationSchema.parse({
      operation: "local_files.list", input: { root_id: root, limit: 10 },
    })).toEqual({
      operation: "local_files.list",
      input: { root_id: root, limit: 10 },
    });
    expect(desktopCloudToolInvocationSchema.safeParse({
      operation: "local_files.read", input: { root_id: root, path: "/etc/passwd" },
    }).success).toBe(false);
  });
});
