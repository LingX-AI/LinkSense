import { beforeEach, describe, expect, it, vi } from "vitest"

const { createTaskLanguageModel, generateText } = vi.hoisted(() => ({
  createTaskLanguageModel: vi.fn(() => ({ modelId: "title-model" })),
  generateText: vi.fn(),
}))

vi.mock("ai", () => ({ generateText }))
vi.mock("../src/adapters/task-language-model.js", () => ({
  createTaskLanguageModel,
}))

import {
  ManagedTaskTitleGenerator,
  sanitizeTitle,
  type TaskTitleModelCall,
} from "../src/adapters/dashscope-title.js"

describe("ManagedTaskTitleGenerator", () => {
  beforeEach(() => {
    createTaskLanguageModel.mockClear()
    generateText.mockReset()
  })

  it("calls the selected channel through the task protocol adapter", async () => {
    generateText.mockResolvedValue({
      text: "Managed title",
      usage: {
        totalTokens: 8,
        inputTokens: 6,
        outputTokens: 2,
        inputTokenDetails: { cacheReadTokens: 1 },
        outputTokenDetails: { reasoningTokens: 0 },
      },
    })
    const generator = new ManagedTaskTitleGenerator({
      resolveTaskTitleModel: vi.fn(async () => runtime()),
    })

    await expect(
      generator.generate([{ role: "user", content: "name this task" }]),
    ).resolves.toMatchObject({ title: "Managed title", model: "title-model" })

    expect(createTaskLanguageModel).toHaveBeenCalledWith({
      model: "title-model",
      apiKey: "secret",
      baseUrl: "https://models.example.test/v1",
      protocolMode: "chat_completions_bridge",
    })
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: "title-model" },
        maxOutputTokens: 128,
        maxRetries: 0,
        timeout: { totalMs: 20_000 },
      }),
    )
    expect(generateText.mock.calls[0]?.[0]).not.toHaveProperty("temperature")
  })

  it("uses the administrator-selected chat model and preserves provider usage", async () => {
    const callModel = vi.fn<TaskTitleModelCall>(async () => ({
      text: "标题：任务自动命名。",
      usage: {
        totalTokens: 30,
        inputTokens: 24,
        cachedInputTokens: 4,
        outputTokens: 6,
        reasoningOutputTokens: 1,
      },
    }))
    const settings = { resolveTaskTitleModel: vi.fn(async () => runtime()) }
    const generator = new ManagedTaskTitleGenerator(settings, { callModel })

    const result = await generator.generate([
      { role: "user", content: "给任务自动生成名称" },
    ])

    expect(settings.resolveTaskTitleModel).toHaveBeenCalledOnce()
    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          model: expect.objectContaining({ id: "title-model" }),
        }),
        system: expect.stringContaining("用户请求的主要语言"),
        prompt: expect.stringContaining("User: 给任务自动生成名称"),
      }),
    )
    expect(result).toMatchObject({
      title: "任务自动命名",
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
        measurementMethod: "provider",
      },
    })
    expect(result?.requestId).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it("asks the model for sidebar-sized titles with one core action", async () => {
    const callModel = vi.fn<TaskTitleModelCall>(async () => ({
      text: "整理 InfoCare 产品线",
    }))
    const generator = new ManagedTaskTitleGenerator(
      { resolveTaskTitleModel: vi.fn(async () => runtime()) },
      { callModel },
    )

    await generator.generate([
      {
        role: "user",
        content:
          "https://www.infocare.org.cn/整理这家公司的产品线为Word文档给我",
      },
    ])

    const systemPrompt = String(callModel.mock.calls[0]?.[0].system)
    expect(systemPrompt).toContain("标题用于狭窄的侧边栏")
    expect(systemPrompt).toContain("以最新用户请求体现的任务意图为重点")
    expect(systemPrompt).toContain("只保留一个核心动作和一个核心对象")
    expect(systemPrompt).toContain(
      "纯中文标题优先 6-12 个汉字，最多 16 个汉字",
    )
    expect(systemPrompt).toContain("纯英文标题优先 3-6 个单词")
    expect(systemPrompt).toContain("不照抄网址或协议")
    expect(systemPrompt).toContain("整理 InfoCare 产品线")
  })

  it("estimates token usage when the provider omits usage", async () => {
    const generator = new ManagedTaskTitleGenerator(
      { resolveTaskTitleModel: vi.fn(async () => runtime()) },
      {
        callModel: vi.fn(async () => ({
          text: "Create quarterly launch plan",
        })),
      },
    )

    const result = await generator.generate([
      { role: "user", content: "Create a quarterly launch plan" },
    ])

    expect(result?.usage.measurementMethod).toBe("estimated")
    expect(result?.usage.inputTokens).toBeGreaterThan(0)
    expect(result?.usage.outputTokens).toBeGreaterThan(0)
    expect(result?.usage.totalTokens).toBe(
      (result?.usage.inputTokens ?? 0) + (result?.usage.outputTokens ?? 0),
    )
  })

  it("keeps user intent primary when assistant context is present", async () => {
    const callModel = vi.fn<TaskTitleModelCall>(async () => ({
      text: "调整演示页为浅色科技风",
    }))
    const generator = new ManagedTaskTitleGenerator(
      { resolveTaskTitleModel: vi.fn(async () => runtime()) },
      { callModel },
    )

    await generator.generate([
      { role: "user", content: "将产品演示页改为浅色科技风" },
      { role: "assistant", content: "已完成：" + "详细结果".repeat(4_000) },
    ])

    const prompt = String(callModel.mock.calls[0]?.[0].prompt)
    expect(prompt).toContain(
      "User requests (primary title source, newest last)",
    )
    expect(prompt).toContain("User: 将产品演示页改为浅色科技风")
    expect(Array.from(prompt)).toHaveLength(6_000)
  })

  it("returns null when no title model is selected, no user input exists, or the provider fails", async () => {
    const unconfigured = new ManagedTaskTitleGenerator({
      resolveTaskTitleModel: vi.fn(async () => null),
    })
    const failed = new ManagedTaskTitleGenerator(
      { resolveTaskTitleModel: vi.fn(async () => runtime()) },
      { callModel: vi.fn(async () => Promise.reject(new Error("upstream"))) },
    )

    await expect(
      unconfigured.generate([{ role: "user", content: "request" }]),
    ).resolves.toBeNull()
    await expect(
      unconfigured.generate([{ role: "assistant", content: "answer" }]),
    ).resolves.toBeNull()
    await expect(
      failed.generate([{ role: "user", content: "request" }]),
    ).resolves.toBeNull()
  })

  it("normalizes wrappers and caps generated titles to the database limit", () => {
    expect(sanitizeTitle(" “Title: Quarterly plan!” ")).toBe("Quarterly plan")
    expect(sanitizeTitle("标题：" + "任".repeat(40))).toBe("任".repeat(40))
    expect(
      sanitizeTitle("好的，已调整那段引文的位置，确保与上方标题不再重叠"),
    ).toBe("调整那段引文的位置，确保与上方标题不再重叠")
    expect(sanitizeTitle("任".repeat(241))).toBe(`${"任".repeat(239)}…`)
    expect(sanitizeTitle("  ")).toBeNull()
  })
})

function runtime() {
  return {
    revision: 8,
    model: {
      id: "title-model",
      display_name: "Title model",
      enabled: true,
      kind: "chat" as const,
      input_price_per_million: "1",
      cached_input_price_per_million: "0.5",
      output_price_per_million: "2",
      supports_image_input: false,
      context_window: null,
      supported_reasoning_efforts: ["medium" as const],
      default_reasoning_effort: "medium" as const,
    },
    channel: {
      id: "title-channel",
      name: "Title channel",
      provider: "openai_compatible" as const,
      providerProject: null,
      providerLocation: null,
      baseUrl: "https://models.example.test/v1",
      protocolMode: "chat_completions_bridge" as const,
      apiKey: "secret",
    },
  }
}
