import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotChannelConnection as Row } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import type { AuditService } from "../src/modules/audit/service.js";
import type { PrismaBotChannelRepository } from "../src/modules/bot-channels/repository.js";
import type { RedisBotChannelCoordinator } from "../src/modules/bot-channels/coordinator.js";
import { BotChannelService } from "../src/modules/bot-channels/service.js";
import { botChannelRoutes } from "../src/modules/bot-channels/routes.js";
import { decryptChannelCredentials } from "../src/modules/bot-channels/state.js";
import { testCredentials } from "./fixtures/bot-channels.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe.each(testCredentials)(
  "$provider channel management",
  (credentials) => {
    it("creates an encrypted, owner-scoped configuration and lists only public fields", async () => {
      const fixture = await createFixture();
      const result = await fixture.app.inject({
        method: "POST",
        url: "/channels",
        headers: { authorization: "Bearer owner" },
        payload: credentials,
      });
      expect(result.statusCode).toBe(201);
      expect(result.body).not.toContain("test-secret");
      const row = fixture.rows[0]!;
      expect(row.ownerId).toBe(OWNER);
      expect(decryptChannelCredentials(row, fixture.encryption)).toEqual(
        credentials,
      );
      const list = await fixture.app.inject({
        method: "GET",
        url: "/channels",
        headers: { authorization: "Bearer owner" },
      });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toMatch(/encrypted|secret/iu);
      expect(JSON.parse(list.body).data.items[0]).toMatchObject({
        provider: credentials.provider,
        runtime_status:
          credentials.provider === "teams" ? "waiting_message" : "connecting",
      });
      expect(fixture.runtime.wake).toHaveBeenCalled();
    });

    it("requires sign-in and rejects malformed credential submissions", async () => {
      const { app, repository } = await createFixture();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/channels",
            payload: credentials,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/channels",
            headers: { authorization: "Bearer owner" },
            payload: { ...credentials, allowed_sender_id: "" },
          })
        ).statusCode,
      ).toBe(400);
      expect(repository.createConnection).not.toHaveBeenCalled();
    });

    it("refuses cross-owner deletion and waits for active channel work", async () => {
      const { app, rows, coordinator, repository } = await createFixture();
      await app.inject({
        method: "POST",
        url: "/channels",
        headers: { authorization: "Bearer owner" },
        payload: credentials,
      });
      const id = rows[0]!.id;
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/channels/${id}`,
            headers: { authorization: "Bearer stranger" },
          })
        ).statusCode,
      ).toBe(404);
      coordinator.acquireLease.mockResolvedValueOnce(null);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/channels/${id}`,
            headers: { authorization: "Bearer owner" },
          })
        ).statusCode,
      ).toBe(409);
      expect(repository.deleteConnection).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/channels/${id}`,
            headers: { authorization: "Bearer owner" },
          })
        ).statusCode,
      ).toBe(204);
      expect(rows).toHaveLength(0);
    });
  },
);

it("passes Teams callbacks to platform JWT verification without requiring a LinkSense cookie", async () => {
  const { app, runtime } = await createFixture();
  const result = await app.inject({
    method: "POST",
    url: `/channels/teams/${OWNER}/messages`,
    headers: { authorization: "Bearer platform-token" },
    payload: { type: "message" },
  });
  expect(result.statusCode).toBe(401);
  expect(runtime.handleTeams).toHaveBeenCalledWith(
    OWNER,
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer platform-token",
      }),
    }),
  );
});

async function createFixture() {
  const rows: Row[] = [];
  const encryption = {
    masterKey: Buffer.alloc(32, 7).toString("base64"),
    keyId: "test-key",
  };
  const repository = {
    createConnection: vi.fn(
      async (
        input: Omit<
          Row,
          | "createdAt"
          | "updatedAt"
          | "status"
          | "lastConnectedAt"
          | "lastInboundAt"
          | "lastErrorAt"
          | "lastErrorCode"
          | "nextIngestOrder"
        >,
      ) => {
        const row: Row = {
          ...input,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastConnectedAt: null,
          lastInboundAt: null,
          lastErrorAt: null,
          lastErrorCode: null,
          nextIngestOrder: 0n,
        };
        rows.push(row);
        return row;
      },
    ),
    listForOwner: vi.fn(async (ownerId: string) =>
      rows.filter((row) => row.ownerId === ownerId),
    ),
    findConnectionForOwner: vi.fn(
      async (ownerId: string, id: string) =>
        rows.find((row) => row.ownerId === ownerId && row.id === id) ?? null,
    ),
    deleteConnection: vi.fn(async (_ownerId: string, id: string) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    }),
  };
  const coordinator = {
    acquireLease: vi.fn(
      async (): Promise<{ key: string; token: string } | null> => ({
        key: "lease",
        token: "token",
      }),
    ),
    releaseLease: vi.fn(async () => undefined),
  };
  const runtime = {
    wake: vi.fn(),
    handleTeams: vi.fn(async () => ({ status: 401 })),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const service = new BotChannelService(
    repository as unknown as PrismaBotChannelRepository,
    coordinator as unknown as RedisBotChannelCoordinator,
    audit as unknown as AuditService,
    encryption,
    runtime,
    "https://linksense.example.test",
  );
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (!request.headers.authorization) throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id:
        request.headers.authorization === "Bearer owner"
          ? OWNER
          : "20000000-0000-4000-8000-000000000001",
      email: "test@example.test",
      name: "Test",
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
  await app.register(botChannelRoutes, {
    prefix: "/channels",
    service,
    runtime,
  });
  await app.ready();
  return { app, rows, repository, runtime, coordinator, encryption };
}
