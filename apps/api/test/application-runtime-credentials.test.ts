import { describe, expect, it, vi } from "vitest";
import { validateApplicationCredentials } from "../src/modules/applications/runtime-credentials.js";
import { isApplicationVersionUpdate, projectServiceInstallation } from "../src/modules/applications/runtime-installation-projection.js";

describe("application installation resource checks", () => {
  it("resolves required credentials using the resource owner's identity without returning their values", async () => {
    const resolveForCapability = vi.fn(async () => ({ ok: true as const, environment: { API_KEY: "private-fixture" }, usageReceipt: { userId: "creator", capabilityId: "plugin", credentialIds: [] } }));
    expect(await validateApplicationCredentials({ resolveForCapability }, "creator", [{ id: "plugin", type: "plugin", riskSummaryJson: { declared_environment_keys: ["API_KEY"] } }])).toBeUndefined();
    expect(resolveForCapability).toHaveBeenCalledWith("creator", "plugin", ["API_KEY"]);
  });
  it("rejects missing required credentials before activating an installation", async () => {
    const capabilities = [{ id: "plugin", type: "plugin", riskSummaryJson: { declared_environment_keys: ["API_KEY"] } }];
    await expect(validateApplicationCredentials(undefined, "owner", capabilities)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    const resolveForCapability = vi.fn(async () => ({ ok: false as const, missingKeys: ["API_KEY"] }));
    await expect(validateApplicationCredentials({ resolveForCapability } as never, "owner", capabilities)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("does not invent credentials for skills or plugins without declarations", async () => {
    await expect(validateApplicationCredentials(undefined, "owner", [{ id: "skill", type: "skill", riskSummaryJson: null }, { id: "plugin", type: "plugin", riskSummaryJson: {} }])).resolves.toBeUndefined();
  });
});

describe("installation version projections", () => {
  it("offers a republished edit with an unchanged version label as an update", () => {
    const installed = { id: "installed", versionLabel: "1.1.1", versionNumber: 2 };
    const edited = { id: "edited", versionLabel: "1.1.1", versionNumber: 3 };
    expect(projectServiceInstallation(installed, edited)).toMatchObject({ installed_version_id: "installed", available_version_id: "edited", update_available: true });
    expect(projectServiceInstallation(edited, installed).update_available).toBe(false);
    expect(projectServiceInstallation(edited, edited).update_available).toBe(false);
  });
  it("compares numeric versions before publication order and refuses an older distribution channel", () => {
    const installed = { id: "installed", versionLabel: "1.10.0", versionNumber: 2 };
    const older = { id: "older", versionLabel: "1.9.0", versionNumber: 8 };
    expect(isApplicationVersionUpdate(installed, older)).toBe(false);
    expect(projectServiceInstallation(installed, older)).toMatchObject({ installed_version_number: "1.10.0", available_version_number: "1.9.0", update_available: false });
    expect(projectServiceInstallation(installed, { ...older, versionLabel: "2.0.0" }).update_available).toBe(true);
  });
  it("keeps first installation explicit and detects legacy same-label replacements", () => {
    const available = { id: "new", versionLabel: "1.0.0+build.2", versionNumber: 2 };
    expect(projectServiceInstallation(null, available)).toMatchObject({ installed_version_id: null, update_available: false });
    expect(isApplicationVersionUpdate({ versionLabel: "1.0.0+build.1", versionNumber: 1 }, available)).toBe(true);
  });
});
