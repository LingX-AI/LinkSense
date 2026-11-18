import type { auditActionCodes, DesktopDeviceRegistration, DesktopDeviceRenameResult } from "@linksense/shared";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export type DesktopDeviceRecord = Prisma.DesktopDeviceGetPayload<Record<string, never>>;
export type DeviceCredentialRecord = {
  device: DesktopDeviceRecord;
  owner: { status: string; authValidAfter: Date };
};

export function isCurrentDeviceCredential(
  device: Pick<DesktopDeviceRecord, "revokedAt" | "authValidAfter">,
  owner: DeviceCredentialRecord["owner"],
): boolean {
  return !device.revokedAt && owner.status === "active" &&
    device.authValidAfter.getTime() === owner.authValidAfter.getTime();
}

export interface DesktopDeviceRepository {
  createPairing(ownerId: string, authValidAfter: Date, codeHash: string, expiresAt: Date, now: Date): Promise<void>;
  consumePairing(codeHash: string, tokenHash: string, registration: DesktopDeviceRegistration, now: Date): Promise<DesktopDeviceRecord | null>;
  findCredential(tokenHash: string): Promise<DeviceCredentialRecord | null>;
  listOwned(ownerId: string): Promise<DesktopDeviceRecord[]>;
  findOwned(ownerId: string, deviceId: string): Promise<DesktopDeviceRecord | null>;
  listUnrevokedIds(deviceIds: readonly string[]): Promise<string[]>;
  rename(ownerId: string, deviceId: string, name: string, now: Date): Promise<DesktopDeviceRenameResult | null>;
  revoke(ownerId: string, deviceId: string, now: Date): Promise<string | null>;
  touch(deviceId: string, now: Date): Promise<void>;
}

export class PrismaDesktopDeviceRepository implements DesktopDeviceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPairing(ownerId: string, authValidAfter: Date, codeHash: string, expiresAt: Date, now: Date): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId}::uuid FOR SHARE`;
      const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { status: true, authValidAfter: true } });
      if (owner?.status !== "active") throw new AppError("FORBIDDEN");
      if (owner.authValidAfter.getTime() !== authValidAfter.getTime()) throw new AppError("AUTH_SESSION_EXPIRED");
      await tx.desktopDevicePairing.deleteMany({
        where: { ownerId, OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }] },
      });
      await tx.desktopDevicePairing.create({ data: { ownerId, codeHash, expiresAt, createdAt: now, authValidAfter: owner.authValidAfter } });
    });
  }

  async consumePairing(
    codeHash: string, tokenHash: string, registration: DesktopDeviceRegistration, now: Date,
  ): Promise<DesktopDeviceRecord | null> {
    return this.prisma.$transaction(async tx => {
      const pairing = await tx.desktopDevicePairing.findUnique({ where: { codeHash } });
      if (!pairing || pairing.consumedAt || pairing.expiresAt <= now) return null;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${pairing.ownerId}::uuid FOR SHARE`;
      const owner = await tx.user.findUnique({
        where: { id: pairing.ownerId }, select: { status: true, authValidAfter: true },
      });
      if (owner?.status !== "active" || pairing.authValidAfter.getTime() !== owner.authValidAfter.getTime()) return null;
      // Keep the predicate in the SQL write; Prisma's multi-query updateMany can race.
      const consumed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE desktop_device_pairings SET consumed_at = ${now}
        WHERE id = ${pairing.id}::uuid AND consumed_at IS NULL AND expires_at > ${now}
        RETURNING id`;
      if (consumed.length !== 1) return null;
      const device = await tx.desktopDevice.create({
        data: {
          ownerId: pairing.ownerId, tokenHash, authValidAfter: owner.authValidAfter, name: registration.name,
          platform: registration.platform, arch: registration.arch,
          appVersion: registration.app_version, capabilitiesJson: registration.capabilities,
          createdAt: now,
        },
      });
      await writeDeviceAudit(tx, pairing.ownerId, device.id, "desktop_device_paired");
      return device;
    });
  }

  async findCredential(tokenHash: string): Promise<DeviceCredentialRecord | null> {
    const device = await this.prisma.desktopDevice.findUnique({ where: { tokenHash } });
    if (!device || device.revokedAt) return null;
    const owner = await this.prisma.user.findUnique({
      where: { id: device.ownerId }, select: { status: true, authValidAfter: true },
    });
    return owner ? { device, owner } : null;
  }

  listOwned(ownerId: string): Promise<DesktopDeviceRecord[]> {
    return this.prisma.desktopDevice.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
  }

  findOwned(ownerId: string, deviceId: string): Promise<DesktopDeviceRecord | null> {
    return this.prisma.desktopDevice.findFirst({ where: { id: deviceId, ownerId } });
  }

  async listUnrevokedIds(deviceIds: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.$transaction(tx => tx.desktopDevice.findMany({
      where: { id: { in: [...deviceIds] }, revokedAt: null }, select: { id: true },
    }), { maxWait: 1_000, timeout: 2_000 });
    return rows.map(row => row.id);
  }

  async rename(ownerId: string, deviceId: string, name: string, now: Date): Promise<DesktopDeviceRenameResult | null> {
    return this.prisma.$transaction(async tx => {
      const device = await lockOwnedDevice(tx, ownerId, deviceId);
      if (!device || device.revokedAt) return null;
      const renamed = await tx.desktopDevice.update({
        where: { id: device.id }, data: { name, updatedAt: now }, select: { id: true, name: true },
      });
      await writeDeviceAudit(tx, ownerId, device.id, "desktop_device_renamed");
      return renamed;
    });
  }

  async revoke(ownerId: string, deviceId: string, now: Date): Promise<string | null> {
    return this.prisma.$transaction(async tx => {
      const device = await lockOwnedDevice(tx, ownerId, deviceId);
      if (!device) return null;
      if (!device.revokedAt) {
        await tx.desktopDevice.update({ where: { id: device.id }, data: { revokedAt: now, updatedAt: now } });
        await writeDeviceAudit(tx, ownerId, device.id, "desktop_device_revoked");
      }
      await tx.computerPermissionGrant.updateMany({
        where: { ownerId, deviceId: device.id, revokedAt: null }, data: { revokedAt: now },
      });
      await tx.localComputerSession.updateMany({
        where: { ownerId, deviceId: device.id, endedAt: null }, data: { status: "ended", endedAt: now },
      });
      return device.id;
    });
  }

  async touch(deviceId: string, now: Date): Promise<void> {
    await this.prisma.desktopDevice.updateMany({
      where: { id: deviceId, revokedAt: null }, data: { lastSeenAt: now },
    });
  }
}

async function lockOwnedDevice(
  tx: Prisma.TransactionClient, ownerId: string, deviceId: string,
): Promise<{ id: string; revokedAt: Date | null } | undefined> {
  const [device] = await tx.$queryRaw<Array<{ id: string; revokedAt: Date | null }>>`
    SELECT id, revoked_at AS "revokedAt" FROM desktop_devices
    WHERE id = ${deviceId}::uuid AND owner_id = ${ownerId}::uuid
    FOR UPDATE`;
  return device;
}

async function writeDeviceAudit(
  tx: Prisma.TransactionClient, ownerId: string, deviceId: string,
  action: Extract<(typeof auditActionCodes)[number], `desktop_device_${string}`>,
): Promise<void> {
  await tx.auditLog.create({
    data: { actorId: ownerId, action, targetType: "desktop_device", targetId: deviceId, result: "success", metadataJson: {} },
  });
}
