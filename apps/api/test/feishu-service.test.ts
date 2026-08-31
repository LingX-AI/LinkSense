import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../src/modules/audit/service.js";
import type { FeishuAppBinding } from "../src/generated/prisma/client.js";
import {
  FeishuProtocolError,
  type FeishuOfficialClient,
} from "../src/modules/feishu/client.js";
import type { RedisFeishuCoordinator } from "../src/modules/feishu/coordinator.js";
import type { PrismaFeishuRepository } from "../src/modules/feishu/repository.js";
import { FeishuService } from "../src/modules/feishu/service.js";
import { decryptFeishuCredentials } from "../src/modules/feishu/state.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const REGISTRATION_ID = "20000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-27T08:00:00.000Z");
const encryption = {
  masterKey: Buffer.alloc(32, 8).toString("base64"),
  keyId: "feishu-test-key",
};

describe("FeishuService", () => {
  it("automatically creates an official bot and encrypts returned credentials", async () => {
    const fixture = createFixture();

    const started = await fixture.service.startRegistration(OWNER_ID);

    expect(started).toMatchObject({
      id: REGISTRATION_ID,
      operation: "create",
      status: "waiting_scan",
      qrcode_url: "https://open.feishu.cn/scan/create-bot",
    });
    expect(JSON.stringify(started)).not.toMatch(/registered-secret|client_secret/iu);
    expect(fixture.coordinator.storedSession).not.toContain("registered-secret");

    await vi.waitFor(() => {
      expect(fixture.repository.replaceConnection).toHaveBeenCalledTimes(1);
    });
    const persisted = fixture.repository.replaceConnection.mock.calls[0]?.[0];
    expect(persisted?.encryptedCredentials).not.toContain("registered-secret");
    expect(
      decryptFeishuCredentials(
        {
          ...fixture.connection,
          encryptedCredentials: persisted?.encryptedCredentials ?? "",
        } as never,
        encryption,
      ),
    ).toEqual({
      appId: "cli_0123456789abcdef",
      appSecret: "registered-secret",
      domain: "feishu",
    });
    await expect(
      fixture.service.getRegistration(OWNER_ID, REGISTRATION_ID),
    ).resolves.toMatchObject({
      status: "connected",
      connection: {
        id: CONNECTION_ID,
        bot_name: null,
        account_hint: "****wner",
      },
    });
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        action: "feishu_connection_created",
        targetId: CONNECTION_ID,
      }),
    );
    expect(fixture.runtime.wake).toHaveBeenCalledTimes(1);
    await fixture.service.close();
  });

  it("does not misclassify a successful Feishu update when connection configuration is not ready yet", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner.mockResolvedValue(
      fixture.connection as never,
    );
    fixture.client.preparePersonalAgent.mockRejectedValue(
      new FeishuProtocolError("FEISHU_CONFIGURATION_FAILED"),
    );

    await fixture.service.startRegistration(OWNER_ID);

    await vi.waitFor(async () => {
      await expect(
        fixture.service.getRegistration(OWNER_ID, REGISTRATION_ID),
      ).resolves.toMatchObject({
        operation: "update",
        status: "connected",
        connection: {
          id: CONNECTION_ID,
          runtime_status: "connecting",
        },
      });
    });
    expect(fixture.client.preparePersonalAgent).not.toHaveBeenCalled();
    expect(fixture.runtime.wake).toHaveBeenCalledTimes(1);
    await fixture.service.close();
  });

  it("does not reveal another owner's registration session", async () => {
    const fixture = createFixture({ registrationNeverCompletes: true });
    await fixture.service.startRegistration(OWNER_ID);

    await expect(
      fixture.service.getRegistration(OTHER_OWNER_ID, REGISTRATION_ID),
    ).rejects.toMatchObject({ code: "FEISHU_REGISTRATION_NOT_FOUND" });
    await fixture.service.close();
  });

  it("rejects replacement while the current connection is disconnecting", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner.mockResolvedValue({
      ...fixture.connection,
      status: "disconnecting",
    } as never);

    await expect(
      fixture.service.startRegistration(OWNER_ID),
    ).rejects.toMatchObject({ code: "FEISHU_CONNECTION_CONFLICT" });
    expect(fixture.client.registerPersonalAgent).not.toHaveBeenCalled();
  });

  it("updates the existing official bot instead of creating another app", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner.mockResolvedValue(
      fixture.connection as never,
    );

    const registration = await fixture.service.startRegistration(OWNER_ID);

    expect(registration.operation).toBe("update");
    expect(fixture.client.registerPersonalAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        existingAppId: "cli_0123456789abcdef",
      }),
    );
    await vi.waitFor(() => {
      expect(fixture.client.forgetApp).toHaveBeenCalledWith(
        "cli_0123456789abcdef",
        "feishu",
      );
    });
    await fixture.service.close();
  });

  it("updates the retained official app after LinkSense was disconnected", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionByOwner.mockResolvedValue(null);
    fixture.repository.findAppBindingByOwner.mockResolvedValue({
      id: "50000000-0000-4000-8000-000000000001",
      ownerId: OWNER_ID,
      appId: "cli_0123456789abcdef",
      ownerOpenId: "ou_scanning_owner",
      domain: "feishu",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const registration = await fixture.service.startRegistration(OWNER_ID);

    expect(registration.operation).toBe("update");
    expect(fixture.client.registerPersonalAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        existingAppId: "cli_0123456789abcdef",
      }),
    );
    await fixture.service.close();
  });

  it("creates a replacement app when the retained Feishu app was deleted", async () => {
    const fixture = createFixture();
    fixture.repository.findAppBindingByOwner.mockResolvedValue({
      id: "50000000-0000-4000-8000-000000000001",
      ownerId: OWNER_ID,
      appId: "cli_deleted12345678",
      ownerOpenId: "ou_scanning_owner",
      domain: "feishu",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const registration = await fixture.service.startRegistration(OWNER_ID, {
      forceCreate: true,
    });

    expect(registration.operation).toBe("create");
    expect(fixture.client.registerPersonalAgent).toHaveBeenCalledWith(
      expect.not.objectContaining({ existingAppId: expect.anything() }),
    );
    await vi.waitFor(() => {
      expect(fixture.repository.replaceConnection).toHaveBeenCalledWith(
        expect.objectContaining({ appId: "cli_0123456789abcdef" }),
      );
    });
    await fixture.service.close();
  });

  it("offers existing-app selection when recovering a failed creation", async () => {
    const fixture = createFixture();

    await fixture.service.startRegistration(OWNER_ID, {
      allowExistingSelection: true,
    });

    expect(fixture.client.registerPersonalAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        allowExistingSelection: true,
      }),
    );
    await fixture.service.close();
  });

  it("serializes disconnect with the shared user lifecycle lock", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionForOwner.mockResolvedValue(
      fixture.connection as never,
    );

    await fixture.service.deleteConnection(OWNER_ID, CONNECTION_ID, {
      userAgent: "service-test",
    });

    expect(fixture.coordinator.acquireLease).toHaveBeenCalledWith(
      "user-lifecycle",
      OWNER_ID,
      30_000,
    );
    expect(fixture.repository.markConnectionDisconnecting).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      "active",
    );
    expect(fixture.repository.deleteConnection).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
    );
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "feishu_connection_deleted" }),
    );
  });

  it("disconnects a connection that requires reauthorization", async () => {
    const fixture = createFixture();
    fixture.repository.findConnectionForOwner.mockResolvedValue({
      ...fixture.connection,
      status: "reauthorization_required",
    } as never);

    await fixture.service.deleteConnection(OWNER_ID, CONNECTION_ID, {
      userAgent: "service-test",
    });

    expect(fixture.repository.markConnectionDisconnecting).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      "reauthorization_required",
    );
    expect(fixture.repository.deleteConnection).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
    );
  });
});

function createFixture(
  options: {
    registrationNeverCompletes?: boolean;
  } = {},
) {
  let storedSession: string | null = null;
  let activeRegistration: string | null = null;
  let persistedConnection: typeof connection | null = null;
  const connection = {
    id: CONNECTION_ID,
    ownerId: OWNER_ID,
    appId: "cli_0123456789abcdef",
    ownerOpenId: "ou_scanning_owner",
    botName: null,
    domain: "feishu",
    encryptedCredentials: "",
    encryptionKeyId: encryption.keyId,
    status: "active",
    lastConnectedAt: null,
    lastInboundAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    nextIngestOrder: BigInt(0),
    createdAt: NOW,
    updatedAt: NOW,
  };
  const repository = {
    findConnectionByOwner: vi.fn(async () => null),
    findAppBindingByOwner: vi.fn<
      (ownerId: string) => Promise<FeishuAppBinding | null>
    >(async () => null),
    findConnectionForOwner: vi.fn(async () => persistedConnection),
    getOwnerLocale: vi.fn(async () => "zh-CN" as const),
    replaceConnection: vi.fn(async (input) => {
      persistedConnection = {
        ...connection,
        ...input,
      };
      return persistedConnection;
    }),
    markConnectionDisconnecting: vi.fn(async () => true),
    restoreConnectionStatus: vi.fn(async () => undefined),
    deleteConnection: vi.fn(async () => undefined),
    markApprovalPending: vi.fn(async (_connectionId, errorCode, occurredAt) => {
      if (!persistedConnection) return;
      persistedConnection = {
        ...persistedConnection,
        status: "reauthorization_required",
        lastErrorCode: errorCode,
        lastErrorAt: occurredAt,
      };
    }),
  };
  const coordinator = {
    get storedSession() {
      return storedSession ?? "";
    },
    setRegistrationSession: vi.fn(async (_id, value) => {
      storedSession = value;
    }),
    getRegistrationSession: vi.fn(async () => storedSession),
    replaceActiveRegistration: vi.fn(async (_ownerId, sessionId) => {
      const previous = activeRegistration;
      activeRegistration = sessionId;
      return previous;
    }),
    isActiveRegistration: vi.fn(
      async (_ownerId, sessionId) => activeRegistration === sessionId,
    ),
    clearActiveRegistration: vi.fn(async (_ownerId, sessionId) => {
      if (activeRegistration === sessionId) activeRegistration = null;
    }),
    acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
    releaseLease: vi.fn(async () => undefined),
  };
  const client = {
    forgetApp: vi.fn(),
    preparePersonalAgent: vi.fn(async () => undefined),
    registerPersonalAgent: vi.fn(async (input) => {
      input.onQrCodeReady({
        url: "https://open.feishu.cn/scan/create-bot",
        expireIn: 300,
      });
      if (options.registrationNeverCompletes) {
        await new Promise<void>((resolve) => {
          input.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        throw new Error("aborted");
      }
      return {
        appId: "cli_0123456789abcdef",
        appSecret: "registered-secret",
        ownerOpenId: "ou_scanning_owner",
        domain: "feishu" as const,
      };
    }),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const runtime = { wake: vi.fn() };
  const ids = [REGISTRATION_ID, CONNECTION_ID];
  const service = new FeishuService(
    repository as never as PrismaFeishuRepository,
    coordinator as never as RedisFeishuCoordinator,
    client as never as FeishuOfficialClient,
    audit as never as AuditService,
    encryption,
    runtime,
    () => NOW,
    () => ids.shift() ?? CONNECTION_ID,
  );
  return {
    service,
    repository,
    coordinator,
    client,
    audit,
    runtime,
    connection,
  };
}
