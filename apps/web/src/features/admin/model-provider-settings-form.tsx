import { useId, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { arrayMove } from "@dnd-kit/sortable"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ManagedPricedModel } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import {
  modelProviderSettingsUpdateResultSchema,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import {
  MILLION_TOKEN_QUOTA_INPUT_PATTERN,
  millionTokenQuotaInputToTokenLimit,
  tokenLimitToMillionTokenQuotaInput,
} from "@/lib/token-quota"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ModelEditor, ChannelEditor } from "./model-channel-editors"
import { ModelSettingsSelect } from "./model-settings-fields"
import { ModelSettingsTable } from "./model-settings-table"
import {
  isSettingsDraftValid,
  settingsDraft,
  toSettingsProviderUpdate,
  type ModelChannel,
} from "./model-settings-draft"
import { useModelSettings } from "./use-model-settings"

type EditorSelection =
  | { kind: "channel"; channel: ModelChannel | null }
  | { kind: "model"; channel: ModelChannel; model: ManagedPricedModel | null }

export function ModelProviderSettingsForm({
  settings: initial,
}: {
  settings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const id = useId()
  const { settings, pending, error, execute, clearError } =
    useModelSettings(initial)
  const [selectedId, setSelectedId] = useState(initial.providers[0]?.id ?? "")
  const [editor, setEditor] = useState<EditorSelection | null>(null)
  const [deletion, setDeletion] = useState<
    | { kind: "model"; model: ManagedPricedModel }
    | { kind: "channel"; channel: ModelChannel }
    | null
  >(null)
  const channel =
    settings.providers.find((provider) => provider.id === selectedId) ??
    settings.providers[0]
  const channelIndex = settings.providers.findIndex(
    (provider) => provider.id === channel?.id
  )
  const disabled = initial.management_enabled === false || pending
  const modelCount = settings.providers.reduce(
    (count, provider) => count + provider.models.length,
    0
  )
  const providerName = (provider: ModelChannel, index: number) =>
    provider.name ??
    t("admin.modelProvider.providerTitle", { index: index + 1 })
  function openEditor(selection: EditorSelection): void {
    clearError()
    setEditor(selection)
  }
  function closeEditor(): void {
    setEditor(null)
    clearError()
  }
  function moveChannel(direction: -1 | 1): void {
    const target = channelIndex + direction
    if (
      disabled ||
      channelIndex < 0 ||
      target < 0 ||
      target >= settings.providers.length
    )
      return
    const draft = settingsDraft(settings)
    draft.providers = arrayMove(draft.providers, channelIndex, target)
    execute({ kind: "save", draft })
  }
  return (
    <section
      className="flex min-w-0 flex-col gap-6"
      aria-labelledby={`${id}-title`}
      aria-busy={pending || undefined}
    >
      {error && !editor && !deletion && (
        <StatusBanner variant="error">{error}</StatusBanner>
      )}
      <SettingsSectionHeader
        id={`${id}-title`}
        title={t("admin.modelProvider.providers")}
        description={t("admin.modelProvider.catalogDescription")}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || settings.providers.length >= 20}
            onClick={() => openEditor({ kind: "channel", channel: null })}
          >
            <PlusIcon data-icon="inline-start" />
            {t("admin.modelProvider.addProvider")}
          </Button>
        }
      />
      {channel ? (
        <div
          className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[color:var(--app-border)] bg-card p-4"
          role="group"
          aria-label={providerName(channel, channelIndex)}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full min-w-0 sm:w-64">
              <ModelSettingsSelect
                label={t("admin.modelProvider.currentChannel")}
                value={channel.id}
                disabled={pending}
                options={settings.providers.map((provider, index) => ({
                  value: provider.id,
                  label: providerName(provider, index),
                }))}
                onChange={(value) => {
                  setSelectedId(value)
                  clearError()
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || modelCount >= 100}
                onClick={() =>
                  openEditor({ kind: "model", channel, model: null })
                }
              >
                <PlusIcon data-icon="inline-start" />
                {t("admin.modelProvider.addModel")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      aria-label={t("admin.modelProvider.channelActions")}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      disabled={disabled}
                      onClick={() => openEditor({ kind: "channel", channel })}
                    >
                      <PencilIcon className="mx-px size-3.5" />
                      {t("admin.modelProvider.editChannel")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={channelIndex === 0}
                      onClick={() => moveChannel(-1)}
                    >
                      <ArrowUpIcon />
                      {t("admin.modelProvider.moveChannelUp")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={channelIndex === settings.providers.length - 1}
                      onClick={() => moveChannel(1)}
                    >
                      <ArrowDownIcon />
                      {t("admin.modelProvider.moveChannelDown")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      className="whitespace-nowrap"
                      disabled={settings.providers.length === 1}
                      onClick={() => setDeletion({ kind: "channel", channel })}
                    >
                      <Trash2Icon />
                      {t("admin.modelProvider.deleteProvider")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t(`admin.imageUnderstanding.providers.${channel.provider}`)}
            </span>
            <span>
              {t("admin.modelProvider.providerDescription", {
                count: channel.models.length,
              })}
            </span>
            <span>
              {t(
                channel.api_key_configured
                  ? "admin.modelProvider.keyConfigured"
                  : "admin.modelProvider.keyNotConfigured"
              )}
            </span>
          </div>
          {channel.models.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("admin.modelProvider.noModels")}</EmptyTitle>
                <EmptyDescription>
                  {t("admin.modelProvider.noModelsDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {t("admin.modelProvider.priceUnit")}
              </p>
              <ModelSettingsTable
                models={channel.models}
                disabled={disabled}
                onEdit={(model) =>
                  openEditor({ kind: "model", channel, model })
                }
                onDelete={(model) => setDeletion({ kind: "model", model })}
                onAvailability={(model, enabled) =>
                  execute({ kind: "availability", modelId: model.id, enabled })
                }
                onReorder={(models) => {
                  const draft = settingsDraft(settings)
                  draft.providers = draft.providers.map((provider) =>
                    provider.id === channel.id
                      ? { ...provider, models }
                      : provider
                  )
                  execute({ kind: "save", draft })
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.modelProvider.orderHint")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("admin.modelProvider.noChannels")}</EmptyTitle>
            <EmptyDescription>
              {t("admin.modelProvider.noChannelsDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {settings.providers.some((provider) =>
        provider.models.some((model) => model.kind === "chat")
      ) && (
        <ModelDefaultSelections
          key={`${settings.default_model}:${settings.title_model}`}
          settings={settings}
          disabled={disabled}
          onSave={(draft) => execute({ kind: "save", draft })}
        />
      )}
      {editor?.kind === "channel" && (
        <ChannelEditor
          channel={editor.channel}
          settings={settings}
          pending={pending}
          error={error}
          onClose={closeEditor}
          onSave={(draft) =>
            execute({
              kind: "save",
              draft,
              onSaved: () => {
                if (!editor.channel)
                  setSelectedId(draft.providers.at(-1)?.id ?? "")
                closeEditor()
              },
            })
          }
        />
      )}
      {editor?.kind === "model" && (
        <ModelEditor
          channel={editor.channel}
          initialModel={editor.model}
          settings={settings}
          pending={pending}
          error={error}
          onClose={closeEditor}
          onSave={(draft) =>
            execute({ kind: "save", draft, onSaved: closeEditor })
          }
        />
      )}
      <ConfirmDialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletion(null)
            clearError()
          }
        }}
        destructive
        destructiveNotice={error ?? undefined}
        pending={pending}
        confirmLabel={t("common.delete")}
        title={
          deletion?.kind === "model"
            ? t("admin.modelProvider.deleteModelTitle", {
                name: deletion.model.display_name,
              })
            : t("admin.modelProvider.deleteProviderTitle", {
                name:
                  deletion?.kind === "channel"
                    ? providerName(
                        deletion.channel,
                        settings.providers.findIndex(
                          (provider) => provider.id === deletion.channel.id
                        )
                      )
                    : "",
              })
        }
        description={t(
          deletion?.kind === "model"
            ? "admin.modelProvider.deleteModelDescription"
            : "admin.modelProvider.deleteProviderDescription"
        )}
        onConfirm={() => {
          if (deletion?.kind === "model")
            execute({
              kind: "deleteModel",
              modelId: deletion.model.id,
              onSaved: () => setDeletion(null),
            })
          else if (deletion)
            execute({
              kind: "deleteChannel",
              channelId: deletion.channel.id,
              onSaved: () => setDeletion(null),
            })
        }}
      />
    </section>
  )
}

function ModelDefaultSelections({
  settings,
  disabled,
  onSave,
}: {
  settings: ModelProviderSettings
  disabled: boolean
  onSave: (draft: ReturnType<typeof settingsDraft>) => void
}) {
  const { t } = useTranslation()
  const [defaultModel, setDefaultModel] = useState(settings.default_model)
  const [titleModel, setTitleModel] = useState(settings.title_model)
  const chats = settings.providers
    .flatMap((provider) => provider.models)
    .filter((model) => model.kind === "chat")
  const draft = {
    ...settingsDraft(settings),
    default_model: defaultModel,
    title_model: titleModel,
  }
  const dirty =
    defaultModel !== settings.default_model ||
    titleModel !== settings.title_model
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      aria-label={t("admin.modelProvider.modelSelections")}
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && isSettingsDraftValid(draft, settings)) onSave(draft)
      }}
    >
      <h3 className="text-sm font-medium">
        {t("admin.modelProvider.modelSelections")}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <ModelSettingsSelect
          label={t("admin.modelProvider.defaultModel")}
          value={defaultModel}
          disabled={disabled || !chats.length}
          options={chats
            .filter((model) => model.enabled)
            .map((model) => ({ value: model.id, label: model.display_name }))}
          onChange={setDefaultModel}
        />
        <ModelSettingsSelect
          label={t("admin.modelProvider.titleModel")}
          value={titleModel}
          disabled={disabled || !chats.length}
          options={chats.map((model) => ({
            value: model.id,
            label: model.display_name,
          }))}
          onChange={setTitleModel}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("admin.modelProvider.selectionsHint")}
      </p>
      <Button
        type="submit"
        size="sm"
        className="self-end"
        disabled={disabled || !dirty || !isSettingsDraftValid(draft, settings)}
        aria-label={t("admin.modelProvider.saveModelSelections")}
      >
        {t("common.save")}
      </Button>
    </form>
  )
}

export function InitialUserTokenQuotaSettingsForm({
  settings,
}: {
  settings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const readOnly = settings.management_enabled === false
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const [apiError, setApiError] = useState<string | null>(null)
  const [revision, setRevision] = useState(settings.revision)
  const [weeklyTokenLimit, setWeeklyTokenLimit] = useState(
    tokenLimitToMillionTokenQuotaInput(settings.token_limits.weekly_token_limit)
  )
  const [monthlyTokenLimit, setMonthlyTokenLimit] = useState(
    tokenLimitToMillionTokenQuotaInput(
      settings.token_limits.monthly_token_limit
    )
  )

  const mutation = useMutation({
    mutationFn: (tokenLimits: {
      weekly_token_limit: string | null
      monthly_token_limit: string | null
    }) =>
      apiRequest("/admin/model-provider-settings", {
        method: "PUT",
        body: {
          expected_revision: revision,
          providers: settings.providers.map(toSettingsProviderUpdate),
          default_model: settings.default_model,
          title_model: settings.title_model,
          token_limits: tokenLimits,
        },
        schema: modelProviderSettingsUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      setRevision(result.settings.revision)
      setWeeklyTokenLimit(
        tokenLimitToMillionTokenQuotaInput(
          result.settings.token_limits.weekly_token_limit
        )
      )
      setMonthlyTokenLimit(
        tokenLimitToMillionTokenQuotaInput(
          result.settings.token_limits.monthly_token_limit
        )
      )
      setApiError(null)
      notify.success(t("admin.modelProvider.userTokenLimitsSaved"), {
        id: "model-provider-token-limits-saved",
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "model-provider-settings"],
      })
    },
    onError: (nextError) => {
      setApiError(getErrorMessage(nextError, t))
    },
  })

  return (
    <section
      className="grid min-w-0 gap-4"
      aria-labelledby={`${idPrefix}-initial-token-quota-title`}
    >
      <form
        className="grid w-full max-w-[720px] gap-4"
        inert={readOnly}
        aria-disabled={readOnly}
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (readOnly) return
          let tokenLimits: {
            weekly_token_limit: string | null
            monthly_token_limit: string | null
          }
          try {
            tokenLimits = {
              weekly_token_limit:
                millionTokenQuotaInputToTokenLimit(weeklyTokenLimit),
              monthly_token_limit:
                millionTokenQuotaInputToTokenLimit(monthlyTokenLimit),
            }
          } catch {
            setApiError(t("admin.tokenLimitInputInvalid"))
            return
          }
          setApiError(null)
          mutation.mutate(tokenLimits)
        }}
      >
        <div
          data-slot="model-settings-card"
          className="grid min-w-0 gap-4 rounded-2xl border border-[color:var(--app-border)] bg-card p-4"
        >
          <SettingsSectionHeader
            id={`${idPrefix}-initial-token-quota-title`}
            title={t("admin.modelProvider.userTokenLimits")}
            description={t("admin.modelProvider.userTokenLimitsDescription")}
          />

          {apiError && <StatusBanner variant="error">{apiError}</StatusBanner>}

          <FieldGroup className="grid grid-cols-1 gap-4">
            <FieldShell
              id={`${idPrefix}-weekly-token-limit`}
              label={t("admin.weeklyTokenLimit")}
              hint={t("admin.modelProvider.tokenLimitHint")}
            >
              <Input
                id={`${idPrefix}-weekly-token-limit`}
                name={`${idPrefix}-weekly-token-limit`}
                inputMode="decimal"
                pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                value={weeklyTokenLimit}
                onChange={(event) => setWeeklyTokenLimit(event.target.value)}
                placeholder={t("admin.noTokenLimit")}
              />
            </FieldShell>
            <FieldShell
              id={`${idPrefix}-monthly-token-limit`}
              label={t("admin.monthlyTokenLimit")}
              hint={t("admin.modelProvider.tokenLimitHint")}
            >
              <Input
                id={`${idPrefix}-monthly-token-limit`}
                name={`${idPrefix}-monthly-token-limit`}
                inputMode="decimal"
                pattern={MILLION_TOKEN_QUOTA_INPUT_PATTERN}
                value={monthlyTokenLimit}
                onChange={(event) => setMonthlyTokenLimit(event.target.value)}
                placeholder={t("admin.noTokenLimit")}
              />
            </FieldShell>
          </FieldGroup>
        </div>

        <Button
          type="submit"
          size="sm"
          className="w-auto justify-self-start"
          disabled={readOnly || mutation.isPending}
          aria-busy={mutation.isPending || undefined}
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("admin.modelProvider.saveUserTokenLimits")}
        </Button>
      </form>
    </section>
  )
}
