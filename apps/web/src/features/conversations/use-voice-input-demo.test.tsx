import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isVoiceInputDemoEnabled,
  useVoiceInputDemo,
} from "./use-voice-input-demo"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  window.history.replaceState(null, "", "/")
})

describe("local voice input demo", () => {
  it("requires explicit opt-in on localhost in development", () => {
    expect(isVoiceInputDemoEnabled()).toBe(false)
    window.history.replaceState(null, "", "/?voiceDemo=1")
    expect(isVoiceInputDemoEnabled()).toBe(import.meta.env.DEV)
    vi.stubEnv("DEV", false)
    expect(isVoiceInputDemoEnabled()).toBe(false)
  })

  it("simulates recording and streams sample text without network or microphone access", () => {
    vi.useFakeTimers()
    const fetcher = vi.spyOn(globalThis, "fetch")
    const preview = vi.fn()
    const complete = vi.fn()
    const { result } = renderHook(() =>
      useVoiceInputDemo({
        transcript: "Example voice transcript",
        onTranscriptPreview: preview,
        onTranscript: complete,
      })
    )

    act(() => result.current.startRecording())
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.phase).toBe("recording")
    expect(result.current.elapsedSeconds).toBe(2)
    expect(result.current.waveform.length).toBeGreaterThan(0)
    act(() => result.current.stopRecording())
    expect(result.current.phase).toBe("transcribing")
    act(() => vi.advanceTimersByTime(400))
    expect(preview).toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1_200))
    expect(complete).toHaveBeenCalledWith("Example voice transcript")
    expect(result.current.phase).toBe("idle")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("cancels pending transcription when exiting or unmounting", () => {
    vi.useFakeTimers()
    const complete = vi.fn()
    const { result, unmount } = renderHook(() =>
      useVoiceInputDemo({
        transcript: "Example",
        onTranscriptPreview: vi.fn(),
        onTranscript: complete,
      })
    )
    act(() => result.current.startRecording())
    act(() => result.current.stopRecording())
    act(() => result.current.cancel())
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.phase).toBe("idle")
    expect(complete).not.toHaveBeenCalled()
    act(() => result.current.startRecording())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
