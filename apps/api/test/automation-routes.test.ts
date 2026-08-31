import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { automationRoutes } from "../src/modules/automations/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const AUTOMATION_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const TURN_ID = "50000000-0000-4000-8000-000000000001";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("automation routes", () => {
  it("requires authentication before listing automations", async () => {
    const { app, automations } = await automationRouteFixture();

    const response = await app.inject({ method: "GET", url: "/automations" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error_code: "AUTH_REQUIRED" });
    expect(automations.list).not.toHaveBeenCalled();
  });

  it("lists only the current user's pinned task choices", async () => {
    const { app, automations } = await automationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: "/automations/pinned-tasks",
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(automations.listPinnedConversations).toHaveBeenCalledWith(OWNER_ID);
  });

  it("reads and acknowledges completion notifications for the current user", async () => {
    const { app, automations } = await automationRouteFixture();
    const completedAt = "2026-07-31T01:02:03.000Z";
    automations.completionNotifications.mockResolvedValueOnce({
      latest_unread: {
        conversation_id: CONVERSATION_ID,
        completed_at: completedAt,
      },
    });
    automations.markCompletionNotificationsRead.mockResolvedValueOnce({
      latest_unread: null,
    });

    const notification = await app.inject({
      method: "GET",
      url: "/automations/completion-notifications",
      headers: { authorization: "Bearer member" },
    });
    const read = await app.inject({
      method: "POST",
      url: "/automations/completion-notifications/read",
      headers: { authorization: "Bearer member" },
      payload: { through: completedAt },
    });

    expect(notification.statusCode, notification.body).toBe(200);
    expect(notification.json().data).toMatchObject({
      latest_unread: { conversation_id: CONVERSATION_ID },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(automations.completionNotifications).toHaveBeenCalledWith(OWNER_ID);
    expect(automations.markCompletionNotificationsRead).toHaveBeenCalledWith(
      OWNER_ID,
      { through: completedAt },
    );
  });

  it("rejects an invalid completion notification cursor", async () => {
    const { app, automations } = await automationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: "/automations/completion-notifications/read",
      headers: { authorization: "Bearer member" },
      payload: { through: "not-a-timestamp" },
    });

    expect(response.statusCode).toBe(400);
    expect(automations.markCompletionNotificationsRead).not.toHaveBeenCalled();
  });

  it("creates a custom hourly automation without a notification policy", async () => {
    const { app, automations } = await automationRouteFixture();
    automations.create.mockResolvedValueOnce({ id: AUTOMATION_ID });

    const response = await app.inject({
      method: "POST",
      url: "/automations",
      headers: { authorization: "Bearer member" },
      payload: {
        title: "Morning brief",
        instruction: "Summarize important updates.",
        target: { mode: "new_task" },
        schedule: {
          frequency: "hourly",
          interval: 2,
          minute: 15,
          time_zone: "Asia/Shanghai",
        },
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(automations.create).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({
        target: { mode: "new_task" },
        schedule: expect.objectContaining({ frequency: "hourly" }),
      }),
      expect.objectContaining({ userAgent: expect.any(String) }),
      "zh-CN",
    );
  });

  it("rejects the screenshot-only notification field", async () => {
    const { app, automations } = await automationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: "/automations",
      headers: { authorization: "Bearer member" },
      payload: {
        title: "Morning brief",
        instruction: "Summarize important updates.",
        target: {
          mode: "existing_task",
          conversation_id: CONVERSATION_ID,
        },
        schedule: {
          frequency: "daily",
          interval: 1,
          time: "09:00",
          time_zone: "Asia/Shanghai",
        },
        notification: "important_updates",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(automations.create).not.toHaveBeenCalled();
  });

  it("updates status and deletes only the owner's automation", async () => {
    const { app, automations } = await automationRouteFixture();
    automations.update.mockResolvedValueOnce({ id: AUTOMATION_ID });

    const update = await app.inject({
      method: "PATCH",
      url: `/automations/${AUTOMATION_ID}`,
      headers: { authorization: "Bearer member" },
      payload: { status: "paused" },
    });
    const deletion = await app.inject({
      method: "DELETE",
      url: `/automations/${AUTOMATION_ID}`,
      headers: { authorization: "Bearer member" },
    });

    expect(update.statusCode, update.body).toBe(200);
    expect(deletion.statusCode, deletion.body).toBe(204);
    expect(automations.update).toHaveBeenCalledWith(
      OWNER_ID,
      AUTOMATION_ID,
      { status: "paused" },
      expect.any(Object),
      "zh-CN",
    );
    expect(automations.delete).toHaveBeenCalledWith(
      OWNER_ID,
      AUTOMATION_ID,
      expect.any(Object),
    );
  });

  it("immediately runs only the current user's automation", async () => {
    const { app, automations } = await automationRouteFixture();
    automations.runNow.mockResolvedValueOnce({
      status: "started",
      turn_id: TURN_ID,
    });

    const response = await app.inject({
      method: "POST",
      url: `/automations/${AUTOMATION_ID}/run`,
      headers: { authorization: "Bearer member" },
      payload: { request_id: REQUEST_ID },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json().data).toEqual({
      status: "started",
      turn_id: TURN_ID,
    });
    expect(automations.runNow).toHaveBeenCalledWith(
      OWNER_ID,
      AUTOMATION_ID,
      REQUEST_ID,
      expect.objectContaining({ userAgent: expect.any(String) }),
    );
  });

  it("rejects an invalid immediate-run request id", async () => {
    const { app, automations } = await automationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/automations/${AUTOMATION_ID}/run`,
      headers: { authorization: "Bearer member" },
      payload: { request_id: "not-a-uuid" },
    });

    expect(response.statusCode).toBe(400);
    expect(automations.runNow).not.toHaveBeenCalled();
  });
});

async function automationRouteFixture() {
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer member") {
      throw new AppError("AUTH_REQUIRED");
    }
    request.authUser = {
      id: OWNER_ID,
      email: "member@example.test",
      name: "Member",
      role: "user",
      status: "active",
      preferredLocale: "zh-CN",
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  const automations = {
    list: vi.fn(async () => ({ items: [] })),
    listPinnedConversations: vi.fn(async () => ({
      items: [
        {
          id: CONVERSATION_ID,
          title: "Pinned task",
          pinned_at: "2026-07-30T00:00:00.000Z",
        },
      ],
    })),
    completionNotifications: vi.fn<
      () => Promise<{
        latest_unread: {
          conversation_id: string;
          completed_at: string;
        } | null;
      }>
    >(async () => ({
      latest_unread: null,
    })),
    markCompletionNotificationsRead: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    runNow: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async () => undefined),
  };
  await app.register(automationRoutes, {
    prefix: "/automations",
    services: {
      automations,
      system: { defaultLocale: "zh-CN" },
    } as unknown as AppServices,
  });
  await app.ready();
  return { app, automations };
}
