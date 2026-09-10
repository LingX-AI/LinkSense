import type { IconType } from "react-icons"
import {
  SiAlibabacloud,
  SiAnthropic,
  SiDeepseek,
  SiGooglecloud,
  SiGooglegemini,
  SiOpenrouter,
  SiVllm,
} from "react-icons/si"
import { TbBrandAzure, TbBrandOpenai } from "react-icons/tb"
import type { ModelServiceProvider } from "@linksense/shared"

const modelServiceProviderIcons: Record<ModelServiceProvider, IconType> = {
  openai: TbBrandOpenai,
  azure_openai: TbBrandAzure,
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  google_vertex: SiGooglecloud,
  alibaba: SiAlibabacloud,
  deepseek: SiDeepseek,
  openrouter: SiOpenrouter,
  openai_compatible: SiVllm,
}

const modelServiceProviderLogoClasses: Record<ModelServiceProvider, string> = {
  openai: "text-provider-openai",
  azure_openai: "text-provider-azure-openai",
  anthropic: "text-provider-anthropic",
  google: "text-provider-google-gemini",
  google_vertex: "text-provider-google-vertex",
  alibaba: "text-provider-alibaba",
  deepseek: "text-provider-deepseek",
  openrouter: "text-provider-openrouter",
  openai_compatible: "text-provider-vllm",
}

export function ModelServiceProviderLogo({
  provider,
}: {
  provider: ModelServiceProvider
}) {
  const Logo = modelServiceProviderIcons[provider]
  return (
    <Logo
      aria-hidden="true"
      className={modelServiceProviderLogoClasses[provider]}
      data-service-provider-logo={provider}
      focusable="false"
    />
  )
}
