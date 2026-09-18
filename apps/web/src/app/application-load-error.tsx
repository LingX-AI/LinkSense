import { useTranslation } from "react-i18next"
import { ErrorState } from "@/components/feedback/page-state"

export function ApplicationLoadError() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <ErrorState
        message={t("clientUpdate.loadFailed")}
        onRetry={() => window.location.reload()}
      />
    </main>
  )
}
