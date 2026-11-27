import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { defaultPrivacyMaskingSettings } from "@linksense/shared";

import { AppError, errorDetails, normalizeError } from "../src/lib/errors.js";
import { meRoutes } from "../src/modules/users/routes.js";
import type { UserService } from "../src/modules/users/service.js";

const userId = "10000000-0000-4000-8000-000000000001";

function appFixture() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply
      .code(errorDetails(normalized.code, "zh-CN").status)
      .send({ error_code: normalized.code });
  });
  return app;
}

describe("privacy masking routes", () => {
  it("returns the user's settings with private caching and updates them", async () => {
    const app = appFixture();
    const response = {
      revision: 2,
      settings: { ...defaultPrivacyMaskingSettings, enabled: true },
    };
    const getForUser = vi.fn().mockResolvedValue(response);
    const updateForUser = vi.fn().mockResolvedValue(response);
    const listForUser = vi.fn().mockResolvedValue({
      summary: { masked_count: 3, request_count: 1 },
      records: [],
      next_before: null,
    });
    const previewForUser = vi.fn().mockResolvedValue({
      text: "key {{API_KEY_0123456789abcdef}}",
      hits: [
        {
          placeholder: "{{API_KEY_0123456789abcdef}}",
          kind: "API_KEY",
          action: "mask",
        },
      ],
    });
    await app.register(meRoutes, {
      service: {} as UserService,
      privacyMaskingSettings: { getForUser, updateForUser, previewForUser },
      privacyMaskingActivity: { listForUser },
      authentication: {
        authenticate: async () => undefined,
        requireAdmin: async () => undefined,
        getActor: async () => ({
          id: userId,
          email: "user@example.test",
          name: "User",
          role: "user",
          status: "active",
          preferredLocale: null,
          avatarObjectKey: null,
          authValidAfter: new Date(0),
        }),
      },
    });

    const read = await app.inject({
      method: "GET",
      url: "/privacy-masking-settings",
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("private, no-store");
    expect(read.json().data).toEqual(response);
    expect(getForUser).toHaveBeenCalledWith(userId);

    const update = await app.inject({
      method: "PUT",
      url: "/privacy-masking-settings",
      payload: {
        expected_revision: 1,
        settings: { ...defaultPrivacyMaskingSettings, enabled: true },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.headers["cache-control"]).toBe("private, no-store");
    expect(updateForUser).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ expected_revision: 1 }),
      expect.any(Object),
    );

    const invalid = await app.inject({
      method: "PUT",
      url: "/privacy-masking-settings",
      payload: {
        expected_revision: 1,
        settings: { enabled: true },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(updateForUser).toHaveBeenCalledTimes(1);

    const preview = await app.inject({
      method: "POST",
      url: "/privacy-masking-settings/preview",
      payload: { text: "key sk-1234567890abcdef" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("private, no-store");
    expect(preview.json().data).toEqual({
      text: "key {{API_KEY_0123456789abcdef}}",
      hits: [
        {
          placeholder: "{{API_KEY_0123456789abcdef}}",
          kind: "API_KEY",
          action: "mask",
        },
      ],
    });
    expect(previewForUser).toHaveBeenCalledWith(userId, {
      text: "key sk-1234567890abcdef",
    });

    const activity = await app.inject({
      method: "GET",
      url: "/privacy-masking-activity?days=30",
    });
    expect(activity.statusCode).toBe(200);
    expect(activity.headers["cache-control"]).toBe("private, no-store");
    expect(activity.json().data).toEqual({
      summary: { masked_count: 3, request_count: 1 },
      records: [],
      next_before: null,
    });
    expect(listForUser).toHaveBeenCalledWith(userId, { days: 30 });

    const invalidActivity = await app.inject({
      method: "GET",
      url: "/privacy-masking-activity?days=31",
    });
    expect(invalidActivity.statusCode).toBe(400);
    expect(listForUser).toHaveBeenCalledTimes(1);

    const oversized = await app.inject({
      method: "POST",
      url: "/privacy-masking-settings/preview",
      payload: { text: "x".repeat(8001) },
    });
    expect(oversized.statusCode).toBe(400);
    expect(previewForUser).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects unauthenticated access", async () => {
    const app = appFixture();
    const getForUser = vi.fn();
    const updateForUser = vi.fn();
    const previewForUser = vi.fn();
    await app.register(meRoutes, {
      service: {} as UserService,
      privacyMaskingSettings: {
        getForUser,
        updateForUser,
        previewForUser,
      },
      authentication: {
        authenticate: async () => {
          throw new AppError("AUTH_REQUIRED");
        },
        requireAdmin: async () => undefined,
        getActor: async () => {
          throw new AppError("AUTH_REQUIRED");
        },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/privacy-masking-settings",
    });
    expect(response.statusCode).toBe(401);
    expect(getForUser).not.toHaveBeenCalled();
    await app.close();
  });
});
