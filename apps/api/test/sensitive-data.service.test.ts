import { describe, expect, it, vi } from "vitest"

import type { SensitiveDataPreference, SensitiveDataRelayInput } from "@linksense/shared"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import type { maySendToExternalModel } from "../src/modules/sensitive-data/decision-model.js"
import { SensitiveDataService } from "../src/modules/sensitive-data/service.js"
import { sensitiveDataModelBinding, type SensitiveDataSettingsService } from "../src/modules/sensitive-data/settings.js"
import type { ResolvedManagedModelRuntime } from "../src/modules/system/model-provider-settings.js"

const ownerId = "10000000-0000-4000-8000-000000000001"
const conversationId = "10000000-0000-4000-8000-000000000002"
const firstTurn = "10000000-0000-4000-8000-000000000003"
const secondTurn = "10000000-0000-4000-8000-000000000004"
const thirdTurn = "10000000-0000-4000-8000-000000000005"
const preferenceDefaults = {
  custom_instructions: "", memories_enabled: false, show_reasoning: true, task_auto_naming: "first_message",
} as const
const personalPreference = {
  selection: "ask",
  default_model_id: null,
  detection_prompt: "Protect internal project codenames.",
} satisfies SensitiveDataPreference
const firstRequest = {
  kind: "inspect",
  conversation_id: conversationId,
  turn_id: firstTurn,
  execution_model: "external",
  auxiliary: false,
  context: "ordinary task",
} satisfies SensitiveDataRelayInput

describe("sensitive data routing", () => {
  it("forwards with the feature disabled and skips the classifier on an approved local model", async () => {
    const { service, check, settings, preferences } = fixture(personalPreference)
    settings.enabled = false
    expect(await service.authorize(ownerId, firstRequest)).toEqual({ action: "forward" })
    settings.enabled = true
    expect(await service.authorize(ownerId, { ...firstRequest, execution_model: "local-a" }))
      .toMatchObject({ action: "local", runtime: { model: "local-a" } })
    expect(await service.authorize(ownerId, { ...firstRequest, execution_model: "local-a", auxiliary: true }))
      .toMatchObject({ action: "local", runtime: { model: "local-a" } })
    expect(check).not.toHaveBeenCalled()
    expect(preferences.getPersonalization).not.toHaveBeenCalled()
  })

  it("checks the first model request of each turn and reuses only that turn's approval", async () => {
    const { service, check, settings, preferences } = fixture(personalPreference)
    settings.inspection = "turn_start"
    expect(await service.authorize(ownerId, firstRequest)).toEqual({ action: "forward" })
    preferences.getPersonalization.mockResolvedValue({
      ...preferenceDefaults,
      sensitive_data: { ...personalPreference, detection_prompt: "Protect unreleased product names." },
    })
    expect(await service.authorize(ownerId, { ...firstRequest, context: "new tool output" })).toEqual({ action: "forward" })
    expect(check).toHaveBeenCalledTimes(1)
    await service.authorize(ownerId, { ...firstRequest, turn_id: secondTurn })
    expect(check).toHaveBeenCalledTimes(2)
    expect(check.mock.calls.map(([model]) => model.personalPrompt)).toEqual([
      personalPreference.detection_prompt, "Protect unreleased product names.",
    ])
  })

  it("inspects tool output in every-request mode, prompts once and persists the choice and preference", async () => {
    const { service, check, settings, preferences } = fixture(personalPreference)
    settings.detection_prompt = "Protect unpublished purchase prices."
    check.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await service.authorize(ownerId, firstRequest)).toEqual({ action: "forward" })
    expect(await service.authorize(ownerId, { ...firstRequest, context: "sensitive tool result" }))
      .toEqual({ action: "waiting" })
    expect(check.mock.calls[1]?.[1]).toBe("sensitive tool result")
    expect(check.mock.calls[1]?.[0]).toMatchObject({
      organizationPrompt: settings.detection_prompt,
      personalPrompt: personalPreference.detection_prompt,
    })
    expect(preferences.getPersonalization).toHaveBeenCalledWith(ownerId)
    expect(await service.getTaskStatus(ownerId, conversationId)).toMatchObject({ status: "waiting", turn_id: firstTurn })
    expect(await service.chooseModel(ownerId, conversationId, { turn_id: firstTurn, model_id: "local-b", remember: true }))
      .toMatchObject({ status: "local", model: { id: "local-b" } })
    expect(preferences.updatePersonalization).toHaveBeenCalledWith(ownerId, {
      sensitive_data: { selection: "default", default_model_id: "local-b" },
    })
    settings.enabled = false
    expect(await service.authorize(ownerId, { ...firstRequest, turn_id: secondTurn }))
      .toMatchObject({ action: "local", runtime: { model: "local-b" } })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it("selects the remaining trusted model when the saved default has been removed", async () => {
    const { service, settings, check } = fixture({ ...personalPreference, selection: "default", default_model_id: "local-b" })
    settings.local_model_ids = ["local-a"]
    check.mockResolvedValue(false)
    expect(await service.authorize(ownerId, firstRequest))
      .toMatchObject({ action: "local", runtime: { model: "local-a" } })
  })

  it("routes locally without a classifier request when personal criteria cannot be read", async () => {
    const { service, check, preferences, settings } = fixture()
    settings.local_model_ids = ["local-a"]
    preferences.getPersonalization.mockRejectedValue(new Error("unavailable"))
    expect(await service.authorize(ownerId, firstRequest))
      .toMatchObject({ action: "local", runtime: { model: "local-a" } })
    expect(check).not.toHaveBeenCalled()
    expect(preferences.getPersonalization).toHaveBeenCalledTimes(1)
  })

  it("routes attachments whose bytes were not included in the prompt to the local picker", async () => {
    const { service, check, prisma, settings } = fixture()
    settings.inspection = "turn_start"
    prisma.conversationTurnStartIntent.findUnique.mockResolvedValue({ attachmentsJson: [{ id: "file" }] })
    expect(await service.authorize(ownerId, firstRequest)).toEqual({ action: "waiting" })
    expect(check).not.toHaveBeenCalled()
  })

  it("keeps a protected task blocked when approved channel bindings change", async () => {
    const { service, settings, check } = fixture({ ...personalPreference, selection: "default", default_model_id: "local-b" })
    check.mockResolvedValue(false)
    await service.authorize(ownerId, firstRequest)
    settings.modelBindings["local-b"] = "changed"
    expect(await service.authorize(ownerId, { ...firstRequest, turn_id: secondTurn })).toEqual({ action: "blocked" })
  })

  it("uses the task's approved local model for titles and blocks titles if that binding changes", async () => {
    const { service, settings, check, modelSettings } = fixture({
      ...personalPreference, selection: "default", default_model_id: "local-b",
    })
    check.mockResolvedValue(false)
    await expect(service.authorize(ownerId, firstRequest)).resolves.toMatchObject({
      action: "local", runtime: { model: "local-b" },
    })

    settings.enabled = false
    await expect(service.resolveTitleModel(conversationId)).resolves.toMatchObject({
      trustedLocal: true,
      model: { id: "local-b" },
    })

    settings.modelBindings["local-b"] = "changed"
    await expect(service.resolveTitleModel(conversationId)).resolves.toBeNull()
    expect(modelSettings.resolveTaskTitleModel).not.toHaveBeenCalled()
  })

  it("keeps the active turn on its local model and applies a saved switch to the next turn", async () => {
    const { service, settings, check, preferences, prisma } = fixture({
      ...personalPreference, selection: "default", default_model_id: "local-a",
    })
    check.mockResolvedValue(false)
    expect(await service.authorize(ownerId, firstRequest))
      .toMatchObject({ action: "local", runtime: { model: "local-a" } })
    settings.enabled = false

    const selection = { expected_model_id: "local-a", model_id: "local-b" }
    const scheduled = await service.switchModel(ownerId, conversationId, selection)
    expect(scheduled).toEqual({
      status: "local",
      model: { id: "local-a", name: "local-a" },
      local_models: [{ id: "local-a", name: "local-a" }, { id: "local-b", name: "local-b" }],
      next_model: { id: "local-b", name: "local-b" },
    })
    const writeCount = prisma.conversationEvent.create.mock.calls.length
    expect(await service.switchModel(ownerId, conversationId, selection)).toEqual(scheduled)
    expect(prisma.conversationEvent.create).toHaveBeenCalledTimes(writeCount)
    expect(await service.authorize(ownerId, { ...firstRequest, context: "later tool output" }))
      .toMatchObject({ action: "local", runtime: { model: "local-a" } })
    expect(await service.authorize(ownerId, { ...firstRequest, turn_id: secondTurn }))
      .toMatchObject({ action: "local", runtime: { model: "local-b", baseUrl: "http://local-b.example.test/v1" } })
    const following = await service.getTaskStatus(ownerId, conversationId)
    expect(following).toMatchObject({ status: "local", model: { id: "local-b" } })
    expect(following).not.toHaveProperty("next_model")
    expect(check).toHaveBeenCalledTimes(1)
    expect(preferences.updatePersonalization).not.toHaveBeenCalled()
  })

  it.each(["running", "starting"] as const)(
    "preserves a %s turn from an existing protected task without a per-turn route",
    async (activity) => {
      const { service, check, prisma } = fixture({
        ...personalPreference, selection: "default", default_model_id: "local-a",
      })
      check.mockResolvedValue(false)
      await service.authorize(ownerId, firstRequest)
      prisma.conversationTurn.findFirst.mockResolvedValue(activity === "running" ? { id: secondTurn } : null)
      if (activity === "starting") {
        prisma.conversationTurnStartIntent.findFirst.mockResolvedValue({ projectionTurnId: secondTurn })
      }
      expect(await service.switchModel(ownerId, conversationId, { expected_model_id: "local-a", model_id: "local-b" }))
        .toMatchObject({ model: { id: "local-a" }, next_model: { id: "local-b" } })
      expect(await service.authorize(ownerId, { ...firstRequest, turn_id: secondTurn }))
        .toMatchObject({ action: "local", runtime: { model: "local-a" } })
      expect(await service.authorize(ownerId, { ...firstRequest, turn_id: thirdTurn }))
        .toMatchObject({ action: "local", runtime: { model: "local-b" } })
    },
  )

  it("updates the displayed local model immediately when the protected task is idle", async () => {
    const { service, check, prisma } = fixture({
      ...personalPreference, selection: "default", default_model_id: "local-a",
    })
    check.mockResolvedValue(false)
    await service.authorize(ownerId, firstRequest)
    prisma.conversationTurn.findFirst.mockResolvedValue(null)
    const switched = await service.switchModel(ownerId, conversationId, {
      expected_model_id: "local-a", model_id: "local-b",
    })
    expect(switched).toMatchObject({ status: "local", model: { id: "local-b" } })
    expect(switched).not.toHaveProperty("next_model")
    expect(await service.authorize(ownerId, { ...firstRequest, turn_id: secondTurn }))
      .toMatchObject({ action: "local", runtime: { model: "local-b" } })
  })

  it("rejects switches for other users, unprotected tasks, stale selections and unavailable models", async () => {
    const { service, check, prisma, settings } = fixture({
      ...personalPreference, selection: "default", default_model_id: "local-a",
    })
    const selection = { expected_model_id: "local-a", model_id: "local-b" }
    prisma.conversation.findFirst.mockResolvedValueOnce(null)
    await expect(service.switchModel(secondTurn, conversationId, selection))
      .rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" })
    await expect(service.switchModel(ownerId, conversationId, selection))
      .rejects.toMatchObject({ code: "CONFLICT" })
    check.mockResolvedValue(false)
    await service.authorize(ownerId, firstRequest)
    await expect(service.switchModel(ownerId, conversationId, { ...selection, expected_model_id: "outdated" }))
      .rejects.toMatchObject({ code: "CONFLICT" })
    await expect(service.switchModel(ownerId, conversationId, { ...selection, model_id: "external" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    prisma.conversation.findFirst.mockResolvedValue({ archiveStatus: "archived" })
    await expect(service.switchModel(ownerId, conversationId, selection))
      .rejects.toMatchObject({ code: "CONFLICT" })
    prisma.conversation.findFirst.mockResolvedValue({ archiveStatus: "active" })
    settings.modelBindings["local-b"] = "changed"
    await expect(service.switchModel(ownerId, conversationId, selection))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    expect(await service.getTaskStatus(ownerId, conversationId)).toEqual({
      status: "local", model: { id: "local-a", name: "local-a" },
      local_models: [{ id: "local-a", name: "local-a" }],
    })
  })

  it("rejects other users and disallows unapproved models and stale choices", async () => {
    const { service, check, prisma } = fixture()
    prisma.conversation.findFirst.mockResolvedValueOnce(null)
    await expect(service.getTaskStatus(secondTurn, conversationId)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" })
    check.mockResolvedValue(false)
    await service.authorize(ownerId, firstRequest)
    await expect(service.chooseModel(ownerId, conversationId, {
      turn_id: firstTurn, model_id: "external", remember: false,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.chooseModel(ownerId, conversationId, {
      turn_id: secondTurn, model_id: "local-a", remember: false,
    })).rejects.toMatchObject({ code: "CONFLICT" })
  })
})

function fixture(preference?: SensitiveDataPreference) {
  const models = [model("local-a"), model("local-b")]
  const settings: Awaited<ReturnType<SensitiveDataSettingsService["read"]>> = {
    revision: 1, enabled: true, inspection: "every_request", local_model_ids: models.map(({ model }) => model.id),
    default_model_id: "local-a", decision_endpoint: "http://decision.example.test/v1/systemone",
    decision_model_id: "classifier", detection_prompt: null, decisionApiKey: "test-placeholder",
    modelBindings: Object.fromEntries(models.map(({ model, channel }) => [model.id, sensitiveDataModelBinding(channel.id, channel.baseUrl)])),
  }
  const events: Array<{ eventType: string; turnId: string | null; sequenceNo: bigint; payloadJson: { revision?: number } }> = []
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: async <T>(run: (db: unknown) => Promise<T>) => run(prisma),
    conversation: { findFirst: vi.fn().mockResolvedValue({ archiveStatus: "active" }) },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue({ id: firstTurn }) },
    conversationTurnStartIntent: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    conversationFile: { findFirst: vi.fn().mockResolvedValue(null) },
    conversationEvent: {
      findFirst: vi.fn(async ({ where }: { where: {
        eventType?: string; turnId?: string; payloadJson?: { equals: number };
      } }) => [...events].reverse().find((event) =>
        (!where.eventType || event.eventType === where.eventType) &&
        (!where.turnId || event.turnId === where.turnId) &&
        (!where.payloadJson || event.payloadJson.revision === where.payloadJson.equals)
      ) ?? null),
      create: vi.fn(async ({ data }: { data: typeof events[number] }) => events.push(data)),
    },
  }
  const check = vi.fn<typeof maySendToExternalModel>(async () => true)
  const preferences = {
    getPersonalization: vi.fn(async () => ({ ...preferenceDefaults, ...(preference ? { sensitive_data: preference } : {}) })),
    updatePersonalization: vi.fn(async () => preferenceDefaults),
  }
  const modelSettings = {
    resolveManagedModels: vi.fn(async (ids: readonly string[]) =>
      models.filter(({ model }) => ids.includes(model.id))),
    resolveTaskTitleModel: vi.fn(async () => null),
  }
  const service = new SensitiveDataService(
    prisma as unknown as PrismaClient,
    { read: vi.fn(async () => settings) } as unknown as SensitiveDataSettingsService,
    modelSettings,
    preferences,
    check,
  )
  return { service, check, settings, preferences, prisma, modelSettings }
}

function model(id: string): ResolvedManagedModelRuntime {
  return {
    revision: 1,
    model: {
      kind: "chat", id, display_name: id, enabled: true, supports_image_input: true,
      context_window: null, default_reasoning_effort: "medium", supported_reasoning_efforts: ["medium"],
      input_price_per_million: "0", cached_input_price_per_million: "0", output_price_per_million: "0",
    },
    channel: {
      id, name: id, provider: "openai_compatible", providerProject: null, providerLocation: null,
      baseUrl: `http://${id}.example.test/v1`, protocolMode: "chat_completions_bridge", apiKey: "local-test",
    },
  }
}
