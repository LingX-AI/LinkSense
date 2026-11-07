import { useCallback, useEffect, useRef, useState } from "react"
import { MAX_VOICE_RECORDING_DURATION_MS } from "@linksense/shared"

import type { VoiceInputPhase } from "./use-voice-transcription"
import {
  appendVoiceWaveformHistory,
  getVoiceWaveformMaxSamples,
  VOICE_WAVEFORM_INTERVAL_MS,
  VOICE_WAVEFORM_MIN_SAMPLES,
  type VoiceWaveformHistorySample,
} from "./voice-waveform"

export function isVoiceInputDemoEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
    new URLSearchParams(window.location.search).get("voiceDemo") === "1"
  )
}

// A local interaction preview: never captures audio or calls a transcription API.
export function useVoiceInputDemo({
  transcript,
  onTranscriptPreview,
  onTranscript,
}: {
  transcript: string
  onTranscriptPreview: (value: string) => void
  onTranscript: (value: string) => void
}) {
  const [phase, setPhase] = useState<VoiceInputPhase>("idle")
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [waveform, setWaveform] = useState<VoiceWaveformHistorySample[]>([])
  const phaseRef = useRef<VoiceInputPhase>("idle")
  const timerRef = useRef<number | null>(null)
  const capacityRef = useRef(VOICE_WAVEFORM_MIN_SAMPLES)
  const callbacksRef = useRef({ transcript, onTranscriptPreview, onTranscript })

  useEffect(() => {
    callbacksRef.current = { transcript, onTranscriptPreview, onTranscript }
  }, [transcript, onTranscriptPreview, onTranscript])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    phaseRef.current = "idle"
    setPhase("idle")
    setWaveform([])
  }, [clearTimer])

  const stopRecording = useCallback(() => {
    if (phaseRef.current !== "recording") return
    clearTimer()
    phaseRef.current = "transcribing"
    setPhase("transcribing")
    const text = callbacksRef.current.transcript
    let step = 0
    timerRef.current = window.setInterval(() => {
      step += 1
      if (step < 4) {
        callbacksRef.current.onTranscriptPreview(
          text.slice(0, Math.ceil((text.length * step) / 4))
        )
      } else {
        clearTimer()
        callbacksRef.current.onTranscript(text)
        phaseRef.current = "idle"
        setPhase("idle")
        setWaveform([])
      }
    }, 400)
  }, [clearTimer])

  const startRecording = useCallback(() => {
    if (phaseRef.current !== "idle") return
    phaseRef.current = "recording"
    setPhase("recording")
    setElapsedSeconds(0)
    setWaveform([])
    const startedAt = Date.now()
    let frame = 0
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      setElapsedSeconds(Math.floor(elapsed / 1_000))
      frame += 1
      const sample = {
        id: frame,
        level:
          0.12 +
          Math.abs(Math.sin(frame * 0.37) * Math.cos(frame * 0.13)) * 0.8,
      }
      setWaveform((current) =>
        appendVoiceWaveformHistory(current, [sample], capacityRef.current)
      )
      if (elapsed >= MAX_VOICE_RECORDING_DURATION_MS) stopRecording()
    }, VOICE_WAVEFORM_INTERVAL_MS)
  }, [stopRecording])

  const setWaveformTrackWidth = useCallback((width: number) => {
    capacityRef.current = getVoiceWaveformMaxSamples(width)
    setWaveform((current) => current.slice(-capacityRef.current))
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  return {
    phase,
    elapsedSeconds,
    waveform,
    setWaveformTrackWidth,
    startRecording,
    stopRecording,
    cancel,
  }
}
