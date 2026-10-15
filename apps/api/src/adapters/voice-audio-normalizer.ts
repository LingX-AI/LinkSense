import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { MAX_VOICE_RECORDING_DURATION_MS, voiceAudioDataUrlSchema } from "@linksense/shared"
import pLimit from "p-limit"
import { z } from "zod"

import type { VoiceTranscriptionInput } from "../modules/voice/service.js"

export const VOICE_AUDIO_CONVERSION_TIMEOUT_MS = 10_000
export const VOICE_AUDIO_SAMPLE_RATE = 16_000
export const MAX_NORMALIZED_VOICE_AUDIO_BYTES =
  VOICE_AUDIO_SAMPLE_RATE * 2 * (MAX_VOICE_RECORDING_DURATION_MS / 1_000) + 44

const MAX_AUDIO_CONVERSIONS_PER_PROCESS = 2
const executeFile = promisify(execFile)
const aacTimingSchema = z.object({
  streams: z.tuple([z.object({ codec_name: z.literal("aac"), duration: z.coerce.number().positive() })]),
  packets: z.array(z.object({ duration_time: z.coerce.number().positive().max(1) })).min(1).max(2),
})
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

type AacTiming = { durationMs: number; frameDurationMs: number }

export function createVoiceAudioNormalizer(
  options: {
    runProcess?: AudioProcessRunner
    probeAacTiming?: (source: string, signal: AbortSignal) => Promise<AacTiming | null>
    temporaryRoot?: string
  } = {},
): VoiceAudioNormalizer {
  const runProcess = options.runProcess ?? runFFmpeg
  const readAacTiming = options.probeAacTiming ?? probeAacTiming
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
        let trimFramePadding = false
        if (metadata.size > MAX_NORMALIZED_VOICE_AUDIO_BYTES) {
          // MP4 AAC frames can extend past the declared end. Verify padding, never relax the duration limit.
          const timing = format === "mov" ? await readAacTiming(source, signal) : null
          signal.throwIfAborted()
          const paddingBytes = timing ? Math.ceil(timing.frameDurationMs * VOICE_AUDIO_SAMPLE_RATE / 1_000) * 2 : 0
          if (!timing || timing.durationMs > MAX_VOICE_RECORDING_DURATION_MS || metadata.size > MAX_NORMALIZED_VOICE_AUDIO_BYTES + paddingBytes) {
            throw new VoiceAudioNormalizationError("too_long")
          }
          trimFramePadding = true
        }
        let audio = await readFile(destination)
        // Bitexact PCM WAV has a 44-byte header and a seekable output file, so
        // its data length is final and can be read by gateways for billing.
        if (audio.length <= 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
          throw new VoiceAudioNormalizationError("invalid_audio")
        }
        if (trimFramePadding) {
          if (audio.toString("ascii", 36, 40) !== "data") throw new VoiceAudioNormalizationError("invalid_audio")
          audio = audio.subarray(0, MAX_NORMALIZED_VOICE_AUDIO_BYTES)
          audio.writeUInt32LE(audio.length - 8, 4)
          audio.writeUInt32LE(audio.length - 44, 40)
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

async function probeAacTiming(source: string, signal: AbortSignal): Promise<AacTiming | null> {
  const { stdout } = await executeFile("ffprobe", [
    "-v", "error", "-protocol_whitelist", "file", "-f", "mov",
    "-select_streams", "a:0", "-read_intervals", "%+#2", "-show_packets", "-show_streams",
    "-show_entries", "stream=codec_name,duration:packet=duration_time", "-of", "json", source,
  ], { signal, killSignal: "SIGKILL", maxBuffer: 16 * 1024, windowsHide: true })
  let body: unknown
  try { body = JSON.parse(stdout) } catch { return null }
  const parsed = aacTimingSchema.safeParse(body)
  if (!parsed.success) return null
  return {
    durationMs: parsed.data.streams[0].duration * 1_000,
    frameDurationMs: Math.max(...parsed.data.packets.map((packet) => packet.duration_time)) * 1_000,
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
