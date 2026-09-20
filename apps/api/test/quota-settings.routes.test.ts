import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { defaultQuotaSettings } from "@linksense/shared";
import { AppError, errorDetails, normalizeError } from "../src/lib/errors.js";
import { adminSystemRoutes } from "../src/modules/system/routes.js";
import type { AppServices } from "../src/services.js";

async function appFixture(denial?: "AUTH_REQUIRED" | "FORBIDDEN") {
  const settings = defaultQuotaSettings();
  const quotaSettings = {
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async () => settings),
    resetMemberQuotas: vi.fn(async () => ({ updated_user_count: 3 })),
    applyMemberLimits: vi.fn(async () => ({
      settings,
      updated_user_count: 3,
    })),
  };
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply
      .code(errorDetails(normalized.code, "zh-CN").status)
      .send({ error_code: normalized.code });
  });
  app.decorate("requireAdmin", async (request) => {
    if (denial) throw new AppError(denial);
    request.authUser = {
      id: "00000000-0000-4000-8000-000000000099",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      status: "active",
      preferredLocale: null,
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  await app.register(adminSystemRoutes, {
    prefix: "/admin",
    services: { quotaSettings } as unknown as AppServices,
  });
  return { app, quotaSettings, settings };
}

describe("quota settings API", () => {
  it("immediately resets all members for an administrator", async () => {
    const { app, quotaSettings } = await appFixture();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/quota-settings/reset",
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ updated_user_count: 3 });
      expect(quotaSettings.resetMemberQuotas).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000099",
        {},
        expect.any(Object),
      );
    } finally {
      await app.close();
    }
  });
  it("saves and applies the unified weekly limit through the administrator endpoint", async () => {
    const { app, quotaSettings, settings } = await appFixture();
    try {
      const payload = {
        limits: { weekly_credit_limit: settings.weekly_credit_limit },
      };
      const response = await app.inject({
        method: "POST",
        url: "/admin/quota-settings/apply-member-limits",
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ settings, updated_user_count: 3 });
      expect(quotaSettings.applyMemberLimits).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000099",
        payload,
        expect.any(Object),
      );
    } finally {
      await app.close();
    }
  });
  it.each(["AUTH_REQUIRED", "FORBIDDEN"] as const)(
    "denies both bulk operations for %s",
    async (denial) => {
      const { app, quotaSettings, settings } = await appFixture(denial);
      try {
        for (const [suffix, payload] of [
          ["reset", {}],
          [
            "apply-member-limits",
            { limits: { weekly_credit_limit: settings.weekly_credit_limit } },
          ],
        ] as const) {
          const response = await app.inject({
            method: "POST",
            url: `/admin/quota-settings/${suffix}`,
            payload,
          });
          expect(response.statusCode).toBe(
            denial === "AUTH_REQUIRED" ? 401 : 403,
          );
        }
        expect(quotaSettings.resetMemberQuotas).not.toHaveBeenCalled();
        expect(quotaSettings.applyMemberLimits).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );
  it("rejects scheduling reset and invalid limits before invoking batch services", async () => {
    const { app, quotaSettings } = await appFixture();
    try {
      for (const [suffix, payload] of [
        ["reset", { reset_at: "2027-01-01" }],
        ["apply-member-limits", { limits: { weekly_credit_limit: "0" } }],
        ["apply-member-limits", { limits: { total_credit_limit: "10" } }],
      ] as const) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/admin/quota-settings/${suffix}`,
              payload,
            })
          ).statusCode,
        ).toBe(400);
      }
      expect(quotaSettings.resetMemberQuotas).not.toHaveBeenCalled();
      expect(quotaSettings.applyMemberLimits).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("reads and saves the unified limit as an administrator", async () => {
    const { app, quotaSettings, settings } = await appFixture();
    try {
      const read = await app.inject({
        method: "GET",
        url: "/admin/quota-settings",
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().data).toEqual(settings);
      const save = await app.inject({
        method: "PUT",
        url: "/admin/quota-settings",
        payload: settings,
      });
      expect(save.statusCode).toBe(200);
      expect(save.json().data.settings).toEqual(settings);
      expect(quotaSettings.updateSettings).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000099",
        settings,
        expect.any(Object),
      );
    } finally {
      await app.close();
    }
  });
  it.each(["AUTH_REQUIRED", "FORBIDDEN"] as const)(
    "denies reading and changing settings for %s",
    async (denial) => {
      const { app, quotaSettings, settings } = await appFixture(denial);
      try {
        for (const method of ["GET", "PUT"] as const) {
          const response = await app.inject({
            method,
            url: "/admin/quota-settings",
            ...(method === "PUT" ? { payload: settings } : {}),
          });
          expect(response.statusCode).toBe(
            denial === "AUTH_REQUIRED" ? 401 : 403,
          );
        }
        expect(quotaSettings.getSettings).not.toHaveBeenCalled();
        expect(quotaSettings.updateSettings).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );
  it("rejects invalid prices and unknown fields before updating the service", async () => {
    const { app, quotaSettings, settings } = await appFixture();
    try {
      for (const payload of [
        { ...settings, credit_price_cny: "0" },
        { ...settings, total_token_limit: "100" },
      ]) {
        expect(
          (
            await app.inject({
              method: "PUT",
              url: "/admin/quota-settings",
              payload,
            })
          ).statusCode,
        ).toBe(400);
      }
      expect(quotaSettings.updateSettings).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
