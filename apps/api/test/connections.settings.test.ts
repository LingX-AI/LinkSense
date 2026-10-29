import { describe, expect, it, vi } from "vitest";
import {
  connectionProviderSchema, connectionSettingsStorage,
  type ConnectionProvider, type UpdateConnectionSettings,
} from "@linksense/shared";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { encryptJson } from "../src/lib/crypto.js";
import { ConnectionSettingsService } from "../src/modules/connections/settings.js";
import { SocialSettingsService } from "../src/modules/social-auth/settings.js";
import { testConfig } from "./test-config.js";

const actorId = "00000000-0000-4000-8000-000000000002";
const config = testConfig();
const audit = { ipAddress: "192.0.2.1", userAgent: null };
function fixture() {
  let json: Prisma.JsonObject = {
    system_initialized: true,
    social_authentication_encrypted: encryptJson({
      microsoft: { revision: 4, enabled: false, client_id: "login-app", client_secret: "login-private" },
    }, config.credentialMasterKey, config.credentialKeyId, "linksense:social-authentication:v1"),
  };
  let count = 0;
  const db = {
    $executeRaw: vi.fn(async () => 1),
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson: json })),
      upsert: vi.fn(async (input: { update: { settingsJson: Prisma.JsonObject } }) => { json = input.update.settingsJson; }),
    },
    userConnection: {
      count: vi.fn(async () => count),
      groupBy: vi.fn(async () => [{ provider: "onedrive", _count: { _all: count } }]),
    },
    socialAccount: { count: vi.fn(async () => 0) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = { ...db, $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => run(db) } as unknown as PrismaClient;
  const settings = new ConnectionSettingsService(prisma, config);
  const save = (provider: ConnectionProvider = "onedrive", change: Partial<UpdateConnectionSettings> = {}) => settings.update(provider, {
    expected_revision: 0, client_id: "connector-app", client_secret: "connector-private",
    acknowledge_reauthorization: false, ...change,
  }, actorId, audit);
  return {
    settings, save, db, prisma,
    json: () => json,
    setJson: (value: Prisma.JsonObject) => { json = value; },
    setCount: (value: number) => { count = value; },
  };
}

describe("independent connector configuration", () => {
  it("does not treat existing sign-in credentials as connector configuration", async () => {
    const f = fixture();
    expect(await f.settings.resolve("onedrive")).toBeNull();
    expect((await f.settings.getAdminSettings()).every((item) => !item.secret_configured)).toBe(true);
    expect(f.db.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it.each(connectionProviderSchema.options)("encrypts %s credentials and returns its actual callback and scopes", async (provider) => {
    const f = fixture();
    const before = f.json().social_authentication_encrypted;
    const items = await f.save(provider);
    expect(items.find((item) => item.provider === provider)).toMatchObject({
      revision: 1, client_id: "connector-app", secret_configured: true,
      redirect_uri: `${config.publicBaseUrl}/api/v1/connectors/${provider}/callback`,
      required_scopes: expect.arrayContaining(["openid"]),
    });
    expect(await f.settings.resolve(provider)).toEqual({ revision: 1, client_id: "connector-app", client_secret: "connector-private" });
    expect(await f.settings.resolve(provider === "onedrive" ? "sharepoint" : "onedrive")).toBeNull();
    expect(f.json().system_initialized).toBe(true);
    expect(f.json().social_authentication_encrypted).toBe(before);
    expect(JSON.stringify([items, f.json(), f.db.auditLog.create.mock.calls])).not.toContain("connector-private");
  });

  it("keeps connector credentials unchanged after the login client and secret change", async () => {
    const f = fixture();
    await f.save();
    const social = new SocialSettingsService(f.prisma, config);
    await social.update("microsoft", {
      expected_revision: 4, enabled: true, client_id: "another-login-app", client_secret: "another-login-secret",
    }, actorId, audit);
    expect(await f.settings.resolve("onedrive")).toMatchObject({ client_id: "connector-app", client_secret: "connector-private" });
    expect(await social.resolve("microsoft")).toMatchObject({ client_id: "another-login-app" });
  });

  it("retains an omitted secret, rotates a provided secret and rejects stale updates", async () => {
    const f = fixture();
    await f.save();
    await f.save("onedrive", { expected_revision: 1, client_secret: undefined });
    expect(await f.settings.resolve("onedrive")).toMatchObject({ revision: 2, client_secret: "connector-private" });
    await f.save("onedrive", { expected_revision: 2, client_secret: "rotated-secret" });
    expect(await f.settings.resolve("onedrive")).toMatchObject({ revision: 3, client_secret: "rotated-secret" });
    await expect(f.save()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("requires a secret for a new app and never carries a previous app's secret to a different app", async () => {
    const f = fixture();
    await expect(f.save("onedrive", { client_secret: undefined })).rejects.toMatchObject({ code: "CONNECTION_CLIENT_SECRET_REQUIRED" });
    await f.save();
    await expect(f.save("onedrive", { expected_revision: 1, client_id: "other-app", client_secret: undefined })).rejects.toMatchObject({ code: "CONNECTION_CLIENT_SECRET_REQUIRED" });
    expect(await f.settings.resolve("onedrive")).toMatchObject({ revision: 1, client_id: "connector-app" });
  });

  it("requires acknowledgement before changing an app with existing grants and leaves those grants intact", async () => {
    const f = fixture();
    await f.save();
    f.setCount(2);
    expect((await f.settings.getAdminSettings())[0]?.connected_account_count).toBe(2);
    const update = { expected_revision: 1, client_id: "other-app", client_secret: "other-secret" };
    await expect(f.save("onedrive", update)).rejects.toMatchObject({ code: "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION", params: { count: 2 } });
    expect(await f.settings.resolve("onedrive")).toMatchObject({ revision: 1 });
    await f.save("onedrive", { ...update, acknowledge_reauthorization: true });
    expect(await f.settings.resolve("onedrive")).toMatchObject({ revision: 2, client_id: "other-app" });
    expect(f.db.userConnection.count).toHaveBeenCalledWith({ where: { provider: "onedrive", encryptedPayload: { not: null } } });
  });

  it("rejects corrupt encrypted data rather than falling back to login configuration", async () => {
    const f = fixture();
    f.setJson({ ...f.json(), [connectionSettingsStorage.key]: "damaged-envelope" });
    await expect(f.settings.resolve("onedrive")).rejects.toThrow();
  });

  it("rejects a malformed system settings document rather than masking it as unconfigured", async () => {
    const prisma = { systemSetting: { findUnique: async () => ({ settingsJson: null }) } } as unknown as PrismaClient;
    await expect(new ConnectionSettingsService(prisma, config).resolve("onedrive")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it.each(["https://app.example.test", "http://localhost:18172"])("supports the registered deployment origin %s", async (publicBaseUrl) => {
    const f = fixture();
    const settings = new ConnectionSettingsService(f.prisma, { ...config, publicBaseUrl });
    await expect(settings.update("onedrive", { expected_revision: 0, client_id: "app", client_secret: "secret", acknowledge_reauthorization: false }, actorId, audit)).resolves.toHaveLength(5);
  });

  it.each(["http://app.example.test", "ftp://localhost"])("rejects the invalid callback origin %s before writing configuration", async (publicBaseUrl) => {
    const f = fixture();
    const settings = new ConnectionSettingsService(f.prisma, { ...config, publicBaseUrl });
    await expect(settings.update("onedrive", { expected_revision: 0, client_id: "app", client_secret: "secret", acknowledge_reauthorization: false }, actorId, audit)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.db.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
