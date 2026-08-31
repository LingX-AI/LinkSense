import type { TFunction } from "i18next"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import type { VoiceInputFailure } from "@/features/conversations/use-voice-transcription"

const localFailureMessageKeys: Partial<
  Record<VoiceInputFailure["kind"], string>
> = {
  unsupported: "conversation.voiceUnsupported",
  permission_denied: "conversation.voicePermissionDenied",
  device_not_found: "conversation.voiceDeviceNotFound",
  device_unavailable: "conversation.voiceDeviceUnavailable",
  recording_failed: "conversation.voiceRecordingFailed",
  recording_stop_timeout: "conversation.voiceRecordingTimeout",
  recording_too_short: "conversation.voiceTooShort",
  recording_too_large: "conversation.voiceTooLarge",
  transcription_timeout: "conversation.voiceTimeout",
  transcription_no_content: "conversation.voiceNoContent",
}

export function appendVoiceTranscript(baseValue: string, transcript: string) {
  const normalizedTranscript = transcript.trim()
  if (!normalizedTranscript) return baseValue
  if (!baseValue.trim()) return normalizedTranscript
  return `${baseValue}${/\s$/u.test(baseValue) ? "" : " "}${normalizedTranscript}`
}

export function getVoiceInputFailureMessage(
  failure: VoiceInputFailure,
  t: TFunction
) {
  const localMessageKey = localFailureMessageKeys[failure.kind]
  if (localMessageKey) return t(localMessageKey)

  const fallbackMessage = t("errors.composer.voiceTranscriptionFailed")
  if (failure.kind !== "service_failed" || !(failure.cause instanceof ApiError)) {
    return fallbackMessage
  }

  if (
    failure.cause.errorCode === "VOICE_RECORDING_TOO_LARGE" ||
    failure.cause.errorCode === "VOICE_AUDIO_TOO_LARGE"
  ) {
    return t("conversation.voiceTooLarge")
  }
  if (failure.cause.errorCode === "VOICE_TRANSCRIPTION_TIMEOUT") {
    return t("conversation.voiceTimeout")
  }
  if (failure.cause.errorCode === "VOICE_TRANSCRIPTION_NO_CONTENT") {
    return t("conversation.voiceNoContent")
  }
  if (failure.cause.errorCode === "API_RESPONSE_INVALID") {
    return fallbackMessage
  }

  const message = getErrorMessage(failure.cause, t)
  return message === t("errors.unknown") ? fallbackMessage : message
}
