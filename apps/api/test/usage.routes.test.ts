import Fastify from "fastify";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  personalUsageRoutes,
  usageAnalyticsRoutes,
} from "../src/modules/usage/routes.js";
import { sendAppError } from "../src/lib/http.js";
import { AppError } from "../src/lib/errors.js";
import type { AppServices } from "../src/services.js";
import { usageReportFixture } from "./fixtures/usage-report.js";

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("usage analytics routes", () => {
  it("lists generated monthly billing statements for administrators", async () => {
    const list = vi.fn(async () => ({
      generated_at: "2026-08-01T00:05:00.000Z",
      current_period: {
        period: {
          month: "2026-08",
          from: "2026-07-31T16:00:00.000Z",
          to_exclusive: "2026-08-31T16:00:00.000Z",
          time_zone: "Asia/Shanghai",
        },
        expected_generation_at: "2026-08-31T16:05:00.000Z",
      },
      statements: [],
    }));
    const requireAdmin = vi.fn(async () => undefined);
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate("requireAdmin", requireAdmin);
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        billingStatements: { list },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage/bills",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      success: true,
      data: { statements: [] },
    });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledOnce();
  });

  it("exports the selected report as an administrator-only Excel workbook", async () => {
    const report = vi.fn(async () => usageReportFixture());
    const auditWrite = vi.fn(async () => undefined);
    let preferredLocale: "zh-CN" | "en-US" = "zh-CN";
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "requireAdmin",
      vi.fn(async (request) => {
        request.authUser = {
          id: "10000000-0000-4000-8000-000000000099",
          email: "admin@example.test",
          name: "管理员",
          role: "admin",
          status: "active",
          preferredLocale,
          avatarObjectKey: null,
          authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
        };
      }),
    );
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        usageAnalytics: { report },
        system: {
          getProductSettings: vi.fn(async () => ({
            organization_display_name: "MOSS 工作台",
            default_locale: "zh-CN",
          })),
        },
        audit: { write: auditWrite },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage/export.xlsx?range=custom&date_from=2026-07-29&date_to=2026-07-30&time_zone=Asia%2FShanghai",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-disposition"]).toContain(
      "MOSS-%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E7%94%A8%E9%87%8F%E7%BB%9F%E8%AE%A1.xlsx",
    );
    expect(report).toHaveBeenCalledWith({
      range: "custom",
      date_from: "2026-07-29",
      date_to: "2026-07-30",
      time_zone: "Asia/Shanghai",
    });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "usage_exported",
        result: "success",
        metadata: { row_count: 17, format: "xlsx", range: "custom" },
      }),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(response.rawPayload).buffer);
    expect(workbook.getWorksheet("按模型")?.getCell("A2").value).toBe("模型 A");

    preferredLocale = "en-US";
    const englishResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage/export.xlsx?range=custom&date_from=2026-07-29&date_to=2026-07-30&time_zone=Asia%2FShanghai",
      headers: { "accept-language": "zh-CN" },
    });
    const englishWorkbook = new ExcelJS.Workbook();
    await englishWorkbook.xlsx.load(
      Uint8Array.from(englishResponse.rawPayload).buffer,
    );
    expect(englishWorkbook.getWorksheet("Summary")).toBeDefined();
    expect(englishWorkbook.getWorksheet("概览")).toBeUndefined();
    expect(englishResponse.headers["content-disposition"]).toContain(
      "MOSS-%E5%B7%A5%E4%BD%9C%E5%8F%B0-usage-analytics.xlsx",
    );
  });

  it("requires an administrator and forwards the validated reporting range", async () => {
    const requireAdmin = vi.fn(async () => undefined);
    const report = vi.fn(async () => ({ generated_at: "now" }));
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate("requireAdmin", requireAdmin);
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        usageAnalytics: { report },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage?range=7d",
    });

    expect(response.statusCode).toBe(200);
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ range: "7d", time_zone: "UTC" });
  });

  it("forwards a validated custom calendar range and time zone", async () => {
    const report = vi.fn(async () => ({ generated_at: "now" }));
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "requireAdmin",
      vi.fn(async () => undefined),
    );
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        usageAnalytics: { report },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage?range=custom&date_from=2026-07-01&date_to=2026-07-27&time_zone=Asia%2FShanghai",
    });

    expect(response.statusCode).toBe(200);
    expect(report).toHaveBeenCalledWith({
      range: "custom",
      date_from: "2026-07-01",
      date_to: "2026-07-27",
      time_zone: "Asia/Shanghai",
    });
  });

  it("rejects incomplete custom ranges before querying analytics", async () => {
    const report = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "requireAdmin",
      vi.fn(async () => undefined),
    );
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        usageAnalytics: { report },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage?range=custom&date_from=2026-07-01",
    });

    expect(response.statusCode).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });

  it("rejects unsupported ranges before querying analytics", async () => {
    const report = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "requireAdmin",
      vi.fn(async () => undefined),
    );
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        usageAnalytics: { report },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage?range=year",
    });

    expect(response.statusCode).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });

  it("does not expose analytics when the administrator guard rejects the request", async () => {
    const report = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "requireAdmin",
      vi.fn(async () => {
        throw new AppError("FORBIDDEN");
      }),
    );
    await app.register(usageAnalyticsRoutes, {
      prefix: "/api/v1/admin/usage",
      services: {
        usageAnalytics: { report },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/usage",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "FORBIDDEN" });
    expect(report).not.toHaveBeenCalled();
  });
});

describe("personal usage routes", () => {
  it("authenticates the user and scopes the profile query to that actor", async () => {
    const personalProfile = vi.fn(async () => ({ generated_at: "now" }));
    const authenticate = vi.fn(async (request) => {
      request.authUser = {
        id: "10000000-0000-4000-8000-000000000001",
        email: "user@example.test",
        name: "普通用户",
        role: "user",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
      };
    });
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate("authenticate", authenticate);
    await app.register(personalUsageRoutes, {
      prefix: "/api/v1/me/usage",
      services: {
        usageAnalytics: { personalProfile },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me/usage?time_zone=Asia%2FShanghai",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(authenticate).toHaveBeenCalledOnce();
    expect(personalProfile).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      { time_zone: "Asia/Shanghai" },
    );
  });

  it("rejects invalid time zones before querying personal usage", async () => {
    const personalProfile = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "authenticate",
      vi.fn(async (request) => {
        request.authUser = {
          id: "10000000-0000-4000-8000-000000000001",
          email: "user@example.test",
          name: "普通用户",
          role: "user",
          status: "active",
          preferredLocale: null,
          avatarObjectKey: null,
          authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
        };
      }),
    );
    await app.register(personalUsageRoutes, {
      prefix: "/api/v1/me/usage",
      services: {
        usageAnalytics: { personalProfile },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me/usage?time_zone=Invalid%2FTime_Zone",
    });

    expect(response.statusCode).toBe(400);
    expect(personalProfile).not.toHaveBeenCalled();
  });

  it("does not query personal usage when authentication fails", async () => {
    const personalProfile = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    app.decorate(
      "authenticate",
      vi.fn(async () => {
        throw new AppError("AUTH_REQUIRED");
      }),
    );
    await app.register(personalUsageRoutes, {
      prefix: "/api/v1/me/usage",
      services: {
        usageAnalytics: { personalProfile },
      } as unknown as AppServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me/usage",
    });

    expect(response.statusCode).toBe(401);
    expect(personalProfile).not.toHaveBeenCalled();
  });
});
