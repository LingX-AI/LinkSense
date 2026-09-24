import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionRequestError } from "../src/connection-error.js";
import { parseRunnerConfig } from "../src/config.js";
import type { AppServerProcessPool } from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

describe("Microsoft file worker route", () => {
  const conversationId = "01900000-0000-7000-8000-000000000001";
  const accessConnection = vi.fn<AppServerProcessPool["accessConnection"]>();
  let directory: string;
  let server: ReturnType<typeof buildRunnerServer>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "linksense-connection-route-"));
    accessConnection.mockReset().mockResolvedValue({ kind: "connections", items: [] });
    server = buildRunnerServer(
      parseRunnerConfig({
        LINKSENSE_USER_DATA_ROOT: directory,
        LINKSENSE_RUNNER_SHARED_SECRET: "runner-555555555555555555555555555555",
        LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal",
      }),
      { accessConnection } as unknown as AppServerProcessPool,
      new WorkspaceManager(directory),
    );
  });
  afterEach(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const input = {
    method: "POST" as const,
    url: `/mcp-connections/${conversationId}/execute`,
    payload: { operation: "list_connections" },
  };
  it("refuses missing credentials before delegation and passes the process token and abort signal to the pool", async () => {
    expect((await server.inject(input)).statusCode).toBe(401);
    expect(accessConnection).not.toHaveBeenCalled();
    const response = await server.inject({
      ...input,
      headers: { authorization: "Bearer process-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(accessConnection).toHaveBeenCalledWith(
      conversationId,
      "process-token",
      { operation: "list_connections" },
      expect.any(AbortSignal),
    );
  });
  it("rejects incomplete writes before reaching the API", async () => {
    const response = await server.inject({
      ...input,
      headers: { authorization: "Bearer token" },
      payload: { operation: "delete_file" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "VALIDATION_ERROR", retryable: false });
    expect(accessConnection).not.toHaveBeenCalled();
  });
  it("accepts authorized file uploads larger than Fastify's default body limit", async () => {
    const payload = { operation: "create_file", provider: "onedrive", drive_id: "drive-1", name: "report.txt", content_base64: Buffer.alloc(2 * 1024 * 1024, 65).toString("base64") };
    const response = await server.inject({ ...input, headers: { authorization: "Bearer token" }, payload });
    expect(response.statusCode).toBe(200);
    expect(accessConnection).toHaveBeenCalledWith(conversationId, "token", payload, expect.any(AbortSignal));
  });
  it("rejects malformed task identifiers without exposing validation details", async () => {
    const response = await server.inject({
      ...input,
      url: "/mcp-connections/not-a-task/execute",
      headers: { authorization: "Bearer token" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "VALIDATION_ERROR", retryable: false });
    expect(accessConnection).not.toHaveBeenCalled();
  });
  it.each([
    [
      new ConnectionRequestError("CONNECTION_ACCESS_DENIED", false, 403),
      403,
      "CONNECTION_ACCESS_DENIED",
    ],
    [new Error("private provider detail"), 503, "CONNECTION_UNAVAILABLE"],
  ])("returns sanitized failure responses for %s", async (error, status, code) => {
    accessConnection.mockRejectedValue(error);
    const response = await server.inject({ ...input, headers: { authorization: "Bearer token" } });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
    expect(response.body).not.toContain("private provider detail");
  });
});
