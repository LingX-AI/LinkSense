import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import type { McpServerRoutesOptions } from "../src/modules/mcp/routes.js";
import { mcpServerRoutes } from "../src/modules/mcp/routes.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const SERVER_ID = "20000000-0000-4000-8000-000000000001";
const NOW = "2026-07-29T08:00:00.000Z";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("MCP server routes", () => {
  it("maps the create contract without echoing credential material", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mcp-servers",
      payload: {
        name: "Issue tracker",
        url: "http://mcp.example.test:8080/mcp",
        auth_type: "api_key",
        api_key_header: "X-Issue-Key",
        credential: "  route-secret  ",
        startup_timeout_seconds: 15,
        tool_timeout_seconds: 90,
        insecure_http_acknowledged: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: OWNER_ID }),
      {
        transport: "streamable_http",
        name: "Issue tracker",
        url: "http://mcp.example.test:8080/mcp",
        authType: "api_key",
        apiKeyHeader: "X-Issue-Key",
        credential: "route-secret",
        startupTimeoutSeconds: 15,
        toolTimeoutSeconds: 90,
        insecureHttpAcknowledged: true,
      },
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        id: SERVER_ID,
        auth_type: "api_key",
        has_credential: true,
      },
    });
    expect(response.body).not.toContain("route-secret");
    expect(response.body).not.toContain("encrypted");
  });

  it("rejects unknown fields and empty patches before calling the service", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const unknownField = await app.inject({
      method: "POST",
      url: "/api/v1/mcp-servers",
      payload: {
        name: "Issue tracker",
        url: "https://mcp.example.test/mcp",
        auth_type: "none",
        command: "must-not-be-accepted",
      },
    });
    const emptyPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/mcp-servers/${SERVER_ID}`,
      payload: {},
    });
    const legacyRequiredField = await app.inject({
      method: "POST",
      url: "/api/v1/mcp-servers",
      payload: {
        name: "Issue tracker",
        url: "https://mcp.example.test/mcp",
        auth_type: "none",
        required: false,
      },
    });

    expect(unknownField.statusCode).toBe(400);
    expect(emptyPatch.statusCode).toBe(400);
    expect(legacyRequiredField.statusCode).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.patch).not.toHaveBeenCalled();
  });

  it("rejects built-in list identifiers before any delete mutation", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/mcp-servers/builtin:mcp:linksense_core",
    });

    expect(response.statusCode).toBe(400);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it("accepts Codex JSON imports without echoing embedded env values", async () => {
    const service = fakeService();
    const app = await createApp(service);
    const json = JSON.stringify({
      mcpServers: {
        "mcp-server-weread": {
          command: "npx",
          args: ["-y", "mcp-server-weread"],
          env: { CC_PASSWORD: "route-import-secret" },
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mcp-servers/import",
      payload: { json },
    });

    expect(response.statusCode).toBe(201);
    expect(service.importJson).toHaveBeenCalledWith(
      expect.objectContaining({ id: OWNER_ID }),
      json,
    );
    expect(response.body).not.toContain("route-import-secret");
  });
});

async function createApp(service: McpServerRoutesOptions["service"]) {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(mcpServerRoutes, {
    prefix: "/api/v1/mcp-servers",
    service,
    resolveActor: () => ({
      id: OWNER_ID,
      role: "user",
      status: "active",
    }),
  });
  await app.ready();
  return app;
}

function fakeService() {
  const server = {
    id: SERVER_ID,
    is_builtin: false as const,
    name: "Issue tracker",
    transport: "streamable_http" as const,
    url: "http://mcp.example.test:8080/mcp",
    command: null,
    args: [],
    environment_keys: [],
    auth_type: "api_key" as const,
    api_key_header: "X-Issue-Key",
    has_credential: true,
    status: "active" as const,
    startup_timeout_seconds: 15,
    tool_timeout_seconds: 90,
    insecure_http_acknowledged: true,
    last_test_status: null,
    last_test_error_code: null,
    last_tested_at: null,
    last_used_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
  return {
    list: vi.fn(async () => [server]),
    get: vi.fn(async () => server),
    create: vi.fn(async () => server),
    importJson: vi.fn(async () => ({ items: [server] })),
    patch: vi.fn(async () => server),
    test: vi.fn(async () => ({
      status: "succeeded" as const,
      server_name: "fixture",
      protocol_version: "2025-06-18",
      tool_count: 1,
      tested_at: NOW,
    })),
    delete: vi.fn(async () => undefined),
  } satisfies McpServerRoutesOptions["service"];
}
