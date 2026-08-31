import {
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDownIcon,
  Edit3Icon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { z } from "zod"
import type { TFunction } from "i18next"

import { apiRequest } from "@/api/client"
import {
  automationCreateInputSchema,
  automationListSchema,
  automationPinnedConversationListSchema,
  automationRunNowResultSchema,
  automationSchema,
  modelPreferenceSchema,
  type Automation,
  type AutomationCreateInput,
  type AutomationRunNowResult,
  type AutomationSchedule,
  type ModelPreference,
  type ReasoningEffort,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { DatePicker } from "@/components/forms/date-picker"
import { FieldShell } from "@/components/forms/form-field"
import { TimePicker } from "@/components/forms/time-picker"
import { PageLayout } from "@/components/shell/page-layout"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ConversationOfficeLayout } from "@/features/conversations/conversation-presentation-layout"
import { normalizeLanguage } from "@/i18n"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"
import { formatDateTime, formatRelativeDate } from "@/i18n/date"
import { cn } from "@/lib/utils"

type AutomationForm = {
  title: string
  instruction: string
  targetMode: "existing_task" | "new_task"
  conversationId: string
  frequency: AutomationSchedule["frequency"]
  interval: string
  minute: string
  time: string
  weekdays: string[]
  dayOfMonth: string
  monthOfYear: string
  timeZone: string
  expiresEnabled: boolean
  expiresOn: string
  modelPreferenceEnabled: boolean
  modelId: string
  reasoningEffort: ReasoningEffort
}

type AutomationFilter = "all" | Automation["status"]

type AutomationEditorState =
  { mode: "create" } | { mode: "edit"; automation: Automation }

type AutomationRunNowVariables = {
  automation: Automation
  requestId: string
}

type AutomationListData = z.infer<typeof automationListSchema>
type AutomationPinnedTaskListData = z.infer<
  typeof automationPinnedConversationListSchema
>

const emptySchema = z.unknown()
const automationEditorFormId = "automation-editor-form"
const automationFilterValues = ["all", "active", "paused"] as const
const frequencyValues = ["hourly", "daily", "weekly", "monthly"] as const
const weekdayValues = ["1", "2", "3", "4", "5", "6", "7"] as const
const dayValues = Array.from({ length: 31 }, (_, index) => String(index + 1))
const monthValues = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
] as const

function automationRunNowNotificationId(automationId: string) {
  return `automation-run-now-${automationId}`
}

export function AutomationPage() {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editor, setEditor] = useState<AutomationEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null)
  const [form, setForm] = useState<AutomationForm>(createDefaultForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const filter = readUrlEnum(
    searchParams,
    "status",
    automationFilterValues,
    "all"
  )
  const setFilter = (value: AutomationFilter) => {
    setSearchParams(
      (current) =>
        updateUrlSearchParams(current, {
          status: value === "all" ? null : value,
        }),
      { replace: true }
    )
  }
  const editing = editor?.mode === "edit" ? editor.automation : null

  const automationsQuery = useQuery({
    queryKey: ["automations"],
    queryFn: ({ signal }) =>
      apiRequest("/automations", { schema: automationListSchema, signal }),
  })
  const pinnedTasksQuery = useQuery({
    queryKey: ["automations", "pinned-tasks"],
    enabled: Boolean(editor),
    queryFn: ({ signal }) =>
      apiRequest("/automations/pinned-tasks", {
        schema: automationPinnedConversationListSchema,
        signal,
      }),
  })
  const modelPreferenceQuery = useQuery({
    queryKey: ["me", "model-preference", "automation-editor"],
    queryFn: ({ signal }) =>
      apiRequest("/me/model-preference", {
        schema: modelPreferenceSchema,
        signal,
      }),
    enabled: Boolean(editor),
    retry: false,
  })

  const frequencyItems = useMemo(
    () =>
      frequencyValues.map((value) => ({
        value,
        label: t(`automation.frequency.${value}`),
      })),
    [t]
  )
  const taskItems = useMemo(
    () =>
      (pinnedTasksQuery.data?.items ?? []).map((task) => ({
        value: task.id,
        label: task.title,
      })),
    [pinnedTasksQuery.data?.items]
  )
  const monthItems = useMemo(
    () =>
      monthValues.map((value) => ({
        value,
        label: t("automation.monthOption", { month: Number(value) }),
      })),
    [t]
  )
  const weekdayItems = useMemo(
    () =>
      weekdayValues.map((value) => ({
        value,
        label: t(`automation.weekday.${value}`),
      })),
    [t]
  )
  const dayItems = useMemo(
    () =>
      dayValues.map((value) => ({
        value,
        label: t("automation.dayOption", { day: Number(value) }),
      })),
    [t]
  )
  const automationsByFilter = useMemo(() => {
    const items = automationsQuery.data?.items ?? []
    return {
      all: items,
      active: items.filter((automation) => automation.status === "active"),
      paused: items.filter((automation) => automation.status === "paused"),
    } satisfies Record<AutomationFilter, Automation[]>
  }, [automationsQuery.data?.items])

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["automations"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: (input: AutomationCreateInput) =>
      apiRequest(editing ? `/automations/${editing.id}` : "/automations", {
        method: editing ? "PATCH" : "POST",
        body: input,
        schema: automationSchema,
      }),
    onSuccess: (savedAutomation, input) => {
      queryClient.setQueryData<AutomationListData>(
        ["automations"],
        (current) => ({
          items: [
            savedAutomation,
            ...(current?.items ?? []).filter(
              (automation) => automation.id !== savedAutomation.id
            ),
          ],
        })
      )
      if (input.target.mode === "new_task") {
        queryClient.setQueryData<AutomationPinnedTaskListData>(
          ["automations", "pinned-tasks"],
          (current) =>
            current
              ? {
                  items: [
                    savedAutomation.conversation,
                    ...current.items.filter(
                      (task) => task.id !== savedAutomation.conversation.id
                    ),
                  ],
                }
              : current
        )
        void queryClient.invalidateQueries({
          queryKey: ["conversations", "sidebar"],
          exact: true,
        })
      }
      setEditor(null)
      setForm(createDefaultForm())
      setFormError(null)
      setPageError(null)
    },
    onError: (error) => setFormError(getErrorMessage(error, t)),
  })

  const statusMutation = useMutation({
    mutationFn: (automation: Automation) =>
      apiRequest(`/automations/${automation.id}`, {
        method: "PATCH",
        body: {
          status: automation.status === "active" ? "paused" : "active",
        },
        schema: automationSchema,
      }),
    onSuccess: async () => {
      setPageError(null)
      await invalidate()
    },
    onError: (error) => setPageError(getErrorMessage(error, t)),
  })

  const runNowMutation = useMutation<
    AutomationRunNowResult,
    Error,
    AutomationRunNowVariables
  >({
    mutationFn: ({ automation, requestId }) =>
      apiRequest(`/automations/${automation.id}/run`, {
        method: "POST",
        body: { request_id: requestId },
        schema: automationRunNowResultSchema,
      }),
    onMutate: ({ automation }) => {
      setPageError(null)
      notify.loading(
        t("automation.runNowLoading", { name: automation.title }),
        {
          id: automationRunNowNotificationId(automation.id),
        }
      )
    },
    onSuccess: async (
      result: AutomationRunNowResult,
      { automation }: AutomationRunNowVariables
    ) => {
      notify.success(
        t(
          result.status === "queued"
            ? "automation.runNowQueued"
            : "automation.runNowStarted",
          { name: automation.title }
        ),
        { id: automationRunNowNotificationId(automation.id) }
      )
      await invalidate()
    },
    onError: (error, { automation }) => {
      const message = getErrorMessage(error, t)
      setPageError(message)
      notify.error(message, {
        id: automationRunNowNotificationId(automation.id),
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (automation: Automation) =>
      apiRequest(`/automations/${automation.id}`, {
        method: "DELETE",
        schema: emptySchema,
      }),
    onSuccess: async () => {
      setDeleteTarget(null)
      setPageError(null)
      await invalidate()
    },
    onError: (error) => setPageError(getErrorMessage(error, t)),
  })

  const openCreate = () => {
    setForm(createDefaultForm())
    setFormError(null)
    setEditor({ mode: "create" })
  }

  const openEdit = (automation: Automation) => {
    setForm(formFromAutomation(automation, modelPreferenceQuery.data ?? null))
    setFormError(null)
    setEditor({ mode: "edit", automation })
  }

  const closeEditor = () => {
    setEditor(null)
    setForm(createDefaultForm())
    setFormError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saveMutation.isPending) return
    const parsed = automationCreateInputSchema.safeParse(
      automationInputFromForm(form)
    )
    if (!parsed.success) {
      setFormError(t("automation.validation"))
      return
    }
    saveMutation.mutate(parsed.data)
  }

  return (
    <ConversationOfficeLayout
      resizeLabel={t("automation.resizeEditor")}
      preview={
        editor ? (
          <AutomationEditorPane
            mode={editor.mode}
            formError={formError}
            pending={saveMutation.isPending}
            onClose={closeEditor}
            onSubmit={submit}
            t={t}
          >
            <AutomationFormFields
              form={form}
              setForm={setForm}
              frequencyItems={frequencyItems}
              taskItems={taskItems}
              monthItems={monthItems}
              weekdayItems={weekdayItems}
              dayItems={dayItems}
              pinnedTasksLoading={pinnedTasksQuery.isLoading}
              modelPreference={modelPreferenceQuery.data ?? null}
              modelPreferenceLoading={
                modelPreferenceQuery.isLoading ||
                modelPreferenceQuery.isFetching
              }
              t={t}
            />
          </AutomationEditorPane>
        ) : undefined
      }
    >
      <PageLayout
        title={t("automation.title")}
        actions={
          <Button type="button" onClick={openCreate}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            {t("automation.create")}
          </Button>
        }
      >
        <div
          className="min-w-0"
          data-slot="automation-list"
          data-testid="automation-workspace"
        >
          {pageError && (
            <StatusBanner variant="error">{pageError}</StatusBanner>
          )}
          {automationsQuery.isLoading && <LoadingState />}
          {automationsQuery.isError && (
            <ErrorState
              message={getErrorMessage(automationsQuery.error, t)}
              onRetry={() => void automationsQuery.refetch()}
            />
          )}
          {automationsQuery.data?.items.length === 0 && (
            <EmptyState title={t("automation.empty")} />
          )}

          {(automationsQuery.data?.items.length ?? 0) > 0 && (
            <Tabs
              value={filter}
              onValueChange={(value) => {
                if (isAutomationFilter(value)) setFilter(value)
              }}
              className="gap-4"
            >
              <TabsList aria-label={t("automation.filterLabel")}>
                {automationFilterValues.map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {t(`automation.filter.${value}`)}
                  </TabsTrigger>
                ))}
              </TabsList>

              {automationFilterValues.map((value) => (
                <TabsContent key={value} value={value}>
                  {automationsByFilter[value].length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
                      <p className="font-medium">
                        {t("automation.filteredEmpty", {
                          filter: t(`automation.filter.${value}`),
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => setFilter("all")}
                      >
                        {t("automation.showAll")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col" role="list">
                      {automationsByFilter[value].map((automation, index) => {
                        const isActive = automation.status === "active"
                        const nextRun =
                          isActive && automation.next_run_at
                            ? formatRelativeDate(
                                automation.next_run_at,
                                language
                              )
                            : null
                        const lastRunFailure =
                          automation.last_run_status === "failed"
                            ? t(
                                automation.last_error_code ===
                                  "AUTOMATION_EMPTY_RESULT"
                                  ? "automation.lastRunEmptyResult"
                                  : "automation.lastRunFailed"
                              )
                            : null

                        return (
                          <article key={automation.id} role="listitem">
                            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 sm:px-0">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="rounded-full"
                                      disabled={statusMutation.isPending}
                                      aria-label={t(
                                        isActive
                                          ? "automation.pauseNamed"
                                          : "automation.resumeNamed",
                                        { name: automation.title }
                                      )}
                                      onClick={() =>
                                        statusMutation.mutate(automation)
                                      }
                                    />
                                  }
                                >
                                  <span
                                    className={cn(
                                      "flex size-4 items-center justify-center rounded-full border",
                                      isActive
                                        ? "border-foreground/55"
                                        : "border-muted-foreground/30"
                                    )}
                                    aria-hidden="true"
                                  >
                                    {isActive && (
                                      <span className="size-1 rounded-full bg-foreground/55" />
                                    )}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t(
                                    isActive
                                      ? "automation.pause"
                                      : "automation.resume"
                                  )}
                                </TooltipContent>
                              </Tooltip>

                              <div className="min-w-0">
                                <h2 className="truncate text-sm font-medium">
                                  {automation.title}
                                </h2>
                                <span className="sr-only">
                                  {t(`automation.status.${automation.status}`)}
                                </span>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                                  <span>
                                    {formatSchedule(automation.schedule, t)}
                                  </span>
                                  {lastRunFailure && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-destructive">
                                        {lastRunFailure}
                                      </span>
                                    </>
                                  )}
                                  <span aria-hidden="true">·</span>
                                  <span
                                    title={
                                      nextRun
                                        ? formatOptionalDate(
                                            automation.next_run_at,
                                            language,
                                            t
                                          )
                                        : undefined
                                    }
                                  >
                                    {nextRun
                                      ? t("automation.nextRunRelative", {
                                          relative: nextRun,
                                        })
                                      : t("automation.status.paused")}
                                  </span>
                                </div>
                              </div>

                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={t(
                                        "automation.moreActionsNamed",
                                        {
                                          name: automation.title,
                                        }
                                      )}
                                    />
                                  }
                                >
                                  <MoreHorizontalIcon aria-hidden="true" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-44"
                                >
                                  <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      disabled={runNowMutation.isPending}
                                      onClick={() =>
                                        runNowMutation.mutate({
                                          automation,
                                          requestId: crypto.randomUUID(),
                                        })
                                      }
                                    >
                                      <PlayIcon aria-hidden="true" />
                                      {t("automation.runNow")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      render={
                                        <Link
                                          to={`/conversations/${automation.conversation.id}`}
                                        />
                                      }
                                    >
                                      <ExternalLinkIcon aria-hidden="true" />
                                      {t("automation.openTask")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => openEdit(automation)}
                                    >
                                      <Edit3Icon aria-hidden="true" />
                                      {t("common.edit")}
                                    </DropdownMenuItem>
                                  </DropdownMenuGroup>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() =>
                                        setDeleteTarget(automation)
                                      }
                                    >
                                      <Trash2Icon aria-hidden="true" />
                                      {t("common.delete")}
                                    </DropdownMenuItem>
                                  </DropdownMenuGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            {index < automationsByFilter[value].length - 1 && (
                              <Separator />
                            )}
                          </article>
                        )
                      })}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("automation.deleteTitle")}
          description={t("automation.deleteDescription", {
            name: deleteTarget?.title ?? "",
          })}
          confirmLabel={t("common.delete")}
          destructive
          pending={deleteMutation.isPending}
          onConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget)
          }}
        />
      </PageLayout>
    </ConversationOfficeLayout>
  )
}

function AutomationEditorPane({
  mode,
  formError,
  pending,
  onClose,
  onSubmit,
  t,
  children,
}: {
  mode: AutomationEditorState["mode"]
  formError: string | null
  pending: boolean
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  t: TFunction
  children: ReactNode
}) {
  const creating = mode === "create"

  return (
    <aside
      className="office-preview-pane automation-editor-pane"
      aria-labelledby="automation-editor-panel-title"
      data-mode={mode}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h2
            id="automation-editor-panel-title"
            className="text-sm font-semibold"
          >
            {t(creating ? "automation.createTitle" : "automation.editTitle")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("automation.editorDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.close")}
          onClick={onClose}
          disabled={pending}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        {formError && <StatusBanner variant="error">{formError}</StatusBanner>}
        <form
          id={automationEditorFormId}
          className="min-w-0"
          onSubmit={onSubmit}
        >
          {children}
        </form>
      </div>
      <Separator />
      <footer className="flex shrink-0 justify-end gap-2 px-5 py-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={pending}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          form={automationEditorFormId}
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending && <Spinner data-icon="inline-start" />}
          {t(creating ? "common.create" : "common.save")}
        </Button>
      </footer>
    </aside>
  )
}

function AutomationFormFields({
  form,
  setForm,
  frequencyItems,
  taskItems,
  monthItems,
  weekdayItems,
  dayItems,
  pinnedTasksLoading,
  modelPreference,
  modelPreferenceLoading,
  t,
}: {
  form: AutomationForm
  setForm: Dispatch<SetStateAction<AutomationForm>>
  frequencyItems: Array<{
    value: AutomationSchedule["frequency"]
    label: string
  }>
  taskItems: Array<{ value: string; label: string }>
  monthItems: Array<{ value: string; label: string }>
  weekdayItems: Array<{ value: string; label: string }>
  dayItems: Array<{ value: string; label: string }>
  pinnedTasksLoading: boolean
  modelPreference: ModelPreference | null
  modelPreferenceLoading: boolean
  t: TFunction
}) {
  function updateForm<Key extends keyof AutomationForm>(
    key: Key,
    value: AutomationForm[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <FieldGroup>
      <FieldShell id="automation-title" label={t("automation.name")}>
        <Input
          id="automation-title"
          value={form.title}
          maxLength={160}
          autoComplete="off"
          required
          onChange={(event) => updateForm("title", event.target.value)}
        />
      </FieldShell>

      <FieldShell
        id="automation-instruction"
        label={t("automation.instruction")}
        hint={t("automation.instructionHint")}
      >
        <Textarea
          id="automation-instruction"
          value={form.instruction}
          className="max-h-80 min-h-28 overflow-y-auto"
          required
          onChange={(event) => updateForm("instruction", event.target.value)}
        />
      </FieldShell>

      <Field className="gap-2">
        <FieldLabel>{t("automation.runIn")}</FieldLabel>
        <ToggleGroup
          value={[form.targetMode]}
          variant="outline"
          spacing={0}
          aria-label={t("automation.runIn")}
          onValueChange={(values) => {
            const value = values[0]
            if (value === "existing_task" || value === "new_task") {
              updateForm("targetMode", value)
            }
          }}
        >
          <ToggleGroupItem value="existing_task">
            {t("automation.existingTask")}
          </ToggleGroupItem>
          <ToggleGroupItem value="new_task">
            {t("automation.newTask")}
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {t(
            form.targetMode === "new_task"
              ? "automation.newTaskHint"
              : "automation.existingTaskHint"
          )}
        </FieldDescription>
      </Field>

      {form.targetMode === "existing_task" && (
        <FieldShell
          id="automation-task"
          label={t("automation.task")}
          hint={
            taskItems.length === 0 && !pinnedTasksLoading
              ? t("automation.noPinnedTasks")
              : undefined
          }
        >
          <Select
            items={taskItems}
            value={form.conversationId || null}
            onValueChange={(value) => updateForm("conversationId", value ?? "")}
          >
            <SelectTrigger id="automation-task" className="w-full">
              <SelectValue placeholder={t("automation.selectTask")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {taskItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      <div className="rounded-[min(var(--radius-4xl),24px)] border border-[color:var(--app-border)] p-4">
        <FieldGroup className="gap-4">
          <FieldShell id="automation-frequency" label={t("automation.repeat")}>
            <Select
              items={frequencyItems}
              value={form.frequency}
              onValueChange={(value) => {
                if (isFrequency(value)) updateForm("frequency", value)
              }}
            >
              <SelectTrigger id="automation-frequency" className="w-full">
                <SelectValue>
                  {t(`automation.frequency.${form.frequency}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {frequencyItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>

          {form.frequency === "hourly" && (
            <FieldShell
              id="automation-minute"
              label={t("automation.minuteOfHour")}
              hint={t("automation.minuteOfHourHint")}
            >
              <Input
                id="automation-minute"
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                value={form.minute}
                required
                onChange={(event) => updateForm("minute", event.target.value)}
              />
            </FieldShell>
          )}

          {form.frequency === "weekly" && (
            <FieldShell
              id="automation-weekday"
              label={t("automation.weekdays")}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      id="automation-weekday"
                      type="button"
                      variant="input"
                      className="w-full justify-between text-left"
                      aria-label={t("automation.weekdays")}
                    />
                  }
                >
                  <span className="min-w-0 flex-1 truncate">
                    {weekdayItems
                      .filter((item) => form.weekdays.includes(item.value))
                      .map((item) => item.label)
                      .join(t("automation.weekdaySeparator"))}
                  </span>
                  <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    {weekdayItems.map((item) => {
                      const checked = form.weekdays.includes(item.value)
                      return (
                        <DropdownMenuCheckboxItem
                          key={item.value}
                          checked={checked}
                          disabled={checked && form.weekdays.length === 1}
                          onCheckedChange={(nextChecked) => {
                            const selected = new Set(form.weekdays)
                            if (nextChecked) selected.add(item.value)
                            else selected.delete(item.value)
                            updateForm(
                              "weekdays",
                              weekdayItems
                                .filter((option) => selected.has(option.value))
                                .map((option) => option.value)
                                .filter(isWeekdayValue)
                            )
                          }}
                        >
                          {item.label}
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldShell>
          )}

          {form.frequency === "monthly" && (
            <FieldShell
              id="automation-day-of-month"
              label={t("automation.dayOfMonth")}
              hint={t("automation.invalidMonthDayHint")}
            >
              <Select
                items={dayItems}
                value={form.dayOfMonth}
                onValueChange={(value) =>
                  updateForm("dayOfMonth", value ?? "1")
                }
              >
                <SelectTrigger id="automation-day-of-month" className="w-full">
                  <SelectValue>
                    {t("automation.dayOption", {
                      day: Number(form.dayOfMonth),
                    })}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {dayItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>
          )}

          {form.frequency === "yearly" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell
                id="automation-month-of-year"
                label={t("automation.monthOfYear")}
              >
                <Select
                  items={monthItems}
                  value={form.monthOfYear}
                  onValueChange={(value) =>
                    updateForm("monthOfYear", value ?? "1")
                  }
                >
                  <SelectTrigger
                    id="automation-month-of-year"
                    className="w-full"
                  >
                    <SelectValue>
                      {t("automation.monthOption", {
                        month: Number(form.monthOfYear),
                      })}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {monthItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldShell>
              <FieldShell
                id="automation-year-day"
                label={t("automation.dayOfMonth")}
              >
                <Select
                  items={dayItems}
                  value={form.dayOfMonth}
                  onValueChange={(value) =>
                    updateForm("dayOfMonth", value ?? "1")
                  }
                >
                  <SelectTrigger id="automation-year-day" className="w-full">
                    <SelectValue>
                      {t("automation.dayOption", {
                        day: Number(form.dayOfMonth),
                      })}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {dayItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldShell>
            </div>
          )}

          {form.frequency !== "hourly" && (
            <Field className="form-field gap-1.5">
              <FieldLabel id="automation-time-label" className="form-label">
                {t("automation.time")}
              </FieldLabel>
              <TimePicker
                id="automation-time"
                value={form.time}
                labelledBy="automation-time-label"
                hourLabel={t("automation.hour")}
                minuteLabel={t("automation.minute")}
                onValueChange={(value) => updateForm("time", value)}
              />
            </Field>
          )}

          <FieldDescription>
            {t("automation.timeZone", { timeZone: form.timeZone })}
          </FieldDescription>
        </FieldGroup>
      </div>

      <Field className="gap-3">
        <FieldLabel
          htmlFor="automation-expires-enabled"
          className="flex cursor-pointer items-start gap-3"
        >
          <Checkbox
            id="automation-expires-enabled"
            className="mt-0.5"
            checked={form.expiresEnabled}
            onCheckedChange={(checked) => {
              const enabled = checked === true
              setForm((current) => ({
                ...current,
                expiresEnabled: enabled,
                expiresOn: enabled ? current.expiresOn : "",
              }))
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {t("automation.expiresEnabled")}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("automation.expiresEnabledHint")}
            </span>
          </span>
        </FieldLabel>

        {form.expiresEnabled && (
          <FieldShell
            id="automation-expires-on"
            label={t("automation.expiresOn")}
          >
            <DatePicker
              id="automation-expires-on"
              value={form.expiresOn}
              placeholder={t("automation.expiresOnPlaceholder")}
              clearLabel={t("automation.clearExpiresOn")}
              clearable={false}
              onValueChange={(value) => updateForm("expiresOn", value)}
            />
          </FieldShell>
        )}
      </Field>

      <Field className="gap-3">
        <FieldLabel
          htmlFor="automation-model-override-enabled"
          className="flex cursor-pointer items-start gap-3"
        >
          <Checkbox
            id="automation-model-override-enabled"
            className="mt-0.5"
            checked={form.modelPreferenceEnabled}
            onCheckedChange={(checked) => {
              const enabled = checked === true
              setForm((current) => {
                if (!enabled) {
                  return {
                    ...current,
                    modelPreferenceEnabled: false,
                    modelId: "",
                    reasoningEffort: resolveDefaultReasoningEffort(
                      current.modelId,
                      modelPreference
                    ),
                  }
                }
                const fallbackModelId =
                  current.modelId || modelPreference?.selected_model || ""
                return {
                  ...current,
                  modelPreferenceEnabled: true,
                  modelId: fallbackModelId,
                  reasoningEffort: resolveDefaultReasoningEffort(
                    fallbackModelId,
                    modelPreference
                  ),
                }
              })
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {t("automation.modelOverride")}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("automation.modelOverrideHint")}
            </span>
          </span>
        </FieldLabel>

        {form.modelPreferenceEnabled && (
          <AutomationModelPreferenceFields
            form={form}
            setForm={setForm}
            modelPreference={modelPreference}
            modelPreferenceLoading={modelPreferenceLoading}
            t={t}
          />
        )}
      </Field>
    </FieldGroup>
  )
}

function AutomationModelPreferenceFields({
  form,
  setForm,
  modelPreference,
  modelPreferenceLoading,
  t,
}: {
  form: AutomationForm
  setForm: Dispatch<SetStateAction<AutomationForm>>
  modelPreference: ModelPreference | null
  modelPreferenceLoading: boolean
  t: TFunction
}) {
  if (
    !modelPreferenceLoading &&
    (!modelPreference ||
      !modelPreference.configured ||
      modelPreference.models.length === 0)
  ) {
    return (
      <FieldDescription>
        {t("automation.modelOverrideUnavailable")}
      </FieldDescription>
    )
  }
  const availableModels = modelPreference?.models ?? []
  const selectedModel = availableModels.find(
    (model) => model.id === form.modelId
  )
  const supportedEfforts = selectedModel?.supported_reasoning_efforts ?? []
  const effortItems: Array<{ value: ReasoningEffort; label: string }> =
    supportedEfforts.map((effort) => ({
      value: effort,
      label: t(`reasoningEffort.${effort}`),
    }))

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldShell
        id="automation-model-id"
        label={t("automation.modelLabel")}
        hint={
          modelPreferenceLoading
            ? t("automation.modelOverrideLoading")
            : undefined
        }
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                id="automation-model-id"
                type="button"
                variant="input"
                className="w-full justify-between text-left"
                aria-label={t("automation.modelLabel")}
                disabled={
                  modelPreferenceLoading || availableModels.length === 0
                }
              />
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {selectedModel?.display_name ?? t("automation.modelNotSelected")}
            </span>
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-max max-w-[calc(100vw-1rem)] min-w-48"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t("automation.modelLabel")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={form.modelId}
                onValueChange={(value) => {
                  setForm((current) => ({
                    ...current,
                    modelId: value,
                    reasoningEffort: resolveDefaultReasoningEffort(
                      value,
                      modelPreference
                    ),
                  }))
                }}
              >
                {availableModels.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    closeOnClick={false}
                    className="min-h-9 text-sm"
                  >
                    <span className="max-w-[min(20rem,calc(100vw-5rem))] truncate">
                      {model.display_name}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </FieldShell>

      <FieldShell
        id="automation-reasoning-effort"
        label={t("automation.reasoningEffortLabel")}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                id="automation-reasoning-effort"
                type="button"
                variant="input"
                className="w-full justify-between text-left"
                aria-label={t("automation.reasoningEffortLabel")}
                disabled={effortItems.length === 0}
              />
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {form.reasoningEffort
                ? t(`reasoningEffort.${form.reasoningEffort}`)
                : t("automation.reasoningEffortNotSelected")}
            </span>
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-max max-w-[calc(100vw-1rem)] min-w-36"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t("automation.reasoningEffortLabel")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={form.reasoningEffort}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    reasoningEffort: value as ReasoningEffort,
                  }))
                }
              >
                {effortItems.map((item) => (
                  <DropdownMenuRadioItem
                    key={item.value}
                    value={item.value}
                    closeOnClick={false}
                    className="min-h-9 text-sm"
                  >
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </FieldShell>
    </div>
  )
}

function resolveDefaultReasoningEffort(
  modelId: string,
  preference: ModelPreference | null
): ReasoningEffort {
  if (!preference || !modelId) {
    return "medium"
  }
  const model = preference.models.find((candidate) => candidate.id === modelId)
  return model?.default_reasoning_effort ?? "medium"
}

function createDefaultForm(): AutomationForm {
  return {
    title: "",
    instruction: "",
    targetMode: "existing_task",
    conversationId: "",
    frequency: "daily",
    interval: "1",
    minute: "0",
    time: "09:00",
    weekdays: ["1"],
    dayOfMonth: "1",
    monthOfYear: "1",
    timeZone: detectedTimeZone(),
    expiresEnabled: false,
    expiresOn: "",
    modelPreferenceEnabled: false,
    modelId: "",
    reasoningEffort: "medium",
  }
}

function formFromAutomation(
  automation: Automation,
  modelPreference: ModelPreference | null
): AutomationForm {
  const form = createDefaultForm()
  const schedule = automation.schedule
  form.title = automation.title
  form.instruction = automation.instruction
  form.targetMode = "existing_task"
  form.conversationId = automation.conversation.id
  form.frequency = schedule.frequency
  form.interval = String(schedule.interval)
  form.timeZone = schedule.time_zone
  form.expiresEnabled = automation.expires_on !== null
  form.expiresOn = automation.expires_on ?? ""
  if (schedule.frequency === "hourly") {
    form.minute = String(schedule.minute)
  } else {
    form.time = schedule.time
  }
  if (schedule.frequency === "weekly") {
    form.weekdays = schedule.weekdays.map(String)
  }
  if (schedule.frequency === "monthly" || schedule.frequency === "yearly") {
    form.dayOfMonth = String(schedule.day_of_month)
  }
  if (schedule.frequency === "yearly") {
    form.monthOfYear = String(schedule.month_of_year)
  }
  if (automation.model_preference) {
    form.modelPreferenceEnabled = true
    form.modelId = automation.model_preference.model_id
    form.reasoningEffort = automation.model_preference.reasoning_effort
  } else if (
    modelPreference?.configured &&
    modelPreference.selected_model &&
    modelPreference.selected_reasoning_effort
  ) {
    form.modelId = modelPreference.selected_model
    form.reasoningEffort = modelPreference.selected_reasoning_effort
  }
  return form
}

function automationInputFromForm(form: AutomationForm): unknown {
  const scheduleBase = {
    frequency: form.frequency,
    interval: Number(form.interval),
    time_zone: form.timeZone,
  }
  const schedule =
    form.frequency === "hourly"
      ? { ...scheduleBase, frequency: "hourly", minute: Number(form.minute) }
      : form.frequency === "weekly"
        ? {
            ...scheduleBase,
            frequency: "weekly",
            weekdays: form.weekdays.map(Number),
            time: form.time,
          }
        : form.frequency === "monthly"
          ? {
              ...scheduleBase,
              frequency: "monthly",
              day_of_month: Number(form.dayOfMonth),
              time: form.time,
            }
          : form.frequency === "yearly"
            ? {
                ...scheduleBase,
                frequency: "yearly",
                month_of_year: Number(form.monthOfYear),
                day_of_month: Number(form.dayOfMonth),
                time: form.time,
              }
            : { ...scheduleBase, frequency: "daily", time: form.time }
  return {
    title: form.title,
    instruction: form.instruction,
    target:
      form.targetMode === "new_task"
        ? { mode: "new_task" }
        : {
            mode: "existing_task",
            conversation_id: form.conversationId,
          },
    schedule,
    expires_on: form.expiresEnabled ? form.expiresOn : null,
    model_preference: form.modelPreferenceEnabled
      ? {
          model_id: form.modelId,
          reasoning_effort: form.reasoningEffort,
        }
      : null,
  }
}

function formatSchedule(schedule: AutomationSchedule, t: TFunction): string {
  const interval = schedule.interval
  switch (schedule.frequency) {
    case "hourly":
      return t("automation.schedule.hourly", {
        interval,
        minute: schedule.minute,
      })
    case "daily":
      return t("automation.schedule.daily", { interval, time: schedule.time })
    case "weekly":
      return t("automation.schedule.weekly", {
        interval,
        time: schedule.time,
        weekdays: schedule.weekdays
          .map((weekday) => t(`automation.weekday.${weekday}`))
          .join(t("automation.weekdaySeparator")),
      })
    case "monthly":
      return t("automation.schedule.monthly", {
        interval,
        day: schedule.day_of_month,
        time: schedule.time,
      })
    case "yearly":
      return t("automation.schedule.yearly", {
        interval,
        month: schedule.month_of_year,
        day: schedule.day_of_month,
        time: schedule.time,
      })
  }
}

function formatOptionalDate(
  value: string | null,
  language: "zh-CN" | "en-US",
  t: TFunction
): string {
  return value ? formatDateTime(value, language) : t("common.notAvailable")
}

function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function isFrequency(value: unknown): value is AutomationSchedule["frequency"] {
  return frequencyValues.some((frequency) => frequency === value)
}

function isAutomationFilter(value: unknown): value is AutomationFilter {
  return automationFilterValues.some((filter) => filter === value)
}

function isWeekdayValue(
  value: string | null
): value is (typeof weekdayValues)[number] {
  return weekdayValues.some((weekday) => weekday === value)
}
