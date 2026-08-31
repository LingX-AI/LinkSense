import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  attachmentContentDisposition,
  inlineContentDisposition,
} from "../../lib/content-disposition.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { AppServices } from "../../services.js";
import {
  parseArtifactPreviewMediaRange,
  parseTaskArtifactCursor,
} from "./service.js";

const conversationParams = z.strictObject({ id: z.string().uuid() });
const fileParams = z.strictObject({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});
export const fileRoutes: FastifyPluginAsync<{ services: AppServices }> = async (
  app,
  { services },
) => {
  const attachmentDeleteBody = z.strictObject({
    file_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(services.config?.upload.maxFilesPerConversation ?? 100),
  });
  app.get(
    "/artifacts",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const query = z
        .strictObject({
          search: z.string().trim().max(240).optional(),
          cursor: z
            .string()
            .trim()
            .min(1)
            .max(320)
            .refine(
              (value) => parseTaskArtifactCursor(value) !== null,
              "invalid_cursor",
            )
            .optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
      return reply.send(
        ok(
          await services.files.listTaskArtifacts(user.id, {
            ...(query.search ? { search: query.search } : {}),
            ...(query.cursor ? { cursor: query.cursor } : {}),
            limit: query.limit,
          }),
          request.id,
        ),
      );
    },
  );

  app.post(
    "/:id/attachments",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id } = conversationParams.parse(request.params);
      const part = await request.file({
        limits: { fileSize: services.config.upload.maxFileSizeBytes, files: 1 },
      });
      if (!part) throw new AppError("ATTACHMENT_UPLOAD_INVALID");
      const data = await part.toBuffer();
      const result = await services.files.uploadAttachment(
        user.id,
        id,
        {
          filename: part.filename,
          reportedMimeType: part.mimetype,
          data,
        },
        auditContext(request),
      );
      return reply.code(201).send(ok(result, request.id));
    },
  );

  app.delete(
    "/:id/attachments",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id } = conversationParams.parse(request.params);
      const { file_ids: fileIds } = attachmentDeleteBody.parse(request.body);
      await services.files.deleteDraftAttachments(
        user.id,
        id,
        fileIds,
        auditContext(request),
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    "/:id/attachments/:fileId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      await services.files.deleteDraftAttachment(
        user.id,
        id,
        fileId,
        auditContext(request),
      );
      return reply.code(204).send();
    },
  );

  app.get(
    "/:id/attachments/:fileId/content",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      const preview = await services.files.readAttachmentPreviewContent(
        user.id,
        id,
        fileId,
      );
      return reply
        .type(preview.mimeType)
        .header("cache-control", "private, no-store")
        .header("content-length", preview.sizeBytes)
        .header(
          "content-security-policy",
          "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
        )
        .header(
          "content-disposition",
          inlineContentDisposition(preview.filename),
        )
        .header("x-content-type-options", "nosniff")
        .send(preview.data);
    },
  );

  app.post(
    "/:id/files/:fileId/preview",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      const result = await services.files.createArtifactPreviewLink(
        user.id,
        id,
        fileId,
      );
      return reply.send(ok(result, request.id));
    },
  );

  app.get(
    "/:id/files/:fileId/content",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      const previewDocument = await services.files.readArtifactPreviewDocument(
        user.id,
        id,
        fileId,
      );
      reply.raw.once("close", () => previewDocument.data.destroy());
      return reply
        .type(previewDocument.mimeType)
        .header("cache-control", "private, no-store")
        .header("content-length", previewDocument.sizeBytes)
        .header(
          "content-security-policy",
          "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
        )
        .header(
          "content-disposition",
          inlineContentDisposition(previewDocument.filename),
        )
        .header("x-content-type-options", "nosniff")
        .send(previewDocument.data);
    },
  );

  app.get(
    "/:id/files/:fileId/media",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      const media = await services.files.readArtifactPreviewMedia(
        user.id,
        id,
        fileId,
        parseArtifactPreviewMediaRange(request.headers.range),
      );
      reply.raw.once("close", () => media.data.destroy());

      const contentLength = media.range
        ? media.range.end - media.range.start + 1
        : media.sizeBytes;
      const response = reply
        .code(media.range ? 206 : 200)
        .type(media.mimeType)
        .header("accept-ranges", "bytes")
        .header("cache-control", "private, no-store")
        .header("content-length", contentLength)
        .header("content-disposition", inlineContentDisposition(media.filename))
        .header("x-content-type-options", "nosniff");
      if (media.range) {
        response.header(
          "content-range",
          `bytes ${media.range.start}-${media.range.end}/${media.sizeBytes}`,
        );
      }
      return response.send(media.data);
    },
  );

  app.post(
    "/:id/files/:fileId/download",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      const result = await services.files.createDownloadLink(
        user.id,
        id,
        fileId,
        {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
      );
      return reply.send(ok(result, request.id));
    },
  );

  app.get(
    "/:id/files/:fileId/download",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, fileId } = fileParams.parse(request.params);
      const artifact = await services.files.readArtifactDownload(
        user.id,
        id,
        fileId,
        auditContext(request),
      );
      reply.raw.once("close", () => artifact.data.destroy());
      return reply
        .type(artifact.mimeType)
        .header("cache-control", "private, no-store")
        .header("content-length", artifact.sizeBytes)
        .header(
          "content-disposition",
          attachmentContentDisposition(artifact.filename),
        )
        .header("x-content-type-options", "nosniff")
        .send(artifact.data);
    },
  );
};

function auditContext(request: {
  ip: string;
  headers: { "user-agent"?: string | undefined };
}) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
