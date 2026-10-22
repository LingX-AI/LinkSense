import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalFilesystemObjectStorage } from "../src/adapters/object-storage.js";
import { sendAppError } from "../src/lib/http.js";
import { AppError } from "../src/lib/errors.js";
import { fileRoutes } from "../src/modules/files/routes.js";
import { FileService } from "../src/modules/files/service.js";
import type { AppServices } from "../src/services.js";
import { testConfig } from "./test-config.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const fileId = "30000000-0000-4000-8000-000000000001";
const url = `/conversations/${conversationId}/files/${fileId}/thumbnail`;
const apps: FastifyInstance[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("artifact thumbnail HTTP contract", () => {
  it("serves a real small WebP for existing records and reuses persistent cache on the next request", async () => {
    const input = await fixture();
    const first = await input.app.inject(url);
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toBe("image/webp");
    expect(first.headers["cache-control"]).toBe("private, max-age=300");
    expect(first.headers.vary).toBe("Authorization, Cookie");
    expect(first.headers["x-content-type-options"]).toBe("nosniff");
    expect(await sharp(first.rawPayload).metadata()).toMatchObject({
      format: "webp",
      width: 80,
      height: 80,
    });
    expect(first.rawPayload.byteLength).toBeLessThanOrEqual(10_240);
    input.read.mockClear();
    const second = await input.app.inject(url);
    expect(second.rawPayload).toEqual(first.rawPayload);
    expect(input.read).toHaveBeenCalledOnce();
    expect(input.read).not.toHaveBeenCalledWith(input.originalKey);
    expect(input.prisma.conversationFile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId,
          status: "registered",
          kind: "artifact",
          downloadable: true,
        }),
      }),
    );
  });

  it("authorizes before returning a conditional cached response", async () => {
    const input = await fixture();
    const first = await input.app.inject(url);
    const etag = first.headers.etag;
    expect(etag).toEqual(expect.any(String));
    const cached = await input.app.inject({
      url,
      headers: { "if-none-match": String(etag) },
    });
    expect(cached.statusCode).toBe(304);
    input.conversations.assertOwner.mockRejectedValueOnce(
      new AppError("CONVERSATION_NOT_FOUND"),
    );
    input.read.mockClear();
    const denied = await input.app.inject({
      url,
      headers: { "if-none-match": String(etag) },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({
      error_code: "CONVERSATION_NOT_FOUND",
    });
    expect(input.read).not.toHaveBeenCalled();
  });

  it.each(["unauthenticated", "missing", "non-image", "invalid-id"])(
    "rejects %s requests before accessing image storage",
    async (reason) => {
      const input = await fixture(reason !== "unauthenticated");
      if (reason === "missing")
        input.prisma.conversationFile.findFirst.mockResolvedValueOnce(null);
      if (reason === "non-image")
        input.prisma.conversationFile.findFirst.mockResolvedValueOnce({
          ...input.row,
          mimeType: "application/pdf",
          filename: "document.pdf",
        });
      const response = await input.app.inject(
        reason === "invalid-id" ? url.replace(fileId, "invalid") : url,
      );
      expect(response.statusCode).toBe(
        reason === "unauthenticated"
          ? 401
          : reason === "invalid-id"
            ? 400
            : 404,
      );
      expect(input.read).not.toHaveBeenCalled();
      expect(response.body).not.toContain(input.originalKey);
    },
  );
});

async function fixture(authenticated = true) {
  const root = await mkdtemp(join(tmpdir(), "linksense-thumbnail-http-"));
  directories.push(root);
  const config = testConfig({
    LINKSENSE_EDITION: "core",
    LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
    LINKSENSE_USER_DATA_ROOT: root,
  });
  const storage = new LocalFilesystemObjectStorage(config);
  const bytes = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const originalKey = `conversations/${conversationId}/artifacts/${fileId}/image.png`;
  await storage.putObject(originalKey, bytes);
  const row = {
    id: fileId,
    filename: "image.png",
    mimeType: "image/png",
    minioObjectKey: originalKey,
    sizeBytes: BigInt(bytes.byteLength),
    checksumSha256: null,
  };
  const prisma = {
    conversationFile: {
      findFirst: vi.fn(async (): Promise<typeof row | null> => row),
    },
  };
  const conversations = { assertOwner: vi.fn(async () => undefined) };
  const coordinator = {
    acquireArtifactThumbnailLease: vi.fn(async () => "lease"),
    releaseArtifactThumbnailLease: vi.fn(async () => undefined),
  };
  const service = new FileService(
    prisma as never,
    conversations as never,
    storage,
    {} as never,
    config,
    coordinator as never,
    { enqueueObjectDelete: vi.fn(), enqueueWorkspaceDirectoryRemoval: vi.fn() },
  );
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (!authenticated) throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: ownerId,
      email: "owner@example.test",
      name: "Owner",
      role: "user",
      status: "active",
      preferredLocale: "zh-CN",
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(fileRoutes, {
    prefix: "/conversations",
    services: { files: service } as unknown as AppServices,
  });
  return {
    app,
    read: vi.spyOn(storage, "getObjectStream"),
    originalKey,
    prisma,
    conversations,
    row,
  };
}
