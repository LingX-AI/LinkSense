import { afterEach, describe, expect, it, vi } from "vitest"
import * as safeHttp from "../src/lib/safe-http-fetch.js"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { WebSearchSettingsService } from "../src/modules/system/web-search-settings.js"
import { testConfig } from "./test-config.js"

const actor = "10000000-0000-4000-8000-000000000001"
const request = { ownerId: actor, conversationId: "20000000-0000-4000-8000-000000000001", turnId: "30000000-0000-4000-8000-000000000001", request: { query: "test" } }
const input = { expected_revision: 0, enabled: true, provider: "deepseek" as const, base_url: null, search_engine_id: null, default_max_results: 5, timeout_ms: 15_000, api_key: "synthetic-search-key" }
const result = { success: true as const, provider: "deepseek" as const, query: "test", results: [] }
afterEach(() => vi.restoreAllMocks())

function fixture(initial: Record<string, unknown> = {}) {
  let settingsJson = initial
  const database = {
    $executeRaw: vi.fn(),
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson })),
      upsert: vi.fn(async (value: { update: { settingsJson: Record<string, unknown> } }) => { settingsJson = value.update.settingsJson }),
    },
    auditLog: { create: vi.fn() }, user: { findFirst: vi.fn().mockResolvedValue({ id: actor }) },
    conversation: { findFirst: vi.fn().mockResolvedValue({ id: request.conversationId }) },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue({ id: request.turnId }) },
  }
  const prisma = { ...database, $transaction: async <T>(fn: (tx: typeof database) => Promise<T>) => fn(database) }
  const runner = vi.fn().mockResolvedValue(result)
  const client = prisma as unknown as PrismaClient
  return { database, prisma: client, runner, service: new WebSearchSettingsService(client, testConfig(), runner), stored: () => settingsJson }
}

describe("web search settings", () => {
  it.each([false, true])("passes the configured DNS proxy policy to the real search transport (%s)", async (allowed) => {
    const f = fixture()
    const transport = vi.spyOn(safeHttp, "requestPublicHttpResource").mockResolvedValue(Response.json({ results: [] }))
    const service = new WebSearchSettingsService(f.prisma, { ...testConfig(), safeHttp: { allowBenchmarkProxyAddresses: allowed } })
    await service.update(actor, input, {})
    await expect(service.search(request)).resolves.toMatchObject({ success: true, results: [] })
    expect(transport).toHaveBeenCalledWith(new URL("https://api.deepseek.com/v1/tools/search"), expect.objectContaining({ allowBenchmarkProxyAddresses: allowed }))
  })
  it("keeps pre-feature settings usable and leaves web search disabled until configured", async () => {
    const f = fixture({ product: { name: "Existing organization" }, unrelated_secret_encrypted: "untouched" })
    await expect(f.service.getAdminSettings()).resolves.toMatchObject({ revision: 0, enabled: false, provider: null, api_key_configured: false })
    await expect(f.service.search(request)).rejects.toMatchObject({ code: "WEB_SEARCH_NOT_CONFIGURED" })
    const saved = await f.service.update(actor, input, {})
    expect(saved).toMatchObject({ revision: 1, api_key_configured: true, provider: "deepseek" })
    expect(JSON.stringify(saved)).not.toContain(input.api_key)
    expect(JSON.stringify(f.stored())).not.toContain(input.api_key)
    expect(f.stored()).toMatchObject({ product: { name: "Existing organization" }, unrelated_secret_encrypted: "untouched" })
    expect(JSON.stringify(f.database.auditLog.create.mock.calls)).not.toContain(input.api_key)
  })
  it("uses current saved settings on every call, including changes within an existing task", async () => {
    const f = fixture()
    await f.service.update(actor, input, {})
    await f.service.search(request)
    expect(f.database.user.findFirst).toHaveBeenCalledWith({ where: { id: actor, status: "active" }, select: { id: true } })
    expect(f.database.conversationTurn.findFirst).toHaveBeenCalledWith({ where: { id: request.turnId, conversationId: request.conversationId, submittedBy: actor, status: "running" }, select: { id: true } })
    expect(f.database.conversation.findFirst).toHaveBeenCalledWith({ where: { id: request.conversationId, ownerId: actor, archiveStatus: "active" }, select: { id: true } })
    expect(f.runner).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "deepseek", apiKey: input.api_key }), request.request, undefined)
    await f.service.update(actor, { ...input, expected_revision: 1, provider: "tavily", api_key: "new-synthetic-key" }, {})
    await f.service.search(request)
    expect(f.runner).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "tavily", apiKey: "new-synthetic-key" }), request.request, undefined)
    await f.service.update(actor, { ...input, expected_revision: 2, enabled: false }, {})
    await expect(f.service.search(request)).rejects.toMatchObject({ code: "WEB_SEARCH_DISABLED" })
    expect(f.runner).toHaveBeenCalledTimes(2)
  })
  it("retains omitted keys only for the same provider and endpoint", async () => {
    const f = fixture()
    await f.service.update(actor, input, {})
    const { api_key: _key, ...withoutKey } = input
    expect(_key).toBe(input.api_key)
    await expect(f.service.update(actor, { ...withoutKey, expected_revision: 1 }, {})).resolves.toMatchObject({ api_key_configured: true })
    await expect(f.service.update(actor, { ...withoutKey, expected_revision: 2, base_url: "https://other.example.test/search" }, {})).rejects.toMatchObject({ code: "WEB_SEARCH_NOT_CONFIGURED" })
    await expect(f.service.update(actor, { ...withoutKey, expected_revision: 2, provider: "tavily" }, {})).rejects.toMatchObject({ code: "WEB_SEARCH_NOT_CONFIGURED" })
    await expect(f.service.update(actor, { ...withoutKey, expected_revision: 2, enabled: false, api_key: null }, {})).resolves.toMatchObject({ api_key_configured: false })
  })
  it("rejects stale revisions before saving or testing with a retained key", async () => {
    const f = fixture()
    await f.service.update(actor, input, {})
    await expect(f.service.update(actor, input, {})).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(f.service.testConnection({ settings: input, request: request.request })).rejects.toMatchObject({ code: "CONFLICT" })
    expect(f.runner).not.toHaveBeenCalled()
  })
  it("contains corrupt saved credentials without exposing decryption details or calling the provider", async () => {
    const f = fixture()
    await f.service.update(actor, input, {})
    f.stored().web_search_settings_encrypted = "corrupt-envelope"
    await expect(f.service.getAdminSettings()).rejects.toMatchObject({ code: "WEB_SEARCH_UNAVAILABLE", message: "WEB_SEARCH_UNAVAILABLE" })
    await expect(f.service.search(request)).rejects.toMatchObject({ code: "WEB_SEARCH_UNAVAILABLE" })
    expect(f.runner).not.toHaveBeenCalled()
  })
  it("tests an unsaved draft without persisting it or changing the active provider", async () => {
    const f = fixture()
    await f.service.update(actor, input, {})
    const before = JSON.stringify(f.stored())
    await expect(f.service.testConnection({ settings: { ...input, expected_revision: 1, enabled: false, provider: "brave", api_key: "draft-key" }, request: request.request })).resolves.toEqual(result)
    expect(f.runner).toHaveBeenCalledWith(expect.objectContaining({ provider: "brave", apiKey: "draft-key" }), request.request, undefined)
    expect(JSON.stringify(f.stored())).toBe(before)
  })
  it.each(["user", "conversation", "conversationTurn"] as const)("denies searches when the %s authorization check fails", async (resource) => {
    const f = fixture()
    await f.service.update(actor, input, {})
    f.database[resource].findFirst.mockResolvedValue(null)
    await expect(f.service.search(request)).rejects.toMatchObject({ code: "WEB_SEARCH_FORBIDDEN" })
    expect(f.runner).not.toHaveBeenCalled()
  })
})
