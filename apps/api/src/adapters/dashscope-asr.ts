import { z } from "zod"

import type { Locale } from "@linksense/shared"

const CHAT_COMPLETIONS_PATH = "/chat/completions"
export const DASHSCOPE_ASR_TIMEOUT_MS = 30_000

const dashScopeContentSchema = z.union([
  z.string(),
  z.array(z.object({ text: z.string().optional() })),
])

const dashScopeStreamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: dashScopeContentSchema.optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  message: z.string().optional(),
})

export type DashScopeAsrFailureReason =
  | "not_configured"
  | "timeout"
  | "aborted"
  | "upstream"
  | "invalid_response"
  | "no_content"

export class DashScopeAsrError extends Error {
  constructor(readonly reason: DashScopeAsrFailureReason) {
    super(`dashscope_asr_${reason}`)
    this.name = "DashScopeAsrError"
  }
}

export type DashScopeAsrInput = {
  audioDataUrl: string
  language?: Locale
  signal?: AbortSignal
}

export type DashScopeAsrClientOptions = {
  apiKey?: string
  baseUrl: string
  model: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class DashScopeAsrClient {
  readonly #apiKey: string
  readonly #url: string
  readonly #model: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: DashScopeAsrClientOptions) {
    this.#apiKey = options.apiKey?.trim() ?? ""
    this.#url = resolveChatCompletionsUrl(options.baseUrl)
    this.#model = options.model.trim()
    this.#timeoutMs = options.timeoutMs ?? DASHSCOPE_ASR_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? fetch
  }

  async *streamTranscription(input: DashScopeAsrInput): AsyncGenerator<string> {
    if (!this.#apiKey) throw new DashScopeAsrError("not_configured")

    const requestController = new AbortController()
    let timedOut = false
    const abortFromCaller = () => requestController.abort()
    if (input.signal?.aborted) abortFromCaller()
    else
      input.signal?.addEventListener("abort", abortFromCaller, { once: true })

    const timeout = setTimeout(() => {
      timedOut = true
      requestController.abort()
    }, this.#timeoutMs)
    timeout.unref()

    try {
      const response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: requestController.signal,
        body: JSON.stringify({
          model: this.#model,
          stream: true,
          asr_options: {
            enable_itn: true,
            ...(input.language
              ? { language: input.language === "zh-CN" ? "zh" : "en" }
              : {}),
          },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: input.audioDataUrl },
                },
              ],
            },
          ],
        }),
      })

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new DashScopeAsrError("upstream")
      }

      const reader = response.body?.getReader()
      if (!reader) throw new DashScopeAsrError("invalid_response")

      let emittedContent = false
      try {
        for await (const text of readDashScopeEvents(reader)) {
          emittedContent = true
          yield text
        }
      } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }

      if (!emittedContent) throw new DashScopeAsrError("no_content")
    } catch (error) {
      if (error instanceof DashScopeAsrError) throw error
      if (timedOut) throw new DashScopeAsrError("timeout")
      if (input.signal?.aborted) throw new DashScopeAsrError("aborted")
      throw new DashScopeAsrError("upstream")
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", abortFromCaller)
    }
  }
}

async function* readDashScopeEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/u)
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const event = parseDashScopeEvent(line)
      if (event.done) return
      if (event.text) yield event.text
    }
  }

  buffer += decoder.decode()
  for (const line of buffer.split(/\r?\n/u)) {
    const event = parseDashScopeEvent(line)
    if (event.done) return
    if (event.text) yield event.text
  }
}

function parseDashScopeEvent(line: string): { done: boolean; text: string } {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(":")) return { done: false, text: "" }
  if (!trimmed.startsWith("data:")) return { done: false, text: "" }

  const data = trimmed.slice("data:".length).trim()
  if (!data) return { done: false, text: "" }
  if (data === "[DONE]") return { done: true, text: "" }

  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    throw new DashScopeAsrError("invalid_response")
  }

  const parsed = dashScopeStreamChunkSchema.safeParse(json)
  if (!parsed.success) throw new DashScopeAsrError("invalid_response")
  if (parsed.data.error || parsed.data.message) {
    throw new DashScopeAsrError("upstream")
  }

  return {
    done: false,
    text: extractContentText(parsed.data.choices?.[0]?.delta?.content),
  }
}

function extractContentText(
  content: z.infer<typeof dashScopeContentSchema> | undefined,
) {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.map((block) => block.text ?? "").join("")
}

function resolveChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/u, "")
  return normalized.endsWith(CHAT_COMPLETIONS_PATH)
    ? normalized
    : `${normalized}${CHAT_COMPLETIONS_PATH}`
}
