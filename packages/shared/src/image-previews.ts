import { z } from "zod";

export const imagePreviewMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const MAX_IMAGE_PREVIEW_BYTES = 25 * 1024 * 1024;

export const imagePreviewRegistrationSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.string().min(1).max(240),
  workspaceRelativePath: z.string().min(1).max(2_000),
  displayName: z.string().min(1).max(260),
  mimeType: imagePreviewMimeTypeSchema,
});

export const imagePreviewRegistrationResultSchema = z.strictObject({
  file_id: z.uuid(),
});

export type ImagePreviewRegistration = z.infer<
  typeof imagePreviewRegistrationSchema
>;
