import {
  desktopFileRootModeSchema,
  desktopFileRootSchema,
  type DesktopFileRoot,
  type DesktopFileRootCreate,
  type DesktopFileRootPatch,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";

type FileRootRecord = {
  id: string;
  ownerId: string;
  deviceId: string;
  name: string;
  mode: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

export class PrismaDesktopFileRootRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async deviceOwned(ownerId: string, deviceId: string): Promise<boolean> {
    const device = await this.prisma.desktopDevice.findFirst({
      where: { id: deviceId, ownerId, revokedAt: null },
      select: { id: true },
    });
    return device !== null;
  }

  async list(ownerId: string): Promise<FileRootRecord[]> {
    return await this.prisma.desktopFileRoot.findMany({
      where: { ownerId, revokedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async find(ownerId: string, id: string): Promise<FileRootRecord | null> {
    return await this.prisma.desktopFileRoot.findFirst({
      where: { id, ownerId, revokedAt: null },
    });
  }

  async create(ownerId: string, input: DesktopFileRootCreate): Promise<FileRootRecord> {
    return await this.prisma.desktopFileRoot.create({
      data: {
        ownerId,
        deviceId: input.device_id,
        name: input.name,
        mode: input.mode,
      },
    });
  }

  async update(ownerId: string, id: string, patch: DesktopFileRootPatch): Promise<FileRootRecord | null> {
    const updated = await this.prisma.desktopFileRoot.updateMany({
      where: { id, ownerId, revokedAt: null },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.mode === undefined ? {} : { mode: patch.mode }),
      },
    });
    if (updated.count === 0) return null;
    return await this.find(ownerId, id);
  }

  async revoke(ownerId: string, id: string): Promise<string | null> {
    const root = await this.prisma.desktopFileRoot.findFirst({
      where: { id, ownerId, revokedAt: null },
      select: { id: true },
    });
    if (!root) return null;
    await this.prisma.desktopFileRoot.updateMany({
      where: { id: root.id, ownerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return root.id;
  }
}

export class DesktopFileRootService {
  constructor(
    private readonly repository: PrismaDesktopFileRootRepository,
    private readonly audit: Pick<AuditService, "write">,
  ) {}

  async list(ownerId: string): Promise<DesktopFileRoot[]> {
    return (await this.repository.list(ownerId)).map(projectRoot);
  }

  async create(ownerId: string, input: DesktopFileRootCreate): Promise<DesktopFileRoot> {
    if (!await this.repository.deviceOwned(ownerId, input.device_id)) {
      throw new AppError("FORBIDDEN");
    }
    const root = await this.repository.create(ownerId, input);
    await this.audit.write({
      actorId: ownerId,
      action: "desktop_file_root_added",
      targetType: "desktop_file_root",
      targetId: root.id,
      result: "success",
      metadata: { device_id: root.deviceId, name: root.name, mode: root.mode },
    });
    return projectRoot(root);
  }

  async update(ownerId: string, id: string, patch: DesktopFileRootPatch): Promise<DesktopFileRoot> {
    const root = await this.repository.update(ownerId, id, patch);
    if (!root) throw new AppError("DESKTOP_FILE_ROOT_NOT_FOUND");
    await this.audit.write({
      actorId: ownerId,
      action: "desktop_file_root_updated",
      targetType: "desktop_file_root",
      targetId: root.id,
      result: "success",
      metadata: { device_id: root.deviceId, name: root.name, mode: root.mode },
    });
    return projectRoot(root);
  }

  async revoke(ownerId: string, id: string): Promise<void> {
    const revoked = await this.repository.revoke(ownerId, id);
    if (!revoked) throw new AppError("DESKTOP_FILE_ROOT_NOT_FOUND");
    await this.audit.write({
      actorId: ownerId,
      action: "desktop_file_root_removed",
      targetType: "desktop_file_root",
      targetId: revoked,
      result: "success",
    });
  }

  /** The exact active root a tool call may use; never returns another owner's row. */
  async resolve(ownerId: string, id: string): Promise<{
    id: string;
    deviceId: string;
    name: string;
    mode: "read" | "write";
  }> {
    const root = await this.repository.find(ownerId, id);
    if (!root) throw new AppError("DESKTOP_FILE_ROOT_NOT_FOUND");
    return {
      id: root.id,
      deviceId: root.deviceId,
      name: root.name,
      mode: desktopFileRootModeSchema.parse(root.mode),
    };
  }
}

function projectRoot(root: FileRootRecord): DesktopFileRoot {
  return desktopFileRootSchema.parse({
    id: root.id,
    device_id: root.deviceId,
    name: root.name,
    mode: root.mode,
    created_at: root.createdAt.toISOString(),
    updated_at: root.updatedAt.toISOString(),
  });
}
