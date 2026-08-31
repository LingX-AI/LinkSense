import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import { AuthenticationSettingsService } from "../src/modules/system/authentication-settings.js"
import { testConfig } from "./test-config.js"

const ACTOR_ID = "00000000-0000-4000-8000-000000000099"

describe("AuthenticationSettingsService", () => {
  it("inherits existing deployment configuration without exposing secrets", async () => {
    const database = inMemorySystemSettings()
    const service = new AuthenticationSettingsService(
      database.prisma,
      testConfig({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "mailer@example.com",
        SMTP_PASSWORD: "environment-smtp-secret",
        SMTP_FROM: "LinkSense <no-reply@example.com>",
        OIDC_ISSUER_URL: "https://identity.example.com",
        OIDC_CLIENT_ID: "linksense-web",
        OIDC_CLIENT_SECRET: "environment-oidc-secret",
        OIDC_REDIRECT_URI:
          "https://linksense.example.test/api/v1/auth/oidc/callback",
        TEAMS_TENANT_ID: "00000000-0000-4000-8000-000000000111",
        TEAMS_CLIENT_ID: "00000000-0000-4000-8000-000000000222",
      }),
    )

    const settings = await service.getAdminSettings()

    expect(settings).toMatchObject({
      smtp: {
        mode: "inherit",
        status: "configured",
        source: "environment",
        password_configured: true,
      },
      oidc: {
        mode: "inherit",
        status: "configured",
        source: "environment",
        client_secret_configured: true,
      },
      teams: {
        mode: "inherit",
        status: "configured",
        source: "environment",
      },
    })
    const serialized = JSON.stringify(settings)
    expect(serialized).not.toContain("environment-smtp-secret")
    expect(serialized).not.toContain("environment-oidc-secret")
  })

  it("encrypts managed settings, preserves product fields, and hot-reloads across readers", async () => {
    const database = inMemorySystemSettings({
      organization_display_name: "School LinkSense",
      default_locale: "zh-CN",
    })
    const config = testConfig()
    const writer = new AuthenticationSettingsService(database.prisma, config)
    const otherWorker = new AuthenticationSettingsService(database.prisma, config)

    const updated = await writer.updateSmtp(
      ACTOR_ID,
      {
        mode: "managed",
        expected_revision: 0,
        host: "smtp.managed.example",
        port: 465,
        security: "tls",
        username: "managed-mailer",
        password: "managed-smtp-secret",
        from: "LinkSense <managed@example.com>",
      },
      { ipAddress: "192.0.2.10", userAgent: "settings-test" },
    )

    expect(updated.smtp).toMatchObject({
      mode: "managed",
      status: "configured",
      source: "system",
      revision: 1,
      password_configured: true,
    })
    const persisted = JSON.stringify(database.settingsJson())
    expect(persisted).toContain("authentication_settings_encrypted")
    expect(persisted).toContain("School LinkSense")
    expect(persisted).not.toContain("managed-smtp-secret")
    expect(persisted).not.toContain("smtp.managed.example")

    await expect(otherWorker.resolveSmtp()).resolves.toMatchObject({
      mode: "managed",
      revision: 1,
      configuration: {
        host: "smtp.managed.example",
        password: "managed-smtp-secret",
      },
    })
    expect(JSON.stringify(database.auditCreate.mock.calls)).not.toContain(
      "managed-smtp-secret",
    )
  })

  it("uses the authenticated mailbox for a legacy invalid sender header", async () => {
    const database = inMemorySystemSettings()
    const config = testConfig()
    database.replaceSettingsJson(encryptedAuthenticationSettings(config, {
      version: 1,
      smtp: {
        mode: "managed",
        revision: 1,
        host: "smtp.managed.example",
        port: 465,
        security: "tls",
        username: "mailer@example.com",
        password: "managed-smtp-secret",
        from: "LinkSense",
      },
    }))
    const service = new AuthenticationSettingsService(database.prisma, config)

    await expect(service.resolveSmtp()).resolves.toMatchObject({
      mode: "managed",
      status: "configured",
      source: "system",
      configuration: { from: "mailer@example.com" },
    })
    await expect(service.getAdminSettings()).resolves.toMatchObject({
      smtp: { from: "mailer@example.com" },
    })
  })

  it("rejects malformed new sender headers and keeps unsafe legacy values invalid", async () => {
    const database = inMemorySystemSettings()
    const config = testConfig()
    const service = new AuthenticationSettingsService(database.prisma, config)

    await expect(
      service.updateSmtp(
        ACTOR_ID,
        {
          mode: "managed",
          expected_revision: 0,
          host: "smtp.managed.example",
          port: 465,
          security: "tls",
          username: "mailer@example.com",
          password: "managed-smtp-secret",
          from: "LinkSense",
        },
        {},
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: "smtp_from_header_invalid" })],
    })

    database.replaceSettingsJson(encryptedAuthenticationSettings(config, {
      version: 1,
      smtp: {
        mode: "managed",
        revision: 1,
        host: "smtp.managed.example",
        port: 465,
        security: "tls",
        username: "mailer-user",
        password: "managed-smtp-secret",
        from: "LinkSense",
      },
    }))
    await expect(service.resolveSmtp()).resolves.toMatchObject({
      mode: "managed",
      status: "invalid",
      source: "system",
    })
  })

  it("preserves an omitted managed secret and rejects stale revisions", async () => {
    const database = inMemorySystemSettings()
    const service = new AuthenticationSettingsService(
      database.prisma,
      testConfig(),
    )
    await service.updateOidc(
      ACTOR_ID,
      {
        mode: "managed",
        expected_revision: 0,
        issuer_url: "https://identity.example.com",
        client_id: "linksense-web",
        client_secret: "first-secret",
      },
      {},
    )

    expect(database.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({ secret_replaced: true }),
        }),
      }),
    )

    await service.updateOidc(
      ACTOR_ID,
      {
        mode: "managed",
        expected_revision: 1,
        issuer_url: "https://identity-2.example.com",
        client_id: "linksense-web",
      },
      {},
    )

    expect(database.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({ secret_replaced: false }),
        }),
      }),
    )

    await expect(service.resolveOidc()).resolves.toMatchObject({
      revision: 2,
      configuration: {
        issuerUrl: "https://identity-2.example.com",
        clientSecret: "first-secret",
      },
    })
    await expect(
      service.updateOidc(
        ACTOR_ID,
        {
          mode: "disabled",
          expected_revision: 1,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("allows the derived loopback callback for local OIDC development", async () => {
    const database = inMemorySystemSettings()
    const service = new AuthenticationSettingsService(
      database.prisma,
      testConfig({ LINKSENSE_PUBLIC_BASE_URL: "http://localhost:8080" }),
    )

    const settings = await service.updateOidc(
      ACTOR_ID,
      {
        mode: "managed",
        expected_revision: 0,
        issuer_url: "https://identity.example.com",
        client_id: "linksense-web",
        client_secret: "local-development-secret",
      },
      {},
    )

    expect(settings.oidc).toMatchObject({
      status: "configured",
      redirect_uri: "http://localhost:8080/api/v1/auth/oidc/callback",
    })
  })

  it("uses disabled as an explicit override and fails closed for damaged ciphertext", async () => {
    const database = inMemorySystemSettings()
    const service = new AuthenticationSettingsService(
      database.prisma,
      testConfig({
        TEAMS_TENANT_ID: "00000000-0000-4000-8000-000000000111",
        TEAMS_CLIENT_ID: "00000000-0000-4000-8000-000000000222",
      }),
    )
    await service.updateTeams(
      ACTOR_ID,
      { mode: "disabled", expected_revision: 0 },
      {},
    )
    await expect(service.resolveTeams()).resolves.toEqual({
      mode: "disabled",
      status: "not_configured",
      source: "none",
      revision: 1,
    })

    database.replaceSettingsJson({
      authentication_settings_encrypted: "not-a-valid-envelope",
      authentication_settings_key_id: "v1",
    })
    await expect(service.resolveAll()).rejects.toBeDefined()
  })
})

function inMemorySystemSettings(
  initial: Record<string, unknown> = {},
): {
  prisma: PrismaClient
  auditCreate: ReturnType<typeof vi.fn>
  settingsJson: () => Record<string, unknown>
  replaceSettingsJson: (value: Record<string, unknown>) => void
} {
  let settingsJson = { ...initial }
  const auditCreate = vi.fn(async () => undefined)
  const systemSetting = {
    findUnique: vi.fn(async () => ({ settingsJson })),
    upsert: vi.fn(async (input: {
      create: { settingsJson: Record<string, unknown> }
      update: { settingsJson: Record<string, unknown> }
    }) => {
      settingsJson = { ...input.update.settingsJson }
      return { settingsJson }
    }),
  }
  const transaction = {
    $executeRaw: vi.fn(async () => undefined),
    systemSetting,
    auditLog: { create: auditCreate },
  }
  const prisma = {
    systemSetting,
    $transaction: vi.fn(async (action: (tx: typeof transaction) => unknown) =>
      action(transaction),
    ),
  } as unknown as PrismaClient
  return {
    prisma,
    auditCreate,
    settingsJson: () => settingsJson,
    replaceSettingsJson: (value) => {
      settingsJson = { ...value }
    },
  }
}

function encryptedAuthenticationSettings(
  config: ReturnType<typeof testConfig>,
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  return {
    authentication_settings_encrypted: encryptJson(
      envelope,
      config.credentialMasterKey,
      config.credentialKeyId,
      "linksense:authentication-settings:v1",
    ),
    authentication_settings_key_id: config.credentialKeyId,
  }
}
