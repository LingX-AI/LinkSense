import { describe, expect, it } from "vitest";
import { copyApplicationInputSchema, publishApplicationInputSchema } from "./application-publication.js";

describe("application publication contracts", () => {
  it("requires a guide and an explicit copy decision", () => {
    expect(publishApplicationInputSchema.parse({ usage_instructions: " Use your account. ", allow_copy: false })).toEqual({ usage_instructions: "Use your account.", allow_copy: false });
    for (const input of [{ usage_instructions: "Guide" }, { usage_instructions: " ", allow_copy: false }, { usage_instructions: "Guide", allow_copy: true, credentials: {} }]) {
      expect(publishApplicationInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("accepts a named copy without author credentials or ownership input", () => {
    expect(copyApplicationInputSchema.parse({ name: " My app " })).toEqual({ name: "My app" });
    expect(copyApplicationInputSchema.safeParse({ name: " " }).success).toBe(false);
    expect(copyApplicationInputSchema.safeParse({ name: "Copy", owner_id: "author" }).success).toBe(false);
  });
});
