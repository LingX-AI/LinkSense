import { randomBytes, randomUUID } from "node:crypto";
import {
  desktopDeviceCapabilitiesSchema,
  desktopDevicePairInputSchema,
  desktopDevicePairResultSchema,
  desktopDeviceSchema,
  desktopDeviceTokenSchema,
  type DesktopDevice,
  type DesktopDeviceRenameResult,
  type DesktopPairing,
} from "@linksense/shared";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { isCurrentDeviceCredential, type DesktopDeviceRepository, type DesktopDeviceRecord } from "./repository.js";
import type { DesktopDeviceCoordinator } from "./coordinator.js";

export class DesktopDeviceService {
  constructor(
    private readonly repository: DesktopDeviceRepository,
    readonly coordinator: DesktopDeviceCoordinator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async pairing(ownerId: string, authValidAfter: Date): Promise<DesktopPairing> {
    const code = randomBytes(16).toString("hex");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + 120_000);
    await this.repository.createPairing(ownerId, authValidAfter, sha256(code), expiresAt, now);
    return { code, expires_at: expiresAt.toISOString() };
  }

  async pair(input: unknown): Promise<{ token: string; owner_id: string; device: DesktopDevice }> {
    const { code, ...registration } = desktopDevicePairInputSchema.parse(input);
    const token = randomBytes(32).toString("hex");
    const row = await this.repository.consumePairing(sha256(code), sha256(token), registration, this.now());
    if (!row) throw new AppError("AUTH_SESSION_EXPIRED");
    return desktopDevicePairResultSchema.parse({ token, owner_id: row.ownerId, device: projectDevice(row, false) });
  }

  async authenticate(token: string): Promise<DesktopDeviceRecord | null> {
    if (!desktopDeviceTokenSchema.safeParse(token).success) return null;
    const record = await this.repository.findCredential(sha256(token));
    if (!record || !isCurrentDeviceCredential(record.device, record.owner)) return null;
    return record.device;
  }

  async list(ownerId: string): Promise<{ items: DesktopDevice[] }> {
    const rows = await this.repository.listOwned(ownerId);
    const online = await this.coordinator.online(rows.map(row => row.id));
    return { items: rows.map(row => projectDevice(row, !row.revokedAt && online.has(row.id))) };
  }

  async rename(ownerId: string, deviceId: string, name: string): Promise<DesktopDeviceRenameResult> {
    const renamed = await this.repository.rename(ownerId, deviceId, name, this.now());
    if (!renamed) throw new AppError("FORBIDDEN");
    return renamed;
  }

  async assertOwned(ownerId: string, deviceId: string): Promise<DesktopDeviceRecord> {
    const device = await this.repository.findOwned(ownerId, deviceId);
    if (!device || device.revokedAt) throw new AppError("FORBIDDEN");
    return device;
  }

  async revokedIds(deviceIds: readonly string[]): Promise<Set<string>> {
    const unrevoked = new Set(await this.repository.listUnrevokedIds(deviceIds));
    return new Set(deviceIds.filter(id => !unrevoked.has(id)));
  }

  async connect(device: DesktopDeviceRecord): Promise<string> {
    const connectionId = randomUUID();
    await this.coordinator.connect(device.id, connectionId);
    await this.repository.touch(device.id, this.now());
    return connectionId;
  }

  /** Descriptive macOS upgrade/rollback metadata; never gates admission or presence. */
  async refreshAppVersion(device: DesktopDeviceRecord, connectionId: string, appVersion: string): Promise<void> {
    if (device.platform !== "darwin") return;
    await this.repository.updateAppVersion(
      device, appVersion, () => this.coordinator.isCurrentConnection(device.id, connectionId), this.now(),
    );
  }

  async hasCurrentCredential(device: DesktopDeviceRecord): Promise<boolean> {
    const current = await this.repository.findCredential(device.tokenHash);
    return current !== null && isCurrentDeviceCredential(current.device, current.owner);
  }

  async maintain(device: DesktopDeviceRecord, connectionId: string): Promise<"online" | "replaced" | "expired" | "revoked"> {
    if (!await this.hasCurrentCredential(device)) return "revoked";
    const state = await this.coordinator.maintain(device.id, connectionId);
    if (state !== "online") return state;
    await this.repository.touch(device.id, this.now());
    return "online";
  }

  async revoke(ownerId: string, deviceId: string): Promise<void> {
    const revokedId = await this.repository.revoke(ownerId, deviceId, this.now());
    if (!revokedId) throw new AppError("FORBIDDEN");
    await this.coordinator.revoke(revokedId);
  }
}

export function projectDevice(row: DesktopDeviceRecord, online: boolean): DesktopDevice {
  return desktopDeviceSchema.parse({
    id: row.id, name: row.name, platform: row.platform, arch: row.arch,
    app_version: row.appVersion, capabilities: desktopDeviceCapabilitiesSchema.parse(row.capabilitiesJson),
    online, last_seen_at: row.lastSeenAt?.toISOString() ?? null,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  });
}
