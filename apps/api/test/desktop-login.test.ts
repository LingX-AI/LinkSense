import { createHash } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { desktopLoginRedirectUri, type DesktopLoginAuthorizeInput } from "@linksense/shared"
import { DesktopLoginService, RedisDesktopLoginStore, type DesktopLoginStore } from "../src/modules/auth/desktop-login.js"
import type { AuthSession } from "../src/modules/auth/service.js"
import type { AuthenticatedUser } from "../src/modules/auth/types.js"
import { createRedisFixture } from "./fixtures/redis.js"

const user: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-000000000001", email: "person@example.com", name: "Person",
  role: "user", status: "active", avatarObjectKey: null, preferredLocale: "en-US",
  runningMessageAction: "queue", lastLoginAt: null, lastLoginMethod: "oidc", passwordUpdatedAt: null,
  authValidAfter: new Date("2026-07-01T00:00:00.123Z"),
  createdAt: new Date("2026-07-01T00:00:00Z"), updatedAt: new Date("2026-07-01T00:00:00Z"),
}
const verifier = "v".repeat(43)
const challenge = createHash("sha256").update(verifier).digest("base64url")
const request: DesktopLoginAuthorizeInput = {
  redirect_uri: desktopLoginRedirectUri,
  state: "s".repeat(43), code_challenge: challenge, code_challenge_method: "S256",
}
const metadata = { ipAddress: "192.0.2.1", userAgent: "Native test" }
const session: AuthSession = {
  accessToken: "a".repeat(48), refreshToken: "r".repeat(48), user,
  accessTokenExpiresAt: new Date("2026-07-02T00:00:00Z"),
  refreshSessionExpiresAt: new Date("2026-08-01T00:00:00Z"),
}
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(close => close())) })

async function fixture() {
  const redis = await createRedisFixture()
  cleanups.push(redis.close)
  const store = new RedisDesktopLoginStore(redis)
  const auth = { createDesktopSession: vi.fn(async () => session) }
  return { redis: redis.client, store, auth, service: new DesktopLoginService(auth, store) }
}

describe("desktop browser login", () => {
  it("stores only a hashed, expiring authorization code and consumes it once across API replicas", async () => {
    const f = await fixture()
    const { code } = await f.service.authorize(request, user, metadata)
    const keys = await f.redis.keys("linksense:desktop-login:code:*")
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain(code)
    expect(await f.redis.ttl(keys[0]!)).toBeGreaterThan(0)
    expect(await f.redis.ttl(keys[0]!)).toBeLessThanOrEqual(60)
    const raw = await f.redis.get(keys[0]!)
    expect(raw).not.toContain(code)
    expect(raw).not.toContain(verifier)
    expect(raw).not.toContain(session.refreshToken)
    const replica = new DesktopLoginService(f.auth, new RedisDesktopLoginStore({ client: f.redis }))
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? replica : f.service).exchange({
        code, code_verifier: verifier, redirect_uri: request.redirect_uri,
      }, metadata)))
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(f.auth.createDesktopSession).toHaveBeenCalledExactlyOnceWith(
      user.id, user.email, user.authValidAfter.toISOString(), metadata,
    )
  })

  it("rejects a stolen code without consuming it when the verifier is wrong", async () => {
    const f = await fixture()
    const { code } = await f.service.authorize(request, user, metadata)
    await expect(f.service.exchange({
      code, code_verifier: "w".repeat(43), redirect_uri: request.redirect_uri,
    }, metadata)).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" })
    expect(f.auth.createDesktopSession).not.toHaveBeenCalled()
    await expect(f.service.exchange({ code, code_verifier: verifier, redirect_uri: request.redirect_uri }, metadata)).resolves.toBe(session)
  })

  it("rejects expired or malformed grants before creating a session", async () => {
    const f = await fixture()
    const { code } = await f.service.authorize(request, user, metadata)
    const key = (await f.redis.keys("linksense:desktop-login:code:*"))[0]!
    await f.redis.pexpireat(key, 1)
    await expect(f.service.exchange({ code, code_verifier: verifier, redirect_uri: request.redirect_uri }, metadata))
      .rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" })
    await f.redis.set(key, "{", "EX", 60)
    await expect(f.service.exchange({ code, code_verifier: verifier, redirect_uri: request.redirect_uri }, metadata))
      .rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" })
    expect(f.auth.createDesktopSession).not.toHaveBeenCalled()
  })

  it("bounds request admission and fails closed when rate protection is unavailable", async () => {
    const f = await fixture()
    const results = await Promise.all(Array.from({ length: 61 }, () => f.store.takeRequest("test:ip")))
    expect(results.filter(Boolean)).toHaveLength(60)
    const save = vi.fn(async () => undefined)
    const store: DesktopLoginStore = {
      save, consume: vi.fn(async () => null),
      takeRequest: vi.fn(async () => { throw new Error("redis down") }),
    }
    const service = new DesktopLoginService(f.auth, store)
    await expect(service.authorize(request, user, metadata))
      .rejects.toMatchObject({ code: "AUTH_LOGIN_PROTECTION_UNAVAILABLE" })
    expect(save).not.toHaveBeenCalled()
    vi.mocked(store.takeRequest).mockResolvedValue(false)
    await expect(service.exchange({
      code: "c".repeat(43), code_verifier: verifier, redirect_uri: request.redirect_uri,
    }, metadata)).rejects.toMatchObject({ code: "AUTH_LOGIN_RATE_LIMITED", retryAfterSeconds: 60 })
  })
})
