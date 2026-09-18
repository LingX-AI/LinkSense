import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { ApplicationRuntimeInstallationService } from "../src/modules/applications/runtime-installation-service.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const principalId = "10000000-0000-4000-8000-000000000002";
const applicationId = "20000000-0000-4000-8000-000000000001";
const oldId = "30000000-0000-4000-8000-000000000001";
const newId = "30000000-0000-4000-8000-000000000002";
const accessId = "40000000-0000-4000-8000-000000000001";

function fixture() {
  const versions = [
    { id: oldId, versionLabel: "1.0.0", versionNumber: 1 },
    { id: newId, versionLabel: "1.1.0", versionNumber: 2 },
  ];
  const state = { selected: oldId, available: newId, channel: "external" };
  const session = {
    applicationId, runtimePrincipalId: principalId, externalAccessId: accessId,
    status: "active", credentialVersion: 1, absoluteExpiresAt: new Date("2099-01-01T00:00:00Z"),
  };
  const prisma = {
    $queryRaw: vi.fn(async () => [{ id: applicationId }]),
    applicationExternalSession: { findUnique: vi.fn(async () => session as typeof session | null) },
    applicationExternalAccess: { findFirst: vi.fn(async () => ({ id: accessId, credentialVersion: 1 }) as { id: string; credentialVersion: number } | null) },
    application: { findFirst: vi.fn(async () => ({ id: applicationId, ownerId })) },
    applicationVersion: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => versions.find(version => version.id === where.id) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => versions.find(version => version.id === where.id) ?? null),
    },
    applicationRuntimeInstallation: {
      findUnique: vi.fn(async ({ where }: { where: { ownerId_applicationId: { ownerId: string } } }) => ({
        versionId: where.ownerId_applicationId.ownerId === ownerId ? state.available : state.selected,
        channel: state.channel,
      })),
      upsert: vi.fn(async ({ update }: { update: { versionId: string; channel: string } }) => {
        state.selected = update.versionId;
        state.channel = update.channel;
      }),
    },
  };
  const database = { ...prisma, $transaction: vi.fn(async (action: (tx: typeof prisma) => Promise<unknown>) => action(prisma)) };
  const assertCurrent = vi.fn();
  const gate = { change: vi.fn(async (_owner: string, _app: string, action: (check: () => void) => Promise<unknown>) => action(assertCurrent)) };
  const publications = { verifyVersion: vi.fn(async () => {}) };
  const validate = vi.fn(async () => {});
  const service = new ApplicationRuntimeInstallationService(database as never, publications as never, gate as never);
  return { service, state, session, prisma, database, gate, publications, validate, assertCurrent };
}

describe("external application version selection", () => {
  it.each(["external", "direct"])("updates an idle existing external environment, including historical %s installations", async (channel) => {
    const f = fixture(); f.state.channel = channel;
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).resolves.toEqual({ previousVersionId: oldId, versionId: newId });
    expect(f.state.selected).toBe(newId);
    expect(f.state.channel).toBe("external");
    expect(f.publications.verifyVersion).toHaveBeenCalledWith(applicationId, newId);
    expect(f.validate).toHaveBeenCalledWith(newId);
    expect(f.gate.change).toHaveBeenCalledWith(principalId, applicationId, expect.any(Function), false, { waitForReaders: false });
    expect(f.prisma.applicationRuntimeInstallation.upsert).toHaveBeenCalledWith({
      where: { ownerId_applicationId: { ownerId: principalId, applicationId } },
      create: { ownerId: principalId, applicationId, versionId: newId, channel: "external" },
      update: { versionId: newId, channel: "external" },
    });
  });

  it("leaves organization and application-center installations under manual control", async () => {
    const f = fixture(); f.prisma.applicationExternalSession.findUnique.mockResolvedValue(null);
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).resolves.toBeNull();
    expect(f.gate.change).not.toHaveBeenCalled();
    expect(f.prisma.applicationRuntimeInstallation.findUnique).not.toHaveBeenCalled();
  });

  it("does not replace or close an environment that already has the current release", async () => {
    const f = fixture(); f.state.available = oldId;
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).resolves.toBeNull();
    expect(f.gate.change).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled();
  });

  it("keeps the old installation when any task or start admission makes the environment busy", async () => {
    const f = fixture(); f.gate.change.mockRejectedValueOnce(new AppError("APPLICATION_RUNTIME_BUSY"));
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).resolves.toBeNull();
    expect(f.state.selected).toBe(oldId);
    expect(f.publications.verifyVersion).not.toHaveBeenCalled();
  });

  it.each(["assets", "credentials"])("retains the installed release and reports failed %s preparation", async (failure) => {
    const f = fixture();
    (failure === "assets" ? f.publications.verifyVersion : f.validate).mockRejectedValueOnce(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.state.selected).toBe(oldId);
    expect(f.prisma.applicationRuntimeInstallation.upsert).not.toHaveBeenCalled();
  });

  it.each(["expired", "revoked", "wrong-application", "disabled-access", "rotated-secret"])("rejects %s external access without changing its installation", async (failure) => {
    const f = fixture();
    if (failure === "expired") f.session.absoluteExpiresAt = new Date("2000-01-01T00:00:00Z");
    if (failure === "revoked") f.session.status = "revoked";
    if (failure === "wrong-application") f.session.applicationId = accessId;
    if (failure === "disabled-access") f.prisma.applicationExternalAccess.findFirst.mockResolvedValue(null);
    if (failure === "rotated-secret") f.prisma.applicationExternalAccess.findFirst.mockResolvedValue({ id: accessId, credentialVersion: 2 });
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).rejects.toBeInstanceOf(AppError);
    expect(f.gate.change).not.toHaveBeenCalled();
    expect(f.prisma.applicationRuntimeInstallation.upsert).not.toHaveBeenCalled();
  });

  it("rechecks external authorization after preparing the new package", async () => {
    const f = fixture();
    f.validate.mockImplementationOnce(async () => { f.session.status = "revoked"; });
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).rejects.toBeInstanceOf(AppError);
    expect(f.state.selected).toBe(oldId);
    expect(f.prisma.applicationRuntimeInstallation.upsert).not.toHaveBeenCalled();
  });

  it("does not commit a target superseded by a concurrent creator publication", async () => {
    const f = fixture();
    f.validate.mockImplementationOnce(async () => { f.state.available = oldId; });
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.selected).toBe(oldId);
    expect(f.prisma.applicationRuntimeInstallation.upsert).not.toHaveBeenCalled();
  });

  it("does not downgrade an already newer installation", async () => {
    const f = fixture(); f.state.selected = newId; f.state.available = oldId;
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).resolves.toBeNull();
    expect(f.gate.change).not.toHaveBeenCalled();
  });

  it("requires the update lease to remain valid before committing", async () => {
    const f = fixture(); f.assertCurrent.mockImplementation(() => { throw new AppError("APPLICATION_RUNTIME_UPDATING"); });
    await expect(f.service.refreshExternal(principalId, applicationId, f.validate)).rejects.toMatchObject({ code: "APPLICATION_RUNTIME_UPDATING" });
    expect(f.state.selected).toBe(oldId);
    expect(f.prisma.applicationRuntimeInstallation.upsert).not.toHaveBeenCalled();
  });
});
