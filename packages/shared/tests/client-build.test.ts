import { describe, expect, it } from "vitest";
import { buildIdSchema, buildInfoSchema } from "../src/client-build.js";

describe("application build identity", () => {
  it("accepts immutable fingerprints and rejects mutable or malformed version identifiers", () => {
    const id = "a".repeat(64);
    expect(buildInfoSchema.parse({ build_id: id })).toEqual({ build_id: id });
    for (const value of ["latest", "v0.2.3", "", null, "a".repeat(65), "../build"]) {
      expect(buildIdSchema.safeParse(value).success).toBe(false);
    }
    expect(buildInfoSchema.safeParse({ build_id: id, extra: true }).success).toBe(false);
  });
});
