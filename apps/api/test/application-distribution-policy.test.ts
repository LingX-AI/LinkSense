import { describe, expect, it } from "vitest";
import { assertApplicationUsageModes, applicationModesForChannel, mergeApplicationUsageModes, requireApplicationDistributionVersion, type ApplicationDistributionAccess } from "../src/modules/applications/distribution-policy.js";

const access: ApplicationDistributionAccess = {
  applicationKind: "standard",
  actorId: "recipient", ownerId: "publisher", organizationMember: true,
  applicationStatus: "active", publishedVersionId: "direct-v2", directModes: ["install"],
  center: { status: "published", versionId: "approved-v1", usageModes: ["service"] },
};

describe("application distribution permissions", () => {
  it("denies copying interactive apps even to their author or through historical install grants", () => {
    const interactive = { ...access, applicationKind: "interactive", directModes: ["install", "service"] as const,
      center: { status: "published" as const, versionId: "approved-v1", usageModes: ["install", "service"] as const } };
    for (const actorId of [access.actorId, access.ownerId]) for (const channel of ["direct", "center"] as const) {
      expect(applicationModesForChannel({ ...interactive, actorId }, channel)).toEqual(["service"]);
      expect(() => requireApplicationDistributionVersion({ ...interactive, actorId }, channel, "install")).toThrow();
    }
    expect(applicationModesForChannel({ ...interactive, directModes: ["install"] }, "direct")).toEqual([]);
    expect(() => assertApplicationUsageModes("interactive", ["install", "service"])).toThrow();
    expect(() => assertApplicationUsageModes("interactive", ["service"])).not.toThrow();
    expect(() => assertApplicationUsageModes("standard", ["install", "service"])).not.toThrow();
  });
  it("keeps installation and service permissions independent in each channel", () => {
    expect(requireApplicationDistributionVersion(access, "direct", "install")).toBe("direct-v2");
    expect(() => requireApplicationDistributionVersion(access, "direct", "service")).toThrow();
    expect(requireApplicationDistributionVersion(access, "center", "service")).toBe("approved-v1");
    expect(() => requireApplicationDistributionVersion(access, "center", "install")).toThrow();
  });
  it("does not substitute an unreviewed direct version when the publisher uses the center", () => {
    expect(requireApplicationDistributionVersion({ ...access, actorId: "publisher" }, "center", "service")).toBe("approved-v1");
  });
  it("unions direct user and group grants and retains permissions supplied by another group", () => {
    expect(mergeApplicationUsageModes([["install"], ["service"], ["install"]])).toEqual(["install", "service"]);
    expect(mergeApplicationUsageModes([["service"], ["install"]])).toEqual(["install", "service"]);
    expect(mergeApplicationUsageModes([["service"]])).toEqual(["service"]);
    expect(mergeApplicationUsageModes([])).toEqual([]);
  });
  it("revoking direct access does not remove a separately approved center service", () => {
    const revoked = { ...access, directModes: [] };
    expect(applicationModesForChannel(revoked, "direct")).toEqual([]);
    expect(requireApplicationDistributionVersion(revoked, "center", "service")).toBe("approved-v1");
  });
  it.each(["draft", "unlisted", "suspended"] as const)("blocks center access for %s listings", status => {
    const unavailable = { ...access, center: { ...access.center!, status } };
    expect(applicationModesForChannel(unavailable, "center")).toEqual([]);
    expect(requireApplicationDistributionVersion(unavailable, "direct", "install")).toBe("direct-v2");
  });
  it("does not authorize self-registered users through organization channels", () => {
    const personal = { ...access, organizationMember: false };
    expect(applicationModesForChannel(personal, "direct")).toEqual([]);
    expect(applicationModesForChannel(personal, "center")).toEqual([]);
    expect(applicationModesForChannel({ ...personal, actorId: access.ownerId }, "direct")).toEqual(["install", "service"]);
  });
  it("rejects a stale install or update confirmation instead of silently selecting another version", () => {
    expect(() => requireApplicationDistributionVersion(access, "direct", "install", "old-version")).toThrow();
  });
  it.each(["disabled", "deleted"] as const)("blocks all new access to %s applications", applicationStatus => {
    const unavailable = { ...access, applicationStatus };
    expect(applicationModesForChannel(unavailable, "direct")).toEqual([]);
    expect(applicationModesForChannel(unavailable, "center")).toEqual([]);
  });
});
