import { afterEach, describe, expect, it, vi } from "vitest"
import { calculatePKCECodeChallenge } from "openid-client"
import { OpenIdSocialProtocol } from "../src/modules/social-auth/protocol.js"

const config = {
  revision: 1,
  enabled: true,
  client_id: "github-app",
  client_secret: "github-secret",
}
const checks = {
  state: "state-12345678901234567890",
  nonce: "unused-nonce",
  verifier: "a".repeat(43),
}
const redirect =
  "https://app.example.test/api/v1/auth/social/github/callback"
const protocol = new OpenIdSocialProtocol({ redirectUri: () => redirect })
const complete = (params: Record<string, string> = {
  code: "one-use-code",
  state: checks.state,
  iss: "https://github.com/login/oauth",
}) =>
  protocol.complete("github", config, params, checks)
const primary = {
  email: "Primary@Example.test",
  primary: true,
  verified: true,
}

function mockGitHub(
  options: {
    profile?: unknown
    emails?: unknown
    failure?: "token" | "profile" | "emails"
  } = {},
) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      requests.push({ url, ...(init ? { init } : {}) })
      const endpoint =
        url === "https://github.com/login/oauth/access_token"
          ? "token"
          : url === "https://api.github.com/user"
            ? "profile"
            : url === "https://api.github.com/user/emails?per_page=100"
              ? "emails"
              : null
      if (!endpoint) throw new Error("Unexpected endpoint")
      const data =
        options.failure === endpoint
          ? { error: "access_denied" }
          : endpoint === "token"
            ? {
                access_token: "github-access-token",
                token_type: "bearer",
                scope: "user:email",
              }
            : endpoint === "profile"
              ? (options.profile ?? {
                  id: 12345,
                  login: "member",
                  name: null,
                  email: "untrusted@example.test",
                })
              : (options.emails ?? [primary])
      return new Response(JSON.stringify(data), {
        status: options.failure === endpoint ? 403 : 200,
        headers: { "content-type": "application/json" },
      })
    }),
  )
  return requests
}
afterEach(() => vi.unstubAllGlobals())

describe("GitHub OAuth login", () => {
  it("requests only email access with state and S256 PKCE, without OIDC claims", async () => {
    const url = new URL(await protocol.start("github", config, checks))
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    )
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.client_id,
      redirect_uri: redirect,
      scope: "user:email",
      state: checks.state,
      code_challenge_method: "S256",
      code_challenge: await calculatePKCECodeChallenge(checks.verifier),
    })
    expect(url.searchParams.has("nonce")).toBe(false)
    expect(url.toString()).not.toContain(config.client_secret)
  })
  it("exchanges a code with PKCE and uses the immutable ID and verified primary email", async () => {
    const requests = mockGitHub({
      emails: [
        { email: "secondary@example.test", primary: false, verified: true },
        primary,
      ],
    })
    const identity = await complete()
    expect(identity).toEqual({
      provider: "github",
      clientId: config.client_id,
      subject: "12345",
      name: "member",
      email: "primary@example.test",
      emailVerified: true,
    })
    const token = requests[0]
    expect(
      new URLSearchParams(String(token?.init?.body)).get("code_verifier"),
    ).toBe(checks.verifier)
    expect(
      new URLSearchParams(String(token?.init?.body)).get("redirect_uri"),
    ).toBe(redirect)
    expect(new Headers(token?.init?.headers).get("accept")).toBe(
      "application/json",
    )
    for (const request of requests.slice(1)) {
      expect(request.url).not.toContain("github-access-token")
      expect(request.init?.redirect).toBe("error")
      expect(request.init?.signal).toBeInstanceOf(AbortSignal)
      expect(new Headers(request.init?.headers).get("authorization")).toBe(
        "Bearer github-access-token",
      )
    }
    expect(JSON.stringify(identity)).not.toContain("github-access-token")
  })
  it.each([
    { emails: [] },
    { emails: [{ ...primary, verified: false }] },
    { emails: [{ ...primary, email: "not-an-email" }] },
  ])(
    "requires LinkSense email verification when no valid verified mailbox exists: %j",
    async (options) => {
      mockGitHub(options)
      expect(await complete()).toMatchObject({
        email: null,
        emailVerified: false,
      })
    },
  )
  it("uses a verified secondary email when the primary is unverified", async () => {
    mockGitHub({
      emails: [
        { ...primary, verified: false },
        { email: "verified@example.test", primary: false, verified: true },
      ],
    })
    expect(await complete()).toMatchObject({
      email: "verified@example.test",
      emailVerified: true,
    })
  })
  it("keeps the same identity when the user renames their GitHub account", async () => {
    mockGitHub({
      profile: { id: 12345, login: "renamed-member", name: "Renamed" },
    })
    expect(await complete()).toMatchObject({
      subject: "12345",
      name: "Renamed",
    })
  })
  it.each(["token", "profile", "emails"] as const)(
    "rejects failed %s responses",
    async (failure) => {
      mockGitHub({ failure })
      await expect(complete()).rejects.toBeDefined()
    },
  )
  it.each([
    { code: "code", state: "wrong-state" },
    { code: "", state: checks.state, error: "access_denied" },
    { code: "code", state: checks.state, iss: "https://attacker.example.test" },
    { code: "code", state: checks.state, iss: "https://github.com" },
  ])(
    "rejects invalid callbacks before making external requests",
    async (params) => {
      const requests = mockGitHub()
      await expect(complete(params)).rejects.toBeDefined()
      expect(requests).toHaveLength(0)
    },
  )
  it.each([
    { profile: { id: "member", login: "member" } },
    { profile: { id: Number.MAX_SAFE_INTEGER + 1, login: "member" } },
    { emails: [{ ...primary, verified: "true" }] },
  ])("rejects malformed identity data: %j", async (options) => {
    mockGitHub(options)
    await expect(complete()).rejects.toBeDefined()
  })
})
