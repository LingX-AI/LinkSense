import { randomUUID } from "node:crypto"

import { conversationEventSchema } from "@linksense/shared"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import type { LinkSenseRedis } from "../../adapters/redis.js"
import type { RunnerClient } from "../../adapters/runner.js"
import {
  TASK_TITLE_SOURCE_MESSAGE_LIMIT,
  type ManagedTaskTitleGenerator,
  type TaskTitleMessage,
} from "../../adapters/dashscope-title.js"
import { truncateConversationTitle } from "../../lib/conversation-title.js"
import { nextConversationEventSequence } from "../events/sequence.js"
import type { ModelUsageRecorder } from "../usage/model-usage.js"
import { inspectOfficeAnnotationPrompt } from "./annotation-prompt.js"

export class ConversationTitleService {
  readonly #versions = new Map<string, number>()
  readonly #scheduledRefreshes = new Map<
    string,
    {
      rerunRequested: boolean
      nextMessages: TaskTitleMessage[] | undefined
    }
  >()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: LinkSenseRedis,
    private readonly generator: ManagedTaskTitleGenerator,
    private readonly usageRecorder: ModelUsageRecorder,
    private readonly personalization: Pick<RunnerClient, "getPersonalization">,
  ) {}

  schedule(conversationId: string): void {
    this.#schedule(conversationId)
  }

  scheduleForUserMessage(conversationId: string, content: string): void {
    const userMessage = titleUserMessageContent(content).trim()
    if (!userMessage) return
    this.#schedule(conversationId, [{ role: "user", content: userMessage }])
  }

  #schedule(conversationId: string, messages?: TaskTitleMessage[]): void {
    const scheduled = this.#scheduledRefreshes.get(conversationId)
    if (scheduled) {
      scheduled.rerunRequested = true
      if (messages) scheduled.nextMessages = messages
      return
    }

    const state = { rerunRequested: false, nextMessages: messages }
    this.#scheduledRefreshes.set(conversationId, state)
    const run = async (): Promise<void> => {
      const nextMessages = state.nextMessages
      state.nextMessages = undefined
      let updated = false
      try {
        updated = await this.refresh(conversationId, undefined, nextMessages)
      } catch {
        // Title generation remains best-effort and never affects the turn.
      }
      if (updated && !state.nextMessages) {
        this.#scheduledRefreshes.delete(conversationId)
        return
      }
      if (state.rerunRequested) {
        state.rerunRequested = false
        void run()
        return
      }
      this.#scheduledRefreshes.delete(conversationId)
    }
    void run()
  }

  async refresh(
    conversationId: string,
    version?: number,
    sourceMessages?: TaskTitleMessage[],
  ): Promise<boolean> {
    const expectedVersion =
      version ?? (this.#versions.get(conversationId) ?? 0) + 1
    if (version === undefined)
      this.#versions.set(conversationId, expectedVersion)
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        ownerId: true,
        codexThreadId: true,
        title: true,
        titleSource: true,
      },
    })
    if (!conversation || conversation.titleSource === "manual") return false
    const renameEveryMessage =
      sourceMessages !== undefined &&
      (await this.personalization.getPersonalization(conversation.ownerId))
        .task_auto_naming === "every_message"
    let eligibleTitleWhere:
      | { titleSource: "fallback" }
      | { titleSource: "generated"; title: string }
    if (conversation.titleSource === "fallback") {
      eligibleTitleWhere = { titleSource: "fallback" }
    } else if (conversation.titleSource === "generated" && renameEveryMessage) {
      eligibleTitleWhere = {
        titleSource: "generated",
        title: conversation.title,
      }
    } else {
      return false
    }

    const messages =
      sourceMessages && !renameEveryMessage
        ? sourceMessages
        : (
            await this.prisma.conversationMessage.findMany({
              where: { conversationId, role: { in: ["user", "assistant"] } },
              orderBy: { sequenceNo: "desc" },
              take: TASK_TITLE_SOURCE_MESSAGE_LIMIT,
              select: { role: true, contentText: true },
            })
          ).reverse()
    const generation = await this.generator.generate(
      messages.flatMap((message) =>
        message.role === "user" || message.role === "assistant"
          ? [
              {
                role: message.role,
                content:
                  "contentText" in message && message.role === "user"
                    ? titleUserMessageContent(message.contentText)
                    : "contentText" in message
                      ? message.contentText
                      : message.content,
              },
            ]
          : [],
      ),
    )
    if (generation) {
      try {
        await this.usageRecorder.recordModelUsage({
          requestId: generation.requestId,
          ownerId: conversation.ownerId,
          conversationId,
          operation: "task_auto_naming",
          workload: "task_title_generation",
          modelKind: "generation",
          model: generation.model,
          measurementMethod: generation.usage.measurementMethod,
          tokenUsage: {
            totalTokens: generation.usage.totalTokens,
            inputTokens: generation.usage.inputTokens,
            cachedInputTokens: generation.usage.cachedInputTokens,
            outputTokens: generation.usage.outputTokens,
            reasoningOutputTokens: generation.usage.reasoningOutputTokens,
          },
          pricing: generation.pricing,
        })
      } catch {
        // Usage persistence is best-effort and must not prevent title updates.
      }
    }
    const title = generation?.title
      ? truncateConversationTitle(generation.title)
      : null
    if (!title || this.#versions.get(conversationId) !== expectedVersion)
      return false

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.conversation.updateMany({
        where: { id: conversationId, ...eligibleTitleWhere },
        data: { title, titleSource: "generated" },
      })
      if (updated.count !== 1) return null
      const sequenceNo = await nextConversationEventSequence(tx, conversationId)
      const payload = {
        schema_version: 1 as const,
        title,
        ...(conversation.codexThreadId
          ? { thread_id: conversation.codexThreadId }
          : {}),
      }
      const event = await tx.conversationEvent.create({
        data: {
          id: randomUUID(),
          conversationId,
          turnId: null,
          sequenceNo,
          eventType: "conversation.title.updated",
          visibility: "user_visible",
          payloadJson: payload as Prisma.InputJsonValue,
          sseEventId: `${conversationId}:${sequenceNo}`,
        },
      })
      return { event, payload }
    })
    if (!result) return false
    const projected = conversationEventSchema.parse({
      id: result.event.id,
      conversation_id: result.event.conversationId,
      turn_id: null,
      sequence_no: Number(result.event.sequenceNo),
      event_type: result.event.eventType,
      visibility: result.event.visibility,
      payload: result.payload,
      sse_event_id: result.event.sseEventId,
      created_at: result.event.createdAt.toISOString(),
    })
    await this.redis.publishConversationEvent(conversationId, projected)
    return true
  }
}

function titleUserMessageContent(content: string): string {
  const annotation = inspectOfficeAnnotationPrompt(content)
  return annotation.suspected ? (annotation.request ?? "") : content
}
