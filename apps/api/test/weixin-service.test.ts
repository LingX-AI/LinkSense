import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../src/modules/audit/service.js";
import type { ApplicationService } from "../src/modules/applications/service.js";
import { decryptJson, encryptJson } from "../src/lib/crypto.js";
import type { RedisWeixinCoordinator } from "../src/modules/weixin/coordinator.js";
import type {
  WeixinIlinkClient,
  WeixinLoginPollResult,
} from "../src/modules/weixin/protocol.js";
import type { PrismaWeixinRepository } from "../src/modules/weixin/repository.js";
import { WeixinService } from "../src/modules/weixin/service.js";
import { decryptWeixinConnectionState } from "../src/modules/weixin/state.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const LOGIN_ID = "20000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "30000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-13T08:00:00.000Z");
const encryption = {
  masterKey: Buffer.alloc(32, 3).toString("base64"),
  keyId: "weixin-test-key",
};

describe("WeixinService", () => {
  it("completes QR login into encrypted durable connection state", async () => {
    const fixture = createFixture();

    const started = await fixture.service.startLogin(OWNER_ID, {
      application_id: APPLICATION_ID,
    });
    expect(started).toMatchObject({
      id: LOGIN_ID,
      status: "waiting_scan",
      qrcode_url: "https://weixin.qq.com/x/scan-me",
    });
    expect(fixture.client.startLogin).toHaveBeenCalledWith([]);
    expect(fixture.coordinator.storedSession).not.toContain("opaque-qr-id");

    const connected = await fixture.service.getLogin(OWNER_ID, LOGIN_ID);

    expect(connected).toMatchObject({
      status: "connected",
      connection: {
        id: CONNECTION_ID,
        application: { id: APPLICATION_ID, name: "Support agent" },
      },
    });
    expect(fixture.repository.replaceConnection).toHaveBeenCalledTimes(1);
    const persisted = fixture.repository.replaceConnection.mock.calls[0]?.[0];
    expect(persisted?.encryptedState).not.toContain("bot-token-secret");
    expect(
      decryptWeixinConnectionState(
        {
          ...fixture.connection,
          encryptedState: persisted?.encryptedState ?? "",
        },
        encryption,
      ),
    ).toEqual({ token: "bot-token-secret", cursor: "" });
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        action: "weixin_connection_created",
        targetId: CONNECTION_ID,
      }),
    );
    expect(fixture.runtime.wake).toHaveBeenCalledTimes(1);
  });

  it("does not reveal whether another owner has an active login session", async () => {
    const fixture = createFixture();
    await fixture.service.startLogin(OWNER_ID, { application_id: null });

    await expect(
      fixture.service.getLogin(OTHER_OWNER_ID, LOGIN_ID),
    ).rejects.toMatchObject({ code: "WEIXIN_LOGIN_SESSION_NOT_FOUND" });
    expect(fixture.client.pollLogin).not.toHaveBeenCalled();
  });

  it("reloads the login session after acquiring the poll lease", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionForOwner.mockResolvedValue(
      fixture.connection,
    );
    await fixture.service.startLogin(OWNER_ID, { application_id: null });
    fixture.coordinator.acquireLease.mockImplementationOnce(async () => {
      fixture.coordinator.storedSession = encryptJson(
        {
          id: LOGIN_ID,
          ownerId: OWNER_ID,
          status: "connected",
          qrcode: null,
          qrcodeUrl: null,
          baseUrl: "https://ilinkai.weixin.qq.com",
          applicationId: null,
          applicationName: null,
          connectionId: CONNECTION_ID,
          expiresAt: "2026-08-13T08:10:00.000Z",
        },
        encryption.masterKey,
        encryption.keyId,
        `weixin-login:${LOGIN_ID}`,
      );
      return { key: "lease", token: "token" };
    });

    await expect(
      fixture.service.getLogin(OWNER_ID, LOGIN_ID),
    ).resolves.toMatchObject({
      status: "connected",
      connection: { id: CONNECTION_ID },
    });

    expect(fixture.client.pollLogin).not.toHaveBeenCalled();
    expect(fixture.coordinator.getLoginSession).toHaveBeenCalledTimes(2);
    expect(fixture.coordinator.releaseLease).toHaveBeenCalledWith({
      key: "lease",
      token: "token",
    });
  });

  it("encrypts a pairing code until the next login status poll", async () => {
    const fixture = createFixture();
    fixture.client.pollLogin.mockResolvedValue({
      status: "need_verifycode",
    });
    await fixture.service.startLogin(OWNER_ID, { application_id: null });
    await expect(
      fixture.service.getLogin(OWNER_ID, LOGIN_ID),
    ).resolves.toMatchObject({ status: "verification_required" });

    await expect(
      fixture.service.submitVerification(OWNER_ID, LOGIN_ID, "123456"),
    ).resolves.toMatchObject({ status: "scanned" });

    const encrypted = fixture.coordinator.setLoginVerification.mock.calls[0]?.[1];
    expect(encrypted).not.toContain("123456");
    expect(
      decryptJson(
        encrypted ?? "",
        encryption.masterKey,
        encryption.keyId,
        `weixin-login-verification:${LOGIN_ID}`,
      ),
    ).toEqual({ verifyCode: "123456" });

    fixture.client.pollLogin.mockResolvedValue({ status: "need_verifycode" });
    await fixture.service.getLogin(OWNER_ID, LOGIN_ID);
    expect(fixture.client.pollLogin).toHaveBeenLastCalledWith(
      expect.objectContaining({ verifyCode: "123456" }),
    );
    expect(fixture.coordinator.storedVerification).toBeNull();

    await fixture.service.getLogin(OWNER_ID, LOGIN_ID);
    expect(fixture.client.pollLogin).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ verifyCode: expect.anything() }),
    );
  });

  it("reactivates an existing connection and applies the selected application", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fixture.connection);
    fixture.client.pollLogin.mockResolvedValue({
      status: "binded_redirect",
    });

    await fixture.service.startLogin(OWNER_ID, {
      application_id: APPLICATION_ID,
    });
    const connected = await fixture.service.getLogin(OWNER_ID, LOGIN_ID);

    expect(connected).toMatchObject({
      status: "connected",
      connection: {
        id: CONNECTION_ID,
        application: { id: APPLICATION_ID, name: "Support agent" },
      },
    });
    expect(fixture.repository.reactivateConnection).toHaveBeenCalledWith({
      id: CONNECTION_ID,
      applicationId: APPLICATION_ID,
      applicationName: "Support agent",
    });
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        action: "weixin_connection_reconnected",
        targetId: CONNECTION_ID,
      }),
    );
    expect(fixture.runtime.wake).toHaveBeenCalledTimes(1);
  });

  it("drains an existing connection before replacing its credentials", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fixture.connection);

    await fixture.service.startLogin(OWNER_ID, { application_id: null });
    await fixture.service.getLogin(OWNER_ID, LOGIN_ID);

    expect(fixture.repository.markConnectionDisconnecting).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
    );
    expect(fixture.coordinator.acquireLease).toHaveBeenCalledWith(
      "connection",
      CONNECTION_ID,
      30_000,
    );
    expect(fixture.repository.replaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ drainedConnectionId: CONNECTION_ID }),
    );
    expect(fixture.repository.restoreConnectionStatus).not.toHaveBeenCalled();
  });

  it("maps an unsafe confirmed API host to the stable protocol error", async () => {
    const fixture = createFixture();
    fixture.client.pollLogin.mockResolvedValue({
      status: "confirmed",
      bot_token: "bot-token-secret",
      ilink_bot_id: "ilink-bot-id",
      baseurl: "https://attacker.test",
    });

    await fixture.service.startLogin(OWNER_ID, { application_id: null });

    await expect(
      fixture.service.getLogin(OWNER_ID, LOGIN_ID),
    ).rejects.toMatchObject({ code: "WEIXIN_PROTOCOL_INVALID" });
    expect(fixture.repository.replaceConnection).not.toHaveBeenCalled();
  });

  it("fails closed when Weixin does not identify the scanning account", async () => {
    const fixture = createFixture();
    fixture.client.pollLogin.mockResolvedValue({
      status: "confirmed",
      bot_token: "bot-token-secret",
      ilink_bot_id: "ilink-bot-id",
      baseurl: "https://ilinkai.weixin.qq.com",
    });

    await fixture.service.startLogin(OWNER_ID, { application_id: null });

    await expect(
      fixture.service.getLogin(OWNER_ID, LOGIN_ID),
    ).rejects.toMatchObject({ code: "WEIXIN_PROTOCOL_INVALID" });
    expect(fixture.repository.replaceConnection).not.toHaveBeenCalled();
  });

  it("drains in-flight channel work before deleting a connection", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionForOwner.mockResolvedValue(
      fixture.connection,
    );

    await fixture.service.deleteConnection(OWNER_ID, CONNECTION_ID, {});

    expect(fixture.repository.markConnectionDisconnecting).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
    );
    expect(fixture.coordinator.acquireLease).toHaveBeenCalledWith(
      "connection",
      CONNECTION_ID,
      30_000,
    );
    expect(fixture.repository.deleteConnection).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
    );
    expect(fixture.repository.restoreConnectionStatus).not.toHaveBeenCalled();
    expect(
      fixture.repository.markConnectionDisconnecting.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.repository.deleteConnection.mock.invocationCallOrder[0]!,
    );
  });

  it("restores the connection status when deletion fails after draining", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionForOwner.mockResolvedValue(
      fixture.connection,
    );
    fixture.repository.deleteConnection.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      fixture.service.deleteConnection(OWNER_ID, CONNECTION_ID, {}),
    ).rejects.toThrow("database unavailable");

    expect(fixture.repository.restoreConnectionStatus).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      "active",
    );
    expect(fixture.coordinator.releaseLease).toHaveBeenCalledWith({
      key: "lease",
      token: "token",
    });
  });

  it("restores the old connection when credential replacement fails", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fixture.connection);
    fixture.repository.replaceConnection.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await fixture.service.startLogin(OWNER_ID, { application_id: null });
    await expect(
      fixture.service.getLogin(OWNER_ID, LOGIN_ID),
    ).rejects.toThrow("database unavailable");

    expect(fixture.repository.restoreConnectionStatus).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      "active",
    );
    expect(fixture.coordinator.releaseLease).toHaveBeenCalledWith({
      key: "lease",
      token: "token",
    });
  });
});

function createFixture() {
  const coordinator = {
    storedSession: null as string | null,
    storedVerification: null as string | null,
    setLoginSession: vi.fn(async function (this: { storedSession: string | null }, _id, value) {
      this.storedSession = value;
    }),
    getLoginSession: vi.fn(async function (this: { storedSession: string | null }) {
      return this.storedSession;
    }),
    deleteLoginSession: vi.fn(async () => undefined),
    setLoginVerification: vi.fn<
      (
        sessionId: string,
        encryptedValue: string,
        ttlSeconds: number,
      ) => Promise<void>
    >(async function (this: { storedVerification: string | null }, _id, value) {
      this.storedVerification = value;
    }),
    takeLoginVerification: vi.fn(async function (this: {
      storedVerification: string | null;
    }) {
      const value = this.storedVerification;
      this.storedVerification = null;
      return value;
    }),
    clearLoginVerification: vi.fn(async () => undefined),
    acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
    releaseLease: vi.fn(async () => undefined),
  };
  const connection = {
    id: CONNECTION_ID,
    ownerId: OWNER_ID,
    applicationId: APPLICATION_ID,
    applicationName: "Support agent",
    ilinkBotId: "ilink-bot-id",
    ilinkUserId: "ilink-user-id",
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
    encryptedState: "placeholder",
    encryptionKeyId: encryption.keyId,
    status: "active",
    lastPollAt: null,
    lastInboundAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    nextIngestOrder: 0n,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const repository = {
    findConnectionByOwner: vi.fn<
      (ownerId: string) => Promise<typeof connection | null>
    >(async () => null),
    findConnectionForOwner: vi.fn(async (_ownerId, id) =>
      id === CONNECTION_ID ? connection : null,
    ),
    replaceConnection: vi.fn(async (input) => ({
      ...connection,
      ...input,
      createdAt: NOW,
      updatedAt: NOW,
      lastPollAt: null,
      lastInboundAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    })),
    reactivateConnection: vi.fn(async (input) => ({
      ...connection,
      ...input,
      status: "active",
      lastErrorCode: null,
      lastErrorAt: null,
      updatedAt: NOW,
    })),
    markConnectionDisconnecting: vi.fn(async () => true),
    restoreConnectionStatus: vi.fn(async () => undefined),
    deleteConnection: vi.fn(async () => undefined),
  };
  const client = {
    startLogin: vi.fn(async () => ({
      qrcode: "opaque-qr-id",
      qrcodeUrl: "https://weixin.qq.com/x/scan-me",
    })),
    pollLogin: vi.fn<() => Promise<WeixinLoginPollResult>>(async () => ({
      status: "confirmed",
      bot_token: "bot-token-secret",
      ilink_bot_id: "ilink-bot-id",
      ilink_user_id: "ilink-user-id",
      baseurl: "https://ilinkai.weixin.qq.com",
    })),
  };
  const applications = {
    resolveRuntime: vi.fn(async () => ({
      applicationId: APPLICATION_ID,
      applicationName: "Support agent",
    })),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const runtime = { wake: vi.fn() };
  const createId = vi
    .fn<() => string>()
    .mockReturnValueOnce(LOGIN_ID)
    .mockReturnValueOnce(CONNECTION_ID);
  const service = new WeixinService(
    repository as unknown as PrismaWeixinRepository,
    coordinator as unknown as RedisWeixinCoordinator,
    client as unknown as WeixinIlinkClient,
    applications as unknown as Pick<ApplicationService, "resolveRuntime">,
    audit as unknown as AuditService,
    encryption,
    runtime,
    () => NOW,
    createId,
  );
  return {
    service,
    coordinator,
    repository,
    client,
    audit,
    runtime,
    connection,
  };
}
