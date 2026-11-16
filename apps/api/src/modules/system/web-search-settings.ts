import {
  testWebSearchSettingsSchema, updateWebSearchSettingsSchema, webSearchProviderDefinitions,
  webSearchSettingsSchema, type UpdateWebSearchSettings, type WebSearchRequest,
  type WebSearchSettings, type WebSearchSuccess,
} from "@linksense/shared"
import { z } from "zod"

import { createWebSearchRunner, type WebSearchRunner, type WebSearchRuntime } from "../../adapters/web-search-provider.js"
import type { AppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"

const SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_KEY = "web_search_settings_encrypted"
const KEY_ID_KEY = "web_search_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:web-search-settings:v1"
const storedSchema = webSearchSettingsSchema.omit({ api_key_configured: true }).extend({
  version: z.literal(1), api_key: z.string().min(1).max(16_384).nullable(),
})
type StoredSettings = z.infer<typeof storedSchema>

export class WebSearchSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly runner: WebSearchRunner = createWebSearchRunner(undefined, config.safeHttp),
  ) {}

  async getAdminSettings(): Promise<WebSearchSettings> {
    return project(await this.readStored())
  }

  async update(actorId: string, rawInput: UpdateWebSearchSettings, context: AuditContext): Promise<WebSearchSettings> {
    const input = updateWebSearchSettingsSchema.parse(rawInput)
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`
      const row = await tx.systemSetting.findUnique({ where: { id: SETTINGS_ID }, select: { settingsJson: true } })
      const raw = object(row?.settingsJson)
      const value = this.prepare(input, this.decode(raw))
      if (value.enabled) runtime(value)
      const settingsJson = {
        ...raw,
        [ENCRYPTED_KEY]: encryptJson(value, this.config.credentialMasterKey, this.config.credentialKeyId, ENCRYPTION_CONTEXT),
        [KEY_ID_KEY]: this.config.credentialKeyId,
      }
      await tx.systemSetting.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, settingsJson, updatedBy: actorId },
        update: { settingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({ data: {
        actorId, action: "web_search_settings_updated", targetType: "web_search", targetId: "link-sense", result: "success",
        metadataJson: { revision: value.revision, enabled: value.enabled, provider: value.provider, api_key_replaced: input.api_key !== undefined },
        ipAddress: context.ipAddress ?? null, userAgent: context.userAgent ?? null,
      } })
      return value
    })
    return project(next)
  }

  async testConnection(rawInput: z.input<typeof testWebSearchSettingsSchema>, signal?: AbortSignal): Promise<WebSearchSuccess> {
    const input = testWebSearchSettingsSchema.parse(rawInput)
    const next = this.prepare({ ...input.settings, enabled: true }, await this.readStored())
    return this.runner(runtime(next), input.request, signal)
  }

  async search(input: {
    ownerId: string; conversationId: string; turnId: string; request: WebSearchRequest; signal?: AbortSignal
  }): Promise<WebSearchSuccess> {
    const [user, turn, conversation] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: input.ownerId, status: "active" }, select: { id: true } }),
      this.prisma.conversationTurn.findFirst({ where: {
        id: input.turnId, conversationId: input.conversationId, submittedBy: input.ownerId, status: "running",
      }, select: { id: true } }),
      this.prisma.conversation.findFirst({ where: { id: input.conversationId, ownerId: input.ownerId, archiveStatus: "active" }, select: { id: true } }),
    ])
    if (!user || !turn || !conversation) throw new AppError("WEB_SEARCH_FORBIDDEN")
    const stored = await this.readStored()
    if (!stored) throw new AppError("WEB_SEARCH_NOT_CONFIGURED")
    if (!stored.enabled) throw new AppError("WEB_SEARCH_DISABLED")
    const result = await this.runner(runtime(stored), input.request, input.signal)
    input.signal?.throwIfAborted()
    return result
  }

  private prepare(input: UpdateWebSearchSettings, current: StoredSettings | null): StoredSettings {
    if ((current?.revision ?? 0) !== input.expected_revision) throw new AppError("CONFLICT")
    const endpoint = input.base_url ?? webSearchProviderDefinitions.find((value) => value.key === input.provider)?.endpoint ?? null
    const changed = current?.provider !== input.provider || current?.base_url !== endpoint
    return storedSchema.parse({
      version: 1, revision: (current?.revision ?? 0) + 1, enabled: input.enabled,
      provider: input.provider, base_url: endpoint, search_engine_id: input.provider === "google" ? input.search_engine_id : null,
      default_max_results: input.default_max_results, timeout_ms: input.timeout_ms,
      api_key: input.api_key !== undefined ? input.api_key : changed ? null : current?.api_key ?? null,
    })
  }

  private async readStored(): Promise<StoredSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { id: SETTINGS_ID }, select: { settingsJson: true } })
    return this.decode(object(row?.settingsJson))
  }

  private decode(raw: Record<string, unknown>): StoredSettings | null {
    if (raw[ENCRYPTED_KEY] === undefined && raw[KEY_ID_KEY] === undefined) return null
    if (typeof raw[ENCRYPTED_KEY] !== "string" || raw[KEY_ID_KEY] !== this.config.credentialKeyId) {
      throw new AppError("WEB_SEARCH_UNAVAILABLE")
    }
    try {
      return storedSchema.parse(decryptJson<unknown>(raw[ENCRYPTED_KEY], this.config.credentialMasterKey, this.config.credentialKeyId, ENCRYPTION_CONTEXT))
    } catch {
      throw new AppError("WEB_SEARCH_UNAVAILABLE")
    }
  }
}

function runtime(value: StoredSettings): WebSearchRuntime {
  const definition = webSearchProviderDefinitions.find((item) => item.key === value.provider)
  if (!value.provider || !value.base_url || !definition || (definition.requires_api_key && !value.api_key) || (value.provider === "google" && !value.search_engine_id)) {
    throw new AppError("WEB_SEARCH_NOT_CONFIGURED")
  }
  return {
    provider: value.provider, endpoint: value.base_url, apiKey: value.api_key,
    searchEngineId: value.search_engine_id, defaultMaxResults: value.default_max_results, timeoutMs: value.timeout_ms,
  }
}

function project(value: StoredSettings | null): WebSearchSettings {
  return webSearchSettingsSchema.parse({
    enabled: value?.enabled ?? false, provider: value?.provider ?? null, base_url: value?.base_url ?? null,
    search_engine_id: value?.search_engine_id ?? null, api_key_configured: Boolean(value?.api_key),
    revision: value?.revision ?? 0, default_max_results: value?.default_max_results ?? 5, timeout_ms: value?.timeout_ms ?? 15_000,
  })
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? { ...value } : {}
}
