import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MAX_VOICE_RECORDING_DURATION_MS, voiceAudioDataUrlSchema } from "@linksense/shared"
import pLimit from "p-limit"

import type { VoiceTranscriptionInput } from "../modules/voice/service.js"

export const VOICE_AUDIO_CONVERSION_TIMEOUT_MS = 10_000
export const VOICE_AUDIO_SAMPLE_RATE = 16_000
export const MAX_NORMALIZED_VOICE_AUDIO_BYTES =
  VOICE_AUDIO_SAMPLE_RATE * 2 * (MAX_VOICE_RECORDING_DURATION_MS / 1_000) + 44

const MAX_AUDIO_CONVERSIONS_PER_PROCESS = 2
const inputFormats = {
  "audio/webm": "matroska",
  "audio/mp4": "mov",
  "audio/x-m4a": "mov",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
} as const

export type VoiceAudioNormalizationFailure =
  | "invalid_audio"
  | "too_long"
  | "busy"
  | "unavailable"
  | "failed"
  | "timeout"
  | "aborted"

export class VoiceAudioNormalizationError extends Error {
  constructor(readonly reason: VoiceAudioNormalizationFailure) {
    super(`voice_audio_normalization_${reason}`)
    this.name = "VoiceAudioNormalizationError"
  }
}

export type VoiceAudioNormalizer = (
  input: VoiceTranscriptionInput,
) => Promise<Uint8Array>

type AudioProcessRunner = (
  args: readonly string[],
  signal: AbortSignal,
) => Promise<void>

export function createVoiceAudioNormalizer(
  options: {
    runProcess?: AudioProcessRunner
    temporaryRoot?: string
  } = {},
): VoiceAudioNormalizer {
  const runProcess = options.runProcess ?? runFFmpeg
  // This caps this API process's subprocesses, independently of the Redis
  // admission checks shared by API workers. There is no unbounded work queue.
  const limit = pLimit(MAX_AUDIO_CONVERSIONS_PER_PROCESS)

  return async (input) => {
    if (input.signal?.aborted) throw new VoiceAudioNormalizationError("aborted")
    if (limit.activeCount + limit.pendingCount >= MAX_AUDIO_CONVERSIONS_PER_PROCESS) {
      throw new VoiceAudioNormalizationError("busy")
    }
    const parsed = voiceAudioDataUrlSchema.safeParse(input.audioDataUrl)
    if (!parsed.success) throw new VoiceAudioNormalizationError("invalid_audio")
    const separator = parsed.data.indexOf(",")
    const mimeType = parsed.data.slice(5).split(";", 1)[0]?.toLowerCase()
    const format = Object.entries(inputFormats).find(([mime]) => mime === mimeType)?.[1]
    if (!format) throw new VoiceAudioNormalizationError("invalid_audio")

    return limit(async () => {
      const timeoutController = new AbortController()
      const timeout = setTimeout(() => timeoutController.abort(), VOICE_AUDIO_CONVERSION_TIMEOUT_MS)
      timeout.unref()
      const signal = input.signal
        ? AbortSignal.any([input.signal, timeoutController.signal])
        : timeoutController.signal
      let directory: string | undefined
      try {
        signal.throwIfAborted()
        directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "linksense-voice-"))
        const source = join(directory, "input")
        const destination = join(directory, "audio.wav")
        await writeFile(source, Buffer.from(parsed.data.slice(separator + 1), "base64"), { mode: 0o600 })
        signal.throwIfAborted()
        await runProcess([
          "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
          // Force a known audio demuxer and prohibit network protocols. Uploaded
          // bytes must never be interpreted as a playlist or a remote URL.
          "-protocol_whitelist", "file", "-f", format, "-threads", "1", "-i", source,
          "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
          "-filter_threads", "1", "-threads", "1", "-ac", "1",
          "-ar", String(VOICE_AUDIO_SAMPLE_RATE), "-c:a", "pcm_s16le", "-bitexact",
          // Decode one extra second so overlong input is rejected, never silently
          // accepted as a truncated five-minute recording. Bound disk output too.
          "-t", String(MAX_VOICE_RECORDING_DURATION_MS / 1_000 + 1), "-fs", String(MAX_NORMALIZED_VOICE_AUDIO_BYTES + VOICE_AUDIO_SAMPLE_RATE * 2),
          "-f", "wav", destination,
        ], signal)
        signal.throwIfAborted()
        const metadata = await stat(destination)
        if (metadata.size > MAX_NORMALIZED_VOICE_AUDIO_BYTES) {
          throw new VoiceAudioNormalizationError("too_long")
        }
        const audio = await readFile(destination)
        // Bitexact PCM WAV has a 44-byte header and a seekable output file, so
        // its data length is final and can be read by gateways for billing.
        if (audio.length <= 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
          throw new VoiceAudioNormalizationError("invalid_audio")
        }
        return audio
      } catch (error) {
        if (input.signal?.aborted) throw new VoiceAudioNormalizationError("aborted")
        if (timeoutController.signal.aborted) throw new VoiceAudioNormalizationError("timeout")
        if (error instanceof VoiceAudioNormalizationError) throw error
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          throw new VoiceAudioNormalizationError("unavailable")
        }
        // FFmpeg stderr can contain input metadata and local paths; do not
        // propagate it to logs or API responses.
        throw new VoiceAudioNormalizationError("failed")
      } finally {
        clearTimeout(timeout)
        if (directory) await rm(directory, { recursive: true, force: true })
      }
    })
  }
}

function runFFmpeg(args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", [...args], {
      signal,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024,
      windowsHide: true,
    }, (error) => error ? reject(error) : resolve())
  })
}

export const normalizeVoiceAudio = createVoiceAudioNormalizer()
