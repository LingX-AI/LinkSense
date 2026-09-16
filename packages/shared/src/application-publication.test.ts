import { describe, expect, it } from "vitest";
import { applicationVersionInputSchema } from "./application-version.js";

describe("application publication contracts", () => {
  it("requires a version without accepting distribution permissions", () => {
    expect(applicationVersionInputSchema.parse({ version_number: "1.0.0", usage_instructions: " Use your account. " })).toEqual({ version_number: "1.0.0", usage_instructions: "Use your account." });
    expect(applicationVersionInputSchema.parse({ version_number: "1.0.0" })).toEqual({ version_number: "1.0.0", usage_instructions: "" });
    for (const input of [{ usage_instructions: "Guide" }, { version_number: "1.0.0", usage_instructions: "Guide", allow_copy: true }, { version_number: "1.0.0", usage_instructions: "Guide", credentials: {} }]) {
      expect(applicationVersionInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
