import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { VOICE_AUDIO_MIME_TYPES } from "@linksense/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createVoiceAudioNormalizer,
  MAX_NORMALIZED_VOICE_AUDIO_BYTES,
  VOICE_AUDIO_CONVERSION_TIMEOUT_MS,
} from "../src/adapters/voice-audio-normalizer.js"

const input = { audioDataUrl: "data:audio/webm;codecs=opus;base64,AQIDBA==" }
const wave = Buffer.alloc(76)
wave.write("RIFF", 0)
wave.write("WAVE", 8)

describe("voice audio normalization", () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "linksense-voice-test-"))
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(root, { recursive: true, force: true })
  })

  it.each(VOICE_AUDIO_MIME_TYPES)("normalizes %s to WAV and deletes the private temporary directory", async (mimeType) => {
    const runProcess = vi.fn(async (args: readonly string[], signal: AbortSignal) => {
      const source = args[args.indexOf("-i") + 1]!
      expect(await readFile(source)).toEqual(Buffer.from([1, 2, 3, 4]))
      expect(signal.aborted).toBe(false)
      await writeFile(args.at(-1)!, wave)
    })
    const normalize = createVoiceAudioNormalizer({ runProcess, temporaryRoot: root })
    await expect(normalize({ audioDataUrl: `data:${mimeType};base64,AQIDBA==` })).resolves.toEqual(wave)
    const args = runProcess.mock.calls[0]![0]
    expect(args).toEqual(expect.arrayContaining(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-bitexact"]))
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file")
    expect(await readdir(root)).toEqual([])
  })

  it.each(["data:text/plain;base64,AQIDBA==", "data:audio/webm;base64,???", "data:audio/webm;base64,AQ==\n", "https://example.test/audio.webm"])("rejects invalid input without launching FFmpeg: %s", async (audioDataUrl) => {
    const runProcess = vi.fn()
    const normalize = createVoiceAudioNormalizer({ runProcess, temporaryRoot: root })
    await expect(normalize({ audioDataUrl })).rejects.toMatchObject({ reason: "invalid_audio" })
    expect(runProcess).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it("rejects overlong output rather than forwarding a truncated recording", async () => {
    const normalize = createVoiceAudioNormalizer({ temporaryRoot: root, runProcess: async (args) => {
      await writeFile(args.at(-1)!, Buffer.alloc(MAX_NORMALIZED_VOICE_AUDIO_BYTES + 1))
    } })
    await expect(normalize(input)).rejects.toMatchObject({ reason: "too_long" })
    expect(await readdir(root)).toEqual([])
  })

  it.each([
    ["audio/mp4", 300_000, 1024, true],
    ["audio/x-m4a", 300_000, 1024, true],
    ["audio/mp4", 300_001, 1024, false],
    ["audio/mp4", 300_000, 2050, false],
  ] as const)("admits only AAC frame padding for %s, duration=%i, padding=%i", async (mime, durationMs, paddingBytes, accepted) => {
    const padded = Buffer.alloc(MAX_NORMALIZED_VOICE_AUDIO_BYTES + paddingBytes)
    padded.write("RIFF", 0)
    padded.write("WAVE", 8)
    padded.write("data", 36)
    const probeAacTiming = vi.fn(async () => ({ durationMs, frameDurationMs: 64 }))
    const normalize = createVoiceAudioNormalizer({
      temporaryRoot: root,
      runProcess: async (args) => { await writeFile(args.at(-1)!, padded) },
      probeAacTiming,
    })
    const result = normalize({ audioDataUrl: `data:${mime};base64,AQIDBA==` })
    if (accepted) {
      const audio = Buffer.from(await result)
      expect(audio.length).toBe(MAX_NORMALIZED_VOICE_AUDIO_BYTES)
      expect(audio.readUInt32LE(4)).toBe(audio.length - 8)
      expect(audio.readUInt32LE(40)).toBe(audio.length - 44)
    } else {
      await expect(result).rejects.toMatchObject({ reason: "too_long" })
    }
    expect(probeAacTiming).toHaveBeenCalledOnce()
    expect(await readdir(root)).toEqual([])
  })

  it("honors cancellation while checking AAC boundary metadata", async () => {
    const controller = new AbortController()
    const normalize = createVoiceAudioNormalizer({
      temporaryRoot: root,
      runProcess: async (args) => { await writeFile(args.at(-1)!, Buffer.alloc(MAX_NORMALIZED_VOICE_AUDIO_BYTES + 1024)) },
      probeAacTiming: async () => {
        controller.abort()
        return { durationMs: 300_000, frameDurationMs: 64 }
      },
    })
    await expect(normalize({ audioDataUrl: "data:audio/mp4;base64,AQIDBA==", signal: controller.signal }))
      .rejects.toMatchObject({ reason: "aborted" })
    expect(await readdir(root)).toEqual([])
  })

  it("rejects empty or invalid converter output and cleans up", async () => {
    const normalize = createVoiceAudioNormalizer({ temporaryRoot: root, runProcess: async (args) => {
      await writeFile(args.at(-1)!, "invalid output")
    } })
    await expect(normalize(input)).rejects.toMatchObject({ reason: "invalid_audio" })
    expect(await readdir(root)).toEqual([])
  })

  it("redacts converter failures and deletes partial output", async () => {
    const normalize = createVoiceAudioNormalizer({ temporaryRoot: root, runProcess: async (args) => {
      await writeFile(join(dirname(args.at(-1)!), "partial.wav"), "partial")
      throw new Error("private audio metadata and secret /internal/path")
    } })
    await expect(normalize(input)).rejects.toMatchObject({ message: "voice_audio_normalization_failed", reason: "failed" })
    expect(await readdir(root)).toEqual([])
  })

  it("reports a missing FFmpeg executable without leaking its path", async () => {
    const normalize = createVoiceAudioNormalizer({ temporaryRoot: root, runProcess: async () => {
      throw Object.assign(new Error("spawn /private/ffmpeg ENOENT"), { code: "ENOENT" })
    } })
    await expect(normalize(input)).rejects.toMatchObject({ reason: "unavailable", message: "voice_audio_normalization_unavailable" })
    expect(await readdir(root)).toEqual([])
  })

  it("does not launch a conversion for an already cancelled request", async () => {
    const runProcess = vi.fn()
    const normalize = createVoiceAudioNormalizer({ runProcess, temporaryRoot: root })
    await expect(normalize({ ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ reason: "aborted" })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it.each(["caller", "timeout"] as const)("cancels an active conversion on %s and cleans up", async (cause) => {
    vi.useFakeTimers()
    const entered = deferred()
    const controller = new AbortController()
    const normalize = createVoiceAudioNormalizer({ temporaryRoot: root, runProcess: async (_args, signal) => {
      entered.resolve()
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("killed")), { once: true })
      })
    } })
    const assertion = expect(normalize({ ...input, signal: controller.signal })).rejects.toMatchObject({ reason: cause === "caller" ? "aborted" : "timeout" })
    await entered.promise
    if (cause === "caller") controller.abort()
    else await vi.advanceTimersByTimeAsync(VOICE_AUDIO_CONVERSION_TIMEOUT_MS)
    await assertion
    expect(await readdir(root)).toEqual([])
  })

  it("bounds concurrent FFmpeg processes and rejects excess work without queueing", async () => {
    const ready = deferred()
    const release = deferred()
    let entered = 0
    const normalize = createVoiceAudioNormalizer({ temporaryRoot: root, runProcess: async (args) => {
      if (++entered === 2) ready.resolve()
      await release.promise
      await writeFile(args.at(-1)!, wave)
    } })
    const first = normalize(input)
    const second = normalize(input)
    await ready.promise
    await expect(normalize(input)).rejects.toMatchObject({ reason: "busy" })
    release.resolve()
    await Promise.all([first, second])
    await expect(normalize(input)).resolves.toEqual(wave)
    expect(await readdir(root)).toEqual([])
  })
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
