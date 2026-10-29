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
const OTHER = "10000000-0000-4000-8000-000000000002";
const ADMIN = "10000000-0000-4000-8000-000000000003";
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const headers = (name = "owner") => ({ authorization: `Bearer ${name}` });

describe.each([testCredentials[0]!, testCredentials[2]!])(
  "$provider organization management",
  (credentials) => {
    it("allows only admins to configure a shared channel and redacts credentials from every response", async () => {
      const fixture = await createFixture();
      for (const auth of [undefined, headers()]) {
        const result = await fixture.app.inject({
          method: "POST",
          url: "/channels/organization",
          ...(auth ? { headers: auth } : {}),
          payload: credentials,
        });
        expect(result.statusCode).toBe(auth ? 403 : 401);
      }
      const result = await fixture.app.inject({
        method: "POST",
        url: "/channels/organization",
        headers: headers("admin"),
        payload: credentials,
      });
      expect(result.statusCode).toBe(201);
      const row = fixture.rows[0]!;
      expect(row.ownerId).toBeNull();
      expect(decryptChannelCredentials(row, fixture.encryption)).toEqual(
        credentials,
      );
      expect(row.encryptedCredentials).not.toContain("test-secret");
      const list = await fixture.app.inject({
        method: "GET",
        url: "/channels",
        headers: headers(),
      });
      expect(JSON.parse(list.body).data.items[0]).toMatchObject({
        provider: credentials.provider,
        scope: "organization",
        identity_linked: false,
      });
      expect(list.body).not.toMatch(
        /secret|encrypted|account_hint|callback_url|owner_id/iu,
      );
      expect(result.body).not.toMatch(/secret|encrypted/iu);
      expect(fixture.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ADMIN,
          action: "bot_channel_connected",
        }),
      );
    });
    it("refuses removed allowlists and permits admin pause/resume without granting ordinary users control", async () => {
      const { app, rows } = await createFixture();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/channels/organization",
            headers: headers("admin"),
            payload: { ...credentials, allowed_sender_id: "member" },
          })
        ).statusCode,
      ).toBe(400);
      await app.inject({
        method: "POST",
        url: "/channels/organization",
        headers: headers("admin"),
        payload: credentials,
      });
      const id = rows[0]!.id;
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/channels/${id}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(404);
      for (const method of ["PATCH", "DELETE"] as const) {
        expect(
          (
            await app.inject({
              method,
              url: `/channels/organization/${id}`,
              headers: headers(),
              ...(method === "PATCH" ? { payload: { enabled: false } } : {}),
            })
          ).statusCode,
        ).toBe(403);
      }
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/channels/organization/${id}`,
            headers: headers("admin"),
            payload: { enabled: false },
          })
        ).statusCode,
      ).toBe(204);
      expect(rows[0]!.status).toBe("disabled");
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/channels/organization/${id}`,
            headers: headers("admin"),
            payload: { enabled: true },
          })
        ).statusCode,
      ).toBe(204);
      expect(rows[0]!.status).toBe("active");
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/channels/organization/${id}`,
            headers: headers("admin"),
          })
        ).statusCode,
      ).toBe(204);
      expect(rows).toHaveLength(0);
    });
  },
);
it("creates DingTalk only through QR authorization, encrypts registration state and polls no faster than the vendor interval", async () => {
  const f = await createFixture();
  expect(
    (
      await f.app.inject({
        method: "POST",
        url: "/channels",
        headers: headers(),
        payload: testCredentials[1]!,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.app.inject({
        method: "POST",
        url: "/channels/organization",
        headers: headers("admin"),
        payload: testCredentials[1]!,
      })
    ).statusCode,
  ).toBe(400);
  const begin = await f.app.inject({
    method: "POST",
    url: "/channels/dingtalk/registration-sessions",
    headers: headers(),
    payload: {},
  });
  expect(begin.statusCode).toBe(201);
  expect(begin.headers["cache-control"]).toBe("no-store");
  expect(begin.body).not.toMatch(/device|secret|ownerId/iu);
  expect([...f.states.values()].join()).not.toContain("private-device");
  const id = JSON.parse(begin.body).data.id;
  const url = `/channels/dingtalk/registration-sessions/${id}`;
  expect(
    (await f.app.inject({ method: "GET", url, headers: headers("stranger") }))
      .statusCode,
  ).toBe(404);
  await f.app.inject({ method: "GET", url, headers: headers() });
  expect(f.registrationClient.poll).not.toHaveBeenCalled();
  f.advance(3000);
  f.registrationClient.poll.mockResolvedValueOnce({
    status: "SUCCESS",
    clientId: "ding-test",
    clientSecret: "test-secret",
  });
  const result = await f.app.inject({ method: "GET", url, headers: headers() });
  expect(JSON.parse(result.body).data).toMatchObject({
    status: "connected",
    connection_id: id,
    qr_code_url: null,
  });
  expect(result.body).not.toMatch(/test-secret|private-device/iu);
  expect(f.rows[0]).toMatchObject({ id, ownerId: OWNER, provider: "dingtalk" });
  await f.app.inject({ method: "GET", url, headers: headers() });
  expect(f.registrationClient.poll).toHaveBeenCalledOnce();
  expect(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/channels/${id}`,
        headers: headers("stranger"),
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/channels/${id}`,
        headers: headers(),
      })
    ).statusCode,
  ).toBe(204);
});
it("expires a QR without polling or creating a channel", async () => {
  const f = await createFixture();
  const begin = await f.app.inject({
    method: "POST",
    url: "/channels/dingtalk/registration-sessions",
    headers: headers(),
    payload: {},
  });
  f.advance(121_000);
  const result = await f.app.inject({
    method: "GET",
    url: `/channels/dingtalk/registration-sessions/${JSON.parse(begin.body).data.id}`,
    headers: headers(),
  });
  expect(JSON.parse(result.body).data.status).toBe("expired");
  expect(f.registrationClient.poll).not.toHaveBeenCalled();
  expect(f.rows).toHaveLength(0);
});
it("passes Teams callbacks to platform JWT verification without a LinkSense cookie", async () => {
  const f = await createFixture();
  const result = await f.app.inject({
    method: "POST",
    url: `/channels/teams/${OWNER}/messages`,
    headers: headers("platform-token"),
    payload: { type: "message" },
  });
  expect(result.statusCode).toBe(401);
  expect(f.runtime.handleTeams).toHaveBeenCalled();
});
async function createFixture() {
  const rows: Row[] = [];
  const states = new Map<string, string>();
  const active = new Map<string, string>();
  let time = new Date("2026-10-29T00:00:00.000Z").getTime();
  const encryption = {
    masterKey: Buffer.alloc(32, 7).toString("base64"),
    keyId: "test-key",
  };
  const repository = {
    createConnection: vi.fn<PrismaBotChannelRepository["createConnection"]>(
      async (input) => {
        const row: Row = {
          ...input,
          status: "active",
          lastConnectedAt: null,
          lastInboundAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
          nextIngestOrder: 0n,
          createdAt: new Date(time),
          updatedAt: new Date(time),
        };
        rows.push(row);
        return row;
      },
    ),
    listForOwner: vi.fn(async (ownerId: string) =>
      rows.filter((r) => r.ownerId === null || r.ownerId === ownerId),
    ),
    linkedConnectionIds: vi.fn(async () => new Set<string>()),
    listOrganizationConnections: vi.fn(async () =>
      rows.filter((r) => r.ownerId === null),
    ),
    findConnectionForOwner: vi.fn(
      async (ownerId: string, id: string) =>
        rows.find((r) => r.id === id && r.ownerId === ownerId) ?? null,
    ),
    deleteConnection: vi.fn(async (ownerId: string | null, id: string) => {
      const i = rows.findIndex((r) => r.id === id && r.ownerId === ownerId);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    }),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      const r = rows.find((r) => r.id === id && r.ownerId === null);
      if (!r) return false;
      r.status = enabled ? "active" : "disabled";
      return true;
    }),
  };
  const coordinator = {
    activateRegistration: vi.fn(async (owner: string, id: string) => {
      active.set(owner, id);
    }),
    isActiveRegistration: vi.fn(
      async (owner: string, id: string) => active.get(owner) === id,
    ),
    cancelRegistration: vi.fn(async (owner: string) => {
      active.delete(owner);
    }),
    acquireLease: vi.fn(async () => ({ key: "test", token: "token" })),
    releaseLease: vi.fn(async () => undefined),
    setRegistration: vi.fn(async (id: string, value: string) => {
      states.set(id, value);
    }),
    getRegistration: vi.fn(async (id: string) => states.get(id) ?? null),
  };
  const registrationClient = {
    begin: vi.fn(async () => ({
      deviceCode: "private-device",
      qrCodeUrl: "https://www.dingtalk.com/oauth?code=public",
      expiresIn: 120,
      interval: 3,
    })),
    poll: vi
      .fn<
        import("../src/modules/bot-channels/dingtalk-registration-client.js").DingtalkRegistrationClient["poll"]
      >()
      .mockResolvedValue({ status: "WAITING" }),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const runtime = {
    wake: vi.fn(),
    handleTeams: vi.fn(async () => ({ status: 401 })),
  };
  const service = new BotChannelService(
    repository as unknown as PrismaBotChannelRepository,
    coordinator as unknown as RedisBotChannelCoordinator,
    audit as unknown as AuditService,
    encryption,
    runtime,
    "https://linksense.example",
    () => new Date(time),
    registrationClient,
  );
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const token = request.headers.authorization;
    if (
      !token ||
      !["Bearer owner", "Bearer stranger", "Bearer admin"].includes(token)
    )
      throw new AppError("AUTH_REQUIRED");
    Object.assign(request, {
      authUser: {
        id:
          token === "Bearer admin"
            ? ADMIN
            : token === "Bearer owner"
              ? OWNER
              : OTHER,
        role: token === "Bearer admin" ? "admin" : "user",
      },
    });
  });
  app.decorate("requireAdmin", async (request: FastifyRequest) => {
    await app.authenticate(request);
    if (request.authUser?.role !== "admin") throw new AppError("FORBIDDEN");
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return sendAppError(reply, request, error);
    return sendAppError(reply, request, new AppError("VALIDATION_ERROR"));
  });
  await app.register(botChannelRoutes, {
    prefix: "/channels",
    service,
    runtime,
  });
  await app.ready();
  return {
    app,
    rows,
    repository,
    coordinator,
    audit,
    encryption,
    runtime,
    registrationClient,
    states,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
