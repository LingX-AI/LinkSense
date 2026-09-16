import { describe, expect, it } from "vitest";
import { applicationShareInputSchema } from "./applications.js";
import {
  applicationCenterReviewInputSchema,
  applicationCenterSubmissionInputSchema,
  applicationInstallInputSchema,
  applicationUsageModesSchema,
} from "./application-distribution.js";

const version = "90000000-0000-4000-8000-000000000001";

describe("application distribution contracts", () => {
  it.each([undefined, "", "  "])("allows an omitted or empty guide for sharing and center submission: %s", usage_instructions => {
    expect(applicationShareInputSchema.parse({ version_number: "1.0.0", usage_instructions, target: null }).usage_instructions).toBe("");
    expect(applicationCenterSubmissionInputSchema.parse({ version_number: "1.0.0", usage_instructions, usage_modes: ["service"], release_notes: "Release" }).usage_instructions).toBe("");
  });
  it("accepts either usage mode or both, without silently granting the other mode", () => {
    for (const modes of [["install"], ["service"], ["install", "service"]]) {
      expect(applicationUsageModesSchema.parse(modes)).toEqual(modes);
    }
    for (const modes of [[], ["install", "install"], ["copy"], ["install", "service", "admin"]]) {
      expect(applicationUsageModesSchema.safeParse(modes).success).toBe(false);
    }
  });

  it("binds an installation to an explicit channel and reviewed version, without accepting secrets", () => {
    const input = { name: " My application ", channel: "center", version_id: version };
    expect(applicationInstallInputSchema.parse(input).name).toBe("My application");
    expect(applicationInstallInputSchema.safeParse({ ...input, credentials: { token: "secret" } }).success).toBe(false);
    expect(applicationInstallInputSchema.safeParse({ name: "Application" }).success).toBe(false);
  });

  it("requires a version and usage choice while release notes remain optional", () => {
    const input = { version_number: "1.0.0", usage_instructions: "Guide", usage_modes: ["service"], release_notes: "Initial release" };
    expect(applicationCenterSubmissionInputSchema.safeParse(input).success).toBe(true);
    expect(applicationCenterSubmissionInputSchema.safeParse({ ...input, usage_modes: [] }).success).toBe(false);
    for (const release_notes of [undefined, "", "  "]) {
      expect(applicationCenterSubmissionInputSchema.parse({ ...input, release_notes }).release_notes).toBe("");
    }
    expect(applicationCenterSubmissionInputSchema.safeParse({ ...input, release_notes: "x".repeat(8_001) }).success).toBe(false);
  });

  it("requires an explanation for rejection", () => {
    expect(applicationCenterReviewInputSchema.safeParse({ decision: "approved", comment: "" }).success).toBe(true);
    expect(applicationCenterReviewInputSchema.safeParse({ decision: "rejected", comment: " " }).success).toBe(false);
    expect(applicationCenterReviewInputSchema.safeParse({ decision: "rejected", comment: "Explain the setup." }).success).toBe(true);
  });
});
