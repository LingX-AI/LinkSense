import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { SamlSettingsService } from "../src/modules/saml/settings.js";
import { AuthenticationSettingsService } from "../src/modules/system/authentication-settings.js";
import { encryptJson } from "../src/lib/crypto.js";
import { samlConfigurationFieldsSchema } from "@linksense/shared";
import {
  samlCertificate,
  samlConfiguration,
  SAML_NOW,
} from "./saml-fixture.js";
import { testConfig } from "./test-config.js";

let certificate: Awaited<ReturnType<typeof samlCertificate>>;
beforeAll(async () => {
  certificate = await samlCertificate();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SAML_NOW);
});
afterEach(() => vi.useRealTimers());
function fixture(initial: Prisma.JsonObject = {}) {
  let json = initial;
  const audit = vi.fn(async () => ({}));
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson: json })),
      upsert: vi.fn(
        async ({ update }: { update: { settingsJson: Prisma.JsonObject } }) => {
          json = update.settingsJson;
          return {};
        },
      ),
    },
    auditLog: { create: audit },
  };
  const prisma = {
    ...transaction,
    $transaction: async <T>(fn: (tx: typeof transaction) => Promise<T>) =>
      fn(transaction),
  } as unknown as PrismaClient;
  const service = new SamlSettingsService(prisma, testConfig());
  const config = samlConfiguration(certificate.cert);
  const fields = samlConfigurationFieldsSchema.strip().parse(config);
  const input = { ...fields, expected_revision: config.revision - 1 };
  return { service, prisma, input, audit, json: () => json };
}
describe("SAML settings persistence", () => {
  it("keeps pre-SAML OIDC, Teams, product and social settings usable after saving SAML", async () => {
    const config = testConfig();
    const oldAuth = encryptJson(
      {
        version: 1,
        oidc: {
          mode: "managed",
          revision: 3,
          issuerUrl: "https://idp.example.test",
          clientId: "old-client",
          clientSecret: "old-test-secret",
        },
        teams: { mode: "disabled", revision: 1 },
      },
      config.credentialMasterKey,
      config.credentialKeyId,
      "linksense:authentication-settings:v1",
    );
    const existing = {
      organization_display_name: "Existing organization",
      authentication_settings_encrypted: oldAuth,
      authentication_settings_key_id: config.credentialKeyId,
      social_authentication_encrypted: "untouched-other-module",
    };
    const f = fixture(existing);
    expect(await f.service.getAdminSettings()).toMatchObject({
      enabled: false,
      revision: 0,
      status: "not_configured",
    });
    await f.service.update(f.input, "admin-id", {});
    expect(f.json()).toMatchObject(existing);
    const oldReader = new AuthenticationSettingsService(f.prisma, config);
    expect(await oldReader.resolveOidc()).toMatchObject({
      status: "configured",
      revision: 3,
      configuration: {
        clientId: "old-client",
        clientSecret: "old-test-secret",
      },
    });
    expect(await oldReader.resolveTeams()).toMatchObject({
      mode: "disabled",
      revision: 1,
    });
  });
  it("encrypts signing keys, redacts responses and audit data, and preserves blank keys on update", async () => {
    const f = fixture();
    const saved = await f.service.update(
      {
        ...f.input,
        sign_requests: true,
        signing_certificate: certificate.cert,
        signing_private_key: certificate.private,
      },
      "admin-id",
      {},
    );
    expect(saved).toMatchObject({
      revision: 1,
      status: "configured",
      signing_private_key_configured: true,
    });
    for (const output of [
      JSON.stringify(saved),
      JSON.stringify(f.json()),
      JSON.stringify(f.audit.mock.calls),
    ])
      expect(output).not.toContain(certificate.private.slice(0, 50));
    const updated = await f.service.update(
      {
        ...f.input,
        expected_revision: 1,
        sign_requests: true,
        signing_certificate: certificate.cert,
        name_attribute: "",
      },
      "admin-id",
      {},
    );
    expect(updated).toMatchObject({
      revision: 2,
      signing_private_key_configured: true,
    });
    expect((await f.service.resolve())?.signing_private_key).toBe(
      certificate.private.trim(),
    );
    await f.service.update(
      { ...f.input, expected_revision: 2 },
      "admin-id",
      {},
    );
    expect(await f.service.resolve()).toMatchObject({
      signing_private_key: "",
      signing_certificate: "",
    });
  });
  it("rejects stale revisions, invalid certificates and mismatched signing keys without saving", async () => {
    const f = fixture();
    await expect(
      f.service.update({ ...f.input, expected_revision: 5 }, "admin-id", {}),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.service.update(
        { ...f.input, idp_certificate: "invalid" },
        "admin-id",
        {},
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      f.service.update(
        {
          ...f.input,
          sign_requests: true,
          signing_certificate: certificate.cert,
          signing_private_key: "invalid",
        },
        "admin-id",
        {},
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.json()).toEqual({});
    expect(f.audit).not.toHaveBeenCalled();
  });
  it("fails closed for corrupt configuration, expired certificates and non-HTTPS sites", async () => {
    const broken = fixture({ saml_authentication_encrypted: "invalid" });
    await expect(broken.service.resolve()).rejects.toThrow();
    const f = fixture();
    await f.service.update(f.input, "admin-id", {});
    vi.setSystemTime(new Date("2028-01-01T00:00:00Z"));
    expect(await f.service.getAdminSettings()).toMatchObject({
      status: "invalid",
    });
    const http = new SamlSettingsService(
      f.prisma,
      testConfig({ LINKSENSE_PUBLIC_BASE_URL: "http://localhost:18173" }),
    );
    await expect(
      http.update({ ...f.input, expected_revision: 1 }, "admin-id", {}),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await f.service.update(
      { ...f.input, expected_revision: 1, enabled: false },
      "admin-id",
      {},
    );
    expect(await f.service.getAdminSettings()).toMatchObject({
      enabled: false,
      status: "not_configured",
    });
  });
});
