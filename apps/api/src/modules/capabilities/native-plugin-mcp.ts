import type { CapabilityMcpEnvironmentReference } from "@linksense/shared";

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_MCP_SERVERS = 128;
const MAX_ENVIRONMENT_REFERENCES = 1_000;
const MAX_STDIO_ENVIRONMENT_REFERENCES = 256;

export class NativePluginMcpValidationError extends Error {
  constructor() {
    super("native plugin MCP configuration is invalid");
    this.name = "NativePluginMcpValidationError";
  }
}

export interface NativePluginMcpServerInspection {
  name: string;
  transport: "stdio" | "http";
  config: Record<string, unknown>;
  environmentReferences: CapabilityMcpEnvironmentReference[];
}

export interface NativePluginMcpInspection {
  servers: NativePluginMcpServerInspection[];
  environmentReferences: CapabilityMcpEnvironmentReference[];
}

export function inspectNativePluginMcpConfigFile(
  value: unknown,
): NativePluginMcpInspection {
  const config = asObject(value);
  return inspectNativePluginMcpServers(config.mcpServers);
}

export function inspectNativePluginMcpServers(
  value: unknown,
): NativePluginMcpInspection {
  const serverMap = asObject(value);
  const entries = Object.entries(serverMap);
  if (entries.length === 0 || entries.length > MAX_MCP_SERVERS) {
    throw new NativePluginMcpValidationError();
  }

  const servers = entries.map(([name, rawConfig]) =>
    inspectServer(name, rawConfig),
  );
  const environmentReferences = servers.flatMap(
    (server) => server.environmentReferences,
  );
  if (environmentReferences.length > MAX_ENVIRONMENT_REFERENCES) {
    throw new NativePluginMcpValidationError();
  }
  return { servers, environmentReferences };
}

function inspectServer(
  name: string,
  rawConfig: unknown,
): NativePluginMcpServerInspection {
  if (name.trim().length === 0 || name.length > 160) {
    throw new NativePluginMcpValidationError();
  }
  const config = asObject(rawConfig);
  const hasCommand = typeof config.command === "string";
  const hasUrl = typeof config.url === "string";
  if (hasCommand === hasUrl) throw new NativePluginMcpValidationError();
  if (
    (hasCommand &&
      ((config.command as string).length === 0 ||
        (config.command as string).length > 512)) ||
    (hasUrl &&
      ((config.url as string).length === 0 ||
        (config.url as string).length > 4_096))
  ) {
    throw new NativePluginMcpValidationError();
  }
  if (config.args !== undefined) {
    if (
      !Array.isArray(config.args) ||
      config.args.length > 128 ||
      config.args.some(
        (argument) =>
          typeof argument !== "string" || argument.length > 4_096,
      )
    ) {
      throw new NativePluginMcpValidationError();
    }
  }

  validateStaticEnvironment(config.env);
  const transport = hasCommand ? "stdio" : "http";
  const environmentReferences =
    transport === "stdio"
      ? inspectStdioReferences(name, config)
      : inspectHttpReferences(name, config);
  return { name, transport, config, environmentReferences };
}

function inspectStdioReferences(
  mcpServer: string,
  config: Record<string, unknown>,
): CapabilityMcpEnvironmentReference[] {
  if (
    config.bearer_token_env_var !== undefined ||
    config.env_http_headers !== undefined
  ) {
    throw new NativePluginMcpValidationError();
  }
  if (config.env_vars === undefined) return [];
  if (!Array.isArray(config.env_vars)) {
    throw new NativePluginMcpValidationError();
  }
  if (config.env_vars.length > MAX_STDIO_ENVIRONMENT_REFERENCES) {
    throw new NativePluginMcpValidationError();
  }
  return config.env_vars.map((entry) => {
    if (typeof entry === "string") {
      return reference(mcpServer, entry, "local", "stdio_env_var", null);
    }
    const value = asObject(entry);
    const source = value.source ?? "local";
    if (source !== "local" && source !== "remote") {
      throw new NativePluginMcpValidationError();
    }
    return reference(
      mcpServer,
      requireEnvironmentKey(value.name),
      source,
      "stdio_env_var",
      null,
    );
  });
}

function inspectHttpReferences(
  mcpServer: string,
  config: Record<string, unknown>,
): CapabilityMcpEnvironmentReference[] {
  if (config.env_vars !== undefined) {
    throw new NativePluginMcpValidationError();
  }
  const result: CapabilityMcpEnvironmentReference[] = [];
  if (config.bearer_token_env_var !== undefined) {
    result.push(
      reference(
        mcpServer,
        requireEnvironmentKey(config.bearer_token_env_var),
        "local",
        "bearer_token",
        null,
      ),
    );
  }
  if (config.env_http_headers !== undefined) {
    const headers = asObject(config.env_http_headers);
    for (const [header, envKey] of Object.entries(headers)) {
      if (header.trim().length === 0 || header.length > 256) {
        throw new NativePluginMcpValidationError();
      }
      result.push(
        reference(
          mcpServer,
          requireEnvironmentKey(envKey),
          "local",
          "http_header",
          header,
        ),
      );
    }
  }
  return result;
}

function reference(
  mcpServer: string,
  envKey: string,
  source: "local" | "remote",
  usage: CapabilityMcpEnvironmentReference["usage"],
  httpHeader: string | null,
): CapabilityMcpEnvironmentReference {
  return {
    mcp_server: mcpServer,
    env_key: requireEnvironmentKey(envKey),
    source,
    usage,
    http_header: httpHeader,
  };
}

function validateStaticEnvironment(value: unknown): void {
  if (value === undefined) return;
  const environment = asObject(value);
  for (const [name, entry] of Object.entries(environment)) {
    requireEnvironmentKey(name);
    if (typeof entry !== "string") {
      throw new NativePluginMcpValidationError();
    }
  }
}

function requireEnvironmentKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 120 ||
    !ENVIRONMENT_KEY_PATTERN.test(value)
  ) {
    throw new NativePluginMcpValidationError();
  }
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativePluginMcpValidationError();
  }
  return value as Record<string, unknown>;
}
