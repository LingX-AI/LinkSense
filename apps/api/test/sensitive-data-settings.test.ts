import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"

import {
  MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH,
  updateSensitiveDataSettingsSchema,
} from "@linksense/shared"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import { AppError } from "../src/lib/errors.js"
import { sensitiveDataRoutes } from "../src/modules/sensitive-data/routes.js"
import type { SensitiveDataService } from "../src/modules/sensitive-data/service.js"
import { SensitiveDataSettingsService } from "../src/modules/sensitive-data/settings.js"

const ownerId = "10000000-0000-4000-8000-000000000001"
const credentialConfig = {
  credentialMasterKey: "fixture-master-key",
  credentialKeyId: "fixture-key-id",
}
const organizationPrompt = "Protect confidential purchase prices.\nInclude unpublished quotes."
const update = {
  enabled: true,
  expected_revision: 0,
  inspection: "every_request",
  local_model_ids: ["local"],
  default_model_id: "local",
  decision_endpoint: "http://decision.example.test/v1/systemone",
  decision_model_id: "classifier",
  decision_api_key: "fixture-access-key",
} as const

describe("sensitive data settings", () => {
  it("loads an existing policy and saves the organization prompt without exposing it in storage or the audit log", async () => {
    let stored: Record<string, unknown> = { registration_enabled: true }
    const prisma = {
      $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(prisma),
      $executeRaw: vi.fn(),
      systemSetting: {
        findUnique: vi.fn(async () => ({ settingsJson: stored })),
        upsert: vi.fn(async ({ update: { settingsJson } }: { update: { settingsJson: typeof stored } }) => {
          stored = settingsJson
        }),
      },
      auditLog: { create: vi.fn() },
    }
    const getAdminSettings = vi.fn().mockResolvedValue({ providers: [{
      id: "local-channel", base_url: "http://local.example.test/v1", api_key_configured: true,
      models: [{ id: "local", kind: "chat" }],
    }] })
    const settings = new SensitiveDataSettingsService(
      prisma as unknown as PrismaClient,
      credentialConfig,
      { getAdminSettings },
    )
    expect(await settings.getAdminSettings()).toMatchObject({ enabled: false, revision: 0, detection_prompt: null })
    stored.sensitive_data_settings_encrypted = encryptJson({
      enabled: true, revision: 0, inspection: update.inspection,
      local_model_ids: ["local"], default_model_id: "local",
      decision_endpoint: update.decision_endpoint, decision_model_id: update.decision_model_id,
      decisionApiKey: update.decision_api_key, modelBindings: { local: "previous-binding" },
    }, credentialConfig.credentialMasterKey, credentialConfig.credentialKeyId, "linksense-sensitive-data-settings")
    expect(await settings.getAdminSettings()).toMatchObject({
      enabled: true, decision_key_configured: true, detection_prompt: null,
    })
    const edited = await settings.update(ownerId, {
      ...update, local_model_ids: ["local"], detection_prompt: `  ${organizationPrompt}  `,
    }, {})
    expect(edited).toMatchObject({
      enabled: true, revision: 1, decision_key_configured: true, detection_prompt: organizationPrompt,
    })
    expect(JSON.stringify(edited)).not.toContain(update.decision_api_key)
    expect(JSON.stringify(stored)).not.toContain(update.decision_api_key)
    expect(JSON.stringify(stored)).not.toContain("Protect confidential purchase prices.")
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain("Protect confidential purchase prices.")
    expect(stored.registration_enabled).toBe(true)
    expect((await settings.read()).decisionApiKey).toBe(update.decision_api_key)
    await expect(settings.update(ownerId, { ...update, local_model_ids: ["local"] }, {}))
      .rejects.toMatchObject({ code: "CONFLICT" })
    const unchanged = { ...update, decision_api_key: undefined, local_model_ids: ["local"] }
    await settings.update(ownerId, { ...unchanged, expected_revision: 1, enabled: false }, {})
    expect(await settings.read()).toMatchObject({
      enabled: false, detection_prompt: organizationPrompt, decisionApiKey: update.decision_api_key,
    })
    await settings.update(ownerId, {
      ...unchanged, expected_revision: 2,
      decision_endpoint: "http://another.example.test/v1/systemone",
      detection_prompt: "  \n",
    }, {})
    expect(await settings.read()).toMatchObject({ detection_prompt: null, decisionApiKey: null })
  })

  it("rejects an oversized organization prompt", () => {
    expect(updateSensitiveDataSettingsSchema.safeParse({
      ...update, detection_prompt: "x".repeat(MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH + 1),
    }).success).toBe(false)
  })

  it.each(["file:///tmp/decision", "no-url", "https://user:pass@example.test/v1/systemone"])(
    "rejects invalid or credential-bearing decision service addresses",
    (decision_endpoint) => {
      expect(updateSensitiveDataSettingsSchema.safeParse({ ...update, decision_endpoint }).success).toBe(false)
    },
  )

  it("denies unauthenticated users and non-admins before returning admin settings", async () => {
    const getAdminSettings = vi.fn()
    const updateAdminSettings = vi.fn()
    const updateUserSettings = vi.fn()
    const switchModel = vi.fn()
    const app = Fastify()
    app.decorate("authenticate", async () => { throw new AppError("AUTH_REQUIRED") })
    app.decorate("requireAdmin", async () => { throw new AppError("FORBIDDEN") })
    app.setErrorHandler((error, _request, reply) => {
      const status = error instanceof AppError && error.code === "FORBIDDEN" ? 403 : 401
      void reply.code(status).send({ error_code: error instanceof AppError ? error.code : "INTERNAL_ERROR" })
    })
    await app.register(sensitiveDataRoutes, {
      service: {
        settings: { getAdminSettings, update: updateAdminSettings },
        updateUserSettings, switchModel,
      } as unknown as SensitiveDataService,
    })
    try {
      expect((await app.inject("/api/v1/system/sensitive-data-settings")).statusCode).toBe(403)
      expect((await app.inject("/api/v1/me/sensitive-data")).statusCode).toBe(401)
      expect((await app.inject({ method: "PUT", url: "/api/v1/system/sensitive-data-settings", payload: update })).statusCode).toBe(403)
      expect((await app.inject({ method: "PUT", url: "/api/v1/me/sensitive-data", payload: { detection_prompt: "Test rule" } })).statusCode).toBe(401)
      expect((await app.inject({
        method: "PATCH",
        url: `/api/v1/conversations/${ownerId}/sensitive-data`,
        payload: { model_id: "local-b", expected_model_id: "local-a" },
      })).statusCode).toBe(401)
      expect(getAdminSettings).not.toHaveBeenCalled()
      expect(updateAdminSettings).not.toHaveBeenCalled()
      expect(updateUserSettings).not.toHaveBeenCalled()
      expect(switchModel).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
