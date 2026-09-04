import { useEffect, useState } from "react"
import {
  voiceTranscriptionAvailabilitySchema,
  type VoiceTranscriptionAvailability,
} from "@linksense/shared"

import { apiRequest } from "@/api/client"

export type VoiceTranscriptionAvailabilityState =
  "checking" | "available" | "not_configured" | "unavailable"

export type VoiceTranscriptionAvailabilityRequester = (
  signal: AbortSignal
) => Promise<VoiceTranscriptionAvailability>

const requestVoiceTranscriptionAvailability: VoiceTranscriptionAvailabilityRequester =
  (signal) =>
    apiRequest("/voice/transcriptions/status", {
      schema: voiceTranscriptionAvailabilitySchema,
      signal,
    })

export function useVoiceTranscriptionAvailability({
  enabled = true,
  request = requestVoiceTranscriptionAvailability,
}: {
  enabled?: boolean
  request?: VoiceTranscriptionAvailabilityRequester
} = {}): VoiceTranscriptionAvailabilityState {
  const [state, setState] =
    useState<VoiceTranscriptionAvailabilityState>("checking")

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    void request(controller.signal).then(
      ({ available }) => setState(available ? "available" : "not_configured"),
      () => {
        if (!controller.signal.aborted) setState("unavailable")
      }
    )
    return () => controller.abort()
  }, [enabled, request])

  return enabled ? state : "checking"
}
