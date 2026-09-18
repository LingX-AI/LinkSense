import { describe, expect, it } from "vitest";
import { applicationVersionInputSchema, applicationVersionNumberSchema, applicationVersionStatus, nextApplicationVersion } from "./application-version.js";

describe("application version inputs", () => {
  it("suggests 0.0.1 for a first release and increments existing versions", () => {
    expect(nextApplicationVersion(null)).toBe("0.0.1");
    expect(nextApplicationVersion("2.3.9")).toBe("2.3.10");
    expect(nextApplicationVersion("1.1.0+build.2")).toBe("1.1.1");
  });
  it("accepts numeric release versions and trims an optional usage guide", () => {
    expect(applicationVersionInputSchema.safeParse({ version_number: " v1.2.3 " }).success).toBe(false);
    expect(applicationVersionInputSchema.parse({ version_number: " 1.2.3 ", usage_instructions: " Guide " })).toEqual({ version_number: "1.2.3", usage_instructions: "Guide" });
    for (const usage_instructions of [undefined, "", "  "]) {
      expect(applicationVersionInputSchema.parse({ version_number: "1.2.3", usage_instructions })).toEqual({ version_number: "1.2.3", usage_instructions: "" });
    }
    for (const usage_instructions of [null, 123, "x".repeat(20_001)]) {
      expect(applicationVersionInputSchema.safeParse({ version_number: "1.2.3", usage_instructions }).success).toBe(false);
    }
  });
  it.each(["", "1", "1.2", "latest", "01.2.3", "1.2.-3"])("rejects malformed version %s", value => {
    expect(applicationVersionNumberSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    ["1.10.0", "1.9.0", "new"], ["1.9.0", "1.10.0", "lower"],
    ["v1.0.0", "1.0.0", "same"], ["1.0.0-rc.1", "1.0.0", "lower"],
    ["1.0.0", null, "new"], ["bad", "1.0.0", "invalid"],
  ] as const)("compares %s with %s as %s", (input, highest, status) => {
    expect(applicationVersionStatus(input, highest)).toBe(status);
  });
});
