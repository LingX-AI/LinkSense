import { z } from "zod";

export const taskArtifactFileTypeSchema = z.enum([
  "image",
  "word",
  "excel",
  "powerpoint",
  "html",
  "pdf",
  "archive",
  "text",
  "audio",
  "video",
  "other",
]);

export type TaskArtifactFileType = z.infer<typeof taskArtifactFileTypeSchema>;

export const taskArtifactThumbnail = {
  displaySize: 40,
  imageSize: 80,
  maximumBytes: 10_240,
  cacheMaxAgeSeconds: 300,
} as const;
