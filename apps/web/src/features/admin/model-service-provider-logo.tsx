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
import type { IconBaseProps } from "react-icons"
import type { ModelServiceProvider } from "@linksense/shared"

function SiLlmtr(props: IconBaseProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 16V8h3.2a2.4 2.4 0 0 1 0 4.8H8" />
    </svg>
  )
}

const modelServiceProviderIcons: Record<ModelServiceProvider, IconType> = {
  openai: TbBrandOpenai,
  azure_openai: TbBrandAzure,
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  google_vertex: SiGooglecloud,
  alibaba: SiAlibabacloud,
  deepseek: SiDeepseek,
  openrouter: SiOpenrouter,
  llmtr: SiLlmtr,
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
  llmtr: "text-provider-llmtr",
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
