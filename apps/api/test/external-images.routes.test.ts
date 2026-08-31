import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { externalImageRoutes } from "../src/modules/external-images/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp(download: AppServices["externalImages"]["download"]) {
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer test-token") {
      throw new AppError("AUTH_REQUIRED");
    }
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
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError && error.code === "AUTH_REQUIRED") {
      return reply.code(401).send({ code: error.code });
    }
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });
  await app.register(externalImageRoutes, {
    prefix: "/api/v1",
    services: {
      externalImages: { download },
    } as unknown as Pick<AppServices, "externalImages">,
  });
  return app;
}

describe("external image download route", () => {
  it("returns authenticated external image bytes as an attachment", async () => {
    const download = vi.fn(async () => ({
      data: PNG,
      filename: '演示"截图.png',
      mimeType: "image/png" as const,
      sizeBytes: PNG.byteLength,
    }));
    const app = await createApp(download);

    const response = await app.inject({
      method: "GET",
      url:
        "/api/v1/external-images/download?url=" +
        encodeURIComponent("https://cdn.example.com/assets/remote.png"),
      headers: { authorization: "Bearer test-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(PNG);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-length"]).toBe(String(PNG.byteLength));
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const disposition = response.headers["content-disposition"];
    expect(disposition).toMatch(
      /^attachment; filename="[^"\r\n]+"; filename\*=UTF-8''/u,
    );
    expect(disposition).toContain(
      "filename*=UTF-8''%E6%BC%94%E7%A4%BA%22%E6%88%AA%E5%9B%BE.png",
    );
    expect(download).toHaveBeenCalledWith(
      "https://cdn.example.com/assets/remote.png",
    );
  });

  it("requires authentication before downloading an external image", async () => {
    const download = vi.fn(async () => ({
      data: PNG,
      filename: "remote.png",
      mimeType: "image/png" as const,
      sizeBytes: PNG.byteLength,
    }));
    const app = await createApp(download);

    const response = await app.inject({
      method: "GET",
      url:
        "/api/v1/external-images/download?url=" +
        encodeURIComponent("https://cdn.example.com/assets/remote.png"),
    });

    expect(response.statusCode).toBe(401);
    expect(download).not.toHaveBeenCalled();
  });
});
