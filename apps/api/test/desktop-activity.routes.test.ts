import {
  desktopActivityActionSchema,
  desktopActivityLimit,
} from "@linksense/shared";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { desktopActivityRoutes } from "../src/modules/audit/desktop-activity-routes.js";
import { desktopActivityWhere } from "../src/modules/audit/desktop-activity.js";
import { auditRoutes } from "../src/modules/audit/routes.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const ADMIN_ID = "10000000-0000-4000-8000-000000000002";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function auditRow(overrides: Record<string, unknown>) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    action: "desktop_device_paired",
    targetType: "desktop_device",
    result: "success",
    metadataJson: {},
    createdAt: new Date("2026-11-26T08:00:00.000Z"),
    ...overrides,
  };
}

async function fixture() {
  const findMany = vi.fn<
    (input?: unknown) => Promise<Array<Record<string, unknown>>>
  >(async () => []);
  const prisma = { auditLog: { findMany } };
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request) => {
    const authorization = request.headers.authorization;
    if (authorization !== "Bearer owner" && authorization !== "Bearer admin") {
      throw new AppError("AUTH_REQUIRED");
    }
    const admin = authorization === "Bearer admin";
    request.authUser = {
      id: admin ? ADMIN_ID : OWNER_ID,
      email: admin ? "admin@example.test" : "owner@example.test",
      name: admin ? "Admin" : "Owner",
      role: admin ? "admin" : "user",
      status: "active",
      preferredLocale: null,
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(desktopActivityRoutes, {
    prefix: "/api/v1/desktop",
    prisma: prisma as unknown as Pick<PrismaClient, "auditLog">,
  });
  await app.ready();
  return { app, findMany };
}

describe("desktop activity read", () => {
  it("rejects anonymous callers and every client-supplied filter", async () => {
    const { app, findMany } = await fixture();

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/activity",
    });
    expect(anonymous.statusCode).toBe(401);

    for (const url of [
      `/api/v1/desktop/activity?actor_id=${ADMIN_ID}`,
      "/api/v1/desktop/activity?limit=20",
      "/api/v1/desktop/activity?action=desktop_device_paired",
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer owner" },
      });
      expect(response.statusCode, url).toBe(400);
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes normal users and administrators to the actor's closed existing pairs", async () => {
    const { app, findMany } = await fixture();

    const ownerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/activity",
      headers: { authorization: "Bearer owner" },
    });

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.headers["cache-control"]).toBe("no-store");
    expect(findMany).toHaveBeenCalledOnce();
    const query = findMany.mock.calls[0]?.[0] as {
      where: unknown;
      select: Record<string, boolean>;
      orderBy: unknown;
      take: number;
    };
    expect(query.where).toEqual(desktopActivityWhere(OWNER_ID));
    expect(query.select).toEqual({
      id: true,
      action: true,
      targetType: true,
      result: true,
      metadataJson: true,
      createdAt: true,
    });
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(query.take).toBe(desktopActivityLimit);

    // Every allowlisted action is selected exactly once, and no other desktop
    // tool target or operation can enter the actor-scoped read.
    const serialized = JSON.stringify(query);
    for (const action of desktopActivityActionSchema.options) {
      expect(
        serialized.match(new RegExp(`"${action}"`, "g")),
        action,
      ).toHaveLength(1);
    }
    for (const excluded of [
      "browser_use",
      "browser.execute",
      "web_search",
      "connection",
      "knowledge_base",
      "conversation_file",
      "conversation_reference",
      "user_signed_in",
    ]) {
      expect(serialized, excluded).not.toContain(excluded);
    }

    // An administrator caller has no cross-account bypass.
    const adminResponse = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/activity",
      headers: { authorization: "Bearer admin" },
    });
    expect(adminResponse.statusCode).toBe(200);
    const adminQuery = findMany.mock.calls[1]?.[0] as { where: unknown };
    expect(adminQuery.where).toEqual(desktopActivityWhere(ADMIN_ID));
  });

  it("projects only bounded fields and drops wrong pairs, legacy rows, delivery drift, and raw metadata", async () => {
    const { app, findMany } = await fixture();
    findMany.mockResolvedValueOnce([
      auditRow({
        id: "30000000-0000-4000-8000-000000000001",
        action: "desktop_device_paired",
        metadataJson: { device_id: "metadata-secret", command: "secret" },
        targetId: "target-secret",
        actorId: OWNER_ID,
        ipAddress: "192.0.2.10",
        userAgent: "secret-agent",
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000002",
        action: "desktop_tool_requested",
        targetType: "local_computer",
        metadataJson: {
          operation: "computer.execute",
          computer_request: "act",
          computer_action: "click",
          delivery: "unconfirmed",
          conversation_id: "metadata-secret",
          turn_id: "metadata-secret",
          device_id: "metadata-secret",
          duration_ms: 120,
          reason_code: "metadata-secret",
          command: "secret",
          typed_text: "secret",
          window_title: "secret",
          path: "/secret",
          url: "https://secret.test",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000003",
        action: "desktop_approval_responded",
        targetType: "conversation_desktop_approval",
        metadataJson: {
          action: "decline",
          delivery: "unconfirmed",
          operation: "item/commandExecution/requestApproval",
          conversation_id: "metadata-secret",
          turn_id: "metadata-secret",
          command: "secret",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000004",
        action: "desktop_approval_responded",
        targetType: "conversation_desktop_approval",
        metadataJson: {
          action: "accept",
          delivery: "confirmed",
          reason: "secret",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000005",
        action: "conversation_continued",
        targetType: "conversation",
        metadataJson: {
          source_conversation_id: "metadata-secret",
          source_target: "local",
          execution_target: "cloud",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000006",
        action: "desktop_tool_requested",
        targetType: "local_computer",
        metadataJson: {
          operation: "computer.execute",
          computer_request: "quiesce",
          computer_action: "click",
          delivery: "sent",
          command: "secret",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000007",
        action: "desktop_tool_requested",
        targetType: "browser_use",
        metadataJson: {
          operation: "browser.execute",
          browser_action: "click",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000008",
        action: "desktop_tool_requested",
        targetType: "local_computer",
        metadataJson: { operation: "web.search", query: "secret" },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000009",
        action: "user_signed_in",
        targetType: "user",
        metadataJson: { login_method: "password" },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000010",
        action: "conversation_continued",
        targetType: "conversation",
        metadataJson: {
          source_target: "cloud",
          execution_target: "cloud",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000011",
        action: "desktop_tool_requested",
        targetType: "local_computer",
        metadataJson: {
          operation: "computer.execute",
          computer_request: "status",
          delivery: "confirmed",
        },
      }),
      auditRow({
        id: "30000000-0000-4000-8000-000000000012",
        action: "desktop_approval_responded",
        targetType: "conversation_desktop_approval",
        metadataJson: { action: "accept" },
      }),
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/activity",
      headers: { authorization: "Bearer owner" },
    });

    expect(response.statusCode).toBe(200);
    const { items } = response.json().data;
    expect(items).toEqual([
      {
        id: "30000000-0000-4000-8000-000000000001",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_device_paired",
        result: "success",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_tool_requested",
        result: "success",
        delivery: "unconfirmed",
        computer_request: "act",
        computer_action: "click",
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_approval_responded",
        result: "success",
        delivery: "unconfirmed",
        approval_decision: "decline",
      },
      {
        id: "30000000-0000-4000-8000-000000000004",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_approval_responded",
        result: "success",
        delivery: "confirmed",
        approval_decision: "accept",
      },
      {
        id: "30000000-0000-4000-8000-000000000005",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "conversation_continued",
        result: "success",
      },
      {
        id: "30000000-0000-4000-8000-000000000006",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_tool_requested",
        result: "success",
      },
      {
        id: "30000000-0000-4000-8000-000000000011",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_tool_requested",
        result: "success",
        computer_request: "status",
      },
      {
        id: "30000000-0000-4000-8000-000000000012",
        created_at: "2026-11-26T08:00:00.000Z",
        action: "desktop_approval_responded",
        result: "success",
        approval_decision: "accept",
      },
    ]);
    expect(response.body).not.toContain("metadata-secret");
    expect(response.body).not.toContain("target-secret");
    expect(response.body).not.toContain("secret-agent");
    expect(response.body).not.toContain("192.0.2.10");
    expect(response.body).not.toContain("https://secret.test");
    expect(response.body).not.toContain("typed_text");
  });

  it("keeps the database order and batch bound for the latest rows", async () => {
    const { app, findMany } = await fixture();
    const rows = Array.from({ length: desktopActivityLimit }, (_, index) =>
      auditRow({
        id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        action: "computer_session_started",
        targetType: "local_computer_session",
        createdAt: new Date(Date.UTC(2026, 10, 26, 8, 0, 0 - index)),
      }),
    );
    findMany.mockResolvedValueOnce(rows);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/desktop/activity",
      headers: { authorization: "Bearer owner" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items.map((item: { id: string }) => item.id))
      .toEqual(rows.map((row) => row.id));
    const query = findMany.mock.calls[0]?.[0] as { take: number };
    expect(query.take).toBe(desktopActivityLimit);
  });

  it("leaves the administrator audit route behind its existing admin gate", async () => {
    const app = Fastify();
    apps.push(app);
    app.decorate("requireAdmin", async () => {
      throw new AppError("FORBIDDEN");
    });
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(auditRoutes, {
      prefix: "/api/v1/admin/audit",
      services: {} as unknown as AppServices,
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit",
      headers: { authorization: "Bearer owner" },
    });

    expect(response.statusCode).toBe(403);
  });
});
