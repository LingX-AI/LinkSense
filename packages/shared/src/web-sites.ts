import { z } from "zod";

export const webSiteSlugSchema = z.string().trim().toLowerCase().min(3).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const webSiteStatusSchema = z.enum(["published", "disabled"]);
export const webSiteCreateSchema = z.strictObject({
  conversation_id: z.uuid(),
  file_id: z.uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(1_000).default(""),
  slug: webSiteSlugSchema.optional(),
});
export const webSiteUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(1_000).optional(),
  slug: webSiteSlugSchema.optional(),
  status: webSiteStatusSchema.optional(),
}).refine(value => Object.keys(value).length > 0);
export const webSitePublishSchema = z.strictObject({ file_id: z.uuid() });
export const webSiteSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  slug: webSiteSlugSchema,
  status: webSiteStatusSchema,
  url_path: z.string(),
  conversation_id: z.uuid().nullable(),
  source_task_title: z.string(),
  source_file_id: z.uuid(),
  release_id: z.uuid(),
  file_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  published_at: z.iso.datetime(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const webSitePageSchema = z.object({
  items: z.array(webSiteSchema),
  next_cursor: z.string().nullable(),
});
export const webSiteSourceSchema = z.object({
  id: z.uuid(), filename: z.string(), created_at: z.iso.datetime(),
});
export const webSiteSourcesSchema = z.array(webSiteSourceSchema);
export type WebSite = z.infer<typeof webSiteSchema>;
export type WebSiteCreate = z.infer<typeof webSiteCreateSchema>;
export type WebSiteUpdate = z.infer<typeof webSiteUpdateSchema>;
export type WebSiteStatus = z.infer<typeof webSiteStatusSchema>;
export type WebSiteSource = z.infer<typeof webSiteSourceSchema>;

export const webBundleLimits = { files: 500, fileBytes: 20 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 } as const;
export const webBundlePathSchema = z.string().min(1).max(1_000).refine(value =>
  !value.startsWith("/") && !value.includes("\\") && !/[\u0000-\u001f\u007f?#%]/u.test(value) &&
  value.split("/").every(part => part.length > 0 && !part.startsWith(".") && part !== "node_modules"),
);
export const webBundleManifestSchema = z.strictObject({
  entry_path: webBundlePathSchema,
  files: z.array(z.strictObject({
    path: webBundlePathSchema,
    object_key: z.string().min(1).max(2_000),
    mime_type: z.string().min(1).max(160),
    size_bytes: z.number().int().nonnegative().max(webBundleLimits.fileBytes),
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })).min(1).max(webBundleLimits.files),
}).superRefine((value, context) => {
  const paths = new Set(value.files.map(file => file.path));
  if (paths.size !== value.files.length || !paths.has(value.entry_path) ||
      value.files.reduce((sum, file) => sum + file.size_bytes, 0) > webBundleLimits.totalBytes) {
    context.addIssue({ code: "custom", message: "Invalid website bundle" });
  }
});
export type WebBundleManifest = z.infer<typeof webBundleManifestSchema>;
