import { z } from "zod";

export const APPLICATION_ICON_MAX_BYTES = 512 * 1024;
export const APPLICATION_ICON_MAX_DIMENSION = 1_024;
export const applicationIconPresets = [
  "bot",
  "search",
  "book-open",
  "graduation-cap",
  "briefcase-business",
  "chart-column",
  "code-xml",
  "pen-line",
  "sparkles",
  "lightbulb",
  "headset",
  "file-text",
  "landmark",
  "scale",
  "heart-pulse",
  "shield-check",
  "workflow",
  "calendar-clock",
  "users",
  "globe-2",
] as const;
export const DEFAULT_APPLICATION_ICON_PRESET = "bot" as const;
export const applicationIconPresetSchema = z.enum(applicationIconPresets);
export const applicationIconMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const applicationIconBase64Schema = z
  .string()
  .min(1)
  .max(Math.ceil((APPLICATION_ICON_MAX_BYTES * 4) / 3) + 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

export const applicationIconInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("preset"),
    preset: applicationIconPresetSchema,
  }),
  z.strictObject({
    type: z.literal("upload"),
    filename: z.string().trim().min(1).max(160),
    mime_type: applicationIconMimeTypeSchema,
    data_base64: applicationIconBase64Schema,
  }),
]);

export const applicationIconSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("preset"),
    preset: applicationIconPresetSchema,
  }),
  z.strictObject({
    type: z.literal("custom"),
    url: z.string().url().max(4_096),
    fallback_preset: applicationIconPresetSchema,
  }),
]);

export type ApplicationIcon = z.infer<typeof applicationIconSchema>;
export type ApplicationIconInput = z.infer<typeof applicationIconInputSchema>;
export type ApplicationIconPreset = z.infer<typeof applicationIconPresetSchema>;
