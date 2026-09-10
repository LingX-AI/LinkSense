import {
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_SIZE_BYTES,
} from "@linksense/shared";
import type {
  FastifyPluginAsync,
  FastifyInstance,
  FastifyRequest,
} from "fastify";
import { z } from "zod";

import { inlineContentDisposition } from "../../lib/content-disposition.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { AppServices } from "../../services.js";
import type { FeedbackActor, FeedbackUpload } from "./types.js";

const imageParamsSchema = z.strictObject({
  feedbackId: z.string().uuid(),
  imageId: z.string().uuid(),
});

const feedbackParamsSchema = imageParamsSchema.pick({ feedbackId: true });

export const feedbackRoutes: FastifyPluginAsync<{
  services: AppServices;
}> = async (app, { services }) => {
  app.addHook("preHandler", app.authenticate);
  registerReadRoutes(app, services, false);
  app.post("/", async (request, reply) => {
    const { content, images } = await readSubmission(request);
    const actor = actorFromRequest(request as AuthenticatedRequest);
    const result = await services.feedback.submit(
      actor,
      { content, images },
      auditContext(request),
    );
    return reply.code(201).send(ok(result, request.id));
  });
};

export const adminFeedbackRoutes: FastifyPluginAsync<{
  services: AppServices;
}> = async (app, { services }) => {
  app.addHook("preHandler", app.requireAdmin);
  registerReadRoutes(app, services, true);
  app.post("/:feedbackId/replies", async (request, reply) => {
    const { feedbackId } = feedbackParamsSchema.parse(request.params);
    const input = await readSubmission(request);
    const result = await services.feedback.replyForAdmin(
      actorFromRequest(request as AuthenticatedRequest),
      feedbackId,
      input,
      auditContext(request),
    );
    return reply.code(201).send(ok(result, request.id));
  });

  app.delete("/:feedbackId", async (request, reply) => {
    const actor = actorFromRequest(request as AuthenticatedRequest);
    const { feedbackId } = feedbackParamsSchema.parse(request.params);
    await services.feedback.deleteForAdmin(
      actor,
      feedbackId,
      auditContext(request),
    );
    return reply.code(204).send();
  });
};

function actorFromRequest(request: AuthenticatedRequest): FeedbackActor {
  return {
    id: request.authUser.id,
    name: request.authUser.name,
    email: request.authUser.email,
    role: request.authUser.role,
    status: request.authUser.status,
  };
}

function auditContext(request: {
  ip: string;
  headers: { "user-agent"?: string | undefined };
}) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

async function readSubmission(
  request: FastifyRequest,
): Promise<{ content: string | undefined; images: FeedbackUpload[] }> {
  if (!request.isMultipart()) {
    throw new AppError("FEEDBACK_SUBMISSION_INVALID");
  }
  let content: string | undefined;
  const images: FeedbackUpload[] = [];
  try {
    const parts = request.parts({
      limits: {
        files: FEEDBACK_MAX_IMAGES,
        fileSize: FEEDBACK_MAX_IMAGE_SIZE_BYTES,
        fields: 1,
        parts: FEEDBACK_MAX_IMAGES + 1,
      },
    });
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "images") {
          part.file.resume();
          throw new AppError("FEEDBACK_SUBMISSION_INVALID");
        }
        images.push({
          filename: part.filename,
          declaredMimeType: part.mimetype,
          bytes: await part.toBuffer(),
        });
      } else {
        if (part.fieldname !== "content" || content !== undefined) {
          throw new AppError("FEEDBACK_SUBMISSION_INVALID");
        }
        content = String(part.value);
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("FEEDBACK_SUBMISSION_INVALID");
  }
  return { content, images };
}

function registerReadRoutes(
  app: FastifyInstance,
  services: AppServices,
  admin: boolean,
): void {
  app.get("/", async (request, reply) => {
    const actor = actorFromRequest(request as AuthenticatedRequest);
    const page = admin
      ? await services.feedback.listForAdmin(actor, request.query)
      : await services.feedback.listForUser(actor, request.query);
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(page, request.id));
  });
  app.get("/:feedbackId", async (request, reply) => {
    const { feedbackId } = feedbackParamsSchema.parse(request.params);
    const details = await services.feedback.details(
      actorFromRequest(request as AuthenticatedRequest),
      feedbackId,
      admin,
    );
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(details, request.id));
  });
  for (const path of [
    "/:feedbackId/images/:imageId",
    "/:feedbackId/replies/:replyId/images/:imageId",
  ]) {
    app.get(path, async (request, reply) => {
      const actor = actorFromRequest(request as AuthenticatedRequest);
      const { feedbackId, imageId, replyId } = imageParamsSchema
        .extend({ replyId: z.string().uuid().optional() })
        .parse(request.params);
      const image = admin
        ? await services.feedback.readImageForAdmin(
            actor,
            feedbackId,
            imageId,
            replyId,
          )
        : await services.feedback.readImageForUser(
            actor,
            feedbackId,
            imageId,
            replyId,
          );
      reply.raw.once("close", () => image.data.destroy());
      return reply
        .type(image.mimeType)
        .header("cache-control", "private, no-store")
        .header("content-length", image.sizeBytes)
        .header("content-disposition", inlineContentDisposition(image.filename))
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("x-content-type-options", "nosniff")
        .send(image.data);
    });
  }
}
