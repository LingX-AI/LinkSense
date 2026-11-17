import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { webBundlePathSchema } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { WebSiteService } from "../web-sites/service.js";
import { resourceContentType } from "../web-sites/resources.js";
import type { WebSiteBackendService } from "./service.js";

const apiPrefix = "/appwrite/v1";
const gatewayPrefix = "/api/v1/public-app-gateway";
const maximumBytes = 21 * 1024 * 1024;
const clientPath = /^\/(?:account(?:\/[a-zA-Z0-9_.-]+)*|tablesdb\/[a-zA-Z0-9_.-]+\/tables\/[a-zA-Z0-9_.-]+\/(?:rows|transactions)(?:\/[a-zA-Z0-9_.-]+)*|tablesdb\/transactions(?:\/[a-zA-Z0-9_.-]+)*|storage\/buckets\/[a-zA-Z0-9_.-]+\/files(?:\/[a-zA-Z0-9_.-]+)*|functions\/[a-zA-Z0-9_.-]+\/executions(?:\/[a-zA-Z0-9_.-]+)?)$/u;

export function validatePublicAppUrl(url: URL, projectId: string): void {
  if (!url.pathname.startsWith(`${apiPrefix}/`) || !clientPath.test(url.pathname.slice(apiPrefix.length)) ||
      url.searchParams.getAll("project").some(project => project !== projectId)) throw new AppError("FORBIDDEN");
  for (const key of ["key", "mode", "session", "jwt"]) {
    if (url.searchParams.has(key)) throw new AppError("FORBIDDEN");
  }
}

export function publicFunctionExecution(value: unknown, url: URL): string {
  if ([...url.searchParams.keys()].some(key => key !== "project")) throw new AppError("VALIDATION_ERROR");
  const execution = z.strictObject({
    body: z.string().max(1024 * 1024).optional(),
    async: z.literal(false).default(false),
    path: z.string().max(512).optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
    headers: z.record(z.string().max(120), z.string().max(4096)).optional(),
  }).parse(value);
  if (execution.headers) {
    let custom: Headers;
    try { custom = new Headers(execution.headers); } catch { throw new AppError("VALIDATION_ERROR"); }
    execution.headers = Object.fromEntries([...custom].filter(([key]) =>
      !key.startsWith("x-appwrite-") && !key.startsWith("x-forwarded-") &&
      !["host", "cookie", "authorization", "forwarded", "connection", "upgrade", "proxy-authorization"].includes(key)));
  }
  return JSON.stringify(execution);
}

/** Route application hosts before platform authentication, parsing or CORS. */
export function registerWebSiteBackendGateway(app: FastifyInstance, backends: WebSiteBackendService, sites: WebSiteService): void {
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host ?? "";
    if (!backends.isAppHost(host)) return;
    const label = backends.matchHost(host);
    if (!label) throw new AppError("WEB_SITE_NOT_FOUND");
    const resolved = await backends.store.byHostLabel(label);
    if (!resolved) throw new AppError("WEB_SITE_NOT_FOUND");
    const id = resolved.id;
    const rawUrl = request.raw.url ?? "/";
    const routedUrl = rawUrl.startsWith(`${gatewayPrefix}/`) ? rawUrl.slice(gatewayPrefix.length) : rawUrl;
    const binding = await backends.store.publicBinding(id);
    if (binding.backend.runtimeMode === "sandbox") throw new AppError("WEB_SITE_NOT_FOUND");
    const origin = await backends.originFor(id);
    if (backends.matchHost(new URL(origin).host) !== label) throw new AppError("WEB_SITE_NOT_FOUND");
    const url = new URL(routedUrl, origin);
    if (url.origin !== origin || url.pathname.includes("\\")) throw new AppError("WEB_SITE_NOT_FOUND");
    if (request.headers.origin !== undefined && request.headers.origin !== origin) throw new AppError("FORBIDDEN");
    if (url.pathname.startsWith(`${apiPrefix}/`)) {
      if (url.pathname.startsWith(`${apiPrefix}/storage/`)) {
        reply.header("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
      }
      return forward(request, reply, url, binding.backend.projectId, origin, backends, id);
    }
    if (!["GET", "HEAD"].includes(request.method)) throw new AppError("WEB_SITE_NOT_FOUND");
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { throw new AppError("WEB_SITE_NOT_FOUND"); }
    const resourcePath = path.endsWith("/") ? `${path}index.html` : path;
    if (!webBundlePathSchema.safeParse(resourcePath.slice(1)).success) throw new AppError("WEB_SITE_NOT_FOUND");
    const resource = await sites.applicationResource(binding.backend.ownerId, binding.siteId, path);
    await backends.store.publicBinding(id);
    if ("redirect" in resource) return reply.redirect(`${resource.redirect}${url.search}`);
    return reply.type(resourceContentType(resource.mimeType)).send(resource.data);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (!backends.isAppHost(request.headers.host ?? "")) return payload;
    reply.removeHeader("access-control-allow-origin");
    reply.removeHeader("access-control-allow-credentials");
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff").header("x-frame-options", "DENY")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
      .header("content-security-policy", reply.getHeader("content-security-policy") ?? [
        "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'", "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:",
        "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", "worker-src 'none'",
      ].join("; "));
    return payload;
  });
}

async function forward(
  request: FastifyRequest, reply: FastifyReply, url: URL, projectId: string, origin: string,
  backends: WebSiteBackendService, backendId: string,
): Promise<FastifyReply> {
  const path = url.pathname.slice(apiPrefix.length);
  validatePublicAppUrl(url, projectId);
  if (request.headers["x-appwrite-key"] || request.headers["x-appwrite-mode"] ||
      (request.headers["x-appwrite-project"] && request.headers["x-appwrite-project"] !== projectId)) throw new AppError("FORBIDDEN");
  const headers = new Headers({ "x-appwrite-project": projectId, origin, "x-forwarded-for": request.ip });
  for (const key of ["content-type", "accept", "range", "content-range", "x-appwrite-id", "x-appwrite-session", "x-appwrite-jwt", "x-appwrite-response-format"]) {
    const value = request.headers[key];
    if (typeof value === "string") headers.set(key, value);
  }
  const cookieNames = new Set([`a_session_${projectId}`, `a_session_${projectId}_legacy`]);
  // Host prefixes prevent another application from injecting a parent-domain session.
  const cookiePrefix = origin.startsWith("https:") ? "__Host-" : "";
  const browserCookieNames = new Map([...cookieNames].map(name => [`${cookiePrefix}${name}`, name]));
  const cookies = (request.headers.cookie ?? "").split(";").map(part => part.trim())
    .flatMap(part => {
      const separator = part.indexOf("=");
      if (separator <= 0) return [];
      const name = browserCookieNames.get(part.slice(0, separator));
      return name ? [`${name}${part.slice(separator)}`] : [];
    }).join("; ");
  if (cookies) headers.set("cookie", cookies);
  const fallback = request.headers["x-fallback-cookies"];
  if (typeof fallback === "string") {
    try {
      const values = z.record(z.string(), z.string().max(4096)).parse(JSON.parse(fallback));
      headers.set("x-fallback-cookies", JSON.stringify(Object.fromEntries(Object.entries(values).filter(([key]) => cookieNames.has(key)))));
    } catch { throw new AppError("VALIDATION_ERROR"); }
  }
  let body = ["GET", "HEAD"].includes(request.method) ? undefined : await readRequest(request);
  if (request.method === "POST" && /^\/functions\/[^/]+\/executions$/u.test(path)) {
    let value: unknown;
    try { value = JSON.parse(body?.toString("utf8") ?? "{}"); } catch { throw new AppError("VALIDATION_ERROR"); }
    body = Buffer.from(publicFunctionExecution(value, url));
    headers.set("content-type", "application/json");
  }
  const response = await backends.requiredClient().forward(`${path}${url.search}`, {
    method: request.method, headers, ...(body ? { body: new Uint8Array(body) } : {}),
  });
  if (response.status >= 500 || response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE");
  }
  const data = await readResponse(response);
  // A disable, owner suspension or task deletion fences an in-flight response too.
  await backends.store.publicBinding(backendId);
  const contentType = response.headers.get("content-type");
  if (contentType) reply.header("content-type", contentType);
  const cookieHeaders = response.headers.getSetCookie().flatMap(value => {
    const parts = value.split(";").map(part => part.trim());
    const first = parts[0];
    if (!first || !cookieNames.has(first.slice(0, first.indexOf("=")))) return [];
    const retained = parts.slice(1).filter(part => !/^(?:domain|path|samesite|secure|httponly)(?:=|$)/iu.test(part));
    return [[`${cookiePrefix}${first}`, ...retained, "Path=/", "HttpOnly", "SameSite=Lax", ...(origin.startsWith("https:") ? ["Secure"] : [])].join("; ")];
  });
  if (cookieHeaders.length) reply.header("set-cookie", cookieHeaders);
  const fallbackResponse = response.headers.get("x-fallback-cookies");
  if (fallbackResponse) reply.header("x-fallback-cookies", fallbackResponse);
  const range = response.headers.get("content-range");
  if (range) reply.header("content-range", range);
  const disposition = response.headers.get("content-disposition");
  if (disposition) reply.header("content-disposition", disposition);
  return reply.code(response.status).send(data);
}

export async function readRequest(request: FastifyRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request.raw) {
    if (!Buffer.isBuffer(value)) throw new AppError("VALIDATION_ERROR");
    size += value.length;
    if (size > maximumBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

export async function readResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximumBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
      chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel(); }
}
