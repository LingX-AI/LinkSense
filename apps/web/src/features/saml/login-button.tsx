import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StatusBanner } from "@/components/feedback/status-banner"
import { getErrorMessage } from "@/api/error-message"
import { useSamlStart, useSamlStatus } from "./api"

export function SamlLoginButton() {
  const { t } = useTranslation()
  const status = useSamlStatus()
  const start = useSamlStart()
  if (status.isPending) return <Spinner className="mx-auto" />
  if (status.isError)
    return (
      <Button variant="ghost" onClick={() => void status.refetch()}>
        {t("saml.retry")}
      </Button>
    )
  if (!status.data.enabled) return null
  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={start.isPending}
        onClick={() => start.mutate()}
      >
        {start.isPending && <Spinner data-icon="inline-start" />}
        {t("saml.login")}
      </Button>
      {start.error && (
        <StatusBanner variant="error">
          {getErrorMessage(start.error, t)}
        </StatusBanner>
      )}
    </div>
  )
}
