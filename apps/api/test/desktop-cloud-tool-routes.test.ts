import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
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
  operations?: readonly string[]; rootMode?: "read" | "write";
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
  const fileRoots = {
    list: vi.fn(async () => [{
      id: root, device_id: device, name: "Fixture root",
      mode: options.rootMode ?? "write",
      created_at: "2026-11-26T10:00:00.000Z", updated_at: "2026-11-26T10:00:00.000Z",
    }]),
    resolve: vi.fn(async (_ownerId: string, id: string) => ({
      id, deviceId: device, name: "Fixture root", mode: options.rootMode ?? "write",
    })),
  };
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(internalDesktopCloudToolRoutes, {
    prefix: "/internal",
    prisma: prisma as never,
    sharedSecret: secret,
    cloudTools,
    fileRoots,
    audit,
  });
  await app.ready();
  return { app, cloudTools, sent, connectionId, prisma, audit, fileRoots };
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
        operation: "local_files.list", root_alias: "Fixture root", path: "docs",
      }),
    }));
    expect(JSON.stringify((audit.write as unknown as { mock: { calls: unknown[][] } }).mock.calls))
      .not.toContain("/Users/");
  });

  it("lists the shared root aliases without dispatching to the Mac", async () => {
    const { app, sent, fileRoots, audit } = await fixture();
    const response = await request(app, {
      operation: "local_files.roots", input: {},
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      roots: [expect.objectContaining({
        id: root, device_id: device, name: "Fixture root", mode: "write",
      })],
    });
    expect(fileRoots.list).toHaveBeenCalledWith(owner);
    expect(sent).toHaveLength(0);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_tool_requested",
      metadata: expect.objectContaining({ operation: "local_files.roots" }),
    }));
  });

  it("rejects and audits a write or delete on a read-only root before dispatch", async () => {
    for (const operation of ["local_files.write", "local_files.delete"]) {
      const { app, sent, audit } = await fixture({
        operations: [operation], rootMode: "read",
      });
      const response = await request(app, {
        operation,
        input: operation === "local_files.write"
          ? { root_id: root, path: "notes.txt", content: "x" }
          : { root_id: root, path: "notes.txt" },
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(sent).toHaveLength(0);
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
        result: "failed",
        metadata: expect.objectContaining({
          operation, path: "notes.txt", reason_code: "DESKTOP_FILE_ACCESS_DENIED",
        }),
      }));
    }
  });

  it("audits a revoked root and never dispatches it", async () => {
    const { app, sent, fileRoots, audit } = await fixture({ operations: ["local_files.read"] });
    fileRoots.resolve.mockRejectedValueOnce(new AppError("DESKTOP_FILE_ROOT_NOT_FOUND"));
    const response = await request(app, {
      operation: "local_files.read",
      input: { root_id: root, path: "notes.txt" },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toEqual({ error_code: "DESKTOP_FILE_ACCESS_DENIED" });
    expect(sent).toHaveLength(0);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      result: "failed",
      metadata: expect.objectContaining({ reason_code: "DESKTOP_FILE_ACCESS_DENIED" }),
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
        operation: "local_files.write", root_alias: "Fixture root",
        path: "notes.txt", reason_code: "DESKTOP_FILE_CONFLICT",
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
