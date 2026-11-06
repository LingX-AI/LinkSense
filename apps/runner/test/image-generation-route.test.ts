import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRunnerConfig } from "../src/config.js";
import { ImageGenerationRequestError } from "../src/image-generation-error.js";
import type { AppServerProcessPool } from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

describe("image generation worker route", () => {
  const conversationId = "01900000-0000-7000-8000-000000000001";
  const generateImage = vi.fn<AppServerProcessPool["generateImage"]>();
  let root: string;
  let server: ReturnType<typeof buildRunnerServer>;
  const input = {
    method: "POST" as const,
    url: `/mcp-image-generation/${conversationId}/generate`,
    headers: { authorization: "Bearer scoped-turn-token" },
    payload: { prompt: "A blue background", image_name: "Blue background" },
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "linksense-image-route-"));
    generateImage.mockReset().mockResolvedValue({ success: true });
    server = buildRunnerServer(parseRunnerConfig({
      LINKSENSE_USER_DATA_ROOT: root,
      LINKSENSE_RUNNER_SHARED_SECRET: "runner-555555555555555555555555555555",
      LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal",
    }), { generateImage } as unknown as AppServerProcessPool, new WorkspaceManager(root));
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it("delegates authorization with the turn token and does not forward missing credentials", async () => {
    expect((await server.inject({ ...input, headers: {} })).statusCode).toBe(401);
    expect(generateImage).not.toHaveBeenCalled();
    expect((await server.inject(input)).statusCode).toBe(200);
    expect(generateImage).toHaveBeenCalledWith(conversationId, "scoped-turn-token", expect.objectContaining(input.payload), expect.any(AbortSignal));
  });

  it("rejects a malformed conversation identifier without forwarding or exposing validation details", async () => {
    const response = await server.inject({ ...input, url: "/mcp-image-generation/not-a-task/generate" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "IMAGE_GENERATION_INVALID", retryable: false });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it.each([
    { input_images: [{ mime_type: "image/png", data_base64: "Y=Q=" }] },
    { input_images: [{ mime_type: "image/png", data_base64: "YQ?=" }] },
    { input_images: [{ mime_type: "image/png", data_base64: "YQ=" }] },
  ])("returns a non-retryable validation failure for invalid reference bytes: %j", async (invalid) => {
    const response = await server.inject({ ...input, payload: { ...input.payload, ...invalid } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "IMAGE_GENERATION_INVALID", retryable: false });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("forwards a 4 MiB reference through the worker schema without a stack overflow", async () => {
    const reference = { mime_type: "image/png", data_base64: Buffer.alloc(4 * 1024 * 1024).toString("base64") };
    const response = await server.inject({ ...input, payload: { ...input.payload, input_images: [reference] } });
    expect(response.statusCode).toBe(200);
    expect(generateImage).toHaveBeenCalledWith(conversationId, "scoped-turn-token", expect.objectContaining({ input_images: [reference] }), expect.any(AbortSignal));
  });

  it.each([
    [new RangeError("Maximum call stack size exceeded; synthetic-private-token"), 500, "INTERNAL_ERROR", false],
    [new TypeError("invalid local operation; synthetic-private-token"), 500, "INTERNAL_ERROR", false],
    [new ImageGenerationRequestError("INTERNAL_ERROR", false, 500), 500, "INTERNAL_ERROR", false],
    [new ImageGenerationRequestError("IMAGE_GENERATION_UNAVAILABLE", true, 503), 503, "IMAGE_GENERATION_UNAVAILABLE", true],
    [new ImageGenerationRequestError("IMAGE_GENERATION_FORBIDDEN", false, 403), 403, "IMAGE_GENERATION_FORBIDDEN", false],
  ] as const)("returns sanitized retry semantics for %s", async (error, status, code, retryable) => {
    generateImage.mockRejectedValueOnce(error);
    const response = await server.inject(input);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, retryable });
    expect(response.body).not.toContain("synthetic-private-token");
    expect(generateImage).toHaveBeenCalledOnce();
  });
});
