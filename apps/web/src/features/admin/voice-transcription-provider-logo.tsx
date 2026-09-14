import type { ReactNode } from "react"
import type { VoiceTranscriptionProvider } from "@linksense/shared"
import { SiDeepgram, SiElevenlabs } from "react-icons/si"

import { cn } from "@/lib/utils"
import { ModelServiceProviderLogo } from "./model-service-provider-logo"

const providerLogos: Record<VoiceTranscriptionProvider, ReactNode> = {
  dashscope: <ModelServiceProviderLogo provider="alibaba" />,
  openai: <ModelServiceProviderLogo provider="openai" />,
  openai_compatible: <ModelServiceProviderLogo provider="openai_compatible" />,
  azure_openai: <ModelServiceProviderLogo provider="azure_openai" />,
  groq: "groq",
  deepgram: <SiDeepgram focusable="false" />,
  assemblyai: "A",
  elevenlabs: <SiElevenlabs focusable="false" />,
  revai: "Rev",
  gladia: "G",
  fal: "fal",
}

export function VoiceTranscriptionProviderLogo({
  provider,
}: {
  provider: VoiceTranscriptionProvider
}) {
  const logo = providerLogos[provider]
  return (
    <span
      aria-hidden="true"
      data-voice-transcription-provider-logo={provider}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center",
        typeof logo === "string" &&
          "rounded-[4px] bg-foreground text-[9px] leading-none font-bold text-background"
      )}
    >
      {logo}
    </span>
  )
}
