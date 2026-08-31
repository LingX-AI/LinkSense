import { describe, expect, it } from "vitest";

import {
  isMeaninglessTemporaryUploadFilename,
  isMeaninglessTemporaryUploadPath,
} from "../src/index.js";

describe("temporary upload file detection", () => {
  it.each([
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "._budget.xlsx",
    "~$budget.xlsx",
    ".~lock.budget.xlsx#",
    "#notes.md#",
    "draft.tmp",
    "video.crdownload",
    "archive.part",
    "notes.swp",
  ])("treats %s as a meaningless temporary upload", (filename) => {
    expect(isMeaninglessTemporaryUploadFilename(filename)).toBe(true);
  });

  it.each([
    "budget.custom",
    ".env",
    "README",
    "archive.bak",
    "data.unknown-format",
  ])("keeps meaningful upload candidate %s", (filename) => {
    expect(isMeaninglessTemporaryUploadFilename(filename)).toBe(false);
  });

  it("detects temporary metadata files inside selected folders", () => {
    expect(
      isMeaninglessTemporaryUploadPath("project/__MACOSX/._report.pdf"),
    ).toBe(true);
    expect(
      isMeaninglessTemporaryUploadPath("project/.TemporaryItems/draft.tmp"),
    ).toBe(true);
    expect(isMeaninglessTemporaryUploadPath("project/src/index.weird")).toBe(
      false,
    );
  });
});
