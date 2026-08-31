import { z } from "zod";

import { localeSchema } from "./common.js";
import { apiSuccessEnvelopeSchema } from "./errors.js";

export const MAX_VOICE_AUDIO_DATA_URL_BYTES = 10 * 1024 * 1024;
const VOICE_AUDIO_DATA_URL_HEADER_BUDGET_BYTES = 256;
export const MAX_VOICE_AUDIO_BYTES =
  Math.floor(
    (MAX_VOICE_AUDIO_DATA_URL_BYTES -
      VOICE_AUDIO_DATA_URL_HEADER_BUDGET_BYTES) /
      4,
  ) * 3;
export const VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES =
  MAX_VOICE_AUDIO_DATA_URL_BYTES + 4 * 1024;

export const VOICE_AUDIO_MIME_TYPES = [
  "audio/webm",
  // Safari can emit MP4 audio through MediaRecorder. Keep it in the contract,
  // while browser/device capture support still requires real-device verification.
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/mpeg",
  "audio/aac",
  "audio/x-m4a",
] as const;

const voiceAudioMimeTypes = new Set<string>(VOICE_AUDIO_MIME_TYPES);
const audioDataUrlPattern =
  /^data:(audio\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[a-z0-9.+-]+)*;base64,([a-z0-9+/]+={0,2})$/iu;

function decodedBase64ByteLength(value: string): number | null {
  const match = audioDataUrlPattern.exec(value);
  const mimeType = match?.[1]?.toLowerCase();
  const base64 = match?.[2];
  if (!mimeType || !voiceAudioMimeTypes.has(mimeType)) return null;
  if (!base64 || base64.length % 4 !== 0) return null;

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

export const voiceAudioDataUrlSchema = z
  .string()
  .min(1)
  .max(MAX_VOICE_AUDIO_DATA_URL_BYTES)
  .superRefine((value, context) => {
    const decodedBytes = decodedBase64ByteLength(value);
    if (decodedBytes === null) {
      context.addIssue({
        code: "custom",
        message: "voice_audio_must_be_a_base64_audio_data_url",
      });
      return;
    }

    if (decodedBytes > MAX_VOICE_AUDIO_BYTES) {
      context.addIssue({
        code: "too_big",
        maximum: MAX_VOICE_AUDIO_BYTES,
        origin: "string",
        inclusive: true,
        message: "voice_audio_exceeds_safe_encoded_size",
      });
    }
  });

export const voiceTranscriptionRequestSchema = z.strictObject({
  audio_data_url: voiceAudioDataUrlSchema,
  language: localeSchema.optional(),
  stream: z.boolean().default(true),
});

export const voiceTranscriptionSchema = z.strictObject({
  text: z.string().trim().min(1),
});

export const voiceTranscriptionResponseSchema = apiSuccessEnvelopeSchema(
  voiceTranscriptionSchema,
);

export const voiceTranscriptionDeltaEventSchema = z.strictObject({
  type: z.literal("delta"),
  text: z.string().min(1),
});

export const voiceTranscriptionDoneEventSchema = z.strictObject({
  type: z.literal("done"),
  text: z.string().trim().min(1),
});

export const voiceTranscriptionErrorEventSchema = z.strictObject({
  type: z.literal("error"),
  error_code: z.literal("VOICE_TRANSCRIPTION_FAILED"),
  message_key: z.literal("errors.composer.voiceTranscriptionFailed"),
  message: z.string().min(1),
});

export const voiceTranscriptionStreamEventSchema = z.discriminatedUnion("type", [
  voiceTranscriptionDeltaEventSchema,
  voiceTranscriptionDoneEventSchema,
  voiceTranscriptionErrorEventSchema,
]);

export type VoiceTranscriptionRequest = z.infer<
  typeof voiceTranscriptionRequestSchema
>;
export type VoiceTranscriptionStreamEvent = z.infer<
  typeof voiceTranscriptionStreamEventSchema
>;
