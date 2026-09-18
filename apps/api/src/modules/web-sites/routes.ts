import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { webSiteCreateSchema, webSitePublishSchema, webSiteSlugSchema, webSiteStatusSchema, webSiteUpdateSchema } from "@linksense/shared";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import { attachmentContentDisposition } from "../../lib/content-disposition.js";
import { ok } from "../../lib/http.js";
import { errorDetails, normalizeError } from "../../lib/errors.js";
import type { WebSiteService } from "./service.js";
import { resourceContentType } from "./resources.js";
import { escapeHtml, siteNotFoundPage, siteNotFoundPolicy } from "./public-page.js";

const idParams = z.object({ id: z.uuid() });
const cursorSchema = z.string().max(100).transform((value, context) => {
  const [time, id] = value.split("|");
  if (!z.iso.datetime().safeParse(time).success || !z.uuid().safeParse(id).success || !time || !id) {
    context.addIssue({ code: "custom", message: "Invalid cursor" });
    return z.NEVER;
  }
  return { updatedAt: new Date(time), id };
});
export const webSiteRoutes: FastifyPluginAsync<{ service: WebSiteService }> = async (app, { service }) => {
  app.addHook("preHandler", app.authenticate);
  app.get("/", async (request, reply) => {
    const query = z.object({ search: z.string().trim().max(240).optional(), status: webSiteStatusSchema.optional(), conversation_id: z.uuid().optional(), cursor: cursorSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    return reply.send(ok(await service.list((request as AuthenticatedRequest).authUser.id, {
      limit: query.limit,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.conversation_id !== undefined ? { conversationId: query.conversation_id } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    }), request.id));
  });
  app.post("/", async (request, reply) => reply.code(201).send(ok(await service.create((request as AuthenticatedRequest).authUser.id, webSiteCreateSchema.parse(request.body)), request.id)));
  app.patch("/:id", async (request, reply) => reply.send(ok(await service.update((request as AuthenticatedRequest).authUser.id, idParams.parse(request.params).id, webSiteUpdateSchema.parse(request.body)), request.id)));
  app.post("/:id/releases", async (request, reply) => reply.code(201).send(ok(await service.publish((request as AuthenticatedRequest).authUser.id, idParams.parse(request.params).id, webSitePublishSchema.parse(request.body).file_id), request.id)));
  app.get("/:id/sources", async (request, reply) => reply.send(ok(await service.sources((request as AuthenticatedRequest).authUser.id, idParams.parse(request.params).id), request.id)));
  app.get("/:id/download", async (request, reply) => {
    const download = await service.download((request as AuthenticatedRequest).authUser.id, idParams.parse(request.params).id);
    return reply.type("application/zip").header("cache-control", "private, no-store").header("content-disposition", attachmentContentDisposition(download.filename)).send(download.data);
  });
  app.delete("/:id", async (request, reply) => {
    await service.delete((request as AuthenticatedRequest).authUser.id, idParams.parse(request.params).id);
    return reply.code(204).send();
  });
};

export const webSiteSandbox = "allow-scripts allow-modals allow-downloads allow-forms";
export function publishedResourcePolicy(publicBaseUrl: string): string {
  const origin = new URL(publicBaseUrl).origin;
  return [
    `sandbox ${webSiteSandbox}`, "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' https: ${origin}/web/`,
    `style-src 'unsafe-inline' https: ${origin}/web/`,
    `img-src data: blob: https: ${origin}/web/`, `font-src data: https: ${origin}/web/`,
    `media-src blob: https: ${origin}/web/`, `connect-src https: ${origin}/web/`,
  ].join("; ");
}

export const publicWebSiteRoutes: FastifyPluginAsync<{ service: WebSiteService; publicBaseUrl: string }> = async (app, { service, publicBaseUrl }) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.removeHeader("access-control-allow-credentials");
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff").header("x-robots-tag", "noindex, nofollow")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });
  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeError(error);
    const locale = request.headers["accept-language"]?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
    const details = errorDetails(normalized.code, locale);
    if (details.status === 404) {
      void reply.code(404).type("text/html; charset=utf-8")
        .header("content-security-policy", siteNotFoundPolicy)
        .send(siteNotFoundPage(locale));
      return;
    }
    void reply.code(details.status).type("text/html; charset=utf-8")
      .header("content-security-policy", "sandbox; default-src 'none'")
      .send(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${escapeHtml(details.message)}</title><body><p>${escapeHtml(details.message)}</p></body></html>`);
  });
  const entry = async (slug: string): Promise<string> => {
    const page = await service.publicEntry(slug);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe title="${escapeHtml(page.title)}" sandbox="${webSiteSandbox}" referrerpolicy="no-referrer" src="${escapeHtml(page.path)}"></iframe></body></html>`;
  };
  for (const path of ["/:slug", "/:slug/"]) app.get(path, async (request, reply) => {
    const { slug } = z.object({ slug: webSiteSlugSchema }).parse(request.params);
    return reply.type("text/html; charset=utf-8").header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'").send(await entry(slug));
  });
  app.get("/:slug/_releases/:releaseId/*", async (request, reply) => {
    const { slug, releaseId, "*": path } = z.object({ slug: webSiteSlugSchema, releaseId: z.uuid(), "*": z.string().min(1).max(1_000) }).parse(request.params);
    const resource = await service.resource(slug, releaseId, path);
    return reply.type(resourceContentType(resource.mimeType)).header("access-control-allow-origin", "*")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("content-security-policy", publishedResourcePolicy(publicBaseUrl))
      .send(resource.data);
  });
};
