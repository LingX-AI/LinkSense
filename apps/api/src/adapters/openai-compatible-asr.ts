import { z } from "zod"

const transcriptionResponseSchema = z.object({ text: z.string() })
const MAX_TRANSCRIPTION_RESPONSE_BYTES = 256 * 1024

export async function transcribeOpenAICompatibleAudio(
  options: {
    baseUrl: string
    apiKey: string
    model: string
    audio: Uint8Array
    language?: string
    signal: AbortSignal
  },
  fetchImpl: typeof fetch,
): Promise<string> {
  const form = new FormData()
  form.set("model", options.model)
  form.set("file", new Blob([Buffer.from(options.audio)], { type: "audio/wav" }), "audio.wav")
  form.set("response_format", "json")
  if (options.language) form.set("language", options.language)

  const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/u, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" },
    body: form,
    signal: options.signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error("openai_compatible_transcription_failed")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("openai_compatible_transcription_invalid_response")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      options.signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_TRANSCRIPTION_RESPONSE_BYTES) {
        throw new Error("openai_compatible_transcription_response_too_large")
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  return transcriptionResponseSchema.parse(body).text.trim()
}
