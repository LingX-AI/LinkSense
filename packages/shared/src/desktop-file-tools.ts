import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

/**
 * File tools reach a Mac only through the per-task local-tool grant. The API
 * stores root aliases and modes; the absolute folder path never leaves the Mac.
 */
export const desktopFileRootModeSchema = z.enum(["read", "write"]);
export type DesktopFileRootMode = z.infer<typeof desktopFileRootModeSchema>;

export const desktopFileRootSchema = z.strictObject({
  id: uuidSchema,
  device_id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  mode: desktopFileRootModeSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type DesktopFileRoot = z.infer<typeof desktopFileRootSchema>;

export const desktopFileRootListSchema = z.strictObject({
  items: z.array(desktopFileRootSchema),
});
export type DesktopFileRootList = z.infer<typeof desktopFileRootListSchema>;

export const desktopFileRootCreateSchema = z.strictObject({
  device_id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  mode: desktopFileRootModeSchema.default("read"),
});
export type DesktopFileRootCreate = z.infer<typeof desktopFileRootCreateSchema>;

export const desktopFileRootPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  mode: desktopFileRootModeSchema.optional(),
}).refine(value => value.name !== undefined || value.mode !== undefined, {
  message: "at least one of name or mode is required",
});
export type DesktopFileRootPatch = z.infer<typeof desktopFileRootPatchSchema>;

export const desktopFileDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export type DesktopFileDigest = z.infer<typeof desktopFileDigestSchema>;

/** A root-relative path with no absolute, parent, dot or empty segment. */
export const desktopRelativePathSchema = z.string().min(1).max(4096).refine(
  value => !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") &&
    value.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".."),
  { message: "invalid relative path" },
);

export const desktopFileEntryKindSchema = z.enum(["file", "directory", "symlink", "other"]);
export type DesktopFileEntryKind = z.infer<typeof desktopFileEntryKindSchema>;

export const desktopFileEntrySchema = z.strictObject({
  name: z.string(),
  path: desktopRelativePathSchema,
  kind: desktopFileEntryKindSchema,
  size: z.number().int().nonnegative(),
  modified_at: timestampSchema,
});
export type DesktopFileEntry = z.infer<typeof desktopFileEntrySchema>;

export const localFilesRootsInputSchema = z.strictObject({});
export const localFilesRootsResultSchema = z.strictObject({
  roots: z.array(desktopFileRootSchema),
});
export type LocalFilesRootsResult = z.infer<typeof localFilesRootsResultSchema>;

export const localFilesListInputSchema = z.strictObject({
  root_id: uuidSchema,
  path: desktopRelativePathSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
export const localFilesListResultSchema = z.strictObject({
  entries: z.array(desktopFileEntrySchema).max(200),
  truncated: z.boolean(),
});
export type LocalFilesListResult = z.infer<typeof localFilesListResultSchema>;

export const localFilesReadInputSchema = z.strictObject({
  root_id: uuidSchema,
  path: desktopRelativePathSchema,
  max_bytes: z.number().int().min(1).max(1_048_576).default(262_144),
});
export const localFilesReadResultSchema = z.strictObject({
  path: desktopRelativePathSchema,
  kind: z.enum(["text", "binary"]),
  content: z.string().max(1_048_576).optional(),
  digest: desktopFileDigestSchema.nullable(),
  size: z.number().int().nonnegative(),
  modified_at: timestampSchema,
  truncated: z.boolean(),
});
export type LocalFilesReadResult = z.infer<typeof localFilesReadResultSchema>;

export const localFilesSearchInputSchema = z.strictObject({
  root_id: uuidSchema,
  path: desktopRelativePathSchema.optional(),
  query: z.string().trim().min(1).max(200),
  max_results: z.number().int().min(1).max(200).default(50),
});
export const localFileSearchMatchSchema = z.strictObject({
  path: desktopRelativePathSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string().max(240),
});
export const localFilesSearchResultSchema = z.strictObject({
  matches: z.array(localFileSearchMatchSchema).max(200),
  truncated: z.boolean(),
});
export type LocalFilesSearchResult = z.infer<typeof localFilesSearchResultSchema>;

export const desktopFileContentSchema = z.string().max(1_048_576).refine(
  value => new TextEncoder().encode(value).length <= 1_048_576,
  { message: "content exceeds the byte limit" },
);

export const localFilesWriteInputSchema = z.strictObject({
  root_id: uuidSchema,
  path: desktopRelativePathSchema,
  content: desktopFileContentSchema,
  expected_digest: desktopFileDigestSchema.nullable().optional(),
  create_parents: z.boolean().default(false),
});
export const localFilesWriteResultSchema = z.strictObject({
  path: desktopRelativePathSchema,
  digest: desktopFileDigestSchema,
  size: z.number().int().nonnegative(),
  modified_at: timestampSchema,
  created: z.boolean(),
});
export type LocalFilesWriteResult = z.infer<typeof localFilesWriteResultSchema>;

export const localFilesCreateInputSchema = z.strictObject({
  root_id: uuidSchema,
  path: desktopRelativePathSchema,
  kind: z.enum(["file", "directory"]),
  content: desktopFileContentSchema.optional(),
});
export const localFilesCreateResultSchema = z.strictObject({
  path: desktopRelativePathSchema,
  kind: z.enum(["file", "directory"]),
  digest: desktopFileDigestSchema.nullable(),
  size: z.number().int().nonnegative().nullable(),
  modified_at: timestampSchema,
});
export type LocalFilesCreateResult = z.infer<typeof localFilesCreateResultSchema>;

export const localFilesDeleteInputSchema = z.strictObject({
  root_id: uuidSchema,
  path: desktopRelativePathSchema,
  expected_digest: desktopFileDigestSchema.nullable().optional(),
});
export const localFilesDeleteResultSchema = z.strictObject({
  path: desktopRelativePathSchema,
  trashed: z.literal(true),
});
export type LocalFilesDeleteResult = z.infer<typeof localFilesDeleteResultSchema>;

export const localFilesToolNames = {
  roots: "local_files_roots",
  list: "local_files_list",
  read: "local_files_read",
  search: "local_files_search",
  write: "local_files_write",
  create: "local_files_create",
  delete: "local_files_delete",
} as const;
