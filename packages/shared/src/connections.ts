import { z } from "zod";

export const microsoftFilesProviderSchema = z.enum(["onedrive", "sharepoint"]);
export const connectionProviderSchema = z.enum(["onedrive", "sharepoint", "google_docs", "gmail", "outlook"]);
export type ConnectionProvider = z.infer<typeof connectionProviderSchema>;
export const MICROSOFT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const MICROSOFT_CONNECTION_BODY_LIMIT = Math.ceil(MICROSOFT_FILE_MAX_BYTES / 3) * 4 + 64 * 1024;
export const connectionStatusSchema = z.enum(["connected", "reconnect_required", "disconnected"]);
export const connectionSchema = z.strictObject({
  provider: connectionProviderSchema,
  configured: z.boolean(),
  status: connectionStatusSchema,
  access_mode: z.enum(["read", "read_write"]).nullable(),
  account_name: z.string().max(320).nullable(),
  connected_at: z.iso.datetime().nullable(),
});
export type Connection = z.infer<typeof connectionSchema>;
export const connectionListSchema = z.strictObject({ items: z.array(connectionSchema) });
export const connectionAuthorizationSchema = z.strictObject({ authorization_url: z.url() });

const graphId = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9!_,.\-]+$/u)
  .refine((value) => value !== "." && value !== "..");
const pageCursor = z.string().min(1).max(12_000);
export const microsoftFilesReadInputSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("list_connections") }),
  z.strictObject({
    operation: z.literal("get_file"),
    provider: microsoftFilesProviderSchema,
    drive_id: graphId,
    item_id: graphId,
  }),
  z.strictObject({
    operation: z.literal("list_drives"),
    provider: microsoftFilesProviderSchema,
    site_id: graphId.optional(),
    cursor: pageCursor.optional(),
  }),
  z.strictObject({
    operation: z.literal("search_sites"),
    provider: z.literal("sharepoint"),
    query: z.string().trim().min(1).max(200),
    cursor: pageCursor.optional(),
  }),
  z.strictObject({
    operation: z.literal("list_files"),
    provider: microsoftFilesProviderSchema,
    drive_id: graphId,
    folder_id: graphId.optional(),
    cursor: pageCursor.optional(),
  }),
  z.strictObject({
    operation: z.literal("search_files"),
    provider: microsoftFilesProviderSchema,
    drive_id: graphId,
    query: z.string().trim().min(1).max(200),
    cursor: pageCursor.optional(),
  }),
  z.strictObject({
    operation: z.literal("read_file"),
    provider: microsoftFilesProviderSchema,
    drive_id: graphId,
    item_id: graphId,
  }),
]);
export const microsoftFileNameSchema = z.string().min(1).max(255)
  .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/u)
  .refine((value) => value !== "." && value !== ".." && !/[. ]$/u.test(value));
const etag = z.string().min(1).max(1024).regex(/^(?:W\/)?"[^"\r\n]+"$/u);
const writeTarget = { provider: microsoftFilesProviderSchema, drive_id: graphId };
const existingTarget = { ...writeTarget, item_id: graphId, expected_etag: etag };
const fileBytes = z.string().min(4).max(Math.ceil(MICROSOFT_FILE_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/u).refine((value) => value.length % 4 === 0);
export const microsoftFilesWriteInputSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create_file"), ...writeTarget, folder_id: graphId.optional(), name: microsoftFileNameSchema, content_base64: fileBytes }),
  z.strictObject({ operation: z.literal("update_file"), ...existingTarget, content_base64: fileBytes }),
  z.strictObject({ operation: z.literal("create_folder"), ...writeTarget, folder_id: graphId.optional(), name: microsoftFileNameSchema }),
  z.strictObject({ operation: z.literal("rename_file"), ...existingTarget, name: microsoftFileNameSchema }),
  z.strictObject({ operation: z.literal("move_file"), ...existingTarget, folder_id: graphId }),
  z.strictObject({ operation: z.literal("delete_file"), ...existingTarget }),
]);
export const microsoftFilesInputSchema = z.discriminatedUnion("operation", [
  ...microsoftFilesReadInputSchema.options, ...microsoftFilesWriteInputSchema.options,
]);
export type MicrosoftFilesInput = z.infer<typeof microsoftFilesInputSchema>;
export type MicrosoftFilesWriteInput = z.infer<typeof microsoftFilesWriteInputSchema>;
export function isMicrosoftFilesWrite(input: MicrosoftFilesInput): input is MicrosoftFilesWriteInput {
  return !microsoftFilesReadInputSchema.options.some((schema) => schema.shape.operation.value === input.operation);
}
export const microsoftFileEntrySchema = z.strictObject({
  id: z.string().min(1).max(512),
  name: z.string().max(320),
  web_url: z.url().nullable(),
  kind: z.enum(["file", "folder", "drive", "site"]),
  drive_id: z.string().max(512).nullable(),
  mime_type: z.string().max(160).nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  etag: etag.nullable(),
});
export const microsoftFilesResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("item"), item: microsoftFileEntrySchema }),
  z.strictObject({ kind: z.literal("deleted"), item_id: graphId }),
  z.strictObject({ kind: z.literal("connections"), items: z.array(connectionSchema) }),
  z.strictObject({
    kind: z.literal("page"),
    items: z.array(microsoftFileEntrySchema).max(200),
    next_cursor: pageCursor.nullable(),
  }),
  // This result is restricted to the authenticated API-to-runner boundary. The
  // runner converts the bytes before returning content to the model.
  z.strictObject({
    kind: z.literal("file"),
    item: microsoftFileEntrySchema,
    content_base64: z.string().max(Math.ceil(MICROSOFT_FILE_MAX_BYTES / 3) * 4),
  }),
]);
export type MicrosoftFilesResult = z.infer<typeof microsoftFilesResultSchema>;
export const connectionFailureCodeSchema = z.enum([
  "CONNECTION_NOT_CONFIGURED",
  "CONNECTION_AUTH_FAILED",
  "CONNECTION_REQUIRED",
  "CONNECTION_UNAVAILABLE",
  "CONNECTION_ACCESS_DENIED",
  "CONNECTION_FILE_TOO_LARGE",
  "CONNECTION_WRITE_REQUIRED",
  "CONNECTION_FILE_CONFLICT",
]);
export const connectionFailureSchema = z.strictObject({
  code: connectionFailureCodeSchema,
  retryable: z.boolean(),
});
