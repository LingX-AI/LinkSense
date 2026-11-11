import { randomUUID } from "node:crypto";
import {
  DEFAULT_APPLICATION_ICON_PRESET,
  applicationIconInputSchema,
  applicationIconPresetSchema,
  type ApplicationIcon,
  type ApplicationIconInput,
  type ApplicationIconPreset,
} from "@linksense/shared";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { decodeApplicationIcon } from "./icon-input.js";

export interface ApplicationIconStore {
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(objectKey: string): Promise<void>;
  presignGet(objectKey: string, expiresSeconds: number): Promise<string>;
  enqueueRemoval?(objectKey: string): Promise<void>;
}

export type PreparedApplicationIcon = {
  preset: ApplicationIconPreset;
  objectKey: string | null;
  newObjectKey: string | null;
};

/** Shared image validation, storage and immutable-release retention for every application kind. */
export class ApplicationIconService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly store?: ApplicationIconStore,
  ) {}

  async project(row: {
    iconPreset: string;
    iconObjectKey: string | null;
  }): Promise<ApplicationIcon> {
    const parsed = applicationIconPresetSchema.safeParse(row.iconPreset);
    const preset = parsed.success ? parsed.data : DEFAULT_APPLICATION_ICON_PRESET;
    if (row.iconObjectKey === null || this.store === undefined)
      return { type: "preset", preset };
    try {
      return {
        type: "custom",
        url: await this.store.presignGet(row.iconObjectKey, 5 * 60),
        fallback_preset: preset,
      };
    } catch {
      return { type: "preset", preset };
    }
  }

  async prepare(ownerId: string, input?: ApplicationIconInput): Promise<PreparedApplicationIcon> {
    if (input === undefined)
      return { preset: DEFAULT_APPLICATION_ICON_PRESET, objectKey: null, newObjectKey: null };
    const parsed = applicationIconInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    if (parsed.data.type === "preset")
      return { preset: parsed.data.preset, objectKey: null, newObjectKey: null };
    if (this.store === undefined) throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    const { bytes, contentType, extension } = decodeApplicationIcon(parsed.data);
    const objectKey = `applications/${ownerId}/icons/${randomUUID()}.${extension}`;
    try {
      await this.store.put(objectKey, bytes, contentType);
    } catch {
      await this.removeAfterFailure(objectKey);
      throw new AppError("APPLICATION_ICON_UPLOAD_INVALID");
    }
    return { preset: DEFAULT_APPLICATION_ICON_PRESET, objectKey, newObjectKey: objectKey };
  }

  async removeAfterFailure(objectKey: string): Promise<void> {
    if (this.store === undefined) return;
    try {
      await this.store.remove(objectKey);
    } catch {
      try {
        await this.store.enqueueRemoval?.(objectKey);
      } catch {
        // Durable cleanup retries are best-effort after a failed mutation.
      }
    }
  }

  async enqueueRemoval(objectKey: string): Promise<void> {
    if (this.store === undefined) return;
    // Released icons can be shared by immutable versions and installed copies.
    // A failed reference check must retain the object, never delete optimistically.
    try {
      const [version, application] = await Promise.all([
        this.prisma.applicationVersion.findFirst({
          where: { assetsReady: true, definitionJson: { path: ["iconObjectKey"], equals: objectKey } },
          select: { id: true },
        }),
        this.prisma.application.findFirst({
          where: { iconObjectKey: objectKey, status: { not: "deleted" } },
          select: { id: true },
        }),
      ]);
      if (version || application) return;
    } catch { return; }
    try {
      if (this.store.enqueueRemoval !== undefined) {
        await this.store.enqueueRemoval(objectKey);
        return;
      }
      await this.store.remove(objectKey);
    } catch {
      try {
        await this.store.remove(objectKey);
      } catch {
        // A committed application update must not fail because cleanup failed.
      }
    }
  }
}
