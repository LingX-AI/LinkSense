import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { webApplicationPath, webSiteBackendHostSchema, webSiteBackendIdSchema } from "@linksense/shared";
import type { AppConfig } from "../../config.js";
import { randomToken } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { containsControlCharacter } from "../../lib/text.js";
import { escapeHtml } from "../web-sites/public-page.js";
import type { WebSiteService } from "../web-sites/service.js";
import { webSiteSandbox } from "../web-sites/routes.js";
import { publicFunctionExecution, readRequest, readResponse, validatePublicAppUrl } from "./gateway.js";
import type { WebSiteBackendService } from "./service.js";
import { publicAppSdkScript, publicAppShellScript } from "./sandbox-runtime.js";
import { visitorSessionSeconds, type WebSiteVisitorSessions } from "./visitor-sessions.js";

const rpcSchema = z.strictObject({
  path: z.string().min(1).max(4096).regex(/^\/[a-zA-Z0-9]/u),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  body: z.record(z.string(), z.json()).optional(),
});
// The standalone shell loads no console bundle; keep the static-share viewport CSS.
const style = "html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}";
const hash = (value: string): string => createHash("sha256").update(value).digest("base64");
const safeJson = (value: unknown): string => JSON.stringify(value).replaceAll("<", "\\u003c");
const accountActions = new Set([
  "GET /account", "POST /account", "POST /account/sessions/email",
  "POST /account/sessions/anonymous", "DELETE /account/sessions/current",
  "PATCH /account/name", "PATCH /account/email", "PATCH /account/password", "PATCH /account/prefs",
]);
// Appwrite reads transport-routing parameters from the body as well as the URL.
const appwriteRoutingFields = new Set([
  "project", "mode", "key", "session", "jwt", "token", "appwrite-hostname",
  "impersonateuserid", "impersonateemail", "impersonatephone",
]);
const hasRoutingField = (keys: Iterable<string>): boolean => {
  for (const key of keys) if (appwriteRoutingFields.has(key.trim().toLowerCase().split("[", 1)[0] ?? "")) return true;
  return false;
};

export function registerPublicAppGateway(
  app: FastifyInstance, backends: WebSiteBackendService, sites: Pick<WebSiteService, "applicationEntry" | "publicApplication">,
  sessions: WebSiteVisitorSessions, config: Pick<AppConfig, "publicBaseUrl">,
): void {
  const publicUrl = new URL(config.publicBaseUrl);
  const cookieName = `${publicUrl.protocol === "https:" ? "__Host-" : ""}linksense-app-visitor`;
  const visitorOf = (request: FastifyRequest): string | undefined => {
    const values = (request.headers.cookie ?? "").split(";").map(part => part.trim())
      .filter(part => part.startsWith(`${cookieName}=`)).map(part => part.slice(cookieName.length + 1));
    return values.length === 1 && /^[a-zA-Z0-9_-]{43}$/u.test(values[0] ?? "") ? values[0] : undefined;
  };
  app.addHook("onRequest", async (request, reply) => {
    const raw = request.raw.url ?? "/";
    if (!raw.startsWith("/app/")) return;
    if (request.headers.host !== publicUrl.host) throw new AppError("WEB_SITE_NOT_FOUND");
    if (raw === "/app/_sdk/v1.js" && ["GET", "HEAD"].includes(request.method)) {
      return reply.header("access-control-allow-origin", "*").type("application/javascript; charset=utf-8").send(publicAppSdkScript);
    }
    const canonical = /^\/app\/s\/([^/?]+)(\/_rpc(?:\/upload\/[^/?]+\/[^/?]+)?|\/)?(?:\?[^#]*)?$/u.exec(raw);
    let entry: Awaited<ReturnType<WebSiteService["publicApplication"]>> | undefined;
    let backendId: string;
    let address: string;
    let suffix: string;
    let retiredAlias = false;
    let binding: Awaited<ReturnType<typeof backends.store.publicBinding>> | undefined;
    if (canonical) {
      const id = z.uuid().safeParse(canonical[1]);
      if (!id.success) throw new AppError("WEB_SITE_NOT_FOUND");
      address = webApplicationPath(id.data);
      suffix = canonical[2] ?? "";
      if (suffix && suffix !== "/") {
        // RPC needs live authorization, not the immutable frontend manifest.
        binding = await backends.store.publicBindingForSite(id.data);
        backendId = binding.backend.id;
      } else {
        entry = await sites.publicApplication(id.data);
        if (!entry.backendId) {
          if (!["GET", "HEAD"].includes(request.method)) throw new AppError("WEB_SITE_NOT_FOUND");
          reply.header("content-security-policy", [
            "default-src 'none'", `style-src 'sha256-${hash(style)}'`, `frame-src ${publicUrl.origin}${entry.releasePath}`,
            "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
          ].join("; "));
          return reply.type("text/html; charset=utf-8").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(entry.title)}</title><style>${style}</style></head><body><iframe title="${escapeHtml(entry.title)}" sandbox="${webSiteSandbox}" referrerpolicy="no-referrer" src="${escapeHtml(entry.path)}"></iframe></body></html>`);
        }
        backendId = entry.backendId;
      }
    } else {
      const match = /^\/app\/([^/?]+)(\/_rpc(?:\/upload\/[^/?]+\/[^/?]+)?|\/)?(?:\?[^#]*)?$/u.exec(raw);
      const label = webSiteBackendHostSchema.safeParse(match?.[1]);
      if (!label.success) throw new AppError("WEB_SITE_NOT_FOUND");
      const resolved = await backends.store.byHostLabel(label.data) ?? await backends.store.findByHostLabel(label.data);
      if (!resolved) throw new AppError("WEB_SITE_NOT_FOUND");
      backendId = resolved.id;
      address = `/app/${label.data}`;
      suffix = match?.[2] ?? "";
      const current = await backends.store.findById(backendId);
      retiredAlias = (current?.hostLabel ?? current?.id) !== label.data;
    }
    const { backend, siteId } = binding ?? await backends.store.publicBinding(backendId);
    if (canonical && siteId !== canonical[1]) throw new AppError("WEB_SITE_NOT_FOUND");
    if (backend.runtimeMode !== "sandbox") {
      if (canonical && (!suffix || suffix === "/") && ["GET", "HEAD"].includes(request.method) && entry?.url)
        return reply.redirect(entry.url);
      throw new AppError("WEB_SITE_NOT_FOUND");
    }
    const endpoint = `${address}/_rpc`;
    if (!suffix || suffix === "/") {
      if (!["GET", "HEAD"].includes(request.method)) throw new AppError("WEB_SITE_NOT_FOUND");
      // A shell embedded by a hostile app must never bootstrap another app's session.
      if (request.headers["sec-fetch-dest"] && request.headers["sec-fetch-dest"] !== "document") throw new AppError("FORBIDDEN");
      if (retiredAlias) return reply.redirect(`${webApplicationPath(siteId)}${new URL(raw, publicUrl).search}`);
      const visitor = visitorOf(request) ?? randomToken(32);
      if (!visitorOf(request)) reply.header("set-cookie", `${cookieName}=${visitor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${visitorSessionSeconds}${publicUrl.protocol === "https:" ? "; Secure" : ""}`);
      entry ??= await sites.applicationEntry(backend.ownerId, siteId);
      await backends.store.publicBinding(backend.id);
      const packet = { path: entry.path, endpoint,
        capability: sessions.capability(backend.id, siteId, visitor) };
      reply.header("content-security-policy", [
        "default-src 'none'", `script-src 'sha256-${hash(publicAppShellScript)}'`,
        // The frame's WindowProxy survives navigation; only this release may load into it.
        `style-src 'sha256-${hash(style)}'`, `frame-src ${publicUrl.origin}${entry.releasePath}`, "connect-src 'self'",
        "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
      ].join("; "));
      return reply.type("text/html; charset=utf-8").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(entry.title)}</title><style>${style}</style></head><body><iframe title="${escapeHtml(entry.title)}" sandbox="allow-scripts allow-downloads allow-forms" referrerpolicy="no-referrer"></iframe><script type="application/json" id="app-config">${safeJson(packet)}</script><script>${publicAppShellScript}</script></body></html>`);
    }
    const visitor = visitorOf(request);
    if (request.method !== "POST" || !visitor || request.headers.origin !== publicUrl.origin ||
        (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")) throw new AppError("FORBIDDEN");
    sessions.authorize(request.headers["x-linksense-app-capability"], backend.id, siteId, visitor);
    await sessions.admit(backend.id, request.ip);
    const previous = await sessions.read(backend.id, visitor);
    const headers = new Headers({ "x-appwrite-project": backend.projectId, origin: publicUrl.origin, "x-forwarded-for": request.ip });
    if (previous.cookie) headers.set("cookie", previous.cookie);
    let url: URL, method: string, body: BodyInit | undefined;
    let upload: { data: Buffer; fileId: string; name: string; mime: string } | undefined;
    if (suffix.startsWith("/_rpc/upload/")) {
      const parts = suffix.split("/");
      let bucket: string, fileId: string, name: string;
      try {
        bucket = webSiteBackendIdSchema.parse(decodeURIComponent(parts[3] ?? ""));
        const rawId = decodeURIComponent(parts[4] ?? "");
        fileId = rawId === "unique()" ? rawId : webSiteBackendIdSchema.parse(rawId);
        name = z.string().min(1).max(240).refine(value => !containsControlCharacter(value) && !/[/\\]/u.test(value))
          .parse(decodeURIComponent(String(request.headers["x-linksense-file-name"] ?? "")));
      } catch { throw new AppError("VALIDATION_ERROR"); }
      const data = await readRequest(request);
      if (data.length > 20 * 1024 * 1024) throw new AppError("FILE_LIMIT_EXCEEDED");
      const mime = z.string().max(128).regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/u)
        .parse(request.headers["x-linksense-file-type"] ?? "application/octet-stream");
      if (!data.length) throw new AppError("VALIDATION_ERROR");
      upload = { data, fileId, name, mime };
      url = new URL(`/appwrite/v1/storage/buckets/${bucket}/files`, publicUrl);
      method = "POST";
    } else {
      if (!request.headers["content-type"]?.startsWith("application/json")) throw new AppError("VALIDATION_ERROR");
      const rawBody = await readRequest(request);
      if (rawBody.length > 2 * 1024 * 1024) throw new AppError("FILE_LIMIT_EXCEEDED");
      let value: unknown;
      try { value = JSON.parse(rawBody.toString("utf8")); } catch { throw new AppError("VALIDATION_ERROR"); }
      const input = rpcSchema.parse(value);
      const [path = ""] = input.path.split("?", 1);
      if (containsControlCharacter(input.path) || /[%\\]|\/\.{1,2}(?:\/|$)/u.test(path) ||
          input.path.includes("#")) throw new AppError("FORBIDDEN");
      url = new URL(`/appwrite/v1${input.path}`, publicUrl);
      if (hasRoutingField(url.searchParams.keys()) || input.body && hasRoutingField(Object.keys(input.body)))
        throw new AppError("FORBIDDEN");
      method = input.method;
      if (url.pathname.startsWith("/appwrite/v1/account") && !accountActions.has(`${method} ${url.pathname.slice("/appwrite/v1".length)}`)) throw new AppError("FORBIDDEN");
      if (method === "GET" && input.body !== undefined) throw new AppError("VALIDATION_ERROR");
      body = input.body === undefined ? undefined : JSON.stringify(input.body);
      if (method === "POST" && /^\/appwrite\/v1\/functions\/[^/]+\/executions$/u.test(url.pathname))
        body = publicFunctionExecution(input.body ?? {}, url);
      if (body) headers.set("content-type", "application/json");
    }
    validatePublicAppUrl(url, backend.projectId);
    const path = `${url.pathname.slice("/appwrite/v1".length)}${url.search}`;
    const response = upload ? await forwardVisitorUpload(backends, backend.id, path, headers, upload)
      : await backends.requiredClient().forward(path, { method, headers, ...(body !== undefined ? { body } : {}) });
    return sendVisitorResponse(reply, response, method, url, backend.id, backend.projectId, visitor, previous, sessions, backends);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (!(request.raw.url ?? "").startsWith("/app/")) return payload;
    reply.removeHeader("access-control-allow-credentials");
    if (request.raw.url !== "/app/_sdk/v1.js") reply.removeHeader("access-control-allow-origin");
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff").header("x-frame-options", "DENY")
      .header("x-robots-tag", "noindex, nofollow")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    if (!reply.hasHeader("content-security-policy")) reply.header("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
    return payload;
  });
}

async function forwardVisitorUpload(
  backends: WebSiteBackendService, backendId: string, path: string, headers: Headers,
  upload: { data: Buffer; fileId: string; name: string; mime: string },
): Promise<Response> {
  const chunkBytes = 5 * 1024 * 1024;
  let fileId = upload.fileId;
  for (let offset = 0; offset < upload.data.length; offset += chunkBytes) {
    await backends.store.publicBinding(backendId);
    const end = Math.min(offset + chunkBytes, upload.data.length);
    const form = new FormData();
    form.set("fileId", fileId);
    form.set("file", new Blob([new Uint8Array(upload.data.subarray(offset, end))], { type: upload.mime }), upload.name);
    const chunkHeaders = new Headers(headers);
    if (upload.data.length > chunkBytes) chunkHeaders.set("content-range", `bytes ${offset}-${end - 1}/${upload.data.length}`);
    if (offset) chunkHeaders.set("x-appwrite-id", fileId);
    const response = await backends.requiredClient().forward(path, { method: "POST", headers: chunkHeaders, body: form });
    if (!response.ok || end === upload.data.length) return response;
    const data = await readResponse(response);
    try { fileId = z.object({ $id: webSiteBackendIdSchema }).parse(JSON.parse(data.toString("utf8"))).$id; }
    catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
  }
  throw new AppError("VALIDATION_ERROR");
}

async function sendVisitorResponse(
  reply: FastifyReply, response: Response, method: string, url: URL, backendId: string, projectId: string,
  visitor: string, previous: Awaited<ReturnType<WebSiteVisitorSessions["read"]>>,
  sessions: WebSiteVisitorSessions, backends: WebSiteBackendService,
): Promise<FastifyReply> {
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new AppError("AUTH_REQUIRED");
    if (response.status === 403) throw new AppError("FORBIDDEN");
    if (response.status === 404) throw new AppError("WEB_SITE_NOT_FOUND");
    if (response.status === 409) throw new AppError("CONFLICT");
    if (response.status === 429) throw new AppError("APPLICATION_EXTERNAL_RATE_LIMITED");
    if (response.status === 400) throw new AppError("VALIDATION_ERROR");
    throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE");
  }
  const data = await readResponse(response);
  await backends.store.publicBinding(backendId);
  const cookieNames = new Set([`a_session_${projectId}`, `a_session_${projectId}_legacy`]);
  const updated = response.headers.getSetCookie().map(value => value.split(";", 1)[0] ?? "")
    .filter(value => cookieNames.has(value.slice(0, value.indexOf("="))));
  const login = method === "POST" && /^\/appwrite\/v1\/account\/sessions\/(?:email|anonymous)$/u.test(url.pathname);
  const logout = method === "DELETE" && url.pathname === "/appwrite/v1/account/sessions/current";
  if (login && !updated.length) throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE");
  if (updated.length || logout) await sessions.save(backendId, visitor, previous, logout ? "" : updated.join("; "));
  const type = response.headers.get("content-type") ?? "application/octet-stream";
  // Upstream active content always remains sandboxed, including direct API navigation.
  reply.header("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
  const fileBytes = /^\/appwrite\/v1\/storage\/buckets\/[^/]+\/files\/[^/]+\/(?:download|view|preview)$/u.test(url.pathname);
  if (type.includes("application/json") && !fileBytes) {
    if (!data.length) return reply.code(response.status).send();
    let value: unknown;
    try { value = JSON.parse(data.toString("utf8")); } catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
    if (url.pathname.startsWith("/appwrite/v1/account")) {
      const account = z.record(z.string(), z.unknown()).parse(value);
      for (const key of ["secret", "providerAccessToken", "providerRefreshToken", "password", "hash", "hashOptions"]) delete account[key];
      value = account;
    }
    return reply.code(response.status).type("application/json").send(value);
  }
  return reply.code(response.status).type(type).send(data);
}
