import { useDeferredValue, useRef, useState } from "react"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { type WebSite, webSiteStatusSchema } from "@linksense/shared"
import {
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group"
import { SearchInput } from "@/components/ui/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { downloadBlob } from "@/lib/download-blob"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"
import {
  downloadWebSite,
  listWebSites,
  updateWebSite,
  webSiteKeys,
} from "./api"
import { SiteDialog, type SiteAction } from "./site-dialog"
import { SiteCard } from "./site-card"

export function SiteLibrary() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const search = params.get("site_search") ?? ""
  const deferredSearch = useDeferredValue(search.trim())
  const status = readUrlEnum(
    params,
    "site_status",
    ["all", ...webSiteStatusSchema.options],
    "all"
  )
  const filter = {
    search: deferredSearch,
    ...(status === "all" ? {} : { status }),
  }
  const [action, setAction] = useState<SiteAction | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const downloadLock = useRef(false)
  const statusLock = useRef(false)
  const query = useInfiniteQuery({
    queryKey: webSiteKeys.list(filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listWebSites({ ...filter, cursor: pageParam, signal }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const statusMutation = useMutation({
    mutationFn: (site: WebSite) =>
      updateWebSite(site.id, {
        status: site.status === "published" ? "disabled" : "published",
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: webSiteKeys.all })
    },
    onError: (error) => notify.error(getErrorMessage(error, t)),
    onSettled: () => {
      statusLock.current = false
    },
  })
  const download = async (site: WebSite) => {
    if (downloadLock.current) return
    downloadLock.current = true
    setDownloading(site.id)
    try {
      downloadBlob(await downloadWebSite(site.id), `${site.slug}.zip`)
    } catch (error) {
      notify.error(getErrorMessage(error, t))
    } finally {
      downloadLock.current = false
      setDownloading(null)
    }
  }
  const filterItems = ["all", ...webSiteStatusSchema.options].map((value) => ({
    value,
    label: t(`webSites.status.${value}`),
  }))
  return (
    <section
      aria-label={t("webSites.title")}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <InputGroup className="sm:max-w-md">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <SearchInput
            value={search}
            placeholder={t("webSites.search")}
            aria-label={t("webSites.search")}
            onValueChange={(value) =>
              setParams(
                (current) =>
                  updateUrlSearchParams(current, { site_search: value }),
                { replace: true }
              )
            }
          />
        </InputGroup>
        <Select
          items={filterItems}
          value={status}
          onValueChange={(value) => {
            if (value === "all" || webSiteStatusSchema.safeParse(value).success)
              setParams(
                (current) =>
                  updateUrlSearchParams(current, {
                    site_status: value === "all" ? null : value,
                  }),
                { replace: true }
              )
          }}
        >
          <SelectTrigger
            className="w-full sm:w-40"
            aria-label={t("webSites.filter")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {filterItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.error && !query.data ? (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      ) : !items.length ? (
        <EmptyState
          title={t(
            search || status !== "all" ? "webSites.noResults" : "webSites.empty"
          )}
          description={t("webSites.emptyDescription")}
        />
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {items.map((site) => (
            <li key={site.id} className="min-w-0">
              <SiteCard
                site={site}
                actions={
                  <>
                    {site.status === "published" && (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <a
                            href={site.url_path}
                            role="link"
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <ExternalLinkIcon aria-hidden="true" />
                        {t("webSites.visit")}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("webSites.actions", {
                              name: site.name,
                            })}
                          />
                        }
                      >
                        <MoreHorizontalIcon aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => setAction({ kind: "edit", site })}
                        >
                          <PencilIcon />
                          {t("webSites.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!site.conversation_id}
                          onClick={() => setAction({ kind: "publish", site })}
                        >
                          <UploadIcon />
                          {t("webSites.update")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={statusMutation.isPending}
                          onClick={() => {
                            if (!statusLock.current) {
                              statusLock.current = true
                              statusMutation.mutate(site)
                            }
                          }}
                        >
                          {site.status === "published" ? (
                            <EyeOffIcon aria-hidden="true" />
                          ) : (
                            <EyeIcon aria-hidden="true" />
                          )}
                          {t(
                            site.status === "published"
                              ? "webSites.disable"
                              : "webSites.enable"
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={downloading !== null}
                          onClick={() => void download(site)}
                        >
                          {downloading === site.id ? (
                            <Spinner />
                          ) : (
                            <DownloadIcon />
                          )}
                          {t("webSites.download")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setAction({ kind: "delete", site })}
                        >
                          <TrashIcon />
                          {t("webSites.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {query.isFetchNextPageError && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.fetchNextPage()}
        />
      )}
      {query.hasNextPage && (
        <Button
          className="self-center"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Spinner />}
          {t("webSites.loadMore")}
        </Button>
      )}
      {action && <SiteDialog action={action} onClose={() => setAction(null)} />}
    </section>
  )
}
