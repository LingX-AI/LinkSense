import type { FastifyInstance } from "fastify";
import { basename } from "node:path";
import { z } from "zod";

import { attachmentContentDisposition } from "../lib/content-disposition.js";
import { LocalFilesystemObjectStorage } from "./object-storage.js";

const ACTIVE_CONTENT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/ecmascript",
  "text/html",
  "text/javascript",
  "text/xml",
]);

const presignedObjectQuerySchema = z.object({
  key: z.string().min(1),
  expires: z.coerce.number().int().safe(),
  signature: z.string().regex(/^[a-f0-9]{64}$/u),
});

export async function registerLocalObjectStorageRoutes(
  app: FastifyInstance,
  storage: LocalFilesystemObjectStorage,
): Promise<void> {
  app.get("/api/v1/development/object-storage", async (request, reply) => {
    const query = presignedObjectQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(404).send();

    try {
      storage.authorizePresignedGet(query.data);
      const [sizeBytes, contentType] = await Promise.all([
        storage.getObjectSize(query.data.key),
        storage.getObjectContentType(query.data.key),
      ]);
      const range = parseRange(request.headers.range, sizeBytes);
      if (range === "invalid") {
        return reply
          .code(416)
          .header("content-range", `bytes */${sizeBytes}`)
          .send();
      }
      const data = range
        ? await storage.getObjectRangeStream(
            query.data.key,
            range.start,
            range.end - range.start + 1,
          )
        : await storage.getObjectStream(query.data.key);
      reply.raw.once("close", () => data.destroy());
      const response = reply
        .code(range ? 206 : 200)
        .type(contentType)
        .header("accept-ranges", "bytes")
        .header("cache-control", "private, no-store")
        .header(
          "content-length",
          range ? range.end - range.start + 1 : sizeBytes,
        )
        .header("x-content-type-options", "nosniff");
      if (isActiveContentType(contentType)) {
        response
          .type("application/octet-stream")
          .header("content-security-policy", "sandbox; default-src 'none'")
          .header(
            "content-disposition",
            attachmentContentDisposition(basename(query.data.key)),
          );
      }
      if (range) {
        response.header(
          "content-range",
          `bytes ${range.start}-${range.end}/${sizeBytes}`,
        );
      }
      return response.send(data);
    } catch {
      return reply.code(404).send();
    }
  });
}

function isActiveContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return ACTIVE_CONTENT_TYPES.has(mediaType);
}

function parseRange(
  value: string | undefined,
  sizeBytes: number,
): { start: number; end: number } | "invalid" | null {
  if (value === undefined) return null;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (!match) return "invalid";
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : sizeBytes - 1;
  const end = Math.min(requestedEnd, sizeBytes - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= sizeBytes
  ) {
    return "invalid";
  }
  return { start, end };
}
