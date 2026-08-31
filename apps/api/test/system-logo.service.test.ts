import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import type { LinkSenseRedis } from "../src/adapters/redis.js"
import type { RunnerClient } from "../src/adapters/runner.js"
import type { ObjectStorage } from "../src/adapters/object-storage.js"
import type { Mailer } from "../src/adapters/mailer.js"
import type { AuditService } from "../src/modules/audit/service.js"
import type { BackgroundJobs } from "../src/adapters/jobs.js"
import { SystemService } from "../src/modules/system/service.js"
import { testConfig } from "./test-config.js"

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

describe("system product logo settings", () => {
  it("stores uploaded logos in object storage and cleans up the previous logo", async () => {
    const previousObjectKey =
      "system/product-logo/00000000-0000-4000-8000-000000000001.png"
    const database = inMemorySystemSettings({
      organization_logo: {
        object_key: previousObjectKey,
        content_type: "image/png",
        updated_at: "2026-08-04T00:00:00.000Z",
      },
    })
    const storage = inMemoryLogoStorage()
    const enqueueObjectDelete = vi.fn().mockResolvedValue(undefined)
    const service = createSystemService(database.prisma, storage.storage, {
      enqueueObjectDelete,
    })

    const settings = await service.replaceProductLogo(
      "01900000-0000-7000-8000-000000000099",
      {
        filename: "brand.png",
        declaredMimeType: "image/png",
        bytes: ONE_PIXEL_PNG,
      },
      { ipAddress: "127.0.0.1", userAgent: "logo-test" }
    )

    expect(settings.logo_url).toMatch(/^\/api\/v1\/system\/logo\?v=/)
    expect(settings.logo_updated_at).not.toBeNull()
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^system\/product-logo\/.+\.png$/),
      ONE_PIXEL_PNG,
      expect.objectContaining({
        "content-type": "image/png",
        "original-filename": "brand.png",
      })
    )
    expect(database.settingsJson().organization_logo).toMatchObject({
      content_type: "image/png",
    })
    expect(enqueueObjectDelete).toHaveBeenCalledWith(previousObjectKey)
    expect(database.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "product_logo_updated",
          metadataJson: expect.objectContaining({ content_type: "image/png" }),
        }),
      })
    )

    const content = await service.readProductLogo()
    expect(content).toMatchObject({ contentType: "image/png" })
    expect(content?.data).toEqual(ONE_PIXEL_PNG)
  })

  it("removes the configured logo and schedules the object for deletion", async () => {
    const objectKey =
      "system/product-logo/00000000-0000-4000-8000-000000000002.png"
    const database = inMemorySystemSettings({
      organization_logo: {
        object_key: objectKey,
        content_type: "image/png",
        updated_at: "2026-08-04T00:00:00.000Z",
      },
    })
    const storage = inMemoryLogoStorage()
    const enqueueObjectDelete = vi.fn().mockResolvedValue(undefined)
    const service = createSystemService(database.prisma, storage.storage, {
      enqueueObjectDelete,
    })

    const settings = await service.deleteProductLogo(
      "01900000-0000-7000-8000-000000000099",
      { ipAddress: "127.0.0.1", userAgent: "logo-test" }
    )

    expect(settings.logo_url).toBeNull()
    expect(settings.logo_updated_at).toBeNull()
    expect(database.settingsJson()).not.toHaveProperty("organization_logo")
    expect(enqueueObjectDelete).toHaveBeenCalledWith(objectKey)
    expect(database.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "product_logo_deleted" }),
      })
    )
  })
})

function inMemorySystemSettings(initialSettingsJson: Record<string, unknown>) {
  let settingsJson = { ...initialSettingsJson }
  const auditCreate = vi.fn().mockResolvedValue(undefined)
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson })),
      upsert: vi.fn(
        async (input: { update: { settingsJson: Record<string, unknown> } }) => {
          settingsJson = { ...input.update.settingsJson }
          return { settingsJson }
        }
      ),
    },
    auditLog: { create: auditCreate },
  }
  const prisma = {
    $transaction: vi.fn(
      async <T>(callback: (transaction: typeof tx) => Promise<T>) =>
        callback(tx)
    ),
    systemSetting: tx.systemSetting,
  } as unknown as PrismaClient
  return {
    prisma,
    auditCreate,
    settingsJson: () => settingsJson,
  }
}

function inMemoryLogoStorage() {
  const objects = new Map<string, Buffer>()
  const putObject = vi.fn(
    async (key: string, bytes: Buffer) => void objects.set(key, bytes)
  )
  return {
    putObject,
    storage: {
      putObject,
      getObjectStream: vi.fn(async (key: string) => {
        const bytes = objects.get(key)
        if (!bytes) throw new Error("missing object")
        return Readable.from(bytes)
      }),
    } as unknown as ObjectStorage,
  }
}

function createSystemService(
  prisma: PrismaClient,
  storage: ObjectStorage,
  jobs: Pick<BackgroundJobs, "enqueueObjectDelete">
) {
  return new SystemService(
    prisma,
    {} as LinkSenseRedis,
    {} as RunnerClient,
    storage,
    {} as Mailer,
    {} as AuditService,
    testConfig(),
    jobs as BackgroundJobs
  )
}
