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
    totalTokenLimit: null,
    weeklyTokenLimit: null,
    monthlyTokenLimit: null,
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
  it("returns current token usage for managed user rows", async () => {
    const listUsers = vi.fn(async () => ({
      items: [
        managedUserFixture({
          weeklyTokenLimit: 1_000n,
          monthlyTokenLimit: 4_000n,
        }),
      ],
      nextCursor: null,
    }));
    const getCurrentTokenQuotaUsage = vi.fn(async () => ({
      weekly: {
        limitTokens: 1_000n,
        usedTokens: 1_000n,
        remainingTokens: 0n,
        remainingPercentage: 0,
        resetAt: new Date("2026-08-09T16:00:00.000Z"),
      },
      monthly: {
        limitTokens: 4_000n,
        usedTokens: 1_000n,
        remainingTokens: 3_000n,
        remainingPercentage: 75,
        resetAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    }));
    const app = Fastify();
    apps.push(app);
    await app.register(adminUserRoutes, {
      prefix: "/admin",
      service: {
        listUsers,
        resolveAvatarUrl: vi.fn(async () => null),
        getCurrentTokenQuotaUsage,
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
      weekly_token_limit: "1000",
      monthly_token_limit: "4000",
      token_quota: {
        weekly: {
          remaining_tokens: "0",
          remaining_percentage: 0,
        },
        monthly: {
          remaining_tokens: "3000",
          remaining_percentage: 75,
        },
      },
    });
    expect(getCurrentTokenQuotaUsage).toHaveBeenCalledOnce();
  });
});

describe("administrator user list service", () => {
  it("filters users whose selected token usage period has no remaining usage", async () => {
    const users = [
      managedUserFixture({
        id: "00000000-0000-4000-8000-000000000010",
        weeklyTokenLimit: 1_000n,
      }),
      managedUserFixture({
        id: "00000000-0000-4000-8000-000000000011",
        email: "nonzero@example.com",
        weeklyTokenLimit: 1_000n,
      }),
      managedUserFixture({
        id: "00000000-0000-4000-8000-000000000012",
        email: "nolimit@example.com",
        weeklyTokenLimit: null,
      }),
    ];
    const listUsers = vi.fn(async () => ({
      items: users,
      nextCursor: null,
    }));
    const tokenQuotaUsage = {
      currentUsageForLimits: vi.fn(async (userId: string) => ({
        total: null,
        weekly:
          userId === "00000000-0000-4000-8000-000000000012"
            ? null
            : {
                limitTokens: 1_000n,
                usedTokens:
                  userId === "00000000-0000-4000-8000-000000000010"
                    ? 1_000n
                    : 250n,
                remainingTokens:
                  userId === "00000000-0000-4000-8000-000000000010"
                    ? 0n
                    : 750n,
                remainingPercentage:
                  userId === "00000000-0000-4000-8000-000000000010" ? 0 : 75,
                resetAt: new Date("2026-08-09T16:00:00.000Z"),
              },
        monthly: null,
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
      tokenQuotaUsage,
    });

    const result = await service.listUsers({
      token_quota_remaining_zero: "weekly",
      limit: 100,
    });

    expect(result.items.map((user) => user.id)).toEqual([
      "00000000-0000-4000-8000-000000000010",
    ]);
    expect(listUsers).toHaveBeenCalledWith({
      tokenQuotaRemainingZero: "weekly",
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
      totalTokenLimit: null,
      weeklyTokenLimit: 10_000n,
      monthlyTokenLimit: null,
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
      weekly_token_limit: "10000",
      monthly_token_limit: null,
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
      totalTokenLimit: null,
      weeklyTokenLimit: 1_000n,
      monthlyTokenLimit: null,
      lastLoginAt: null,
      lastLoginMethod: null,
      passwordUpdatedAt: null,
      authValidAfter: new Date("2026-07-17T00:00:00.000Z"),
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    };
    const service = {
      resolveAvatarUrl: vi.fn(async () => null),
      getCurrentTokenQuotaUsage: vi.fn(async () => ({
        weekly: {
          limitTokens: 1_000n,
          usedTokens: 250n,
          remainingTokens: 750n,
          remainingPercentage: 75,
          resetAt: new Date("2026-08-09T16:00:00.000Z"),
        },
        monthly: null,
      })),
    } as never;

    expect(await projectUserResponse(user, service)).not.toHaveProperty(
      "token_quota",
    );
    const response = await projectUserResponse(user, service, {
      includeTokenQuotaUsage: true,
    });

    expect(response).toMatchObject({
      registration_source: "organization_invitation",
      token_quota: {
        weekly: {
          limit_tokens: "1000",
          used_tokens: "250",
          remaining_tokens: "750",
          remaining_percentage: 75,
          reset_at: "2026-08-09T16:00:00.000Z",
        },
        monthly: null,
      },
    });
  });
});

describe("administrator user token limit routes", () => {
  it("bulk-updates selected users through the static token-limits endpoint", async () => {
    const updateUserTokenLimits = vi.fn(async () => [
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
        totalTokenLimit: 500_000n,
        weeklyTokenLimit: null,
        monthlyTokenLimit: 100_000n,
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
        updateUserTokenLimits,
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
      url: "/admin/users/token-limits",
      payload: {
        user_ids: ["00000000-0000-4000-8000-000000000010"],
        total_token_limit: "500000",
        weekly_token_limit: null,
        monthly_token_limit: "100000",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toMatchObject([
      {
        id: "00000000-0000-4000-8000-000000000010",
        total_token_limit: "500000",
        weekly_token_limit: null,
        monthly_token_limit: "100000",
      },
    ]);
    expect(updateUserTokenLimits).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin", status: "active" }),
      {
        user_ids: ["00000000-0000-4000-8000-000000000010"],
        total_token_limit: "500000",
        weekly_token_limit: null,
        monthly_token_limit: "100000",
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
      totalTokenLimit: null,
      weeklyTokenLimit: null,
      monthlyTokenLimit: null,
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
    }));
    const updatePersonalization = vi.fn(async () => ({
      custom_instructions: "请保持简洁。",
      memories_enabled: false,
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
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data).toEqual({
      custom_instructions: "请保持简洁。",
      memories_enabled: false,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data).toEqual({ reset: true });
    expect(getPersonalization).toHaveBeenCalledWith("user-1");
    expect(updatePersonalization).toHaveBeenCalledWith("user-1", {
      custom_instructions: "请保持简洁。",
      memories_enabled: false,
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
