import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import {
  FEEDBACK_MAX_TOTAL_IMAGE_SIZE_BYTES,
  initializeSystemResultSchema,
  knowledgeBaseCreationCapabilitySchema,
  knowledgeSearchCapabilitySchema,
  type MaintenanceStatus,
} from "@linksense/shared";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppServices } from "./services.js";
import { createApiCorsOptions } from "./lib/cors.js";
import { resolveLocale } from "./lib/locale.js";
import { errorEnvelope, ok } from "./lib/http.js";
import { AppError, errorDetails, normalizeError } from "./lib/errors.js";
import { authenticationPlugin } from "./plugins/authentication.js";
import { systemRoutes, adminSystemRoutes } from "./modules/system/routes.js";
import { conversationRoutes } from "./modules/conversations/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { internalRunnerRoutes, sseRoutes } from "./modules/events/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import {
  AuthService,
  ConfigurableMicrosoftTeamsTokenVerifier,
  ConfigurableOpenIdClientFlow,
  PrismaAuthRepository,
  RedisOidcStateStore,
  authRoutes,
  projectAuthenticatedUser,
  type PasswordMailGateway,
} from "./modules/auth/index.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./config.js";
import { capabilityRoutes } from "./modules/capabilities/routes.js";
import { internalSkillCreatorRoutes } from "./modules/capabilities/internal-skill-creator-routes.js";
import { credentialRoutes } from "./modules/credentials/routes.js";
import { adminUserRoutes, meRoutes } from "./modules/users/routes.js";
import {
  adminFeedbackRoutes,
  feedbackRoutes,
} from "./modules/feedback/routes.js";
import { voiceTranscriptionRoutes } from "./modules/voice/routes.js";
import { siteIconRoutes } from "./modules/site-icons/routes.js";
import { externalImageRoutes } from "./modules/external-images/routes.js";
import { knowledgeRoutes } from "./modules/knowledge/routes.js";
import {
  createNotInstalledKnowledgeSearchCapability,
  KnowledgeSearchCapabilityReader,
} from "./modules/knowledge/search-capability.js";
import {
  createNotInstalledKnowledgeBaseCreationCapability,
  KnowledgeBaseCreationCapabilityReader,
} from "./modules/knowledge/creation-capability.js";
import { internalKnowledgeSearchRoutes } from "./modules/knowledge/internal-routes.js";
import { internalImageGenerationRoutes } from "./modules/system/image-generation-internal-routes.js";
import { internalCurrentUserRoutes } from "./modules/users/internal-routes.js";
import { knowledgeAdminRoutes } from "./modules/knowledge/admin-routes.js";
import { knowledgeMaintenanceRoutes } from "./modules/knowledge/maintenance-routes.js";
import { KnowledgeCitationReadService } from "./modules/knowledge/citation-read.js";
import { knowledgeCitationRoutes } from "./modules/knowledge/citation-routes.js";
import { knowledgeTurnAssetRoutes } from "./modules/knowledge/turn-asset-routes.js";
import {
  adminMarketplaceRoutes,
  marketplaceRoutes,
} from "./modules/marketplace/routes.js";
import {
  personalUsageRoutes,
  usageAnalyticsRoutes,
} from "./modules/usage/routes.js";
import {
  applicationRoutes,
  interactiveApplicationRuntimeRoutes,
} from "./modules/applications/index.js";
import { mcpServerRoutes } from "./modules/mcp/routes.js";
import { automationRoutes } from "./modules/automations/routes.js";
import { completionNotificationRoutes } from "./modules/completion-notifications/routes.js";
import { clawHubRoutes } from "./modules/clawhub/routes.js";
import { feishuRoutes } from "./modules/feishu/routes.js";
import { weixinRoutes } from "./modules/weixin/routes.js";
import {
  applicationEmbedRoutes,
  applicationExternalManagementRoutes,
} from "./modules/application-embed/index.js";

export const SENSITIVE_REQUEST_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.initialization_credential",
  "req.body.current_password",
  "req.body.new_password",
  "req.body.token",
  "req.body.secret_payload",
  "req.body.secret_fields[*].value",
  "req.body.credential",
  "req.body.environment",
  "req.body.json",
  "req.body.client_secret",
  "req.body.audio_data_url",
  "req.body.icon.data_base64",
  "req.body.instruction",
  "req.body.verify_code",
  "req.body.app_secret",
  "req.body.ticket",
  "req.body.renewal_token",
  "req.body.values[*].value",
  "res.headers.set-cookie",
] as const;

export async function buildApi(
  services: AppServices,
): Promise<FastifyInstance> {
  await services.system.prepare();
  const maximumMultipartFileSize = Math.max(
    services.config.upload.maxFileSizeBytes,
    services.config.knowledge.upload.maxFileSizeBytes,
    FEEDBACK_MAX_TOTAL_IMAGE_SIZE_BYTES,
  );
  const app = Fastify({
    trustProxy: services.config.trustProxy,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      serializers: { req: sanitizeRequestForLog },
      redact: {
        paths: [...SENSITIVE_REQUEST_LOG_PATHS],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: maximumMultipartFileSize + 1024 * 1024,
  });

  await app.register(cors, createApiCorsOptions(services.config.publicBaseUrl));
  await app.register(cookie);
  await app.register(jwt, {
    secret: services.config.jwtSecret,
    sign: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: maximumMultipartFileSize,
    },
  });
  await app.register(authenticationPlugin, { prisma: services.prisma });
  const authService = createAuthService(app, services);
  await authService.prepare();
  await services.jobs.start(authService);
  await services.passwordResetMail.start();

  const defaultContentSecurityPolicy = createContentSecurityPolicy();
  app.addHook("onSend", async (request, reply, payload) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer");
    if (!reply.hasHeader("permissions-policy")) {
      reply.header(
        "permissions-policy",
        "camera=(), microphone=(self), geolocation=()",
      );
    }
    if (!requestPathname(request.url).startsWith("/api/v1/embed/frame/")) {
      reply.header("x-frame-options", "SAMEORIGIN");
    }
    if (!reply.hasHeader("content-security-policy")) {
      reply.header("content-security-policy", defaultContentSecurityPolicy);
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeError(error);
    const locale = resolveLocale(
      request,
      request.authUser?.preferredLocale,
      services.system.defaultLocale,
    );
    const details = errorDetails(normalized.code, locale);
    if (details.status >= 500) {
      request.log.error(
        {
          errorClass: error instanceof Error ? error.name : "unknown",
          errorCode: normalized.code,
        },
        "request failed",
      );
    }
    void reply
      .code(normalized.statusOverride ?? details.status)
      .send(
        errorEnvelope(
          normalized.code,
          details.messageKey,
          details.message,
          normalized.params,
          request.id,
        ),
      );
  });

  app.addHook("preHandler", async (request) => {
    if (request.method === "OPTIONS" || isMaintenanceExemptPath(request.url)) {
      return;
    }
    const maintenance = await services.system.getMaintenanceStatus();
    if (!maintenance.active) return;
    await app.authenticate(request);
    if (shouldBlockForMaintenance(maintenance, request.authUser?.role)) {
      throw new AppError("SYSTEM_MAINTENANCE_ACTIVE");
    }
  });

  await app.register(systemRoutes, { prefix: "/api/v1/system", services });
  app.post("/api/v1/system/initialize", async (request, reply) => {
    const result = await authService.initialize(request.body, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    return reply.code(201).send({
      success: true,
      data: initializeSystemResultSchema.parse({
        user: projectAuthenticatedUser(result.user),
      }),
      request_id: request.id,
    });
  });
  await app.register(authRoutes, {
    prefix: "/api/v1/auth",
    service: authService,
    secureCookies: services.config.publicUrlUsesHttps,
    publicBaseUrl: services.config.publicBaseUrl,
    authenticate: app.authenticate,
    getAuthenticatedUser: async (request) => {
      await app.authenticate(request);
      if (!request.authUser) throw new Error("authenticated user missing");
      return authService.getCurrentUser(request.authUser.id);
    },
  });
  const userAuthentication = {
    authenticate: app.authenticate,
    requireAdmin: app.requireAdmin,
    getActor: async (request: import("fastify").FastifyRequest) => {
      await app.authenticate(request);
      if (!request.authUser) throw new AppError("AUTH_REQUIRED");
      return {
        id: request.authUser.id,
        role: request.authUser.role,
        status: request.authUser.status,
      };
    },
  };
  await app.register(meRoutes, {
    prefix: "/api/v1/me",
    service: services.users,
    modelProviderSettings: services.modelProviderSettings,
    runner: services.runner,
    authentication: userAuthentication,
  });
  await app.register(personalUsageRoutes, {
    prefix: "/api/v1/me/usage",
    services,
  });
  await app.register(feedbackRoutes, {
    prefix: "/api/v1/feedback",
    services,
  });
  await app.register(adminFeedbackRoutes, {
    prefix: "/api/v1/admin/feedback",
    services,
  });
  await app.register(adminUserRoutes, {
    prefix: "/api/v1/admin",
    service: services.users,
    authentication: userAuthentication,
  });
  await app.register(
    async (capabilityApp) => {
      capabilityApp.addHook("preHandler", app.authenticate);
      await capabilityApp.register(capabilityRoutes, {
        service: services.capabilities,
      });
    },
    { prefix: "/api/v1/capabilities" },
  );
  await app.register(
    async (clawHubApp) => {
      clawHubApp.addHook("preHandler", app.authenticate);
      await clawHubApp.register(clawHubRoutes, {
        service: services.clawHub,
      });
    },
    { prefix: "/api/v1/clawhub" },
  );
  await app.register(
    async (marketplaceApp) => {
      marketplaceApp.addHook("preHandler", app.authenticate);
      await marketplaceApp.register(marketplaceRoutes, {
        service: services.marketplace,
      });
    },
    { prefix: "/api/v1/marketplace" },
  );
  await app.register(
    async (marketplaceAdminApp) => {
      marketplaceAdminApp.addHook("preHandler", app.requireAdmin);
      await marketplaceAdminApp.register(adminMarketplaceRoutes, {
        service: services.marketplace,
      });
    },
    { prefix: "/api/v1/admin/marketplace" },
  );
  await app.register(
    async (applicationApp) => {
      applicationApp.addHook("preHandler", app.authenticate);
      await applicationApp.register(applicationRoutes, {
        service: services.applications,
        usageAnalytics: services.usageAnalytics,
        createConversation: (ownerId, application) =>
          services.conversations.createApplicationConversation(
            ownerId,
            application,
          ),
      });
      await applicationApp.register(applicationExternalManagementRoutes, {
        service: services.applicationExternalAccess,
      });
    },
    { prefix: "/api/v1/applications" },
  );
  await app.register(interactiveApplicationRuntimeRoutes, {
    prefix: "/api/v1/interactive-app-runtime",
    service: services.applications,
  });
  await app.register(
    async (credentialApp) => {
      credentialApp.addHook("preHandler", app.authenticate);
      await credentialApp.register(credentialRoutes, {
        service: services.credentials,
      });
    },
    { prefix: "/api/v1/credentials" },
  );
  await app.register(
    async (mcpApp) => {
      mcpApp.addHook("preHandler", app.authenticate);
      await mcpApp.register(mcpServerRoutes, {
        service: services.mcpServers,
      });
    },
    { prefix: "/api/v1/mcp-servers" },
  );
  const fullKnowledgeServices =
    services.knowledge &&
    services.knowledgeSources &&
    services.knowledgeRuntime &&
    services.knowledgeGovernance
      ? {
          knowledge: services.knowledge,
          sources: services.knowledgeSources,
          runtime: services.knowledgeRuntime,
          governance: services.knowledgeGovernance,
        }
      : null;
  if (fullKnowledgeServices) {
    const knowledgeSearchCapability = new KnowledgeSearchCapabilityReader(() =>
      fullKnowledgeServices.runtime.health.check(),
    );
    const knowledgeBaseCreationCapability =
      new KnowledgeBaseCreationCapabilityReader(
        fullKnowledgeServices.runtime.health,
      );
    await app.register(
      async (knowledgeApp) => {
        knowledgeApp.addHook("preHandler", app.authenticate);
        await knowledgeApp.register(knowledgeRoutes, {
          service: fullKnowledgeServices.knowledge,
          sourceService: fullKnowledgeServices.sources,
          getSearchCapability: () => knowledgeSearchCapability.read(),
          creationCapability: knowledgeBaseCreationCapability,
          publicBaseUrl: services.config.publicBaseUrl,
        });
      },
      { prefix: "/api/v1/knowledge-bases" },
    );
    await app.register(
      async (knowledgeCitationApp) => {
        knowledgeCitationApp.addHook("preHandler", app.authenticate);
        await knowledgeCitationApp.register(knowledgeCitationRoutes, {
          service: new KnowledgeCitationReadService(
            services.prisma,
            fullKnowledgeServices.knowledge,
            fullKnowledgeServices.runtime.elasticsearch,
          ),
          publicBaseUrl: services.config.publicBaseUrl,
        });
      },
      { prefix: "/api/v1/knowledge-citations" },
    );
    await app.register(
      async (knowledgeAdminApp) => {
        knowledgeAdminApp.addHook("preHandler", app.requireAdmin);
        await knowledgeAdminApp.register(knowledgeAdminRoutes, {
          service: fullKnowledgeServices.governance.adminService,
        });
      },
      { prefix: "/api/v1/admin/knowledge-bases" },
    );
    await app.register(
      async (knowledgeMaintenanceApp) => {
        knowledgeMaintenanceApp.addHook("preHandler", app.requireAdmin);
        await knowledgeMaintenanceApp.register(knowledgeMaintenanceRoutes, {
          service: fullKnowledgeServices.governance.maintenanceService,
        });
      },
      { prefix: "/api/v1/admin/knowledge-maintenance" },
    );
  } else {
    await app.register(
      async (knowledgeCapabilityApp) => {
        knowledgeCapabilityApp.addHook("preHandler", app.authenticate);
        knowledgeCapabilityApp.get(
          "/search-capability",
          async (request, reply) =>
            reply.send(
              ok(
                knowledgeSearchCapabilitySchema.parse(
                  createNotInstalledKnowledgeSearchCapability(),
                ),
                request.id,
              ),
            ),
        );
        knowledgeCapabilityApp.get(
          "/creation-capability",
          async (request, reply) =>
            reply.send(
              ok(
                knowledgeBaseCreationCapabilitySchema.parse(
                  createNotInstalledKnowledgeBaseCreationCapability(),
                ),
                request.id,
              ),
            ),
        );
      },
      { prefix: "/api/v1/knowledge-bases" },
    );
  }
  await app.register(conversationRoutes, {
    prefix: "/api/v1/conversations",
    services,
  });
  await app.register(automationRoutes, {
    prefix: "/api/v1/automations",
    services,
  });
  await app.register(completionNotificationRoutes, {
    prefix: "/api/v1/completion-notifications",
    service: services.completionNotifications,
  });
  await app.register(weixinRoutes, {
    prefix: "/api/v1/weixin",
    service: services.weixin,
  });
  await app.register(feishuRoutes, {
    prefix: "/api/v1/feishu",
    service: services.feishu,
  });
  if (services.knowledgeTurnAssets) {
    const knowledgeTurnAssets = services.knowledgeTurnAssets;
    await app.register(
      async (knowledgeTurnAssetApp) => {
        knowledgeTurnAssetApp.addHook("preHandler", app.authenticate);
        await knowledgeTurnAssetApp.register(knowledgeTurnAssetRoutes, {
          service: knowledgeTurnAssets,
        });
      },
      { prefix: "/api/v1/conversations" },
    );
  }
  await app.register(fileRoutes, {
    prefix: "/api/v1/conversations",
    services,
  });
  await app.register(sseRoutes, {
    prefix: "/api/v1/conversations",
    services,
  });
  await app.register(applicationEmbedRoutes, {
    prefix: "/api/v1/embed",
    services,
    developmentAssets: services.config.nodeEnv !== "production",
  });
  await app.register(siteIconRoutes, { prefix: "/api/v1", services });
  await app.register(externalImageRoutes, { prefix: "/api/v1", services });
  await app.register(internalRunnerRoutes, { prefix: "/internal", services });
  await app.register(internalSkillCreatorRoutes, {
    prefix: "/internal/skill-creator",
    service: services.skillCreator,
    sharedSecret: services.config.runnerSharedSecret,
  });
  if (services.knowledgeSearch) {
    await app.register(internalKnowledgeSearchRoutes, {
      prefix: "/internal",
      service: services.knowledgeSearch,
      sharedSecret: services.config.runnerSharedSecret,
    });
  }
  await app.register(internalImageGenerationRoutes, {
    prefix: "/internal",
    service: services.imageGenerationSettings,
    sharedSecret: services.config.runnerSharedSecret,
  });
  await app.register(internalCurrentUserRoutes, {
    prefix: "/internal",
    service: services.users,
    sharedSecret: services.config.runnerSharedSecret,
  });
  await app.register(auditRoutes, { prefix: "/api/v1/admin/audit", services });
  await app.register(usageAnalyticsRoutes, {
    prefix: "/api/v1/admin/usage",
    services,
  });
  await app.register(voiceTranscriptionRoutes, {
    prefix: "/api/v1/voice",
    service: services.voiceTranscription,
    rateLimits: services.voiceTranscriptionRateLimits,
    tokenLimits: services.tokenLimits,
    defaultLocale: services.system.defaultLocale,
  });
  await app.register(adminSystemRoutes, { prefix: "/api/v1/admin", services });

  return app;
}

export function isMaintenanceExemptPath(url: string): boolean {
  const path = requestPathname(url);
  return (
    !path.startsWith("/api/v1/") ||
    path.startsWith("/api/v1/system/") ||
    path.startsWith("/api/v1/auth/") ||
    path.startsWith("/api/v1/embed/") ||
    path.startsWith("/api/v1/admin/") ||
    path === "/api/v1/me"
  );
}

export function shouldBlockForMaintenance(
  maintenance: MaintenanceStatus,
  role: "user" | "admin" | undefined,
): boolean {
  return maintenance.active && role !== "admin";
}

export function createContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "frame-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com",
  ].join("; ");
}

export function sanitizeRequestForLog(request: unknown) {
  const value = asRecord(request);
  const headers = asRecord(value.headers);
  const socket = asRecord(value.socket);
  const raw = asRecord(value.raw);
  const rawHeaders = asRecord(raw.headers);
  const rawSocket = asRecord(raw.socket);
  const host =
    stringValue(value.host) ??
    stringValue(headers.host) ??
    stringValue(rawHeaders.host);
  const requestId = stringValue(value.id);
  const remoteAddress =
    stringValue(value.ip) ??
    stringValue(value.remoteAddress) ??
    stringValue(socket.remoteAddress) ??
    stringValue(rawSocket.remoteAddress);
  const remotePort =
    numberValue(value.remotePort) ??
    numberValue(socket.remotePort) ??
    numberValue(rawSocket.remotePort);
  return {
    method: stringValue(value.method) ?? "UNKNOWN",
    url: requestPathname(stringValue(value.url) ?? "/"),
    ...(host ? { host } : {}),
    ...(requestId ? { requestId } : {}),
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(remotePort !== undefined ? { remotePort } : {}),
  };
}

function requestPathname(value: string): string {
  try {
    return new URL(value, "http://linksense.invalid").pathname;
  } catch {
    return value.split(/[?#]/u, 1)[0] || "/";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function createAuthService(
  app: FastifyInstance,
  services: AppServices,
): AuthService {
  const repository = new PrismaAuthRepository(services.prisma);
  const oidc = new ConfigurableOpenIdClientFlow(
    services.authenticationSettings,
    new RedisOidcStateStore(services.redis),
    { securePublicUrl: services.config.publicUrlUsesHttps },
  );
  const teams = new ConfigurableMicrosoftTeamsTokenVerifier(
    services.authenticationSettings,
    services.config.publicBaseUrl,
    { securePublicUrl: services.config.publicUrlUsesHttps },
  );
  const mail: PasswordMailGateway = {
    status: async () => (await services.mailer.health()).status,
    sendPasswordReset: (message) =>
      services.passwordResetMail.enqueue({
        purpose: "password_reset",
        deliveryId: message.deliveryId,
        tokenHash: message.tokenHash,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    sendRegistration: (message) =>
      services.passwordResetMail.enqueue({
        purpose: "registration",
        deliveryId: message.deliveryId,
        tokenHash: message.tokenHash,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
  };
  return new AuthService({
    persistence: repository,
    rateLimiter: services.redis,
    accessTokens: {
      issue: async (payload) => ({
        token: await app.jwt.sign(payload),
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1_000),
      }),
    },
    mail,
    readProductName: async () =>
      (await services.system.getProductSettings()).organization_display_name,
    config: services.config,
    oidc,
    teams,
    audit: services.audit,
  });
}
