import { describe, expect, it } from "vitest";

import { AppError } from "../src/lib/errors.js";
import {
  KNOWLEDGE_DIRECTORY_MAX_DEPTH,
  normalizeKnowledgeDirectoryPath,
} from "../src/modules/knowledge/directory-path.js";

describe("knowledge directory paths", () => {
  it("preserves nested relative segments while normalizing Unicode", () => {
    expect(
      normalizeKnowledgeDirectoryPath(
        "政策/人事/ＡＩ 手册.pdf",
        "ＡＩ 手册.pdf",
      ),
    ).toEqual({
      segments: ["政策", "人事", "AI 手册.pdf"],
      normalizedSegments: ["政策", "人事", "ai 手册.pdf"],
    });
  });

  it.each([
    "/absolute/manual.pdf",
    "../manual.pdf",
    "folder/../manual.pdf",
    "folder//manual.pdf",
    "folder\\manual.pdf",
    "folder/manual.pdf/",
  ])("rejects an unsafe relative path: %s", (relativePath) => {
    expect(() =>
      normalizeKnowledgeDirectoryPath(relativePath, "manual.pdf"),
    ).toThrowError(AppError);
  });

  it("rejects a path whose leaf does not match the uploaded filename", () => {
    expect(() =>
      normalizeKnowledgeDirectoryPath("folder/other.pdf", "manual.pdf"),
    ).toThrowError(AppError);
  });

  it("rejects paths deeper than the bounded directory depth", () => {
    const relativePath = [
      ...Array.from({ length: KNOWLEDGE_DIRECTORY_MAX_DEPTH }, () => "folder"),
      "manual.pdf",
    ].join("/");
    expect(() =>
      normalizeKnowledgeDirectoryPath(relativePath, "manual.pdf"),
    ).toThrowError(AppError);
  });

  it("rejects a path that exceeds the total bound after Unicode normalization", () => {
    const expandingSegment = "ﬀ".repeat(130);
    const relativePath = [
      ...Array.from(
        { length: KNOWLEDGE_DIRECTORY_MAX_DEPTH - 1 },
        () => expandingSegment,
      ),
      "a.pdf",
    ].join("/");
    expect(relativePath.length).toBeLessThan(
      16_384,
    );

    expect(() =>
      normalizeKnowledgeDirectoryPath(relativePath, "a.pdf"),
    ).toThrowError(AppError);
  });
});
