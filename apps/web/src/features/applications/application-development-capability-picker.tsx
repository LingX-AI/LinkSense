import { useDeferredValue, useId, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  interactiveDependencyOptionsSchema,
  type InteractiveDependencyType,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { ResourceMultiSelect } from "./application-resource-multi-select"
import { applicationDevelopmentKeys } from "./application-development-api"

export type SelectedApplicationCapability = {
  id: string
  name: string
  available: boolean
}

export function ApplicationDevelopmentCapabilityPicker({
  type,
  selected,
  onChange,
  disabled,
  limitReached,
}: {
  type: InteractiveDependencyType
  selected: SelectedApplicationCapability[]
  onChange: (selected: SelectedApplicationCapability[]) => void
  disabled: boolean
  limitReached: boolean
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const id = useId()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const query = useInfiniteQuery({
    queryKey: applicationDevelopmentKeys.capabilityOptions(
      user?.id,
      type,
      deferredSearch
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiRequest("/applications/interactive-dependency-options", {
        query: { type, search: deferredSearch || undefined, cursor: pageParam },
        schema: interactiveDependencyOptionsSchema,
        signal,
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const options = new Map(
    [
      ...selected,
      ...(query.data?.pages.flatMap((page) =>
        page.items.map((item) => ({ ...item, available: true }))
      ) ?? []),
    ].map((item) => [item.id, item])
  )
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ResourceMultiSelect
        id={id}
        title={t(`applications.dependencies.types.${type}`)}
        description={t(`applicationDevelopment.capabilityHints.${type}`)}
        items={[...options.values()].map((item) => ({
          id: item.id,
          label: item.name,
          detail: item.available
            ? ""
            : t("applicationDevelopment.capabilityUnavailable"),
          detailInline: true,
          disabled: !item.available || limitReached,
        }))}
        selectedIds={selected.map((item) => item.id)}
        onChange={(ids) =>
          onChange(
            ids.flatMap((value) => {
              const item = options.get(value)
              return item ? [item] : []
            })
          )
        }
        emptyLabel={t("applicationDevelopment.capabilitySearch")}
        placeholder={t("applicationDevelopment.capabilitySearch")}
        searchPlaceholder={t("applicationDevelopment.capabilitySearch")}
        onSearch={setSearch}
        onLoadMore={
          query.hasNextPage
            ? () => {
                void query.fetchNextPage()
              }
            : undefined
        }
        disabled={disabled}
        loading={query.isFetching}
        loadingMore={query.isFetchingNextPage}
        visibleChipLimit={Infinity}
      />
      {query.error && (
        <StatusBanner variant="error">
          {getErrorMessage(query.error, t)}
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </StatusBanner>
      )}
    </div>
  )
}
