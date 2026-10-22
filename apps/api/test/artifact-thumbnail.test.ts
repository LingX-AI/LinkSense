import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalFilesystemObjectStorage } from "../src/adapters/object-storage.js";
import {
  artifactThumbnailObjectKey,
  getOrCreateArtifactThumbnail,
  removeConversationArtifactThumbnails,
  type ArtifactThumbnailSource,
} from "../src/modules/files/artifact-thumbnail.js";
import { testConfig } from "./test-config.js";

const conversationId = "20000000-0000-4000-8000-000000000001";
const fileId = "30000000-0000-4000-8000-000000000001";
const sourceKey = `conversations/${conversationId}/artifacts/${fileId}/image.png`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("artifact thumbnail storage", () => {
  it("persists a small WebP and reuses it through a new storage instance for a historical file without a checksum", async () => {
    const bytes = await image(1600, 900);
    const root = await mkdtemp(join(tmpdir(), "linksense-thumbnail-"));
    directories.push(root);
    const config = testConfig({
      LINKSENSE_EDITION: "core",
      LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
      LINKSENSE_USER_DATA_ROOT: root,
    });
    const storage = new LocalFilesystemObjectStorage(config);
    await storage.putObject(sourceKey, bytes);
    const base = fixture(bytes);
    const input = {
      ...base,
      storage,
      source: { ...base.source, checksumSha256: null },
    };

    const first = await getOrCreateArtifactThumbnail(input);
    const metadata = await sharp(first).metadata();
    expect(metadata).toMatchObject({
      format: "webp",
      width: 80,
      height: 80,
      hasAlpha: true,
    });
    expect(first.byteLength).toBeLessThanOrEqual(10_240);
    expect(
      await storage.getObjectSize(
        artifactThumbnailObjectKey(conversationId, fileId),
      ),
    ).toBe(first.byteLength);

    const restartedStorage = new LocalFilesystemObjectStorage(config);
    const read = vi.spyOn(restartedStorage, "getObjectStream");
    const second = await getOrCreateArtifactThumbnail({
      ...input,
      storage: restartedStorage,
    });
    expect(second).toEqual(first);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(
      artifactThumbnailObjectKey(conversationId, fileId),
    );
    expect(
      input.coordinator.acquireArtifactThumbnailLease,
    ).toHaveBeenCalledTimes(1);
    expect(await storage.getObjectSize(sourceKey)).toBe(bytes.byteLength);
  });

  it.each(["png", "jpeg", "webp", "gif", "avif"] as const)(
    "converts %s to a bounded static thumbnail",
    async (format) => {
      const bytes = await sharp({
        create: { width: 96, height: 128, channels: 3, background: "blue" },
      })
        .toFormat(format)
        .toBuffer();
      const input = fixture(bytes);
      input.source.mimeType = `image/${format === "jpeg" ? "jpeg" : format}`;
      const output = await getOrCreateArtifactThumbnail(input);
      expect(await sharp(output).metadata()).toMatchObject({
        format: "webp",
        width: 80,
        height: 80,
      });
      expect((await sharp(output).metadata()).pages ?? 1).toBe(1);
      expect(output.byteLength).toBeLessThanOrEqual(10_240);
    },
  );

  it("rasterizes SVG, handles long screenshots, and avoids enlarging tiny originals", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="red"/></svg>',
    );
    for (const bytes of [svg, await image(200, 8000), await image(8, 8)]) {
      const input = fixture(bytes);
      if (bytes === svg) input.source.mimeType = "image/svg+xml";
      const output = await getOrCreateArtifactThumbnail(input);
      const metadata = await sharp(output).metadata();
      expect(metadata.width).toBeLessThanOrEqual(80);
      expect(metadata.height).toBeLessThanOrEqual(80);
      expect(output.byteLength).toBeLessThanOrEqual(10_240);
    }
  });

  it("takes only the first animation frame", async () => {
    const bytes = await sharp(
      Buffer.concat([
        Buffer.alloc(100 * 100 * 3, 30),
        Buffer.alloc(100 * 100 * 3, 220),
      ]),
      {
        raw: { width: 100, height: 200, channels: 3, pageHeight: 100 },
      },
    )
      .gif({ delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2);
    const input = fixture(bytes);
    input.source.mimeType = "image/gif";
    const output = await getOrCreateArtifactThumbnail(input);
    expect((await sharp(output).metadata()).pages ?? 1).toBe(1);
  });

  it("keeps a source named thumbnail-v1.webp separate from the derived cache", async () => {
    const bytes = await sharp(await image(1000, 600))
      .webp()
      .toBuffer();
    const input = fixture(bytes, "thumbnail-v1.webp");
    input.source.mimeType = "image/webp";
    const output = await getOrCreateArtifactThumbnail(input);
    expect(await sharp(output).metadata()).toMatchObject({
      width: 80,
      height: 80,
    });
    expect(input.storage.getObjectStream).toHaveBeenCalledWith(
      input.source.objectKey,
    );
    expect(input.storage.putObject).toHaveBeenCalledWith(
      expect.not.stringMatching(
        /\/artifacts\/[a-f0-9-]+\/thumbnail-v1\.webp$/u,
      ),
      output,
      { "content-type": "image/webp" },
    );
  });

  it.each(["invalid", "checksum", "size", "pixels", "mime"])(
    "rejects %s input without caching a thumbnail and releases the lease",
    async (reason) => {
      const bytes =
        reason === "invalid"
          ? Buffer.from("not an image")
          : await image(100, 100);
      const input = fixture(bytes);
      if (reason === "checksum") input.source.checksumSha256 = "0".repeat(64);
      if (reason === "size") input.source.sizeBytes += 1;
      if (reason === "pixels") input.maxInputPixels = 100;
      if (reason === "mime") input.source.mimeType = "image/jpeg";
      await expect(getOrCreateArtifactThumbnail(input)).rejects.toMatchObject({
        code: "ARTIFACT_NOT_FOUND",
      });
      expect(input.storage.putObject).not.toHaveBeenCalled();
      expect(
        input.coordinator.releaseArtifactThumbnailLease,
      ).toHaveBeenCalledWith(fileId, "lease");
    },
  );

  it("does not regenerate on a storage failure or read an oversized source", async () => {
    const input = fixture(await image(100, 100));
    input.storage.getObjectStream.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(getOrCreateArtifactThumbnail(input)).rejects.toThrow(
      "storage unavailable",
    );
    expect(
      input.coordinator.acquireArtifactThumbnailLease,
    ).not.toHaveBeenCalled();
    const oversized = fixture(await image(100, 100));
    oversized.maximumSourceBytes = 1;
    await expect(getOrCreateArtifactThumbnail(oversized)).rejects.toMatchObject(
      { code: "ARTIFACT_NOT_FOUND" },
    );
    expect(oversized.storage.getObjectStream).not.toHaveBeenCalled();
  });

  it("rechecks the cache after a competing generator finishes", async () => {
    const input = fixture(await image(100, 100));
    const thumbnail = await sharp(await image(80, 80))
      .webp()
      .toBuffer();
    input.storage.getObjectStream
      .mockRejectedValueOnce(
        Object.assign(new Error("missing"), { code: "NoSuchKey" }),
      )
      .mockResolvedValueOnce(Readable.from([thumbnail]));
    const output = await getOrCreateArtifactThumbnail(input);
    expect(output).toEqual(thumbnail);
    expect(
      input.coordinator.acquireArtifactThumbnailLease,
    ).toHaveBeenCalledOnce();
    expect(input.storage.getObjectStream).not.toHaveBeenCalledWith(sourceKey);
  });

  it("deduplicates concurrent generation requests before reading the original", async () => {
    const input = fixture(await image(1200, 800));
    let held = false;
    input.coordinator.acquireArtifactThumbnailLease.mockImplementation(
      async () => {
        if (held) return null;
        held = true;
        return "lease";
      },
    );
    input.coordinator.releaseArtifactThumbnailLease.mockImplementation(
      async () => {
        held = false;
      },
    );
    const [first, second] = await Promise.all([
      getOrCreateArtifactThumbnail(input),
      getOrCreateArtifactThumbnail(input),
    ]);
    expect(first).toEqual(second);
    expect(input.storage.putObject).toHaveBeenCalledOnce();
    expect(
      input.storage.getObjectStream.mock.calls.filter(
        ([key]) => key === sourceKey,
      ),
    ).toHaveLength(1);
  });

  it("removes a generated thumbnail if the original is deleted while processing", async () => {
    const input = fixture(await image(100, 100));
    input.assertCurrent.mockRejectedValueOnce(new Error("deleted"));
    await expect(getOrCreateArtifactThumbnail(input)).rejects.toThrow(
      "deleted",
    );
    expect(input.storage.removeObject).toHaveBeenCalledWith(
      artifactThumbnailObjectKey(conversationId, fileId),
    );
    expect(input.coordinator.releaseArtifactThumbnailLease).toHaveBeenCalled();
  });

  it("cleans derived files while preserving retained originals and propagates cleanup failure", async () => {
    const prisma = {
      retainedArtifact: {
        findMany: vi.fn(async () => [{ originalFileId: fileId }]),
      },
    };
    const storage = {
      removeObject: vi.fn<(key: string) => Promise<void>>(
        async () => undefined,
      ),
    };
    await removeConversationArtifactThumbnails(
      prisma as never,
      storage,
      "owner",
      conversationId,
    );
    expect(prisma.retainedArtifact.findMany).toHaveBeenCalledWith({
      where: { ownerId: "owner", conversationId },
      select: { originalFileId: true },
    });
    expect(storage.removeObject).toHaveBeenCalledExactlyOnceWith(
      artifactThumbnailObjectKey(conversationId, fileId),
    );
    storage.removeObject.mockRejectedValueOnce(new Error("offline"));
    await expect(
      removeConversationArtifactThumbnails(
        prisma as never,
        storage,
        "owner",
        conversationId,
      ),
    ).rejects.toThrow("offline");
  });
});

function image(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 120, g: 60, b: 200, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
}

function fixture(bytes: Buffer, filename = "image.png") {
  const objectKey = `conversations/${conversationId}/artifacts/${fileId}/${filename}`;
  const objects = new Map<string, Buffer>([[objectKey, bytes]]);
  const source: ArtifactThumbnailSource = {
    conversationId,
    fileId,
    objectKey,
    mimeType: "image/png",
    sizeBytes: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return {
    source,
    maximumSourceBytes: 20 * 1024 * 1024,
    maxInputPixels: 40_000_000,
    storage: {
      getObjectStream: vi.fn(async (key: string) => {
        const data = objects.get(key);
        if (!data)
          throw Object.assign(new Error("missing"), { code: "NoSuchKey" });
        return Readable.from([data]);
      }),
      putObject: vi.fn(async (key: string, data: Buffer) => {
        objects.set(key, data);
      }),
      removeObject: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    },
    coordinator: {
      acquireArtifactThumbnailLease: vi.fn<
        (id: string) => Promise<string | null>
      >(async () => "lease"),
      releaseArtifactThumbnailLease: vi.fn<
        (id: string, token: string) => Promise<void>
      >(async () => undefined),
    },
    assertCurrent: vi.fn(async () => undefined),
    scheduleRemoval: vi.fn<(key: string) => Promise<void>>(
      async () => undefined,
    ),
  };
}
