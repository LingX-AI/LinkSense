import { describe, expect, it } from "vitest";

import { inspectClawHubManifest } from "../src/modules/clawhub/manifest-policy.js";
import {
  CLAWHUB_FILE_BYTE_LIMIT,
  CLAWHUB_VERSION_FILE_COUNT_LIMIT,
  type ClawHubVersionFile,
} from "../src/modules/clawhub/types.js";

describe("inspectClawHubManifest", () => {
  it("blocks versions whose file manifest is unavailable", () => {
    expect(inspectClawHubManifest([])).toEqual({
      totalFileBytes: 0,
      installBlockReason: "files_unavailable",
    });
  });

  it("keeps an installable manifest and its exact total", () => {
    expect(
      inspectClawHubManifest([
        versionFile("SKILL.md", 15),
        versionFile("references/guide.md", 20),
      ]),
    ).toEqual({ totalFileBytes: 35, installBlockReason: null });
  });

  it("marks unsafe and normalized duplicate paths without rejecting metadata", () => {
    expect(
      inspectClawHubManifest([
        versionFile("../secret", 1),
        versionFile("Guide.md", 1),
        versionFile("guide.md", 1),
      ]),
    ).toEqual({
      totalFileBytes: 3,
      installBlockReason: "manifest_unsafe",
    });
  });

  it("marks manifests outside install size and file-count limits", () => {
    const tooMany = Array.from(
      { length: CLAWHUB_VERSION_FILE_COUNT_LIMIT + 1 },
      (_, index) => versionFile(`${index}.txt`, 1),
    );
    expect(inspectClawHubManifest(tooMany).installBlockReason).toBe(
      "manifest_too_large",
    );
    expect(
      inspectClawHubManifest([
        versionFile("large.bin", CLAWHUB_FILE_BYTE_LIMIT + 1),
      ]).installBlockReason,
    ).toBe("manifest_too_large");
  });

  it("saturates totals at Number.MAX_SAFE_INTEGER instead of overflowing", () => {
    expect(
      inspectClawHubManifest([
        versionFile("one.bin", Number.MAX_SAFE_INTEGER),
        versionFile("two.bin", Number.MAX_SAFE_INTEGER),
      ]),
    ).toEqual({
      totalFileBytes: Number.MAX_SAFE_INTEGER,
      installBlockReason: "manifest_too_large",
    });
  });
});

function versionFile(path: string, size: number): ClawHubVersionFile {
  return {
    path,
    size,
    sha256: "a".repeat(64),
    contentType: "application/octet-stream",
  };
}
