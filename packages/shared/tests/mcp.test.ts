import { describe, expect, it } from "vitest";

import {
  mcpDefaultStartupTimeoutSeconds,
  mcpDefaultToolTimeoutSeconds,
  mcpServerSchema,
  runtimeMcpServerSchema,
} from "../src/mcp.js";

const SERVER_ID = "01900000-0000-7000-8000-000000000001";
const TIMESTAMP = "2026-07-29T08:00:00.000Z";

describe("MCP contracts", () => {
  it("rejects built-in MCP projections from the personal MCP contract", () => {
    const builtIn = {
      id: "builtin:mcp:linksense_core",
      key: "linksense_core",
      name: "linksense_core",
      is_builtin: true,
      status: "active",
    };

    expect(mcpServerSchema.safeParse(builtIn).success).toBe(false);
  });

  it("exposes credential presence without accepting credential material", () => {
    const publicServer = {
      id: SERVER_ID,
      is_builtin: false,
      name: "Issue tracker",
      transport: "streamable_http",
      url: "https://mcp.example.test/mcp",
      command: null,
      args: [],
      environment_keys: [],
      auth_type: "bearer",
      api_key_header: null,
      has_credential: true,
      status: "active",
      startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
      tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
      insecure_http_acknowledged: false,
      last_test_status: null,
      last_test_error_code: null,
      last_tested_at: null,
      last_used_at: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    };

    expect(mcpServerSchema.parse(publicServer)).toEqual(publicServer);
    expect(
      mcpServerSchema.safeParse({
        ...publicServer,
        encrypted_credential: "must-not-cross-the-public-contract",
      }).success,
    ).toBe(false);
    expect(
      mcpServerSchema.safeParse({
        ...publicServer,
        required: false,
      }).success,
    ).toBe(false);
  });

  it("accepts HTTP Streamable MCP runtime metadata with an opaque source and no required flag", () => {
    const runtime = {
      id: SERVER_ID,
      serverKey: "user_01900000000070008000000000000001",
      name: "Internal-compatible endpoint",
      transport: "streamable_http",
      url: "http://mcp.example.test:8080/mcp",
      revision: "a".repeat(64),
      startupTimeoutSeconds: 12,
      toolTimeoutSeconds: 90,
      credential: {
        type: "api_key",
        headerName: "X-API-Key",
        source: "LINKSENSE_MCP_CREDENTIAL_0123456789ABCDEF0123456789ABCDEF",
      },
      requestHeaders: [
        {
          headerName: "X-Session-Id",
          source: "LINKSENSE_MCP_CREDENTIAL_FEDCBA9876543210FEDCBA9876543210",
        },
      ],
    };

    expect(runtimeMcpServerSchema.parse(runtime)).toEqual(runtime);
    expect(
      runtimeMcpServerSchema.safeParse({ ...runtime, required: true }).success,
    ).toBe(false);
    expect(
      runtimeMcpServerSchema.safeParse({
        ...runtime,
        requestHeaders: [
          {
            headerName: "X-Session-Id",
            source: "LINKSENSE_MCP_CREDENTIAL_FEDCBA9876543210FEDCBA9876543210",
            value: "must-not-cross-the-runtime-contract",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects predictable or secret-bearing runtime credential fields", () => {
    const runtime = {
      id: SERVER_ID,
      serverKey: "user_01900000000070008000000000000001",
      name: "Issue tracker",
      transport: "streamable_http",
      url: "https://mcp.example.test/mcp",
      revision: "a".repeat(64),
      startupTimeoutSeconds: mcpDefaultStartupTimeoutSeconds,
      toolTimeoutSeconds: mcpDefaultToolTimeoutSeconds,
      credential: {
        type: "bearer",
        source: "MCP_TOKEN",
        value: "plaintext-secret",
      },
    };

    expect(runtimeMcpServerSchema.safeParse(runtime).success).toBe(false);
  });

  it("accepts secret-free STDIO metadata and opaque runtime env sources", () => {
    const publicServer = {
      id: SERVER_ID,
      is_builtin: false,
      name: "mcp-server-weread",
      transport: "stdio",
      url: null,
      command: "npx",
      args: ["-y", "mcp-server-weread"],
      environment_keys: ["CC_ID", "CC_PASSWORD"],
      auth_type: "none",
      api_key_header: null,
      has_credential: false,
      status: "active",
      startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
      tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
      insecure_http_acknowledged: false,
      last_test_status: null,
      last_test_error_code: null,
      last_tested_at: null,
      last_used_at: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    };
    expect(mcpServerSchema.parse(publicServer)).toEqual(publicServer);
    expect(
      runtimeMcpServerSchema.parse({
        id: SERVER_ID,
        serverKey: "user_01900000000070008000000000000001",
        name: "mcp-server-weread",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-server-weread"],
        revision: "a".repeat(64),
        startupTimeoutSeconds: mcpDefaultStartupTimeoutSeconds,
        toolTimeoutSeconds: mcpDefaultToolTimeoutSeconds,
        environmentVariables: [
          {
            name: "CC_PASSWORD",
            source: "LINKSENSE_MCP_STDIO_0123456789ABCDEF0123456789ABCDEF",
          },
        ],
      }),
    ).toMatchObject({ transport: "stdio", command: "npx" });
  });
});
