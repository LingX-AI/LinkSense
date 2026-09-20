import multipart from "@fastify/multipart";
import ExcelJS from "exceljs";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { buildUserImportTemplate } from "../src/modules/users/import-workbook.js";
import {
  adminUserRoutes,
  meRoutes,
  projectUserResponse,
} from "../src/modules/users/routes.js";
import { UserService } from "../src/modules/users/service.js";
import type { ManagedUser, UserRecord } from "../src/modules/users/types.js";

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function managedUserFixture(input: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    email: "user@example.com",
    name: "User",
    avatarObjectKey: null,
    role: "user",
    status: "active",
    preferredLocale: null,
    selfRegisteredAt: null,
    runningMessageAction: "queue",
    weeklyCreditLimitMicros: null,
    creditQuotaResetAt: null,
    lastLoginAt: null,
    lastLoginMethod: null,
    passwordUpdatedAt: null,
    authValidAfter: new Date("2026-07-17T00:00:00.000Z"),
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    groups: [],
    counts: {
      user_groups: 0,
      personal_plugins: 0,
      personal_skills: 0,
      personal_credentials: 0,
    },
    ...input,
  };
}

describe("administrator role summary route", () => {
  it("returns only the two fixed roles with active, disabled, and total counts", async () => {
    const getRoleSummary = vi.fn(async () => [
      { role: "user", active_count: 7, disabled_count: 2, total_count: 9 },
      { role: "admin", active_count: 3, disabled_count: 1, total_count: 4 },
    ]);
    const requireAdmin = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: { getRoleSummary } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin,
        getActor: vi.fn(async () => ({
          id: "admin",
          role: "admin" as const,
          status: "active" as const,
        })),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/users/role-summary",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      items: [
        { role: "user", active_count: 7, disabled_count: 2, total_count: 9 },
        { role: "admin", active_count: 3, disabled_count: 1, total_count: 4 },
      ],
    });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(getRoleSummary).toHaveBeenCalledOnce();
  });

  it("does not expose role counts when administrator authorization fails", async () => {
    const getRoleSummary = vi.fn(async () => []);
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: { getRoleSummary } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => {
          throw new AppError("FORBIDDEN");
        }),
        getActor: vi.fn(async () => ({
          id: "user",
          role: "user" as const,
          status: "active" as const,
        })),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/users/role-summary",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "FORBIDDEN" });
    expect(getRoleSummary).not.toHaveBeenCalled();
  });
});

describe("administrator user Excel import routes", () => {
  it("downloads a localized Excel template with safe attachment headers", async () => {
    const requireAdmin = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: {} as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin,
        getActor: vi.fn(async () => ({
          id: "admin",
          role: "admin" as const,
          status: "active" as const,
        })),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/users/import-template.xlsx",
      headers: { "accept-language": "zh-CN" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-disposition"]).toContain(
      "%E7%94%A8%E6%88%B7%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx",
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(response.rawPayload).buffer);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "用户导入",
      "填写说明",
    ]);
    expect(requireAdmin).toHaveBeenCalledOnce();
  });

  it("accepts one XLSX multipart file and passes its bytes to the service", async () => {
    const importWorkbook = vi.fn(async () => ({
      items: [],
      imported_count: 2,
    }));
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(multipart, {
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    });
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: { importWorkbook } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => undefined),
        getActor: vi.fn(async () => ({
          id: "admin",
          role: "admin" as const,
          status: "active" as const,
        })),
      },
    });
    const template = await buildUserImportTemplate("en-US");

    const response = await app.inject({
      method: "POST",
      url: "/admin/users/import",
      ...multipartWorkbook(template),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      imported_count: 2,
      skipped_count: 0,
      errors: [],
    });
    expect(importWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin", status: "active" }),
      expect.any(Buffer),
      expect.objectContaining({}),
    );
  });

  it("rejects CSV and non-multipart bodies before calling the import service", async () => {
    const importWorkbook = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(multipart);
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: { importWorkbook } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => undefined),
        getActor: vi.fn(async () => ({
          id: "admin",
          role: "admin" as const,
          status: "active" as const,
        })),
      },
    });

    const csvResponse = await app.inject({
      method: "POST",
      url: "/admin/users/import",
      ...multipartWorkbook(Buffer.from("name,email"), "users.csv", "text/csv"),
    });
    const jsonResponse = await app.inject({
      method: "POST",
      url: "/admin/users/import",
      payload: { csv: "name,email" },
    });

    expect(csvResponse.statusCode).toBe(400);
    expect(jsonResponse.statusCode).toBe(400);
    expect(importWorkbook).not.toHaveBeenCalled();
  });
});

describe("administrator user list routes", () => {
  it("returns current credit usage for managed user rows", async () => {
    const listUsers = vi.fn(async () => ({
      items: [
        managedUserFixture({
          weeklyCreditLimitMicros: 1_000n,
        }),
      ],
      nextCursor: null,
    }));
    const getCurrentCreditQuotaUsage = vi.fn(async () => ({
      weekly: {
        limitCreditMicros: 1_000n,
        usedCreditMicros: 1_000n,
        remainingCreditMicros: 0n,
        remainingPercentage: 0,
        resetAt: new Date("2026-08-09T16:00:00.000Z"),
      },
    }));
    const app = Fastify();
    apps.push(app);
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: {
        listUsers,
        resolveAvatarUrl: vi.fn(async () => null),
        getCurrentCreditQuotaUsage,
      } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => undefined),
        getActor: vi.fn(async () => ({
          id: "admin",
          role: "admin" as const,
          status: "active" as const,
        })),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/users",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({
      weekly_credit_limit: "0.001",
      credit_quota: {
        weekly: {
          remaining_credits: "0",
          remaining_percentage: 0,
        },
      },
    });
    expect(getCurrentCreditQuotaUsage).toHaveBeenCalledOnce();
  });
});

describe("administrator user list service", () => {
  it("filters users whose selected token usage period has no remaining usage", async () => {
    const users = [
      managedUserFixture({
        id: "00000000-0000-4000-8000-000000000010",
        weeklyCreditLimitMicros: 1_000n,
      }),
      managedUserFixture({
        id: "00000000-0000-4000-8000-000000000011",
        email: "nonzero@example.com",
        weeklyCreditLimitMicros: 1_000n,
      }),
      managedUserFixture({
        id: "00000000-0000-4000-8000-000000000012",
        email: "nolimit@example.com",
        weeklyCreditLimitMicros: null,
      }),
    ];
    const listUsers = vi.fn(async () => ({
      items: users,
      nextCursor: null,
    }));
    const creditQuotaUsage = {
      currentUsageForLimits: vi.fn(async (userId: string) => ({
        weekly:
          userId === "00000000-0000-4000-8000-000000000012"
            ? null
            : {
                limitCreditMicros: 1_000n,
                usedCreditMicros:
                  userId === "00000000-0000-4000-8000-000000000010"
                    ? 1_000n
                    : 250n,
                remainingCreditMicros:
                  userId === "00000000-0000-4000-8000-000000000010"
                    ? 0n
                    : 750n,
                remainingPercentage:
                  userId === "00000000-0000-4000-8000-000000000010" ? 0 : 75,
                resetAt: new Date("2026-08-09T16:00:00.000Z"),
              },
      })),
    };
    const service = new UserService({
      persistence: { listUsers } as never,
      avatarStorage: { presignedGetObject: vi.fn() } as never,
      avatarCleanup: { scheduleObjectRemoval: vi.fn(async () => undefined) },
      lifecycleCoordinator: {
        acquireUserLifecycleLock: vi.fn(async () => null),
        releaseUserLifecycleLock: vi.fn(async () => undefined),
      },
      creditQuotaUsage,
    });

    const result = await service.listUsers({
      credit_quota_remaining_zero: "weekly",
      limit: 100,
    });

    expect(result.items.map((user) => user.id)).toEqual([
      "00000000-0000-4000-8000-000000000010",
    ]);
    expect(listUsers).toHaveBeenCalledWith({
      creditQuotaRemainingZero: "weekly",
      limit: 100,
    });
  });
});

describe("user response projection", () => {
  it("includes the id and name of every user group for managed users", async () => {
    const user: ManagedUser = {
      id: "00000000-0000-4000-8000-000000000010",
      email: "user@example.com",
      name: "User",
      avatarObjectKey: null,
      role: "user",
      status: "active",
      preferredLocale: null,
      selfRegisteredAt: new Date("2026-07-17T00:00:00.000Z"),
      runningMessageAction: "queue",
      weeklyCreditLimitMicros: 10_000n,
      creditQuotaResetAt: null,
      lastLoginAt: null,
      lastLoginMethod: null,
      passwordUpdatedAt: null,
      authValidAfter: new Date("2026-07-17T00:00:00.000Z"),
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      updatedAt: new Date("2026-07-17T00:00:00.000Z"),
      groups: [
        {
          id: "00000000-0000-4000-8000-000000000020",
          name: "Research",
          description: "Research team",
          createdBy: null,
          createdAt: new Date("2026-07-17T00:00:00.000Z"),
          updatedAt: new Date("2026-07-17T00:00:00.000Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000021",
          name: "Operations",
          description: null,
          createdBy: null,
          createdAt: new Date("2026-07-17T00:00:00.000Z"),
          updatedAt: new Date("2026-07-17T00:00:00.000Z"),
        },
      ],
      counts: {
        user_groups: 2,
        personal_plugins: 0,
        personal_skills: 0,
        personal_credentials: 0,
      },
    };

    const response = await projectUserResponse(user, {
      resolveAvatarUrl: vi.fn(async () => null),
    } as never);

    expect(response).toMatchObject({
      user_group_ids: [
        "00000000-0000-4000-8000-000000000020",
        "00000000-0000-4000-8000-000000000021",
      ],
      user_groups: [
        {
          id: "00000000-0000-4000-8000-000000000020",
          name: "Research",
        },
        {
          id: "00000000-0000-4000-8000-000000000021",
          name: "Operations",
        },
      ],
      group_count: 2,
      registration_source: "self_registration",
      weekly_credit_limit: "0.01",
    });
  });

  it("includes current token usage only when requested", async () => {
    const user: UserRecord = {
      id: "00000000-0000-4000-8000-000000000010",
      email: "user@example.com",
      name: "User",
      avatarObjectKey: null,
      role: "user",
      status: "active",
      passwordHash: null,
      preferredLocale: null,
      selfRegisteredAt: null,
      runningMessageAction: "queue",
      weeklyCreditLimitMicros: 1_000n,
      creditQuotaResetAt: null,
      lastLoginAt: null,
      lastLoginMethod: null,
      passwordUpdatedAt: null,
      authValidAfter: new Date("2026-07-17T00:00:00.000Z"),
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    };
    const service = {
      resolveAvatarUrl: vi.fn(async () => null),
      getCurrentCreditQuotaUsage: vi.fn(async () => ({
        weekly: {
          limitCreditMicros: 1_000n,
          usedCreditMicros: 250n,
          remainingCreditMicros: 750n,
          remainingPercentage: 75,
          resetAt: new Date("2026-08-09T16:00:00.000Z"),
        },
      })),
    } as never;

    expect(await projectUserResponse(user, service)).not.toHaveProperty(
      "credit_quota",
    );
    const response = await projectUserResponse(user, service, {
      includeCreditQuotaUsage: true,
    });

    expect(response).toMatchObject({
      registration_source: "organization_invitation",
      credit_quota: {
        weekly: {
          limit_credits: "0.001",
          used_credits: "0.00025",
          remaining_credits: "0.00075",
          remaining_percentage: 75,
          reset_at: "2026-08-09T16:00:00.000Z",
        },
      },
    });
  });
});

describe("administrator user credit limit routes", () => {
  it("bulk-updates selected users through the static credit-limits endpoint", async () => {
    const updateUserCreditLimits = vi.fn(async () => [
      {
        id: "00000000-0000-4000-8000-000000000010",
        email: "user@example.com",
        name: "User",
        avatarObjectKey: null,
        role: "user" as const,
        status: "active" as const,
        preferredLocale: null,
        selfRegisteredAt: null,
        runningMessageAction: "queue" as const,
        weeklyCreditLimitMicros: 500_000n,
        creditQuotaResetAt: null,
        lastLoginAt: null,
        lastLoginMethod: null,
        passwordUpdatedAt: null,
        authValidAfter: new Date("2026-07-17T00:00:00.000Z"),
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
        updatedAt: new Date("2026-07-17T00:00:00.000Z"),
        groups: [],
        counts: {
          user_groups: 0,
          personal_plugins: 0,
          personal_skills: 0,
          personal_credentials: 0,
        },
      },
    ]);
    const app = Fastify();
    apps.push(app);
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: {
        updateUserCreditLimits,
        resolveAvatarUrl: vi.fn(async () => null),
      } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => undefined),
        getActor: vi.fn(async () => ({
          id: "admin",
          role: "admin" as const,
          status: "active" as const,
        })),
      },
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/users/credit-limits",
      payload: {
        user_ids: ["00000000-0000-4000-8000-000000000010"],
        weekly_credit_limit: "0.5",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toMatchObject([
      {
        id: "00000000-0000-4000-8000-000000000010",
        weekly_credit_limit: "0.5",
      },
    ]);
    expect(updateUserCreditLimits).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin", status: "active" }),
      {
        user_ids: ["00000000-0000-4000-8000-000000000010"],
        weekly_credit_limit: "0.5",
      },
      expect.objectContaining({}),
    );
  });
});

describe("own profile route", () => {
  it("persists and returns the default action for messages sent during a running turn", async () => {
    const updatedUser: UserRecord = {
      id: "user-1",
      email: "user@example.com",
      name: "User",
      avatarObjectKey: null,
      role: "user",
      status: "active",
      passwordHash: null,
      preferredLocale: "zh-CN",
      selfRegisteredAt: null,
      runningMessageAction: "steer",
      weeklyCreditLimitMicros: null,
      creditQuotaResetAt: null,
      lastLoginAt: null,
      lastLoginMethod: "password",
      passwordUpdatedAt: null,
      authValidAfter: new Date("2026-07-17T00:00:00.000Z"),
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    };
    const updateOwnProfile = vi.fn(async () => updatedUser);
    const app = Fastify();
    apps.push(app);
    await app.register(meRoutes, {
      prefix: "/me",
      service: {
        updateOwnProfile,
        resolveAvatarUrl: vi.fn(async () => null),
      } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => undefined),
        getActor: vi.fn(async () => ({
          id: "user-1",
          role: "user" as const,
          status: "active" as const,
        })),
      },
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/me",
      payload: { running_message_action: "steer" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: "user-1",
      running_message_action: "steer",
    });
    expect(updateOwnProfile).toHaveBeenCalledWith(
      "user-1",
      { running_message_action: "steer" },
      expect.objectContaining({}),
    );
  });

  it("routes personalization reads, updates, and memory resets only for the authenticated user", async () => {
    const getPersonalization = vi.fn(async () => ({
      custom_instructions: "请优先使用中文。",
      memories_enabled: true,
      task_auto_naming: "first_message",
    }));
    const updatePersonalization = vi.fn(async () => ({
      custom_instructions: "请保持简洁。",
      memories_enabled: false,
      task_auto_naming: "every_message",
    }));
    const resetMemories = vi.fn(async () => ({ reset: true as const }));
    const app = Fastify();
    apps.push(app);
    await app.register(meRoutes, {
      prefix: "/me",
      service: {} as never,
      runner: {
        getPersonalization,
        updatePersonalization,
        resetMemories,
      } as never,
      authentication: {
        authenticate: vi.fn(async () => undefined),
        requireAdmin: vi.fn(async () => undefined),
        getActor: vi.fn(async () => ({
          id: "user-1",
          role: "user" as const,
          status: "active" as const,
        })),
      },
    });

    const read = await app.inject({
      method: "GET",
      url: "/me/personalization",
    });
    const update = await app.inject({
      method: "PATCH",
      url: "/me/personalization",
      payload: {
        custom_instructions: "请保持简洁。",
        memories_enabled: false,
        task_auto_naming: "every_message",
      },
    });
    const reset = await app.inject({
      method: "POST",
      url: "/me/personalization/memories/reset",
      payload: {},
    });

    expect(read.statusCode).toBe(200);
    expect(read.json().data).toEqual({
      custom_instructions: "请优先使用中文。",
      memories_enabled: true,
      task_auto_naming: "first_message",
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data).toEqual({
      custom_instructions: "请保持简洁。",
      memories_enabled: false,
      task_auto_naming: "every_message",
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data).toEqual({ reset: true });
    expect(getPersonalization).toHaveBeenCalledWith("user-1");
    expect(updatePersonalization).toHaveBeenCalledWith("user-1", {
      custom_instructions: "请保持简洁。",
      memories_enabled: false,
      task_auto_naming: "every_message",
    });
    expect(resetMemories).toHaveBeenCalledWith("user-1");
  });
});

function multipartWorkbook(
  workbook: Buffer,
  filename = "users.xlsx",
  mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
) {
  const boundary = "linksense-user-import-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      workbook,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}


describe("removed personal environment routes", () => {
  it.each(["GET", "PUT"] as const)("returns 404 for %s instead of exposing environment preferences", async (method) => {
    const app = Fastify();
    apps.push(app);
    await app.register(meRoutes, {
      prefix: "/me",
      service: {} as never,
      runner: {} as never,
      authentication: {
        authenticate: async () => {},
        requireAdmin: async () => {},
        getActor: async () => ({ id: "user-1", role: "user", status: "active" }),
      },
    });
    const response = await app.inject({
      method,
      url: "/me/environment",
      headers: { authorization: "Bearer member" },
      ...(method === "PUT" ? { payload: { keep_running: true } } : {}),
    });
    expect(response.statusCode).toBe(404);
  });
});
