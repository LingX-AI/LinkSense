import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import { DesktopCloudToolGateway } from "../src/modules/desktop-devices/cloud-tools.js";
import { internalDesktopCloudToolRoutes } from "../src/modules/desktop-devices/cloud-tool-routes.js";

const owner = "10000000-0000-4000-8000-000000000001";
const conversation = "30000000-0000-4000-8000-000000000001";
const turn = "40000000-0000-4000-8000-000000000001";
const device = "20000000-0000-4000-8000-000000000001";
const secret = "runner-shared-secret-0000000000000000";
const operation = "local_tools.ping" as const;
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

async function fixture(options: { flag?: boolean; running?: boolean; online?: boolean } = {}) {
  const prisma = {
    user: { findFirst: vi.fn(async () => ({ id: owner })) },
    conversation: {
      findFirst: vi.fn(async () => options.flag === false ? null : { id: conversation }),
    },
    conversationTurn: {
      findFirst: vi.fn(async () => options.running === false ? null : { id: turn }),
    },
  };
  const cloudTools = new DesktopCloudToolGateway();
  const sent: Array<Record<string, unknown>> = [];
  const connectionId = randomUUID();
  if (options.online !== false) {
    cloudTools.register({
      ownerId: owner, deviceId: device, connectionId,
      operations: new Set([operation]),
      verifyCredential: async () => true,
      send: frame => { sent.push(JSON.parse(frame)); return true; },
    });
  }
  const audit = { write: vi.fn(async () => undefined) };
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(internalDesktopCloudToolRoutes, {
    prefix: "/internal",
    prisma: prisma as never,
    sharedSecret: secret,
    cloudTools,
    audit,
  });
  await app.ready();
  return { app, cloudTools, sent, connectionId, prisma, audit };
}

function request(app: ReturnType<typeof Fastify>, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/internal/local-tools/execute",
    headers: {
      authorization: `Bearer ${secret}`,
      "x-linksense-owner-id": owner,
    },
    payload: {
      conversationId: conversation,
      turnId: turn,
      operation,
      input: { message: "hello from the cloud" },
      ...payload,
    },
  });
}

describe("internal desktop cloud tool route", () => {
  it("rechecks the task, running turn, device and audit before returning the ping", async () => {
    const { app, cloudTools, sent, connectionId, prisma, audit } = await fixture();
    const responsePromise = request(app, {});
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const frame = sent[0]!;
    expect(frame).toMatchObject({ type: "cloud_tool.request", operation, input: { message: "hello from the cloud" } });
    cloudTools.receive(connectionId, {
      type: "cloud_tool.result", id: frame.id, operation, ok: true,
      data: { message: "hello from the cloud", platform: "darwin", app_version: "1.2.3" },
    });
    const response = await responsePromise;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      message: "hello from the cloud", platform: "darwin", app_version: "1.2.3",
    });
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: conversation, ownerId: owner, executionTarget: "cloud",
        desktopToolsEnabled: true, archiveStatus: "active",
      }),
    }));
    expect(prisma.conversationTurn.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: turn, conversationId: conversation, status: "running" }),
    }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_tool_requested", targetType: "desktop_device", targetId: device, result: "success",
    }));
  });

  it("rejects a task without the local-tools grant or a running turn", async () => {
    for (const options of [{ flag: false }, { running: false }]) {
      const { app, audit } = await fixture(options);
      const response = await request(app, {});
      expect(response.statusCode, response.body).toBe(403);
      expect(audit.write).not.toHaveBeenCalled();
    }
  });

  it("fails closed when the Mac is offline", async () => {
    const { app, audit } = await fixture({ online: false });
    const response = await request(app, {});
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ error_code: "RUNNER_UNAVAILABLE" });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      result: "failed", metadata: expect.objectContaining({ reason_code: "DESKTOP_TOOL_UNAVAILABLE" }),
    }));
  });

  it("rejects a request that does not carry the runner secret", async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/internal/local-tools/execute",
      headers: { authorization: "Bearer wrong", "x-linksense-owner-id": owner },
      payload: { conversationId: conversation, turnId: turn, operation, input: { message: "hello" } },
    });
    expect(response.statusCode).toBe(401);
  });
});
