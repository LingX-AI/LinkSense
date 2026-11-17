import type { DesktopDeviceRegistration } from "@linksense/shared";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export type DesktopDeviceRecord = Prisma.DesktopDeviceGetPayload<Record<string, never>>;
export type DeviceCredentialRecord = {
  device: DesktopDeviceRecord;
  owner: { status: string; authValidAfter: Date };
};

export interface DesktopDeviceRepository {
  createPairing(ownerId: string, authValidAfter: Date, codeHash: string, expiresAt: Date, now: Date): Promise<void>;
  consumePairing(codeHash: string, tokenHash: string, registration: DesktopDeviceRegistration, now: Date): Promise<DesktopDeviceRecord | null>;
  findCredential(tokenHash: string): Promise<DeviceCredentialRecord | null>;
  listOwned(ownerId: string): Promise<DesktopDeviceRecord[]>;
  findOwned(ownerId: string, deviceId: string): Promise<DesktopDeviceRecord | null>;
  revoke(ownerId: string, deviceId: string, now: Date): Promise<boolean>;
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
      return tx.desktopDevice.create({
        data: {
          ownerId: pairing.ownerId, tokenHash, authValidAfter: owner.authValidAfter, name: registration.name,
          platform: registration.platform, arch: registration.arch,
          appVersion: registration.app_version, capabilitiesJson: registration.capabilities,
          createdAt: now,
        },
      });
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

  async revoke(ownerId: string, deviceId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const device = await tx.desktopDevice.findFirst({ where: { id: deviceId, ownerId } });
      if (!device) return false;
      await tx.desktopDevice.updateMany({ where: { id: deviceId, ownerId, revokedAt: null }, data: { revokedAt: now } });
      await tx.computerPermissionGrant.updateMany({
        where: { ownerId, deviceId, revokedAt: null }, data: { revokedAt: now },
      });
      await tx.localComputerSession.updateMany({
        where: { ownerId, deviceId, endedAt: null }, data: { status: "ended", endedAt: now },
      });
      return true;
    });
  }

  async touch(deviceId: string, now: Date): Promise<void> {
    await this.prisma.desktopDevice.updateMany({
      where: { id: deviceId, revokedAt: null }, data: { lastSeenAt: now },
    });
  }
}
