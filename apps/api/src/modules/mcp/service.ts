import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  mcpDefaultStartupTimeoutSeconds,
  mcpDefaultToolTimeoutSeconds,
  mcpServerAuthTypeSchema,
  mcpServerStatusSchema,
  type McpServer,
  type McpServerAuthType,
  type McpServerImportResult,
  type McpServerTestResult,
  type RuntimeMcpServer,
} from "@linksense/shared";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import type { AuditService } from "../audit/service.js";
import type {
  CreateMcpServerRecord,
  McpConnectionProbe,
  McpServerRecord,
  McpServerRepository,
  McpStdioConnectionProbe,
  RequestActor,
  ResolvedMcpRuntime,
} from "./types.js";

const MAX_PERSONAL_MCP_SERVERS = 30;
const MAX_STDIO_ARGUMENTS = 128;
const MAX_STDIO_ENVIRONMENT_VARIABLES = 64;
const MAX_STDIO_JSON_BYTES = 256 * 1_024;
const MCP_CREDENTIAL_CONTEXT_PREFIX = "linksense:mcp-server:v1:";
const MCP_ENVIRONMENT_CONTEXT_PREFIX = "linksense:mcp-server-env:v1:";
const EMPTY_MCP_GENERATION =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RESERVED_API_KEY_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const RESERVED_STDIO_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "HOME",
  "LOGNAME",
  "USER",
  "SHELL",
  "BASH_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
]);

export type CreateHttpMcpServerInput = {
  transport?: "streamable_http";
  name: string;
  url: string;
  authType: McpServerAuthType;
  apiKeyHeader?: string;
  credential?: string;
  startupTimeoutSeconds?: number;
  toolTimeoutSeconds?: number;
  insecureHttpAcknowledged?: boolean;
};

export type CreateStdioMcpServerInput = {
  transport: "stdio";
  name: string;
  command: string;
  args?: string[];
  environment?: Record<string, string>;
  startupTimeoutSeconds?: number;
  toolTimeoutSeconds?: number;
};

export type CreateMcpServerInput =
  CreateHttpMcpServerInput | CreateStdioMcpServerInput;

export type PatchMcpServerInput = {
  name?: string;
  url?: string;
  authType?: McpServerAuthType;
  apiKeyHeader?: string;
  credential?: string;
  clearCredential?: boolean;
  command?: string;
  args?: string[];
  environment?: Record<string, string>;
  clearEnvironment?: boolean;
  status?: "active" | "disabled";
  startupTimeoutSeconds?: number;
  toolTimeoutSeconds?: number;
  insecureHttpAcknowledged?: boolean;
};

export type RuntimeMcpRequestHeaderValue = Readonly<{
  headerName: string;
  value: string;
}>;

const importedStdioServerSchema = z.strictObject({
  command: z.string(),
  args: z.array(z.string()).max(MAX_STDIO_ARGUMENTS).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  startup_timeout_sec: z.number().int().min(1).max(120).optional(),
  tool_timeout_sec: z.number().int().min(1).max(600).optional(),
});

const importedMcpConfigSchema = z.strictObject({
  mcpServers: z.record(z.string(), importedStdioServerSchema),
});

export class McpServerService {
  constructor(
    private readonly repository: McpServerRepository,
    private readonly audit: Pick<AuditService, "write">,
    private readonly masterKey: string,
    private readonly keyId: string,
    private readonly probe: McpConnectionProbe,
    private readonly now: () => Date = () => new Date(),
    private readonly stdioProbe?: McpStdioConnectionProbe,
  ) {}

  async list(actor: RequestActor): Promise<McpServer[]> {
    assertActiveActor(actor);
    return (await this.repository.listByOwner(actor.id)).map(projectMcpServer);
  }

  async get(actor: RequestActor, id: string): Promise<McpServer> {
    assertActiveActor(actor);
    return projectMcpServer(await this.requireOwned(actor.id, id));
  }

  async create(
    actor: RequestActor,
    input: CreateMcpServerInput,
  ): Promise<McpServer> {
    assertActiveActor(actor);
    const record = this.createRecord(actor.id, input);
    const created = await this.repository.createWithinOwnerLimit(
      record,
      MAX_PERSONAL_MCP_SERVERS,
    );
    if (!created) throw new AppError("CONFLICT");
    await this.writeAudit(actor, "mcp_server_created", created, {
      transport: created.transport,
      ...(created.transport === "streamable_http"
        ? {
            auth_type: created.authType,
            transport_security: created.url!.startsWith("https:")
              ? "https"
              : "http",
          }
        : { environment_key_count: created.environmentKeys.length }),
    });
    return projectMcpServer(created);
  }

  async importJson(
    actor: RequestActor,
    json: string,
  ): Promise<McpServerImportResult> {
    assertActiveActor(actor);
    if (
      json.length === 0 ||
      Buffer.byteLength(json, "utf8") > MAX_STDIO_JSON_BYTES
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(json);
    } catch {
      throw new AppError("VALIDATION_ERROR");
    }
    const parsed = importedMcpConfigSchema.safeParse(parsedJson);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR");
    const entries = Object.entries(parsed.data.mcpServers);
    if (entries.length === 0 || entries.length > MAX_PERSONAL_MCP_SERVERS) {
      throw new AppError("VALIDATION_ERROR");
    }
    const records = entries.map(([name, server]) =>
      this.createRecord(
        actor.id,
        {
          transport: "stdio",
          name,
          command: server.command,
          args: server.args ?? [],
          environment: server.env ?? {},
          ...(server.startup_timeout_sec === undefined
            ? {}
            : { startupTimeoutSeconds: server.startup_timeout_sec }),
          ...(server.tool_timeout_sec === undefined
            ? {}
            : { toolTimeoutSeconds: server.tool_timeout_sec }),
        },
        server.enabled === false ? "disabled" : "active",
      ),
    );
    const created = await this.repository.createManyWithinOwnerLimit(
      records,
      MAX_PERSONAL_MCP_SERVERS,
    );
    if (!created) throw new AppError("CONFLICT");
    await Promise.all(
      created.map((server) =>
        this.writeAudit(actor, "mcp_server_created", server, {
          transport: "stdio",
          import_format: "codex_json",
          environment_key_count: server.environmentKeys.length,
        }),
      ),
    );
    return { items: created.map(projectMcpServer) };
  }

  async patch(
    actor: RequestActor,
    id: string,
    input: PatchMcpServerInput,
  ): Promise<McpServer> {
    assertActiveActor(actor);
    const current = await this.requireOwned(actor.id, id);
    const commonUpdate = {
      ...(input.name === undefined ? {} : { name: normalizeName(input.name) }),
      ...(input.status === undefined
        ? {}
        : { status: mcpServerStatusSchema.parse(input.status) }),
      ...(input.startupTimeoutSeconds === undefined
        ? {}
        : {
            startupTimeoutSeconds: integerInRange(
              input.startupTimeoutSeconds,
              1,
              120,
            ),
          }),
      ...(input.toolTimeoutSeconds === undefined
        ? {}
        : {
            toolTimeoutSeconds: integerInRange(
              input.toolTimeoutSeconds,
              1,
              600,
            ),
          }),
      lastTestStatus: null,
      lastTestErrorCode: null,
      lastTestedAt: null,
    } as const;

    const updated =
      current.transport === "streamable_http"
        ? await this.patchHttpServer(id, current, input, commonUpdate)
        : await this.patchStdioServer(id, current, input, commonUpdate);
    await this.writeAudit(actor, "mcp_server_updated", updated, {
      transport: updated.transport,
      credential_rotated:
        updated.transport === "streamable_http"
          ? input.credential !== undefined
          : input.environment !== undefined,
      status: updated.status,
    });
    return projectMcpServer(updated);
  }

  async delete(actor: RequestActor, id: string): Promise<void> {
    assertActiveActor(actor);
    const current = await this.requireOwned(actor.id, id);
    await this.repository.delete(id);
    await this.writeAudit(actor, "mcp_server_deleted", current);
  }

  async test(actor: RequestActor, id: string): Promise<McpServerTestResult> {
    assertActiveActor(actor);
    const current = await this.requireOwned(actor.id, id);
    const testedAt = this.now();
    try {
      const result =
        current.transport === "streamable_http"
          ? await this.probe.probe({
              url: normalizeMcpUrl(requireHttpUrl(current)),
              auth: this.decryptAuth(current),
              timeoutMs: current.startupTimeoutSeconds * 1_000,
            })
          : await this.requireStdioProbe().probe({
              ownerId: actor.id,
              command: normalizeCommand(requireStdioCommand(current)),
              args: normalizeArguments(current.args),
              environment: this.decryptEnvironment(current),
              timeoutMs: current.startupTimeoutSeconds * 1_000,
            });
      await this.repository.update(id, {
        lastTestStatus: "succeeded",
        lastTestErrorCode: null,
        lastTestedAt: testedAt,
      });
      await this.writeAudit(actor, "mcp_server_connection_tested", current, {
        result: "succeeded",
        transport: current.transport,
      });
      return {
        status: "succeeded",
        server_name: result.serverName.slice(0, 160),
        protocol_version: result.protocolVersion.slice(0, 80),
        tool_count: result.toolCount,
        tested_at: testedAt.toISOString(),
      };
    } catch (error) {
      const errorCode =
        error instanceof AppError && error.code === "MCP_DESTINATION_FORBIDDEN"
          ? error.code
          : "MCP_CONNECTION_FAILED";
      await this.repository
        .update(id, {
          lastTestStatus: "failed",
          lastTestErrorCode: errorCode,
          lastTestedAt: testedAt,
        })
        .catch(() => undefined);
      await this.writeAudit(actor, "mcp_server_connection_tested", current, {
        result: "failed",
        transport: current.transport,
      });
      throw new AppError(errorCode);
    }
  }

  async resolveRuntime(ownerId: string): Promise<ResolvedMcpRuntime> {
    const rows = (await this.repository.listByOwner(ownerId))
      .filter((row) => row.status === "active")
      .sort((left, right) => left.id.localeCompare(right.id));
    return this.resolveRows(ownerId, rows);
  }

  async resolveApplicationRuntime(
    ownerId: string,
    serverIds: readonly string[],
    requestHeaders: readonly RuntimeMcpRequestHeaderValue[] = [],
  ): Promise<ResolvedMcpRuntime> {
    const selected = new Set(serverIds);
    const rowsById = new Map(
      (await this.repository.listByOwner(ownerId)).map((row) => [row.id, row]),
    );
    if (
      selected.size !== serverIds.length ||
      serverIds.some((id) => rowsById.get(id)?.status !== "active")
    ) {
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    }
    return this.resolveRows(
      ownerId,
      serverIds.map((id) => rowsById.get(id)!),
      requestHeaders,
    );
  }

  private resolveRows(
    ownerId: string,
    rows: McpServerRecord[],
    requestHeaders: readonly RuntimeMcpRequestHeaderValue[] = [],
  ): ResolvedMcpRuntime {
    const environment: Record<string, string> = {};
    const servers: RuntimeMcpServer[] = rows.map((row) => {
      const common = {
        id: row.id,
        serverKey: row.serverKey,
        name: row.name,
        revision: mcpServerRevision(row),
        startupTimeoutSeconds: row.startupTimeoutSeconds,
        toolTimeoutSeconds: row.toolTimeoutSeconds,
      };
      if (row.transport === "stdio") {
        const values = this.decryptEnvironment(row);
        const environmentVariables = Object.keys(values)
          .sort()
          .map((name) => {
            const source = mcpStdioEnvironmentName(
              this.masterKey,
              ownerId,
              row.id,
              name,
            );
            environment[source] = values[name]!;
            return { name, source };
          });
        return {
          ...common,
          transport: "stdio" as const,
          command: normalizeCommand(requireStdioCommand(row)),
          args: normalizeArguments(row.args),
          environmentVariables,
        };
      }
      const source = mcpCredentialEnvironmentName(
        this.masterKey,
        ownerId,
        row.id,
      );
      const auth = this.decryptAuth(row);
      if (auth.type !== "none") environment[source] = auth.value;
      const runtimeRequestHeaders = requestHeaders.map((header) => {
        const headerSource = mcpRequestHeaderEnvironmentName(
          this.masterKey,
          ownerId,
          row.id,
          header.headerName,
        );
        environment[headerSource] = header.value;
        return { headerName: header.headerName, source: headerSource };
      });
      return {
        ...common,
        transport: "streamable_http" as const,
        url: requireHttpUrl(row),
        ...(auth.type === "bearer"
          ? { credential: { type: "bearer" as const, source } }
          : auth.type === "api_key"
            ? {
                credential: {
                  type: "api_key" as const,
                  headerName: auth.headerName,
                  source,
                },
              }
            : {}),
        ...(runtimeRequestHeaders.length > 0
          ? { requestHeaders: runtimeRequestHeaders }
          : {}),
      };
    });
    return {
      servers,
      generation: mcpRuntimeGeneration(servers, environment, this.masterKey),
      environment,
      credentialUsageReceipts: rows
        .filter(
          (row) => row.authType !== "none" || row.environmentKeys.length > 0,
        )
        .map((row) => ({ serverId: row.id })),
    };
  }

  async resolveRecovery(
    ownerId: string,
    persisted: RuntimeMcpServer[],
  ): Promise<{ environment: Record<string, string> }> {
    // A running turn owns a frozen selection. Unrelated personal servers must
    // neither block its recovery nor contribute credentials to that turn.
    // The selected-runtime path still checks ownership, active state and drift.
    return this.resolveApplicationRecovery(
      ownerId,
      persisted.map((server) => server.id),
      persisted,
    );
  }

  async resolveApplicationRecovery(
    ownerId: string,
    serverIds: readonly string[],
    persisted: RuntimeMcpServer[],
    requestHeaders: readonly RuntimeMcpRequestHeaderValue[] = [],
  ): Promise<{ environment: Record<string, string> }> {
    const current = await this.resolveApplicationRuntime(
      ownerId,
      serverIds,
      requestHeaders,
    );
    if (!sameRuntimeServers(current.servers, persisted)) {
      throw new AppError("CONFLICT");
    }
    return { environment: current.environment };
  }

  private createRecord(
    ownerId: string,
    input: CreateMcpServerInput,
    status: "active" | "disabled" = "active",
  ): CreateMcpServerRecord {
    const id = randomUUID();
    const common = {
      id,
      ownerId,
      serverKey: `user_${id.replaceAll("-", "")}`,
      name: normalizeName(input.name),
      status,
      required: false,
      startupTimeoutSeconds: integerInRange(
        input.startupTimeoutSeconds ?? mcpDefaultStartupTimeoutSeconds,
        1,
        120,
      ),
      toolTimeoutSeconds: integerInRange(
        input.toolTimeoutSeconds ?? mcpDefaultToolTimeoutSeconds,
        1,
        600,
      ),
    };
    if (input.transport === "stdio") {
      const environment = normalizeEnvironment(input.environment ?? {});
      const encryptedEnvironment = encryptEnvironment(
        environment,
        this.masterKey,
        this.keyId,
        id,
      );
      return {
        ...common,
        transport: "stdio",
        url: null,
        command: normalizeCommand(input.command),
        args: normalizeArguments(input.args ?? []),
        encryptedEnvironment,
        environmentKeys: Object.keys(environment).sort(),
        authType: "none",
        apiKeyHeader: null,
        encryptedCredential: null,
        encryptionKeyId: encryptedEnvironment ? this.keyId : null,
        insecureHttpAcknowledged: false,
      };
    }
    const normalized = normalizeHttpInput(input);
    const encryptedCredential = encryptCredential(
      normalized.authType,
      normalized.credential,
      this.masterKey,
      this.keyId,
      id,
    );
    return {
      ...common,
      transport: "streamable_http",
      url: normalized.url.toString(),
      command: null,
      args: [],
      encryptedEnvironment: null,
      environmentKeys: [],
      authType: normalized.authType,
      apiKeyHeader: normalized.apiKeyHeader,
      encryptedCredential,
      encryptionKeyId: encryptedCredential ? this.keyId : null,
      insecureHttpAcknowledged: normalized.insecureHttpAcknowledged,
    };
  }

  private async patchHttpServer(
    id: string,
    current: McpServerRecord,
    input: PatchMcpServerInput,
    commonUpdate: Parameters<McpServerRepository["update"]>[1],
  ): Promise<McpServerRecord> {
    if (
      input.command !== undefined ||
      input.args !== undefined ||
      input.environment !== undefined ||
      input.clearEnvironment
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    const authType = input.authType ?? current.authType;
    const url = normalizeMcpUrl(input.url ?? requireHttpUrl(current));
    const apiKeyHeader = normalizeApiKeyHeader(
      authType,
      input.apiKeyHeader ?? current.apiKeyHeader ?? undefined,
    );
    const insecureHttpAcknowledged = resolveHttpAcknowledgement({
      url,
      ...(input.insecureHttpAcknowledged === undefined
        ? {}
        : { requested: input.insecureHttpAcknowledged }),
      current,
      urlChanged:
        input.url !== undefined && url.toString() !== requireHttpUrl(current),
    });
    const credentialUpdate = resolveCredentialUpdate({
      id,
      current,
      authType,
      ...(input.credential === undefined
        ? {}
        : { credential: input.credential }),
      clearCredential: input.clearCredential ?? false,
      masterKey: this.masterKey,
      keyId: this.keyId,
    });
    return this.repository.update(id, {
      ...commonUpdate,
      ...(input.url === undefined ? {} : { url: url.toString() }),
      ...(input.authType === undefined ? {} : { authType }),
      apiKeyHeader,
      ...credentialUpdate,
      insecureHttpAcknowledged,
    });
  }

  private async patchStdioServer(
    id: string,
    current: McpServerRecord,
    input: PatchMcpServerInput,
    commonUpdate: Parameters<McpServerRepository["update"]>[1],
  ): Promise<McpServerRecord> {
    if (
      input.url !== undefined ||
      input.authType !== undefined ||
      input.apiKeyHeader !== undefined ||
      input.credential !== undefined ||
      input.clearCredential ||
      input.insecureHttpAcknowledged !== undefined ||
      (input.clearEnvironment && input.environment !== undefined)
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    const environmentUpdate =
      input.clearEnvironment === true
        ? {
            encryptedEnvironment: null,
            environmentKeys: [],
            encryptionKeyId: null,
          }
        : input.environment === undefined
          ? {}
          : (() => {
              const environment = normalizeEnvironment(input.environment);
              const encryptedEnvironment = encryptEnvironment(
                environment,
                this.masterKey,
                this.keyId,
                id,
              );
              return {
                encryptedEnvironment,
                environmentKeys: Object.keys(environment).sort(),
                encryptionKeyId: encryptedEnvironment ? this.keyId : null,
              };
            })();
    return this.repository.update(id, {
      ...commonUpdate,
      ...(input.command === undefined
        ? {}
        : { command: normalizeCommand(input.command) }),
      ...(input.args === undefined
        ? {}
        : { args: normalizeArguments(input.args) }),
      ...environmentUpdate,
    });
  }

  private decryptAuth(
    row: McpServerRecord,
  ):
    | { type: "none" }
    | { type: "bearer"; value: string }
    | { type: "api_key"; headerName: string; value: string } {
    if (row.authType === "none") return { type: "none" };
    if (!row.encryptedCredential || !row.encryptionKeyId) {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    let payload: { value?: unknown };
    try {
      payload = decryptJson<{ value?: unknown }>(
        row.encryptedCredential,
        this.masterKey,
        row.encryptionKeyId,
        `${MCP_CREDENTIAL_CONTEXT_PREFIX}${row.id}`,
      );
    } catch {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    if (typeof payload.value !== "string" || payload.value.length === 0) {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    return row.authType === "bearer"
      ? { type: "bearer", value: payload.value }
      : {
          type: "api_key",
          headerName: normalizeApiKeyHeader(
            "api_key",
            row.apiKeyHeader ?? undefined,
          )!,
          value: payload.value,
        };
  }

  private decryptEnvironment(row: McpServerRecord): Record<string, string> {
    if (row.environmentKeys.length === 0) return {};
    if (!row.encryptedEnvironment || !row.encryptionKeyId) {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    let payload: unknown;
    try {
      payload = decryptJson<unknown>(
        row.encryptedEnvironment,
        this.masterKey,
        row.encryptionKeyId,
        `${MCP_ENVIRONMENT_CONTEXT_PREFIX}${row.id}`,
      );
    } catch {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    const environment = normalizeEnvironment(payload);
    if (
      JSON.stringify(Object.keys(environment).sort()) !==
      JSON.stringify([...row.environmentKeys].sort())
    ) {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    return environment;
  }

  private requireStdioProbe(): McpStdioConnectionProbe {
    if (!this.stdioProbe) throw new AppError("MCP_CONNECTION_FAILED");
    return this.stdioProbe;
  }

  private async requireOwned(ownerId: string, id: string) {
    const row = await this.repository.findOwned(ownerId, id);
    if (!row) throw new AppError("MCP_SERVER_NOT_FOUND");
    return row;
  }

  private writeAudit(
    actor: RequestActor,
    action: string,
    server: McpServerRecord,
    metadata?: Record<string, string | number | boolean | null>,
  ) {
    return this.audit.write({
      actorId: actor.id,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      action,
      targetType: "mcp_server",
      targetId: server.id,
      result: "success",
      ...(metadata === undefined ? {} : { metadata }),
    });
  }
}

function normalizeHttpInput(input: CreateHttpMcpServerInput) {
  const url = normalizeMcpUrl(input.url);
  const authType = mcpServerAuthTypeSchema.parse(input.authType);
  const insecureHttpAcknowledged =
    url.protocol === "http:" ? input.insecureHttpAcknowledged === true : false;
  if (url.protocol === "http:" && !insecureHttpAcknowledged) {
    throw new AppError("MCP_INSECURE_HTTP_ACKNOWLEDGEMENT_REQUIRED");
  }
  return {
    url,
    authType,
    apiKeyHeader: normalizeApiKeyHeader(authType, input.apiKeyHeader),
    credential: normalizeCredential(input.credential),
    insecureHttpAcknowledged,
  };
}

function normalizeMcpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.toString().length > 2_048
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  return url;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 160) throw new AppError("VALIDATION_ERROR");
  return name;
}

function normalizeCommand(value: string): string {
  const command = value.trim();
  if (!command || command.length > 512 || /[\0\r\n]/u.test(command)) {
    throw new AppError("VALIDATION_ERROR");
  }
  return command;
}

function normalizeArguments(value: string[]): string[] {
  if (!Array.isArray(value) || value.length > MAX_STDIO_ARGUMENTS) {
    throw new AppError("VALIDATION_ERROR");
  }
  let total = 0;
  return value.map((argument) => {
    if (
      typeof argument !== "string" ||
      argument.length > 4_096 ||
      argument.includes("\0")
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    total += Buffer.byteLength(argument, "utf8");
    if (total > 64 * 1_024) throw new AppError("VALIDATION_ERROR");
    return argument;
  });
}

function normalizeEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_STDIO_ENVIRONMENT_VARIABLES) {
    throw new AppError("VALIDATION_ERROR");
  }
  let total = 0;
  const environment: Record<string, string> = {};
  for (const [name, rawValue] of entries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      !ENVIRONMENT_KEY_PATTERN.test(name) ||
      name.length > 120 ||
      isReservedStdioEnvironmentKey(name) ||
      typeof rawValue !== "string" ||
      rawValue.length > 64 * 1_024 ||
      rawValue.includes("\0")
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    total +=
      Buffer.byteLength(name, "utf8") + Buffer.byteLength(rawValue, "utf8");
    if (total > MAX_STDIO_JSON_BYTES) throw new AppError("VALIDATION_ERROR");
    environment[name] = rawValue;
  }
  return environment;
}

function isReservedStdioEnvironmentKey(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    RESERVED_STDIO_ENVIRONMENT_KEYS.has(upper) ||
    upper.startsWith("LINKSENSE_") ||
    upper.startsWith("CODEX_") ||
    upper.startsWith("DYLD_") ||
    upper.startsWith("NPM_CONFIG_") ||
    upper.startsWith("PNPM_") ||
    upper.startsWith("COREPACK_")
  );
}

function normalizeApiKeyHeader(
  authType: McpServerAuthType,
  value?: string,
): string | null {
  if (authType !== "api_key") return null;
  const header = value?.trim();
  if (
    !header ||
    header.length > 120 ||
    !HTTP_HEADER_NAME_PATTERN.test(header) ||
    RESERVED_API_KEY_HEADERS.has(header.toLocaleLowerCase())
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  return header;
}

function normalizeCredential(value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (!value || value.length > 64 * 1_024 || /[\r\n]/u.test(value)) {
    throw new AppError("VALIDATION_ERROR");
  }
  return value;
}

function encryptCredential(
  authType: McpServerAuthType,
  credential: string | undefined,
  masterKey: string,
  keyId: string,
  id: string,
): string | null {
  if (authType === "none") return null;
  const value = normalizeCredential(credential);
  if (!value) throw new AppError("MCP_CREDENTIAL_REQUIRED");
  return encryptJson(
    { value },
    masterKey,
    keyId,
    `${MCP_CREDENTIAL_CONTEXT_PREFIX}${id}`,
  );
}

function encryptEnvironment(
  environment: Record<string, string>,
  masterKey: string,
  keyId: string,
  id: string,
): string | null {
  if (Object.keys(environment).length === 0) return null;
  return encryptJson(
    environment,
    masterKey,
    keyId,
    `${MCP_ENVIRONMENT_CONTEXT_PREFIX}${id}`,
  );
}

function resolveCredentialUpdate(input: {
  id: string;
  current: McpServerRecord;
  authType: McpServerAuthType;
  credential?: string;
  clearCredential: boolean;
  masterKey: string;
  keyId: string;
}): Pick<McpServerRecord, "encryptedCredential" | "encryptionKeyId"> {
  if (input.authType === "none" || input.clearCredential) {
    if (input.authType !== "none" && input.credential === undefined) {
      throw new AppError("MCP_CREDENTIAL_REQUIRED");
    }
    return input.authType === "none"
      ? { encryptedCredential: null, encryptionKeyId: null }
      : {
          encryptedCredential: encryptCredential(
            input.authType,
            input.credential,
            input.masterKey,
            input.keyId,
            input.id,
          ),
          encryptionKeyId: input.keyId,
        };
  }
  if (input.credential !== undefined) {
    return {
      encryptedCredential: encryptCredential(
        input.authType,
        input.credential,
        input.masterKey,
        input.keyId,
        input.id,
      ),
      encryptionKeyId: input.keyId,
    };
  }
  if (!input.current.encryptedCredential || !input.current.encryptionKeyId) {
    throw new AppError("MCP_CREDENTIAL_REQUIRED");
  }
  return {
    encryptedCredential: input.current.encryptedCredential,
    encryptionKeyId: input.current.encryptionKeyId,
  };
}

function resolveHttpAcknowledgement(input: {
  url: URL;
  requested?: boolean;
  current: McpServerRecord;
  urlChanged: boolean;
}): boolean {
  if (input.url.protocol === "https:") return false;
  const acknowledged = input.urlChanged
    ? input.requested === true
    : (input.requested ?? input.current.insecureHttpAcknowledged);
  if (!acknowledged) {
    throw new AppError("MCP_INSECURE_HTTP_ACKNOWLEDGEMENT_REQUIRED");
  }
  return true;
}

function integerInRange(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError("VALIDATION_ERROR");
  }
  return value;
}

function mcpCredentialEnvironmentName(
  secret: string,
  ownerId: string,
  serverId: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`mcp-credential\0${ownerId}\0${serverId}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  return `LINKSENSE_MCP_CREDENTIAL_${digest}`;
}

function mcpRequestHeaderEnvironmentName(
  secret: string,
  ownerId: string,
  serverId: string,
  headerName: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(
      `mcp-request-header\0${ownerId}\0${serverId}\0${headerName.toLowerCase()}`,
    )
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  return `LINKSENSE_MCP_CREDENTIAL_${digest}`;
}

function mcpStdioEnvironmentName(
  secret: string,
  ownerId: string,
  serverId: string,
  name: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`mcp-stdio-environment\0${ownerId}\0${serverId}\0${name}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  return `LINKSENSE_MCP_STDIO_${digest}`;
}

function mcpRuntimeGeneration(
  servers: RuntimeMcpServer[],
  environment: Record<string, string>,
  secret: string,
): string {
  if (servers.length === 0) return EMPTY_MCP_GENERATION;
  const credentialFingerprints = Object.fromEntries(
    Object.entries(environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [
        name,
        createHmac("sha256", secret)
          .update(`mcp-runtime-credential\0${name}\0${value}`)
          .digest("hex"),
      ]),
  );
  return createHash("sha256")
    .update(JSON.stringify({ servers, credentialFingerprints }))
    .digest("hex");
}

function mcpServerRevision(row: McpServerRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: row.id,
        serverKey: row.serverKey,
        name: row.name,
        transport: row.transport,
        url: row.url,
        command: row.command,
        args: row.args,
        environmentKeys: row.environmentKeys,
        encryptedEnvironment: row.encryptedEnvironment,
        authType: row.authType,
        apiKeyHeader: row.apiKeyHeader,
        encryptedCredential: row.encryptedCredential,
        encryptionKeyId: row.encryptionKeyId,
        status: row.status,
        startupTimeoutSeconds: row.startupTimeoutSeconds,
        toolTimeoutSeconds: row.toolTimeoutSeconds,
      }),
    )
    .digest("hex");
}

function sameRuntimeServers(
  current: RuntimeMcpServer[],
  persisted: RuntimeMcpServer[],
): boolean {
  return JSON.stringify(current) === JSON.stringify(persisted);
}

function projectMcpServer(row: McpServerRecord): McpServer {
  const common = {
    id: row.id,
    is_builtin: false as const,
    name: row.name,
    status: row.status,
    startup_timeout_seconds: row.startupTimeoutSeconds,
    tool_timeout_seconds: row.toolTimeoutSeconds,
    last_test_status: row.lastTestStatus,
    last_test_error_code: row.lastTestErrorCode,
    last_tested_at: row.lastTestedAt?.toISOString() ?? null,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
  return row.transport === "stdio"
    ? {
        ...common,
        transport: "stdio",
        url: null,
        command: requireStdioCommand(row),
        args: row.args,
        environment_keys: [...row.environmentKeys].sort(),
        auth_type: "none",
        api_key_header: null,
        has_credential: false,
        insecure_http_acknowledged: false,
      }
    : {
        ...common,
        transport: "streamable_http",
        url: requireHttpUrl(row),
        command: null,
        args: [],
        environment_keys: [],
        auth_type: row.authType,
        api_key_header: row.apiKeyHeader,
        has_credential: row.encryptedCredential !== null,
        insecure_http_acknowledged: row.insecureHttpAcknowledged,
      };
}

function requireHttpUrl(row: McpServerRecord): string {
  if (!row.url) throw new AppError("VALIDATION_ERROR");
  return row.url;
}

function requireStdioCommand(row: McpServerRecord): string {
  if (!row.command) throw new AppError("VALIDATION_ERROR");
  return row.command;
}

function assertActiveActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}
