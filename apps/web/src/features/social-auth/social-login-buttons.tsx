import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StatusBanner } from "@/components/feedback/status-banner"
import { getErrorMessage } from "@/api/error-message"
import { useSocialProviders, useSocialStart } from "./api"
import { SocialProviderLogo } from "./social-provider-logo"

const providerButtonClassName =
  "border-[#e2e5e9] bg-white text-[#202124] hover:border-[#cfd4da] hover:bg-[#f8fafc] focus-visible:border-[#c2c8d0] focus-visible:ring-[#94a3b8]/25 dark:border-white/15 dark:bg-white dark:text-[#202124] dark:hover:bg-[#f8fafc]"

export function SocialLoginButtons() {
  const { t } = useTranslation()
  const providers = useSocialProviders()
  const start = useSocialStart()
  if (providers.isPending) return <Spinner className="mx-auto" />
  if (providers.isError)
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => void providers.refetch()}
      >
        {t("common.retry")}
      </Button>
    )
  if (!providers.data.length) return null
  return (
    <section className="grid gap-3" aria-label={t("social.title")}>
      <p className="text-center text-sm text-muted-foreground">
        {t("social.available")}
      </p>
      <div className="grid gap-2">
        {providers.data.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="plain"
            size="xl"
            className={`w-full ${providerButtonClassName}`}
            data-social-provider={provider}
            disabled={start.isPending}
            aria-busy={
              start.isPending && start.variables === provider ? true : undefined
            }
            onClick={() => start.mutate(provider)}
          >
            {start.isPending && start.variables === provider && (
              <Spinner data-icon="inline-start" />
            )}
            <SocialProviderLogo provider={provider} />
            <span data-social-provider-label>
              {t("social.continueWith", {
                provider: t(`social.providers.${provider}`),
              })}
            </span>
          </Button>
        ))}
      </div>
      {start.error && (
        <StatusBanner variant="error">
          {getErrorMessage(start.error, t)}
        </StatusBanner>
      )}
    </section>
  )
}
