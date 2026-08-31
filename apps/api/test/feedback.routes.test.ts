import { Readable } from "node:stream";

import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import {
  adminFeedbackRoutes,
  feedbackRoutes,
} from "../src/modules/feedback/routes.js";
import type { AppServices } from "../src/services.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("feedback routes", () => {
  it("accepts text and repeated image fields for the authenticated user", async () => {
    const submit = vi.fn(async () => ({
      id: "10000000-0000-4000-8000-000000000010",
      created_at: "2026-08-03T05:06:07.000Z",
      image_count: 2,
    }));
    const app = await feedbackApp({ submit });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/feedback",
      ...multipartFeedback("界面有问题", ["one.png", "two.png"]),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ image_count: 2 });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ email: "lin@example.com" }),
      {
        content: "界面有问题",
        images: [
          expect.objectContaining({ filename: "one.png", bytes: PNG }),
          expect.objectContaining({ filename: "two.png", bytes: PNG }),
        ],
      },
      expect.objectContaining({ ipAddress: "127.0.0.1" }),
    );
  });

  it("rejects non-multipart input before calling the service", async () => {
    const submit = vi.fn();
    const app = await feedbackApp({ submit });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/feedback",
      payload: { content: "not multipart" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "FEEDBACK_SUBMISSION_INVALID",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("protects administrator listing and streams verified images privately", async () => {
    const listForAdmin = vi.fn(async () => ({
      items: [],
      next_cursor: null,
    }));
    const readImageForAdmin = vi.fn(async () => ({
      data: Readable.from(PNG),
      filename: "问题截图.png",
      mimeType: "image/png" as const,
      sizeBytes: PNG.byteLength,
    }));
    const deleteForAdmin = vi.fn(async () => undefined);
    const requireAdmin = vi.fn(async (request) => {
      request.authUser = authUser("admin");
    });
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate("requireAdmin", requireAdmin);
    await app.register(adminFeedbackRoutes, {
      prefix: "/api/v1/admin/feedback",
      services: {
        feedback: { listForAdmin, readImageForAdmin, deleteForAdmin },
      } as unknown as AppServices,
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/feedback?limit=20",
    });
    const imageResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/feedback/10000000-0000-4000-8000-000000000010/images/10000000-0000-4000-8000-000000000011",
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/feedback/10000000-0000-4000-8000-000000000010",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.headers["cache-control"]).toBe("private, no-store");
    expect(imageResponse.statusCode).toBe(200);
    expect(imageResponse.headers["content-type"]).toContain("image/png");
    expect(imageResponse.headers["cache-control"]).toBe("private, no-store");
    expect(imageResponse.headers["x-content-type-options"]).toBe("nosniff");
    expect(imageResponse.rawPayload).toEqual(PNG);
    expect(deleteResponse.statusCode).toBe(204);
    expect(deleteForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin" }),
      "10000000-0000-4000-8000-000000000010",
      expect.objectContaining({ ipAddress: "127.0.0.1" }),
    );
    expect(requireAdmin).toHaveBeenCalledTimes(3);
  });
});

async function feedbackApp(feedback: { submit: ReturnType<typeof vi.fn> }) {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(multipart);
  app.decorate("authenticate", async (request) => {
    request.authUser = authUser("user");
  });
  await app.register(feedbackRoutes, {
    prefix: "/api/v1/feedback",
    services: { feedback } as unknown as AppServices,
  });
  return app;
}

function authUser(role: "user" | "admin") {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    email: "lin@example.com",
    name: "林晓",
    role,
    status: "active" as const,
    preferredLocale: "zh-CN" as const,
    avatarObjectKey: null,
    authValidAfter: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function multipartFeedback(content: string, filenames: string[]) {
  const boundary = "----linksense-feedback-test";
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${content}\r\n`,
    ),
  ];
  for (const filename of filenames) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      PNG,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}
