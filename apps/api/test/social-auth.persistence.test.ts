import { describe, expect, it, vi } from "vitest"
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js"
import { SocialSettingsService } from "../src/modules/social-auth/settings.js"
import { PrismaSocialRepository } from "../src/modules/social-auth/repository.js"
import { testConfig } from "./test-config.js"

const actorId = "00000000-0000-4000-8000-000000000002"
const metadata = { ipAddress: "192.0.2.1", userAgent: null }
const identity = {
  provider: "google" as const,
  clientId: "app",
  subject: "subject",
  name: "Member",
  email: "member@example.test",
  emailVerified: true,
}
const user = {
  id: actorId,
  status: "active",
  authValidAfter: new Date("2026-09-21T00:00:00Z"),
  passwordHash: null as string | null,
}

function fixture() {
  let json: Prisma.JsonObject = {
    system_initialized: true,
    self_registration: { enabled: true },
    organization_display_name: "Preserved",
  }
  const db = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: actorId }]),
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson: json })),
      upsert: vi.fn(
        async (input: { update: { settingsJson: Prisma.JsonObject } }) => {
          json = input.update.settingsJson
        },
      ),
    },
    user: {
      findUnique: vi.fn(async () => null as typeof user | null),
      create: vi.fn(async () => user),
      update: vi.fn(async () => user),
    },
    socialAccount: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null as { userId: string } | null),
      findMany: vi.fn(async () => [
        { provider: "google", clientId: "app", createdAt: new Date() },
      ]),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    refreshToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  }
  // Prisma is mocked only at the database boundary; production logic runs intact.
  const prisma = {
    ...db,
    $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => run(db),
  } as unknown as PrismaClient
  const settings = new SocialSettingsService(prisma, testConfig())
  const repository = new PrismaSocialRepository(prisma, settings)
  const enable = () =>
    settings.update(
      "google",
      {
        enabled: true,
        expected_revision: 0,
        client_id: "app",
        client_secret: "private-test-secret",
      },
      actorId,
      metadata,
    )
  return {
    db,
    settings,
    repository,
    enable,
    json: () => json,
    setJson: (value: Prisma.JsonObject) => {
      json = value
    },
  }
}

describe("social settings persistence", () => {
  it("adds encrypted GitHub settings while existing Google settings and bindings stay usable", async () => {
    const f = fixture()
    await f.enable()
    expect(await f.settings.resolve("github")).toBeNull()
    const summary = await f.settings.update(
      "github",
      {
        enabled: true,
        expected_revision: 0,
        client_id: "github-app",
        client_secret: "github-private-secret",
      },
      actorId,
      metadata,
    )
    expect(
      summary.find((entry) => entry.provider === "github"),
    ).toMatchObject({
      enabled: true,
      secret_configured: true,
      redirect_uri:
        "https://linksense.example.test/api/v1/auth/social/github/callback",
    })
    expect(
      JSON.stringify([summary, f.json(), f.db.auditLog.create.mock.calls]),
    ).not.toContain("github-private-secret")
    expect(await f.settings.resolve("google")).toMatchObject({
      enabled: true,
      revision: 1,
      client_id: "app",
    })
    await expect(
      f.repository.authenticate(identity, 1, null, metadata),
    ).resolves.toMatchObject({ userId: actorId })
    await expect(
      f.repository.authenticate(
        {
          ...identity,
          provider: "github",
          clientId: "github-app",
          subject: "12345",
        },
        1,
        null,
        metadata,
      ),
    ).resolves.toMatchObject({ userId: actorId })
    expect(f.db.socialAccount.create).toHaveBeenLastCalledWith({
      data: {
        userId: actorId,
        provider: "github",
        clientId: "github-app",
        subject: "12345",
      },
    })
  })
  it("keeps old settings readable with all new providers disabled", async () => {
    const f = fixture()
    expect(await f.settings.getAdminSettings()).toHaveLength(5)
    expect(
      (await f.settings.getAdminSettings()).every(
        (entry) =>
          !entry.enabled && !entry.secret_configured && entry.revision === 0,
      ),
    ).toBe(true)
  })
  it("encrypts secrets, preserves existing fields, retains omitted secrets and rejects stale updates", async () => {
    const f = fixture()
    const summary = await f.enable()
    expect(summary[0]).toMatchObject({
      enabled: true,
      revision: 1,
      secret_configured: true,
      redirect_uri:
        "https://linksense.example.test/api/v1/auth/social/google/callback",
    })
    expect(JSON.stringify(summary)).not.toContain("private-test-secret")
    expect(JSON.stringify(f.json())).not.toContain("private-test-secret")
    expect(f.json().organization_display_name).toBe("Preserved")
    await f.settings.update(
      "google",
      { enabled: false, expected_revision: 1, client_id: "app" },
      actorId,
      metadata,
    )
    expect(await f.settings.resolve("google")).toMatchObject({
      client_secret: "private-test-secret",
      enabled: false,
      revision: 2,
    })
    await expect(f.enable()).rejects.toMatchObject({ code: "CONFLICT" })
    expect(JSON.stringify(f.db.auditLog.create.mock.calls)).not.toContain(
      "private-test-secret",
    )
  })
  it("rejects replacement of a client that has existing bindings", async () => {
    const f = fixture()
    await f.enable()
    f.db.socialAccount.count.mockResolvedValue(1)
    await expect(
      f.settings.update(
        "google",
        { enabled: true, expected_revision: 1, client_id: "other" },
        actorId,
        metadata,
      ),
    ).rejects.toMatchObject({ code: "SOCIAL_CLIENT_IN_USE" })
  })
  it("rejects incomplete Apple and Facebook credentials and unknown fields", async () => {
    const f = fixture()
    await expect(
      f.settings.update(
        "apple",
        {
          enabled: true,
          expected_revision: 0,
          client_id: "apple",
          client_secret: "not-a-private-key",
        },
        actorId,
        metadata,
      ),
    ).rejects.toBeDefined()
    await expect(
      f.settings.update(
        "facebook",
        {
          enabled: true,
          expected_revision: 0,
          client_id: "fb",
          client_secret: "secret",
        },
        actorId,
        metadata,
      ),
    ).rejects.toBeDefined()
  })
})

describe("social account persistence", () => {
  it("creates an ordinary passwordless user and binding transactionally for open registration", async () => {
    const f = fixture()
    await f.enable()
    await expect(
      f.repository.authenticate(identity, 1, null, metadata),
    ).resolves.toMatchObject({ userId: actorId })
    expect(f.db.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "user",
        status: "active",
        email: identity.email,
        selfRegisteredAt: expect.any(Date),
      }),
    })
    expect(f.db.socialAccount.create).toHaveBeenCalledWith({
      data: {
        userId: actorId,
        provider: "google",
        clientId: "app",
        subject: "subject",
      },
    })
  })
  it("refuses implicit linking of a pre-existing email or disabled registration", async () => {
    const f = fixture()
    await f.enable()
    f.db.user.findUnique.mockResolvedValue(user)
    await expect(
      f.repository.authenticate(identity, 1, null, metadata),
    ).rejects.toMatchObject({ result: "email_exists" })
    f.setJson({ ...f.json(), self_registration: { enabled: false } })
    await expect(
      f.repository.authenticate(identity, 1, null, metadata),
    ).rejects.toMatchObject({ result: "registration_disabled" })
    expect(f.db.socialAccount.create).not.toHaveBeenCalled()
    expect(f.db.user.create).not.toHaveBeenCalled()
  })
  it("allows existing identities to sign in with registration closed even after their email changes", async () => {
    const f = fixture()
    await f.enable()
    f.setJson({ ...f.json(), self_registration: { enabled: false } })
    f.db.socialAccount.findUnique.mockResolvedValue({ userId: actorId })
    f.db.user.findUnique.mockResolvedValue(user)
    await expect(
      f.repository.authenticate(
        { ...identity, email: null, emailVerified: false },
        1,
        null,
        metadata,
      ),
    ).resolves.toMatchObject({ userId: actorId })
    expect(f.db.user.create).not.toHaveBeenCalled()
  })
  it("rejects disabled users, revoked linking sessions, and accounts owned by others", async () => {
    const f = fixture()
    await f.enable()
    f.db.socialAccount.findUnique.mockResolvedValue({ userId: actorId })
    f.db.user.findUnique.mockResolvedValue({ ...user, status: "disabled" })
    await expect(
      f.repository.authenticate(identity, 1, null, metadata),
    ).rejects.toMatchObject({ result: "disabled" })
    f.db.user.findUnique.mockResolvedValue(user)
    await expect(
      f.repository.authenticate(
        identity,
        1,
        { id: actorId, authValidAfter: "old" },
        metadata,
      ),
    ).rejects.toMatchObject({ result: "failed" })
    await expect(
      f.repository.authenticate(
        identity,
        1,
        {
          id: "another-user",
          authValidAfter: user.authValidAfter.toISOString(),
        },
        metadata,
      ),
    ).rejects.toMatchObject({ result: "already_linked" })
  })
  it("blocks last-method unlink, but allows a password holder and revokes sessions", async () => {
    const f = fixture()
    await f.enable()
    f.db.user.findUnique.mockResolvedValue(user)
    await expect(
      f.repository.unlink(actorId, "google", metadata),
    ).rejects.toMatchObject({ code: "SOCIAL_LAST_METHOD" })
    expect(f.db.socialAccount.deleteMany).not.toHaveBeenCalled()
    f.db.user.findUnique.mockResolvedValue({
      ...user,
      passwordHash: "existing-hash",
    })
    await f.repository.unlink(actorId, "google", metadata)
    expect(f.db.socialAccount.deleteMany).toHaveBeenCalledWith({
      where: { userId: actorId, provider: "google" },
    })
    expect(f.db.refreshToken.updateMany).toHaveBeenCalled()
    expect(f.db.user.update).toHaveBeenCalledWith({
      where: { id: actorId },
      data: { authValidAfter: expect.any(Date) },
    })
  })
  it("checks configuration revision again inside the transaction", async () => {
    const f = fixture()
    await f.enable()
    await expect(
      f.repository.authenticate(identity, 0, null, metadata),
    ).rejects.toMatchObject({ result: "configuration_changed" })
    expect(f.db.user.create).not.toHaveBeenCalled()
  })
})
