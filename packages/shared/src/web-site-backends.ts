import { z } from "zod";

export const webSiteBackendIdSchema = z.string().min(1).max(36).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
export const webSiteFunctionScopes = ["rows.read", "rows.write", "files.read", "files.write", "users.read"] as const;
const name = z.string().trim().min(1).max(128);
const column = z.strictObject({
  key: webSiteBackendIdSchema,
  type: z.enum(["string", "integer", "double", "boolean", "datetime"]),
  size: z.number().int().min(1).max(65_535).optional(),
  required: z.boolean().default(false),
  array: z.boolean().default(false),
}).refine(value => value.type !== "string" || value.size !== undefined, { message: "String columns require a size" });
const entrypoint = z.string().min(1).max(240).regex(/^[a-zA-Z0-9_./-]+$/u)
  .refine(value => !value.startsWith("/") && value.split("/").every(part => part && part !== "." && part !== ".."));
const hostLabel = z.string().trim().toLowerCase().min(3).max(30)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/u);
/** Existing applications retain their full UUID origin. */
export const webSiteBackendHostSchema = z.union([hostLabel, z.uuid()]);
export const generatedWebSiteBackendHostLabel = (id: string): string => z.uuid().parse(id).replaceAll("-", "").slice(0, 12);
/** Twelve hex characters are reserved for generated labels, so a chosen address
 * can never be mistaken for another backend's derived host. */
export const webSiteBackendAddressSchema = hostLabel
  .refine(value => !/^[0-9a-f]{12}$/u.test(value), { message: "This address is reserved for generated hosts" });
export const webSiteBackendPrepareSchema = z.strictObject({
  name,
  backend_id: z.uuid().optional(),
  address: webSiteBackendAddressSchema.optional().describe(
    "Public address label, for example \"appointments\". New applications use /app/appointments and the returned sandbox SDK. Existing origin applications retain their runtime; renaming those changes their origin and does not transfer browser sessions/storage.",
  ),
});
export const webSiteBackendInspectSchema = z.strictObject({ backend_id: z.uuid() });
export const webSiteBackendConfigureSchema = z.strictObject({
  backend_id: z.uuid(),
  change: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("create_table"),
      id: webSiteBackendIdSchema,
      name,
      public_read: z.boolean().default(false),
      client_create: z.boolean().default(true),
      columns: z.array(column).max(32).default([]),
      indexes: z.array(z.strictObject({
        key: webSiteBackendIdSchema,
        type: z.enum(["key", "unique", "fulltext"]),
        columns: z.array(webSiteBackendIdSchema).min(1).max(8),
      })).max(8).default([]),
    }),
    z.strictObject({
      action: z.literal("add_column"),
      table_id: webSiteBackendIdSchema,
      column: column.refine(value => !value.required, { message: "Only optional columns can be added to existing tables" }),
    }),
    z.strictObject({
      action: z.literal("create_bucket"),
      id: webSiteBackendIdSchema,
      name,
      public_read: z.boolean().default(false),
      maximum_file_size: z.number().int().min(1).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
      extensions: z.array(z.string().regex(/^[a-z0-9]{1,12}$/u)).min(1).max(20),
    }),
    z.strictObject({
      action: z.literal("create_function"),
      id: webSiteBackendIdSchema,
      name,
      entrypoint,
      public_execute: z.boolean().default(false),
      scopes: z.array(z.enum(webSiteFunctionScopes)).max(5).default([]),
      timeout: z.number().int().min(1).max(30).default(15),
    }),
    z.strictObject({
      action: z.literal("deploy_function"),
      function_id: webSiteBackendIdSchema,
      file_id: z.uuid(),
    }),
    z.strictObject({
      action: z.literal("activate_function"),
      function_id: webSiteBackendIdSchema,
      deployment_id: webSiteBackendIdSchema,
    }),
    z.strictObject({
      action: z.literal("inspect"),
      path: z.string().max(240).regex(/^\/(?:tablesdb\/app(?:\/tables(?:\/[a-zA-Z0-9_-]+(?:\/(?:columns|indexes))?)?)?|storage\/buckets(?:\/[a-zA-Z0-9_-]+)?|functions(?:\/[a-zA-Z0-9_-]+(?:\/deployments(?:\/[a-zA-Z0-9_-]+)?)?)?)$/u),
    }),
  ]),
});
export const webSiteBackendSchema = z.object({
  id: z.uuid(),
  project_id: webSiteBackendIdSchema,
  name: z.string(),
  status: z.enum(["preparing", "ready", "failed"]),
  origin: z.url(),
  endpoint: z.url(),
  database_id: z.literal("app"),
  runtime_mode: z.enum(["origin", "sandbox"]).default("origin"),
  url: z.url().optional(),
  sdk_url: z.url().optional(),
});
export type WebSiteBackend = z.infer<typeof webSiteBackendSchema>;
export type WebSiteBackendChange = z.infer<typeof webSiteBackendConfigureSchema>["change"];
