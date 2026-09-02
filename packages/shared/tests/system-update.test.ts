import { describe, expect, it } from "vitest";

import {
  releaseVersionSchema,
  systemUpdateStatusSchema,
} from "../src/system-update.js";

describe("system update contracts", () => {
  it("accepts release tags used by the LinkSense release workflow", () => {
    expect(releaseVersionSchema.parse("v1.24.3")).toBe("v1.24.3");
    expect(releaseVersionSchema.safeParse("1.24.3").success).toBe(false);
    expect(releaseVersionSchema.safeParse("v1.24.3-beta.1").success).toBe(
      false,
    );
  });

  it("accepts a successful update check with a GitHub release URL", () => {
    expect(
      systemUpdateStatusSchema.parse({
        status: "update_available",
        current_version: "v0.1.1",
        latest_release: {
          version: "v0.2.0",
          name: "LinkSense v0.2.0",
          published_at: "2026-09-01T08:00:00.000Z",
          url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
          release_notes: "New administrator update checks.",
        },
        checked_at: "2026-09-01T09:00:00.000Z",
        error_code: null,
      }).status,
    ).toBe("update_available");
  });

  it("rejects a release URL outside the trusted GitHub host", () => {
    expect(
      systemUpdateStatusSchema.safeParse({
        status: "up_to_date",
        current_version: "v0.1.1",
        latest_release: {
          version: "v0.1.1",
          name: "LinkSense v0.1.1",
          published_at: "2026-09-01T08:00:00.000Z",
          url: "https://example.test/releases/v0.1.1",
          release_notes: null,
        },
        checked_at: "2026-09-01T09:00:00.000Z",
        error_code: null,
      }).success,
    ).toBe(false);
  });
});
