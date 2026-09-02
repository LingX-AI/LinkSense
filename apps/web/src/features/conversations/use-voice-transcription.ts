import { useCallback, useEffect, useRef, useState } from "react"
import {
  MAX_VOICE_AUDIO_BYTES,
  voiceTranscriptionStreamEventSchema,
  type VoiceTranscriptionRequest,
  type VoiceTranscriptionStreamEvent,
} from "@linksense/shared"

import { ApiError, apiStreamRequest } from "@/api/client"
import {
  appendVoiceWaveformHistory,
  combineVoiceWaveformLevel,
  computeVoiceFrequencyWaveform,
  computeVoiceTimeDomainRms,
  createSilentVoiceFrequencyWaveform,
  getVoiceWaveformMaxSamples,
  normalizeVoiceInputLevel,
  smoothVoiceFrequencyWaveform,
  varyVoiceWaveformLevel,
  VOICE_WAVEFORM_INTERVAL_MS,
  VOICE_WAVEFORM_MIN_SAMPLES,
  type VoiceWaveformHistorySample,
} from "@/features/conversations/voice-waveform"
import type { SupportedLanguage } from "@/i18n"

export const MIN_VOICE_RECORDING_DURATION_MS = 1_000
export const MAX_VOICE_RECORDING_DURATION_MS = 5 * 60 * 1_000
export const VOICE_TRANSCRIPTION_TIMEOUT_MS = 30_000

const RECORDER_STOP_TIMEOUT_MS = 10_000
const RECORDING_TIMER_INTERVAL_MS = 250

export type VoiceInputPhase =
  "idle" | "starting" | "recording" | "stopping" | "transcribing"

export type VoiceInputFailure =
  | { kind: "unsupported" }
  | { kind: "permission_denied" }
  | { kind: "device_not_found" }
  | { kind: "device_unavailable" }
  | { kind: "recording_failed" }
  | { kind: "recording_stop_timeout" }
  | { kind: "recording_too_short" }
  | { kind: "recording_too_large" }
  | { kind: "transcription_timeout" }
  | { kind: "transcription_no_content" }
  | { kind: "service_failed"; cause: unknown }

export type VoiceTranscriptionRequester = (
  body: VoiceTranscriptionRequest,
  signal: AbortSignal
) => Promise<Response>

type UseVoiceTranscriptionOptions = {
  language: SupportedLanguage
  onTranscriptPreview: (transcript: string) => void
  onTranscript: (transcript: string) => void
  onError: (failure: VoiceInputFailure) => void
  request?: VoiceTranscriptionRequester
}

const requestVoiceTranscription: VoiceTranscriptionRequester = (body, signal) =>
  apiStreamRequest("/voice/transcriptions", {
    method: "POST",
    body,
    signal,
  })

type AudioContextConstructor = new () => AudioContext

function isVoiceRecordingSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  )
}

function chooseRecordingMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined
  }

  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

function classifyRecordingStartError(error: unknown): VoiceInputFailure {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return { kind: "permission_denied" }
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return { kind: "device_not_found" }
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return { kind: "device_unavailable" }
    }
  }
  return { kind: "recording_failed" }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const baseMimeType = blob.type.split(";", 1)[0]?.trim() || "audio/webm"
    const normalizedBlob =
      blob.type === baseMimeType
        ? blob
        : new Blob([blob], { type: baseMimeType })
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error("VOICE_RECORDING_RESULT_INVALID"))
      }
    })
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("VOICE_RECORDING_READ_FAILED"))
    )
    reader.readAsDataURL(normalizedBlob)
  })
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null
  return (
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: AudioContextConstructor
      }
    ).webkitAudioContext ??
    null
  )
}

async function readVoiceTranscript(
  response: Response,
  signal: AbortSignal,
  onPreview: (transcript: string) => void
) {
  if (!response.body) {
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let accumulatedTranscript = ""
  let finalTranscript = ""
  let receivedDoneEvent = false

  const consumeLine = (line: string) => {
    if (!line.trim()) return
    let payload: unknown
    try {
      payload = JSON.parse(line)
    } catch {
      throw new ApiError({
        status: response.status,
        errorCode: "API_RESPONSE_INVALID",
      })
    }

    const parsed = voiceTranscriptionStreamEventSchema.safeParse(payload)
    if (!parsed.success) {
      throw new ApiError({
        status: response.status,
        errorCode: "API_RESPONSE_INVALID",
      })
    }

    const event: VoiceTranscriptionStreamEvent = parsed.data
    if (event.type === "delta") {
      accumulatedTranscript += event.text
      onPreview(accumulatedTranscript)
      return
    }
    if (event.type === "done") {
      finalTranscript = event.text
      receivedDoneEvent = true
      onPreview(finalTranscript)
      return
    }
    throw new ApiError({
      status: response.status,
      errorCode: event.error_code,
      messageKey: event.message_key,
      message: event.message,
    })
  }

  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ""
      for (const line of lines) consumeLine(line)
      if (done) break
    }
    if (buffer.trim()) consumeLine(buffer)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  if (!receivedDoneEvent) {
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }
  return finalTranscript.trim()
}

export function useVoiceTranscription({
  language,
  onTranscriptPreview,
  onTranscript,
  onError,
  request = requestVoiceTranscription,
}: UseVoiceTranscriptionOptions) {
  const [phase, setPhase] = useState<VoiceInputPhase>("idle")
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [waveform, setWaveform] = useState<
    readonly VoiceWaveformHistorySample[]
  >([])

  const mountedRef = useRef(false)
  const sessionRef = useRef(0)
  const phaseRef = useRef<VoiceInputPhase>("idle")
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const elapsedTimerRef = useRef<number | null>(null)
  const autoStopTimerRef = useRef<number | null>(null)
  const recorderStopTimerRef = useRef<number | null>(null)
  const waveformTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const inputLevelRef = useRef(0)
  const inputWaveformRef = useRef<readonly number[]>(
    createSilentVoiceFrequencyWaveform()
  )
  const inputFrameRef = useRef(0)
  const waveformMaxSamplesRef = useRef(VOICE_WAVEFORM_MIN_SAMPLES)
  const nextWaveformSampleIdRef = useRef(1)
  const transcriptionControllerRef = useRef<AbortController | null>(null)
  const stopRecordingRef = useRef<() => void>(() => undefined)
  const onTranscriptPreviewRef = useRef(onTranscriptPreview)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  const languageRef = useRef(language)
  const requestRef = useRef(request)

  useEffect(() => {
    onTranscriptPreviewRef.current = onTranscriptPreview
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
    languageRef.current = language
    requestRef.current = request
  }, [language, onError, onTranscript, onTranscriptPreview, request])

  const updatePhase = useCallback((nextPhase: VoiceInputPhase) => {
    phaseRef.current = nextPhase
    if (mountedRef.current) setPhase(nextPhase)
  }, [])

  const clearTimers = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (autoStopTimerRef.current !== null) {
      window.clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    if (recorderStopTimerRef.current !== null) {
      window.clearTimeout(recorderStopTimerRef.current)
      recorderStopTimerRef.current = null
    }
    if (waveformTimerRef.current !== null) {
      window.clearInterval(waveformTimerRef.current)
      waveformTimerRef.current = null
    }
  }, [])

  const clearAudioAnalysis = useCallback(() => {
    if (waveformTimerRef.current !== null) {
      window.clearInterval(waveformTimerRef.current)
      waveformTimerRef.current = null
    }
    audioSourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    void audioContextRef.current?.close().catch(() => undefined)
    audioSourceRef.current = null
    analyserRef.current = null
    audioContextRef.current = null
    inputLevelRef.current = 0
    inputWaveformRef.current = createSilentVoiceFrequencyWaveform()
    inputFrameRef.current = 0
    nextWaveformSampleIdRef.current = 1
    if (mountedRef.current) {
      setWaveform([])
    }
  }, [])

  const setWaveformTrackWidth = useCallback((trackWidth: number) => {
    const nextMaximum = getVoiceWaveformMaxSamples(trackWidth)
    waveformMaxSamplesRef.current = nextMaximum
    if (mountedRef.current) {
      setWaveform((currentWaveform) =>
        currentWaveform.length > nextMaximum
          ? currentWaveform.slice(-nextMaximum)
          : currentWaveform
      )
    }
  }, [])

  const releaseCapture = useCallback(
    (stopRecorder: boolean) => {
      clearTimers()
      clearAudioAnalysis()
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onerror = null
        recorder.onstop = null
        if (stopRecorder && recorder.state !== "inactive") {
          try {
            recorder.stop()
          } catch {
            // A recorder may already be stopping after a device interruption.
          }
        }
      }
      stopTracks(streamRef.current)
      streamRef.current = null
      chunksRef.current = []
    },
    [clearAudioAnalysis, clearTimers]
  )

  const reportFailure = useCallback((failure: VoiceInputFailure) => {
    if (mountedRef.current) onErrorRef.current(failure)
  }, [])

  const startAudioAnalysis = useCallback(
    (stream: MediaStream) => {
      const AudioContextClass = getAudioContextConstructor()
      if (!AudioContextClass) return
      try {
        const audioContext = new AudioContextClass()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.72
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        const timeDomainSamples = new Uint8Array(analyser.fftSize)
        const frequencySamples = new Uint8Array(analyser.frequencyBinCount)
        audioContextRef.current = audioContext
        audioSourceRef.current = source
        analyserRef.current = analyser
        void audioContext.resume().catch(() => undefined)

        waveformTimerRef.current = window.setInterval(() => {
          if (!mountedRef.current || phaseRef.current !== "recording") return
          if (audioContext.state === "suspended") return

          analyser.getByteTimeDomainData(timeDomainSamples)
          const nextInputLevel = normalizeVoiceInputLevel(
            computeVoiceTimeDomainRms(timeDomainSamples)
          )
          inputLevelRef.current =
            inputLevelRef.current * 0.45 + nextInputLevel * 0.55

          analyser.getByteFrequencyData(frequencySamples)
          inputWaveformRef.current = smoothVoiceFrequencyWaveform(
            inputWaveformRef.current,
            computeVoiceFrequencyWaveform(
              frequencySamples,
              audioContext.sampleRate
            )
          )

          inputFrameRef.current += 1
          const sample = {
            id: nextWaveformSampleIdRef.current,
            level: varyVoiceWaveformLevel(
              combineVoiceWaveformLevel(
                inputLevelRef.current,
                inputWaveformRef.current
              ),
              inputFrameRef.current
            ),
          } satisfies VoiceWaveformHistorySample
          nextWaveformSampleIdRef.current += 1
          setWaveform((currentWaveform) =>
            appendVoiceWaveformHistory(
              currentWaveform,
              [sample],
              waveformMaxSamplesRef.current
            )
          )
        }, VOICE_WAVEFORM_INTERVAL_MS)
      } catch {
        clearAudioAnalysis()
      }
    },
    [clearAudioAnalysis]
  )

  const transcribeRecording = useCallback(
    async (session: number, blob: Blob) => {
      if (sessionRef.current !== session || !mountedRef.current) return
      updatePhase("transcribing")
      let audioDataUrl: string
      try {
        audioDataUrl = await blobToDataUrl(blob)
      } catch {
        if (sessionRef.current !== session) return
        updatePhase("idle")
        reportFailure({ kind: "recording_failed" })
        return
      }

      if (sessionRef.current !== session || !mountedRef.current) return
      const controller = new AbortController()
      transcriptionControllerRef.current = controller
      let timedOut = false
      const timeout = window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, VOICE_TRANSCRIPTION_TIMEOUT_MS)

      try {
        const body = {
          audio_data_url: audioDataUrl,
          language: languageRef.current,
          stream: true,
        } satisfies VoiceTranscriptionRequest
        const response = await requestRef.current(body, controller.signal)
        const transcript = await readVoiceTranscript(
          response,
          controller.signal,
          (preview) => {
            if (sessionRef.current === session && mountedRef.current) {
              onTranscriptPreviewRef.current(preview)
            }
          }
        )
        if (sessionRef.current !== session || !mountedRef.current) return
        if (!transcript) {
          reportFailure({ kind: "transcription_no_content" })
          return
        }
        onTranscriptRef.current(transcript)
      } catch (error) {
        if (sessionRef.current !== session || !mountedRef.current) return
        if (timedOut) {
          reportFailure({ kind: "transcription_timeout" })
        } else if (
          error instanceof ApiError &&
          error.errorCode === "VOICE_TRANSCRIPTION_NO_CONTENT"
        ) {
          reportFailure({ kind: "transcription_no_content" })
        } else if (!(
          error instanceof DOMException && error.name === "AbortError"
        )) {
          reportFailure({ kind: "service_failed", cause: error })
        }
      } finally {
        window.clearTimeout(timeout)
        if (transcriptionControllerRef.current === controller) {
          transcriptionControllerRef.current = null
        }
        if (sessionRef.current === session && mountedRef.current) {
          updatePhase("idle")
        }
      }
    },
    [reportFailure, updatePhase]
  )

  const finishRecording = useCallback(
    (session: number, mimeType: string) => {
      if (sessionRef.current !== session) return
      const durationMs = Date.now() - startedAtRef.current
      const baseMimeType = mimeType.split(";", 1)[0]?.trim() || "audio/webm"
      const blob = new Blob(chunksRef.current, { type: baseMimeType })
      releaseCapture(false)
      if (durationMs < MIN_VOICE_RECORDING_DURATION_MS) {
        updatePhase("idle")
        reportFailure({ kind: "recording_too_short" })
        return
      }
      if (blob.size > MAX_VOICE_AUDIO_BYTES) {
        updatePhase("idle")
        reportFailure({ kind: "recording_too_large" })
        return
      }
      if (blob.size === 0) {
        updatePhase("idle")
        reportFailure({ kind: "recording_failed" })
        return
      }
      void transcribeRecording(session, blob)
    },
    [releaseCapture, reportFailure, transcribeRecording, updatePhase]
  )

  const stopRecording = useCallback(() => {
    if (phaseRef.current !== "recording") return
    const recorder = recorderRef.current
    const session = sessionRef.current
    if (!recorder) {
      releaseCapture(false)
      updatePhase("idle")
      reportFailure({ kind: "recording_failed" })
      return
    }
    updatePhase("stopping")
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (autoStopTimerRef.current !== null) {
      window.clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    clearAudioAnalysis()
    recorderStopTimerRef.current = window.setTimeout(() => {
      if (sessionRef.current !== session) return
      sessionRef.current += 1
      releaseCapture(true)
      updatePhase("idle")
      reportFailure({ kind: "recording_stop_timeout" })
    }, RECORDER_STOP_TIMEOUT_MS)
    try {
      recorder.stop()
    } catch {
      sessionRef.current += 1
      releaseCapture(false)
      updatePhase("idle")
      reportFailure({ kind: "recording_failed" })
    }
  }, [clearAudioAnalysis, releaseCapture, reportFailure, updatePhase])

  useEffect(() => {
    stopRecordingRef.current = stopRecording
  }, [stopRecording])

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "idle") return
    if (!isVoiceRecordingSupported()) {
      reportFailure({ kind: "unsupported" })
      return
    }

    const session = sessionRef.current + 1
    sessionRef.current = session
    updatePhase("starting")
    setElapsedSeconds(0)
    inputLevelRef.current = 0
    inputWaveformRef.current = createSilentVoiceFrequencyWaveform()
    inputFrameRef.current = 0
    nextWaveformSampleIdRef.current = 1
    setWaveform([])

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (sessionRef.current !== session || !mountedRef.current) {
        stopTracks(stream)
        return
      }
      const preferredMimeType = chooseRecordingMimeType()
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream)
      const outputMimeType =
        recorder.mimeType || preferredMimeType || "audio/webm"
      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (sessionRef.current === session && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        if (sessionRef.current !== session) return
        sessionRef.current += 1
        releaseCapture(true)
        updatePhase("idle")
        reportFailure({ kind: "recording_failed" })
      }
      recorder.onstop = () => finishRecording(session, outputMimeType)
      recorder.start(250)
      startedAtRef.current = Date.now()
      updatePhase("recording")
      startAudioAnalysis(stream)
      elapsedTimerRef.current = window.setInterval(() => {
        if (sessionRef.current !== session || !mountedRef.current) return
        setElapsedSeconds(
          Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1_000))
        )
      }, RECORDING_TIMER_INTERVAL_MS)
      autoStopTimerRef.current = window.setTimeout(
        () => stopRecordingRef.current(),
        MAX_VOICE_RECORDING_DURATION_MS
      )
    } catch (error) {
      stopTracks(stream)
      if (sessionRef.current !== session || !mountedRef.current) return
      releaseCapture(false)
      updatePhase("idle")
      reportFailure(classifyRecordingStartError(error))
    }
  }, [
    finishRecording,
    releaseCapture,
    reportFailure,
    startAudioAnalysis,
    updatePhase,
  ])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionRef.current += 1
      transcriptionControllerRef.current?.abort()
      transcriptionControllerRef.current = null
      releaseCapture(true)
      phaseRef.current = "idle"
    }
  }, [releaseCapture])

  return {
    phase,
    elapsedSeconds,
    waveform,
    setWaveformTrackWidth,
    startRecording,
    stopRecording,
  }
}
