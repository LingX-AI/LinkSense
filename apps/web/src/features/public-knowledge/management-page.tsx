import { useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import dayjs from "dayjs"
import { ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { getErrorMessage } from "@/api/error-message"
import {
  publicKnowledgeKeys,
  getPublicKnowledgeManagement,
  getPublicKnowledgeConversations,
  getPublicKnowledgeDetail,
} from "./api"
import { PublicKnowledgeTurnView } from "./turn-view"

export function PublicKnowledgeManagementPage() {
  const { applicationId = "" } = useParams(),
    { t } = useTranslation()
  const management = useQuery({
    queryKey: publicKnowledgeKeys.management(applicationId),
    queryFn: ({ signal }) =>
      getPublicKnowledgeManagement(applicationId, signal),
    enabled: Boolean(applicationId),
  })
  if (management.isPending) return <LoadingState />
  if (management.error || !management.data)
    return (
      <ErrorState
        message={getErrorMessage(management.error, t)}
        onRetry={() => void management.refetch()}
      />
    )
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        render={<Link to="/capabilities?section=application&scope=personal" />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {t("applications.usage.backToApplications")}
      </Button>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold wrap-anywhere">
          {management.data.settings.name}
        </h1>
        <p className="text-muted-foreground">{t("publicKnowledge.logs")}</p>
      </div>
      <OwnerConversations applicationId={applicationId} />
    </section>
  )
}

function OwnerConversations({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string | null>(null)
  const list = useInfiniteQuery({
    queryKey: publicKnowledgeKeys.conversations(
      applicationId,
      search,
      from,
      to,
      status
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getPublicKnowledgeConversations(
        applicationId,
        {
          search: search || undefined,
          from: from ? dayjs(from).startOf("day").toISOString() : undefined,
          to: to ? dayjs(to).endOf("day").toISOString() : undefined,
          status: status === "all" ? undefined : status,
          cursor: pageParam,
        },
        signal
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const detail = useQuery({
    queryKey: publicKnowledgeKeys.detail(applicationId, selected ?? ""),
    queryFn: ({ signal }) =>
      getPublicKnowledgeDetail(applicationId, selected ?? "", signal),
    enabled: selected !== null,
  })
  const statuses = [
    "all",
    "queued",
    "running",
    "completed",
    "failed",
    "interrupted",
  ].map((value) => ({ value, label: t(`publicKnowledge.${value}`) }))
  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="flex flex-col gap-4 pt-4">
      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="public-knowledge-search">
            {t("publicKnowledge.search")}
          </FieldLabel>
          <Input
            id="public-knowledge-search"
            maxLength={240}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setSelected(null)
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="public-knowledge-from">
            {t("publicKnowledge.from")}
          </FieldLabel>
          <Input
            id="public-knowledge-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value)
              setSelected(null)
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="public-knowledge-to">
            {t("publicKnowledge.to")}
          </FieldLabel>
          <Input
            id="public-knowledge-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              setSelected(null)
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="public-knowledge-status">
            {t("publicKnowledge.status")}
          </FieldLabel>
          <Select
            items={statuses}
            value={status}
            onValueChange={(value) => {
              setStatus(value ?? "all")
              setSelected(null)
            }}
          >
            <SelectTrigger id="public-knowledge-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {statuses.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      {list.isPending ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState
          message={t("publicKnowledge.unavailable")}
          onRetry={() => void list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("publicKnowledge.empty")}
          description={t("publicKnowledge.emptyHelp")}
        />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav
            aria-label={t("publicKnowledge.conversations")}
            className="flex min-w-0 flex-col gap-2"
          >
            {items.map((item) => (
              <Button
                key={item.id}
                variant={selected === item.id ? "secondary" : "outline"}
                className="h-auto justify-start p-3 text-left whitespace-normal"
                onClick={() => setSelected(item.id)}
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="line-clamp-2 wrap-anywhere">
                    {item.title || t("publicKnowledge.newConversation")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("publicKnowledge.visitor")} {item.visitor_id.slice(0, 8)}
                  </span>
                </span>
              </Button>
            ))}
            {list.hasNextPage && (
              <Button
                variant="outline"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t("publicKnowledge.loadMore")}
              </Button>
            )}
          </nav>
          <div className="flex min-w-0 flex-col gap-4">
            {!selected ? (
              <p>{t("publicKnowledge.selectConversation")}</p>
            ) : detail.isPending ? (
              <LoadingState />
            ) : detail.error ? (
              <ErrorState
                message={t("publicKnowledge.unavailable")}
                onRetry={() => void detail.refetch()}
              />
            ) : (
              detail.data?.turns.map((turn) => (
                <PublicKnowledgeTurnView key={turn.id} turn={turn} review />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
