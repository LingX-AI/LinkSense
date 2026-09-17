import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { Fragment, useId, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CheckIcon, CopyIcon } from "lucide-react"
import { interactiveDependencyTypeSchema } from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import {
  buildResourceDeclaration,
  declarationResourceKey,
  loadDeclarationResources,
} from "./interactive-declaration"

export function InteractiveDeclarationDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const query = useQuery({
    queryKey: ["interactive-dependency-options", "declaration"],
    queryFn: ({ signal }) => loadDeclarationResources(signal),
  })
  const resources = query.data ?? []
  const visible = resources.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  )
  const chosen = resources.filter((item) =>
    selected.has(declarationResourceKey(item))
  )
  const declaration = buildResourceDeclaration(chosen)
  const json = declaration.success
    ? JSON.stringify({ dependencies: declaration.data }, null, 2)
    : ""
  const ready = query.isSuccess && !query.isFetching
  const copy = useMutation({
    mutationFn: async () => {
      await navigator.clipboard.writeText(json)
      return json
    },
  })
  const copyDisabled =
    !ready || !chosen.length || !declaration.success || copy.isPending
  const copied = copy.isSuccess && copy.data === json
  const select = (keys: string[], checked: boolean) => {
    copy.reset()
    setSelected((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (checked) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-w-6xl lg:grid lg:grid-rows-[auto_minmax(0,1fr)_auto]"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("applications.declaration.title")}</DialogTitle>
          <DialogDescription>
            {t("applications.declaration.purpose")}
          </DialogDescription>
        </DialogHeader>
        <div
          data-slot="declaration-body"
          className={dialogBodyStyles(
            "lg:grid lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
          )}
        >
          <div
            data-slot="declaration-columns"
            className="grid min-h-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch"
          >
            <FieldGroup
              data-slot="declaration-resources"
              className="min-h-0 min-w-0"
            >
              {query.isPending && <LoadingState />}
              {query.isError && (
                <ErrorState
                  message={getErrorMessage(query.error, t)}
                  onRetry={() => void query.refetch()}
                />
              )}
              {query.isSuccess && (
                <>
                  <Field className="shrink-0">
                    <FieldLabel htmlFor={`${id}-search`}>
                      {t("applications.declaration.search")}
                    </FieldLabel>
                    <Input
                      id={`${id}-search`}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </Field>
                  {visible.length === 0 && (
                    <EmptyState
                      title={t(
                        resources.length
                          ? "applications.resourceSearchEmpty"
                          : "applications.declaration.empty"
                      )}
                    />
                  )}
                  <FieldGroup
                    data-slot="declaration-resource-list"
                    role="region"
                    aria-label={t("applications.declaration.title")}
                    tabIndex={0}
                    className="max-h-[45dvh] min-h-0 [scrollbar-gutter:stable] gap-3 overflow-y-auto overscroll-contain rounded-sm px-1 py-1 pr-3 *:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring lg:max-h-none lg:flex-1"
                  >
                    {interactiveDependencyTypeSchema.options
                      .filter((type) =>
                        visible.some((item) => item.type === type)
                      )
                      .map((type, index) => {
                        const group = visible.filter(
                          (item) => item.type === type
                        )
                        if (!group.length) return null
                        const allChecked = group.every((item) =>
                          selected.has(declarationResourceKey(item))
                        )
                        const someChecked = group.some((item) =>
                          selected.has(declarationResourceKey(item))
                        )
                        const selectLabel = t(
                          search.trim()
                            ? "applications.declaration.selectTypeResults"
                            : "applications.declaration.selectType",
                          {
                            type: t(`applications.dependencies.types.${type}`),
                          }
                        )
                        return (
                          <Fragment key={type}>
                            {index > 0 && <Separator />}
                            <FieldSet>
                              <FieldLegend
                                variant="label"
                                className="mb-3 flex w-full flex-wrap items-center justify-start gap-x-4 gap-y-2"
                              >
                                <span>
                                  {t(`applications.dependencies.types.${type}`)}
                                </span>
                                <span className="flex items-center gap-2">
                                  <Checkbox
                                    id={`${id}-${type}-all`}
                                    checked={allChecked}
                                    indeterminate={someChecked && !allChecked}
                                    disabled={!ready || copy.isPending}
                                    onCheckedChange={(checked) =>
                                      select(
                                        group.map(declarationResourceKey),
                                        checked
                                      )
                                    }
                                  />
                                  <FieldLabel htmlFor={`${id}-${type}-all`}>
                                    <span className="sr-only">
                                      {selectLabel}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="text-xs font-normal text-muted-foreground"
                                    >
                                      {t(
                                        search.trim()
                                          ? "applications.declaration.selectResults"
                                          : "applications.declaration.selectAll"
                                      )}
                                    </span>
                                  </FieldLabel>
                                </span>
                                <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                                  {t("applications.declaration.groupSelected", {
                                    count: group.filter((item) =>
                                      selected.has(declarationResourceKey(item))
                                    ).length,
                                    total: group.length,
                                  })}
                                </span>
                              </FieldLegend>
                              <FieldGroup className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {group.map((resource) => {
                                  const key = declarationResourceKey(resource)
                                  return (
                                    <Field
                                      key={key}
                                      orientation="horizontal"
                                      data-disabled={!ready || copy.isPending}
                                    >
                                      <FieldLabel
                                        htmlFor={`${id}-${key}`}
                                        className="min-h-10 w-full min-w-0 cursor-pointer items-center rounded-xl border border-[color:var(--app-border)] px-3 py-2 transition-colors hover:bg-muted/50 has-data-[checked]:bg-muted/50 has-data-[disabled]:cursor-not-allowed"
                                      >
                                        <Checkbox
                                          id={`${id}-${key}`}
                                          checked={selected.has(key)}
                                          disabled={!ready || copy.isPending}
                                          onCheckedChange={(checked) =>
                                            select([key], checked)
                                          }
                                        />
                                        <span className="min-w-0 wrap-anywhere">
                                          {resource.name}
                                        </span>
                                      </FieldLabel>
                                    </Field>
                                  )
                                })}
                              </FieldGroup>
                            </FieldSet>
                          </Fragment>
                        )
                      })}
                  </FieldGroup>
                  {!declaration.success && (
                    <StatusBanner variant="warning" className="shrink-0">
                      {t("applications.declaration.invalid")}
                    </StatusBanner>
                  )}
                </>
              )}
            </FieldGroup>
            {query.isSuccess && (
              <Field
                data-slot="declaration-preview"
                className="min-h-0 min-w-0"
              >
                <FieldLabel htmlFor={`${id}-preview`}>
                  {t("applications.declaration.preview")}
                </FieldLabel>
                <InputGroup
                  aria-label={t("applications.declaration.preview")}
                  className="min-h-0 overflow-hidden lg:flex-1"
                >
                  <InputGroupTextarea
                    id={`${id}-preview`}
                    className="field-sizing-fixed h-64 max-h-[45dvh] flex-none overflow-auto overscroll-contain px-4 pb-4 font-mono text-xs leading-6 md:text-xs lg:h-0 lg:max-h-none lg:min-h-0 lg:flex-1"
                    readOnly
                    wrap="off"
                    spellCheck={false}
                    value={json}
                  />
                  <InputGroupAddon
                    align="block-start"
                    className="justify-end px-3"
                  >
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t("common.copy")}
                      title={t(
                        copied
                          ? "common.copied"
                          : "applications.declaration.copy"
                      )}
                      disabled={copyDisabled}
                      aria-busy={copy.isPending || undefined}
                      onClick={() => copy.mutate()}
                    >
                      {copy.isPending ? (
                        <Spinner />
                      ) : copied ? (
                        <CheckIcon aria-hidden="true" />
                      ) : (
                        <CopyIcon aria-hidden="true" />
                      )}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription size="sm">
                  {t("applications.declaration.mergeHint")}
                </FieldDescription>
                {copy.isError && (
                  <StatusBanner variant="error">
                    {t("applications.declaration.copyFailed")}
                  </StatusBanner>
                )}
              </Field>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FieldDescription aria-live="polite">
            {t("applications.declaration.selected", { count: chosen.length })}
          </FieldDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button
              disabled={copyDisabled}
              onClick={() =>
                copy.mutate(undefined, {
                  onSuccess: () => notify.success(t("common.copied")),
                })
              }
            >
              <CopyIcon data-icon="inline-start" />
              {t("applications.declaration.copy")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
