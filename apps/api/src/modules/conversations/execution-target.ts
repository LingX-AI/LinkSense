import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export async function assertPairedDesktopDevice(
  db: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
  deviceId: string,
): Promise<void> {
  const [device] = await db.$queryRaw<Array<{ deviceEpoch: Date; ownerEpoch: Date }>>`
    SELECT d.auth_valid_after AS "deviceEpoch", u.auth_valid_after AS "ownerEpoch"
    FROM desktop_devices d JOIN users u ON u.id = d.owner_id
    WHERE d.id = ${deviceId}::uuid AND d.owner_id = ${ownerId}::uuid
      AND d.revoked_at IS NULL AND u.status = 'active'
    FOR SHARE OF d, u`;
  if (!device || device.deviceEpoch.getTime() !== device.ownerEpoch.getTime()) {
    throw new AppError("FORBIDDEN");
  }
}
