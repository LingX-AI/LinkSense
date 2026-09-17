import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplicationInstallation } from "../src/generated/prisma/client.js";
import { ApplicationInstallationService } from "../src/modules/applications/installation-service.js";

const installation: ApplicationInstallation = {
  applicationId: "10000000-0000-4000-8000-000000000001",
  ownerId: "10000000-0000-4000-8000-000000000002",
  sourceApplicationId: "10000000-0000-4000-8000-000000000003",
  installedVersionId: "10000000-0000-4000-8000-000000000004",
  channel: "center", baselineJson: {}, createdAt: new Date(0), updatedAt: new Date(0),
};
const latestId = "10000000-0000-4000-8000-000000000005";
function fixture(latestVersion: number, modes = ["install"]) {
  const db = {
    user: { findFirst: vi.fn(async () => ({ selfRegisteredAt: null })) },
    userGroupMember: { findMany: vi.fn(async () => []) },
    application: { findFirst: vi.fn(async () => ({ id: installation.sourceApplicationId, ownerId: "publisher", status: "active", publishedVersionId: "unreviewed-version" })) },
    applicationGrant: { findMany: vi.fn(async () => []) },
    applicationListing: { findUnique: vi.fn(async () => ({ id: "listing", currentReleaseId: "release", status: "published" })) },
    applicationRelease: { findFirst: vi.fn(async () => ({ versionId: latestId, usageModes: modes, releaseNotes: "Approved release" })) },
    applicationVersion: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, versionLabel: "1.0.0", versionNumber: where.id === latestId ? latestVersion : 2 })) },
  };
  const service = new ApplicationInstallationService(db as never, "/unused", {} as never);
  return { service, db };
}

describe("installed application version discovery", () => {
  it("rejects an update by a non-owner before creating any installation files", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-installation-authorization-"));
    try {
      const db = { applicationInstallation: { findFirst: vi.fn(async () => null) } };
      const service = new ApplicationInstallationService(db as never, root, {} as never);
      await expect(service.update("another-user", installation.applicationId, latestId)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([[1, false], [2, false], [3, true]] as const)("offers submission %i as an update to submission 2 even when both display v1.0.0", async (version, available) => {
    const { service, db } = fixture(version);
    expect(await service.latest(installation.ownerId, installation)).toEqual({ id: latestId, versionLabel: "1.0.0", releaseNotes: "Approved release", updateAvailable: available });
    expect(db.applicationVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: latestId }) }));
    expect(db.applicationVersion.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "unreviewed-version" }) }));
  });

  it("does not expose update versions after installation permission is removed", async () => {
    const { service, db } = fixture(3, ["service"]);
    expect(await service.latest(installation.ownerId, installation)).toBeNull();
    expect(db.applicationVersion.findFirst).not.toHaveBeenCalled();
  });

  it("reports a missing installed version as unavailable instead of treating it as version zero", async () => {
    const { service, db } = fixture(3);
    db.applicationVersion.findFirst.mockResolvedValueOnce({ id: latestId, versionLabel: "1.0.0", versionNumber: 3 }).mockResolvedValueOnce(null as never);
    await expect(service.latest(installation.ownerId, installation)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
});
