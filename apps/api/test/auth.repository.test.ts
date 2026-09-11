import { defaultQuotaSettings } from "@linksense/shared";
import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { PrismaAuthRepository } from "../src/modules/auth/repository.js"

const NOW = new Date("2026-07-11T08:00:00.000Z")

describe("PrismaAuthRepository transactions", () => {
  it("uses a transaction advisory lock and persists an initialization rejection audit", async () => {
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      systemSetting: {
        findUnique: vi.fn(async () => ({
          settingsJson: { system_initialized: true },
        })),
      },
      user: {
        count: vi.fn(async () => 1),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    const result = await repository.initializeAdmin({
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.com",
      name: "Admin",
      passwordHash: "argon2-hash",
      now: NOW,
      audit: { ipAddress: "192.0.2.1", userAgent: "Vitest" },
    })

    expect(result).toEqual({ status: "already_initialized" })
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1)
    expect(transaction.user.create).not.toHaveBeenCalled()
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "system_initialization_rejected",
        result: "rejected",
        metadataJson: expect.objectContaining({
          error_code: "SYSTEM_ALREADY_INITIALIZED",
        }),
      }),
    })
  })

  it("provisions a first-time external identity as one disabled user with an audit record", async () => {
    const createdUser = persistedUser({
      id: "00000000-0000-4000-8000-000000000090",
      email: "new.person@example.com",
      name: "New Person",
      role: "user",
      status: "disabled",
      passwordHash: null,
      passwordUpdatedAt: null,
      authValidAfter: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const transaction = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(createdUser),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.findOrCreateDisabledExternalUser({
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        now: NOW,
        audit: { ipAddress: "192.0.2.1", userAgent: "Browser" },
      }),
    ).resolves.toEqual({ user: createdUser, created: true })

    expect(transaction.user.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        role: "user",
        status: "disabled",
        passwordHash: null,
        passwordUpdatedAt: null,
      }),
      skipDuplicates: true,
    })
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: null,
        action: "user_created",
        targetType: "user",
        targetId: createdUser.id,
        result: "success",
        metadataJson: {
          role: "user",
          status: "disabled",
          user_group_count: 0,
        },
      }),
    })
  })

  it("returns an existing external email without creating a duplicate user", async () => {
    const existing = persistedUser()
    const transaction = {
      user: {
        findUnique: vi.fn(async () => existing),
        createMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.findOrCreateDisabledExternalUser({
        id: "00000000-0000-4000-8000-000000000090",
        email: existing.email,
        name: "Ignored Name",
        now: NOW,
        audit: {},
      }),
    ).resolves.toEqual({ user: existing, created: false })
    expect(transaction.user.createMany).not.toHaveBeenCalled()
    expect(transaction.auditLog.create).not.toHaveBeenCalled()
  })

  it("converges on the account created by a concurrent external login", async () => {
    const concurrentUser = persistedUser({
      email: "concurrent@example.com",
      role: "user",
      status: "disabled",
      passwordHash: null,
      passwordUpdatedAt: null,
    })
    const transaction = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(concurrentUser),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      auditLog: { create: vi.fn() },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.findOrCreateDisabledExternalUser({
        id: "00000000-0000-4000-8000-000000000090",
        email: concurrentUser.email,
        name: "Concurrent Person",
        now: NOW,
        audit: {},
      }),
    ).resolves.toEqual({ user: concurrentUser, created: false })
    expect(transaction.user.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    )
    expect(transaction.auditLog.create).not.toHaveBeenCalled()
  })

  it("revokes every still-active token in a family when a rotated token is reused", async () => {
    const current = refreshToken({
      revokedAt: new Date("2026-07-10T00:00:00.000Z"),
      revokeReason: "rotated",
      replacedByTokenId: "00000000-0000-4000-8000-000000000009",
    })
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: current.id }]),
      refreshToken: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(),
        update: vi.fn(),
      },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    const result = await repository.rotateRefreshSession({
      id: "00000000-0000-4000-8000-000000000010",
      tokenHash: "old-hash",
      replacementTokenHash: "new-hash",
      now: NOW,
      ipAddress: "192.0.2.1",
      userAgent: "Vitest",
    })

    expect(result).toEqual({ status: "reused" })
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: NOW, revokeReason: "reuse_detected" },
    })
    expect(transaction.refreshToken.create).not.toHaveBeenCalled()
  })

  it("rotates once while inheriting the family's original absolute expiry", async () => {
    const current = refreshToken()
    const user = persistedUser()
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: current.id }]),
      refreshToken: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(),
        create: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
      user: { findUnique: vi.fn(async () => user) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))
    const replacementId = "00000000-0000-4000-8000-000000000010"

    const result = await repository.rotateRefreshSession({
      id: replacementId,
      tokenHash: "old-hash",
      replacementTokenHash: "new-hash",
      now: NOW,
      ipAddress: "192.0.2.1",
      userAgent: "Vitest",
    })

    expect(result).toMatchObject({
      status: "rotated",
      expiresAt: current.expiresAt,
    })
    expect(transaction.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: replacementId,
        parentTokenId: current.id,
        familyId: current.familyId,
        expiresAt: current.expiresAt,
        userAgent: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    })
    expect(JSON.stringify(transaction.refreshToken.create.mock.calls)).not.toContain(
      "Vitest",
    )
    expect(transaction.refreshToken.update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: {
        revokedAt: NOW,
        revokeReason: "rotated",
        replacedByTokenId: replacementId,
      },
    })
  })

  it("stores a redacted User-Agent in refresh-token rows", async () => {
    const user = persistedUser()
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: user.id }]),
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => user),
      },
      refreshToken: { create: vi.fn(async () => undefined) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    const created = await repository.createRefreshSession({
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      familyId: "00000000-0000-4000-8000-000000000011",
      tokenHash: "token-hash",
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      loginMethod: "password",
      expectedEmail: user.email,
      expectedAuthValidAfter: user.authValidAfter,
      expectedPasswordHash: user.passwordHash!,
      now: NOW,
      ipAddress: "192.0.2.1",
      userAgent: "Browser/1.0 Managed-Device-Identifier",
    })

    expect(created).toBe(true)
    expect(transaction.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userAgent: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    })
    expect(JSON.stringify(transaction.refreshToken.create.mock.calls)).not.toContain(
      "Managed-Device-Identifier",
    )
  })

  it("uses the same user_password_changed success action for an authenticated change", async () => {
    const user = persistedUser()
    const updated = { ...user, passwordHash: "new-password-hash" }
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: user.id }]),
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => updated),
      },
      refreshToken: { updateMany: vi.fn(async () => ({ count: 2 })) },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.changePassword({
        userId: user.id,
        expectedPasswordHash: "old-hash",
        newPasswordHash: "new-password-hash",
        now: NOW,
        audit: {},
      }),
    ).resolves.toMatchObject({ status: "changed" })

    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user_password_changed",
        result: "success",
        actorId: user.id,
        targetType: "user",
        targetId: user.id,
        metadataJson: { method: "authenticated_change" },
      }),
    })
    const auditJson = JSON.stringify(transaction.auditLog.create.mock.calls)
    expect(auditJson).not.toContain("old-hash")
    expect(auditJson).not.toContain("new-password-hash")
  })

  it("consumes every reset token and revokes every refresh token in the password-reset transaction", async () => {
    const token = {
      id: "00000000-0000-4000-8000-000000000020",
      userId: "00000000-0000-4000-8000-000000000001",
      tokenHash: "reset-hash",
      expiresAt: new Date("2026-07-11T08:30:00.000Z"),
      consumedAt: null,
      requestIp: null,
      requestUserAgent: null,
      createdAt: new Date("2026-07-11T08:00:00.000Z"),
    }
    const user = persistedUser()
    const updated = { ...user, passwordHash: "new-hash", authValidAfter: NOW }
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: token.id }])
        .mockResolvedValueOnce([{ id: user.id }]),
      passwordResetToken: {
        findUnique: vi.fn(async () => token),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => updated),
      },
      refreshToken: {
        updateMany: vi.fn(async () => ({ count: 3 })),
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    const result = await repository.resetPassword({
      tokenHash: "reset-hash",
      newPasswordHash: "new-hash",
      now: NOW,
      audit: {},
    })

    expect(result.status).toBe("changed")
    expect(transaction.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: NOW },
    })
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: NOW, revokeReason: "password_reset" },
    })
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user_password_changed",
        result: "success",
        metadataJson: { method: "reset_link" },
      }),
    })
  })

  it("uses one anonymous audit contract for consumed reset tokens and disabled matching users", async () => {
    const token = {
      id: "00000000-0000-4000-8000-000000000020",
      userId: "00000000-0000-4000-8000-000000000001",
      tokenHash: "reset-hash",
      expiresAt: new Date("2026-07-11T08:30:00.000Z"),
      consumedAt: NOW,
      requestIp: null,
      requestUserAgent: null,
      createdAt: NOW,
    }
    const user = persistedUser({ status: "disabled" })
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: token.id }])
        .mockResolvedValueOnce([{ id: user.id }]),
      passwordResetToken: { findUnique: vi.fn(async () => token) },
      user: { findUnique: vi.fn(async () => user), update: vi.fn() },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.resetPassword({
        tokenHash: "reset-hash",
        newPasswordHash: "new-hash",
        now: NOW,
        audit: { ipAddress: "192.0.2.1", userAgent: "Browser" },
      }),
    ).resolves.toEqual({ status: "invalid" })

    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "password_token_rejected",
        result: "rejected",
        actorId: null,
        targetType: null,
        targetId: null,
        metadataJson: {
          error_code: "PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED",
        },
      }),
    })
    expect(JSON.stringify(transaction.auditLog.create.mock.calls)).not.toContain(
      user.id,
    )
    expect(transaction.user.update).not.toHaveBeenCalled()
  })

  it.each([
    ["missing token", null, null],
    [
      "expired token",
      resetToken({ expiresAt: new Date("2026-07-11T07:59:59.000Z") }),
      persistedUser(),
    ],
    ["consumed token", resetToken({ consumedAt: NOW }), persistedUser()],
    ["disabled user", resetToken(), persistedUser({ status: "disabled" })],
  ])("uses the stable anonymous rejection contract for a %s", async (_case, token, user) => {
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce(token ? [{ id: token.id }] : [])
        .mockResolvedValueOnce(token ? [{ id: token.userId }] : []),
      passwordResetToken: { findUnique: vi.fn(async () => token) },
      user: { findUnique: vi.fn(async () => user), update: vi.fn() },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.resetPassword({
        tokenHash: "candidate-token-hash",
        newPasswordHash: "new-password-hash",
        now: NOW,
        audit: { ipAddress: "192.0.2.1", userAgent: "Browser" },
      }),
    ).resolves.toEqual({ status: "invalid" })

    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "password_token_rejected",
        result: "rejected",
        actorId: null,
        targetType: null,
        targetId: null,
        metadataJson: {
          error_code: "PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED",
        },
      }),
    })
    const auditJson = JSON.stringify(transaction.auditLog.create.mock.calls)
    expect(auditJson).not.toContain("candidate-token-hash")
    expect(auditJson).not.toContain("new-password-hash")
    expect(auditJson).not.toContain("person@example.com")
    expect(transaction.user.update).not.toHaveBeenCalled()
  })

  it("does not persist registration tokens while registration is disabled", async () => {
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      systemSetting: {
        findUnique: vi.fn(async () => ({
          settingsJson: { self_registration: { enabled: false } },
        })),
      },
      user: { findUnique: vi.fn() },
      registrationToken: { updateMany: vi.fn(), create: vi.fn() },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.createRegistrationToken({
        id: "00000000-0000-4000-8000-000000000030",
        email: "new.person@example.com",
        locale: "zh-CN",
        tokenHash: "registration-hash",
        expiresAt: new Date("2026-07-11T08:30:00.000Z"),
        now: NOW,
        requestIp: "192.0.2.1",
        requestUserAgent: "Browser",
      }),
    ).resolves.toEqual({ status: "disabled" })
    expect(transaction.user.findUnique).not.toHaveBeenCalled()
    expect(transaction.registrationToken.create).not.toHaveBeenCalled()
  })

  it("invalidates earlier registration links before storing a new hashed link", async () => {
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      systemSetting: {
        findUnique: vi.fn(async () => ({
          settingsJson: {
            self_registration: { enabled: true },
            quota_settings: { ...defaultQuotaSettings(), self_registered_users: { total_credit_limit: "12.5", weekly_credit_limit: "2", monthly_credit_limit: "5" } },
          },
        })),
      },
      user: { findUnique: vi.fn(async () => null) },
      registrationToken: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({ id: "token" })),
      },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.createRegistrationToken({
        id: "00000000-0000-4000-8000-000000000030",
        email: "new.person@example.com",
        locale: "en-US",
        tokenHash: "registration-hash",
        expiresAt: new Date("2026-07-11T08:30:00.000Z"),
        now: NOW,
        requestIp: null,
        requestUserAgent: null,
      }),
    ).resolves.toEqual({ status: "created" })
    expect(transaction.registrationToken.updateMany).toHaveBeenCalledWith({
      where: { email: "new.person@example.com", consumedAt: null },
      data: { consumedAt: NOW },
    })
    expect(transaction.registrationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: "registration-hash",
        locale: "en-US",
      }),
    })
  })

  it("checks the live registration setting while atomically activating an account", async () => {
    const token = registrationToken()
    const createdUser = persistedUser({
      id: "00000000-0000-4000-8000-000000000031",
      email: token.email,
      name: "new.person",
      role: "user",
      status: "active",
      passwordHash: "new-password-hash",
      preferredLocale: null,
      passwordUpdatedAt: NOW,
      authValidAfter: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ id: token.id }]),
      systemSetting: {
        findUnique: vi.fn(async () => ({
          settingsJson: {
            self_registration: { enabled: true },
            quota_settings: { ...defaultQuotaSettings(), self_registered_users: { total_credit_limit: "12.5", weekly_credit_limit: "2", monthly_credit_limit: "5" } },
          },
        })),
      },
      registrationToken: {
        findUnique: vi.fn(async () => token),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      user: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => createdUser),
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.completeRegistration({
        id: createdUser.id,
        tokenHash: token.tokenHash,
        passwordHash: "new-password-hash",
        now: NOW,
        audit: { ipAddress: "192.0.2.1", userAgent: "Browser" },
      }),
    ).resolves.toEqual({ status: "activated", user: createdUser })
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: token.email,
        name: "new.person",
        role: "user",
        status: "active",
        preferredLocale: null,
        selfRegisteredAt: NOW,
        totalCreditLimitMicros: 12_500_000n,
        weeklyCreditLimitMicros: 2_000_000n,
        monthlyCreditLimitMicros: 5_000_000n,
      }),
    })
    expect(transaction.registrationToken.updateMany).toHaveBeenCalledWith({
      where: { email: token.email, consumedAt: null },
      data: { consumedAt: NOW },
    })
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user_self_registered",
        actorId: createdUser.id,
        result: "success",
      }),
    })
  })

  it("rejects an otherwise valid activation link after registration is closed", async () => {
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(),
      systemSetting: {
        findUnique: vi.fn(async () => ({
          settingsJson: { self_registration: { enabled: false } },
        })),
      },
    }
    const repository = new PrismaAuthRepository(prismaWithTransaction(transaction))

    await expect(
      repository.completeRegistration({
        id: "00000000-0000-4000-8000-000000000031",
        tokenHash: "registration-hash",
        passwordHash: "new-password-hash",
        now: NOW,
        audit: {},
      }),
    ).resolves.toEqual({ status: "disabled" })
    expect(transaction.$queryRaw).not.toHaveBeenCalled()
  })
})

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (work: (client: object) => Promise<unknown>) =>
      work(transaction),
    ),
  } as unknown as PrismaClient
}

function refreshToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000001",
    familyId: "00000000-0000-4000-8000-000000000003",
    parentTokenId: null,
    replacedByTokenId: null,
    tokenHash: "old-hash",
    userAgent: "Vitest",
    ipAddress: "192.0.2.1",
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}

function resetToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    userId: "00000000-0000-4000-8000-000000000001",
    tokenHash: "persisted-reset-hash",
    expiresAt: new Date("2026-07-11T08:30:00.000Z"),
    consumedAt: null,
    requestIp: null,
    requestUserAgent: null,
    createdAt: new Date("2026-07-11T08:00:00.000Z"),
    ...overrides,
  }
}

function registrationToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000030",
    email: "new.person@example.com",
    tokenHash: "registration-hash",
    locale: "en-US",
    expiresAt: new Date("2026-07-11T08:30:00.000Z"),
    consumedAt: null,
    requestIp: null,
    requestUserAgent: null,
    createdAt: NOW,
    ...overrides,
  }
}

function persistedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "person@example.com",
    name: "Person",
    avatarObjectKey: null,
    role: "admin",
    status: "active",
    passwordHash: "old-hash",
    preferredLocale: "zh-CN",
    runningMessageAction: "queue",
    lastLoginAt: null,
    lastLoginMethod: null,
    passwordUpdatedAt: new Date("2026-07-01T00:00:00.000Z"),
    authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}
