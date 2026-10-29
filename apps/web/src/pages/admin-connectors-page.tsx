import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { PageLayout } from "@/components/shell/page-layout"
import { AdminConnectionSettings } from "@/features/connections/admin-connection-settings"
import { useAdminConnectionSettings } from "@/features/connections/admin-settings-api"

export function AdminConnectorsPage() {
  const { t } = useTranslation()
  const query = useAdminConnectionSettings()
  return (
    <PageLayout
      title={t("adminConnections.title")}
      description={t("adminConnections.description")}
    >
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {!query.isError &&
        query.data &&
        (query.data.length ? (
          <AdminConnectionSettings items={query.data} />
        ) : (
          <EmptyState
            title={t("adminConnections.emptyTitle")}
            description={t("adminConnections.emptyDescription")}
          />
        ))}
    </PageLayout>
  )
}
