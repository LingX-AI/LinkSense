import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { attachmentContentDisposition } from "../../lib/content-disposition.js";
import { AppError } from "../../lib/errors.js";
import type { AppServices } from "../../services.js";

const querySchema = z.strictObject({
  url: z.string().trim().min(1).max(4096).url(),
});

export const externalImageRoutes: FastifyPluginAsync<{
  services: Pick<AppServices, "externalImages">;
}> = async (app, { services }) => {
  app.get(
    "/external-images/download",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.authUser) throw new AppError("AUTH_REQUIRED");
      const { url } = querySchema.parse(request.query);
      const image = await services.externalImages.download(url);
      return reply
        .type(image.mimeType)
        .header("cache-control", "private, no-store")
        .header("content-length", image.sizeBytes)
        .header(
          "content-disposition",
          attachmentContentDisposition(image.filename),
        )
        .header("x-content-type-options", "nosniff")
        .send(image.data);
    },
  );
};
