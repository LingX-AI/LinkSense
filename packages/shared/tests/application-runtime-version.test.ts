import { describe, expect, it } from "vitest";
import { applicationReleaseVersionSchema, applicationVersionNumberSchema, nextApplicationVersion } from "../src/application-version.js";

describe("application release versions", () => {
  it.each(["", "1", "1.2", "01.2.3", "1.2.3+build.2", "1.2.3-beta", "-1.2.3"])("rejects %s for a new release", version => {
    expect(applicationReleaseVersionSchema.safeParse(version).success).toBe(false);
  });
  it("suggests a numeric patch increment without altering historical labels", () => {
    expect(nextApplicationVersion(null)).toBe("0.0.1");
    expect(nextApplicationVersion("1.9.9")).toBe("1.9.10");
    expect(nextApplicationVersion("1.2.3+build.9")).toBe("1.2.4");
    expect(applicationVersionNumberSchema.parse("1.2.3+build.9")).toBe("1.2.3+build.9");
    expect(applicationReleaseVersionSchema.parse("1.10.0")).toBe("1.10.0");
  });
});
