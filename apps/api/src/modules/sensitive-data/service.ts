import {
  defaultSensitiveDataPreference,
  sensitiveDataChoiceWaitMs,
  sensitiveDataChoiceSchema,
  sensitiveDataModelSwitchSchema,
  updateSensitiveDataPreferenceSchema,
  type SensitiveDataPreference,
  type SensitiveDataModelSwitch,
  type SensitiveDataRelayInput,
  type SensitiveDataRelayResult,
  type SensitiveDataTaskStatus,
  type SensitiveDataUserSettings,
  type UpdateSensitiveDataPreference,
} from "@linksense/shared"
import { z } from "zod"

import type { RunnerClient } from "../../adapters/runner.js"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import { AppError } from "../../lib/errors.js"
import { nextConversationEventSequence } from "../events/sequence.js"
import type {
  ModelProviderSettingsService,
  ResolvedManagedModelRuntime,
  ResolvedTaskTitleModelRuntime,
} from "../system/model-provider-settings.js"
import { maySendToExternalModel } from "./decision-model.js"
import {
  sensitiveDataModelBinding,
  type SensitiveDataSettingsService,
  type StoredSensitiveDataSettings,
} from "./settings.js"

const routingEvent = "sensitive_data.routing"
const approvalEvent = "sensitive_data.turn_approved"
const routingSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("waiting"), turn_id: z.uuid().nullable(), expires_at: z.number() }),
  z.strictObject({ status: z.literal("local"), turn_id: z.uuid().nullable(), model_id: z.string() }),
])
type TaskRouting = z.infer<typeof routingSchema>
type LocalRouting = Extract<TaskRouting, { status: "local" }>
type LocalModel = ResolvedManagedModelRuntime & {
  model: Extract<ResolvedManagedModelRuntime["model"], { kind: "chat" }>
  channel: ResolvedManagedModelRuntime["channel"] & { apiKey: string }
}
type ModelSettings = Pick<ModelProviderSettingsService, "resolveManagedModels" | "resolveTaskTitleModel">

export class SensitiveDataService {
  constructor(
    private readonly prisma: PrismaClient,
    readonly settings: SensitiveDataSettingsService,
    private readonly models: ModelSettings,
    private readonly preferences: Pick<RunnerClient, "getPersonalization" | "updatePersonalization">,
    private readonly checkContext = maySendToExternalModel,
  ) {}

  async getUserSettings(ownerId: string): Promise<SensitiveDataUserSettings> {
    const settings = await this.settings.read()
    const [options, preference] = await Promise.all([
      this.localModels(settings),
      this.getPreference(ownerId),
    ])
    return {
      enabled: settings.enabled,
      local_models: options.map(toOption),
      system_default_model_id: settings.default_model_id,
      preference: preference.default_model_id && !options.some(({ model }) => model.id === preference.default_model_id)
        ? { ...preference, default_model_id: null }
        : preference,
    }
  }

  async updateUserSettings(ownerId: string, input: UpdateSensitiveDataPreference): Promise<SensitiveDataUserSettings> {
    const preference = updateSensitiveDataPreferenceSchema.parse(input)
    if (preference.default_model_id && !await this.localModel(await this.settings.read(), preference.default_model_id)) {
      throw new AppError("VALIDATION_ERROR")
    }
    await this.preferences.updatePersonalization(ownerId, { sensitive_data: preference })
    return this.getUserSettings(ownerId)
  }

  async getTaskStatus(ownerId: string, conversationId: string): Promise<SensitiveDataTaskStatus> {
    await this.assertOwner(ownerId, conversationId)
    const routing = await this.readRouting(this.prisma, conversationId)
    if (!routing) return { status: "idle" }
    const settings = await this.settings.read()
    if (routing.status === "local") {
      const localModels = (await this.localModels(settings)).map(toOption)
      const selected = localModels.find(({ id }) => id === routing.model_id)
      if (!selected) return { status: "idle" }
      const activeTurnId = routing.turn_id === null
        ? await this.findActiveTurnId(this.prisma, conversationId)
        : null
      const pin = activeTurnId ? await this.readRouting(this.prisma, conversationId, activeTurnId) : null
      const active = pin?.status === "local" && pin.model_id !== selected.id
        ? localModels.find(({ id }) => id === pin.model_id)
        : undefined
      return {
        status: "local",
        model: active ?? selected,
        local_models: localModels,
        ...(active ? { next_model: selected } : {}),
      }
    }
    if (!routing.turn_id || routing.expires_at <= Date.now() ||
      !await this.isActiveTurn(conversationId, routing.turn_id)) {
      return { status: "idle" }
    }
    const localModels = await this.localModels(settings)
    return {
      status: "waiting",
      turn_id: routing.turn_id,
      local_models: localModels.map(toOption),
      default_model_id: settings.default_model_id,
    }
  }

  async chooseModel(
    ownerId: string,
    conversationId: string,
    input: z.infer<typeof sensitiveDataChoiceSchema>,
  ): Promise<SensitiveDataTaskStatus> {
    await this.assertOwner(ownerId, conversationId)
    const choice = sensitiveDataChoiceSchema.parse(input)
    if (!await this.localModel(await this.settings.read(), choice.model_id)) {
      throw new AppError("VALIDATION_ERROR")
    }
    await this.prisma.$transaction(async (tx) => {
      const sequence = await nextConversationEventSequence(tx, conversationId)
      await this.assertOwner(ownerId, conversationId, tx)
      const current = await this.readRouting(tx, conversationId)
      if (current?.status === "local") {
        const chosen = current.turn_id === choice.turn_id
          ? current
          : await this.readRouting(tx, conversationId, choice.turn_id)
        if (chosen?.status === "local" && chosen.model_id === choice.model_id) return
      }
      if (current?.status !== "waiting" || current.turn_id !== choice.turn_id ||
        current.expires_at <= Date.now() || !await this.isActiveTurn(conversationId, choice.turn_id, tx)) {
        throw new AppError("CONFLICT")
      }
      await this.writeRouting(tx, conversationId, sequence, {
        status: "local", turn_id: choice.turn_id, model_id: choice.model_id,
      })
    })
    if (choice.remember) {
      await this.preferences.updatePersonalization(ownerId, {
        sensitive_data: { selection: "default", default_model_id: choice.model_id },
      })
    }
    return this.getTaskStatus(ownerId, conversationId)
  }

  async switchModel(
    ownerId: string,
    conversationId: string,
    input: SensitiveDataModelSwitch,
  ): Promise<SensitiveDataTaskStatus> {
    const selection = sensitiveDataModelSwitchSchema.parse(input)
    await this.assertOwner(ownerId, conversationId)
    if (!await this.localModel(await this.settings.read(), selection.model_id)) {
      throw new AppError("VALIDATION_ERROR")
    }
    await this.prisma.$transaction(async (tx) => {
      let sequence = await nextConversationEventSequence(tx, conversationId)
      const conversation = await this.assertOwner(ownerId, conversationId, tx)
      const current = await this.readRouting(tx, conversationId)
      if (conversation.archiveStatus !== "active" || current?.status !== "local") {
        throw new AppError("CONFLICT")
      }
      if (current.model_id !== selection.expected_model_id && current.model_id !== selection.model_id) {
        throw new AppError("CONFLICT")
      }
      if (current.model_id === selection.model_id) return

      const activeTurnId = await this.findActiveTurnId(tx, conversationId)
      // Older routes may have started the active turn before its model was pinned.
      if (activeTurnId && current.turn_id !== activeTurnId) {
        const pin = await this.readRouting(tx, conversationId, activeTurnId)
        if (pin?.status !== "local") {
          await this.writeRouting(tx, conversationId, sequence, { ...current, turn_id: activeTurnId })
          sequence += 1n
        }
      }
      await this.writeRouting(tx, conversationId, sequence, {
        status: "local", turn_id: null, model_id: selection.model_id,
      })
    })
    return this.getTaskStatus(ownerId, conversationId)
  }

  async authorize(
    ownerId: string,
    input: SensitiveDataRelayInput,
    signal?: AbortSignal,
  ): Promise<SensitiveDataRelayResult> {
    await this.assertOwner(ownerId, input.conversation_id)
    const [settings, routing] = await Promise.all([
      this.settings.read(),
      this.readRouting(this.prisma, input.conversation_id),
    ])
    if (input.kind === "transport") {
      return { action: settings.enabled || routing ? "http" : "forward" }
    }
    if (routing?.status === "local") {
      return this.authorizeLocal(ownerId, input, settings, routing)
    }
    if (input.kind === "selection") {
      return { action: routing?.status === "waiting" && routing.turn_id === input.turn_id &&
        routing.expires_at > Date.now() ? "waiting" : "blocked" }
    }
    if (routing?.status === "waiting") {
      if (routing.turn_id === input.turn_id && routing.expires_at > Date.now() && !input.auxiliary) {
        return { action: "waiting" }
      }
      if (!input.auxiliary) return this.requireLocal(ownerId, input, settings)
    }
    if (!settings.enabled && !routing) return { action: "forward" }

    // The allowlist is bound to the registered channel and address. A model ID
    // on its own cannot establish that inference stays on the trusted network.
    if (settings.local_model_ids.includes(input.execution_model)) {
      return localResult(await this.localModel(settings, input.execution_model))
    }
    // Memory extraction and model-switch compaction can run before/after a
    // regular turn. Route these locally without opening a second user prompt.
    if (input.auxiliary) return localResult(await this.localModel(settings, settings.default_model_id))

    if (settings.inspection === "turn_start" && input.turn_id &&
      await this.turnApproved(input.conversation_id, input.turn_id, settings.revision)) {
      return { action: "forward" }
    }
    let loadedPreference: SensitiveDataPreference | undefined
    if (input.context !== null && settings.decision_endpoint && settings.decision_model_id &&
      (settings.inspection !== "turn_start" || !await this.hasOpaqueAttachments(input))) {
      // A failed preference read cannot establish that all of the user's criteria were checked.
      const preference = await this.getPreference(ownerId).catch(() => null)
      loadedPreference = preference ?? defaultSensitiveDataPreference
      signal?.throwIfAborted()
      if (preference && await this.checkContext({
        endpoint: settings.decision_endpoint,
        modelId: settings.decision_model_id,
        apiKey: settings.decisionApiKey,
        organizationPrompt: settings.detection_prompt,
        personalPrompt: preference.detection_prompt,
      }, input.context, signal)) {
        signal?.throwIfAborted()
        return await this.approveExternal(ownerId, input, settings)
      }
    }
    signal?.throwIfAborted()
    return this.requireLocal(ownerId, input, settings, loadedPreference)
  }

  async resolveTitleModel(conversationId?: string): Promise<ResolvedTaskTitleModelRuntime | null> {
    const [settings, route] = await Promise.all([
      this.settings.read(),
      conversationId ? this.readRouting(this.prisma, conversationId) : null,
    ])
    if (!settings.enabled && !route) return this.models.resolveTaskTitleModel()
    const model = await this.localModel(settings, route?.status === "local" ? route.model_id : settings.default_model_id)
    return model ? { ...model, trustedLocal: true } : null
  }

  private async authorizeLocal(
    ownerId: string,
    input: Pick<SensitiveDataRelayInput, "conversation_id" | "turn_id">,
    settings: StoredSensitiveDataSettings,
    routing: LocalRouting,
  ): Promise<SensitiveDataRelayResult> {
    const { conversation_id: conversationId, turn_id: turnId } = input
    if (!turnId || routing.turn_id === turnId) {
      return localResult(await this.localModel(settings, routing.model_id))
    }
    const pinned = await this.readRouting(this.prisma, conversationId, turnId)
    if (pinned?.status === "local") return localResult(await this.localModel(settings, pinned.model_id))
    // Freeze the selected model for each turn before sending its first local request.
    const route = await this.prisma.$transaction(async (tx) => {
      const sequence = await nextConversationEventSequence(tx, conversationId)
      await this.assertOwner(ownerId, conversationId, tx)
      const existing = await this.readRouting(tx, conversationId, turnId)
      if (existing?.status === "local") return existing
      const selected = await this.readRouting(tx, conversationId)
      if (selected?.status !== "local") return null
      const next = { ...selected, turn_id: turnId }
      await this.writeRouting(tx, conversationId, sequence, next)
      return next
    })
    return localResult(await this.localModel(settings, route?.model_id ?? null))
  }

  private async requireLocal(
    ownerId: string,
    input: Extract<SensitiveDataRelayInput, { kind: "inspect" }>,
    settings: StoredSensitiveDataSettings,
    loadedPreference?: SensitiveDataPreference,
  ): Promise<SensitiveDataRelayResult> {
    const candidates = await this.localModels(settings)
    const askable = input.turn_id !== null && candidates.length > 1
    const preference = askable
      ? loadedPreference ?? await this.getPreference(ownerId).catch(() => defaultSensitiveDataPreference)
      : defaultSensitiveDataPreference
    const selected = candidates.length === 1
      ? candidates[0]
      : candidates.find(({ model }) => preference.default_model_id === model.id) ??
        candidates.find(({ model }) => settings.default_model_id === model.id)

    const route = await this.prisma.$transaction(async (tx) => {
      const sequence = await nextConversationEventSequence(tx, input.conversation_id)
      await this.assertOwner(ownerId, input.conversation_id, tx)
      const current = await this.readRouting(tx, input.conversation_id)
      if (current?.status === "local" ||
        (current?.status === "waiting" && current.turn_id === input.turn_id && current.expires_at > Date.now())) {
        return current
      }
      const next: TaskRouting = selected && (!askable || preference.selection === "default")
        ? { status: "local", turn_id: input.turn_id, model_id: selected.model.id }
        : { status: "waiting", turn_id: input.turn_id, expires_at: Date.now() + sensitiveDataChoiceWaitMs }
      await this.writeRouting(tx, input.conversation_id, sequence, next)
      return next
    })
    return route.status === "local"
      ? this.authorizeLocal(ownerId, input, await this.settings.read(), route)
      : { action: candidates.length > 0 && askable ? "waiting" : "blocked" }
  }

  private async approveExternal(
    ownerId: string,
    input: Extract<SensitiveDataRelayInput, { kind: "inspect" }>,
    settings: StoredSensitiveDataSettings,
  ): Promise<SensitiveDataRelayResult> {
    if ((await this.settings.read()).revision !== settings.revision) return { action: "blocked" }
    const turnId = input.turn_id
    return this.prisma.$transaction(async (tx) => {
      const sequence = await nextConversationEventSequence(tx, input.conversation_id)
      await this.assertOwner(ownerId, input.conversation_id, tx)
      const routing = await this.readRouting(tx, input.conversation_id)
      if (routing) return { action: "blocked" }
      if (settings.inspection === "turn_start" && turnId &&
        !await this.turnApproved(input.conversation_id, turnId, settings.revision, tx)) {
        await tx.conversationEvent.create({
          data: {
            conversationId: input.conversation_id,
            turnId,
            sequenceNo: sequence,
            sseEventId: `${input.conversation_id}:${sequence}`,
            eventType: approvalEvent,
            visibility: "internal_sanitized",
            payloadJson: { revision: settings.revision },
          },
        })
      }
      return { action: "forward" }
    })
  }

  private async turnApproved(conversationId: string, turnId: string, revision: number, db: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    return Boolean(await db.conversationEvent.findFirst({
      where: {
        conversationId, turnId, eventType: approvalEvent,
        payloadJson: { path: ["revision"], equals: revision },
      },
      select: { id: true },
    }))
  }

  private async hasOpaqueAttachments(input: Extract<SensitiveDataRelayInput, { kind: "inspect" }>): Promise<boolean> {
    const { conversation_id, turn_id } = input
    const [file, pending] = await Promise.all([
      this.prisma.conversationFile.findFirst({
        where: { conversationId: conversation_id, kind: "attachment", turnId: { not: null } },
        select: { id: true },
      }),
      turn_id ? this.prisma.conversationTurnStartIntent.findUnique({
        where: { projectionTurnId: turn_id },
        select: { attachmentsJson: true },
      }) : null,
    ])
    // Codex sees workspace links for many attachment types. An approval based
    // on just those links cannot clear the referenced content for cloud use.
    return Boolean(file || (Array.isArray(pending?.attachmentsJson) && pending.attachmentsJson.length > 0))
  }

  private async assertOwner(
    ownerId: string,
    conversationId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ archiveStatus: string }> {
    const owned = await db.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: { archiveStatus: true },
    })
    if (!owned) throw new AppError("CONVERSATION_NOT_FOUND")
    return owned
  }

  private async findActiveTurnId(db: Prisma.TransactionClient, conversationId: string): Promise<string | null> {
    const [turn, start] = await Promise.all([
      db.conversationTurn.findFirst({
        where: { conversationId, status: "running" },
        select: { id: true },
      }),
      db.conversationTurnStartIntent.findFirst({
        where: { conversationId, runnerStatus: { in: ["prepared", "runner_succeeded"] } },
        select: { projectionTurnId: true },
      }),
    ])
    return turn?.id ?? start?.projectionTurnId ?? null
  }

  private async isActiveTurn(conversationId: string, turnId: string, db: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const [turn, start] = await Promise.all([
      db.conversationTurn.findFirst({
        where: { id: turnId, conversationId, status: "running" },
        select: { id: true },
      }),
      db.conversationTurnStartIntent.findFirst({
        where: { projectionTurnId: turnId, conversationId, runnerStatus: { in: ["prepared", "runner_succeeded"] } },
        select: { projectionTurnId: true },
      }),
    ])
    return Boolean(turn || start)
  }

  private async getPreference(ownerId: string): Promise<SensitiveDataPreference> {
    return (await this.preferences.getPersonalization(ownerId)).sensitive_data ?? defaultSensitiveDataPreference
  }

  private async localModels(settings: StoredSensitiveDataSettings, ids = settings.local_model_ids): Promise<LocalModel[]> {
    if (ids.length === 0) return []
    const models = await this.models.resolveManagedModels(ids, "chat")
    return models.flatMap((runtime) => {
      const { model, channel } = runtime
      if (model.kind !== "chat" || !channel.apiKey ||
        settings.modelBindings[model.id] !== sensitiveDataModelBinding(channel.id, channel.baseUrl)) return []
      return [{ ...runtime, model, channel: { ...channel, apiKey: channel.apiKey } }]
    })
  }

  private async localModel(settings: StoredSensitiveDataSettings, id: string | null): Promise<LocalModel | null> {
    if (!id || !settings.local_model_ids.includes(id)) return null
    const [model] = await this.localModels(settings, [id])
    return model ?? null
  }

  private async readRouting(db: Prisma.TransactionClient, conversationId: string, turnId?: string): Promise<TaskRouting | null> {
    const row = await db.conversationEvent.findFirst({
      where: { conversationId, eventType: routingEvent, ...(turnId ? { turnId } : {}) },
      orderBy: { sequenceNo: "desc" },
      select: { payloadJson: true },
    })
    return row ? routingSchema.parse(row.payloadJson) : null
  }

  private async writeRouting(db: Prisma.TransactionClient, conversationId: string, sequenceNo: bigint, routing: TaskRouting): Promise<void> {
    await db.conversationEvent.create({
      data: {
        conversationId,
        turnId: routing.turn_id,
        sequenceNo,
        sseEventId: `${conversationId}:${sequenceNo}`,
        eventType: routingEvent,
        visibility: "internal_sanitized",
        payloadJson: routing,
      },
    })
  }
}

function toOption({ model }: LocalModel): { id: string; name: string } {
  return { id: model.id, name: model.display_name }
}

function localResult(local: LocalModel | null): SensitiveDataRelayResult {
  if (!local) return { action: "blocked" }
  const { model, channel, revision } = local
  return {
    action: "local",
    runtime: {
      model: model.id,
      reasoningEffort: model.default_reasoning_effort,
      baseUrl: channel.baseUrl,
      protocolMode: channel.protocolMode,
      apiKey: channel.apiKey,
      revision,
      pricing: {
        input_price_per_million: model.input_price_per_million,
        cached_input_price_per_million: model.cached_input_price_per_million,
        output_price_per_million: model.output_price_per_million,
      },
    },
  }
}
