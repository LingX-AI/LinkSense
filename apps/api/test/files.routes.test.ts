import Fastify, { type FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskArtifactFileTypeSchema } from "@linksense/shared";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { fileRoutes } from "../src/modules/files/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const FILE_ID = "30000000-0000-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("task artifact list route", () => {
  it("lists the authenticated owner's artifacts with validated search and pagination", async () => {
    const listTaskArtifacts = vi.fn(async () => ({
      items: [],
      next_cursor: null,
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { listTaskArtifacts },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/conversations/artifacts?search=%E6%80%BB%E7%BB%93&limit=25",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(listTaskArtifacts).toHaveBeenCalledWith(OWNER_ID, {
      search: "总结",
      limit: 25,
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [], next_cursor: null },
    });
  });

  it.each(taskArtifactFileTypeSchema.options)(
    "combines the %s filter with search and pagination for the authenticated owner",
    async (fileType) => {
      const listTaskArtifacts = vi.fn(async () => ({
        items: [], next_cursor: null,
      }));
      const app = await artifactListApp(listTaskArtifacts);
      const cursor = `2026-08-10T08:30:00.000Z|${FILE_ID}`;
      const query = new URLSearchParams({
        file_type: fileType,
        search: " 总结 ",
        limit: "2",
        cursor,
      });

      const response = await app.inject(`/conversations/artifacts?${query}`);

      expect(response.statusCode, response.body).toBe(200);
      expect(listTaskArtifacts).toHaveBeenCalledWith(OWNER_ID, {
        fileType,
        search: "总结",
        limit: 2,
        cursor,
      });
    },
  );

  it("requires authentication before listing filtered artifacts", async () => {
    const listTaskArtifacts = vi.fn();
    const app = await artifactListApp(listTaskArtifacts, false);

    const response = await app.inject("/conversations/artifacts?file_type=image");

    expect(response.statusCode).toBe(401);
    expect(listTaskArtifacts).not.toHaveBeenCalled();
  });

  it.each([
    "cursor=invalid",
    "file_type=unsupported",
    "file_type=IMAGE",
    "file_type=all",
    "file_type=",
    "file_type=image&file_type=word",
  ])("rejects invalid artifact query %s before calling the service", async (query) => {
    const listTaskArtifacts = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
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
      services: {
        files: { listTaskArtifacts },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/artifacts?${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(listTaskArtifacts).not.toHaveBeenCalled();
  });
});

async function artifactListApp(
  listTaskArtifacts: ReturnType<typeof vi.fn>,
  authenticated = true,
) {
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (!authenticated) throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: OWNER_ID,
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
    services: { files: { listTaskArtifacts } } as unknown as AppServices,
  });
  return app;
}

describe("draft attachment mutation routes", () => {
  it("clears an exact attachment batch with one service operation", async () => {
    const deleteStagedAttachments = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { deleteStagedAttachments },
      } as unknown as AppServices,
    });

    const secondFileId = "30000000-0000-4000-8000-000000000002";
    const response = await app.inject({
      method: "DELETE",
      url: `/conversations/${CONVERSATION_ID}/attachments`,
      payload: { file_ids: [FILE_ID, secondFileId] },
    });

    expect(response.statusCode, response.body).toBe(204);
    expect(deleteStagedAttachments).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      [FILE_ID, secondFileId],
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
  });
});

describe("attachment preview content route", () => {
  it("returns authenticated raw image bytes with private inline headers", async () => {
    const readAttachmentPreviewContent = vi.fn(async () => ({
      data: PNG,
      filename: '报告"预览.png',
      mimeType: "image/png" as const,
      sizeBytes: PNG.byteLength,
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { readAttachmentPreviewContent },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/attachments/${FILE_ID}/content`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(PNG);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-length"]).toBe(String(PNG.byteLength));
    expect(response.headers["content-security-policy"]).toContain(
      "sandbox; default-src 'none'",
    );
    const disposition = response.headers["content-disposition"];
    expect(disposition).toMatch(
      /^inline; filename="[^"\r\n]+"; filename\*=UTF-8''/u,
    );
    expect(disposition).toContain(
      "filename*=UTF-8''%E6%8A%A5%E5%91%8A%22%E9%A2%84%E8%A7%88.png",
    );
    expect(readAttachmentPreviewContent).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );
  });

  it("returns authenticated XLSX bytes for the shared document preview", async () => {
    const spreadsheet = Buffer.from("xlsx-content");
    const readAttachmentPreviewContent = vi.fn(async () => ({
      data: spreadsheet,
      filename: "出差费用明细.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
      sizeBytes: spreadsheet.byteLength,
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { readAttachmentPreviewContent },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/attachments/${FILE_ID}/content`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(spreadsheet);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-length"]).toBe(
      String(spreadsheet.byteLength),
    );
    expect(readAttachmentPreviewContent).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );
  });
});

describe("artifact preview document content route", () => {
  it("returns authenticated PPTX bytes with private inline headers", async () => {
    const presentation = Buffer.from("pptx-content");
    const readArtifactPreviewDocument = vi.fn(async () => ({
      data: Readable.from(presentation),
      filename: 'AI 介绍"终稿.pptx',
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const,
      sizeBytes: presentation.byteLength,
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { readArtifactPreviewDocument },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/content`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(presentation);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-length"]).toBe(
      String(presentation.byteLength),
    );
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''AI%20%E4%BB%8B%E7%BB%8D%22%E7%BB%88%E7%A8%BF.pptx",
    );
    expect(readArtifactPreviewDocument).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );
  });

  it.each([
    [
      "DOCX",
      "word-content",
      "方案.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "XLSX",
      "excel-content",
      "预算.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["HTML", "html-content", "页面.html", "text/html"],
    ["ZIP", "zip-content", "交付资料.zip", "application/zip"],
    ["PDF", "pdf-content", "报告.pdf", "application/pdf"],
    ["code", "code-content", "preview.ts", "text/plain"],
    ["CSV", "csv-content", "records.csv", "text/csv"],
  ] as const)(
    "returns authenticated %s bytes inline",
    async (_label, content, filename, mimeType) => {
      const data = Buffer.from(content);
      const readArtifactPreviewDocument = vi.fn(async () => ({
        data: Readable.from(data),
        filename,
        mimeType,
        sizeBytes: data.byteLength,
      }));
      const app = Fastify();
      apps.push(app);
      app.decorate("authenticate", async (request: FastifyRequest) => {
        request.authUser = {
          id: OWNER_ID,
          email: "owner@example.test",
          name: "Owner",
          role: "user",
          status: "active",
          preferredLocale: "zh-CN",
          avatarObjectKey: null,
          authValidAfter: new Date(0),
        };
      });
      await app.register(fileRoutes, {
        prefix: "/conversations",
        services: {
          files: { readArtifactPreviewDocument },
        } as unknown as AppServices,
      });

      const response = await app.inject({
        method: "GET",
        url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/content`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(data);
      expect(response.headers["content-type"]).toBe(mimeType);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-length"]).toBe(String(data.byteLength));
      expect(response.headers["content-security-policy"]).toContain(
        "sandbox; default-src 'none'",
      );
      expect(response.headers["content-disposition"]).toMatch(
        /^inline; filename="[^"\r\n]+"; filename\*=UTF-8''/u,
      );
      expect(readArtifactPreviewDocument).toHaveBeenCalledWith(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      );
    },
  );
});

describe("artifact download content route", () => {
  it.each([
    ["PDF", "报告.pdf", "application/pdf"],
    ["MP3", "旁白.mp3", "audio/mpeg"],
    ["binary", "模型.bin", "application/octet-stream"],
  ] as const)(
    "streams any downloadable %s artifact with attachment headers",
    async (_label, filename, mimeType) => {
      const data = Buffer.from(`download-${filename}`);
      const readArtifactDownload = vi.fn(async () => ({
        data: Readable.from(data),
        filename,
        mimeType,
        sizeBytes: data.byteLength,
      }));
      const app = Fastify();
      apps.push(app);
      app.decorate("authenticate", async (request: FastifyRequest) => {
        request.authUser = {
          id: OWNER_ID,
          email: "owner@example.test",
          name: "Owner",
          role: "user",
          status: "active",
          preferredLocale: "zh-CN",
          avatarObjectKey: null,
          authValidAfter: new Date(0),
        };
      });
      await app.register(fileRoutes, {
        prefix: "/conversations",
        services: {
          files: { readArtifactDownload },
        } as unknown as AppServices,
      });

      const response = await app.inject({
        method: "GET",
        url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/download`,
        headers: { "user-agent": "LinkSense Test" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(data);
      expect(response.headers["content-type"]).toBe(mimeType);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-length"]).toBe(String(data.byteLength));
      expect(response.headers["content-disposition"]).toMatch(
        /^attachment; filename="[^"\r\n]+"; filename\*=UTF-8''/u,
      );
      expect(readArtifactDownload).toHaveBeenCalledWith(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        expect.objectContaining({ userAgent: "LinkSense Test" }),
      );
    },
  );
});

describe("artifact media range route", () => {
  it("returns a verified single range with 206 headers without buffering the object", async () => {
    const data = Buffer.from("streamed-media-range");
    const readArtifactPreviewMedia = vi.fn(async () => ({
      data: Readable.from(data),
      filename: "demo.mp4",
      mimeType: "video/mp4" as const,
      sizeBytes: 1_024,
      range: { start: 100, end: 299 },
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { readArtifactPreviewMedia },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/media`,
      headers: { range: "bytes=100-299" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.rawPayload).toEqual(data);
    expect(response.headers["content-type"]).toBe("video/mp4");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-range"]).toBe("bytes 100-299/1024");
    expect(response.headers["content-length"]).toBe("200");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''demo.mp4",
    );
    expect(readArtifactPreviewMedia).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
      { type: "from", start: 100, end: 299 },
    );
  });

  it("returns the full verified media object with Range capability headers", async () => {
    const data = Buffer.from("full-media");
    const readArtifactPreviewMedia = vi.fn(async () => ({
      data: Readable.from(data),
      filename: "audio.mp3",
      mimeType: "audio/mpeg" as const,
      sizeBytes: data.byteLength,
      range: null,
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { readArtifactPreviewMedia },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/media`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(data);
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-length"]).toBe(String(data.byteLength));
    expect(response.headers["content-range"]).toBeUndefined();
    expect(readArtifactPreviewMedia).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
      { type: "full" },
    );
  });

  it("rejects malformed or multi-range headers with 416 before reading an artifact", async () => {
    const readArtifactPreviewMedia = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
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
      services: {
        files: { readArtifactPreviewMedia },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/media`,
      headers: { range: "bytes=0-99,200-299" },
    });

    expect(response.statusCode).toBe(416);
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "VALIDATION_ERROR",
    });
    expect(readArtifactPreviewMedia).not.toHaveBeenCalled();
  });
});

describe("artifact image preview route", () => {
  it("returns an authenticated owner-only preview link envelope", async () => {
    const createArtifactPreviewLink = vi.fn(async () => ({
      url: "https://objects.example/preview.png?signature=preview",
      expires_at: "2026-07-14T03:05:00.000Z",
      filename: "预览.png",
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
        email: "owner@example.test",
        name: "Owner",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      };
    });
    await app.register(fileRoutes, {
      prefix: "/conversations",
      services: {
        files: { createArtifactPreviewLink },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        url: "https://objects.example/preview.png?signature=preview",
        expires_at: "2026-07-14T03:05:00.000Z",
        filename: "预览.png",
      },
    });
    expect(createArtifactPreviewLink).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );
  });

  it("preserves the owner-only not-found response from the service", async () => {
    const createArtifactPreviewLink = vi.fn(async () => {
      throw new AppError("CONVERSATION_NOT_FOUND");
    });
    const app = Fastify();
    apps.push(app);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      request.authUser = {
        id: OWNER_ID,
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
      services: {
        files: { createArtifactPreviewLink },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/files/${FILE_ID}/preview`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "CONVERSATION_NOT_FOUND",
    });
  });
});
