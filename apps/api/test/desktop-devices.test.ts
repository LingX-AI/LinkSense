import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import { MemoryDesktopDeviceCoordinator, MemoryDesktopDeviceRepository } from "./desktop-devices.fixture.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const registration = { name: "Work laptop", platform: "darwin", arch: "arm64", app_version: "0.1.0" };

function fixture() {
  const repository = new MemoryDesktopDeviceRepository();
  const coordinator = new MemoryDesktopDeviceCoordinator();
  repository.owners.set(owner, { status: "active", authValidAfter: new Date(0) });
  let now = new Date("2026-11-17T00:00:00Z");
  const service = new DesktopDeviceService(repository, coordinator, () => now);
  return { repository, coordinator, service, advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
}

describe("desktop device identity and presence", () => {
  it("does not issue new pairing credentials to an already invalidated access session", async () => {
    const { service, repository } = fixture();
    repository.owners.set(owner, { status: "active", authValidAfter: new Date("2026-11-17T00:00:00Z") });
    await expect(service.pairing(owner, new Date(0))).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(repository.pairings.size).toBe(0);
  });

  it("stores only hashes, consumes a pairing once and derives ownership on the server", async () => {
    const { service, repository } = fixture();
    const pairing = await service.pairing(owner, new Date(0));
    const attempts = await Promise.allSettled([
      service.pair({ ...registration, code: pairing.code }),
      service.pair({ ...registration, code: pairing.code }),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const successful = attempts.find(result => result.status === "fulfilled");
    if (successful?.status !== "fulfilled") throw new Error("pairing was not consumed");
    const result = successful.value;
    expect(await service.authenticate(result.token)).toMatchObject({ ownerId: owner });
    const stored = [...repository.devices.values()][0]!;
    expect(stored.tokenHash).toBe(createHash("sha256").update(result.token).digest("hex"));
    expect(JSON.stringify(repository.writes)).not.toContain(result.token);
    expect(JSON.stringify(repository.writes)).not.toContain(pairing.code);
    expect(JSON.stringify(result.device)).not.toContain(stored.tokenHash);
    expect((await service.list(other)).items).toEqual([]);
    await expect(service.assertOwned(other, result.device.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects expired pairings and credentials after an account epoch changes", async () => {
    const { service, repository, advance } = fixture();
    const expired = await service.pairing(owner, new Date(0));
    advance(120_001);
    await expect(service.pair({ ...registration, code: expired.code })).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    const pairing = await service.pairing(owner, new Date(0));
    const result = await service.pair({ ...registration, code: pairing.code });
    expect(await service.authenticate(result.token)).not.toBeNull();
    repository.owners.set(owner, { status: "active", authValidAfter: new Date("2026-11-17T00:10:00Z") });
    expect(await service.authenticate(result.token)).toBeNull();
  });

  it("invalidates a pre-change device even when its creation timestamp equals the new authentication epoch", async () => {
    const { service, repository } = fixture();
    const pairing = await service.pairing(owner, new Date(0));
    const result = await service.pair({ ...registration, code: pairing.code });
    repository.owners.set(owner, { status: "active", authValidAfter: new Date("2026-11-17T00:00:00Z") });
    expect(await service.authenticate(result.token)).toBeNull();
  });

  it("registers idempotently by installation id, rotates the token, and scopes the row to the owner", async () => {
    const { service, repository } = fixture();
    repository.owners.set(other, { status: "active", authValidAfter: new Date(0) });
    const installationId = "60000000-0000-4000-8000-000000000001";
    const first = await service.register(owner, new Date(0), { ...registration, installation_id: installationId });
    expect(first.owner_id).toBe(owner);
    expect(await service.authenticate(first.token)).toMatchObject({ ownerId: owner });
    const second = await service.register(owner, new Date(0), {
      ...registration, installation_id: installationId, device_id: first.device.id,
    });
    expect(second.device.id).toBe(first.device.id);
    expect(second.token).not.toBe(first.token);
    expect(await service.authenticate(first.token)).toBeNull();
    expect(await service.authenticate(second.token)).toMatchObject({ ownerId: owner });
    expect(repository.devices.size).toBe(1);
    await expect(service.register(other, new Date(0), {
      ...registration, installation_id: installationId,
    })).resolves.toMatchObject({ owner_id: other });
    expect(repository.devices.size).toBe(2);
  });

  it("adopts an existing paired row during the first installation-id upgrade", async () => {
    const { service, repository } = fixture();
    const pairing = await service.pairing(owner, new Date(0));
    const paired = await service.pair({ ...registration, code: pairing.code });
    const installationId = "60000000-0000-4000-8000-000000000003";
    const registered = await service.register(owner, new Date(0), {
      ...registration, device_id: paired.device.id, installation_id: installationId,
    });
    expect(registered.device.id).toBe(paired.device.id);
    expect(repository.devices.size).toBe(1);
    const stored = [...repository.devices.values()][0]!;
    expect(stored.installationId).toBe(installationId);
  });

  it("keeps a revocation durable when the Keychain credential is gone, and only an explicit re-enable revives it", async () => {
    const { service, repository } = fixture();
    const installationId = "60000000-0000-4000-8000-000000000002";
    const registered = await service.register(owner, new Date(0), { ...registration, installation_id: installationId });
    await service.revoke(owner, registered.device.id);
    // A revoked Mac loses its Keychain credential and signs in again. Without
    // the installation id this would create a fresh, unrevoked device row.
    await expect(service.register(owner, new Date(0), {
      ...registration, installation_id: installationId,
    })).rejects.toMatchObject({ code: "DESKTOP_LOCAL_TOOLS_DISABLED" });
    expect(repository.devices.size).toBe(1);
    const revived = await service.register(owner, new Date(0), {
      ...registration, installation_id: installationId, reenable: true,
    });
    expect(revived.device.id).toBe(registered.device.id);
    expect(revived.device.revoked_at).toBeNull();
    expect(repository.devices.size).toBe(1);
    expect(await service.authenticate(revived.token)).toMatchObject({ ownerId: owner });
  });

  it("rejects registration for an invalidated access session", async () => {
    const { service, repository } = fixture();
    repository.owners.set(owner, { status: "active", authValidAfter: new Date("2026-11-17T00:00:00Z") });
    await expect(service.register(owner, new Date(0), {
      ...registration, installation_id: "60000000-0000-4000-8000-000000000004",
    })).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(repository.devices.size).toBe(0);
  });

  it("replaces a connection without allowing stale cleanup to mark the replacement offline", async () => {
    const { service, coordinator } = fixture();
    const pairing = await service.pairing(owner, new Date(0));
    const { device, token } = await service.pair({ ...registration, code: pairing.code });
    const credential = await service.authenticate(token);
    if (!credential) throw new Error("missing credential");
    const first = await service.connect(credential);
    const second = await service.connect(credential);
    expect(await service.maintain(credential, first)).toBe("replaced");
    await coordinator.disconnect(device.id, first);
    expect((await service.list(owner)).items[0]?.online).toBe(true);
    expect(await service.maintain(credential, second)).toBe("online");
  });

  it("rejects cross-owner revocation and makes an authorized revocation effective on every service instance", async () => {
    const { service, repository, coordinator } = fixture();
    const replica = new DesktopDeviceService(repository, coordinator);
    const pairing = await service.pairing(owner, new Date(0));
    const { device, token } = await service.pair({ ...registration, code: pairing.code });
    const credential = await service.authenticate(token);
    if (!credential) throw new Error("missing credential");
    const connection = await service.connect(credential);
    await expect(replica.revoke(other, device.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.maintain(credential, connection)).toBe("online");
    await replica.revoke(owner, device.id);
    expect(await service.authenticate(token)).toBeNull();
    expect(await service.maintain(credential, connection)).toBe("revoked");
    expect((await service.list(owner)).items[0]?.online).toBe(false);
  });
});
