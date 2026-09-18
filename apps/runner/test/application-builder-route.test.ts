import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationBuilderRequestError } from "../src/application-builder-error.js";
import { parseRunnerConfig } from "../src/config.js";
import type { AppServerProcessPool } from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

describe("application builder worker authorization", () => {
  const conversationId = "01900000-0000-7000-8000-000000000001";
  const scopedToken = "application-builder-turn-token";
  const applicationBuilder = vi.fn<AppServerProcessPool["applicationBuilder"]>();
  let directory: string;
  let server: ReturnType<typeof buildRunnerServer>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "linksense-builder-route-"));
    const userDataRoot = join(directory, "users");
    applicationBuilder.mockReset().mockResolvedValue(null);
    server = buildRunnerServer(
      parseRunnerConfig({
        LINKSENSE_USER_DATA_ROOT: userDataRoot,
        LINKSENSE_RUNNER_SHARED_SECRET: "runner-555555555555555555555555555555",
        LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal",
      }),
      { applicationBuilder } as unknown as AppServerProcessPool,
      new WorkspaceManager(userDataRoot),
    );
  });

  afterEach(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts a turn-scoped credential and delegates authorization to the active conversation", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/mcp-application-builder/${conversationId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { operation: "inspect" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
    expect(applicationBuilder).toHaveBeenCalledExactlyOnceWith(
      conversationId, scopedToken, { operation: "inspect" },
    );
  });

  it("rejects a missing credential before calling the application builder", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/mcp-application-builder/${conversationId}`,
      payload: { operation: "inspect" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "APPLICATION_DEVELOPMENT_FORBIDDEN", retryable: false });
    expect(applicationBuilder).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-uuid", { operation: "inspect" }],
    [conversationId, { operation: "inspect", conversation_id: conversationId }],
    [conversationId, { operation: "open", name: "App", directory: "../../private" }],
  ])("rejects invalid application builder input without forwarding: %s", async (id, payload) => {
    const response = await server.inject({
      method: "POST",
      url: `/mcp-application-builder/${id}`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "APPLICATION_DEVELOPMENT_INVALID", retryable: false });
    expect(applicationBuilder).not.toHaveBeenCalled();
  });

  it.each([
    [new ApplicationBuilderRequestError("APPLICATION_DEVELOPMENT_FORBIDDEN", false, 403), 403, "APPLICATION_DEVELOPMENT_FORBIDDEN", false],
    [new Error("private backend details"), 503, "APPLICATION_DEVELOPMENT_UNAVAILABLE", true],
  ])("preserves scoped authorization failures and sanitizes unexpected errors: %s", async (error, status, code, retryable) => {
    applicationBuilder.mockRejectedValueOnce(error);
    const response = await server.inject({
      method: "POST",
      url: `/mcp-application-builder/${conversationId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { operation: "inspect" },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, retryable });
    expect(response.body).not.toContain("private backend details");
  });
});
