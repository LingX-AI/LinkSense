import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSiteRequestError } from "../src/web-site-error.js";
import { parseRunnerConfig } from "../src/config.js";
import type { AppServerProcessPool } from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

describe("public site worker authorization", () => {
  const conversationId = "01900000-0000-7000-8000-000000000001";
  const scopedToken = "public-site-turn-token";
  const webSite = vi.fn<AppServerProcessPool["webSite"]>();
  let directory: string;
  let server: ReturnType<typeof buildRunnerServer>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "linksense-web-site-route-"));
    const userDataRoot = join(directory, "users");
    webSite.mockReset().mockResolvedValue(null);
    server = buildRunnerServer(
      parseRunnerConfig({
        LINKSENSE_USER_DATA_ROOT: userDataRoot,
        LINKSENSE_RUNNER_SHARED_SECRET: "runner-555555555555555555555555555555",
        LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal",
      }),
      { webSite } as unknown as AppServerProcessPool,
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
      url: `/mcp-web-site/${conversationId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { operation: "list", limit: 20 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
    expect(webSite).toHaveBeenCalledExactlyOnceWith(
      conversationId, scopedToken, { operation: "list", limit: 20 },
    );
  });

  it("rejects a missing credential before calling the public site tool", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/mcp-web-site/${conversationId}`,
      payload: { operation: "list" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "WEB_SITE_FORBIDDEN", retryable: false });
    expect(webSite).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-uuid", { operation: "list" }],
    [conversationId, { operation: "publish", name: "Site" }],
    [conversationId, { operation: "update", site_id: conversationId, extra: true }],
  ])("rejects invalid public site input without forwarding: %s", async (id, payload) => {
    const response = await server.inject({
      method: "POST",
      url: `/mcp-web-site/${id}`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "WEB_SITE_INVALID", retryable: false });
    expect(webSite).not.toHaveBeenCalled();
  });

  it.each([
    [new WebSiteRequestError("WEB_SITE_FORBIDDEN", false, 403), 403, "WEB_SITE_FORBIDDEN", false],
    [new Error("private backend details"), 503, "WEB_SITE_UNAVAILABLE", true],
  ])("preserves scoped authorization failures and sanitizes unexpected errors: %s", async (error, status, code, retryable) => {
    webSite.mockRejectedValueOnce(error);
    const response = await server.inject({
      method: "POST",
      url: `/mcp-web-site/${conversationId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { operation: "list" },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, retryable });
    expect(response.body).not.toContain("private backend details");
  });
});
