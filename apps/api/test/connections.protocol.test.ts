import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  MicrosoftConnectionProtocol,
  personalMicrosoftTenant,
} from "../src/modules/connections/protocol.js";

const tenant = "00000000-0000-4000-8000-000000000001";
const settings = {
  revision: 1,
  enabled: true,
  client_id: "test-client",
  client_secret: "test-only-secret",
};
const checks = { state: "state-test", nonce: "nonce-test", verifier: "a".repeat(43) };
const base = "https://login.microsoftonline.com";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
});
afterEach(() => vi.unstubAllGlobals());
async function mockProvider(
  options: {
    tid?: string;
    issuer?: string;
    audience?: string;
    nonce?: string;
    scopes?: string;
    refresh?: boolean;
    noRefresh?: boolean;
    error?: string;
  } = {},
) {
  const tid = options.tid ?? tenant;
  const jwt = await new SignJWT({
    tid,
    nonce: options.nonce ?? checks.nonce,
    preferred_username: "member@example.test",
  })
    .setProtectedHeader({ alg: "RS256", kid: "key" })
    .setIssuer(options.issuer ?? `${base}/${tid}/v2.0`)
    .setAudience(options.audience ?? settings.client_id)
    .setSubject("account")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "key", alg: "RS256" };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push({ url, ...(init ? { init } : {}) });
      const authority = url.includes("/organizations/") ? "organizations" : "common";
      if (url.endsWith("openid-configuration"))
        return Response.json({
          issuer: `${base}/{tenantid}/v2.0`,
          authorization_endpoint: `${base}/${authority}/oauth2/v2.0/authorize`,
          token_endpoint: `${base}/${authority}/oauth2/v2.0/token`,
          jwks_uri: `${base}/common/keys`,
          response_types_supported: ["code"],
          subject_types_supported: ["pairwise"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
      if (options.error)
        return Response.json(
          { error: options.error, error_description: "private provider detail" },
          { status: 400 },
        );
      return Response.json({
        token_type: "Bearer",
        access_token: "access-secret",
        ...(options.noRefresh ? {} : { refresh_token: "refresh-secret" }),
        ...(options.refresh ? {} : { id_token: jwt }),
        expires_in: 3600,
        scope: options.scopes ?? "openid profile Files.ReadWrite Files.ReadWrite.All Sites.Read.All",
      });
    }),
  );
  return requests;
}
describe("Microsoft delegated authorization protocol", () => {
  it("refreshes pre-upgrade read grants without requesting any additional write scope", async () => {
    const requests = await mockProvider({ refresh: true, scopes: "Files.Read" });
    const protocol = new MicrosoftConnectionProtocol("https://app.example.test");
    const refreshed = await protocol.refresh("onedrive", settings, {
      clientId: settings.client_id, accountId: "account", tenantId: personalMicrosoftTenant,
      accessToken: "old", refreshToken: "test-refresh", expiresAt: 1, scopes: ["Files.Read"],
    });
    expect(refreshed.scopes).toEqual(["Files.Read"]);
    const body = requests.find((request) => request.url.endsWith("/token"))?.init?.body;
    expect(String(body)).toContain("scope=Files.Read+offline_access");
    expect(String(body)).not.toContain("ReadWrite");
  });
  it("uses common for OneDrive, organizations for SharePoint and the required delegated file read/write scopes", async () => {
    await mockProvider();
    const protocol = new MicrosoftConnectionProtocol("https://app.example.test");
    const one = new URL(await protocol.start("onedrive", settings, checks));
    const share = new URL(await protocol.start("sharepoint", settings, checks));
    expect(one.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(share.pathname).toBe("/organizations/oauth2/v2.0/authorize");
    expect(one.searchParams.get("scope")).toBe(
      "openid profile offline_access User.Read Files.ReadWrite",
    );
    expect(share.searchParams.get("scope")).toBe(
      "openid profile offline_access User.Read Sites.Read.All Files.ReadWrite.All",
    );
    expect(share.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test/api/v1/connectors/sharepoint/callback",
    );
    expect(one.searchParams.get("code_challenge_method")).toBe("S256");
    expect(one.searchParams.get("code_challenge")).toHaveLength(43);
  });
  it.each([tenant, personalMicrosoftTenant])(
    "accepts a signed token from allowed tenant %s for OneDrive",
    async (tid) => {
      await mockProvider({ tid });
      const protocol = new MicrosoftConnectionProtocol("https://app.example.test");
      expect(
        await protocol.complete(
          "onedrive",
          settings,
          { state: checks.state, code: "code" },
          checks,
        ),
      ).toMatchObject({
        accountName: "member@example.test",
        token: { tenantId: tid, accessToken: "access-secret", refreshToken: "refresh-secret" },
      });
    },
  );
  it.each([
    { nonce: "wrong" },
    { audience: "other-app" },
    { issuer: `${base}/${personalMicrosoftTenant}/v2.0` },
    { noRefresh: true },
    { scopes: "User.Read" },
  ])("rejects invalid tokens and missing consent: %j", async (overrides) => {
    await mockProvider(overrides);
    await expect(
      new MicrosoftConnectionProtocol("https://app.example.test").complete(
        "onedrive",
        settings,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).rejects.toBeDefined();
  });
  it("rejects a personal Microsoft account for SharePoint", async () => {
    await mockProvider({ tid: personalMicrosoftTenant });
    await expect(
      new MicrosoftConnectionProtocol("https://app.example.test").complete(
        "sharepoint",
        settings,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_AUTH_FAILED" });
  });
  it("keeps a valid refresh token when Microsoft does not rotate it and handles revoked grants", async () => {
    const token = {
      clientId: settings.client_id,
      accountId: "account",
      tenantId: tenant,
      accessToken: "old",
      refreshToken: "previous-refresh",
      expiresAt: 1,
      scopes: ["Files.Read"],
    };
    await mockProvider({ refresh: true, noRefresh: true });
    const protocol = new MicrosoftConnectionProtocol("https://app.example.test", () => 1000);
    expect(await protocol.refresh("onedrive", settings, token)).toMatchObject({
      refreshToken: "previous-refresh",
      accessToken: "access-secret",
      expiresAt: 3_601_000,
    });
    await mockProvider({ error: "invalid_grant" });
    await expect(protocol.refresh("onedrive", settings, token)).rejects.toMatchObject({
      code: "CONNECTION_REQUIRED",
    });
  });
});
