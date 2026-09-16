import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { applicationSchema, type Application } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { paginatedSchema } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { InputGroup } from "@/components/ui/input-group"
import { applicationDistributionKeys } from "./application-distribution-queries"

const applicationPageSchema = paginatedSchema(applicationSchema)

export function ApplicationPublicationPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: (application: Pick<Application, "id" | "name">) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const query = useQuery({
    queryKey: applicationDistributionKeys.publishable(deferredSearch),
    queryFn: ({ signal }) =>
      apiRequest("/applications", {
        query: {
          scope: "owned",
          search: deferredSearch || undefined,
          limit: 200,
        },
        schema: applicationPageSchema,
        signal,
      }),
  })
  const applications = (query.data?.items ?? []).filter(
    (application) => application.is_owner && application.status === "active"
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("marketplace.selectApplication")}</DialogTitle>
          <DialogDescription>
            {t("marketplace.selectApplicationDescription")}
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <SearchInput
            aria-label={t("applications.search")}
            placeholder={t("applications.searchPlaceholder")}
            value={search}
            onValueChange={setSearch}
          />
        </InputGroup>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={getErrorMessage(query.error, t)}
            onRetry={() => void query.refetch()}
          />
        ) : applications.length === 0 ? (
          <EmptyState title={t("marketplace.noPublishableApplication")} />
        ) : (
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {applications.map((application) => (
              <Button
                key={application.id}
                variant="outline"
                className="h-auto justify-start py-3 break-words whitespace-normal"
                onClick={() => onSelect(application)}
              >
                {application.name}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
