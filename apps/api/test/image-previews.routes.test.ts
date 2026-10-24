import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { internalRunnerRoutes } from "../src/modules/events/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const FILE_ID = "30000000-0000-4000-8000-000000000001";
const payload = {
  conversationId: CONVERSATION_ID, turnId: "native-turn-1",
  workspaceRelativePath: ".linksense/inline-images/preview.png",
  displayName: "preview.png", mimeType: "image/png",
};
const headers = { authorization: "Bearer runner-secret", "x-linksense-owner-id": OWNER_ID };
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function fixture() {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  const registerImagePreview = vi.fn(async () => ({ file_id: FILE_ID }));
  const registerArtifact = vi.fn();
  await app.register(internalRunnerRoutes, { services: {
    config: { runnerSharedSecret: "runner-secret" },
    files: { registerImagePreview, registerArtifact },
  } as unknown as AppServices });
  return { app, registerImagePreview, registerArtifact };
}

describe("internal image preview registration", () => {
  it("passes the authenticated owner and validated preview to the dedicated service", async () => {
    const { app, registerImagePreview, registerArtifact } = await fixture();
    const response = await app.inject({ method: "POST", url: "/image-previews", headers, payload });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ file_id: FILE_ID });
    expect(registerImagePreview).toHaveBeenCalledExactlyOnceWith({ ...payload, ownerId: OWNER_ID });
    expect(registerArtifact).not.toHaveBeenCalled();
  });

  it.each([{}, { authorization: "Bearer invalid" }])("rejects unauthenticated workers", async (requestHeaders) => {
    const { app, registerImagePreview } = await fixture();
    const response = await app.inject({ method: "POST", url: "/image-previews", headers: requestHeaders, payload });
    expect(response.statusCode).toBe(401);
    expect(registerImagePreview).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, mimeType: "application/pdf" },
    { ...payload, artifactKind: "inline_image" },
    { ...payload, conversationId: "invalid" },
  ])("rejects invalid preview contracts before invoking the service", async (input) => {
    const { app, registerImagePreview } = await fixture();
    const response = await app.inject({ method: "POST", url: "/image-previews", headers, payload: input });
    expect(response.statusCode).toBe(400);
    expect(registerImagePreview).not.toHaveBeenCalled();
  });

  it("requires a valid owner identity even for an authenticated worker", async () => {
    const { app, registerImagePreview } = await fixture();
    const response = await app.inject({ method: "POST", url: "/image-previews", headers: { authorization: headers.authorization }, payload });
    expect(response.statusCode).toBe(400);
    expect(registerImagePreview).not.toHaveBeenCalled();
  });

  it("propagates a turn authorization rejection without publishing file-service activity", async () => {
    const { app, registerImagePreview, registerArtifact } = await fixture();
    registerImagePreview.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    const response = await app.inject({ method: "POST", url: "/image-previews", headers, payload });
    expect(response.statusCode).toBe(403);
    expect(registerArtifact).not.toHaveBeenCalled();
  });
});
