import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const coreMcpServerKey = "linksense_core" as const;
export const managedBrowserMcpServerKey = "linksense_managed_browser" as const;
export const builtInMcpServerKeys = [
  coreMcpServerKey,
  managedBrowserMcpServerKey,
] as const;

export const mcpServerTransportSchema = z.enum(["streamable_http", "stdio"]);
export const mcpServerAuthTypeSchema = z.enum(["none", "bearer", "api_key"]);
export const mcpServerStatusSchema = z.enum(["active", "disabled"]);
export const mcpDefaultStartupTimeoutSeconds = 60;
export const mcpDefaultToolTimeoutSeconds = 600;

const environmentKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
  .max(120);

const mcpServerBaseSchema = z.strictObject({
  id: uuidSchema,
  is_builtin: z.literal(false).default(false),
  name: z.string().trim().min(1).max(160),
  status: mcpServerStatusSchema,
  startup_timeout_seconds: z.number().int().min(1).max(120),
  tool_timeout_seconds: z.number().int().min(1).max(600),
  last_test_status: z.enum(["succeeded", "failed"]).nullable(),
  last_test_error_code: z.string().max(120).nullable(),
  last_tested_at: timestampSchema.nullable(),
  last_used_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const mcpServerSchema = z.discriminatedUnion("transport", [
  mcpServerBaseSchema.extend({
    transport: z.literal("streamable_http"),
    url: z.string().url().max(2_048),
    command: z.null(),
    args: z.array(z.string()).length(0),
    environment_keys: z.array(environmentKeySchema).length(0),
    auth_type: mcpServerAuthTypeSchema,
    api_key_header: z.string().min(1).max(120).nullable(),
    has_credential: z.boolean(),
    insecure_http_acknowledged: z.boolean(),
  }),
  mcpServerBaseSchema.extend({
    transport: z.literal("stdio"),
    url: z.null(),
    command: z.string().trim().min(1).max(512),
    args: z.array(z.string().max(4_096)).max(128),
    environment_keys: z.array(environmentKeySchema).max(64),
    auth_type: z.literal("none"),
    api_key_header: z.null(),
    has_credential: z.literal(false),
    insecure_http_acknowledged: z.literal(false),
  }),
]);

export const mcpServerTestResultSchema = z.strictObject({
  status: z.literal("succeeded"),
  server_name: z.string().min(1).max(160),
  protocol_version: z.string().min(1).max(80),
  tool_count: z.number().int().nonnegative(),
  tested_at: timestampSchema,
});

export const mcpServerImportResultSchema = z.strictObject({
  items: z.array(mcpServerSchema).min(1).max(30),
});

export const mcpCredentialEnvironmentNameSchema = z
  .string()
  .regex(/^LINKSENSE_MCP_CREDENTIAL_[A-F0-9]{32}$/u);

const runtimeMcpRequestHeaderSchema = z.strictObject({
  headerName: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u).max(120),
  source: mcpCredentialEnvironmentNameSchema,
});

export const mcpStdioEnvironmentSourceNameSchema = z
  .string()
  .regex(/^LINKSENSE_MCP_STDIO_[A-F0-9]{32}$/u);

const runtimeMcpServerBaseSchema = z.strictObject({
  id: uuidSchema,
  serverKey: z.string().regex(/^user_[a-f0-9]{32}$/u),
  name: z.string().min(1).max(160),
  revision: z.string().min(1).max(160),
  startupTimeoutSeconds: z.number().int().min(1).max(120),
  toolTimeoutSeconds: z.number().int().min(1).max(600),
});

export const runtimeMcpServerSchema = z.discriminatedUnion("transport", [
  runtimeMcpServerBaseSchema.extend({
    transport: z.literal("streamable_http"),
    url: z.string().url().max(2_048),
    credential: z
      .discriminatedUnion("type", [
        z.strictObject({
          type: z.literal("bearer"),
          source: mcpCredentialEnvironmentNameSchema,
        }),
        z.strictObject({
          type: z.literal("api_key"),
          headerName: z.string().min(1).max(120),
          source: mcpCredentialEnvironmentNameSchema,
        }),
      ])
      .optional(),
    requestHeaders: z.array(runtimeMcpRequestHeaderSchema).max(16).optional(),
  }),
  runtimeMcpServerBaseSchema.extend({
    transport: z.literal("stdio"),
    command: z.string().min(1).max(512),
    args: z.array(z.string().max(4_096)).max(128),
    environmentVariables: z
      .array(
        z.strictObject({
          name: environmentKeySchema,
          source: mcpStdioEnvironmentSourceNameSchema,
        }),
      )
      .max(64),
  }),
]);

export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpServerTransport = z.infer<typeof mcpServerTransportSchema>;
export type McpServerAuthType = z.infer<typeof mcpServerAuthTypeSchema>;
export type McpServerTestResult = z.infer<typeof mcpServerTestResultSchema>;
export type McpServerImportResult = z.infer<typeof mcpServerImportResultSchema>;
export type RuntimeMcpServer = z.infer<typeof runtimeMcpServerSchema>;
