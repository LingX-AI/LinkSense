import { describe, expect, it, vi } from "vitest"

import { ConversationTitleService } from "../src/modules/conversations/title-service.js"

const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const OWNER_ID = "10000000-0000-4000-8000-000000000001"

describe("ConversationTitleService", () => {
  it("generates from persisted history, stores the title, and publishes its event", async () => {
    const fixture = titleFixture()
    await fixture.service.refresh(CONVERSATION_ID)
    expect(fixture.generator.generate).toHaveBeenCalledWith([
      { role: "user", content: "实现任务自动命名" },
      { role: "assistant", content: "已完成实现" },
    ])
    expect(fixture.user.findUnique).not.toHaveBeenCalled()
    expect(fixture.usageRecorder.recordModelUsage).toHaveBeenCalledWith({
      requestId: "30000000-0000-4000-8000-000000000001",
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      operation: "task_auto_naming",
      workload: "task_title_generation",
      modelKind: "generation",
      model: "title-model",
      measurementMethod: "provider",
      tokenUsage: {
        totalTokens: 30,
        inputTokens: 24,
        cachedInputTokens: 4,
        outputTokens: 6,
        reasoningOutputTokens: 1,
      },
      pricing: {
        input_price_per_million: "1",
        cached_input_price_per_million: "0.5",
        output_price_per_million: "2",
      },
    })
    expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, titleSource: "fallback" },
      data: { title: "任务自动命名", titleSource: "generated" },
    })
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({
        event_type: "conversation.title.updated",
        payload: expect.objectContaining({ title: "任务自动命名" }),
      }),
    )
  })

  it("starts naming from the accepted user message without waiting for persisted history", async () => {
    const fixture = titleFixture()

    fixture.service.scheduleForUserMessage(
      CONVERSATION_ID,
      "消息发送成功后立即命名任务",
    )

    await vi.waitFor(() => {
      expect(fixture.generator.generate).toHaveBeenCalledWith([
        { role: "user", content: "消息发送成功后立即命名任务" },
      ])
    })
    expect(fixture.prisma.conversationMessage.findMany).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID, titleSource: "fallback" },
        data: { title: "任务自动命名", titleSource: "generated" },
      })
    })
  })

  it("sends only the user request from an Office annotation prompt to the title provider", async () => {
    const display = {
      kind: "spreadsheet_annotation",
      file_id: "70000000-0000-4000-8000-000000000001",
      file_name: "财务数据.xlsx",
      request: "把结果改为百分比",
      sheet_name: "汇总",
      sheet_index: 0,
      selection_type: "range",
      selection_label: "B2:C3",
      selection_count: 1,
      annotation_count: 1,
    }
    const internalPrompt = `[LinkSense office annotation]\nDisplay metadata:\n${JSON.stringify(display)}\n\nAnnotation fingerprint:\n${"a".repeat(64)}\n\nUser request:\n把结果改为百分比\n\nApply the user request to the selected range.\n\nSelection locator:\nrangeAddress="private-range"\n\nSelected formula:\n=PRIVATE_FORMULA()\n\nSelected content:\nprivate selected content`
    const fixture = titleFixture("fallback", [
      { role: "user", contentText: internalPrompt },
      { role: "assistant", contentText: "已完成处理" },
    ])

    await fixture.service.refresh(CONVERSATION_ID)

    expect(fixture.generator.generate).toHaveBeenCalledWith([
      { role: "user", content: "把结果改为百分比" },
      { role: "assistant", content: "已完成处理" },
    ])
    expect(JSON.stringify(fixture.generator.generate.mock.calls)).not.toMatch(
      /private-range|PRIVATE_FORMULA|private selected content/u,
    )
  })

  it.each([
    [
      "the previous presentation marker",
      `[LinkSense presentation annotation]\nDisplay metadata:\n${JSON.stringify(
        {
          kind: "presentation_annotation",
          file_id: "70000000-0000-4000-8000-000000000001",
          file_name: "AI 入门.pptx",
          request: "改为英文",
          slide_number: 2,
          selection_count: 1,
          annotation_count: 1,
        },
      )}\n\nAnnotation fingerprint:\n${"b".repeat(64)}\n\nUser request:\n改为英文\n\nApply the user request\n\nElement locator:\nprivate-element-id\n\nSelected content:\nprivate presentation content`,
    ],
    [
      "the legacy Chinese presentation prompt",
      `用户要求：\n改为英文\n\n请基于演示文稿“AI 入门.pptx”第 2 页中选中的 1 个元素完成上述要求。\n\n元素定位：\nfileId="70000000-0000-4000-8000-000000000001"\nelementId="private-legacy-element"\n\n选中内容：\nprivate legacy content`,
    ],
  ])(
    "sanitizes %s before title generation",
    async (_caseName, internalPrompt) => {
      const fixture = titleFixture("fallback", [
        { role: "user", contentText: internalPrompt },
      ])

      await fixture.service.refresh(CONVERSATION_ID)

      expect(fixture.generator.generate).toHaveBeenCalledWith([
        { role: "user", content: "改为英文" },
      ])
      expect(JSON.stringify(fixture.generator.generate.mock.calls)).not.toMatch(
        /private-element-id|private presentation content|private-legacy-element|private legacy content/u,
      )
    },
  )

  it("never calls the provider for a manually named task", async () => {
    const fixture = titleFixture("manual")
    await fixture.service.refresh(CONVERSATION_ID)
    expect(fixture.generator.generate).not.toHaveBeenCalled()
    expect(fixture.tx.conversation.updateMany).not.toHaveBeenCalled()
  })

  it("upgrades an existing external application title into an automatic task title", async () => {
    const fixture = titleFixture("manual", undefined, {
      title: "ManageBac助手",
      applicationId: "30000000-0000-4000-8000-000000000001",
      applicationNameSnapshot: "ManageBac助手",
      accountType: "application_external",
    })

    await fixture.service.refresh(CONVERSATION_ID)

    expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        titleSource: "manual",
        title: "ManageBac助手",
      },
      data: { title: "任务自动命名", titleSource: "generated" },
    })
  })

  it("never calls the provider for an already generated task title", async () => {
    const fixture = titleFixture("generated")
    await fixture.service.refresh(CONVERSATION_ID)
    expect(fixture.generator.generate).not.toHaveBeenCalled()
    expect(fixture.tx.conversation.updateMany).not.toHaveBeenCalled()
  })

  it("keeps the current title when the provider cannot generate one", async () => {
    const fixture = titleFixture()
    fixture.generator.generate.mockResolvedValueOnce(null)
    await fixture.service.refresh(CONVERSATION_ID)
    expect(fixture.tx.conversation.updateMany).not.toHaveBeenCalled()
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled()
  })

  it("does not rerun a queued completion refresh after the accepted message generates a title", async () => {
    const fixture = titleFixture()
    let resolveEarlyTitle!: (
      title: ReturnType<typeof generatedTitle> | null,
    ) => void
    const earlyTitle = new Promise<ReturnType<typeof generatedTitle> | null>(
      (resolve) => {
        resolveEarlyTitle = resolve
      },
    )
    fixture.generator.generate
      .mockReturnValueOnce(earlyTitle)
      .mockResolvedValueOnce(generatedTitle("完整回复后的标题"))

    fixture.service.scheduleForUserMessage(
      CONVERSATION_ID,
      "消息发送成功后生成标题",
    )
    await vi.waitFor(() => {
      expect(fixture.generator.generate).toHaveBeenCalledOnce()
    })
    expect(fixture.generator.generate).toHaveBeenNthCalledWith(1, [
      { role: "user", content: "消息发送成功后生成标题" },
    ])

    fixture.service.schedule(CONVERSATION_ID)
    expect(fixture.generator.generate).toHaveBeenCalledOnce()

    resolveEarlyTitle(generatedTitle("消息发送成功时的标题"))

    await vi.waitFor(() => {
      expect(fixture.tx.conversation.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: CONVERSATION_ID, titleSource: "fallback" },
        data: {
          title: "消息发送成功时的标题",
          titleSource: "generated",
        },
      })
    })
    await vi.waitFor(() => {
      expect(fixture.generator.generate).toHaveBeenCalledOnce()
    })
    await vi.waitFor(() => {
      expect(fixture.tx.conversation.updateMany).toHaveBeenCalledOnce()
    })
  })

  it("runs a queued completion refresh when the accepted message cannot generate a title", async () => {
    const fixture = titleFixture()
    let resolveEarlyTitle!: (
      title: ReturnType<typeof generatedTitle> | null,
    ) => void
    const earlyTitle = new Promise<ReturnType<typeof generatedTitle> | null>(
      (resolve) => {
        resolveEarlyTitle = resolve
      },
    )
    fixture.generator.generate
      .mockReturnValueOnce(earlyTitle)
      .mockResolvedValueOnce(generatedTitle("完整回复后的标题"))

    fixture.service.scheduleForUserMessage(
      CONVERSATION_ID,
      "消息发送成功后生成标题",
    )
    await vi.waitFor(() => {
      expect(fixture.generator.generate).toHaveBeenCalledOnce()
    })
    fixture.service.schedule(CONVERSATION_ID)

    resolveEarlyTitle(null)

    await vi.waitFor(() => {
      expect(fixture.generator.generate).toHaveBeenCalledTimes(2)
    })
    expect(fixture.generator.generate).toHaveBeenNthCalledWith(2, [
      { role: "user", content: "实现任务自动命名" },
      { role: "assistant", content: "已完成实现" },
    ])
    await vi.waitFor(() => {
      expect(fixture.tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID, titleSource: "fallback" },
        data: {
          title: "完整回复后的标题",
          titleSource: "generated",
        },
      })
    })
  })
})

function titleFixture(
  titleSource = "fallback",
  messages: Array<{ role: string; contentText: string }> = [
    { role: "user", contentText: "实现任务自动命名" },
    { role: "assistant", contentText: "已完成实现" },
  ],
  conversationOverrides: {
    title?: string
    applicationId?: string | null
    applicationNameSnapshot?: string | null
    accountType?: string
  } = {},
) {
  const createdAt = new Date("2026-07-15T00:00:00.000Z")
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    conversation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    conversationEvent: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: String(data.id),
        conversationId: CONVERSATION_ID,
        turnId: null,
        sequenceNo: 1n,
        eventType: "conversation.title.updated",
        visibility: "user_visible",
        sseEventId: `${CONVERSATION_ID}:1`,
        createdAt,
      })),
    },
  }
  const user = {
    findUnique: vi.fn(async () => ({
      preferredLocale: "en-US",
      accountType: conversationOverrides.accountType ?? "local",
    })),
  }
  const prisma = {
    conversation: {
      findUnique: vi.fn(async () => ({
        ownerId: OWNER_ID,
        codexThreadId: "codex-thread-1",
        title: conversationOverrides.title ?? "未命名任务",
        titleSource,
        applicationId: conversationOverrides.applicationId ?? null,
        applicationNameSnapshot:
          conversationOverrides.applicationNameSnapshot ?? null,
      })),
    },
    conversationMessage: {
      findMany: vi.fn(async () => messages),
    },
    user,
    $transaction: vi.fn(
      async (action: (transaction: typeof tx) => Promise<unknown>) =>
        action(tx),
    ),
  }
  const redis = { publishConversationEvent: vi.fn(async () => undefined) }
  const generator = {
    generate: vi.fn(
      async (): Promise<ReturnType<typeof generatedTitle> | null> =>
        generatedTitle("任务自动命名"),
    ),
  }
  const usageRecorder = {
    recordModelUsage: vi.fn(async () => ({ recorded: true })),
  }
  return {
    prisma,
    tx,
    redis,
    user,
    generator,
    usageRecorder,
    service: new ConversationTitleService(
      prisma as never,
      redis as never,
      generator as never,
      usageRecorder as never,
    ),
  }
}

function generatedTitle(title: string) {
  return {
    requestId: "30000000-0000-4000-8000-000000000001",
    title,
    model: "title-model",
    pricing: {
      input_price_per_million: "1",
      cached_input_price_per_million: "0.5",
      output_price_per_million: "2",
    },
    usage: {
      totalTokens: 30,
      inputTokens: 24,
      cachedInputTokens: 4,
      outputTokens: 6,
      reasoningOutputTokens: 1,
      measurementMethod: "provider" as const,
    },
  }
}
