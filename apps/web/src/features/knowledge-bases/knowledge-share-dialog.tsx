import { useDeferredValue, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { TFunction } from "i18next"
import {
  LoaderCircleIcon,
  Share2Icon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
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
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createKnowledgeGrant,
  knowledgeBaseQueryKeys,
  revokeKnowledgeGrant,
} from "@/features/knowledge-bases/knowledge-base-api"
import type {
  KnowledgeGrant,
  KnowledgeGrantRevocationResult,
  KnowledgeShareTarget,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import {
  useKnowledgeGrants,
  useKnowledgeShareTargets,
} from "@/features/knowledge-bases/knowledge-base-hooks"
import { normalizeLanguage, type SupportedLanguage } from "@/i18n"

const visibleTargetChipLimit = 2
const shareTargetNameCollator = new Intl.Collator(["en-US", "zh-CN"], {
  sensitivity: "base",
  numeric: true,
})

export function KnowledgeShareDialog({
  open,
  onOpenChange,
  knowledgeBaseId,
  canCreateGrant = true,
  canRevokeGrant = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  canCreateGrant?: boolean
  canRevokeGrant?: boolean
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [targetType, setTargetType] =
    useState<KnowledgeShareTarget["type"]>("user")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [selectedTargets, setSelectedTargets] = useState<
    KnowledgeShareTarget[]
  >([])
  const targetSelectorAnchor = useComboboxAnchor()
  const [error, setError] = useState<string>()
  const grants = useKnowledgeGrants(knowledgeBaseId, open)
  const targets = useKnowledgeShareTargets(
    knowledgeBaseId,
    targetType,
    deferredSearch,
    open && canCreateGrant
  )
  const grantItems = grants.data?.pages.flatMap((page) => page.items) ?? []
  const activeGrantTargetIds = new Set(
    grantItems.flatMap((grant) =>
      grant.status === "active" &&
      grant.target_type === (targetType === "group" ? "user_group" : "user")
        ? [grant.target.id]
        : []
    )
  )
  const selectedTargetIds = new Set(selectedTargets.map((target) => target.id))
  const candidateTargets = [
    ...selectedTargets,
    ...(targets.data?.items ?? []).filter(
      (target) =>
        !selectedTargetIds.has(target.id) &&
        !activeGrantTargetIds.has(target.id)
    ),
  ]
  const selectableTargets =
    targetType === "user"
      ? [...candidateTargets].sort(
          (left, right) =>
            shareTargetNameCollator.compare(left.name, right.name) ||
            left.id.localeCompare(right.id)
        )
      : candidateTargets

  const invalidateGrants = () =>
    queryClient.invalidateQueries({
      queryKey: knowledgeBaseQueryKeys.grants(knowledgeBaseId),
    })

  const shareMutation = useMutation({
    mutationFn: async (selected: KnowledgeShareTarget[]) => {
      const results = await Promise.allSettled(
        selected.map((target) => createKnowledgeGrant(knowledgeBaseId, target))
      )
      const failures: Array<{
        target: KnowledgeShareTarget
        error: unknown
      }> = []
      results.forEach((result, index) => {
        const target = selected[index]
        if (result.status === "rejected" && target) {
          failures.push({ target, error: result.reason })
        }
      })
      return failures
    },
    onMutate: () => setError(undefined),
    onSuccess: async (failures) => {
      setSelectedTargets(failures.map((failure) => failure.target))
      setSearch("")
      await invalidateGrants()
      if (failures[0]) setError(getErrorMessage(failures[0].error, t))
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError, t)),
  })

  const revokeMutation = useMutation({
    mutationFn: (grant: KnowledgeGrant) =>
      revokeKnowledgeGrant(knowledgeBaseId, grant.id),
    onMutate: () => setError(undefined),
    onSuccess: async (result, grant) => {
      notify.success(
        getGrantRevocationMessage(
          result,
          grant.target.name,
          normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN",
          t
        ),
        { id: "knowledge-grant-revoked" }
      )
      await invalidateGrants()
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError, t)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("common.close")}
        className="knowledge-share-dialog sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t("knowledge.share.title")}</DialogTitle>
          <DialogDescription>
            {t("knowledge.share.description")}
          </DialogDescription>
        </DialogHeader>

        {error && <StatusBanner variant="error">{error}</StatusBanner>}

        {canCreateGrant && (
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">
                {t("knowledge.share.targetType")}
              </FieldLegend>
              <FieldDescription>
                {t("knowledge.share.permissionDescription")}
              </FieldDescription>
              <Tabs
                value={targetType}
                onValueChange={(value) => {
                  if (value !== "user" && value !== "group") return
                  setTargetType(value)
                  setSelectedTargets([])
                  setSearch("")
                }}
              >
                <TabsList
                  className="knowledge-share-type-options"
                  aria-label={t("knowledge.share.targetType")}
                >
                  <TabsTrigger value="user">
                    <UserIcon aria-hidden="true" />
                    {t("knowledge.share.user")}
                  </TabsTrigger>
                  <TabsTrigger value="group">
                    <UsersIcon aria-hidden="true" />
                    {t("knowledge.share.group")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">
                {t("knowledge.share.selectTarget")}
              </FieldLegend>
              <Combobox
                items={selectableTargets}
                multiple
                value={selectedTargets}
                inputValue={search}
                disabled={shareMutation.isPending}
                itemToStringLabel={(target) =>
                  [target.name, target.secondary_label]
                    .filter(Boolean)
                    .join(" ")
                }
                itemToStringValue={(target) => target.id}
                isItemEqualToValue={(target, value) => target.id === value.id}
                onInputValueChange={(value) => setSearch(value)}
                onValueChange={setSelectedTargets}
              >
                <ComboboxChips
                  ref={targetSelectorAnchor}
                  className="min-h-9 w-full"
                >
                  <ComboboxValue>
                    {selectedTargets
                      .slice(0, visibleTargetChipLimit)
                      .map((target) => (
                        <ComboboxChip
                          key={target.id}
                          removeLabel={t("knowledge.share.removeTarget", {
                            name: target.name,
                          })}
                        >
                          <span className="max-w-40 truncate">
                            {target.name}
                          </span>
                        </ComboboxChip>
                      ))}
                    {selectedTargets.length > visibleTargetChipLimit && (
                      <Badge
                        variant="secondary"
                        aria-label={t("knowledge.share.additionalTargets", {
                          count:
                            selectedTargets.length - visibleTargetChipLimit,
                        })}
                      >
                        +{selectedTargets.length - visibleTargetChipLimit}
                      </Badge>
                    )}
                  </ComboboxValue>
                  <ComboboxChipsInput
                    aria-label={t("knowledge.share.selectTarget")}
                    disabled={shareMutation.isPending}
                    placeholder={t(
                      targetType === "user"
                        ? "knowledge.share.searchUserPlaceholder"
                        : "knowledge.share.searchGroupPlaceholder"
                    )}
                  />
                </ComboboxChips>
                <ComboboxContent anchor={targetSelectorAnchor}>
                  <ComboboxEmpty>
                    {targets.isLoading
                      ? t("knowledge.share.loadingTargets")
                      : targets.isError
                        ? getErrorMessage(targets.error, t)
                        : t("knowledge.share.noTargets")}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(target: KnowledgeShareTarget) => (
                      <ComboboxItem key={target.id} value={target}>
                        <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
                          <span className="min-w-0 truncate font-medium">
                            {target.name}
                          </span>
                          {target.secondary_label && (
                            <span className="shrink-0 text-muted-foreground">
                              {target.secondary_label}
                            </span>
                          )}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </FieldSet>
          </FieldGroup>
        )}

        <section
          className="knowledge-grants"
          aria-labelledby="knowledge-grants-title"
        >
          <div className="knowledge-grants-header">
            <h3 id="knowledge-grants-title">{t("knowledge.share.active")}</h3>
            <Badge variant="secondary">
              {t("knowledge.share.permissionUse")}
            </Badge>
          </div>
          {grants.isLoading && <LoadingState />}
          {grants.isError && !grants.data && (
            <ErrorState
              message={getErrorMessage(grants.error, t)}
              onRetry={() => void grants.refetch()}
            />
          )}
          {grants.data && grantItems.length === 0 && (
            <EmptyState title={t("knowledge.share.empty")} />
          )}
          {grantItems.length > 0 && (
            <div className="knowledge-grant-list">
              {grantItems.map((grant) => (
                <div key={grant.id} className="knowledge-grant-row">
                  {grant.target_type === "user" ? (
                    <UserIcon aria-hidden="true" />
                  ) : (
                    <UsersIcon aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{grant.target.name}</span>
                    <span className="block truncate text-muted-foreground">
                      {grant.target.email_hint ??
                        t(
                          grant.target_type === "user"
                            ? "knowledge.share.user"
                            : "knowledge.share.group"
                        )}
                    </span>
                  </span>
                  {canRevokeGrant &&
                    grant.can_revoke &&
                    grant.status === "active" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("knowledge.share.revokeNamed", {
                          name: grant.target.name,
                        })}
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(grant)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    )}
                </div>
              ))}
            </div>
          )}
          {grants.isFetchNextPageError && (
            <ErrorState
              message={getErrorMessage(grants.error, t)}
              onRetry={() => void grants.fetchNextPage()}
            />
          )}
          {grants.hasNextPage && !grants.isFetchNextPageError && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={grants.isFetchingNextPage}
                onClick={() => void grants.fetchNextPage()}
              >
                {grants.isFetchingNextPage && (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                )}
                {t("knowledge.loadMore")}
              </Button>
            </div>
          )}
        </section>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.close")}
          </DialogClose>
          {canCreateGrant && (
            <Button
              type="button"
              disabled={selectedTargets.length === 0 || shareMutation.isPending}
              onClick={() => shareMutation.mutate(selectedTargets)}
            >
              {shareMutation.isPending ? (
                <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Share2Icon data-icon="inline-start" aria-hidden="true" />
              )}
              {t("knowledge.share.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getGrantRevocationMessage(
  result: KnowledgeGrantRevocationResult,
  targetName: string,
  locale: SupportedLanguage,
  t: TFunction
) {
  const remaining = result.remaining_access
  if (remaining.subject_type === "user" && !remaining.has_access) {
    return t("knowledge.share.revokeUserRemoved", { name: targetName })
  }
  if (
    remaining.subject_type === "user_group" &&
    remaining.member_access === "none"
  ) {
    return t("knowledge.share.revokeGroupNone", { name: targetName })
  }
  const sourceTypes = (["owner", "direct", "user_group"] as const).filter(
    (sourceType) => remaining.source_types.includes(sourceType)
  )
  const sources = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(
    sourceTypes.map((sourceType) =>
      t(`knowledge.share.remainingSource.${sourceType}`)
    )
  )
  if (remaining.subject_type === "user") {
    return t("knowledge.share.revokeUserRetained", {
      name: targetName,
      sources,
    })
  }
  return t(
    remaining.member_access === "all"
      ? "knowledge.share.revokeGroupAll"
      : "knowledge.share.revokeGroupSome",
    { name: targetName, sources }
  )
}
