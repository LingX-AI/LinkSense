import { randomUUID } from "node:crypto"

import type { ModelTokenPricing } from "@linksense/shared"
import { generateText } from "ai"

import { truncateConversationTitle } from "../lib/conversation-title.js"
import { cl100kTokenEstimator } from "../modules/knowledge-processing/token-estimator.js"
import type {
  ResolvedManagedModelRuntime,
  TaskTitleModelSettingsReader,
} from "../modules/system/model-provider-settings.js"
import { createProviderLanguageModel } from "./provider-language-model.js"

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_SOURCE_CHARACTERS = 6_000
const MAX_SOURCE_MESSAGES = 12
const TRAILING_TITLE_PUNCTUATION_PATTERN = /[。！？.!?；;：:，,]+$/gu
const ACKNOWLEDGEMENT_PREFIX_PATTERN =
  /^(?:好的|收到|明白|当然|没问题|可以|行|了解|已收到)(?:[，,：:！!\s]+|$)/u
const COMPLETED_ACTION_PREFIX_PATTERN =
  /^已(?:经)?(完成|调整|修改|修复|处理|更新|优化|解决|生成|创建|整理|替换|移动|删除|添加)/u

const TITLE_PROMPT = [
  "你是 LinkSense 的任务标题生成器。标题用于狭窄的侧边栏，必须短、清楚，并且能够单行快速识别。",
  "标题必须使用用户请求的主要语言；请求混合多种语言时，使用表达任务意图的语言。只以用户消息作为标题内容来源；助手回复只能帮助理解上下文，不能提供标题内容。",
  [
    "压缩规则：",
    "- 只保留一个核心动作和一个核心对象，不要堆叠“分析、整理、生成、输出”等多个动作。对象本身已能表达任务时，可以直接使用名词短语。",
    "- 纯中文标题优先 6-12 个汉字，最多 16 个汉字；纯英文标题优先 3-6 个单词，最多 36 个字符；中英混合标题保持相近的视觉长度。",
    "- 删除“请、帮我、给我、我希望、需要”等请求套话，以及次要的过程、修饰和交付描述。",
    "- 不照抄网址或协议；网址只保留有辨识价值的网站、产品或组织名称。",
    "- 仅当文件类型决定任务性质时保留一个格式词，例如 PPT、报告、简历或代码。",
  ].join("\n"),
  "示例：\n“https://www.infocare.org.cn/ 整理这家公司的产品线为 Word 文档给我” → “整理 InfoCare 产品线”\n“生成简约风格的测试工程师简历并输出为 PDF” → “制作测试工程师简历”\n“帮我分析最近一周 GitHub 热门项目的星标趋势并生成图表” → “分析 GitHub 热门项目”",
  "只输出标题，不要解释、引号或结尾标点。",
].join("\n\n")

export type TaskTitleMessage = {
  role: "user" | "assistant"
  content: string
}

export type TaskTitleProviderUsage = {
  totalTokens?: number | undefined
  inputTokens?: number | undefined
  cachedInputTokens?: number | undefined
  outputTokens?: number | undefined
  reasoningOutputTokens?: number | undefined
}

export type TaskTitleProviderResult = {
  text: string
  usage?: TaskTitleProviderUsage
}

export type TaskTitleGenerationResult = {
  requestId: string
  title: string | null
  model: string
  pricing: ModelTokenPricing
  usage: {
    totalTokens: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    measurementMethod: "provider" | "estimated"
  }
}

export type TaskTitleModelCall = (input: {
  runtime: ResolvedManagedModelRuntime
  system: string
  prompt: string
  timeoutMs?: number
}) => Promise<TaskTitleProviderResult>

export class ManagedTaskTitleGenerator {
  readonly #timeoutMs: number
  readonly #callModel: TaskTitleModelCall

  constructor(
    private readonly settings: TaskTitleModelSettingsReader,
    options: {
      timeoutMs?: number
      callModel?: TaskTitleModelCall
    } = {},
  ) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#callModel = options.callModel ?? callTaskTitleModel
  }

  async generate(
    messages: TaskTitleMessage[],
  ): Promise<TaskTitleGenerationResult | null> {
    const source = buildTitleSource(messages)
    if (!source) return null

    try {
      const runtime = await this.settings.resolveTaskTitleModel()
      if (!runtime?.channel.apiKey || runtime.model.kind !== "chat") return null
      const result = await this.#callModel({
        runtime,
        system: TITLE_PROMPT,
        prompt: source,
        timeoutMs: this.#timeoutMs,
      })
      return {
        requestId: randomUUID(),
        title: sanitizeTitle(result.text),
        model: runtime.model.id,
        pricing: {
          input_price_per_million: runtime.model.input_price_per_million,
          cached_input_price_per_million:
            runtime.model.cached_input_price_per_million,
          output_price_per_million: runtime.model.output_price_per_million,
        },
        usage: normalizeTitleUsage(result, source),
      }
    } catch {
      return null
    }
  }
}

async function callTaskTitleModel(input: {
  runtime: ResolvedManagedModelRuntime
  system: string
  prompt: string
  timeoutMs?: number
}): Promise<TaskTitleProviderResult> {
  if (!input.runtime.channel.apiKey) {
    throw new Error("task title model credential is unavailable")
  }
  const result = await generateText({
    model: createProviderLanguageModel({
      provider: input.runtime.channel.provider,
      model: input.runtime.model.id,
      apiKey: input.runtime.channel.apiKey,
      baseUrl: input.runtime.channel.baseUrl,
      project: input.runtime.channel.providerProject,
      location: input.runtime.channel.providerLocation,
      protocolMode: input.runtime.channel.protocolMode,
    }),
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: 128,
    maxRetries: 0,
    timeout: { totalMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS },
  })
  return {
    text: result.text,
    usage: {
      totalTokens: result.usage.totalTokens,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
      outputTokens: result.usage.outputTokens,
      reasoningOutputTokens: result.usage.outputTokenDetails.reasoningTokens,
    },
  }
}

function normalizeTitleUsage(
  result: TaskTitleProviderResult,
  source: string,
): TaskTitleGenerationResult["usage"] {
  const providerInput = validTokenCount(result.usage?.inputTokens)
  const providerOutput = validTokenCount(result.usage?.outputTokens)
  if (providerInput !== null && providerOutput !== null) {
    const cached = Math.min(
      providerInput,
      validTokenCount(result.usage?.cachedInputTokens) ?? 0,
    )
    const reasoning = Math.min(
      providerOutput,
      validTokenCount(result.usage?.reasoningOutputTokens) ?? 0,
    )
    return {
      totalTokens:
        validTokenCount(result.usage?.totalTokens) ??
        providerInput + providerOutput,
      inputTokens: providerInput,
      cachedInputTokens: cached,
      outputTokens: providerOutput,
      reasoningOutputTokens: reasoning,
      measurementMethod: "provider",
    }
  }
  const inputTokens = cl100kTokenEstimator.count(`${TITLE_PROMPT}\n\n${source}`)
  const outputTokens = cl100kTokenEstimator.count(result.text)
  return {
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
    measurementMethod: "estimated",
  }
}

function validTokenCount(value: number | undefined): number | null {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : null
}

function buildTitleSource(messages: TaskTitleMessage[]): string {
  const recentMessages = messages
    .filter((message) => message.content.trim())
    .slice(-MAX_SOURCE_MESSAGES)
  const userLines = recentMessages
    .filter((message) => message.role === "user")
    .map((message) => `User: ${compactSourceContent(message.content)}`)
  if (!userLines.length) return ""

  const assistantLines = recentMessages
    .filter((message) => message.role === "assistant")
    .map((message) => `Assistant: ${compactSourceContent(message.content)}`)
  const userSectionTitle = "User requests (primary title source, newest last)"
  const assistantSectionTitle = "Assistant replies (reference only)"
  const userSection = buildSourceSection(
    userSectionTitle,
    userLines,
    MAX_SOURCE_CHARACTERS,
  )
  if (!userSection) return ""

  const assistantBudget =
    MAX_SOURCE_CHARACTERS - countCharacters(userSection) - 2
  const assistantSection =
    assistantBudget > countCharacters(assistantSectionTitle) + 1
      ? buildSourceSection(
          assistantSectionTitle,
          assistantLines,
          assistantBudget,
        )
      : ""
  return [userSection, assistantSection].filter(Boolean).join("\n\n")
}

function buildSourceSection(
  title: string,
  lines: string[],
  characterBudget: number,
): string {
  const prefix = `${title}:\n`
  const contentBudget = characterBudget - countCharacters(prefix)
  if (contentBudget <= 0) return ""
  const content = takeNewestLinesWithinBudget(lines, contentBudget)
  return content ? `${prefix}${content}` : ""
}

function takeNewestLinesWithinBudget(
  lines: string[],
  characterBudget: number,
): string {
  const selected: string[] = []
  let remaining = characterBudget
  for (const line of [...lines].reverse()) {
    const separatorLength = selected.length > 0 ? 1 : 0
    const lineLength = countCharacters(line)
    if (lineLength + separatorLength <= remaining) {
      selected.unshift(line)
      remaining -= lineLength + separatorLength
      continue
    }
    if (!selected.length && remaining > 0) {
      selected.unshift(truncateCharacters(line, remaining))
    }
    break
  }
  return selected.join("\n")
}

function compactSourceContent(content: string): string {
  return content.replace(/\s+/gu, " ").trim()
}

function countCharacters(value: string): number {
  return Array.from(value).length
}

function truncateCharacters(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("")
}

export function sanitizeTitle(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/gu, "")
    .replace(/^\s*(?:标题|title)\s*[:：]\s*/iu, "")
    .replace(ACKNOWLEDGEMENT_PREFIX_PATTERN, "")
    .replace(COMPLETED_ACTION_PREFIX_PATTERN, "$1")
    .replace(TRAILING_TITLE_PUNCTUATION_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim()
  if (!normalized) return null
  return truncateConversationTitle(normalized)
}
