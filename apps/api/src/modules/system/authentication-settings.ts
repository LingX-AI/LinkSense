import {
  authenticationSettingsSchema,
  smtpSecuritySchema,
  type AuthenticationConfigurationStatus,
  type AuthenticationManagementMode,
  type AuthenticationSettings,
  type UpdateOidcAuthenticationSettings,
  type UpdateSmtpAuthenticationSettings,
  type UpdateTeamsAuthenticationSettings,
} from "@linksense/shared"
import addressparser from "nodemailer/lib/addressparser/index.js"
import { z } from "zod"

import type { AppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_SETTINGS_KEY = "authentication_settings_encrypted"
const ENCRYPTION_KEY_ID_KEY = "authentication_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:authentication-settings:v1"

const providerRevisionSchema = z.number().int().nonnegative()
const smtpMailboxSchema = z.email().max(320)
const inheritedStoredSettingsSchema = z.strictObject({
  mode: z.literal("inherit"),
  revision: providerRevisionSchema,
})
const disabledStoredSettingsSchema = z.strictObject({
  mode: z.literal("disabled"),
  revision: providerRevisionSchema,
})

const storedSmtpSettingsSchema = z.discriminatedUnion("mode", [
  inheritedStoredSettingsSchema,
  disabledStoredSettingsSchema,
  z.strictObject({
    mode: z.literal("managed"),
    revision: providerRevisionSchema,
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    security: smtpSecuritySchema,
    username: z.string().min(1).max(320).optional(),
    password: z.string().min(1).max(16_384).optional(),
    from: z.string().min(1).max(320),
  }),
])

const storedOidcSettingsSchema = z.discriminatedUnion("mode", [
  inheritedStoredSettingsSchema,
  disabledStoredSettingsSchema,
  z.strictObject({
    mode: z.literal("managed"),
    revision: providerRevisionSchema,
    issuerUrl: z.string().min(1),
    clientId: z.string().min(1).max(512),
    clientSecret: z.string().min(1).max(16_384),
  }),
])

const storedTeamsSettingsSchema = z.discriminatedUnion("mode", [
  inheritedStoredSettingsSchema,
  disabledStoredSettingsSchema,
  z.strictObject({
    mode: z.literal("managed"),
    revision: providerRevisionSchema,
    tenantId: z.uuid(),
    clientId: z.uuid(),
  }),
])

const storedAuthenticationEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  smtp: storedSmtpSettingsSchema.optional(),
  oidc: storedOidcSettingsSchema.optional(),
  teams: storedTeamsSettingsSchema.optional(),
})

type StoredAuthenticationEnvelope = z.infer<
  typeof storedAuthenticationEnvelopeSchema
>
type StoredSmtpSettings = z.infer<typeof storedSmtpSettingsSchema>
type StoredOidcSettings = z.infer<typeof storedOidcSettingsSchema>
type StoredTeamsSettings = z.infer<typeof storedTeamsSettingsSchema>

const smtpRuntimeConfigurationSchema = z
  .strictObject({
    host: z.string().trim().min(1).max(253).refine((value) => !/\s/u.test(value)),
    port: z.number().int().min(1).max(65_535),
    security: smtpSecuritySchema,
    username: z.string().trim().min(1).max(320).optional(),
    password: z.string().min(1).max(16_384).optional(),
    from: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .refine((value) => !/[\r\n]/u.test(value))
      .refine(isValidSmtpFromHeader, {
        message: "smtp_from_header_invalid",
      }),
  })
  .superRefine((value, context) => {
    if ((value.username === undefined) !== (value.password === undefined)) {
      context.addIssue({
        code: "custom",
        path: value.username === undefined ? ["username"] : ["password"],
        message: "smtp_authentication_incomplete",
      })
    }
  })

const oidcRuntimeConfigurationSchema = z.strictObject({
  issuerUrl: z
    .url()
    .refine((value) => new URL(value).protocol === "https:"),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(16_384),
  redirectUri: z.url().refine(isAllowedOidcRedirectUri),
})

const teamsRuntimeConfigurationSchema = z.strictObject({
  tenantId: z.uuid(),
  clientId: z.uuid(),
})

export type SmtpRuntimeConfiguration = z.infer<
  typeof smtpRuntimeConfigurationSchema
>
export type OidcRuntimeConfiguration = z.infer<
  typeof oidcRuntimeConfigurationSchema
>
export type TeamsRuntimeConfiguration = z.infer<
  typeof teamsRuntimeConfigurationSchema
>

export type ResolvedAuthenticationProvider<Configuration> = {
  mode: AuthenticationManagementMode
  status: AuthenticationConfigurationStatus
  source: "environment" | "system" | "none"
  revision: number
  configuration?: Configuration
}

export type ResolvedAuthenticationSettings = {
  smtp: ResolvedAuthenticationProvider<SmtpRuntimeConfiguration>
  oidc: ResolvedAuthenticationProvider<OidcRuntimeConfiguration>
  teams: ResolvedAuthenticationProvider<TeamsRuntimeConfiguration>
}

export interface AuthenticationSettingsReader {
  resolveAll(): Promise<ResolvedAuthenticationSettings>
  resolveSmtp(): Promise<ResolvedAuthenticationSettings["smtp"]>
  resolveOidc(): Promise<ResolvedAuthenticationSettings["oidc"]>
  resolveTeams(): Promise<ResolvedAuthenticationSettings["teams"]>
}

export class AuthenticationSettingsService implements AuthenticationSettingsReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async getAdminSettings(): Promise<AuthenticationSettings> {
    return projectAdminSettings(await this.resolveAll(), this.oidcRedirectUri())
  }

  async resolveAll(): Promise<ResolvedAuthenticationSettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return this.resolveEnvelope(
      readStoredEnvelope(
        asObject(row?.settingsJson),
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
      ),
    )
  }

  async resolveSmtp(): Promise<ResolvedAuthenticationSettings["smtp"]> {
    return (await this.resolveAll()).smtp
  }

  async resolveOidc(): Promise<ResolvedAuthenticationSettings["oidc"]> {
    return (await this.resolveAll()).oidc
  }

  async resolveTeams(): Promise<ResolvedAuthenticationSettings["teams"]> {
    return (await this.resolveAll()).teams
  }

  updateSmtp(
    actorId: string,
    input: UpdateSmtpAuthenticationSettings,
    context: AuditContext,
  ): Promise<AuthenticationSettings> {
    return this.updateProvider(
      "smtp",
      input.expected_revision,
      actorId,
      context,
      (current, revision) => nextSmtpSettings(current, input, revision),
      input.mode === "managed" && input.password !== undefined,
    )
  }

  updateOidc(
    actorId: string,
    input: UpdateOidcAuthenticationSettings,
    context: AuditContext,
  ): Promise<AuthenticationSettings> {
    return this.updateProvider(
      "oidc",
      input.expected_revision,
      actorId,
      context,
      (current, revision) => nextOidcSettings(current, input, revision),
      input.mode === "managed" && input.client_secret !== undefined,
    )
  }

  updateTeams(
    actorId: string,
    input: UpdateTeamsAuthenticationSettings,
    context: AuditContext,
  ): Promise<AuthenticationSettings> {
    return this.updateProvider(
      "teams",
      input.expected_revision,
      actorId,
      context,
      (_current, revision) => nextTeamsSettings(input, revision),
      false,
    )
  }

  private async updateProvider<Provider extends "smtp" | "oidc" | "teams">(
    provider: Provider,
    expectedRevision: number,
    actorId: string,
    context: AuditContext,
    createNext: (
      current: StoredAuthenticationEnvelope[Provider],
      revision: number,
    ) => NonNullable<StoredAuthenticationEnvelope[Provider]>,
    secretReplaced: boolean,
  ): Promise<AuthenticationSettings> {
    const envelope = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: { settingsJson: true },
      })
      const currentRaw = asObject(row?.settingsJson)
      const currentEnvelope = readStoredEnvelope(
        currentRaw,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
      )
      const currentRevision = currentEnvelope[provider]?.revision ?? 0
      if (currentRevision !== expectedRevision) throw new AppError("CONFLICT")
      const nextRevision = currentRevision + 1
      const next = createNext(currentEnvelope[provider], nextRevision)
      const updatedEnvelope = storedAuthenticationEnvelopeSchema.parse({
        ...currentEnvelope,
        [provider]: next,
      })
      const encrypted = encryptJson(
        updatedEnvelope,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT,
      )
      const settingsJson = {
        ...currentRaw,
        [ENCRYPTED_SETTINGS_KEY]: encrypted,
        [ENCRYPTION_KEY_ID_KEY]: this.config.credentialKeyId,
      }
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson,
          updatedBy: actorId,
        },
        update: { settingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "authentication_settings_updated",
          targetType: "authentication_provider",
          targetId: provider,
          result: "success",
          metadataJson: {
            provider,
            mode: next.mode,
            revision: nextRevision,
            secret_replaced: secretReplaced,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return updatedEnvelope
    })
    return projectAdminSettings(this.resolveEnvelope(envelope), this.oidcRedirectUri())
  }

  private resolveEnvelope(
    envelope: StoredAuthenticationEnvelope,
  ): ResolvedAuthenticationSettings {
    return {
      smtp: resolveSmtpSettings(envelope.smtp, this.config),
      oidc: resolveOidcSettings(
        envelope.oidc,
        this.config,
        this.oidcRedirectUri(),
      ),
      teams: resolveTeamsSettings(envelope.teams, this.config),
    }
  }

  private oidcRedirectUri(): string {
    return new URL(
      "/api/v1/auth/oidc/callback",
      this.config.publicBaseUrl,
    ).toString()
  }
}

export function resolveEnvironmentAuthenticationSettings(
  config: AppConfig,
): ResolvedAuthenticationSettings {
  return {
    smtp: resolveSmtpSettings(undefined, config),
    oidc: resolveOidcSettings(
      undefined,
      config,
      new URL("/api/v1/auth/oidc/callback", config.publicBaseUrl).toString(),
    ),
    teams: resolveTeamsSettings(undefined, config),
  }
}

function nextSmtpSettings(
  current: StoredSmtpSettings | undefined,
  input: UpdateSmtpAuthenticationSettings,
  revision: number,
): StoredSmtpSettings {
  if (input.mode !== "managed") return { mode: input.mode, revision }
  const previous = current?.mode === "managed" ? current : undefined
  const username =
    input.username === undefined
      ? previous?.username
      : input.username === null
        ? undefined
        : input.username
  const password = username ? (input.password ?? previous?.password) : undefined
  const configuration = smtpRuntimeConfigurationSchema.parse({
    host: input.host,
    port: input.port,
    security: input.security,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    from: input.from,
  })
  return { mode: "managed", revision, ...configuration }
}

function nextOidcSettings(
  current: StoredOidcSettings | undefined,
  input: UpdateOidcAuthenticationSettings,
  revision: number,
): StoredOidcSettings {
  if (input.mode !== "managed") return { mode: input.mode, revision }
  const clientSecret =
    input.client_secret ??
    (current?.mode === "managed" ? current.clientSecret : undefined)
  const configuration = oidcRuntimeConfigurationSchema.parse({
    issuerUrl: input.issuer_url,
    clientId: input.client_id,
    clientSecret,
    redirectUri: "https://linksense.invalid/api/v1/auth/oidc/callback",
  })
  return {
    mode: "managed",
    revision,
    issuerUrl: configuration.issuerUrl,
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
  }
}

function nextTeamsSettings(
  input: UpdateTeamsAuthenticationSettings,
  revision: number,
): StoredTeamsSettings {
  if (input.mode !== "managed") return { mode: input.mode, revision }
  const configuration = teamsRuntimeConfigurationSchema.parse({
    tenantId: input.tenant_id,
    clientId: input.client_id,
  })
  return { mode: "managed", revision, ...configuration }
}

function resolveSmtpSettings(
  stored: StoredSmtpSettings | undefined,
  config: AppConfig,
): ResolvedAuthenticationSettings["smtp"] {
  if (stored?.mode === "disabled") return disabledProvider(stored.revision)
  if (stored?.mode === "managed") {
    const configuration = smtpRuntimeConfigurationSchema.safeParse({
      host: stored.host,
      port: stored.port,
      security: stored.security,
      ...(stored.username ? { username: stored.username } : {}),
      ...(stored.password ? { password: stored.password } : {}),
      from: resolveSmtpFrom(stored.from, stored.username),
    })
    return configuration.success
      ? managedProvider(stored.revision, configuration.data)
      : managedInvalid(stored.revision)
  }
  const revision = stored?.revision ?? 0
  if (config.smtp.status === "not_configured") return inheritedEmpty(revision)
  const parsed = smtpRuntimeConfigurationSchema.safeParse({
    host: config.smtp.host,
    port: config.smtp.port,
    security: config.smtp.port === 465 ? "tls" : "starttls",
    ...(config.smtp.user ? { username: config.smtp.user } : {}),
    ...(config.smtp.password ? { password: config.smtp.password } : {}),
    from: resolveSmtpFrom(config.smtp.from, config.smtp.user),
  })
  return parsed.success
    ? inheritedConfigured(revision, parsed.data)
    : inheritedInvalid(revision)
}

function resolveOidcSettings(
  stored: StoredOidcSettings | undefined,
  config: AppConfig,
  redirectUri: string,
): ResolvedAuthenticationSettings["oidc"] {
  if (stored?.mode === "disabled") return disabledProvider(stored.revision)
  if (stored?.mode === "managed") {
    const configuration = oidcRuntimeConfigurationSchema.parse({
      issuerUrl: stored.issuerUrl,
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      redirectUri,
    })
    return managedProvider(stored.revision, configuration)
  }
  const revision = stored?.revision ?? 0
  if (config.oidc.status === "not_configured") return inheritedEmpty(revision)
  const parsed = oidcRuntimeConfigurationSchema.safeParse({
    issuerUrl: config.oidc.issuerUrl,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret,
    redirectUri: config.oidc.redirectUri,
  })
  return parsed.success
    ? inheritedConfigured(revision, parsed.data)
    : inheritedInvalid(revision)
}

function resolveTeamsSettings(
  stored: StoredTeamsSettings | undefined,
  config: AppConfig,
): ResolvedAuthenticationSettings["teams"] {
  if (stored?.mode === "disabled") return disabledProvider(stored.revision)
  if (stored?.mode === "managed") {
    return managedProvider(
      stored.revision,
      teamsRuntimeConfigurationSchema.parse({
        tenantId: stored.tenantId,
        clientId: stored.clientId,
      }),
    )
  }
  const revision = stored?.revision ?? 0
  if (config.teams.status === "not_configured") return inheritedEmpty(revision)
  const parsed = teamsRuntimeConfigurationSchema.safeParse({
    tenantId: config.teams.tenantId,
    clientId: config.teams.clientId,
  })
  return parsed.success
    ? inheritedConfigured(revision, parsed.data)
    : inheritedInvalid(revision)
}

function projectAdminSettings(
  resolved: ResolvedAuthenticationSettings,
  redirectUri: string,
): AuthenticationSettings {
  return authenticationSettingsSchema.parse({
    smtp: {
      mode: resolved.smtp.mode,
      status: resolved.smtp.status,
      source: resolved.smtp.source,
      revision: resolved.smtp.revision,
      host: resolved.smtp.configuration?.host ?? null,
      port: resolved.smtp.configuration?.port ?? null,
      security: resolved.smtp.configuration?.security ?? null,
      username: resolved.smtp.configuration?.username ?? null,
      from: resolved.smtp.configuration?.from ?? null,
      password_configured:
        resolved.smtp.configuration?.password !== undefined,
    },
    oidc: {
      mode: resolved.oidc.mode,
      status: resolved.oidc.status,
      source: resolved.oidc.source,
      revision: resolved.oidc.revision,
      issuer_url: resolved.oidc.configuration?.issuerUrl ?? null,
      client_id: resolved.oidc.configuration?.clientId ?? null,
      redirect_uri: redirectUri,
      client_secret_configured:
        resolved.oidc.configuration?.clientSecret !== undefined,
    },
    teams: {
      mode: resolved.teams.mode,
      status: resolved.teams.status,
      source: resolved.teams.source,
      revision: resolved.teams.revision,
      tenant_id: resolved.teams.configuration?.tenantId ?? null,
      client_id: resolved.teams.configuration?.clientId ?? null,
    },
  })
}

function managedProvider<Configuration>(
  revision: number,
  configuration: Configuration,
): ResolvedAuthenticationProvider<Configuration> {
  return {
    mode: "managed",
    status: "configured",
    source: "system",
    revision,
    configuration,
  }
}

function disabledProvider<Configuration>(
  revision: number,
): ResolvedAuthenticationProvider<Configuration> {
  return {
    mode: "disabled",
    status: "not_configured",
    source: "none",
    revision,
  }
}

function managedInvalid<Configuration>(
  revision: number,
): ResolvedAuthenticationProvider<Configuration> {
  return {
    mode: "managed",
    status: "invalid",
    source: "system",
    revision,
  }
}

function inheritedEmpty<Configuration>(
  revision: number,
): ResolvedAuthenticationProvider<Configuration> {
  return {
    mode: "inherit",
    status: "not_configured",
    source: "none",
    revision,
  }
}

function inheritedInvalid<Configuration>(
  revision: number,
): ResolvedAuthenticationProvider<Configuration> {
  return {
    mode: "inherit",
    status: "invalid",
    source: "environment",
    revision,
  }
}

function inheritedConfigured<Configuration>(
  revision: number,
  configuration: Configuration,
): ResolvedAuthenticationProvider<Configuration> {
  return {
    mode: "inherit",
    status: "configured",
    source: "environment",
    revision,
    configuration,
  }
}

function resolveSmtpFrom(
  from: string | undefined,
  username: string | undefined,
): string | undefined {
  if (from === undefined || isValidSmtpFromHeader(from)) return from
  const fallback = username?.trim()
  return fallback && smtpMailboxSchema.safeParse(fallback).success
    ? fallback
    : from
}

function isValidSmtpFromHeader(value: string): boolean {
  if (/[\r\n]/u.test(value)) return false
  try {
    const addresses = addressparser(value, { flatten: true })
    const [address] = addresses
    return (
      addresses.length === 1 &&
      address !== undefined &&
      smtpMailboxSchema.safeParse(address.address).success
    )
  } catch {
    return false
  }
}

function readStoredEnvelope(
  raw: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string,
): StoredAuthenticationEnvelope {
  const encrypted = raw[ENCRYPTED_SETTINGS_KEY]
  const keyId = raw[ENCRYPTION_KEY_ID_KEY]
  if (encrypted === undefined && keyId === undefined) return { version: 1 }
  if (typeof encrypted !== "string" || typeof keyId !== "string") {
    throw new Error("authentication settings envelope is incomplete")
  }
  if (keyId !== expectedKeyId) {
    throw new Error("authentication settings encryption key mismatch")
  }
  return storedAuthenticationEnvelopeSchema.parse(
    decryptJson<unknown>(
      encrypted,
      masterKey,
      expectedKeyId,
      ENCRYPTION_CONTEXT,
    ),
  )
}

export function isAllowedOidcRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === "https:") return true
    if (url.protocol !== "http:") return false
    return (
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    )
  } catch {
    return false
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
