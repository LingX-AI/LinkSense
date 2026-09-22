import { SiApple, SiFacebook } from "react-icons/si"
import { FcGoogle } from "react-icons/fc"
import type { SocialProvider } from "@linksense/shared"
import microsoftLogo from "./assets/microsoft.svg"

export function SocialProviderLogo({ provider }: { provider: SocialProvider }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center"
      data-social-provider-logo={provider}
    >
      {provider === "apple" ? (
        <SiApple className="size-full" focusable="false" />
      ) : provider === "facebook" ? (
        <SiFacebook
          className="size-full rounded-full bg-white"
          fill="#0866ff"
          focusable="false"
        />
      ) : provider === "google" ? (
        <FcGoogle
          className="size-[1.375rem] max-w-none"
          focusable="false"
        />
      ) : (
        <img src={microsoftLogo} alt="" className="size-full" />
      )}
    </span>
  )
}
