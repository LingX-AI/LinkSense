import { randomUUID } from "node:crypto";
import { AppError } from "../src/lib/errors.js";
import type { DesktopDeviceRegistration, DesktopDeviceRenameResult } from "@linksense/shared";
import type {
  DesktopDeviceRecord, DesktopDeviceRepository, DeviceCredentialRecord,
} from "../src/modules/desktop-devices/repository.js";
import type {
  DesktopConnectionNotice, DesktopDeviceCoordinator,
} from "../src/modules/desktop-devices/coordinator.js";

export class MemoryDesktopDeviceRepository implements DesktopDeviceRepository {
  readonly devices = new Map<string, DesktopDeviceRecord>();
  readonly pairings = new Map<string, { ownerId: string; expiresAt: Date; consumed: boolean; createdAt: Date; authValidAfter: Date }>();
  readonly owners = new Map<string, { status: string; authValidAfter: Date }>();
  readonly writes: Array<{ codeHash?: string; tokenHash?: string }> = [];

  async createPairing(ownerId: string, authValidAfter: Date, codeHash: string, expiresAt: Date, now: Date): Promise<void> {
    const owner = this.owners.get(ownerId);
    if (owner?.status !== "active") throw new AppError("FORBIDDEN");
    if (owner.authValidAfter.getTime() !== authValidAfter.getTime()) throw new AppError("AUTH_SESSION_EXPIRED");
    this.pairings.set(codeHash, { ownerId, expiresAt, consumed: false, createdAt: now, authValidAfter: this.owners.get(ownerId)!.authValidAfter });
    this.writes.push({ codeHash });
  }

  async consumePairing(
    codeHash: string, tokenHash: string, registration: DesktopDeviceRegistration, now: Date,
  ): Promise<DesktopDeviceRecord | null> {
    const pairing = this.pairings.get(codeHash);
    if (!pairing || pairing.consumed || pairing.expiresAt <= now) return null;
    const owner = this.owners.get(pairing.ownerId);
    if (!owner || owner.status !== "active" || pairing.authValidAfter.getTime() !== owner.authValidAfter.getTime()) return null;
    pairing.consumed = true;
    const row: DesktopDeviceRecord = {
      id: randomUUID(), ownerId: pairing.ownerId, name: registration.name, platform: registration.platform,
      arch: registration.arch, appVersion: registration.app_version, capabilitiesJson: registration.capabilities,
      tokenHash, authValidAfter: owner.authValidAfter, lastSeenAt: null, revokedAt: null, createdAt: now, updatedAt: now,
    };
    this.devices.set(row.id, row);
    this.writes.push({ tokenHash });
    return row;
  }

  async findCredential(tokenHash: string): Promise<DeviceCredentialRecord | null> {
    const device = [...this.devices.values()].find(row => row.tokenHash === tokenHash);
    const owner = device ? this.owners.get(device.ownerId) : undefined;
    return device && owner ? { device, owner } : null;
  }

  async listOwned(ownerId: string): Promise<DesktopDeviceRecord[]> {
    return [...this.devices.values()].filter(row => row.ownerId === ownerId);
  }

  async findOwned(ownerId: string, deviceId: string): Promise<DesktopDeviceRecord | null> {
    const row = this.devices.get(deviceId.toLowerCase());
    return row?.ownerId === ownerId ? row : null;
  }

  async listUnrevokedIds(deviceIds: readonly string[]): Promise<string[]> {
    return deviceIds.filter(id => {
      const device = this.devices.get(id);
      return device && !device.revokedAt;
    });
  }

  async rename(ownerId: string, deviceId: string, name: string, now: Date): Promise<DesktopDeviceRenameResult | null> {
    const row = await this.findOwned(ownerId, deviceId);
    if (!row || row.revokedAt) return null;
    row.name = name;
    row.updatedAt = now;
    return { id: row.id, name };
  }

  async revoke(ownerId: string, deviceId: string, now: Date): Promise<string | null> {
    const row = await this.findOwned(ownerId, deviceId);
    if (!row) return null;
    row.revokedAt ??= now;
    return row.id;
  }

  async touch(deviceId: string, now: Date): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) device.lastSeenAt = now;
  }
}

export class MemoryDesktopDeviceCoordinator implements DesktopDeviceCoordinator {
  readonly connections = new Map<string, string>();
  readonly listeners = new Set<(notice: DesktopConnectionNotice) => void>();

  async connect(deviceId: string, connectionId: string): Promise<void> {
    const previous = this.connections.get(deviceId);
    this.connections.set(deviceId, connectionId);
    if (previous && previous !== connectionId) {
      for (const listener of this.listeners) listener({ type: "replaced", deviceId, supersededConnectionId: previous });
    }
  }
  async maintain(deviceId: string, connectionId: string): Promise<"online" | "replaced" | "expired"> {
    const current = this.connections.get(deviceId);
    return current === connectionId ? "online" : current ? "replaced" : "expired";
  }
  async disconnect(deviceId: string, connectionId: string): Promise<void> {
    if (this.connections.get(deviceId) === connectionId) this.connections.delete(deviceId);
  }
  async online(deviceIds: readonly string[]): Promise<Set<string>> {
    return new Set(deviceIds.filter(id => this.connections.has(id)));
  }
  async revoke(deviceId: string): Promise<void> {
    this.connections.delete(deviceId);
    for (const listener of this.listeners) listener({ type: "revoked", deviceId });
  }
  async subscribe(listener: (notice: DesktopConnectionNotice) => void): Promise<() => Promise<void>> {
    this.listeners.add(listener);
    return async () => { this.listeners.delete(listener); };
  }
}
