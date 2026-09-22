import type { FastifyPluginAsync } from "fastify";
import {
  samlResponseSchema,
  updateSamlSettingsSchema,
} from "@linksense/shared";
import { z } from "zod";
import { randomToken } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import { assertCookieRequestOrigin, setRefreshCookie } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { SamlProtocol } from "./protocol.js";
import type { SamlSettingsService } from "./settings.js";

const COOKIE = "linksense_saml_flow";
type Options = {
  protocol: Pick<SamlProtocol, "start" | "complete" | "available" | "metadata">;
  settings: Pick<SamlSettingsService, "getAdminSettings" | "update">;
  auth: Pick<AuthService, "loginSaml">;
  publicBaseUrl: string;
};
export const samlRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const secure = new URL(options.publicBaseUrl).protocol === "https:";
  const cookieOptions = {
    path: "/api/v1/auth/saml",
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    maxAge: 300,
  };
  app.addHook("onSend", async (_request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer");
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 400_000 },
    (_request, body, done) => {
      try {
        const parameters = new URLSearchParams(String(body));
        const response: Record<string, string> = {};
        for (const [key, value] of parameters) {
          if (Object.hasOwn(response, key))
            throw new Error("Duplicate parameter");
          Object.defineProperty(response, key, { value, enumerable: true });
        }
        done(null, samlResponseSchema.parse(response));
      } catch {
        done(new AppError("VALIDATION_ERROR"));
      }
    },
  );
  app.get("/api/v1/auth/saml/status", async (request) =>
    ok({ enabled: secure && (await options.protocol.available()) }, request),
  );
  app.get("/api/v1/auth/saml/metadata", async (_request, reply) => {
    return reply
      .type("application/samlmetadata+xml")
      .header(
        "content-disposition",
        'attachment; filename="linksense-saml-metadata.xml"',
      )
      .send(await options.protocol.metadata());
  });
  app.post("/api/v1/auth/saml/start", async (request, reply) => {
    z.strictObject({}).parse(request.body ?? {});
    assertCookieRequestOrigin(request);
    if (!secure) throw new AppError("AUTH_INVALID_CREDENTIALS", undefined, 503);
    const browser = randomToken(32);
    const authorizationUrl = await options.protocol.start(browser, request.ip);
    reply.setCookie(COOKIE, browser, cookieOptions);
    return ok({ authorization_url: authorizationUrl }, request);
  });
  app.post(
    "/api/v1/auth/saml/acs",
    { bodyLimit: 400_000 },
    async (request, reply) => {
      let result = "failed";
      try {
        const browser = z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/u)
          .parse(request.cookies[COOKIE]);
        if (!secure) throw new AppError("AUTH_INVALID_CREDENTIALS");
        const identity = await options.protocol.complete(
          samlResponseSchema.parse(request.body),
          browser,
        );
        const session = await options.auth.loginSaml(identity, {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
        setRefreshCookie(
          reply,
          "linksense_refresh",
          session.refreshToken,
          secure,
        );
        result = "success";
      } catch (error) {
        if (error instanceof AppError) {
          if (error.code === "EXTERNAL_ACCOUNT_PENDING_APPROVAL")
            result = "pending_approval";
          else if (error.code === "USER_DISABLED") result = "disabled";
        }
      }
      reply.clearCookie(COOKIE, cookieOptions);
      const callback = new URL("/auth/saml/callback", options.publicBaseUrl);
      callback.searchParams.set("result", result);
      return reply.code(303).redirect(callback.toString());
    },
  );
  app.get(
    "/api/v1/admin/saml-authentication-settings",
    { preHandler: app.requireAdmin },
    async (request) => ok(await options.settings.getAdminSettings(), request),
  );
  app.put(
    "/api/v1/admin/saml-authentication-settings",
    { preHandler: app.requireAdmin },
    async (request) => {
      if (!request.authUser) throw new AppError("AUTH_REQUIRED");
      return ok(
        await options.settings.update(
          updateSamlSettingsSchema.parse(request.body),
          request.authUser.id,
          {
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          },
        ),
        request,
      );
    },
  );
};
