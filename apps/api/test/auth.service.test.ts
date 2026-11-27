import { describe, expect, it, vi } from "vitest";

import {
  AuthService,
  createFastifyAccessTokenIssuer,
  LoginRateLimitedError,
  PASSWORD_RESET_MINIMUM_RESPONSE_MS,
} from "../src/modules/auth/service.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "../src/config.js";
import type {
  AccessTokenIssuer,
  AuditWriter,
  AuthPersistence,
  AuthRateLimiter,
  AuthUserRecord,
  OidcFlow,
  PasswordHasher,
  PasswordMailGateway,
  TeamsTokenVerifier,
} from "../src/modules/auth/types.js";

const NOW = new Date("2026-07-11T08:00:00.456Z");

describe("AuthService", () => {
  it("issues a social session only while the verified user's revocation stamp remains unchanged", async () => {
    const user = makeUser();
    const fixture = authFixture({ user });
    await expect(fixture.service.createSocialSession(user.id, "google", metadata(), "2025-01-01T00:00:00.000Z")).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(fixture.persistence.createRefreshSession).not.toHaveBeenCalled();
    const session = await fixture.service.createSocialSession(user.id, "google", metadata(), user.authValidAfter.toISOString());
    expect(session.user.lastLoginMethod).toBe("google");
    vi.mocked(fixture.persistence.findUserById).mockResolvedValue({ ...user, status: "disabled" });
    await expect(fixture.service.createSocialSession(user.id, "google", metadata(), user.authValidAfter.toISOString())).rejects.toMatchObject({ code: "USER_DISABLED" });
  });
  it("issues access tokens with a fixed seven-day lifetime", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
    const sign = vi.fn(() => "signed-access-token");
    const issuer = createFastifyAccessTokenIssuer({ sign });
    const payload = {
      sub: "00000000-0000-4000-8000-000000000001",
      email: "person@example.com",
      role: "user" as const,
      auth_valid_after: "2026-07-01T00:00:00.000Z",
    };

    const accessToken = await issuer.issue(payload);
    now.mockRestore();

    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(sign).toHaveBeenCalledWith(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    expect(accessToken).toEqual({
      token: "signed-access-token",
      expiresAt: new Date("2026-07-18T08:00:00.000Z"),
    });
  });

  it("fails closed before reading a user or invoking Argon2 when Redis precheck fails", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.rateLimiter.precheckLogin).mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(
      fixture.service.login("person@example.com", "Password1!", metadata()),
    ).rejects.toMatchObject({ code: "AUTH_LOGIN_PROTECTION_UNAVAILABLE" });
    expect(fixture.persistence.findUserByEmail).not.toHaveBeenCalled();
    expect(fixture.hasher.verify).not.toHaveBeenCalled();
  });

  it("does no account work while a cooldown is active and exposes only merged retry seconds", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.rateLimiter.precheckLogin).mockResolvedValueOnce(73);

    const error = await fixture.service
      .login("person@example.com", "Password1!", metadata())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoginRateLimitedError);
    expect(error).toMatchObject({
      code: "AUTH_LOGIN_RATE_LIMITED",
      retryAfterSeconds: 73,
    });
    expect(fixture.persistence.findUserByEmail).not.toHaveBeenCalled();
    expect(fixture.hasher.verify).not.toHaveBeenCalled();
  });

  it.each([
    ["missing user", null],
    ["disabled user", makeUser({ status: "disabled" })],
    ["user without a local password", makeUser({ passwordHash: null })],
  ])("performs exactly one dummy verification for %s", async (_name, user) => {
    const fixture = authFixture({ user });
    vi.mocked(fixture.hasher.verify).mockResolvedValueOnce(false);

    await expect(
      fixture.service.login("person@example.com", "candidate", metadata()),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(fixture.hasher.dummyHash).toHaveBeenCalledTimes(1);
    expect(fixture.hasher.verify).toHaveBeenCalledTimes(1);
    expect(fixture.hasher.verify).toHaveBeenCalledWith(
      "dummy-hash",
      "candidate",
    );
    expect(fixture.rateLimiter.recordLoginFailure).toHaveBeenCalledTimes(1);
  });

  it("uses one real verification, clears only email protection, and stores only a refresh hash", async () => {
    const fixture = authFixture({ user: makeUser() });
    vi.mocked(fixture.hasher.verify).mockResolvedValueOnce(true);

    const session = await fixture.service.login(
      " PERSON@example.com ",
      "Password1!",
      metadata(),
    );

    expect(fixture.hasher.dummyHash).toHaveBeenCalledTimes(1);
    expect(fixture.hasher.verify).toHaveBeenCalledTimes(1);
    expect(fixture.rateLimiter.clearEmailLoginState).toHaveBeenCalledTimes(1);
    expect(fixture.persistence.createRefreshSession).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(fixture.persistence.createRefreshSession).mock
      .calls[0]?.[0];
    expect(persisted?.tokenHash).not.toBe(session.refreshToken);
    expect(persisted?.loginMethod).toBe("password");
    expect(session.refreshSessionExpiresAt.toISOString()).toBe(
      "2026-10-09T08:00:00.456Z",
    );
    expect(session.user).not.toHaveProperty("passwordHash");
  });

  it("does not create a session when the post-success Redis cleanup fails", async () => {
    const fixture = authFixture({ user: makeUser() });
    vi.mocked(fixture.hasher.verify).mockResolvedValueOnce(true);
    vi.mocked(fixture.rateLimiter.clearEmailLoginState).mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(
      fixture.service.login("person@example.com", "Password1!", metadata()),
    ).rejects.toMatchObject({ code: "AUTH_LOGIN_PROTECTION_UNAVAILABLE" });
    expect(fixture.persistence.createRefreshSession).not.toHaveBeenCalled();
    expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
  });

  it("rejects login when the password or auth boundary changes before session persistence", async () => {
    const fixture = authFixture({ user: makeUser() });
    vi.mocked(fixture.hasher.verify).mockResolvedValueOnce(true);
    vi.mocked(fixture.persistence.createRefreshSession).mockResolvedValueOnce(
      false,
    );

    await expect(
      fixture.service.login("person@example.com", "Password1!", metadata()),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(fixture.persistence.createRefreshSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedEmail: "person@example.com",
        expectedPasswordHash: "real-hash",
        expectedAuthValidAfter: new Date("2026-07-01T00:00:00.000Z"),
      }),
    );
  });

  it("rejects a reused refresh family and never signs a replacement access token", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.persistence.rotateRefreshSession).mockResolvedValueOnce({
      status: "reused",
    });

    await expect(
      fixture.service.refresh("r".repeat(48), metadata()),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
  });

  it("keeps the original absolute expiry when rotating refresh tokens", async () => {
    const fixture = authFixture();
    const absoluteExpiry = new Date("2026-08-01T00:00:00.000Z");
    vi.mocked(fixture.persistence.rotateRefreshSession).mockResolvedValueOnce({
      status: "rotated",
      familyId: "00000000-0000-4000-8000-000000000101",
      expiresAt: absoluteExpiry,
      user: makeUser(),
    });

    const session = await fixture.service.refresh("r".repeat(48), metadata());
    expect(session.refreshSessionExpiresAt).toEqual(absoluteExpiry);
  });

  it("checks SMTP before user lookup for forgot-password degradation", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.mail.status).mockResolvedValueOnce("not_configured");

    await expect(
      fixture.service.forgotPassword("person@example.com", metadata()),
    ).rejects.toMatchObject({ code: "PASSWORD_EMAIL_UNAVAILABLE" });
    expect(fixture.rateLimiter.takePasswordResetRequest).not.toHaveBeenCalled();
    expect(fixture.persistence.findUserByEmail).not.toHaveBeenCalled();
  });

  it("returns the same accepted result when forgot-password is rate limited without querying users", async () => {
    const fixture = authFixture();
    vi.mocked(
      fixture.rateLimiter.takePasswordResetRequest,
    ).mockResolvedValueOnce(false);

    await expect(
      fixture.service.forgotPassword("nobody@example.com", metadata()),
    ).resolves.toEqual({ code: "PASSWORD_RESET_REQUEST_ACCEPTED" });
    expect(fixture.persistence.findUserByEmail).not.toHaveBeenCalled();
    expect(fixture.mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(fixture.audit.write).not.toHaveBeenCalled();
  });

  it("stores only a reset hash and sends an HTTPS fragment link for an active user", async () => {
    const fixture = authFixture({ user: makeUser() });

    const result = await fixture.service.forgotPassword(
      "person@example.com",
      metadata(),
    );

    expect(result).toEqual({ code: "PASSWORD_RESET_REQUEST_ACCEPTED" });
    const tokenWrite = vi.mocked(fixture.persistence.createPasswordResetToken)
      .mock.calls[0]?.[0];
    const mail = vi.mocked(fixture.mail.sendPasswordReset).mock.calls[0]?.[0];
    expect(tokenWrite?.tokenHash).not.toContain("opaque-token");
    expect(mail?.deliveryId).not.toBe(tokenWrite?.id);
    expect(mail?.deliveryId).toMatch(/^00000000-0000-4000-8000-[0-9]{12}$/u);
    expect(mail?.tokenHash).toBe(tokenWrite?.tokenHash);
    expect(mail?.subject).not.toContain("opaque-token");
    expect(mail?.text).toContain(
      "https://linksense.example/reset-password#token=",
    );
    expect(mail?.text).not.toContain("?token=");
    expect(mail?.html).toContain('<html lang="en-US">');
    expect(mail?.html).toContain(">Set or reset password</a>");
    expect(mail?.html).toContain("This secure link expires in 30 minutes");
    expect(mail?.html).toContain(
      "https://linksense.example/reset-password#token=",
    );
    expect(mail?.html).not.toContain("?token=");
  });

  it("sends a local HTTP reset link for a development loopback origin", async () => {
    const fixture = authFixture({
      user: makeUser(),
      nodeEnv: "development",
      publicBaseUrl: "http://localhost:5173",
    });

    await expect(
      fixture.service.forgotPassword("person@example.com", metadata()),
    ).resolves.toEqual({ code: "PASSWORD_RESET_REQUEST_ACCEPTED" });

    const mail = vi.mocked(fixture.mail.sendPasswordReset).mock.calls[0]?.[0];
    expect(mail?.text).toContain("http://localhost:5173/reset-password#token=");
    expect(mail?.html).toContain("http://localhost:5173/reset-password#token=");
  });

  it("renders the localized Chinese password reset email for the user preference", async () => {
    const fixture = authFixture({
      user: makeUser({ name: "林知远", preferredLocale: "zh-CN" }),
      productName: "MOSS",
    });

    await fixture.service.forgotPassword("person@example.com", metadata());

    const mail = vi.mocked(fixture.mail.sendPasswordReset).mock.calls[0]?.[0];
    expect(mail).toMatchObject({
      locale: "zh-CN",
      subject: "设置或重置 MOSS 密码",
    });
    expect(mail?.text).toContain("林知远，您好");
    expect(mail?.html).toContain(">设置或重置密码</a>");
    expect(mail?.html).toContain(">MOSS</div>");
    expect(mail?.html).not.toContain("LinkSense");
    expect(mail?.html).toContain("此安全链接将在 30 分钟后失效");
  });

  it("sends an HTTP reset link when the deployment intentionally uses HTTP", async () => {
    const fixture = authFixture({
      user: makeUser(),
      nodeEnv: "production",
      publicBaseUrl: "http://linksense.example",
    });

    await expect(
      fixture.service.forgotPassword("person@example.com", metadata()),
    ).resolves.toEqual({ code: "PASSWORD_RESET_REQUEST_ACCEPTED" });

    expect(fixture.persistence.createPasswordResetToken).toHaveBeenCalledOnce();
    const mail = vi.mocked(fixture.mail.sendPasswordReset).mock.calls[0]?.[0];
    expect(mail?.text).toContain(
      "http://linksense.example/reset-password#token=",
    );
  });

  it("invalidates an unsent reset token and reports a delivery failure", async () => {
    const fixture = authFixture({ user: makeUser() });
    vi.mocked(fixture.mail.sendPasswordReset).mockRejectedValueOnce(
      new Error("mail rejected"),
    );

    await expect(
      fixture.service.forgotPassword("person@example.com", metadata()),
    ).rejects.toMatchObject({ code: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED" });
    expect(
      fixture.persistence.invalidatePasswordResetToken,
    ).toHaveBeenCalledTimes(1);
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        action: "password_setup_or_reset_delivery_failed",
        result: "failed",
      }),
    );
    const deliveryAudit = vi
      .mocked(fixture.audit.write)
      .mock.calls.find(
        ([entry]) => entry.action === "password_setup_or_reset_delivery_failed",
      )?.[0];
    expect(deliveryAudit).not.toHaveProperty("targetId");
    expect(deliveryAudit).not.toHaveProperty("targetType");
    expect(deliveryAudit).toMatchObject({
      metadata: {
        capability: "password_reset_mail_queue",
        error_code: "PASSWORD_RESET_MAIL_ENQUEUE_FAILED",
        reason_code: "PASSWORD_RESET_MAIL_ENQUEUE_FAILED",
      },
    });
    expect(JSON.stringify(deliveryAudit)).not.toContain("opaque-token");
    expect(JSON.stringify(deliveryAudit)).not.toContain("person@example.com");
  });

  it("reports a delivery failure when reset-token persistence or cleanup is unavailable", async () => {
    const fixture = authFixture({ user: makeUser() });
    vi.mocked(
      fixture.persistence.createPasswordResetToken,
    ).mockRejectedValueOnce(new Error("database unavailable"));
    vi.mocked(
      fixture.persistence.invalidatePasswordResetToken,
    ).mockRejectedValueOnce(new Error("database unavailable"));
    vi.mocked(fixture.audit.write).mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      fixture.service.forgotPassword("person@example.com", metadata()),
    ).rejects.toMatchObject({ code: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED" });
    expect(fixture.mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(
      fixture.persistence.invalidatePasswordResetToken,
    ).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", null],
    ["disabled", makeUser({ status: "disabled" })],
    ["active", makeUser()],
  ])(
    "keeps the %s account path inside the same minimum accepted-response window",
    async (_case, user) => {
      vi.useFakeTimers();
      try {
        const fixture = authFixture({ user, useDefaultResponseClock: true });
        let settled = false;
        const result = fixture.service
          .forgotPassword("person@example.com", metadata())
          .then((value) => {
            settled = true;
            return value;
          });

        await vi.advanceTimersByTimeAsync(
          PASSWORD_RESET_MINIMUM_RESPONSE_MS - 1,
        );
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toEqual({
          code: "PASSWORD_RESET_REQUEST_ACCEPTED",
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps self-registration closed by default before checking SMTP or Redis", async () => {
    const fixture = authFixture();

    await expect(
      fixture.service.requestRegistration(
        "new.person@example.com",
        "zh-CN",
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "REGISTRATION_DISABLED" });
    expect(fixture.mail.status).not.toHaveBeenCalled();
    expect(fixture.rateLimiter.takeRegistrationRequest).not.toHaveBeenCalled();
    expect(fixture.persistence.createRegistrationToken).not.toHaveBeenCalled();
  });

  it("stores only a registration-token hash and sends a localized fragment activation link", async () => {
    const fixture = authFixture({ productName: "MOSS" });
    vi.mocked(fixture.persistence.getRegistrationState).mockResolvedValue({
      enabled: true,
    });

    await expect(
      fixture.service.requestRegistration(
        " NEW.PERSON@example.com ",
        "zh-CN",
        metadata(),
      ),
    ).resolves.toEqual({ code: "REGISTRATION_REQUEST_ACCEPTED" });

    const tokenWrite = vi.mocked(fixture.persistence.createRegistrationToken)
      .mock.calls[0]?.[0];
    const mail = vi.mocked(fixture.mail.sendRegistration).mock.calls[0]?.[0];
    expect(tokenWrite).toMatchObject({
      email: "new.person@example.com",
      locale: "zh-CN",
      expiresAt: new Date("2026-07-11T08:30:00.456Z"),
    });
    expect(tokenWrite?.tokenHash).not.toContain("opaque-token");
    expect(mail?.tokenHash).toBe(tokenWrite?.tokenHash);
    expect(mail?.subject).toBe("激活您的 MOSS 账号");
    expect(mail?.text).toContain(
      "https://linksense.example/register/activate#token=",
    );
    expect(mail?.text).not.toContain("?token=");
    expect(mail?.html).toContain(">设置密码并激活账号</a>");
    expect(JSON.stringify(vi.mocked(fixture.audit.write).mock.calls)).not.toContain(
      "new.person@example.com",
    );
  });

  it("returns the same accepted registration result for an existing email without sending mail", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.persistence.getRegistrationState).mockResolvedValue({
      enabled: true,
    });
    vi.mocked(fixture.persistence.createRegistrationToken).mockResolvedValueOnce({
      status: "email_exists",
    });

    await expect(
      fixture.service.requestRegistration(
        "person@example.com",
        "en-US",
        metadata(),
      ),
    ).resolves.toEqual({ code: "REGISTRATION_REQUEST_ACCEPTED" });
    expect(fixture.mail.sendRegistration).not.toHaveBeenCalled();
  });

  it("invalidates an unsent registration token without logging its email or plaintext token", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.persistence.getRegistrationState).mockResolvedValue({
      enabled: true,
    });
    vi.mocked(fixture.mail.sendRegistration).mockRejectedValueOnce(
      new Error("mail rejected for person@example.com"),
    );

    await expect(
      fixture.service.requestRegistration(
        "person@example.com",
        "en-US",
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "REGISTRATION_EMAIL_DELIVERY_FAILED" });
    expect(
      fixture.persistence.invalidateRegistrationToken,
    ).toHaveBeenCalledOnce();
    const auditJson = JSON.stringify(vi.mocked(fixture.audit.write).mock.calls);
    expect(auditJson).not.toContain("person@example.com");
    expect(auditJson).not.toContain("opaque-token");
  });

  it("activates a registration and creates the first password session", async () => {
    const fixture = authFixture();
    const registeredUser = makeUser({
      id: "00000000-0000-4000-8000-000000000001",
      email: "new.person@example.com",
      name: "new.person",
      passwordHash: "new-hash",
      preferredLocale: "en-US",
      authValidAfter: NOW,
      passwordUpdatedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    vi.mocked(fixture.persistence.completeRegistration).mockResolvedValueOnce({
      status: "activated",
      user: registeredUser,
    });

    const session = await fixture.service.completeRegistration(
      "r".repeat(48),
      "Password1!",
      metadata(),
    );

    expect(fixture.hasher.hash).toHaveBeenCalledWith("Password1!");
    expect(fixture.persistence.completeRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        passwordHash: "new-hash",
      }),
    );
    expect(fixture.persistence.createRefreshSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: registeredUser.id,
        loginMethod: "password",
        expectedPasswordHash: "new-hash",
      }),
    );
    expect(session.user).toMatchObject({
      email: "new.person@example.com",
      lastLoginMethod: "password",
    });
  });

  it.each([
    ["disabled", "REGISTRATION_DISABLED"],
    ["invalid", "REGISTRATION_TOKEN_INVALID_OR_EXPIRED"],
    ["email_exists", "REGISTRATION_EMAIL_ALREADY_REGISTERED"],
  ] as const)(
    "maps the %s registration completion result without creating a session",
    async (status, code) => {
      const fixture = authFixture();
      vi.mocked(fixture.persistence.completeRegistration).mockResolvedValueOnce({
        status,
      });

      await expect(
        fixture.service.completeRegistration(
          "r".repeat(48),
          "Password1!",
          metadata(),
        ),
      ).rejects.toMatchObject({ code });
      expect(fixture.persistence.createRefreshSession).not.toHaveBeenCalled();
    },
  );

  it("allows a password change to the same plaintext and rehashes after one current-password verification", async () => {
    const fixture = authFixture({ user: makeUser() });
    vi.mocked(fixture.hasher.verify).mockResolvedValueOnce(true);
    vi.mocked(fixture.hasher.hash).mockResolvedValueOnce("new-salted-hash");
    vi.mocked(fixture.persistence.changePassword).mockResolvedValueOnce({
      status: "changed",
      user: makeUser({ passwordHash: "new-salted-hash" }),
    });

    await fixture.service.changePassword(
      makeUser().id,
      "Password1!",
      "Password1!",
      {},
    );
    expect(fixture.hasher.verify).toHaveBeenCalledTimes(1);
    expect(fixture.hasher.hash).toHaveBeenCalledWith("Password1!");
    expect(fixture.persistence.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ newPasswordHash: "new-salted-hash" }),
    );
  });

  it("reset-password never checks SMTP and maps every persistence rejection to the stable token error", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.persistence.resetPassword).mockResolvedValueOnce({
      status: "invalid",
    });

    await expect(
      fixture.service.resetPassword("r".repeat(48), "Password1!", {}),
    ).rejects.toMatchObject({
      code: "PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED",
    });
    expect(fixture.mail.status).not.toHaveBeenCalled();
  });

  it("initializes only an ordinary active admin and maps a concurrent rejection", async () => {
    const fixture = authFixture();
    vi.mocked(fixture.persistence.initializeAdmin).mockImplementationOnce(
      async (input) => ({
        status: "initialized",
        user: makeUser({
          id: input.id,
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: "admin",
          status: "active",
        }),
      }),
    );
    const initialized = await fixture.service.initialize({
      email: "admin@example.com",
      name: "Admin",
      password: "Password1!",
    });
    expect(initialized.user.role).toBe("admin");
    expect(initialized.user).not.toHaveProperty("passwordHash");

    vi.mocked(fixture.persistence.initializeAdmin).mockResolvedValueOnce({
      status: "already_initialized",
    });
    await expect(
      fixture.service.initialize({
        email: "second@example.com",
        name: "Second",
        password: "Password1!",
      }),
    ).rejects.toMatchObject({ code: "SYSTEM_ALREADY_INITIALIZED" });
  });

  it("requires the deployment initialization credential before hashing or creating the first administrator", async () => {
    const credential = "i".repeat(64)
    const fixture = authFixture({ initializationToken: credential })

    await expect(
      fixture.service.initialize({
        email: "admin@example.com",
        name: "Admin",
        password: "Password1!",
      }),
    ).rejects.toMatchObject({
      code: "SYSTEM_INITIALIZATION_CREDENTIAL_INVALID",
    })
    await expect(
      fixture.service.initialize({
        email: "admin@example.com",
        name: "Admin",
        password: "Password1!",
        initialization_credential: "x".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "SYSTEM_INITIALIZATION_CREDENTIAL_INVALID",
    })
    expect(fixture.hasher.hash).not.toHaveBeenCalled()
    expect(fixture.persistence.initializeAdmin).not.toHaveBeenCalled()

    vi.mocked(fixture.persistence.initializeAdmin).mockImplementationOnce(
      async (input) => ({
        status: "initialized",
        user: makeUser({
          id: input.id,
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: "admin",
          status: "active",
        }),
      }),
    )
    await expect(
      fixture.service.initialize({
        email: "admin@example.com",
        name: "Admin",
        password: "Password1!",
        initialization_credential: credential,
      }),
    ).resolves.toMatchObject({ user: { role: "admin" } })
  })

  it("advertises initialization protection only until the system is initialized", async () => {
    const fixture = authFixture({ initializationToken: "i".repeat(64) })
    await expect(fixture.service.bootstrap()).resolves.toMatchObject({
      initialized: false,
      initialization_credential_required: true,
    })
    vi.mocked(fixture.persistence.getBootstrapState).mockResolvedValueOnce({
      initialized: true,
    })
    await expect(fixture.service.bootstrap()).resolves.toMatchObject({
      initialized: true,
      initialization_credential_required: false,
    })
  })

  it("uses existing active accounts for SAML without changing their role or requiring new fields", async () => {
    const fixture = authFixture({ user: makeUser() });
    const session = await fixture.service.loginSaml({ email: "PERSON@example.com" }, metadata());
    expect(session.user.lastLoginMethod).toBe("saml");
    expect(session.user.id).toBe(makeUser().id);
    expect(session.user.role).toBe(makeUser().role);
    expect(fixture.persistence.createRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("creates first-time SAML accounts as pending and denies disabled accounts", async () => {
    for (const user of [null, makeUser({ status: "disabled" })]) {
      const fixture = authFixture({ user });
      await expect(fixture.service.loginSaml({ email: "person@example.com" }, metadata())).rejects.toMatchObject({ code: user ? "USER_DISABLED" : "EXTERNAL_ACCOUNT_PENDING_APPROVAL" });
      expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
      expect(fixture.persistence.createRefreshSession).not.toHaveBeenCalled();
    }
  });

  it("creates a first-time OIDC user as disabled and requires administrator approval", async () => {
    const oidc: OidcFlow = {
      status: vi.fn(async () => "configured" as const),
      start: vi.fn(async () => ({
        authorizationUrl: "https://identity.example/authorize",
      })),
      complete: vi.fn(async () => ({
        email: " NEW.PERSON@example.com ",
        name: "New Person",
      })),
    };
    const fixture = authFixture({ oidc });

    await expect(
      fixture.service.completeOidc(
        new URL(
          "https://linksense.example/auth/oidc/callback?code=code&state=state",
        ),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "OIDC_ACCOUNT_PENDING_APPROVAL" });

    expect(
      fixture.persistence.findOrCreateDisabledExternalUser,
    ).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
      email: "new.person@example.com",
      name: "New Person",
      now: NOW,
      audit: metadata(),
    });
    expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
    expect(fixture.persistence.createRefreshSession).not.toHaveBeenCalled();
  });

  it("uses the email local part when OIDC does not provide a valid display name", async () => {
    const oidc: OidcFlow = {
      status: vi.fn(async () => "configured" as const),
      start: vi.fn(async () => ({
        authorizationUrl: "https://identity.example/authorize",
      })),
      complete: vi.fn(async () => ({ email: "new.person@example.com" })),
    };
    const fixture = authFixture({ oidc });

    await expect(
      fixture.service.completeOidc(
        new URL(
          "https://linksense.example/auth/oidc/callback?code=code&state=state",
        ),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "OIDC_ACCOUNT_PENDING_APPROVAL" });
    expect(
      fixture.persistence.findOrCreateDisabledExternalUser,
    ).toHaveBeenCalledWith(expect.objectContaining({ name: "new.person" }));
  });

  it("creates an OIDC session only after an existing account is active", async () => {
    const oidc: OidcFlow = {
      status: vi.fn(async () => "configured" as const),
      start: vi.fn(async () => ({
        authorizationUrl: "https://identity.example/authorize",
      })),
      complete: vi.fn(async () => ({ email: "person@example.com" })),
    };
    const fixture = authFixture({ oidc, user: makeUser() });

    const session = await fixture.service.completeOidc(
      new URL(
        "https://linksense.example/auth/oidc/callback?code=code&state=state",
      ),
      metadata(),
    );

    expect(session.user.lastLoginMethod).toBe("oidc");
    expect(fixture.persistence.createRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing disabled OIDC user out of the application", async () => {
    const oidc: OidcFlow = {
      status: vi.fn(async () => "configured" as const),
      start: vi.fn(async () => ({
        authorizationUrl: "https://identity.example/authorize",
      })),
      complete: vi.fn(async () => ({ email: "person@example.com" })),
    };
    const fixture = authFixture({
      oidc,
      user: makeUser({ status: "disabled" }),
    });

    await expect(
      fixture.service.completeOidc(
        new URL(
          "https://linksense.example/auth/oidc/callback?code=code&state=state",
        ),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "USER_DISABLED" });
    expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
  });

  it("validates Teams identity and creates a session for an existing active email", async () => {
    const verifier: TeamsTokenVerifier = {
      status: vi.fn(async () => "configured" as const),
      verify: vi.fn(async () => ({ email: "PERSON@example.com" })),
    };
    const fixture = authFixture({ user: makeUser(), teams: verifier });
    const session = await fixture.service.exchangeTeamsToken(
      "signed-token".repeat(4),
      metadata(),
    );
    expect(verifier.verify).toHaveBeenCalledTimes(1);
    expect(
      fixture.persistence.findOrCreateDisabledExternalUser,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ email: "person@example.com" }),
    );
    expect(session.user.lastLoginMethod).toBe("teams");
  });

  it("reports Teams verification failures without treating them as password credential errors", async () => {
    const verifier: TeamsTokenVerifier = {
      status: vi.fn(async () => "configured" as const),
      verify: vi.fn(async () => {
        throw new Error("invalid audience");
      }),
    };
    const fixture = authFixture({ teams: verifier });

    await expect(
      fixture.service.exchangeTeamsToken("signed-token".repeat(4), metadata()),
    ).rejects.toMatchObject({ code: "TEAMS_SSO_FAILED" });
    expect(
      fixture.persistence.findOrCreateDisabledExternalUser,
    ).not.toHaveBeenCalled();
    expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
  });

  it("creates a first-time Teams user as disabled and requires administrator approval", async () => {
    const verifier: TeamsTokenVerifier = {
      status: vi.fn(async () => "configured" as const),
      verify: vi.fn(async () => ({
        email: " NEW.TEAMS@example.com ",
        name: "New Teams",
      })),
    };
    const fixture = authFixture({ teams: verifier });

    await expect(
      fixture.service.exchangeTeamsToken("signed-token".repeat(4), metadata()),
    ).rejects.toMatchObject({ code: "EXTERNAL_ACCOUNT_PENDING_APPROVAL" });

    expect(
      fixture.persistence.findOrCreateDisabledExternalUser,
    ).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
      email: "new.teams@example.com",
      name: "New Teams",
      now: NOW,
      audit: metadata(),
    });
    expect(fixture.accessTokens.issue).not.toHaveBeenCalled();
    expect(fixture.persistence.createRefreshSession).not.toHaveBeenCalled();
  });
});

function authFixture(
  options: {
    user?: AuthUserRecord | null;
    oidc?: OidcFlow;
    teams?: TeamsTokenVerifier;
    useDefaultResponseClock?: boolean;
    nodeEnv?: "development" | "test" | "production";
    publicBaseUrl?: string;
    productName?: string;
    initializationToken?: string;
  } = {},
) {
  const user = options.user === undefined ? null : options.user;
  const persistence: AuthPersistence = {
    getBootstrapState: vi.fn(async () => ({ initialized: false })),
    getRegistrationState: vi.fn(async () => ({ enabled: false })),
    initializeAdmin: vi.fn(async () => ({
      status: "already_initialized" as const,
    })),
    findUserByEmail: vi.fn(async () => user),
    findUserById: vi.fn(async () => user),
    findOrCreateDisabledExternalUser: vi.fn(async (input) => ({
      user:
        user ??
        makeUser({
          id: input.id,
          email: input.email,
          name: input.name,
          status: "disabled",
          passwordHash: null,
          passwordUpdatedAt: null,
          authValidAfter: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      created: user === null,
    })),
    createRefreshSession: vi.fn(async () => true),
    rotateRefreshSession: vi.fn(async () => ({ status: "invalid" as const })),
    revokeRefreshSession: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => ({ status: "invalid" as const })),
    createPasswordResetToken: vi.fn(async () => undefined),
    invalidatePasswordResetToken: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => ({ status: "invalid" as const })),
    createRegistrationToken: vi.fn(async () => ({ status: "created" as const })),
    invalidateRegistrationToken: vi.fn(async () => undefined),
    completeRegistration: vi.fn(async () => ({ status: "invalid" as const })),
    recordExternalLogin: vi.fn(async () => null),
    cleanupInvalidTokens: vi.fn(async () => ({
      refreshTokens: 0,
      passwordResetTokens: 0,
      registrationTokens: 0,
    })),
  };
  const rateLimiter: AuthRateLimiter = {
    loginKeys: vi.fn(() => ({
      ipWindow: "ip-window",
      ipCooldown: "ip-cooldown",
      emailWindow: "email-window",
      emailCooldown: "email-cooldown",
    })),
    precheckLogin: vi.fn(async () => 0),
    recordLoginFailure: vi.fn(async () => 0),
    clearEmailLoginState: vi.fn(async () => undefined),
    takePasswordResetRequest: vi.fn(async () => true),
    takeRegistrationRequest: vi.fn(async () => true),
  };
  const hasher: PasswordHasher = {
    hash: vi.fn(async () => "new-hash"),
    verify: vi.fn(async () => false),
    dummyHash: vi.fn(async () => "dummy-hash"),
  };
  const accessTokens: AccessTokenIssuer = {
    issue: vi.fn(async () => ({
      token: "a".repeat(48),
      expiresAt: new Date("2026-07-11T10:00:00.000Z"),
    })),
  };
  const mail: PasswordMailGateway = {
    status: vi.fn(async () => "available" as const),
    sendPasswordReset: vi.fn(async () => undefined),
    sendRegistration: vi.fn(async () => undefined),
  };
  const audit: AuditWriter = {
    write: vi.fn(async () => undefined),
  };
  let id = 0;
  const service = new AuthService({
    persistence,
    rateLimiter,
    accessTokens,
    mail,
    readProductName: vi.fn(async () => options.productName ?? "LinkSense"),
    audit,
    passwordHasher: hasher,
    ...(options.oidc ? { oidc: options.oidc } : {}),
    ...(options.teams ? { teams: options.teams } : {}),
    config: {
      nodeEnv: options.nodeEnv ?? "test",
      publicBaseUrl: options.publicBaseUrl ?? "https://linksense.example",
      ...(options.initializationToken
        ? { initializationToken: options.initializationToken }
        : {}),
      passwordReset: {
        emailLimit: 3,
        emailWindowSeconds: 900,
        ipLimit: 20,
        ipWindowSeconds: 3_600,
        tokenTtlMinutes: 30,
      },
      invalidAuthTokenRetentionDays: 90,
      oidc: { status: options.oidc ? "configured" : "not_configured" },
      teams: { status: options.teams ? "configured" : "not_configured" },
      smtp: { status: "configured" },
    },
    now: () => new Date(NOW),
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    createOpaqueToken: () => `opaque-token-${"x".repeat(48)}`,
    ...(options.useDefaultResponseClock
      ? {}
      : {
          passwordResetResponseClock: {
            now: () => 0,
            wait: vi.fn(async () => undefined),
          },
        }),
  });
  return {
    service,
    persistence,
    rateLimiter,
    hasher,
    accessTokens,
    mail,
    audit,
  };
}

function makeUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "person@example.com",
    name: "Person",
    avatarObjectKey: null,
    role: "user",
    status: "active",
    passwordHash: "real-hash",
    preferredLocale: "en-US",
    runningMessageAction: "queue",
    lastLoginAt: null,
    lastLoginMethod: null,
    passwordUpdatedAt: new Date("2026-07-01T00:00:00.000Z"),
    authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function metadata() {
  return { ipAddress: "192.0.2.1", userAgent: "Vitest" };
}
