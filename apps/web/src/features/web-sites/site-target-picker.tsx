import { useDeferredValue, useId, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { WebSite } from "@linksense/shared"
import { SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { FieldShell } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import { InputGroupAddon } from "@/components/ui/input-group"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox"
import { listWebSites, webSiteKeys } from "./api"

export function SiteTargetPicker({
  conversationId,
  value,
  onChange,
  disabled,
}: {
  conversationId: string
  value: WebSite | null
  onChange: (site: WebSite | null) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const allFilter = { search: deferredSearch }
  const currentFilter = { ...allFilter, conversationId }
  const all = useInfiniteQuery({
    queryKey: webSiteKeys.list(allFilter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listWebSites({ ...allFilter, cursor: pageParam, signal }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const current = useInfiniteQuery({
    queryKey: webSiteKeys.list(currentFilter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listWebSites({ ...currentFilter, cursor: pageParam, signal }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const items = Array.from(
    new Map(
      [
        ...(current.data?.pages.flatMap((page) => page.items) ?? []),
        ...(all.data?.pages.flatMap((page) => page.items) ?? []),
      ].map((site) => [site.id, site])
    ).values()
  )
  const error = current.error ?? all.error
  const pending = current.isPending || all.isPending
  const more = current.hasNextPage ? current : all

  return (
    <FieldShell id={id} label={t("webSites.existingSite")}>
      <Combobox
        items={items}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        filter={null}
        itemToStringLabel={(site: WebSite) => site.name}
        itemToStringValue={(site: WebSite) => site.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        inputValue={search}
        onInputValueChange={(next, details) => {
          if (
            details.reason === "input-change" ||
            details.reason === "input-clear"
          ) {
            setSearch(next)
            onChange(null)
          }
        }}
        onOpenChange={(open) => {
          if (!open) setSearch("")
        }}
      >
        <ComboboxTrigger
          id={id}
          aria-label={t("webSites.existingSite")}
          render={<Button variant="input" className="w-full justify-between" />}
        >
          <span className="min-w-0 truncate text-left">
            <ComboboxValue placeholder={t("webSites.selectExistingSite")} />
          </span>
        </ComboboxTrigger>
        <ComboboxContent className="flex min-w-(--anchor-width) flex-col">
          <ComboboxInput
            aria-label={t("webSites.search")}
            placeholder={t("webSites.search")}
            showTrigger={false}
          >
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
          </ComboboxInput>
          {pending && <LoadingState />}
          {!pending && !error && !items.length && (
            <p className="p-3 text-sm text-muted-foreground" role="status">
              {t(
                search.trim()
                  ? "webSites.noResults"
                  : "webSites.noUpdateTargets"
              )}
            </p>
          )}
          <ComboboxList className="min-h-0">
            {(site: WebSite) => (
              <ComboboxItem key={site.id} value={site}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words">{site.name}</span>
                  <span className="text-xs break-all text-muted-foreground">
                    {site.url_path}
                  </span>
                  {site.conversation_id === conversationId && (
                    <span className="text-xs text-muted-foreground">
                      {t("webSites.currentTask")}
                    </span>
                  )}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
          {error && (
            <ErrorState
              message={getErrorMessage(error, t)}
              onRetry={() => {
                void current.refetch()
                void all.refetch()
              }}
            />
          )}
          {more.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || more.isFetchingNextPage}
              onClick={() => void more.fetchNextPage()}
            >
              {t("webSites.loadMore")}
            </Button>
          )}
        </ComboboxContent>
      </Combobox>
    </FieldShell>
  )
}
