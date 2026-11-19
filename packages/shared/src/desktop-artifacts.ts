import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";

export const desktopArtifactPath = "/api/v1/desktop/artifacts";
export const desktopArtifactUploadLifetimeMs = 4 * 60_000;
export const desktopArtifactMaxBytes = 5 * 1024 ** 3;

const artifactName = z.string().min(1).max(260)
  .refine(value => value.trim() !== "" && value !== "." && value !== ".." && !/[\p{Cc}/\\]/u.test(value));
export const desktopArtifactPrepareSchema = z.strictObject({
  filename: artifactName,
  display_name: artifactName,
  size_bytes: z.number().int().positive().max(desktopArtifactMaxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  mime_type: z.string().min(1).max(160).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu).optional(),
});
export const desktopArtifactUploadGrantSchema = z.strictObject({
  artifact_id: uuidSchema,
  expires_at: timestampSchema,
  destination: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("api") }),
    z.strictObject({
      kind: z.literal("presigned_post"),
      url: z.url().max(2_048).refine(value => {
        const url = new URL(value);
        return !url.username && !url.password && !value.includes("#") && !value.includes("?") &&
          (url.protocol === "https:" ||
            (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
      }),
      fields: z.record(
        z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u).refine(key => key.toLowerCase() !== "file"),
        z.string().max(4_096).regex(/^[\x20-\x7e]*$/u),
      ).refine(fields => Object.keys(fields).length > 0 && Object.keys(fields).length <= 16),
    }),
  ]),
});
export const desktopArtifactReceiptSchema = z.strictObject({
  success: z.literal(true),
  artifact_id: uuidSchema,
  file_id: uuidSchema,
  display_name: artifactName,
  download_card_event_id: uuidSchema,
});

export type DesktopArtifactPrepare = z.infer<typeof desktopArtifactPrepareSchema>;
export type DesktopArtifactUploadGrant = z.infer<typeof desktopArtifactUploadGrantSchema>;
export type DesktopArtifactReceipt = z.infer<typeof desktopArtifactReceiptSchema>;
