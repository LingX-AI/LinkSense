import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { runtimeServiceSessionHeader, webSiteCreateSchema, webSiteCursorSchema, webSitePublishSchema, webSiteSlugSchema, webSiteStatusSchema, webSiteToolRequestSchema, webSiteUpdateSchema } from "@linksense/shared";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import { attachmentContentDisposition } from "../../lib/content-disposition.js";
import { ok } from "../../lib/http.js";
import { AppError, errorDetails, normalizeError } from "../../lib/errors.js";
import { resolveLocale } from "../../lib/locale.js";
import { parseWebSiteCursor, withUrl, type WebSiteService } from "./service.js";
import { resourceContentType } from "./resources.js";
import { escapeHtml, siteNotFoundPage, siteNotFoundPolicy } from "./public-page.js";
import { hasSiteAccess, safeAccessNext, siteAccessCookie, sitePasscodePage } from "./access.js";
import { verifyPassword } from "../../lib/password.js";

const idParams = z.object({ id: z.uuid() });
export const webSiteRoutes: FastifyPluginAsync<{ service: WebSiteService; publicBaseUrl: string }> = async (app, { service, publicBaseUrl }) => {
  app.addHook("preHandler", app.authenticate);
  app.get("/by-conversation/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return reply.header("cache-control", "private, no-store").send(ok(
      await service.conversationDeliveries((request as AuthenticatedRequest).authUser.id, id, publicBaseUrl),
      request.id,
    ));
  });
  app.get("/", async (request, reply) => {
    const query = z.object({ search: z.string().trim().max(240).optional(), status: webSiteStatusSchema.optional(), conversation_id: z.uuid().optional(), origin_file_id: z.uuid().optional(), cursor: webSiteCursorSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const page = await service.list((request as AuthenticatedRequest).authUser.id, {
      limit: query.limit,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.conversation_id !== undefined ? { conversationId: query.conversation_id } : {}),
      ...(query.origin_file_id !== undefined ? { originFileId: query.origin_file_id } : {}),
      ...(query.cursor !== undefined ? { cursor: parseWebSiteCursor(query.cursor) } : {}),
    });
    return reply.send(ok({ ...page, items: page.items.map(site => withUrl(site, publicBaseUrl)) }, request.id));
  });
  app.post("/", async (request, reply) => reply.code(201).send(ok(withUrl(await service.create((request as AuthenticatedRequest).authUser.id, webSiteCreateSchema.parse(request.body)), publicBaseUrl), request.id)));
  app.patch("/:id", async (request, reply) => reply.send(ok(withUrl(await service.update((request as AuthenticatedRequest).authUser.id, idParams.parse(request.params).id, webSiteUpdateSchema.parse(request.body)), publicBaseUrl), request.id)));
  app.post("/:id/releases", async (request, reply) => {
    const input = webSitePublishSchema.parse(request.body);
    return reply.code(201).send(ok(withUrl(await service.publish((request as AuthenticatedRequest).authUser.id,
      idParams.parse(request.params).id, input.file_id, input.backend_id), publicBaseUrl), request.id));
  });
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

export const internalWebSiteRoutes: FastifyPluginAsync<{ service: WebSiteService; sharedSecret: string; publicBaseUrl: string }> = async (app, { service, sharedSecret, publicBaseUrl }) => {
  app.addHook("onRequest", async (request, reply) => {
    const provided = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(sharedSecret);
    if (!expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    if (request.headers[runtimeServiceSessionHeader] !== undefined) throw new AppError("FORBIDDEN");
  });
  app.post("/", async request => {
    const owner = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const body = z.strictObject({ conversationId: z.uuid(), turnId: z.uuid(), request: webSiteToolRequestSchema }).parse(request.body);
    return service.toolForOwner(owner, body.conversationId, body.turnId, body.request, publicBaseUrl);
  });
};

export const webSiteSandbox = "allow-scripts allow-modals allow-downloads allow-forms";
export function publishedResourcePolicy(publicBaseUrl: string, requestOrigin?: string, analyticsOrigin?: string): string {
  const origins = new Set([new URL(publicBaseUrl).origin]);
  if (requestOrigin) {
    try { origins.add(new URL(requestOrigin).origin); } catch { /* Keep the configured origin when the request host is malformed. */ }
  }
  const webSources = [...origins].map(origin => `${origin}/web/`).join(" ");
  // The tracker is a cross-origin script that reports over fetch; the configured
  // analytics origin must be allowed even when the public site is plain HTTP.
  const analytics = analyticsOrigin ? [analyticsOrigin] : [];
  return [
    `sandbox ${webSiteSandbox}`, "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' https: ${webSources} ${[...origins].map(origin => `${origin}/app/_sdk/v1.js`).join(" ")} ${analytics.join(" ")}`,
    `style-src 'unsafe-inline' https: ${webSources}`,
    `img-src data: blob: https: ${webSources}`, `font-src data: https: ${webSources}`,
    `media-src blob: https: ${webSources}`, `connect-src https: ${webSources} ${analytics.join(" ")}`,
  ].join("; ");
}

export const publicWebSiteRoutes: FastifyPluginAsync<{ service: WebSiteService; publicBaseUrl: string; accessSecret: string; analyticsBaseUrl?: string }> = async (app, { service, publicBaseUrl, accessSecret, analyticsBaseUrl }) => {
  const analyticsOrigin = analyticsBaseUrl ? new URL(analyticsBaseUrl).origin : undefined;
  // The passcode form posts urlencoded, which no other route parses.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4_096 },
    (_request, body, done) => done(null, body));
  const promptPasscode = (request: FastifyRequest, reply: FastifyReply, address: string, incorrect = false) => {
    const next = safeAccessNext(request.raw.url ?? null);
    const page = sitePasscodePage(resolveLocale(request), {
      action: `/web/${encodeURIComponent(address)}/unlock`,
      ...(next !== undefined ? { next } : {}),
      incorrect,
    });
    return reply.code(401).type("text/html; charset=utf-8")
      .header("content-security-policy", page.policy)
      .header("cache-control", "no-store").header("x-robots-tag", "noindex, nofollow")
      .send(page.html);
  };
  // Run after the host's onSend hook, including for nested release documents.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.removeHeader("x-frame-options");
    return payload;
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply.removeHeader("access-control-allow-credentials");
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff").header("x-robots-tag", "noindex, nofollow")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });
  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeError(error);
    const locale = resolveLocale(request);
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
  const entry = (page: Awaited<ReturnType<WebSiteService["publicEntry"]>>): string => {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe title="${escapeHtml(page.title)}" sandbox="${webSiteSandbox}" referrerpolicy="no-referrer" src="${escapeHtml(page.path)}"></iframe></body></html>`;
  };
  for (const path of ["/:slug", "/:slug/"]) app.get(path, async (request, reply) => {
    const { slug } = z.object({ slug: webSiteSlugSchema }).parse(request.params);
    if (!hasSiteAccess(request.headers.cookie, accessSecret, await service.publicAccess(slug))) return promptPasscode(request, reply, slug);
    const page = await service.publicEntry(slug);
    if (page.url) return reply.redirect(page.url);
    return reply.type("text/html; charset=utf-8").header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'").send(entry(page));
  });
  app.post("/:address/unlock", async (request, reply) => {
    const { address } = z.object({ address: z.string().trim().min(1).max(128) }).parse(request.params);
    const form = new URLSearchParams(typeof request.body === "string" ? request.body : "");
    const next = safeAccessNext(form.get("next"));
    const access = await service.publicAccess(address);
    if (!access.passcodeHash) return reply.redirect(next ?? `/web/${encodeURIComponent(access.slug)}`, 303);
    if (!(await verifyPassword(access.passcodeHash, (form.get("passcode") ?? "").slice(0, 128)))) {
      return promptPasscode(request, reply, address, true);
    }
    reply.header("set-cookie", siteAccessCookie(accessSecret, { id: access.id, passcodeHash: access.passcodeHash }));
    return reply.redirect(next ?? `/web/${encodeURIComponent(access.slug)}`, 303);
  });
  app.get("/:slug/_releases/:releaseId/*", async (request, reply) => {
    const { slug, releaseId, "*": path } = z.object({ slug: webSiteSlugSchema, releaseId: z.uuid(), "*": z.string().min(1).max(1_000) }).parse(request.params);
    if (!hasSiteAccess(request.headers.cookie, accessSecret, await service.publicAccess(slug))) return promptPasscode(request, reply, slug);
    const resource = await service.resource(slug, releaseId, path);
    return reply.type(resourceContentType(resource.mimeType)).header("access-control-allow-origin", "*")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("content-security-policy", publishedResourcePolicy(publicBaseUrl, `${request.protocol}://${request.host}`, analyticsOrigin))
      .send(resource.data);
  });
};
