import { z } from "zod";

// Keep direct resource documents and embedded previews on the same opaque-origin boundary.
export const interactiveHtmlPreviewSandbox = [
  "allow-downloads", "allow-forms", "allow-modals", "allow-orientation-lock",
  "allow-pointer-lock", "allow-popups", "allow-popups-to-escape-sandbox",
  "allow-presentation", "allow-scripts", "allow-storage-access-by-user-activation",
  "allow-top-navigation-by-user-activation", "allow-top-navigation-to-custom-protocols",
].join(" ");

export const htmlPreviewSessionIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const htmlPreviewOpenSchema = z.strictObject({ session_id: htmlPreviewSessionIdSchema.optional() });
export const htmlPreviewSourceSchema = z.strictObject({
  session_id: htmlPreviewSessionIdSchema,
  entry_url: z.string().startsWith("/html-preview/").max(1_200),
  html: z.string().max(20 * 1024 * 1024),
  expires_at: z.iso.datetime(),
  missing_resources: z.array(z.string().max(240)).max(50),
});
export type HtmlPreviewSource = z.infer<typeof htmlPreviewSourceSchema>;
