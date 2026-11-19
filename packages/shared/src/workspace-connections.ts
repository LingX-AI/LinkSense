import { z } from "zod";
import {
  isMicrosoftFilesWrite,
  microsoftFilesInputSchema,
  microsoftFilesResultSchema,
} from "./connections.js";

export const workspaceProviderSchema = z.enum([
  "google_docs",
  "gmail",
  "outlook",
]);
const id = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_!.,=+@\-]+$/u)
  .refine((value) => value !== "." && value !== "..");
const cursor = z.string().min(1).max(12000);
const mail = { provider: z.enum(["gmail", "outlook"]) };
const docs = { provider: z.literal("google_docs") };
const address = z.email().max(320);
export const connectionAttachmentSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^\r\n/\\]+$/u),
  content_type: z
    .string()
    .max(160)
    .regex(/^[\w.+-]+\/[\w.+-]+$/u),
  content_base64: z
    .string()
    .max(4 * 1024 * 1024)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
});
const compose = {
  to: z.array(address).min(1).max(50),
  cc: z.array(address).max(50).default([]),
  bcc: z.array(address).max(50).default([]),
  subject: z
    .string()
    .max(998)
    .regex(/^[^\r\n]*$/u),
  text: z.string().max(500000),
  attachments: z
    .array(connectionAttachmentSchema)
    .max(10)
    .refine(
      (items) =>
        items.reduce(
          (total, item) =>
            total +
            (item.content_base64.length / 4) * 3 -
            (item.content_base64.endsWith("==")
              ? 2
              : item.content_base64.endsWith("=")
                ? 1
                : 0),
          0,
        ) <=
        3 * 1024 * 1024,
    )
    .default([]),
};
export const workspaceReadInputSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...docs,
    operation: z.literal("search_documents"),
    query: z.string().max(500),
    cursor: cursor.optional(),
  }),
  z.strictObject({
    ...docs,
    operation: z.literal("read_document"),
    document_id: id,
  }),
  z.strictObject({
    ...docs,
    operation: z.literal("export_document"),
    document_id: id,
    format: z.enum(["pdf", "docx", "txt"]),
  }),
  z.strictObject({
    ...mail,
    operation: z.literal("search_mail"),
    query: z.string().max(500),
    cursor: cursor.optional(),
  }),
  z.strictObject({
    ...mail,
    operation: z.literal("read_mail"),
    message_id: id,
  }),
  z.strictObject({
    ...mail,
    operation: z.literal("list_labels"),
    cursor: cursor.optional(),
  }),
  z.strictObject({
    ...mail,
    operation: z.literal("list_drafts"),
    cursor: cursor.optional(),
  }),
  z.strictObject({ ...mail, operation: z.literal("read_draft"), draft_id: id }),
  z.strictObject({
    ...mail,
    operation: z.literal("read_thread"),
    thread_id: id,
    cursor: cursor.optional(),
  }),
  z.strictObject({
    ...mail,
    operation: z.literal("download_attachment"),
    message_id: id,
    attachment_id: id,
  }),
]);
export const workspaceWriteInputSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...docs,
    operation: z.literal("create_document"),
    title: z.string().min(1).max(255),
    text: z.string().max(500000).default(""),
  }),
  z.strictObject({
    ...docs,
    operation: z.literal("edit_document"),
    document_id: id,
    expected_revision: z.string().min(1).max(1024),
    edits: z
      .array(
        z.discriminatedUnion("type", [
          z.strictObject({
            type: z.literal("insert_text"),
            index: z.number().int().min(1),
            text: z.string().max(500000),
            tab_id: id.optional(),
          }),
          z.strictObject({
            type: z.literal("replace_text"),
            find: z.string().min(1).max(50000),
            replace: z.string().max(500000),
            match_case: z.boolean().default(true),
            tab_id: id.optional(),
          }),
          z
            .strictObject({
              type: z.literal("format_text"),
              start: z.number().int().min(1),
              end: z.number().int().min(2),
              bold: z.boolean().optional(),
              italic: z.boolean().optional(),
              underline: z.boolean().optional(),
              tab_id: id.optional(),
            })
            .refine(
              (v) =>
                v.end > v.start &&
                [v.bold, v.italic, v.underline].some((x) => x !== undefined),
            ),
        ]),
      )
      .min(1)
      .max(100),
  }),
  z.strictObject({ ...mail, operation: z.literal("create_draft"), ...compose }),
  z.strictObject({
    ...mail,
    operation: z.literal("update_draft"),
    draft_id: id,
    ...compose,
  }),
  z.strictObject({
    ...mail,
    operation: z.literal("reply_draft"),
    message_id: id,
    text: compose.text,
  }),
  z.strictObject({ ...mail, operation: z.literal("send_draft"), draft_id: id }),
  z.strictObject({
    ...mail,
    operation: z.literal("modify_mail"),
    message_id: id,
    action: z.enum(["mark_read", "mark_unread", "archive", "trash"]),
  }),
  z.strictObject({
    provider: z.literal("gmail"),
    operation: z.literal("label_mail"),
    message_id: id,
    add: z.array(id).max(50).default([]),
    remove: z.array(id).max(50).default([]),
  }),
  z.strictObject({
    provider: z.literal("outlook"),
    operation: z.literal("move_mail"),
    message_id: id,
    folder_id: id,
  }),
]);
export const workspaceInputSchema = z.discriminatedUnion("operation", [
  ...workspaceReadInputSchema.options,
  ...workspaceWriteInputSchema.options,
]);
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;
export const connectionInputSchema = z.union([
  microsoftFilesInputSchema,
  workspaceInputSchema,
]);
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
export function isWorkspaceInput(
  input: ConnectionInput,
): input is WorkspaceInput {
  return (
    "provider" in input &&
    workspaceProviderSchema.safeParse(input.provider).success
  );
}
export function isConnectionWrite(input: ConnectionInput): boolean {
  return isWorkspaceInput(input)
    ? !workspaceReadInputSchema.safeParse(input).success
    : isMicrosoftFilesWrite(input);
}
const json = z.json();
export const workspaceResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("workspace_data"),
    data: json,
    next_cursor: cursor.nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal("workspace_file"),
    name: z.string().max(255),
    content_type: z.string().max(160),
    content_base64: z.string().max(28 * 1024 * 1024),
  }),
]);
export type WorkspaceResult = z.infer<typeof workspaceResultSchema>;
export const connectionResultSchema = z.union([
  microsoftFilesResultSchema,
  workspaceResultSchema,
]);
export type ConnectionResult = z.infer<typeof connectionResultSchema>;

export const internalConnectionRequestSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  input: connectionInputSchema,
});

// The device relay carries metadata and text. File bytes use the artifact channel.
export const desktopConnectionOperations = [
  "list_connections", "get_file", "list_drives", "search_sites", "list_files", "search_files",
  "search_documents", "read_document", "search_mail", "read_mail", "list_labels", "list_drafts", "read_draft", "read_thread",
] as const satisfies readonly ConnectionInput["operation"][];
const desktopConnectionOperationSet: ReadonlySet<string> = new Set(desktopConnectionOperations);
export const isDesktopConnectionOperation = (operation: string): boolean =>
  desktopConnectionOperationSet.has(operation);
export const desktopConnectionInputSchema = connectionInputSchema.refine(
  ({ operation }) => isDesktopConnectionOperation(operation),
);
const contentHash = z.string().regex(/^[0-9a-f]{64}$/u);
const positiveByteOffset = z.number().int().positive();
export const desktopConnectionRequestBodySchema = z.strictObject({
  input: desktopConnectionInputSchema,
  page: z.strictObject({
    byte_offset: positiveByteOffset,
    expected_sha256: contentHash,
  }).optional(),
}).refine(({ input, page }) => !page || isWorkspaceInput(input));
export type DesktopConnectionRequestBody = z.infer<typeof desktopConnectionRequestBodySchema>;

// Codex's default model truncation policy is 10,000 bytes; the bundled model
// catalog declares 10,000 tokens and LinkSense's generated catalog inherits
// that policy. Keep the shared page under the smaller default so both paths
// deliver the page intact, including the native MCP wrapper.
export const desktopConnectionTextPageBytes = 8 * 1024;
export const desktopConnectionTextSchema = z.strictObject({
  kind: z.literal("workspace_text"),
  data: z.string().max(desktopConnectionTextPageBytes),
  complete: z.boolean(),
  sha256: contentHash,
  next_byte_offset: positiveByteOffset.nullable(),
  next_cursor: cursor.nullable(),
}).refine(({ complete, next_byte_offset, next_cursor }) =>
  complete === (next_byte_offset === null) && (complete || next_cursor === null));
export const desktopConnectionResultSchema = z.union([
  microsoftFilesResultSchema.refine(
    ({ kind }) => kind === "connections" || kind === "item" || kind === "page",
  ),
  desktopConnectionTextSchema,
]);
