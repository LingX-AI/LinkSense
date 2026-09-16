import Fastify, { type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { fileRoutes } from "../src/modules/files/routes.js";
import type { AppServices } from "../src/services.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const fileId = "30000000-0000-4000-8000-000000000001";
const file = { id: fileId, filename: "notes.txt", mime_type: "text/plain", size_bytes: 5, status: "staged", turn_id: null };
const apps: ReturnType<typeof Fastify>[] = [];

async function fixture(authenticated = true) {
  const app = Fastify();
  apps.push(app);
  await app.register(multipart);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (!authenticated) throw new AppError("AUTH_REQUIRED");
    request.authUser = { id: ownerId, email: "owner@example.test", name: "Owner", role: "user", status: "active", preferredLocale: "zh-CN", avatarObjectKey: null, authValidAfter: new Date(0) };
  });
  const access = vi.fn(async () => undefined);
  const files = {
    uploadAttachment: vi.fn(async () => ({ ...file, workspace_relative_path: "private/path", checksum_sha256: "private" })),
    listInteractiveAttachments: vi.fn(async () => ({ items: [file] })),
    deleteStagedAttachments: vi.fn(async () => undefined),
  };
  await app.register(fileRoutes, { prefix: "/conversations", services: {
    files, conversations: { assertInteractiveFileAccess: access }, config: { upload: { maxFileSizeBytes: 10, maxFilesPerConversation: 100 } },
  } as unknown as AppServices });
  return { app, files, access };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function uploadBody(content = "notes") {
  return { headers: { "content-type": "multipart/form-data; boundary=upload-boundary" }, payload: `--upload-boundary\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--upload-boundary--\r\n` };
}

describe("interactive file routes", () => {
  it("uploads through the authenticated file service and redacts storage details", async () => {
    const { app, files, access } = await fixture();
    const response = await app.inject({ method: "POST", url: `/conversations/${conversationId}/interactive-attachments`, ...uploadBody() });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().data).toEqual(file);
    expect(access).toHaveBeenCalledWith(ownerId, conversationId);
    expect(files.uploadAttachment).toHaveBeenCalledWith(ownerId, conversationId, { filename: "notes.txt", reportedMimeType: "text/plain", data: Buffer.from("notes"), interactive: true }, expect.any(Object));
  });

  it("lists current task files and scopes removal to application uploads", async () => {
    const { app, files } = await fixture();
    expect((await app.inject(`/conversations/${conversationId}/interactive-attachments`)).json().data).toEqual({ items: [file] });
    expect(files.listInteractiveAttachments).toHaveBeenCalledWith(ownerId, conversationId);
    expect((await app.inject({ method: "DELETE", url: `/conversations/${conversationId}/interactive-attachments/${fileId}` })).statusCode).toBe(204);
    expect(files.deleteStagedAttachments).toHaveBeenCalledWith(ownerId, conversationId, [fileId], expect.any(Object), true);
  });

  it.each(["POST", "GET", "DELETE"] as const)("requires authentication for %s", async (method) => {
    const { app, files } = await fixture(false);
    const response = await app.inject({ method, url: `/conversations/${conversationId}/interactive-attachments${method === "DELETE" ? `/${fileId}` : ""}` });
    expect(response.statusCode).toBe(401);
    expect(files.uploadAttachment).not.toHaveBeenCalled();
    expect(files.listInteractiveAttachments).not.toHaveBeenCalled();
    expect(files.deleteStagedAttachments).not.toHaveBeenCalled();
  });

  it("rejects revoked permissions before accepting upload data", async () => {
    const { app, access, files } = await fixture();
    access.mockRejectedValue(new AppError("FORBIDDEN"));
    const response = await app.inject({ method: "POST", url: `/conversations/${conversationId}/interactive-attachments`, ...uploadBody() });
    expect(response.statusCode).toBe(403);
    expect(files.uploadAttachment).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads before storing them", async () => {
    const { app, files } = await fixture();
    const response = await app.inject({ method: "POST", url: `/conversations/${conversationId}/interactive-attachments`, ...uploadBody("x".repeat(11)) });
    expect(response.statusCode).toBe(413);
    expect(response.json().error_code).toBe("FILE_LIMIT_EXCEEDED");
    expect(files.uploadAttachment).not.toHaveBeenCalled();
  });
});
