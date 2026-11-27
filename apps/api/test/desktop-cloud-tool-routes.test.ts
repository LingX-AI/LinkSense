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
const root = "50000000-0000-4000-8000-000000000001";
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

async function fixture(options: {
  flag?: boolean; running?: boolean; online?: boolean;
  operations?: readonly string[];
} = {}) {
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
    await cloudTools.register({
      ownerId: owner, deviceId: device, connectionId,
      operations: new Set(options.operations ?? [operation]) as Set<import("@linksense/shared").DesktopCloudToolOperation>,
      verifyCredential: async () => true,
      send: frame => { sent.push(JSON.parse(frame)); return true; },
    });
  }
  const audit = { write: vi.fn(async () => undefined) };
  const browser = { execute: vi.fn(async () => ({
    ok: true as const, browser: "local" as const, data: { connected: true },
  })) };
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(internalDesktopCloudToolRoutes, {
    prefix: "/internal",
    prisma: prisma as never,
    sharedSecret: secret,
    cloudTools,
    browser,
    audit,
  });
  await app.ready();
  return { app, cloudTools, sent, connectionId, prisma, audit, browser };
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
        archiveStatus: "active",
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

  it("resolves the granted root and audits only its alias and relative path", async () => {
    const { app, cloudTools, sent, connectionId, audit } = await fixture({
      operations: ["local_files.list"],
    });
    const pending = request(app, {
      operation: "local_files.list",
      input: { root_id: root, path: "docs", limit: 10 },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const frame = sent[0]!;
    expect(frame).toMatchObject({
      type: "cloud_tool.request", operation: "local_files.list",
      input: { root_id: root, path: "docs", limit: 10 },
    });
    cloudTools.receive(connectionId, {
      type: "cloud_tool.result", id: frame.id, operation: "local_files.list", ok: true,
      data: { entries: [], truncated: false },
    });
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ entries: [], truncated: false });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_tool_requested",
      result: "success",
      metadata: expect.objectContaining({
        operation: "local_files.list", path: "docs",
      }),
    }));
    expect(JSON.stringify((audit.write as unknown as { mock: { calls: unknown[][] } }).mock.calls))
      .not.toContain("/Users/");
  });

  it("forwards the conversation-scoped root list to the Mac", async () => {
    const { app, cloudTools, sent, connectionId, audit } = await fixture({
      operations: ["local_files.roots"],
    });
    const pending = request(app, { operation: "local_files.roots", input: {} });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const frame = sent[0]!;
    expect(frame).toMatchObject({
      type: "cloud_tool.request", conversation_id: conversation,
      operation: "local_files.roots", input: {},
    });
    cloudTools.receive(connectionId, {
      type: "cloud_tool.result", id: frame.id, operation: "local_files.roots",
      ok: true, data: { roots: [] },
    });
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ roots: [] });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_tool_requested",
      metadata: expect.objectContaining({ operation: "local_files.roots", conversation_id: conversation }),
    }));
  });

  it("returns a conflict code and audits it instead of a generic runner failure", async () => {
    const { app, cloudTools, sent, connectionId, audit } = await fixture({
      operations: ["local_files.write"],
    });
    const pending = request(app, {
      operation: "local_files.write",
      input: {
        root_id: root, path: "notes.txt", content: "x",
        expected_digest: "0".repeat(64),
      },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const frame = sent[0]!;
    cloudTools.receive(connectionId, {
      type: "cloud_tool.result", id: frame.id, operation: "local_files.write",
      ok: false, error_code: "DESKTOP_FILE_CONFLICT",
    });
    const response = await pending;
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toEqual({ error_code: "DESKTOP_FILE_CONFLICT" });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      result: "failed",
      metadata: expect.objectContaining({
        operation: "local_files.write",
        path: "notes.txt", reason_code: "DESKTOP_FILE_CONFLICT",
      }),
    }));
  });

  it("audits only the relative shell cwd and preserves a denied approval", async () => {
    const { app, cloudTools, sent, connectionId, audit } = await fixture({
      operations: ["local_shell.exec"],
    });
    const pending = request(app, {
      operation: "local_shell.exec",
      input: { root_id: root, cwd: "apps/web", command: "pnpm test", timeout_ms: 30_000 },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const frame = sent[0]!;
    expect(frame).toMatchObject({
      type: "cloud_tool.request", operation: "local_shell.exec",
      input: { root_id: root, cwd: "apps/web", command: "pnpm test" },
    });
    cloudTools.receive(connectionId, {
      type: "cloud_tool.result", id: frame.id, operation: "local_shell.exec",
      ok: false, error_code: "DESKTOP_APPROVAL_DENIED",
    });
    const response = await pending;
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toEqual({ error_code: "DESKTOP_APPROVAL_DENIED" });
    const auditCall = (audit.write as unknown as {
      mock: { calls: Array<[{ metadata: Record<string, unknown> }]> };
    }).mock.calls[0]?.[0];
    expect(auditCall?.metadata).toMatchObject({
      operation: "local_shell.exec", cwd: "apps/web",
      reason_code: "DESKTOP_APPROVAL_DENIED",
    });
    expect(JSON.stringify(auditCall?.metadata)).not.toContain("pnpm test");
  });

  it("dispatches the cloud desktop status lane and audits it without a root", async () => {
    const { app, cloudTools, sent, connectionId, audit } = await fixture({
      operations: ["local_computer.status"],
    });
    const pending = request(app, {
      operation: "local_computer.status", input: {},
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const frame = sent[0]!;
    expect(frame).toMatchObject({
      type: "cloud_tool.request", operation: "local_computer.status", input: {},
    });
    cloudTools.receive(connectionId, {
      type: "cloud_tool.result", id: frame.id, operation: "local_computer.status", ok: true,
      data: {
        state: "idle", available: true,
        permissions: { accessibility: "granted" },
      },
    });
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ state: "idle", available: true });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_tool_requested",
      metadata: expect.objectContaining({ operation: "local_computer.status" }),
    }));
  });

  it("dispatches the local browser lane without a Mac connection and audits the action", async () => {
    const { app, browser, audit } = await fixture({ online: false });
    const response = await request(app, {
      operation: "local_browser.execute", input: { action: "status" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(browser.execute).toHaveBeenCalledWith(
      owner, conversation, { action: "status" }, expect.any(AbortSignal),
    );
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_tool_requested",
      result: "success",
      metadata: expect.objectContaining({
        operation: "local_browser.execute", browser_action: "status",
      }),
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
