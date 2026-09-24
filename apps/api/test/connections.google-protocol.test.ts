import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { GoogleConnectionProtocol } from "../src/modules/connections/google-protocol.js";
import { connectionScopes } from "../src/modules/connections/protocol.js";

const googleDocsScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.readonly",
];

const settings = {
  revision: 1,
  enabled: true,
  client_id: "test-google-client",
  client_secret: "test-only-secret",
};
const checks = {
  state: "state-test",
  nonce: "nonce-test",
  verifier: "a".repeat(43),
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
});
afterEach(() => vi.unstubAllGlobals());
async function mockProvider(
  options: {
    nonce?: string;
    audience?: string;
    verified?: boolean;
    scopes?: string;
    noRefresh?: boolean;
    error?: string;
  } = {},
) {
  const token = await new SignJWT({
    nonce: options.nonce ?? checks.nonce,
    email: "owner@example.test",
    email_verified: options.verified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(options.audience ?? settings.client_id)
    .setSubject("google-account")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "key",
    alg: "RS256",
  };
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("openid-configuration"))
      return Response.json({
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.endsWith("/certs")) return Response.json({ keys: [jwk] });
    if (options.error)
      return Response.json(
        { error: options.error, error_description: "private provider detail" },
        { status: 400 },
      );
    return Response.json({
      token_type: "Bearer",
      access_token: "test-access",
      ...(options.noRefresh ? {} : { refresh_token: "test-refresh" }),
      expires_in: 3600,
      id_token: token,
      scope: options.scopes ?? connectionScopes.google_docs.join(" "),
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("Google per-service OAuth", () => {
  it("requests only document read/write and Drive read access without redundant per-file access", async () => {
    await mockProvider();
    const url = new URL(await new GoogleConnectionProtocol("https://app.example.test").start("google_docs", settings, checks));
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(googleDocsScopes);
  });
  it("completes and refreshes a document grant without requiring drive.file", async () => {
    await mockProvider({ scopes: googleDocsScopes.join(" ") });
    const protocol = new GoogleConnectionProtocol("https://app.example.test");
    const result = await protocol.complete("google_docs", settings, { state: checks.state, code: "code" }, checks);
    expect(result.token.scopes).toEqual(googleDocsScopes);
    const refreshed = await protocol.refresh("google_docs", settings, result.token);
    expect(refreshed.scopes).toEqual(googleDocsScopes);
  });
  it("keeps existing grants with the additional drive.file scope usable", async () => {
    const scopes = [...googleDocsScopes, "https://www.googleapis.com/auth/drive.file"];
    await mockProvider({ scopes: scopes.join(" ") });
    const protocol = new GoogleConnectionProtocol("https://app.example.test");
    const result = await protocol.complete("google_docs", settings, { state: checks.state, code: "code" }, checks);
    expect((await protocol.refresh("google_docs", settings, result.token)).scopes).toEqual(scopes);
  });
  it.each(["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.readonly"])(
    "rejects a document grant missing required scope %s even if drive.file is present",
    async (missingScope) => {
      await mockProvider({ scopes: [...googleDocsScopes.filter(scope => scope !== missingScope), "https://www.googleapis.com/auth/drive.file"].join(" ") });
      await expect(new GoogleConnectionProtocol("https://app.example.test").complete("google_docs", settings, { state: checks.state, code: "code" }, checks)).rejects.toMatchObject({ code: "CONNECTION_AUTH_FAILED" });
    },
  );
  it.each(["google_docs", "gmail"] as const)(
    "uses separate callback and least required scopes for %s with PKCE",
    async (provider) => {
      await mockProvider();
      const url = new URL(
        await new GoogleConnectionProtocol("https://app.example.test").start(
          provider,
          settings,
          checks,
        ),
      );
      expect(url.searchParams.get("redirect_uri")).toBe(
        `https://app.example.test/api/v1/connectors/${provider}/callback`,
      );
      expect(url.searchParams.get("scope")).toBe(
        connectionScopes[provider].join(" "),
      );
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent select_account");
    },
  );
  it("accepts signed verified Google identities without a Microsoft tenant field", async () => {
    await mockProvider();
    const result = await new GoogleConnectionProtocol(
      "https://app.example.test",
    ).complete(
      "google_docs",
      settings,
      { state: checks.state, code: "code" },
      checks,
    );
    expect(result).toMatchObject({
      accountName: "owner@example.test",
      token: {
        accountId: "google-account",
        accessToken: "test-access",
        refreshToken: "test-refresh",
      },
    });
    expect(result.token).not.toHaveProperty("tenantId");
  });
  it.each([
    { nonce: "wrong" },
    { audience: "other-app" },
    { verified: false },
    { scopes: "openid email" },
    { noRefresh: true },
  ])("rejects invalid claims or missing grant %j", async (options) => {
    await mockProvider(options);
    await expect(
      new GoogleConnectionProtocol("https://app.example.test").complete(
        "google_docs",
        settings,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).rejects.toBeDefined();
  });
  it("preserves refresh tokens and maps revoked access to reconnect without provider details", async () => {
    const current = {
      clientId: settings.client_id,
      accountId: "account",
      accessToken: "old",
      refreshToken: "previous",
      expiresAt: 1,
      scopes: [...connectionScopes.google_docs],
    };
    const protocol = new GoogleConnectionProtocol(
      "https://app.example.test",
      () => 1000,
    );
    await mockProvider({ noRefresh: true });
    expect(
      await protocol.refresh("google_docs", settings, current),
    ).toMatchObject({ refreshToken: "previous", expiresAt: 3601000 });
    await mockProvider({ error: "invalid_grant" });
    await expect(
      protocol.refresh("google_docs", settings, current),
    ).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
  });
});
