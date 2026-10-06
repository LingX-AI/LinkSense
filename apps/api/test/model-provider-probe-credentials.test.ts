import { describe, expect, it, vi } from "vitest"
import type { ModelProviderProbeInput } from "@linksense/shared"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import { ModelProviderSettingsService } from "../src/modules/system/model-provider-settings.js"
import { testConfig } from "./test-config.js"

const draft: ModelProviderProbeInput = {
  channel_id: "saved", provider: "openai_compatible", base_url: "https://saved.example.test/v1",
  protocol_mode: "chat_completions_bridge",
}

function fixture(version = 9, enabled = true) {
  const config = testConfig({ LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED: String(enabled) })
  const plaintext = {
    version, revision: 3, defaultModel: null,
    ...(version >= 8 ? { titleModel: null } : {}),
    providers: [{ id: "saved", name: null, provider: "openai_compatible", providerProject: null, providerLocation: null,
      baseUrl: draft.base_url, protocolMode: "native_responses", apiKey: "saved-synthetic-key", models: [],
    }],
  }
  const settingsJson = {
    model_provider_settings_key_id: config.credentialKeyId,
    model_provider_settings_encrypted: encryptJson(plaintext, config.credentialMasterKey, config.credentialKeyId, "linksense:model-provider-settings:v1"),
  }
  const findUnique = vi.fn().mockResolvedValue({ settingsJson })
  const transaction = vi.fn().mockRejectedValue(new Error("probe must not persist"))
  const prisma = { systemSetting: { findUnique }, $transaction: transaction } as unknown as PrismaClient
  const probe = {
    discover: vi.fn().mockResolvedValue({ status: "supported", models: [], truncated: false }),
    testConnection: vi.fn().mockResolvedValue({ status: "success", model_id: "test-model" }),
  }
  return { service: new ModelProviderSettingsService(prisma, config, undefined, probe), probe, findUnique, transaction, settingsJson }
}

describe("read-only model probe credentials", () => {
  it.each([7, 8, 9])("reuses an unchanged saved version %i channel without persisting or upgrading it", async (version) => {
    const { service, probe, transaction, settingsJson } = fixture(version)
    const before = structuredClone(settingsJson)
    await service.discover(draft)
    await service.testConnection({ ...draft, model_id: "test-model" })
    expect(probe.discover).toHaveBeenCalledWith(expect.objectContaining({ api_key: "saved-synthetic-key", protocol_mode: "chat_completions_bridge" }))
    expect(probe.testConnection).toHaveBeenCalledWith(expect.objectContaining({ api_key: "saved-synthetic-key", model_id: "test-model", kind: "chat" }))
    expect(transaction).not.toHaveBeenCalled()
    expect(settingsJson).toEqual(before)
  })

  it.each([
    { base_url: "https://other.example.test/v1" },
    { base_url: "https://saved.example.test/other" },
    { provider: "openai" as const },
    { provider_project: "different-project" },
    { provider_location: "different-location" },
    { channel_id: "different-channel" },
  ])("does not send a saved key after the draft target changes: %j", async (change) => {
    const { service, probe } = fixture()
    await expect(service.discover({ ...draft, ...change })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CREDENTIAL_REQUIRED" })
    await expect(service.testConnection({ ...draft, ...change, model_id: "test-model" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CREDENTIAL_REQUIRED" })
    expect(probe.discover).not.toHaveBeenCalled()
    expect(probe.testConnection).not.toHaveBeenCalled()
  })

  it("uses a newly entered key for a changed target without reading the stored key", async () => {
    const { service, probe, findUnique } = fixture()
    await service.discover({ ...draft, base_url: "https://new.example.test/v1", api_key: "new-synthetic-key" })
    expect(findUnique).not.toHaveBeenCalled()
    expect(probe.discover).toHaveBeenCalledWith(expect.objectContaining({ api_key: "new-synthetic-key", base_url: "https://new.example.test/v1" }))
  })

  it("requires credentials for a new draft and rejects a malformed URL before sending a request", async () => {
    const { service, probe } = fixture()
    const newDraft = { ...draft, channel_id: undefined }
    await expect(service.discover(newDraft)).rejects.toMatchObject({ code: "MODEL_PROVIDER_CREDENTIAL_REQUIRED" })
    await expect(service.discover({ ...newDraft, base_url: "https://user:password@other.example.test", api_key: "new-synthetic-key" })).rejects.toThrow()
    expect(probe.discover).not.toHaveBeenCalled()
  })

  it("rejects probes before credential lookup when model management is disabled", async () => {
    const { service, probe, findUnique } = fixture(9, false)
    await expect(service.discover(draft)).rejects.toMatchObject({ code: "MODEL_MANAGEMENT_DISABLED" })
    await expect(service.testConnection({ ...draft, model_id: "test-model" })).rejects.toMatchObject({ code: "MODEL_MANAGEMENT_DISABLED" })
    expect(findUnique).not.toHaveBeenCalled()
    expect(probe.discover).not.toHaveBeenCalled()
    expect(probe.testConnection).not.toHaveBeenCalled()
  })
})
