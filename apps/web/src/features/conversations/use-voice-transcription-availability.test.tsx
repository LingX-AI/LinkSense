import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useVoiceTranscriptionAvailability } from "@/features/conversations/use-voice-transcription-availability"

describe("useVoiceTranscriptionAvailability", () => {
  it.each([
    [true, "available"],
    [false, "not_configured"],
  ] as const)("maps available=%s to %s", async (available, expected) => {
    const request = vi.fn(async () => ({ available }))
    const { result } = renderHook(() =>
      useVoiceTranscriptionAvailability({ request })
    )

    expect(result.current).toBe("checking")
    await waitFor(() => expect(result.current).toBe(expected))
    expect(request).toHaveBeenCalledOnce()
  })

  it("disables voice input when the availability request fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("network unavailable")
    })
    const { result } = renderHook(() =>
      useVoiceTranscriptionAvailability({ request })
    )

    await waitFor(() => expect(result.current).toBe("unavailable"))
  })
})
