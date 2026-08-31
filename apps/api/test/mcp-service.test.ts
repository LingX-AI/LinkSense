import { describe, expect, it, vi } from "vitest";

import {
  mcpDefaultStartupTimeoutSeconds,
  mcpDefaultToolTimeoutSeconds,
} from "@linksense/shared";
import { decryptJson } from "../src/lib/crypto.js";
import type { AuditService } from "../src/modules/audit/service.js";
import { McpServerService } from "../src/modules/mcp/service.js";
import type {
  CreateMcpServerRecord,
  McpConnectionProbe,
  McpServerRecord,
  McpServerRepository,
  McpStdioConnectionProbe,
  RequestActor,
  UpdateMcpServerRecord,
} from "../src/modules/mcp/types.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const MASTER_KEY = Buffer.alloc(32, 11).toString("base64");
const KEY_ID = "mcp-key-2026-07";
const NOW = new Date("2026-07-29T08:00:00.000Z");

describe("McpServerService", () => {
  it("lists only the actor's personal MCP servers", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    const created = await service.create(actor(), {
      name: "Issue tracker",
      url: "https://mcp.example.test/mcp",
      authType: "none",
    });

    const items = await service.list(actor());

    expect(items).toEqual([created]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Issue tracker",
      is_builtin: false,
      startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
      tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
    });
    expect(items[0]).not.toHaveProperty("required");

    const runtime = await service.resolveRuntime(OWNER_ID);
    expect(runtime.servers[0]).toMatchObject({
      startupTimeoutSeconds: mcpDefaultStartupTimeoutSeconds,
      toolTimeoutSeconds: mcpDefaultToolTimeoutSeconds,
    });
    expect(runtime.servers[0]).not.toHaveProperty("required");
  });

  it("encrypts Bearer credentials and exposes them only through opaque runtime sources", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service, audit, probe } = createService(repository);

    const view = await service.create(actor(), {
      name: "Issue tracker",
      url: "https://mcp.example.test/mcp",
      authType: "bearer",
      credential: "bearer-secret",
    });

    const stored = repository.rows[0];
    expect(stored).toBeDefined();
    expect(stored?.encryptedCredential).not.toContain("bearer-secret");
    expect(
      decryptJson<{ value: string }>(
        stored?.encryptedCredential ?? "",
        MASTER_KEY,
        KEY_ID,
        `linksense:mcp-server:v1:${stored?.id}`,
      ),
    ).toEqual({ value: "bearer-secret" });
    expect(view).toMatchObject({ auth_type: "bearer", has_credential: true });
    expect(JSON.stringify(view)).not.toContain("bearer-secret");
    expect(JSON.stringify(view)).not.toContain("encryptedCredential");

    const runtime = await service.resolveRuntime(OWNER_ID);
    const [source] = Object.keys(runtime.environment);
    expect(source).toMatch(/^LINKSENSE_MCP_CREDENTIAL_[A-F0-9]{32}$/u);
    expect(runtime.environment[source ?? ""]).toBe("bearer-secret");
    expect(runtime.servers[0]).toMatchObject({
      transport: "streamable_http",
      credential: {
        type: "bearer",
        source,
      },
    });
    expect(runtime.servers[0]).not.toHaveProperty("required");
    expect(runtime.generation).toMatch(/^[a-f0-9]{64}$/u);
    expect(runtime.credentialUsageReceipts).toEqual([{ serverId: stored?.id }]);
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain(
      "bearer-secret",
    );
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it("requires explicit HTTP acknowledgement and accepts literal private destinations", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);

    await expect(
      service.create(actor(), {
        name: "Public HTTP",
        url: "http://mcp.example.test:8080/mcp",
        authType: "none",
      }),
    ).rejects.toMatchObject({
      code: "MCP_INSECURE_HTTP_ACKNOWLEDGEMENT_REQUIRED",
    });

    await expect(
      service.create(actor(), {
        name: "Public HTTP",
        url: "http://mcp.example.test:8080/mcp",
        authType: "none",
        insecureHttpAcknowledged: true,
      }),
    ).resolves.toMatchObject({
      url: "http://mcp.example.test:8080/mcp",
      insecure_http_acknowledged: true,
    });

    await expect(
      service.create(actor(), {
        name: "Metadata",
        url: "http://169.254.169.254/latest/meta-data",
        authType: "none",
        insecureHttpAcknowledged: true,
      }),
    ).resolves.toMatchObject({
      url: "http://169.254.169.254/latest/meta-data",
      insecure_http_acknowledged: true,
    });

    const created = repository.rows[0];
    if (!created) throw new Error("Expected the acknowledged HTTP server");
    await expect(
      service.patch(actor(), created.id, {
        url: "http://second.example.test/mcp",
      }),
    ).rejects.toMatchObject({
      code: "MCP_INSECURE_HTTP_ACKNOWLEDGEMENT_REQUIRED",
    });
    await expect(
      service.patch(actor(), created.id, {
        url: "http://second.example.test/mcp",
        insecureHttpAcknowledged: true,
      }),
    ).resolves.toMatchObject({
      url: "http://second.example.test/mcp",
      insecure_http_acknowledged: true,
    });
  });

  it("supports API Key headers, preserves omitted credentials, and clears them for no-auth", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    const created = await service.create(actor(), {
      name: "Search",
      url: "https://mcp.example.test/mcp",
      authType: "api_key",
      apiKeyHeader: "X-Search-Key",
      credential: "api-key-secret",
    });
    const ciphertext = repository.rows[0]?.encryptedCredential;

    await expect(
      service.patch(actor(), created.id, { name: "Search v2" }),
    ).resolves.toMatchObject({
      name: "Search v2",
      auth_type: "api_key",
      api_key_header: "X-Search-Key",
      has_credential: true,
    });
    expect(repository.rows[0]?.encryptedCredential).toBe(ciphertext);

    await expect(
      service.patch(actor(), created.id, { authType: "none" }),
    ).resolves.toMatchObject({
      auth_type: "none",
      api_key_header: null,
      has_credential: false,
    });
    expect(repository.rows[0]).toMatchObject({
      encryptedCredential: null,
      encryptionKeyId: null,
    });

    await expect(
      service.create(actor(), {
        name: "Unsafe header",
        url: "https://mcp.example.test/mcp",
        authType: "api_key",
        apiKeyHeader: "Content-Length",
        credential: "api-key-secret",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.create(actor(), {
        name: "Header injection",
        url: "https://mcp.example.test/mcp",
        authType: "bearer",
        credential: "secret\r\nX-Injected: value",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("uses the compatible empty generation and excludes disabled servers", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    const emptyGeneration =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    await expect(service.resolveRuntime(OWNER_ID)).resolves.toMatchObject({
      generation: emptyGeneration,
      servers: [],
      environment: {},
    });

    const created = await service.create(actor(), {
      name: "Disabled server",
      url: "https://mcp.example.test/mcp",
      authType: "bearer",
      credential: "disabled-secret",
    });
    await service.patch(actor(), created.id, { status: "disabled" });

    await expect(service.resolveRuntime(OWNER_ID)).resolves.toMatchObject({
      generation: emptyGeneration,
      servers: [],
      environment: {},
      credentialUsageReceipts: [],
    });
  });

  it("projects only the MCP servers explicitly bound to an application", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    await service.create(actor(), {
      name: "Unbound server",
      url: "https://unbound-mcp.example.test/mcp",
      authType: "none",
    });
    const selected = await service.create(actor(), {
      name: "Partner operations",
      url: "https://partner-mcp.example.test/mcp",
      authType: "api_key",
      apiKeyHeader: "X-API-Key",
      credential: "partner-mcp-secret",
    });

    const runtime = await service.resolveApplicationRuntime(OWNER_ID, [
      selected.id,
    ]);

    expect(runtime.servers).toEqual([
      expect.objectContaining({
        id: selected.id,
        name: "Partner operations",
        credential: expect.objectContaining({
          type: "api_key",
          headerName: "X-API-Key",
        }),
      }),
    ]);
    expect(runtime.servers[0]).not.toHaveProperty("requestHeaders");
    expect(Object.values(runtime.environment)).toEqual([
      "partner-mcp-secret",
    ]);

    const runtimeWithExternalSession = await service.resolveApplicationRuntime(
      OWNER_ID,
      [selected.id],
      [{ headerName: "X-Session-Id", value: "business-session-a" }],
    );
    expect(runtimeWithExternalSession.servers).toEqual([
      expect.objectContaining({
        id: selected.id,
        credential: expect.objectContaining({
          type: "api_key",
          headerName: "X-API-Key",
        }),
        requestHeaders: [
          expect.objectContaining({
            headerName: "X-Session-Id",
            source: expect.stringMatching(/^LINKSENSE_MCP_CREDENTIAL_/u),
          }),
        ],
      }),
    ]);
    expect(Object.values(runtimeWithExternalSession.environment).sort()).toEqual(
      ["business-session-a", "partner-mcp-secret"].sort(),
    );
    await expect(
      service.resolveApplicationRecovery(
        OWNER_ID,
        [selected.id],
        runtimeWithExternalSession.servers,
        [{ headerName: "X-Session-Id", value: "business-session-a" }],
      ),
    ).resolves.toEqual({ environment: runtimeWithExternalSession.environment });
    await expect(
      service.resolveApplicationRecovery(
        OWNER_ID,
        [selected.id],
        runtimeWithExternalSession.servers,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.resolveApplicationRuntime(OTHER_OWNER_ID, [selected.id]),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });

  it("enforces the per-owner server limit at the repository boundary", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);

    for (let index = 0; index < 30; index += 1) {
      await service.create(actor(), {
        name: `Server ${index + 1}`,
        url: `https://mcp-${index + 1}.example.test/mcp`,
        authType: "none",
      });
    }

    await expect(
      service.create(actor(), {
        name: "Server 31",
        url: "https://mcp-31.example.test/mcp",
        authType: "none",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repository.rows).toHaveLength(30);
  });

  it("changes runtime generation only for runtime-relevant changes and fails closed on recovery drift", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    const created = await service.create(actor(), {
      name: "Calendar",
      url: "https://mcp.example.test/mcp",
      authType: "bearer",
      credential: "first-secret",
    });
    const first = await service.resolveRuntime(OWNER_ID);

    await repository.update(created.id, {
      lastTestStatus: "succeeded",
      lastTestedAt: NOW,
      lastUsedAt: NOW,
    });
    const metadataOnly = await service.resolveRuntime(OWNER_ID);
    expect(metadataOnly.generation).toBe(first.generation);

    await service.patch(actor(), created.id, { credential: "rotated-secret" });
    const rotated = await service.resolveRuntime(OWNER_ID);
    expect(rotated.generation).not.toBe(first.generation);
    await expect(
      service.resolveRecovery(OWNER_ID, first.servers),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces ownership for read, update, test, and delete", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    const created = await service.create(actor(), {
      name: "Owned server",
      url: "https://mcp.example.test/mcp",
      authType: "none",
    });
    const other = actor(OTHER_OWNER_ID);

    await expect(service.get(other, created.id)).rejects.toMatchObject({
      code: "MCP_SERVER_NOT_FOUND",
    });
    await expect(
      service.patch(other, created.id, { name: "Hijacked" }),
    ).rejects.toMatchObject({ code: "MCP_SERVER_NOT_FOUND" });
    await expect(service.test(other, created.id)).rejects.toMatchObject({
      code: "MCP_SERVER_NOT_FOUND",
    });
    await expect(service.delete(other, created.id)).rejects.toMatchObject({
      code: "MCP_SERVER_NOT_FOUND",
    });
  });

  it("records a sanitized connection result for both success and failure", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service, probe } = createService(repository);
    const created = await service.create(actor(), {
      name: "Tools",
      url: "https://mcp.example.test/mcp",
      authType: "bearer",
      credential: "connection-secret",
    });

    await expect(service.test(actor(), created.id)).resolves.toEqual({
      status: "succeeded",
      server_name: "test-mcp",
      protocol_version: "2025-06-18",
      tool_count: 2,
      tested_at: NOW.toISOString(),
    });
    expect(probe.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { type: "bearer", value: "connection-secret" },
        timeoutMs: mcpDefaultStartupTimeoutSeconds * 1_000,
      }),
    );
    expect(repository.rows[0]).toMatchObject({
      lastTestStatus: "succeeded",
      lastTestErrorCode: null,
      lastTestedAt: NOW,
    });

    probe.probe.mockRejectedValueOnce(
      new Error("upstream leaked connection-secret and host internals"),
    );
    await expect(service.test(actor(), created.id)).rejects.toMatchObject({
      code: "MCP_CONNECTION_FAILED",
    });
    expect(repository.rows[0]).toMatchObject({
      lastTestStatus: "failed",
      lastTestErrorCode: "MCP_CONNECTION_FAILED",
    });
    expect(JSON.stringify(repository.rows[0])).not.toContain("upstream leaked");
  });

  it("imports Codex STDIO JSON, encrypts env values, and probes it in the owner worker", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service, stdioProbe, audit } = createService(repository);
    const imported = await service.importJson(
      actor(),
      JSON.stringify({
        mcpServers: {
          "mcp-server-weread": {
            command: "npx",
            args: ["-y", "mcp-server-weread"],
            env: {
              CC_ID: "reader-id",
              CC_PASSWORD: "reader-password",
              CC_URL: "https://cc.chenge.ink",
            },
          },
        },
      }),
    );

    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]).toMatchObject({
      transport: "stdio",
      name: "mcp-server-weread",
      command: "npx",
      args: ["-y", "mcp-server-weread"],
      environment_keys: ["CC_ID", "CC_PASSWORD", "CC_URL"],
      url: null,
    });
    expect(JSON.stringify(imported)).not.toContain("reader-password");
    const stored = repository.rows[0];
    if (!stored) throw new Error("Expected imported STDIO MCP");
    expect(stored.encryptedEnvironment).not.toContain("reader-password");
    expect(
      decryptJson<Record<string, string>>(
        stored.encryptedEnvironment ?? "",
        MASTER_KEY,
        KEY_ID,
        `linksense:mcp-server-env:v1:${stored.id}`,
      ),
    ).toEqual({
      CC_ID: "reader-id",
      CC_PASSWORD: "reader-password",
      CC_URL: "https://cc.chenge.ink",
    });

    const runtime = await service.resolveRuntime(OWNER_ID);
    expect(runtime.servers[0]).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "mcp-server-weread"],
      environmentVariables: [
        {
          name: "CC_ID",
          source: expect.stringMatching(/^LINKSENSE_MCP_STDIO_/),
        },
        {
          name: "CC_PASSWORD",
          source: expect.stringMatching(/^LINKSENSE_MCP_STDIO_/),
        },
        {
          name: "CC_URL",
          source: expect.stringMatching(/^LINKSENSE_MCP_STDIO_/),
        },
      ],
    });
    expect(Object.values(runtime.environment)).toEqual([
      "reader-id",
      "reader-password",
      "https://cc.chenge.ink",
    ]);

    await expect(service.test(actor(), stored.id)).resolves.toMatchObject({
      server_name: "stdio-test-mcp",
      tool_count: 3,
    });
    expect(stdioProbe.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: OWNER_ID,
        command: "npx",
        args: ["-y", "mcp-server-weread"],
        environment: expect.objectContaining({
          CC_PASSWORD: "reader-password",
        }),
      }),
    );
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain(
      "reader-password",
    );
  });

  it("rejects reserved STDIO environment keys before persistence", async () => {
    const repository = new InMemoryMcpServerRepository();
    const { service } = createService(repository);
    await expect(
      service.create(actor(), {
        transport: "stdio",
        name: "unsafe",
        command: "node",
        args: ["server.js"],
        environment: { NODE_OPTIONS: "--require=malicious" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repository.rows).toHaveLength(0);
  });
});

class InMemoryMcpServerRepository implements McpServerRepository {
  readonly rows: McpServerRecord[] = [];

  async listByOwner(ownerId: string): Promise<McpServerRecord[]> {
    return this.rows.filter((row) => row.ownerId === ownerId);
  }

  async findOwned(
    ownerId: string,
    id: string,
  ): Promise<McpServerRecord | null> {
    return (
      this.rows.find((row) => row.ownerId === ownerId && row.id === id) ?? null
    );
  }

  async createWithinOwnerLimit(
    input: CreateMcpServerRecord,
    limit: number,
  ): Promise<McpServerRecord | null> {
    if (
      this.rows.filter((row) => row.ownerId === input.ownerId).length >= limit
    ) {
      return null;
    }
    const row: McpServerRecord = {
      ...input,
      lastTestStatus: null,
      lastTestErrorCode: null,
      lastTestedAt: null,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.rows.push(row);
    return row;
  }

  async createManyWithinOwnerLimit(
    input: CreateMcpServerRecord[],
    limit: number,
  ): Promise<McpServerRecord[] | null> {
    const ownerCount = this.rows.filter(
      (row) => row.ownerId === input[0]?.ownerId,
    ).length;
    if (ownerCount + input.length > limit) return null;
    const created: McpServerRecord[] = [];
    for (const record of input) {
      const row = await this.createWithinOwnerLimit(record, limit);
      if (!row) throw new Error("Unexpected owner limit failure");
      created.push(row);
    }
    return created;
  }

  async update(
    id: string,
    input: UpdateMcpServerRecord,
  ): Promise<McpServerRecord> {
    const index = this.rows.findIndex((row) => row.id === id);
    const current = this.rows[index];
    if (index < 0 || !current) throw new Error("MCP row was not found");
    const updated = { ...current, ...input, updatedAt: NOW };
    this.rows[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows.splice(index, 1);
  }
}

function createService(repository: InMemoryMcpServerRepository) {
  const audit = {
    write: vi.fn(async () => undefined),
  } satisfies Pick<AuditService, "write">;
  const probe = {
    probe: vi.fn(async () => ({
      serverName: "test-mcp",
      protocolVersion: "2025-06-18",
      toolCount: 2,
    })),
  } satisfies McpConnectionProbe;
  const stdioProbe = {
    probe: vi.fn(async () => ({
      serverName: "stdio-test-mcp",
      protocolVersion: "2025-06-18",
      toolCount: 3,
    })),
  } satisfies McpStdioConnectionProbe;
  return {
    service: new McpServerService(
      repository,
      audit,
      MASTER_KEY,
      KEY_ID,
      probe,
      () => NOW,
      stdioProbe,
    ),
    audit,
    probe,
    stdioProbe,
  };
}

function actor(id = OWNER_ID): RequestActor {
  return { id, role: "user", status: "active" };
}
