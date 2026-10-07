import { useDeferredValue, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PowerIcon,
  RefreshCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserRoundCogIcon,
  UserXIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { paginatedSchema, userSchema } from "@/api/contracts"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { PageLayout } from "@/components/shell/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"
import { SearchInput } from "@/components/ui/search-input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { AdminKnowledgeTabs } from "@/features/admin/admin-knowledge-tabs"
import { AdminKnowledgeBaseName } from "@/features/admin/admin-knowledge-base-name"
import { formatKnowledgeBytes } from "@/features/knowledge-bases/knowledge-base-utils"
import { normalizeLanguage, type SupportedLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

const adminKnowledgeGrantSchema = z.object({
  id: z.string(),
  target_type: z.enum(["user", "user_group"]),
  target_id: z.string(),
  target_name: z.string(),
})

const adminKnowledgeBaseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    owner: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
    }),
    lifecycle_status: z.enum(["active", "archived", "deleted"]),
    availability_status: z.enum(["enabled", "disabled"]),
    document_counts: z.object({
      total: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
      ready: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    storage_used_bytes: z.number().int().nonnegative(),
    storage_reserved_bytes: z.number().int().nonnegative(),
    share_count: z.number().int().nonnegative(),
    active_grants: z.array(adminKnowledgeGrantSchema),
    stable_error_codes: z.array(z.string()),
    cleanup_status: z.string().nullable(),
    disabled_reason: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough()

const adminKnowledgeBasePageSchema = z.object({
  items: z.array(adminKnowledgeBaseSchema),
  next_cursor: z.string().nullable().optional(),
})

const cleanupRetrySchema = z.object({
  retried_count: z.number().int().nonnegative(),
})
const emptySchema = z.unknown()

type AdminKnowledgeBase = z.infer<typeof adminKnowledgeBaseSchema>
type AdminKnowledgeGrant = z.infer<typeof adminKnowledgeGrantSchema>
type AdminKnowledgeLifecycle = AdminKnowledgeBase["lifecycle_status"] | "all"
type AdminKnowledgeAvailability =
  AdminKnowledgeBase["availability_status"] | "all"

type GovernanceAction =
  | { type: "disable"; knowledgeBase: AdminKnowledgeBase }
  | { type: "enable"; knowledgeBase: AdminKnowledgeBase }
  | { type: "archive"; knowledgeBase: AdminKnowledgeBase }
  | { type: "delete"; knowledgeBase: AdminKnowledgeBase }
  | { type: "cleanup_retry"; knowledgeBase: AdminKnowledgeBase }
  | {
      type: "revoke_grant"
      knowledgeBase: AdminKnowledgeBase
      grant: AdminKnowledgeGrant
    }

export function AdminKnowledgeBasePage() {
  const { t, i18n } = useTranslation()
  const locale = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("search") ?? ""
  const deferredSearch = useDeferredValue(search.trim())
  const lifecycle = readUrlEnum<AdminKnowledgeLifecycle>(
    searchParams,
    "lifecycle",
    ["all", "active", "archived", "deleted"],
    "all"
  )
  const availability = readUrlEnum<AdminKnowledgeAvailability>(
    searchParams,
    "availability",
    ["all", "enabled", "disabled"],
    "all"
  )
  const [action, setAction] = useState<GovernanceAction>()
  const [transferTarget, setTransferTarget] = useState<AdminKnowledgeBase>()
  const [reason, setReason] = useState("")
  const [ownerSearch, setOwnerSearch] = useState("")
  const deferredOwnerSearch = useDeferredValue(ownerSearch.trim())
  const [ownerId, setOwnerId] = useState("")
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const cursor = searchParams.get("cursor") || undefined
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([])

  const updateListParams = (
    updates: Readonly<Record<string, string | null | undefined>>
  ) => {
    setSearchParams((current) => updateUrlSearchParams(current, updates), {
      replace: true,
    })
  }

  const list = useQuery({
    queryKey: [
      "admin",
      "knowledge-bases",
      deferredSearch,
      lifecycle,
      availability,
      cursor,
    ],
    queryFn: ({ signal }) =>
      apiRequest("/admin/knowledge-bases", {
        query: {
          search: deferredSearch || undefined,
          lifecycle_status: lifecycle === "all" ? undefined : lifecycle,
          availability_status:
            availability === "all" ? undefined : availability,
          cursor,
          limit: 20,
        },
        schema: adminKnowledgeBasePageSchema,
        signal,
      }),
    placeholderData: (previousData) => previousData,
  })
  const items = list.data?.items ?? []
  const currentPage = cursorStack.length + 1
  const shouldShowPagination =
    cursorStack.length > 0 || Boolean(list.data?.next_cursor)

  const goToNextPage = () => {
    if (!list.data?.next_cursor || list.isFetching) return
    setCursorStack((values) => [...values, cursor])
    updateListParams({ cursor: list.data.next_cursor })
  }

  const goToPreviousPage = () => {
    if (cursorStack.length === 0 || list.isFetching) return
    updateListParams({ cursor: cursorStack.at(-1) })
    setCursorStack((values) => values.slice(0, -1))
  }

  const owners = useQuery({
    queryKey: ["admin", "knowledge-base-owner-options", deferredOwnerSearch],
    queryFn: ({ signal }) =>
      apiRequest("/admin/users", {
        query: {
          q: deferredOwnerSearch || undefined,
          status: "active",
          limit: 100,
        },
        schema: paginatedSchema(userSchema),
        signal,
      }),
    enabled: Boolean(transferTarget),
  })
  const ownerOptions = (owners.data?.items ?? []).filter(
    (owner) => owner.id !== transferTarget?.owner.id
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "knowledge-bases"] })

  const actionMutation = useMutation({
    mutationFn: async (current: GovernanceAction) => {
      const basePath = `/admin/knowledge-bases/${current.knowledgeBase.id}`
      const body = { reason: reason.trim() }
      if (current.type === "delete") {
        return apiRequest(basePath, {
          method: "DELETE",
          body,
          schema: emptySchema,
        })
      }
      if (current.type === "revoke_grant") {
        return apiRequest(`${basePath}/grants/${current.grant.id}`, {
          method: "DELETE",
          body,
          schema: emptySchema,
        })
      }
      if (current.type === "cleanup_retry") {
        return apiRequest(`${basePath}/cleanup/retry`, {
          method: "POST",
          body,
          schema: cleanupRetrySchema,
        })
      }
      return apiRequest(`${basePath}/${current.type}`, {
        method: "POST",
        body,
        schema: emptySchema,
      })
    },
    onMutate: () => {
      setError(undefined)
      setMessage(undefined)
    },
    onSuccess: async (_result, current) => {
      setMessage(t(`adminKnowledge.feedback.${current.type}`))
      closeDialogs()
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const transferMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        `/admin/knowledge-bases/${transferTarget?.id}/transfer-owner`,
        {
          method: "POST",
          body: { owner_id: ownerId, reason: reason.trim() },
          schema: emptySchema,
        }
      ),
    onMutate: () => {
      setError(undefined)
      setMessage(undefined)
    },
    onSuccess: async () => {
      setMessage(t("adminKnowledge.feedback.transfer_owner"))
      closeDialogs()
      await invalidate()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const closeDialogs = () => {
    setAction(undefined)
    setTransferTarget(undefined)
    setReason("")
    setOwnerSearch("")
    setOwnerId("")
  }

  return (
    <PageLayout
      title={t("adminKnowledge.title")}
      contentWidth="wide"
      description={t("adminKnowledge.description")}
    >
      <AdminKnowledgeTabs value="knowledgeBases">
        <NotificationToast
          id="admin-knowledge-base-action-success"
          message={message}
        />
        {error && <StatusBanner variant="error">{error}</StatusBanner>}

        <div className="admin-knowledge-filters">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <SearchInput
              value={search}
              aria-label={t("adminKnowledge.search")}
              placeholder={t("adminKnowledge.search")}
              onValueChange={(value) => {
                updateListParams({
                  search: value,
                  cursor: null,
                })
                setCursorStack([])
              }}
            />
          </InputGroup>
          <FilterSelect
            icon={WorkflowIcon}
            label={t("adminKnowledge.lifecycle.label")}
            value={lifecycle}
            onValueChange={(value) => {
              updateListParams({
                lifecycle: value === "all" ? null : value,
                cursor: null,
              })
              setCursorStack([])
            }}
            options={["all", "active", "archived", "deleted"]}
            translationPrefix="adminKnowledge.lifecycle"
          />
          <FilterSelect
            icon={PowerIcon}
            label={t("adminKnowledge.availability.label")}
            value={availability}
            onValueChange={(value) => {
              updateListParams({
                availability: value === "all" ? null : value,
                cursor: null,
              })
              setCursorStack([])
            }}
            options={["all", "enabled", "disabled"]}
            translationPrefix="adminKnowledge.availability"
          />
        </div>

        {list.isLoading && <LoadingState />}
        {list.isError && (
          <ErrorState
            message={getErrorMessage(list.error, t)}
            onRetry={() => void list.refetch()}
          />
        )}
        {list.data && items.length === 0 && (
          <EmptyState title={t("adminKnowledge.empty")} />
        )}
        {items.length > 0 && (
          <div className="admin-knowledge-table" aria-busy={list.isFetching}>
            <Table appearance="card">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">
                    {t("adminKnowledge.columns.knowledgeBase")}
                  </TableHead>
                  <TableHead className="admin-knowledge-owner-column">
                    {t("adminKnowledge.columns.owner")}
                  </TableHead>
                  <TableHead className="admin-knowledge-documents-column">
                    {t("adminKnowledge.columns.documents")}
                  </TableHead>
                  <TableHead className="admin-knowledge-storage-column">
                    {t("adminKnowledge.columns.storage")}
                  </TableHead>
                  <TableHead className="admin-knowledge-shares-column">
                    {t("adminKnowledge.columns.shares")}
                  </TableHead>
                  <TableHead className="admin-knowledge-status-column">
                    {t("common.status")}
                  </TableHead>
                  <TableHead className="w-[148px]">
                    {t("adminKnowledge.columns.diagnostics")}
                  </TableHead>
                  <TableHead className="admin-knowledge-actions-column text-right">
                    {t("common.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((knowledgeBase) => (
                  <AdminKnowledgeBaseRow
                    key={knowledgeBase.id}
                    knowledgeBase={knowledgeBase}
                    locale={locale}
                    pending={
                      actionMutation.isPending || transferMutation.isPending
                    }
                    onAction={setAction}
                    onTransfer={() => {
                      setTransferTarget(knowledgeBase)
                      setError(undefined)
                    }}
                  />
                ))}
              </TableBody>
            </Table>
            {shouldShowPagination && (
              <Pagination
                aria-label={t("adminKnowledge.pagination.label")}
                className="admin-knowledge-pagination"
              >
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      type="button"
                      variant="ghost"
                      size="default"
                      disabled={cursorStack.length === 0 || list.isFetching}
                      onClick={goToPreviousPage}
                    >
                      <ChevronLeftIcon
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      {t("common.previous")}
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <span
                      className="admin-knowledge-page-number"
                      aria-live="polite"
                    >
                      {t("adminKnowledge.pagination.page", {
                        page: currentPage,
                      })}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      type="button"
                      variant="ghost"
                      size="default"
                      disabled={!list.data?.next_cursor || list.isFetching}
                      onClick={goToNextPage}
                    >
                      {t("common.next")}
                      {list.isFetching ? (
                        <LoaderCircleIcon
                          data-icon="inline-end"
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronRightIcon
                          data-icon="inline-end"
                          aria-hidden="true"
                        />
                      )}
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}

        <GovernanceReasonDialog
          action={action}
          reason={reason}
          pending={actionMutation.isPending}
          onReasonChange={setReason}
          onClose={closeDialogs}
          onConfirm={() => action && actionMutation.mutate(action)}
        />
        <TransferOwnerDialog
          knowledgeBase={transferTarget}
          search={ownerSearch}
          ownerId={ownerId}
          owners={ownerOptions}
          loading={owners.isLoading}
          error={owners.error}
          reason={reason}
          pending={transferMutation.isPending}
          onSearchChange={setOwnerSearch}
          onOwnerChange={setOwnerId}
          onReasonChange={setReason}
          onRetry={() => void owners.refetch()}
          onClose={closeDialogs}
          onConfirm={() => transferMutation.mutate()}
        />
      </AdminKnowledgeTabs>
    </PageLayout>
  )
}

function FilterSelect({
  icon: Icon,
  label,
  value,
  onValueChange,
  options,
  translationPrefix,
}: {
  icon: LucideIcon
  label: string
  value: string
  onValueChange: (value: string) => void
  options: string[]
  translationPrefix: string
}) {
  const { t } = useTranslation()
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next ?? "all")}
    >
      <SelectTrigger aria-label={label} className="w-full">
        <Icon aria-hidden="true" />
        <SelectValue>{t(`${translationPrefix}.${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(`${translationPrefix}.${option}`)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function AdminKnowledgeBaseRow({
  knowledgeBase,
  locale,
  pending,
  onAction,
  onTransfer,
}: {
  knowledgeBase: AdminKnowledgeBase
  locale: SupportedLanguage
  pending: boolean
  onAction: (action: GovernanceAction) => void
  onTransfer: () => void
}) {
  const { t } = useTranslation()
  const storage =
    knowledgeBase.storage_used_bytes + knowledgeBase.storage_reserved_bytes
  return (
    <TableRow>
      <TableCell
        className="w-[300px]"
        data-label={t("adminKnowledge.columns.knowledgeBase")}
      >
        <div className="admin-knowledge-cell-stack">
          <AdminKnowledgeBaseName name={knowledgeBase.name} />
          <time
            className="admin-knowledge-secondary-text"
            dateTime={knowledgeBase.updated_at}
          >
            {formatDateTime(knowledgeBase.updated_at, locale)}
          </time>
        </div>
      </TableCell>
      <TableCell
        className="admin-knowledge-owner-column"
        data-label={t("adminKnowledge.columns.owner")}
      >
        <div className="admin-knowledge-cell-stack">
          <span className="admin-knowledge-primary-text">
            {knowledgeBase.owner.name}
          </span>
          {knowledgeBase.owner.status !== "active" && (
            <Badge variant="destructive">
              {t("adminKnowledge.ownerDisabled")}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell
        className="admin-knowledge-documents-column"
        data-label={t("adminKnowledge.columns.documents")}
      >
        <div className="admin-knowledge-cell-stack">
          <span>
            {t("adminKnowledge.documentSummary", knowledgeBase.document_counts)}
          </span>
          {(knowledgeBase.document_counts.processing > 0 ||
            knowledgeBase.document_counts.failed > 0) && (
            <span className="admin-knowledge-secondary-text">
              {t(
                "adminKnowledge.documentIssues",
                knowledgeBase.document_counts
              )}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell
        className="admin-knowledge-storage-column"
        data-label={t("adminKnowledge.columns.storage")}
      >
        {formatKnowledgeBytes(storage, locale)}
      </TableCell>
      <TableCell
        className="admin-knowledge-shares-column"
        data-label={t("adminKnowledge.columns.shares")}
      >
        <div className="admin-knowledge-cell-stack">
          <span>
            {t("adminKnowledge.shareCount", {
              count: knowledgeBase.share_count,
            })}
          </span>
          {knowledgeBase.active_grants.length > 0 && (
            <div className="admin-knowledge-grants">
              {knowledgeBase.active_grants.map((grant) => (
                <span key={grant.id} className="admin-knowledge-grant">
                  {grant.target_name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("adminKnowledge.revokeNamed", {
                      name: grant.target_name,
                    })}
                    disabled={pending}
                    onClick={() =>
                      onAction({ type: "revoke_grant", knowledgeBase, grant })
                    }
                  >
                    <UserXIcon aria-hidden="true" />
                  </Button>
                </span>
              ))}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell
        className="admin-knowledge-status-column"
        data-label={t("common.status")}
      >
        <div className="admin-knowledge-cell-stack">
          <div className="admin-knowledge-badges">
            <Badge variant="outline">
              {t(`adminKnowledge.lifecycle.${knowledgeBase.lifecycle_status}`)}
            </Badge>
            <Badge
              variant={
                knowledgeBase.availability_status === "disabled"
                  ? "destructive"
                  : "secondary"
              }
            >
              {t(
                `adminKnowledge.availability.${knowledgeBase.availability_status}`
              )}
            </Badge>
          </div>
          {knowledgeBase.cleanup_status && (
            <span className="admin-knowledge-secondary-text">
              {t("adminKnowledge.cleanup", {
                status: t(
                  `adminKnowledge.cleanupStatus.${knowledgeBase.cleanup_status}`
                ),
              })}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell
        className="w-[148px]"
        data-label={t("adminKnowledge.columns.diagnostics")}
      >
        <div className="admin-knowledge-cell-stack">
          {knowledgeBase.disabled_reason && (
            <span
              className="admin-knowledge-secondary-text admin-knowledge-truncate"
              title={knowledgeBase.disabled_reason}
            >
              {knowledgeBase.disabled_reason}
            </span>
          )}
          {knowledgeBase.stable_error_codes.length > 0 ? (
            knowledgeBase.stable_error_codes.map((code) => (
              <code
                key={code}
                className="admin-knowledge-diagnostic-code"
                title={code}
              >
                {code}
              </code>
            ))
          ) : (
            <span className="admin-knowledge-secondary-text">
              {t("adminKnowledge.noDiagnostics")}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell
        className="admin-knowledge-actions-column"
        data-label={t("common.actions")}
      >
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminKnowledge.actionsFor", {
                    name: knowledgeBase.name,
                  })}
                  disabled={pending}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {knowledgeBase.availability_status === "enabled" ? (
                  <DropdownMenuItem
                    onClick={() => onAction({ type: "disable", knowledgeBase })}
                  >
                    <BanIcon aria-hidden="true" />
                    {t("adminKnowledge.actions.disable")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => onAction({ type: "enable", knowledgeBase })}
                  >
                    <ShieldCheckIcon aria-hidden="true" />
                    {t("adminKnowledge.actions.enable")}
                  </DropdownMenuItem>
                )}
                {knowledgeBase.lifecycle_status === "active" && (
                  <DropdownMenuItem
                    onClick={() => onAction({ type: "archive", knowledgeBase })}
                  >
                    <ArchiveIcon aria-hidden="true" />
                    {t("adminKnowledge.actions.archive")}
                  </DropdownMenuItem>
                )}
                {knowledgeBase.lifecycle_status !== "deleted" && (
                  <DropdownMenuItem onClick={onTransfer}>
                    <UserRoundCogIcon aria-hidden="true" />
                    {t("adminKnowledge.actions.transferOwner")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {(knowledgeBase.cleanup_status === "failed" ||
                knowledgeBase.lifecycle_status === "archived") && (
                <DropdownMenuSeparator />
              )}
              {knowledgeBase.cleanup_status === "failed" && (
                <DropdownMenuItem
                  onClick={() =>
                    onAction({ type: "cleanup_retry", knowledgeBase })
                  }
                >
                  <RefreshCcwIcon aria-hidden="true" />
                  {t("adminKnowledge.actions.retryCleanup")}
                </DropdownMenuItem>
              )}
              {knowledgeBase.lifecycle_status === "archived" && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onAction({ type: "delete", knowledgeBase })}
                >
                  <Trash2Icon aria-hidden="true" />
                  {t("adminKnowledge.actions.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}

function GovernanceReasonDialog({
  action,
  reason,
  pending,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  action: GovernanceAction | undefined
  reason: string
  pending: boolean
  onReasonChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const actionType = action?.type
  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {actionType ? t(`adminKnowledge.confirm.${actionType}.title`) : ""}
          </DialogTitle>
          <DialogDescription>
            {actionType
              ? t(`adminKnowledge.confirm.${actionType}.description`, {
                  name:
                    actionType === "revoke_grant"
                      ? action.grant.target_name
                      : action?.knowledgeBase.name,
                })
              : ""}
          </DialogDescription>
        </DialogHeader>
        {actionType === "archive" && (
          <StatusBanner variant="warning">
            {t("adminKnowledge.archiveBeforeDelete")}
          </StatusBanner>
        )}
        <ReasonField value={reason} onChange={onReasonChange} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            variant={
              actionType === "disable" ||
              actionType === "archive" ||
              actionType === "delete" ||
              actionType === "revoke_grant"
                ? "destructive"
                : "default"
            }
            disabled={!reason.trim() || pending}
            onClick={onConfirm}
          >
            {pending && (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden="true"
              />
            )}
            {actionType ? t(`adminKnowledge.confirm.${actionType}.action`) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferOwnerDialog({
  knowledgeBase,
  search,
  ownerId,
  owners,
  loading,
  error,
  reason,
  pending,
  onSearchChange,
  onOwnerChange,
  onReasonChange,
  onRetry,
  onClose,
  onConfirm,
}: {
  knowledgeBase: AdminKnowledgeBase | undefined
  search: string
  ownerId: string
  owners: Array<z.infer<typeof userSchema>>
  loading: boolean
  error: unknown
  reason: string
  pending: boolean
  onSearchChange: (value: string) => void
  onOwnerChange: (value: string) => void
  onReasonChange: (value: string) => void
  onRetry: () => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={Boolean(knowledgeBase)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("adminKnowledge.transfer.title")}</DialogTitle>
          <DialogDescription>
            {t("adminKnowledge.transfer.description", {
              name: knowledgeBase?.name,
            })}
          </DialogDescription>
        </DialogHeader>
        <FieldShell
          id="knowledge-owner-selection"
          label={t("adminKnowledge.transfer.owner")}
          required
        >
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id="knowledge-owner-search"
              aria-label={t("adminKnowledge.transfer.search")}
              value={search}
              placeholder={t("adminKnowledge.transfer.search")}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
          </InputGroup>
          {loading && <LoadingState />}
          {Boolean(error) && (
            <ErrorState message={getErrorMessage(error, t)} onRetry={onRetry} />
          )}
          {!loading && !error && (
            <Select
              items={owners.map((owner) => ({
                value: owner.id,
                label: owner.name,
              }))}
              value={ownerId || undefined}
              onValueChange={(value) => onOwnerChange(value ?? "")}
            >
              <SelectTrigger
                id="knowledge-owner-selection"
                aria-label={t("adminKnowledge.transfer.owner")}
                aria-required="true"
              >
                <SelectValue
                  placeholder={t("adminKnowledge.transfer.select")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </FieldShell>
        <ReasonField value={reason} onChange={onReasonChange} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            disabled={!ownerId || !reason.trim() || pending}
            onClick={onConfirm}
          >
            {pending && (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden="true"
              />
            )}
            {t("adminKnowledge.transfer.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <FieldShell
      id="knowledge-governance-reason"
      label={t("adminKnowledge.reason")}
      required
      hint={t("adminKnowledge.reasonHint")}
    >
      <Textarea
        id="knowledge-governance-reason"
        value={value}
        maxLength={1000}
        required
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </FieldShell>
  )
}
