import { describe, expect, it } from "vitest";

import { taskArtifactFileTypeSchema } from "../src/task-artifacts.js";

describe("task artifact file type contract", () => {
  it.each([
    "image", "word", "excel", "powerpoint", "html", "pdf",
    "archive", "text", "audio", "video", "other",
  ])("accepts the %s file category", (value) => {
    expect(taskArtifactFileTypeSchema.parse(value)).toBe(value);
  });

  it.each(["all", "docx", "IMAGE", "", null, ["image", "word"]])(
    "rejects unsupported or non-scalar file types: %j",
    (value) => {
      expect(taskArtifactFileTypeSchema.safeParse(value).success).toBe(false);
    },
  );
});
