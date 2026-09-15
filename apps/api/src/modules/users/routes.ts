import type {
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import {
  creditMicrosToDecimal,
  userEnvironmentSettingsSchema,
  updateModelPreferenceSchema,
  updatePersonalizationSettingsSchema,
} from "@linksense/shared";
import { z } from "zod";

import { attachmentContentDisposition } from "../../lib/content-disposition.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import { translateBackend } from "../../lib/i18n.js";
import { resolveLocale } from "../../lib/locale.js";
import type { ModelProviderSettingsService } from "../system/model-provider-settings.js";
import type { RunnerClient } from "../../adapters/runner.js";
import { buildUserImportTemplate } from "./import-workbook.js";
import type { UserService, UserCreditQuotaUsage } from "./service.js";
import type {
  ManagedUser,
  ManagedUserGroup,
  UserActor,
  UserRecord,
} from "./types.js";

const idParamsSchema = z.strictObject({ id: z.string().uuid() });

export type UserRouteAuthentication = {
  authenticate: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
  getActor(request: FastifyRequest): UserActor | Promise<UserActor>;
};

export const meRoutes: FastifyPluginAsync<{
  service: UserService;
  modelProviderSettings?: ModelProviderSettingsService;
  runner?: RunnerClient;
  authentication: UserRouteAuthentication;
}> = async (
  app,
  { service, modelProviderSettings, runner, authentication },
) => {
  app.addHook("preHandler", authentication.authenticate);

  app.get("/", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const user = await service.getOwnProfile(actor.id);
    return reply.send(
      ok(
        await projectUserResponse(user, service, {
          includeCreditQuotaUsage: true,
        }),
        request,
      ),
    );
  });

  app.patch("/", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const user = await service.updateOwnProfile(
      actor.id,
      request.body,
      auditContext(request),
    );
    return reply.send(
      ok(
        await projectUserResponse(user, service, {
          includeCreditQuotaUsage: true,
        }),
        request,
      ),
    );
  });

  if (modelProviderSettings) {
    app.get("/model-preference", async (request, reply) => {
      const actor = await authentication.getActor(request);
      return reply.send(
        ok(await modelProviderSettings.getPreference(actor.id), request),
      );
    });

    app.put("/model-preference", async (request, reply) => {
      const actor = await authentication.getActor(request);
      const preference = await modelProviderSettings.updatePreference(
        actor.id,
        updateModelPreferenceSchema.parse(request.body),
        auditContext(request),
      );
      return reply.send(ok(preference, request));
    });
  }

  if (runner) {
    app.get("/environment", async (request, reply) => {
      const actor = await authentication.getActor(request);
      return reply.send(ok(await runner.getEnvironmentSettings(actor.id), request));
    });
    app.put("/environment", async (request, reply) => {
      const actor = await authentication.getActor(request);
      return reply.send(ok(await runner.updateEnvironmentSettings(actor.id, userEnvironmentSettingsSchema.parse(request.body)), request));
    });
    app.get("/personalization", async (request, reply) => {
      const actor = await authentication.getActor(request);
      return reply.send(
        ok(await runner.getPersonalization(actor.id), request),
      );
    });

    app.patch("/personalization", async (request, reply) => {
      const actor = await authentication.getActor(request);
      const update = updatePersonalizationSettingsSchema.parse(request.body);
      return reply.send(
        ok(await runner.updatePersonalization(actor.id, update), request),
      );
    });

    app.post("/personalization/memories/reset", async (request, reply) => {
      const actor = await authentication.getActor(request);
      return reply.send(ok(await runner.resetMemories(actor.id), request));
    });
  }

  app.post("/avatar", async (request, reply) => {
    const actor = await authentication.getActor(request);
    if (!request.isMultipart()) throw new AppError("AVATAR_UPLOAD_INVALID");
    const file = await request.file({
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    });
    if (!file) throw new AppError("AVATAR_UPLOAD_INVALID");
    let bytes: Buffer;
    try {
      bytes = await file.toBuffer();
    } catch {
      throw new AppError("AVATAR_UPLOAD_INVALID");
    }
    const user = await service.replaceOwnAvatar(
      actor.id,
      {
        filename: file.filename,
        declaredMimeType: file.mimetype,
        bytes,
      },
      auditContext(request),
    );
    return reply.send(
      ok(
        await projectUserResponse(user, service, {
          includeCreditQuotaUsage: true,
        }),
        request,
      ),
    );
  });
};

export const adminUserRoutes: FastifyPluginAsync<{
  service: UserService;
  authentication: UserRouteAuthentication;
}> = async (app, { service, authentication }) => {
  app.addHook("preHandler", authentication.requireAdmin);

  app.get("/users", async (request, reply) => {
    const result = await service.listUsers(request.query);
    return reply.send(
      ok(
        {
          items: await Promise.all(
            result.items.map((user) =>
              projectUserResponse(user, service, {
                includeCreditQuotaUsage: true,
              }),
            ),
          ),
          next_cursor: result.nextCursor,
        },
        request,
      ),
    );
  });

  app.get("/users/role-summary", async (request, reply) => {
    return reply.send(ok({ items: await service.getRoleSummary() }, request));
  });

  app.get("/users/import-template.xlsx", async (request, reply) => {
    const locale = resolveLocale(request);
    const template = await buildUserImportTemplate(locale);
    return reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header(
        "content-disposition",
        attachmentContentDisposition(
          translateBackend("userImport.filename", locale),
        ),
      )
      .send(template);
  });

  app.patch("/users/credit-limits", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const users = await service.updateUserCreditLimits(
      actor,
      request.body,
      auditContext(request),
    );
    return reply.send(
      ok(
        {
          items: await Promise.all(
            users.map((user) => projectUserResponse(user, service)),
          ),
        },
        request,
      ),
    );
  });

  app.get("/users/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = await service.getManagedUser(id);
    return reply.send(ok(await projectUserResponse(user, service), request));
  });

  app.post("/users", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const user = await service.createUser(
      actor,
      request.body,
      auditContext(request),
    );
    return reply
      .code(201)
      .send(ok(await projectUserResponse(user, service), request));
  });

  app.patch("/users/:id", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const { id } = idParamsSchema.parse(request.params);
    const user = await service.updateUser(
      actor,
      id,
      request.body,
      auditContext(request),
    );
    return reply.send(ok(await projectUserResponse(user, service), request));
  });

  app.post("/users/import", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const workbook = await readXlsxUpload(request);
    const result = await service.importWorkbook(
      actor,
      workbook,
      auditContext(request),
    );
    return reply.code(201).send(
      ok(
        {
          imported_count: result.imported_count,
          skipped_count: 0,
          errors: [],
          items: await Promise.all(
            result.items.map((user) => projectUserResponse(user, service)),
          ),
        },
        request,
      ),
    );
  });

  app.get("/user-groups", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const query = z
      .strictObject({
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);
    const groups = await service.listGroups(actor);
    return reply.send(
      ok(
        {
          items: groups.slice(0, query.limit).map(projectGroupResponse),
          next_cursor: null,
        },
        request,
      ),
    );
  });

  app.post("/user-groups", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const group = await service.createGroup(
      actor,
      request.body,
      auditContext(request),
    );
    return reply.code(201).send(ok(projectGroupResponse(group), request));
  });

  app.patch("/user-groups/:id", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const { id } = idParamsSchema.parse(request.params);
    const group = await service.updateGroup(
      actor,
      id,
      request.body,
      auditContext(request),
    );
    return reply.send(ok(projectGroupResponse(group), request));
  });

  app.delete("/user-groups/:id", async (request, reply) => {
    const actor = await authentication.getActor(request);
    const { id } = idParamsSchema.parse(request.params);
    await service.deleteGroup(actor, id, auditContext(request));
    return reply.code(204).send();
  });
};

export async function projectUserResponse(
  user: UserRecord | ManagedUser,
  service: UserService,
  options: { includeCreditQuotaUsage?: boolean } = {},
) {
  const avatarUrl = await service.resolveAvatarUrl(user);
  const managed = "groups" in user ? user : null;
  const creditQuotaUsage = options.includeCreditQuotaUsage
    ? await getCurrentCreditQuotaUsage(service, user)
    : undefined;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: avatarUrl,
    role: user.role,
    status: user.status,
    preferred_locale: user.preferredLocale,
    registration_source: user.selfRegisteredAt
      ? ("self_registration" as const)
      : ("organization_invitation" as const),
    running_message_action: user.runningMessageAction,
    total_credit_limit: user.totalCreditLimitMicros === null ? null : creditMicrosToDecimal(user.totalCreditLimitMicros),
    weekly_credit_limit: user.weeklyCreditLimitMicros === null ? null : creditMicrosToDecimal(user.weeklyCreditLimitMicros),
    monthly_credit_limit: user.monthlyCreditLimitMicros === null ? null : creditMicrosToDecimal(user.monthlyCreditLimitMicros),
    ...(creditQuotaUsage !== undefined
      ? { credit_quota: projectCreditQuotaUsage(creditQuotaUsage) }
      : {}),
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
    last_login_method: user.lastLoginMethod,
    password_updated_at: user.passwordUpdatedAt?.toISOString() ?? null,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
    ...(managed
      ? {
          user_group_ids: managed.groups.map((group) => group.id),
          user_groups: managed.groups.map((group) => ({
            id: group.id,
            name: group.name,
          })),
          group_count: managed.counts.user_groups,
          personal_plugin_count: managed.counts.personal_plugins,
          personal_skill_count: managed.counts.personal_skills,
          personal_credential_count: managed.counts.personal_credentials,
        }
      : {}),
  };
}

async function getCurrentCreditQuotaUsage(
  service: UserService,
  user: UserRecord | ManagedUser,
): Promise<UserCreditQuotaUsage | null> {
  const reader = (
    service as Partial<Pick<UserService, "getCurrentCreditQuotaUsage">>
  ).getCurrentCreditQuotaUsage;
  if (!reader) return null;
  return reader.call(service, user);
}

function projectCreditQuotaUsage(usage: UserCreditQuotaUsage | null) {
  if (!usage) return null;
  return {
    total: projectCreditQuotaTotalUsage(usage.total),
    weekly: projectCreditQuotaPeriodUsage(usage.weekly),
    monthly: projectCreditQuotaPeriodUsage(usage.monthly),
  };
}

function projectCreditQuotaTotalUsage(total: UserCreditQuotaUsage["total"]) {
  if (!total) return null;
  return {
    limit_credits: creditMicrosToDecimal(total.limitCreditMicros),
    used_credits: creditMicrosToDecimal(total.usedCreditMicros),
    remaining_credits: creditMicrosToDecimal(total.remainingCreditMicros),
    remaining_percentage: total.remainingPercentage,
  };
}

function projectCreditQuotaPeriodUsage(
  period: UserCreditQuotaUsage["weekly"],
) {
  if (!period) return null;
  return {
    limit_credits: creditMicrosToDecimal(period.limitCreditMicros),
    used_credits: creditMicrosToDecimal(period.usedCreditMicros),
    remaining_credits: creditMicrosToDecimal(period.remainingCreditMicros),
    remaining_percentage: period.remainingPercentage,
    reset_at: period.resetAt.toISOString(),
  };
}

export function projectGroupResponse(group: ManagedUserGroup) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    member_ids: group.memberIds,
    member_count: group.memberCount,
    created_at: group.createdAt.toISOString(),
    updated_at: group.updatedAt.toISOString(),
  };
}

async function readXlsxUpload(request: FastifyRequest): Promise<Buffer> {
  if (!request.isMultipart()) throw new AppError("VALIDATION_ERROR");
  const file = await request.file({
    limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  });
  if (!file || !/\.xlsx$/iu.test(file.filename)) {
    throw new AppError("VALIDATION_ERROR");
  }
  try {
    return await file.toBuffer();
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}

function auditContext(request: FastifyRequest) {
  return {
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
