import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { htmlPreviewOpenSchema, htmlPreviewShellDocument, interactiveHtmlPreviewSandbox } from "@linksense/shared";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import { ok } from "../../lib/http.js";
import { errorDetails, normalizeError } from "../../lib/errors.js";
import { resolveLocale } from "../../lib/locale.js";
import { resourceContentType } from "../web-sites/resources.js";
import type { HtmlPreviewService } from "./service.js";

export const htmlPreviewRoutes: FastifyPluginAsync<{ service: HtmlPreviewService }> = async (app, { service }) => {
  app.post("/:id/files/:fileId/html-preview", { preHandler: app.authenticate }, async (request, reply) => {
    const { id, fileId } = z.object({ id: z.uuid(), fileId: z.uuid() }).parse(request.params);
    const input = htmlPreviewOpenSchema.parse(request.body ?? {});
    const result = await service.open((request as AuthenticatedRequest).authUser.id, id, fileId, input.session_id);
    return reply.header("cache-control", "private, no-store").send(ok(result, request.id));
  });
};

export const htmlPreviewResourceRoutes: FastifyPluginAsync<{ service: HtmlPreviewService }> = async (app, { service }) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.removeHeader("access-control-allow-credentials");
    reply.header("cache-control", "private, no-store").header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff").header("x-robots-tag", "noindex, nofollow")
      .header("access-control-allow-origin", "*").header("cross-origin-resource-policy", "cross-origin")
      .header("content-security-policy", `sandbox ${interactiveHtmlPreviewSandbox}; base-uri 'none'`)
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });
  app.setErrorHandler((error, request, reply) => {
    const details = errorDetails(normalizeError(error).code, resolveLocale(request));
    void reply.code(details.status).type("text/plain; charset=utf-8").send(details.message);
  });
  app.get("/:session/*", async (request, reply) => {
    const { session, "*": path } = z.object({ session: z.string().max(128), "*": z.string().min(1).max(1_000) }).parse(request.params);
    const resource = await service.resource(session, path);
    const query = z.object({ previewId: z.string().min(1).max(256).optional() }).parse(request.query);
    return reply.type(resourceContentType(resource.mimeType)).send(resource.mimeType === "text/html" && query.previewId ? htmlPreviewShellDocument : resource.data);
  });
};
