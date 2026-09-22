import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "jose"
import {
  appleClientSecret,
  identityFromClaims,
  OpenIdSocialProtocol,
} from "../src/modules/social-auth/protocol.js"

const issuer = "https://accounts.google.com"
const redirect = "https://app.example.test/api/v1/auth/social/google/callback"
const config = {
  revision: 1,
  enabled: true,
  client_id: "test-app",
  client_secret: "test-secret",
}
const checks = {
  state: "state-12345678901234567890",
  nonce: "nonce-12345678901234567890",
  verifier: "a".repeat(43),
}
let pair: Awaited<ReturnType<typeof generateKeyPair>>
beforeAll(async () => {
  pair = await generateKeyPair("RS256")
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function mockProvider(
  overrides: {
    issuer?: string
    audience?: string
    nonce?: string
    expired?: boolean
    wrongKey?: boolean
  } = {},
  providerIssuer = issuer,
) {
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "test-key",
    alg: "RS256",
  }
  const signingKey = overrides.wrongKey
    ? (await generateKeyPair("RS256")).privateKey
    : pair.privateKey
  const token = await new SignJWT({
    nonce: overrides.nonce ?? checks.nonce,
    email: "member@example.test",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? providerIssuer)
    .setAudience(overrides.audience ?? config.client_id)
    .setSubject("stable-subject")
    .setIssuedAt()
    .setExpirationTime(overrides.expired ? "-10m" : "5m")
    .sign(signingKey)
  const requests: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      requests.push({ url, ...(init ? { init } : {}) })
      const json = url.endsWith("openid-configuration")
        ? {
            issuer: providerIssuer,
            authorization_endpoint: `${providerIssuer}/authorize`,
            token_endpoint: `${providerIssuer}/token`,
            jwks_uri: `${providerIssuer}/keys`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
          }
        : url.endsWith("/keys")
          ? { keys: [jwk] }
          : url.endsWith("/token")
            ? {
                access_token: "external-access-token",
                token_type: "Bearer",
                id_token: token,
                expires_in: 300,
              }
            : null
      if (!json) throw new Error(`unexpected provider URL: ${url}`)
      return new Response(JSON.stringify(json), {
        headers: { "content-type": "application/json" },
      })
    }),
  )
  return requests
}

describe("social protocol verification", () => {
  it("uses Microsoft personal-account authority and requires later email verification", async () => {
    const personalIssuer =
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0"
    await mockProvider({}, personalIssuer)
    const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
    expect(
      new URL(await protocol.start("microsoft", config, checks)).pathname,
    ).toContain("9188040d-6c67-4c5b-b112-36a304b66dad")
    expect(
      await protocol.complete(
        "microsoft",
        config,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).toMatchObject({ provider: "microsoft", emailVerified: false })
    await mockProvider(
      { issuer: "https://login.microsoftonline.com/another-tenant/v2.0" },
      personalIssuer,
    )
    await expect(
      protocol.complete(
        "microsoft",
        config,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).rejects.toBeDefined()
  })
  it("requests Apple form_post and validates its POST callback without assuming PKCE support", async () => {
    await mockProvider({}, "https://appleid.apple.com")
    const appleKey = await generateKeyPair("ES256", { extractable: true })
    const appleConfig = {
      ...config,
      client_secret: await exportPKCS8(appleKey.privateKey),
      team_id: "TEAM123456",
      key_id: "KEY1234567",
    }
    const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
    const url = new URL(await protocol.start("apple", appleConfig, checks))
    expect(url.searchParams.get("response_mode")).toBe("form_post")
    expect(url.searchParams.has("code_challenge")).toBe(false)
    expect(
      await protocol.complete(
        "apple",
        appleConfig,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).toMatchObject({ provider: "apple", emailVerified: true })
  })
  it("uses PKCE, state and nonce and validates a signed Google token", async () => {
    const requests = await mockProvider()
    const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
    const url = new URL(await protocol.start("google", config, checks))
    expect(url.searchParams.get("state")).toBe(checks.state)
    expect(url.searchParams.get("nonce")).toBe(checks.nonce)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("redirect_uri")).toBe(redirect)
    expect(
      await protocol.complete(
        "google",
        config,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).toMatchObject({
      provider: "google",
      subject: "stable-subject",
      emailVerified: true,
    })
    const tokenRequest = requests.find((request) =>
      request.url.endsWith("/token"),
    )
    expect(String(tokenRequest?.init?.body)).toContain(
      `code_verifier=${checks.verifier}`,
    )
    expect(requests.some((request) => request.url.endsWith("/keys"))).toBe(true)
  })
  it.each([
    { issuer: "https://attacker.example.test" },
    { audience: "other-client" },
    { nonce: "wrong-nonce" },
    { expired: true },
    { wrongKey: true },
  ])("rejects an invalid token: %j", async (override) => {
    await mockProvider(override)
    const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
    await expect(
      protocol.complete(
        "google",
        config,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).rejects.toBeDefined()
  })
  it("rejects denied consent and state mismatch", async () => {
    await mockProvider()
    const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
    await expect(
      protocol.complete(
        "google",
        config,
        { state: "wrong", code: "code" },
        checks,
      ),
    ).rejects.toBeDefined()
    await expect(
      protocol.complete(
        "google",
        config,
        { state: checks.state, error: "access_denied" },
        checks,
      ),
    ).rejects.toBeDefined()
  })
  it("does not invent verified mailboxes for Microsoft or missing Apple claims", () => {
    expect(
      identityFromClaims("microsoft", "app", {
        sub: "subject",
        email: "member@example.test",
        email_verified: true,
      }),
    ).toMatchObject({ emailVerified: false })
    expect(
      identityFromClaims("microsoft", "app", {
        sub: "subject",
        preferred_username: "member@example.test",
      }),
    ).toMatchObject({ email: null, emailVerified: false })
    expect(
      identityFromClaims("apple", "app", {
        sub: "subject",
        email: "relay@privaterelay.appleid.com",
        email_verified: "true",
      }),
    ).toMatchObject({ emailVerified: true, name: "" })
    expect(() =>
      identityFromClaims("google", "app", { email: "member@example.test" }),
    ).toThrow()
  })
  it("generates a short-lived ES256 Apple secret with correct audience and identity", async () => {
    const appleKey = await generateKeyPair("ES256", { extractable: true })
    const secret = await appleClientSecret({
      ...config,
      client_secret: await exportPKCS8(appleKey.privateKey),
      team_id: "TEAM123456",
      key_id: "KEY1234567",
    })
    const verified = await jwtVerify(secret, appleKey.publicKey, {
      algorithms: ["ES256"],
      issuer: "TEAM123456",
      audience: "https://appleid.apple.com",
      subject: "test-app",
    })
    expect(verified.protectedHeader.kid).toBe("KEY1234567")
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(300)
  })
  it("uses fixed Facebook endpoints and never treats its email as verified", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      return new Response(
        JSON.stringify(
          url.includes("/oauth/access_token")
            ? { access_token: "facebook-access", token_type: "bearer" }
            : {
                id: "facebook-subject",
                name: "Member",
                email: "member@example.test",
              },
        ),
        { headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetch)
    const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
    const facebookConfig = { ...config, graph_api_version: "v24.0" }
    const url = new URL(
      await protocol.start("facebook", facebookConfig, checks),
    )
    expect(url.origin).toBe("https://www.facebook.com")
    expect(url.searchParams.get("scope")).toBe("email,public_profile")
    await expect(
      protocol.complete(
        "facebook",
        facebookConfig,
        { state: checks.state, code: "code" },
        checks,
      ),
    ).resolves.toMatchObject({
      subject: "facebook-subject",
      emailVerified: false,
    })
    expect(String(fetch.mock.calls[1]?.[0])).toContain("appsecret_proof=")
    expect(String(fetch.mock.calls[1]?.[0])).not.toContain("facebook-access")
  })
})
