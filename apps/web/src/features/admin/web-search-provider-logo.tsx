import type { WebSearchProvider } from "@linksense/shared"

export function WebSearchProviderLogo({
  provider,
}: {
  provider: WebSearchProvider
}) {
  return (
    <img
      src={`/provider-logos/${provider}.svg`}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      className="size-4 shrink-0 object-contain"
      data-web-search-provider-logo={provider}
    />
  )
}
