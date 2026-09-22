import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { SocialProvider } from "@linksense/shared"
import { SocialAuthService } from "../src/modules/social-auth/service.js"
import type { SocialStateStore } from "../src/modules/social-auth/state.js"
import type {
  ProtocolChecks,
  SocialIdentity,
} from "../src/modules/social-auth/protocol.js"
import { SocialFailure } from "../src/modules/social-auth/repository.js"
import { backendI18n, translateBackend } from "../src/lib/i18n.js"

const metadata = { ipAddress: "192.0.2.1", userAgent: null }
const account = {
  userId: "00000000-0000-4000-8000-000000000001",
  authValidAfter: "2026-09-21T00:00:00.000Z",
}
const browser = "browser-proof"

function fixture(provider: SocialProvider = "google") {
  const values = new Map<string, unknown>()
  const states: SocialStateStore = {
    put: async (key, value) => {
      values.set(key, value)
    },
    read: async <T>(
      key: string,
      schema: z.ZodType<T>,
      consume = false,
    ): Promise<T | null> => {
      const value = values.get(key)
      if (consume) values.delete(key)
      return value ? schema.parse(value) : null
    },
    throttle: vi.fn(async () => true),
  }
  const config = {
    enabled: true,
    revision: 1,
    client_id: "app",
    client_secret: "secret",
  }
  const identity: SocialIdentity = {
    provider,
    clientId: "app",
    subject: "subject",
    email: "member@example.test",
    emailVerified: true,
    name: "Member",
  }
  let checks: ProtocolChecks | undefined
  const protocol = {
    start: vi.fn(async (_provider, _config, input: ProtocolChecks) => {
      checks = input
      return "https://accounts.google.com/authorize"
    }),
    complete: vi.fn(async () => identity),
  }
  const repository = {
    find: vi.fn(async () => null as typeof account | null),
    registrationEnabled: vi.fn(async () => true),
    authenticate: vi.fn(async () => account),
    list: vi.fn(async () => []),
    unlink: vi.fn(async () => {}),
  }
  const settings = {
    resolve: vi.fn(async () => config),
    redirectUri: () => "https://app.example.test/callback",
  }
  const mailer = {
    sendRaw: vi
      .fn<
        (message: {
          to: string
          subject: string
          text: string
        }) => Promise<void>
      >()
      .mockResolvedValue(),
  }
  const service = new SocialAuthService({
    states,
    settings,
    protocol,
    repository,
    mailer,
    publicBaseUrl: "https://app.example.test",
  })
  const start = async (
    actor: { id: string; authValidAfter: string } | null = null,
  ) => {
    await service.start(provider, browser, actor, metadata.ipAddress)
    if (!checks) throw new Error("missing checks")
    return { state: checks.state, code: "code" }
  }
  return {
    service,
    identity,
    protocol,
    repository,
    settings,
    config,
    states,
    mailer,
    start,
  }
}

describe("social authorization and registration", () => {
  it.each(["google", "apple", "microsoft", "facebook"] as const)(
    "completes %s identity without changing enterprise login",
    async (provider) => {
      const f = fixture(provider)
      const params = await f.start()
      expect(
        await f.service.complete(provider, params, browser, metadata),
      ).toMatchObject({ result: "success", account, provider })
      expect(f.repository.authenticate).toHaveBeenCalledWith(
        f.identity,
        1,
        null,
        metadata,
      )
      await expect(
        f.service.complete(provider, params, browser, metadata),
      ).rejects.toMatchObject({ result: "failed" })
    },
  )
  it.each(["browser", "provider", "revision", "disabled"])(
    "rejects %s mismatch before token exchange",
    async (kind) => {
      const f = fixture()
      const params = await f.start()
      if (kind === "revision") f.config.revision++
      if (kind === "disabled") f.config.enabled = false
      await expect(
        f.service.complete(
          kind === "provider" ? "apple" : "google",
          params,
          kind === "browser" ? "other" : browser,
          metadata,
        ),
      ).rejects.toBeDefined()
      expect(f.protocol.complete).not.toHaveBeenCalled()
      expect(f.repository.authenticate).not.toHaveBeenCalled()
    },
  )
  it("rejects a provider adapter returning an identity for another client", async () => {
    const f = fixture()
    const params = await f.start()
    f.identity.clientId = "different-client"
    await expect(
      f.service.complete("google", params, browser, metadata),
    ).rejects.toMatchObject({ result: "failed" })
  })
  it("requires verification for unverified first-time email but not an existing binding", async () => {
    const f = fixture("microsoft")
    f.identity.emailVerified = false
    expect(
      await f.service.complete("microsoft", await f.start(), browser, metadata),
    ).toMatchObject({ result: "verify_email" })
    expect(f.repository.authenticate).not.toHaveBeenCalled()
    f.repository.find.mockResolvedValue(account)
    expect(
      await f.service.complete("microsoft", await f.start(), browser, metadata),
    ).toMatchObject({ result: "success" })
  })
  it("allows linking without an email, binding the initiating user and revocation stamp", async () => {
    const f = fixture("facebook")
    f.identity.email = null
    f.identity.emailVerified = false
    const actor = { id: account.userId, authValidAfter: account.authValidAfter }
    expect(
      await f.service.complete(
        "facebook",
        await f.start(actor),
        browser,
        metadata,
      ),
    ).toMatchObject({ result: "linked" })
    expect(f.repository.authenticate).toHaveBeenCalledWith(
      f.identity,
      1,
      actor,
      metadata,
    )
  })
  it("does not offer email signup when registration is closed", async () => {
    const f = fixture()
    f.identity.emailVerified = false
    f.repository.registrationEnabled.mockResolvedValue(false)
    await expect(
      f.service.complete("google", await f.start(), browser, metadata),
    ).rejects.toMatchObject({ result: "registration_disabled" })
  })
  it("preserves explicit same-email collision instead of automatically linking", async () => {
    const f = fixture()
    f.repository.authenticate.mockRejectedValue(
      new SocialFailure("email_exists"),
    )
    await expect(
      f.service.complete("google", await f.start(), browser, metadata),
    ).rejects.toMatchObject({ result: "email_exists" })
  })
  it("requires a one-use email proof in the original browser", async () => {
    const f = fixture("facebook")
    f.identity.emailVerified = false
    const pendingResult = await f.service.complete(
      "facebook",
      await f.start(),
      browser,
      metadata,
    )
    if (pendingResult.result !== "verify_email")
      throw new Error("expected verification")
    await f.service.sendVerification(
      pendingResult.pending,
      browser,
      "verified@example.test",
      "zh-CN",
      metadata.ipAddress,
    )
    const message = f.mailer.sendRaw.mock.calls[0]?.[0]
    const url = z.string().parse(message?.text.split("\n\n").at(-1))
    const token =
      new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? ""
    expect(url).not.toContain("?token=")
    await expect(
      f.service.verifyEmail(token, pendingResult.pending, browser, metadata),
    ).resolves.toMatchObject({ result: "success" })
    expect(f.repository.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "verified@example.test",
        emailVerified: true,
      }),
      1,
      null,
      metadata,
    )
    await expect(
      f.service.verifyEmail(token, pendingResult.pending, browser, metadata),
    ).rejects.toBeDefined()
  })
  it("does not send email from a different browser or when throttled", async () => {
    const f = fixture()
    f.identity.email = null
    const result = await f.service.complete(
      "google",
      await f.start(),
      browser,
      metadata,
    )
    if (result.result !== "verify_email")
      throw new Error("expected verification")
    await expect(
      f.service.sendVerification(
        result.pending,
        "wrong",
        "verified@example.test",
        "en-US",
        metadata.ipAddress,
      ),
    ).rejects.toBeDefined()
    vi.mocked(f.states.throttle).mockResolvedValue(false)
    await expect(
      f.service.sendVerification(
        result.pending,
        browser,
        "verified@example.test",
        "en-US",
        metadata.ipAddress,
      ),
    ).rejects.toBeDefined()
    expect(f.mailer.sendRaw).not.toHaveBeenCalled()
  })
  it("provides Chinese, English and missing-locale fallback mail translations", () => {
    expect(translateBackend("mail.socialVerification.subject", "zh-CN")).toBe(
      "验证您的注册邮箱",
    )
    expect(translateBackend("mail.socialVerification.subject", "en-US")).toBe(
      "Verify your registration email",
    )
    expect(
      backendI18n.t("mail.socialVerification.subject", { lng: "de-DE" }),
    ).toBe("验证您的注册邮箱")
    expect(
      translateBackend("mail.socialVerification.text", "zh-CN", {
        url: "https://example.test",
      }),
    ).toContain("https://example.test")
  })
})
