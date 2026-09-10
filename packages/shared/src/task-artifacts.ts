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
