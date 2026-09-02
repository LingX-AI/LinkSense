import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query"
import {
  BotIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import type { IconType } from "react-icons"
import {
  SiAlibabacloud,
  SiAnthropic,
  SiDeepseek,
  SiGooglecloud,
  SiGooglegemini,
  SiOpenrouter,
  SiVllm,
} from "react-icons/si"
import { TbBrandAzure, TbBrandOpenai } from "react-icons/tb"
import { useTranslation } from "react-i18next"
import {
  genericReasoningEffortValues,
  managedModelKindValues,
  modelContextWindowSchema,
  modelServiceProviderValues,
  modelTokenPricePerMillionSchema,
  modelProviderProtocolModeValues,
  type ManagedPricedModel,
  type ManagedModelProviderSettings,
  type ManagedModelKind,
  type ModelServiceProvider,
  type ModelProviderProtocolMode,
  type ReasoningEffort,
} from "@linksense/shared"

import { apiRequest } from "@/api/client"
import {
  modelProviderSettingsUpdateResultSchema,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { cn } from "@/lib/utils"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
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
import { ModelTokenPriceInput } from "@/components/forms/model-token-price-input"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

type EditableModel = ManagedPricedModel & {
  formKey: string
  persistedId: string | null
  draftTouched: boolean
  contextWindowInput?: string
}

type EditableModelUpdate = Partial<{
  id: string
  display_name: string
  enabled: boolean
  input_price_per_million: string
  cached_input_price_per_million: string
  output_price_per_million: string
  contextWindowInput: string
  supports_image_input: boolean
  supported_reasoning_efforts: ReasoningEffort[]
  default_reasoning_effort: ReasoningEffort
}>

type EditableProvider = Omit<
  ManagedModelProviderSettings,
  "models" | "name"
> & {
  name: string
  apiKey: string
  formKey: string
  persistedId: string | null
  models: EditableModel[]
}

type ModelProviderSettingsProviderUpdate = {
  id: string
  name?: string
  provider: ModelServiceProvider
  provider_project: string | null
  provider_location: string | null
  base_url: string
  protocol_mode: ModelProviderProtocolMode
  api_key?: string
  models: ManagedPricedModel[]
}

const MASKED_API_KEY = "••••••••••••"

const modelServiceProviderIcons: Record<ModelServiceProvider, IconType> = {
  openai: TbBrandOpenai,
  azure_openai: TbBrandAzure,
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  google_vertex: SiGooglecloud,
  alibaba: SiAlibabacloud,
  deepseek: SiDeepseek,
  openrouter: SiOpenrouter,
  openai_compatible: SiVllm,
}

const modelServiceProviderLogoClasses: Record<ModelServiceProvider, string> = {
  openai: "text-provider-openai",
  azure_openai: "text-provider-azure-openai",
  anthropic: "text-provider-anthropic",
  google: "text-provider-google-gemini",
  google_vertex: "text-provider-google-vertex",
  alibaba: "text-provider-alibaba",
  deepseek: "text-provider-deepseek",
  openrouter: "text-provider-openrouter",
  openai_compatible: "text-provider-vllm",
}

function ModelServiceProviderLogo({
  provider,
}: {
  provider: ModelServiceProvider
}) {
  const Logo = modelServiceProviderIcons[provider]
  return (
    <Logo
      aria-hidden="true"
      className={modelServiceProviderLogoClasses[provider]}
      data-service-provider-logo={provider}
      focusable="false"
    />
  )
}

function toManagedModel(model: EditableModel): ManagedPricedModel {
  const identity = {
    id: model.id,
    display_name: model.display_name,
    enabled: model.enabled,
  }
  const common = {
    ...identity,
    input_price_per_million: model.input_price_per_million,
  }
  if (model.kind !== "chat") return { ...common, kind: model.kind }
  return {
    ...common,
    kind: "chat",
    cached_input_price_per_million: model.cached_input_price_per_million,
    output_price_per_million: model.output_price_per_million,
    supports_image_input: model.supports_image_input,
    context_window: getContextWindowForPayload(model),
    supported_reasoning_efforts: model.supported_reasoning_efforts,
    default_reasoning_effort: model.default_reasoning_effort,
  }
}

function toEditableProviderUpdate(
  provider: EditableProvider,
  includeDraftModelFormKey?: string
): ModelProviderSettingsProviderUpdate {
  return {
    id: provider.id,
    name: provider.name.trim(),
    provider: provider.provider,
    provider_project: provider.provider_project,
    provider_location: provider.provider_location,
    base_url: provider.base_url.trim(),
    protocol_mode: provider.protocol_mode,
    ...(provider.apiKey.trim() ? { api_key: provider.apiKey.trim() } : {}),
    models: provider.models
      .filter(
        (model) =>
          !isUntouchedDraftModel(model) ||
          model.formKey === includeDraftModelFormKey
      )
      .map(toManagedModel),
  }
}

type ModelProviderSettingsDraft = {
  providers: ModelProviderSettingsProviderUpdate[]
  default_model: string | null
  title_model: string | null
  token_limits: ModelProviderSettings["token_limits"]
}

type ModelProviderSettingsSaveInput = ModelProviderSettingsDraft & {
  saveTarget: ModelProviderSettingsSaveTarget
}

type ModelProviderSettingsSaveTarget =
  `provider:${string}` | `model:${string}` | "selections" | "form"

const modelProviderSettingsSaveMutationKey = [
  "admin",
  "model-provider-settings",
  "save",
] as const

const modelProviderSettingsSaveMutationScope = {
  id: "admin-model-provider-settings-save",
} as const

function toSettingsProviderUpdate(
  provider: ModelProviderSettings["providers"][number]
): ModelProviderSettingsProviderUpdate {
  const name = provider.name?.trim()
  return {
    id: provider.id,
    ...(name ? { name } : {}),
    provider: provider.provider,
    provider_project: provider.provider_project,
    provider_location: provider.provider_location,
    base_url: provider.base_url,
    protocol_mode: provider.protocol_mode,
    models: provider.models,
  }
}

function createModelProviderSettingsDraft({
  providers,
  defaultModel,
  titleModel,
  tokenLimits,
  includeDraftModelFormKey,
}: {
  providers: EditableProvider[]
  defaultModel: string
  titleModel: string
  tokenLimits: ModelProviderSettings["token_limits"]
  includeDraftModelFormKey?: string
}): ModelProviderSettingsDraft {
  return {
    providers: providers.map((provider) =>
      toEditableProviderUpdate(provider, includeDraftModelFormKey)
    ),
    default_model: defaultModel || null,
    title_model: titleModel || null,
    token_limits: tokenLimits,
  }
}

function createSubmittedApiKeyMap(
  providers: ModelProviderSettingsProviderUpdate[]
): Map<string, string> {
  const apiKeys = new Map<string, string>()
  for (const provider of providers) {
    if (provider.api_key) apiKeys.set(provider.id, provider.api_key)
  }
  return apiKeys
}

function isUntouchedDraftModel(model: EditableModel): boolean {
  return model.persistedId === null && !model.draftTouched
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}

function isValidPrice(value: string): boolean {
  return modelTokenPricePerMillionSchema.safeParse(value).success
}

function formatContextWindowInput(value: number | null): string {
  return value === null ? "" : String(value)
}

function getContextWindowInput(model: EditableModel): string {
  return model.kind === "chat"
    ? (model.contextWindowInput ??
        formatContextWindowInput(model.context_window))
    : ""
}

function parseContextWindowInput(
  value: string
): { contextWindow: number | null; valid: true } | { valid: false } {
  const trimmed = value.trim()
  if (trimmed === "") return { contextWindow: null, valid: true }
  if (!/^[1-9]\d*$/u.test(trimmed)) return { valid: false }

  const parsed = Number(trimmed)
  if (!modelContextWindowSchema.safeParse(parsed).success) {
    return { valid: false }
  }
  return { contextWindow: parsed, valid: true }
}

function isValidContextWindowInput(value: string): boolean {
  return parseContextWindowInput(value).valid
}

function getContextWindowForPayload(model: EditableModel): number | null {
  const parsed = parseContextWindowInput(getContextWindowInput(model))
  return parsed.valid ? parsed.contextWindow : null
}

function providerRequiresApiKey(
  provider: EditableProvider,
  titleModel: string
): boolean {
  return provider.models.some(
    (model) =>
      !isUntouchedDraftModel(model) &&
      ((model.kind === "chat" && model.enabled) || model.id === titleModel)
  )
}

function withoutEditableModel(
  providers: EditableProvider[],
  formKey: string
): EditableProvider[] {
  return providers.map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => model.formKey !== formKey),
  }))
}

function withoutEditableProvider(
  providers: EditableProvider[],
  formKey: string
): EditableProvider[] {
  return providers.filter((provider) => provider.formKey !== formKey)
}

function resolveEditableDefaultModel(
  providers: EditableProvider[],
  preferredModel: string | null
): string {
  const models = providers.flatMap((provider) => provider.models)
  return (
    models.find(
      (model) =>
        model.kind === "chat" &&
        model.enabled &&
        model.persistedId === preferredModel
    )?.id ??
    models.find(
      (model) =>
        model.kind === "chat" && model.enabled && model.id === preferredModel
    )?.id ??
    models.find((model) => model.kind === "chat" && model.enabled)?.id ??
    ""
  )
}

function resolveEditableSystemChatModel(
  providers: EditableProvider[],
  preferredModel: string | null
): string {
  const models = providers.flatMap((provider) => provider.models)
  return (
    models.find(
      (model) => model.kind === "chat" && model.persistedId === preferredModel
    )?.id ??
    models.find((model) => model.kind === "chat" && model.id === preferredModel)
      ?.id ??
    models.find((model) => model.kind === "chat")?.id ??
    ""
  )
}

function ReasoningEffortMultiSelect({
  id,
  label,
  values,
  options,
  readOnly,
  summary,
  onValueChange,
}: {
  id: string
  label: string
  values: ReasoningEffort[]
  options: { label: string; value: ReasoningEffort }[]
  readOnly: boolean
  summary: string
  onValueChange: (values: ReasoningEffort[]) => void
}) {
  const selectedLabels = options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="input"
            className="w-full justify-between text-left"
            aria-label={label}
            title={selectedLabels.join(", ")}
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.map((option) => {
            const checked = values.includes(option.value)
            return (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={checked}
                disabled={readOnly || (checked && values.length === 1)}
                onCheckedChange={(nextChecked) => {
                  const selected = new Set(values)
                  if (nextChecked) {
                    selected.add(option.value)
                  } else {
                    selected.delete(option.value)
                  }
                  onValueChange(
                    options
                      .filter((item) => selected.has(item.value))
                      .map((item) => item.value)
                  )
                }}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
      {apiError && <StatusBanner variant="error">{apiError}</StatusBanner>}

      <form
        className="grid max-w-none gap-4"
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
        <SettingsSectionHeader
          id={`${idPrefix}-initial-token-quota-title`}
          title={t("admin.modelProvider.userTokenLimits")}
          description={t("admin.modelProvider.userTokenLimitsDescription")}
        />

        <div className="form-grid">
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
        </div>

        <Button
          type="submit"
          size="sm"
          className="w-auto justify-self-start"
          disabled={readOnly || mutation.isPending}
          aria-busy={mutation.isPending || undefined}
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("common.save")}
        </Button>
      </form>
    </section>
  )
}

export function ModelProviderSettingsForm({
  settings,
}: {
  settings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const readOnly = settings.management_enabled === false
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const [apiError, setApiError] = useState<string | null>(null)
  const [providers, setProviders] = useState<EditableProvider[]>(() => {
    if (settings.providers.length > 0) {
      return settings.providers.map((provider, providerIndex) => ({
        ...provider,
        name:
          provider.name ??
          t("admin.modelProvider.providerTitle", {
            index: providerIndex + 1,
          }),
        apiKey: "",
        formKey: `${idPrefix}-provider-${providerIndex}`,
        persistedId: provider.id,
        models: provider.models.map((model, modelIndex) => ({
          ...model,
          ...(model.kind === "chat"
            ? {
                contextWindowInput: formatContextWindowInput(
                  model.context_window
                ),
              }
            : {}),
          formKey: `${idPrefix}-provider-${providerIndex}-model-${modelIndex}`,
          persistedId: model.id,
          draftTouched: true,
        })),
      }))
    }
    const modelId = "model-1"
    return [
      {
        id: "provider-1",
        name: t("admin.modelProvider.providerTitle", { index: 1 }),
        base_url: "",
        protocol_mode: "native_responses",
        provider: "openai_compatible",
        provider_project: null,
        provider_location: null,
        api_key_configured: false,
        apiKey: "",
        formKey: `${idPrefix}-provider-0`,
        persistedId: null,
        models: [
          {
            id: modelId,
            display_name: t("admin.modelProvider.newModelName", { index: 1 }),
            enabled: true,
            kind: "chat",
            input_price_per_million: "0",
            cached_input_price_per_million: "0",
            output_price_per_million: "0",
            supports_image_input: false,
            context_window: null,
            contextWindowInput: "",
            supported_reasoning_efforts: ["medium"],
            default_reasoning_effort: "medium",
            formKey: `${idPrefix}-provider-0-model-0`,
            persistedId: null,
            draftTouched: true,
          },
        ],
      },
    ]
  })
  const nextProviderNumber = useRef(providers.length + 1)
  const nextModelNumber = useRef(
    providers.flatMap((provider) => provider.models).length + 1
  )
  const nextFormKey = useRef(
    providers.length + providers.flatMap((provider) => provider.models).length
  )
  const providersRef = useRef(providers)
  const providerCardRefs = useRef(new Map<string, HTMLDivElement>())
  const pendingProviderScrollKey = useRef<string | null>(null)
  useEffect(() => {
    providersRef.current = providers
  }, [providers])
  useEffect(() => {
    const formKey = pendingProviderScrollKey.current
    if (!formKey) return

    const providerCard = providerCardRefs.current.get(formKey)
    if (!providerCard) return

    pendingProviderScrollKey.current = null
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    providerCard.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    })
  }, [providers])
  const [revision, setRevision] = useState(settings.revision)
  const [defaultModel, setDefaultModel] = useState(
    settings.default_model ??
      providers
        .flatMap((provider) => provider.models)
        .find((model) => model.kind === "chat" && model.enabled)?.id ??
      ""
  )
  const [titleModel, setTitleModel] = useState(
    settings.title_model ??
      settings.default_model ??
      providers
        .flatMap((provider) => provider.models)
        .find((model) => model.kind === "chat" && model.enabled)?.id ??
      ""
  )
  const [deleteModelKey, setDeleteModelKey] = useState<string | null>(null)
  const [deleteProviderKey, setDeleteProviderKey] = useState<string | null>(
    null
  )
  const [renameProviderKey, setRenameProviderKey] = useState<string | null>(
    null
  )
  const [renameProviderValue, setRenameProviderValue] = useState("")

  const allModels = providers.flatMap((provider) => provider.models)
  const persistableModels = allModels.filter(
    (model) => !isUntouchedDraftModel(model)
  )
  const chatModels = persistableModels.filter((model) => model.kind === "chat")
  const composerModels = chatModels.filter((model) => model.enabled)
  const deleteModelContext =
    providers
      .flatMap((provider, providerIndex) =>
        provider.models.map((model, modelIndex) => ({
          model,
          modelIndex,
          providerIndex,
        }))
      )
      .find(({ model }) => model.formKey === deleteModelKey) ?? null
  const deleteProvider =
    providers.find((provider) => provider.formKey === deleteProviderKey) ?? null
  const renameProvider =
    providers.find((provider) => provider.formKey === renameProviderKey) ?? null
  const normalizedRenameProviderName = renameProviderValue.trim()
  const deleteModelName =
    deleteModelContext?.model.display_name ||
    t("admin.modelProvider.unnamedModel")
  const deleteProviderName =
    deleteProvider?.name || t("admin.modelProvider.unnamedProvider")
  const protocolModeItems = modelProviderProtocolModeValues.map((mode) => ({
    label: t(`admin.modelProvider.protocolModes.${mode}`),
    value: mode,
  }))
  const modelKindItems = managedModelKindValues.map((kind) => ({
    label: t(`admin.modelProvider.modelKinds.${kind}`),
    value: kind,
  }))
  const serviceProviderItems = modelServiceProviderValues.map((provider) => ({
    label: t(`admin.imageUnderstanding.providers.${provider}`),
    value: provider,
  }))
  const defaultModelItems = composerModels.map((model) => ({
    label: model.display_name,
    value: model.id,
  }))
  const titleModelItems = chatModels.map((model) => ({
    label: model.display_name,
    value: model.id,
  }))
  const normalizedBaseUrls = providers.map((provider) =>
    normalizeBaseUrl(provider.base_url)
  )
  const formValid =
    providers.length > 0 &&
    providers.length <= 20 &&
    providers.every((provider) => Boolean(provider.name.trim())) &&
    new Set(providers.map((provider) => provider.id)).size ===
      providers.length &&
    normalizedBaseUrls.every(Boolean) &&
    persistableModels.length > 0 &&
    persistableModels.length <= 100 &&
    new Set(persistableModels.map((model) => model.id.trim())).size ===
      persistableModels.length &&
    (chatModels.length === 0
      ? defaultModel === "" && titleModel === ""
      : composerModels.some((model) => model.id === defaultModel) &&
        chatModels.some((model) => model.id === titleModel)) &&
    providers.every(
      (provider) =>
        (provider.provider !== "google_vertex" ||
          (Boolean(provider.provider_project?.trim()) &&
            Boolean(provider.provider_location?.trim()))) &&
        provider.models.some((model) => !isUntouchedDraftModel(model)) &&
        (!providerRequiresApiKey(provider, titleModel) ||
          provider.api_key_configured ||
          Boolean(provider.apiKey.trim()))
    ) &&
    persistableModels.every(
      (model) =>
        Boolean(model.id.trim()) &&
        Boolean(model.display_name.trim()) &&
        isValidPrice(model.input_price_per_million) &&
        (model.kind !== "chat" ||
          (isValidPrice(model.cached_input_price_per_million) &&
            isValidPrice(model.output_price_per_million) &&
            isValidContextWindowInput(getContextWindowInput(model)) &&
            model.supported_reasoning_efforts.length > 0 &&
            model.supported_reasoning_efforts.includes(
              model.default_reasoning_effort
            )))
    )
  const draft = useMemo(
    () =>
      createModelProviderSettingsDraft({
        providers,
        defaultModel,
        titleModel,
        tokenLimits: settings.token_limits,
      }),
    [defaultModel, providers, settings.token_limits, titleModel]
  )
  const revisionRef = useRef(revision)
  useEffect(() => {
    revisionRef.current = revision
  }, [revision])

  const updateProvider = (
    providerIndex: number,
    update: Partial<
      Pick<
        EditableProvider,
        | "apiKey"
        | "base_url"
        | "name"
        | "protocol_mode"
        | "provider"
        | "provider_project"
        | "provider_location"
      >
    >
  ) => {
    setProviders((current) =>
      current.map((provider, index) =>
        index === providerIndex ? { ...provider, ...update } : provider
      )
    )
  }

  const updateModel = (
    providerIndex: number,
    modelIndex: number,
    update: EditableModelUpdate
  ) => {
    setProviders((current) =>
      current.map((provider, index) =>
        index === providerIndex
          ? {
              ...provider,
              models: provider.models.map((model, currentModelIndex) =>
                currentModelIndex === modelIndex
                  ? model.kind === "chat"
                    ? {
                        ...model,
                        draftTouched:
                          model.persistedId === null || model.draftTouched,
                        id: update.id ?? model.id,
                        display_name: update.display_name ?? model.display_name,
                        enabled: update.enabled ?? model.enabled,
                        input_price_per_million:
                          update.input_price_per_million ??
                          model.input_price_per_million,
                        cached_input_price_per_million:
                          update.cached_input_price_per_million ??
                          model.cached_input_price_per_million,
                        output_price_per_million:
                          update.output_price_per_million ??
                          model.output_price_per_million,
                        contextWindowInput:
                          update.contextWindowInput ??
                          getContextWindowInput(model),
                        supports_image_input:
                          update.supports_image_input ??
                          model.supports_image_input,
                        supported_reasoning_efforts:
                          update.supported_reasoning_efforts ??
                          model.supported_reasoning_efforts,
                        default_reasoning_effort:
                          update.default_reasoning_effort ??
                          model.default_reasoning_effort,
                      }
                    : {
                        ...model,
                        draftTouched:
                          model.persistedId === null || model.draftTouched,
                        id: update.id ?? model.id,
                        display_name: update.display_name ?? model.display_name,
                        enabled: update.enabled ?? model.enabled,
                        input_price_per_million:
                          update.input_price_per_million ??
                          model.input_price_per_million,
                      }
                  : model
              ),
            }
          : provider
      )
    )
  }

  const updateModelKind = (
    providerIndex: number,
    modelIndex: number,
    kind: ManagedModelKind
  ) => {
    setProviders((current) =>
      current.map((provider, index) =>
        index === providerIndex
          ? {
              ...provider,
              models: provider.models.map((model, currentModelIndex) => {
                if (currentModelIndex !== modelIndex) return model
                const identity = {
                  id: model.id,
                  display_name: model.display_name,
                  enabled: model.enabled,
                  formKey: model.formKey,
                  persistedId: model.persistedId,
                  draftTouched:
                    model.persistedId === null || model.draftTouched,
                }
                if (kind === "chat") {
                  return {
                    ...identity,
                    kind,
                    input_price_per_million: model.input_price_per_million,
                    cached_input_price_per_million: "0",
                    output_price_per_million: "0",
                    supports_image_input: false,
                    context_window: null,
                    contextWindowInput: "",
                    supported_reasoning_efforts: [
                      ...genericReasoningEffortValues,
                    ],
                    default_reasoning_effort: "medium",
                  }
                }
                return {
                  ...identity,
                  kind,
                  input_price_per_million: model.input_price_per_million,
                }
              }),
            }
          : provider
      )
    )
  }

  const removeLocalModel = (formKey: string) => {
    const nextProviders = withoutEditableModel(providers, formKey)
    setProviders(nextProviders)
    setDefaultModel(resolveEditableDefaultModel(nextProviders, defaultModel))
    setTitleModel(resolveEditableSystemChatModel(nextProviders, titleModel))
    setDeleteModelKey(null)
    setApiError(null)
    notify.success(t("admin.modelProvider.modelDeleted"), {
      id: "model-provider-model-deleted",
    })
  }

  const createUniqueProviderId = () => {
    const existingIds = new Set(providers.map((provider) => provider.id))
    let candidate = `provider-${nextProviderNumber.current}`
    nextProviderNumber.current += 1
    while (existingIds.has(candidate)) {
      candidate = `provider-${nextProviderNumber.current}`
      nextProviderNumber.current += 1
    }
    return candidate
  }

  const createDraftModel = (): EditableModel => {
    const existingIds = new Set(allModels.map((model) => model.id))
    let modelNumber = nextModelNumber.current
    let id = `model-${modelNumber}`
    modelNumber += 1
    while (existingIds.has(id)) {
      id = `model-${modelNumber}`
      modelNumber += 1
    }
    nextModelNumber.current = modelNumber
    const formKey = `${idPrefix}-draft-model-${nextFormKey.current}`
    nextFormKey.current += 1
    return {
      id,
      display_name: t("admin.modelProvider.newModelName", {
        index: modelNumber - 1,
      }),
      enabled: true,
      kind: "chat",
      input_price_per_million: "0",
      cached_input_price_per_million: "0",
      output_price_per_million: "0",
      supports_image_input: false,
      context_window: null,
      contextWindowInput: "",
      supported_reasoning_efforts: [...genericReasoningEffortValues],
      default_reasoning_effort: "medium",
      formKey,
      persistedId: null,
      draftTouched: false,
    }
  }

  const mutation = useMutation({
    mutationKey: modelProviderSettingsSaveMutationKey,
    scope: modelProviderSettingsSaveMutationScope,
    mutationFn: (input: ModelProviderSettingsSaveInput) =>
      apiRequest("/admin/model-provider-settings", {
        method: "PUT",
        body: {
          expected_revision: revisionRef.current,
          providers: input.providers,
          default_model: input.default_model,
          title_model: input.title_model,
          token_limits: input.token_limits,
        },
        schema: modelProviderSettingsUpdateResultSchema,
      }),
    onSuccess: async (result, input) => {
      revisionRef.current = result.settings.revision
      const submittedApiKeys = createSubmittedApiKeyMap(input.providers)
      setRevision(result.settings.revision)
      setDefaultModel(result.settings.default_model ?? "")
      setTitleModel(result.settings.title_model ?? "")
      setProviders((current) =>
        current.map((provider) => {
          const serverProvider = result.settings.providers.find(
            (candidate) => candidate.id === provider.id
          )
          return {
            ...provider,
            api_key_configured:
              serverProvider?.api_key_configured ?? provider.api_key_configured,
            apiKey:
              submittedApiKeys.get(provider.id) === provider.apiKey
                ? ""
                : provider.apiKey,
            persistedId: serverProvider ? provider.id : provider.persistedId,
            models: provider.models.map((model) => {
              const serverModel = serverProvider?.models.find(
                (candidate) => candidate.id === model.id
              )
              return {
                ...model,
                ...(serverModel?.kind === "chat" && model.kind === "chat"
                  ? {
                      context_window: serverModel.context_window,
                      contextWindowInput: formatContextWindowInput(
                        serverModel.context_window
                      ),
                    }
                  : {}),
                persistedId: serverModel ? model.id : model.persistedId,
              }
            }),
          }
        })
      )
      setApiError(null)
      notify.success(t("admin.modelProvider.saved"), {
        id: "model-provider-settings-saved",
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "model-provider-settings"],
        refetchType: "none",
      })
      await queryClient.invalidateQueries({
        queryKey: ["me", "model-preference"],
      })
    },
    onError: (nextError) => {
      setApiError(getErrorMessage(nextError, t))
    },
  })

  const availabilityMutation = useMutation({
    mutationFn: (input: {
      formKey: string
      persistedId: string
      enabled: boolean
      expectedRevision: number
    }) =>
      apiRequest("/admin/model-provider-settings/models/availability", {
        method: "PATCH",
        body: {
          expected_revision: input.expectedRevision,
          model_id: input.persistedId,
          enabled: input.enabled,
        },
        schema: modelProviderSettingsUpdateResultSchema,
      }),
    onSuccess: async (result, input) => {
      const nextProviders = providersRef.current.map((provider) => ({
        ...provider,
        models: provider.models.map((model) =>
          model.formKey === input.formKey
            ? { ...model, enabled: input.enabled }
            : model
        ),
      }))
      revisionRef.current = result.settings.revision
      setRevision(result.settings.revision)
      setProviders(nextProviders)
      const serverDefaultModel = result.settings.default_model
      const localModels = nextProviders.flatMap((provider) => provider.models)
      const matchingLocalDefault = localModels.find(
        (model) => model.persistedId === serverDefaultModel
      )
      const localFallback = localModels.find(
        (model) =>
          model.kind === "chat" &&
          (model.formKey === input.formKey ? input.enabled : model.enabled)
      )
      const nextDefaultModel =
        matchingLocalDefault?.id ??
        localFallback?.id ??
        serverDefaultModel ??
        ""
      const nextTitleModel = result.settings.title_model ?? ""
      setDefaultModel(nextDefaultModel)
      setTitleModel(nextTitleModel)
      setApiError(null)
      await queryClient.invalidateQueries({
        queryKey: ["admin", "model-provider-settings"],
        refetchType: "none",
      })
      await queryClient.invalidateQueries({
        queryKey: ["me", "model-preference"],
      })
    },
    onError: (nextError) => {
      setApiError(getErrorMessage(nextError, t))
    },
  })

  const deleteModelMutation = useMutation({
    mutationFn: (input: {
      formKey: string
      persistedId: string
      expectedRevision: number
    }) =>
      apiRequest("/admin/model-provider-settings/models", {
        method: "DELETE",
        body: {
          expected_revision: input.expectedRevision,
          model_id: input.persistedId,
        },
        schema: modelProviderSettingsUpdateResultSchema,
      }),
    onSuccess: async (result, input) => {
      const nextProviders = withoutEditableModel(
        providersRef.current,
        input.formKey
      )
      const localDefaultStillAvailable = nextProviders
        .flatMap((provider) => provider.models)
        .some((model) => model.id === defaultModel && model.enabled)
      const nextDefaultModel = resolveEditableDefaultModel(
        nextProviders,
        localDefaultStillAvailable
          ? defaultModel
          : result.settings.default_model
      )
      const nextTitleModel = resolveEditableSystemChatModel(
        nextProviders,
        result.settings.title_model
      )
      revisionRef.current = result.settings.revision
      setRevision(result.settings.revision)
      setProviders(nextProviders)
      setDefaultModel(nextDefaultModel)
      setTitleModel(nextTitleModel)
      setDeleteModelKey(null)
      setApiError(null)
      notify.success(t("admin.modelProvider.modelDeleted"), {
        id: "model-provider-model-deleted",
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "model-provider-settings"],
        refetchType: "none",
      })
      await queryClient.invalidateQueries({
        queryKey: ["me", "model-preference"],
      })
    },
    onError: (nextError) => {
      const message = getErrorMessage(nextError, t)
      setApiError(message)
      notify.error(message, { id: "model-provider-model-delete-error" })
    },
  })

  const deleteProviderMutation = useMutation({
    mutationFn: (input: {
      formKey: string
      persistedId: string
      expectedRevision: number
    }) =>
      apiRequest("/admin/model-provider-settings/providers", {
        method: "DELETE",
        body: {
          expected_revision: input.expectedRevision,
          provider_id: input.persistedId,
        },
        schema: modelProviderSettingsUpdateResultSchema,
      }),
    onSuccess: async (result, input) => {
      const nextProviders = withoutEditableProvider(
        providersRef.current,
        input.formKey
      )
      const nextDefaultModel = resolveEditableDefaultModel(
        nextProviders,
        result.settings.default_model
      )
      const nextTitleModel = resolveEditableSystemChatModel(
        nextProviders,
        result.settings.title_model
      )
      revisionRef.current = result.settings.revision
      setRevision(result.settings.revision)
      setProviders(nextProviders)
      setDefaultModel(nextDefaultModel)
      setTitleModel(nextTitleModel)
      setDeleteProviderKey(null)
      setApiError(null)
      notify.success(t("admin.modelProvider.providerDeleted"), {
        id: "model-provider-deleted",
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "model-provider-settings"],
        refetchType: "none",
      })
      await queryClient.invalidateQueries({
        queryKey: ["me", "model-preference"],
      })
    },
    onError: (nextError) => {
      const message = getErrorMessage(nextError, t)
      setApiError(message)
      notify.error(message, { id: "model-provider-delete-error" })
    },
  })

  const pendingSaveTargets = useMutationState({
    filters: {
      mutationKey: modelProviderSettingsSaveMutationKey,
      status: "pending",
    },
    select: (pendingMutation) =>
      (
        pendingMutation.state.variables as
          ModelProviderSettingsSaveInput | undefined
      )?.saveTarget,
  })
  const conflictingMutationPending =
    availabilityMutation.isPending ||
    deleteModelMutation.isPending ||
    deleteProviderMutation.isPending
  const anyMutationPending =
    pendingSaveTargets.length > 0 || conflictingMutationPending
  const isSaveTargetPending = (target: ModelProviderSettingsSaveTarget) =>
    pendingSaveTargets.includes(target)

  const saveModelProviderSettings = ({
    includeDraftModelFormKey,
    saveTarget = "form",
  }: {
    includeDraftModelFormKey?: string
    saveTarget?: ModelProviderSettingsSaveTarget
  } = {}) => {
    if (readOnly || !formValid || conflictingMutationPending) return
    const nextDraft = includeDraftModelFormKey
      ? createModelProviderSettingsDraft({
          providers,
          defaultModel,
          titleModel,
          tokenLimits: settings.token_limits,
          includeDraftModelFormKey,
        })
      : draft
    setApiError(null)
    mutation.mutate({
      ...nextDraft,
      saveTarget,
    })
  }

  return (
    <section
      className="grid min-w-0 gap-4"
      aria-labelledby={`${idPrefix}-model-provider-title`}
    >
      {apiError && <StatusBanner variant="error">{apiError}</StatusBanner>}

      <form
        className="grid max-w-none gap-4"
        inert={readOnly}
        aria-disabled={readOnly}
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          saveModelProviderSettings()
        }}
      >
        <SettingsSectionHeader
          id={`${idPrefix}-model-provider-title`}
          title={t("admin.modelProvider.providers")}
          description={t("admin.modelProvider.providersDescription")}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={readOnly || providers.length >= 20}
              onClick={() => {
                const model = createDraftModel()
                const providerNumber = nextProviderNumber.current
                const providerId = createUniqueProviderId()
                const formKey = `${idPrefix}-draft-provider-${nextFormKey.current}`
                nextFormKey.current += 1
                pendingProviderScrollKey.current = formKey
                setProviders((current) => [
                  ...current,
                  {
                    id: providerId,
                    name: t("admin.modelProvider.providerTitle", {
                      index: providerNumber,
                    }),
                    provider: "openai_compatible",
                    provider_project: null,
                    provider_location: null,
                    base_url: "",
                    protocol_mode: "native_responses",
                    api_key_configured: false,
                    apiKey: "",
                    formKey,
                    persistedId: null,
                    models: [{ ...model, draftTouched: true }],
                  },
                ])
                nextProviderNumber.current = Math.max(
                  nextProviderNumber.current,
                  providerNumber + 1
                )
              }}
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              {t("admin.modelProvider.addProvider")}
            </Button>
          }
        />

        <div className="flex flex-col gap-4">
          {providers.map((provider, providerIndex) => {
            const providerTitleId = `${provider.formKey}-title`
            const providerName =
              provider.name ||
              t("admin.modelProvider.providerTitle", {
                index: providerIndex + 1,
              })
            const selectedServiceProvider = serviceProviderItems.find(
              (item) => item.value === provider.provider
            )
            const providerSaveTarget = `provider:${provider.formKey}` as const
            const providerSaving = isSaveTargetPending(providerSaveTarget)
            return (
              <Card
                key={provider.formKey}
                ref={(node) => {
                  if (node) {
                    providerCardRefs.current.set(provider.formKey, node)
                  } else {
                    providerCardRefs.current.delete(provider.formKey)
                  }
                }}
                size="sm"
                className="scroll-mt-4"
                role="group"
                aria-labelledby={providerTitleId}
              >
                <CardHeader>
                  <div className="flex min-w-0 items-center gap-1">
                    <CardTitle
                      id={providerTitleId}
                      className="min-w-0 truncate"
                    >
                      {providerName}
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("admin.modelProvider.renameProvider", {
                        name: providerName,
                      })}
                      title={t("admin.modelProvider.renameProvider", {
                        name: providerName,
                      })}
                      disabled={readOnly}
                      onClick={() => {
                        setRenameProviderKey(provider.formKey)
                        setRenameProviderValue(providerName)
                      }}
                    >
                      <PencilIcon
                        className="text-muted-foreground/70"
                        data-icon="inline-end"
                        aria-hidden="true"
                      />
                    </Button>
                  </div>
                  <CardDescription className="form-hint">
                    {t("admin.modelProvider.providerDescription", {
                      count: provider.models.length,
                    })}
                  </CardDescription>
                  <CardAction className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      aria-busy={providerSaving || undefined}
                      aria-label={t("admin.modelProvider.saveProvider", {
                        name: providerName,
                      })}
                      title={t("admin.modelProvider.saveProvider", {
                        name: providerName,
                      })}
                      disabled={
                        readOnly ||
                        !formValid ||
                        conflictingMutationPending ||
                        providerSaving
                      }
                      onClick={() =>
                        saveModelProviderSettings({
                          saveTarget: providerSaveTarget,
                        })
                      }
                    >
                      {providerSaving && <Spinner data-icon="inline-start" />}
                      {t("common.save")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("admin.modelProvider.deleteProvider", {
                        name: providerName,
                      })}
                      title={t("admin.modelProvider.deleteProvider", {
                        name: providerName,
                      })}
                      disabled={
                        readOnly || providers.length === 1 || anyMutationPending
                      }
                      onClick={() => setDeleteProviderKey(provider.formKey)}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </CardAction>
                </CardHeader>

                <CardContent>
                  <FieldGroup className="gap-4">
                    <FieldGroup className="grid items-start gap-3 lg:grid-cols-2">
                      <FieldShell
                        id={`${provider.formKey}-provider`}
                        label={t("admin.modelProvider.serviceProvider")}
                      >
                        <Select
                          name={`${provider.formKey}-provider`}
                          items={serviceProviderItems}
                          value={provider.provider}
                          disabled={readOnly}
                          onValueChange={(value) =>
                            updateProvider(providerIndex, {
                              provider: value as ModelServiceProvider,
                              provider_project:
                                value === "google_vertex"
                                  ? provider.provider_project
                                  : null,
                              provider_location:
                                value === "google_vertex"
                                  ? provider.provider_location
                                  : null,
                            })
                          }
                        >
                          <SelectTrigger
                            id={`${provider.formKey}-provider`}
                            className="h-9 w-full"
                          >
                            <SelectValue>
                              <ModelServiceProviderLogo
                                provider={provider.provider}
                              />
                              {selectedServiceProvider?.label}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {serviceProviderItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  <ModelServiceProviderLogo
                                    provider={item.value}
                                  />
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldShell>
                      <FieldShell
                        id={`${provider.formKey}-base-url`}
                        label={t("admin.modelProvider.baseUrl")}
                      >
                        <Input
                          id={`${provider.formKey}-base-url`}
                          name={`${provider.formKey}-base-url`}
                          className="h-9"
                          type="url"
                          value={provider.base_url}
                          onChange={(event) =>
                            updateProvider(providerIndex, {
                              base_url: event.target.value,
                            })
                          }
                          placeholder="https://api.example.com/v1"
                          required
                        />
                      </FieldShell>
                      <FieldShell
                        id={`${provider.formKey}-api-key`}
                        label={t("admin.modelProvider.apiKey")}
                        hint={t(
                          provider.api_key_configured
                            ? "admin.modelProvider.apiKeyConfiguredHint"
                            : providerRequiresApiKey(provider, titleModel)
                              ? "admin.modelProvider.apiKeyRequiredHint"
                              : "admin.modelProvider.apiKeyOptionalHint"
                        )}
                      >
                        <Input
                          id={`${provider.formKey}-api-key`}
                          name={`${provider.formKey}-api-key`}
                          className="h-9 placeholder:text-foreground placeholder:opacity-100"
                          type="password"
                          value={provider.apiKey}
                          placeholder={
                            provider.api_key_configured
                              ? MASKED_API_KEY
                              : undefined
                          }
                          onChange={(event) =>
                            updateProvider(providerIndex, {
                              apiKey: event.target.value,
                            })
                          }
                          autoComplete="new-password"
                          required={
                            !provider.api_key_configured &&
                            providerRequiresApiKey(provider, titleModel)
                          }
                        />
                      </FieldShell>
                      <FieldShell
                        id={`${provider.formKey}-protocol-mode`}
                        label={t("admin.modelProvider.protocolMode")}
                        hint={t(
                          `admin.modelProvider.protocolModeHints.${provider.protocol_mode}`
                        )}
                      >
                        <Select
                          name={`${provider.formKey}-protocol-mode`}
                          items={protocolModeItems}
                          value={provider.protocol_mode}
                          disabled={readOnly}
                          onValueChange={(value) =>
                            updateProvider(providerIndex, {
                              protocol_mode: value as ModelProviderProtocolMode,
                            })
                          }
                        >
                          <SelectTrigger
                            id={`${provider.formKey}-protocol-mode`}
                            className="h-9 w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {protocolModeItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldShell>
                      {provider.provider === "google_vertex" && (
                        <>
                          <FieldShell
                            id={`${provider.formKey}-provider-project`}
                            label={t("admin.imageUnderstanding.project")}
                          >
                            <Input
                              id={`${provider.formKey}-provider-project`}
                              name={`${provider.formKey}-provider-project`}
                              value={provider.provider_project ?? ""}
                              onChange={(event) =>
                                updateProvider(providerIndex, {
                                  provider_project: event.target.value || null,
                                })
                              }
                              required
                            />
                          </FieldShell>
                          <FieldShell
                            id={`${provider.formKey}-provider-location`}
                            label={t("admin.imageUnderstanding.location")}
                          >
                            <Input
                              id={`${provider.formKey}-provider-location`}
                              name={`${provider.formKey}-provider-location`}
                              value={provider.provider_location ?? ""}
                              onChange={(event) =>
                                updateProvider(providerIndex, {
                                  provider_location: event.target.value || null,
                                })
                              }
                              required
                            />
                          </FieldShell>
                        </>
                      )}
                    </FieldGroup>

                    <div>
                      <h4 className="text-sm font-semibold">
                        {t("admin.modelProvider.models")}
                      </h4>
                      <p className="form-hint">
                        {t("admin.modelProvider.modelsDescription")}
                      </p>
                    </div>

                    <div
                      data-slot="model-card-list"
                      className="flex min-w-0 flex-col gap-3"
                    >
                      {provider.models.map((model, modelIndex) => {
                        const modelName =
                          model.display_name ||
                          t("admin.modelProvider.unnamedModel")
                        const defaultEffortItems =
                          model.kind === "chat"
                            ? model.supported_reasoning_efforts.map(
                                (effort) => ({
                                  label: t(`reasoningEffort.${effort}`),
                                  value: effort,
                                })
                              )
                            : []
                        const supportedEffortItems =
                          genericReasoningEffortValues.map((effort) => ({
                            label: t(`reasoningEffort.${effort}`),
                            value: effort,
                          }))
                        const selectedEffortSummary =
                          model.kind !== "chat"
                            ? ""
                            : model.supported_reasoning_efforts.length === 1
                              ? t(
                                  `reasoningEffort.${model.supported_reasoning_efforts[0]}`
                                )
                              : t("admin.modelProvider.selectedEfforts", {
                                  count:
                                    model.supported_reasoning_efforts.length,
                                })
                        const contextWindowInput =
                          model.kind === "chat"
                            ? getContextWindowInput(model)
                            : ""
                        const contextWindowError =
                          model.kind === "chat" &&
                          !isValidContextWindowInput(contextWindowInput)
                            ? t("admin.modelProvider.contextWindowInvalid")
                            : undefined
                        const hasNextModel =
                          modelIndex < provider.models.length - 1
                        const hasAvailabilitySwitch = model.kind === "chat"
                        const availabilityLabel = t(
                          "admin.modelProvider.showInComposer"
                        )
                        const modelSaveTarget =
                          `model:${model.formKey}` as const
                        const modelSaving = isSaveTargetPending(modelSaveTarget)
                        return (
                          <Fragment key={model.formKey}>
                            <FieldSet className="@container/model-card gap-3 rounded-xl border border-border/60 bg-card p-3">
                              <FieldLegend className="sr-only">
                                {modelName}
                              </FieldLegend>
                              <div
                                className={cn(
                                  "grid items-center gap-2",
                                  hasAvailabilitySwitch
                                    ? "grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                                    : "grid-cols-[minmax(0,1fr)_auto_auto]"
                                )}
                              >
                                <h5 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                                  <BotIcon
                                    className="size-4 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                    data-model-title-icon=""
                                  />
                                  <span className="truncate">{modelName}</span>
                                </h5>
                                {hasAvailabilitySwitch ? (
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Switch
                                      id={`${model.formKey}-enabled`}
                                      name={`${model.formKey}-enabled`}
                                      checked={
                                        availabilityMutation.isPending &&
                                        availabilityMutation.variables
                                          ?.formKey === model.formKey
                                          ? availabilityMutation.variables
                                              .enabled
                                          : model.enabled
                                      }
                                      disabled={
                                        readOnly ||
                                        pendingSaveTargets.length > 0 ||
                                        availabilityMutation.isPending ||
                                        deleteModelMutation.isPending ||
                                        deleteProviderMutation.isPending
                                      }
                                      onCheckedChange={(checked) => {
                                        setApiError(null)
                                        if (model.persistedId) {
                                          availabilityMutation.mutate({
                                            formKey: model.formKey,
                                            persistedId: model.persistedId,
                                            enabled: checked,
                                            expectedRevision: revision,
                                          })
                                          return
                                        }
                                        updateModel(providerIndex, modelIndex, {
                                          enabled: checked,
                                        })
                                      }}
                                    />
                                    <Label
                                      htmlFor={`${model.formKey}-enabled`}
                                      className="text-xs"
                                    >
                                      {availabilityLabel}
                                    </Label>
                                  </div>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  aria-busy={modelSaving || undefined}
                                  aria-label={t(
                                    "admin.modelProvider.saveModel",
                                    {
                                      name: modelName,
                                    }
                                  )}
                                  title={t("admin.modelProvider.saveModel", {
                                    name: modelName,
                                  })}
                                  disabled={
                                    readOnly ||
                                    !formValid ||
                                    conflictingMutationPending ||
                                    modelSaving
                                  }
                                  onClick={() =>
                                    saveModelProviderSettings({
                                      includeDraftModelFormKey: model.formKey,
                                      saveTarget: modelSaveTarget,
                                    })
                                  }
                                >
                                  {modelSaving && (
                                    <Spinner data-icon="inline-start" />
                                  )}
                                  {t("common.save")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t(
                                    "admin.modelProvider.deleteModel",
                                    {
                                      name: modelName,
                                    }
                                  )}
                                  title={t("admin.modelProvider.deleteModel", {
                                    name: modelName,
                                  })}
                                  disabled={
                                    readOnly ||
                                    provider.models.length === 1 ||
                                    anyMutationPending
                                  }
                                  onClick={() => {
                                    if (model.persistedId) {
                                      setDeleteModelKey(model.formKey)
                                      return
                                    }
                                    removeLocalModel(model.formKey)
                                  }}
                                >
                                  <Trash2Icon aria-hidden="true" />
                                </Button>
                              </div>

                              <FieldGroup className="grid grid-cols-1 items-start gap-3 @xl/model-card:grid-cols-2 @2xl/model-card:grid-cols-3 @4xl/model-card:grid-cols-4">
                                <FieldShell
                                  id={`${model.formKey}-id`}
                                  label={t("admin.modelProvider.modelId")}
                                >
                                  <Input
                                    id={`${model.formKey}-id`}
                                    name={`${model.formKey}-id`}
                                    value={model.id}
                                    onChange={(event) => {
                                      const previousId = model.id
                                      const nextId = event.target.value
                                      updateModel(providerIndex, modelIndex, {
                                        id: nextId,
                                      })
                                      if (defaultModel === previousId) {
                                        setDefaultModel(nextId)
                                      }
                                      if (titleModel === previousId) {
                                        setTitleModel(nextId)
                                      }
                                    }}
                                    required
                                  />
                                </FieldShell>
                                <FieldShell
                                  id={`${model.formKey}-name`}
                                  label={t("admin.modelProvider.displayName")}
                                >
                                  <Input
                                    id={`${model.formKey}-name`}
                                    name={`${model.formKey}-name`}
                                    value={model.display_name}
                                    onChange={(event) =>
                                      updateModel(providerIndex, modelIndex, {
                                        display_name: event.target.value,
                                      })
                                    }
                                    required
                                  />
                                </FieldShell>
                                <FieldShell
                                  id={`${model.formKey}-kind`}
                                  label={t("admin.modelProvider.modelKind")}
                                >
                                  <Select
                                    name={`${model.formKey}-kind`}
                                    items={modelKindItems}
                                    value={model.kind}
                                    disabled={readOnly}
                                    onValueChange={(value) => {
                                      const kind = value as ManagedModelKind
                                      updateModelKind(
                                        providerIndex,
                                        modelIndex,
                                        kind
                                      )
                                      if (
                                        kind !== "chat" &&
                                        defaultModel === model.id
                                      ) {
                                        setDefaultModel(
                                          allModels.find(
                                            (candidate) =>
                                              candidate.kind === "chat" &&
                                              candidate.enabled &&
                                              candidate.id !== model.id
                                          )?.id ?? ""
                                        )
                                      } else if (
                                        kind === "chat" &&
                                        !defaultModel
                                      ) {
                                        setDefaultModel(model.id)
                                      }
                                      if (
                                        kind !== "chat" &&
                                        titleModel === model.id
                                      ) {
                                        setTitleModel(
                                          allModels.find(
                                            (candidate) =>
                                              candidate.kind === "chat" &&
                                              candidate.enabled &&
                                              candidate.id !== model.id
                                          )?.id ?? ""
                                        )
                                      } else if (
                                        kind === "chat" &&
                                        !titleModel
                                      ) {
                                        setTitleModel(model.id)
                                      }
                                    }}
                                  >
                                    <SelectTrigger
                                      id={`${model.formKey}-kind`}
                                      className="w-full"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {modelKindItems.map((item) => (
                                          <SelectItem
                                            key={item.value}
                                            value={item.value}
                                          >
                                            {item.label}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </FieldShell>
                                <FieldShell
                                  id={`${model.formKey}-input-price`}
                                  label={t("admin.modelProvider.inputPrice")}
                                >
                                  <ModelTokenPriceInput
                                    id={`${model.formKey}-input-price`}
                                    name={`${model.formKey}-input-price`}
                                    unitLabel={t(
                                      "admin.modelProvider.priceUnit"
                                    )}
                                    type="number"
                                    min="0"
                                    max="9999999999.999999"
                                    step="0.000001"
                                    inputMode="decimal"
                                    value={model.input_price_per_million}
                                    onChange={(event) =>
                                      updateModel(providerIndex, modelIndex, {
                                        input_price_per_million:
                                          event.target.value,
                                      })
                                    }
                                    required
                                  />
                                </FieldShell>
                                {model.kind === "chat" && (
                                  <>
                                    <FieldShell
                                      id={`${model.formKey}-cached-input-price`}
                                      label={t(
                                        "admin.modelProvider.cachedInputPrice"
                                      )}
                                    >
                                      <ModelTokenPriceInput
                                        id={`${model.formKey}-cached-input-price`}
                                        name={`${model.formKey}-cached-input-price`}
                                        unitLabel={t(
                                          "admin.modelProvider.priceUnit"
                                        )}
                                        type="number"
                                        min="0"
                                        max="9999999999.999999"
                                        step="0.000001"
                                        inputMode="decimal"
                                        value={
                                          model.cached_input_price_per_million
                                        }
                                        onChange={(event) =>
                                          updateModel(
                                            providerIndex,
                                            modelIndex,
                                            {
                                              cached_input_price_per_million:
                                                event.target.value,
                                            }
                                          )
                                        }
                                        required
                                      />
                                    </FieldShell>
                                    <FieldShell
                                      id={`${model.formKey}-output-price`}
                                      label={t(
                                        "admin.modelProvider.outputPrice"
                                      )}
                                    >
                                      <ModelTokenPriceInput
                                        id={`${model.formKey}-output-price`}
                                        name={`${model.formKey}-output-price`}
                                        unitLabel={t(
                                          "admin.modelProvider.priceUnit"
                                        )}
                                        type="number"
                                        min="0"
                                        max="9999999999.999999"
                                        step="0.000001"
                                        inputMode="decimal"
                                        value={model.output_price_per_million}
                                        onChange={(event) =>
                                          updateModel(
                                            providerIndex,
                                            modelIndex,
                                            {
                                              output_price_per_million:
                                                event.target.value,
                                            }
                                          )
                                        }
                                        required
                                      />
                                    </FieldShell>
                                    <FieldShell
                                      id={`${model.formKey}-context-window`}
                                      label={t(
                                        "admin.modelProvider.contextWindow"
                                      )}
                                      error={contextWindowError}
                                    >
                                      <Input
                                        id={`${model.formKey}-context-window`}
                                        name={`${model.formKey}-context-window`}
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={contextWindowInput}
                                        onChange={(event) =>
                                          updateModel(
                                            providerIndex,
                                            modelIndex,
                                            {
                                              contextWindowInput:
                                                event.target.value,
                                            }
                                          )
                                        }
                                        placeholder={t(
                                          "admin.modelProvider.contextWindowPlaceholder"
                                        )}
                                      />
                                    </FieldShell>
                                    <FieldShell
                                      id={`${model.formKey}-supported-efforts`}
                                      label={t(
                                        "admin.modelProvider.supportedEfforts"
                                      )}
                                    >
                                      <ReasoningEffortMultiSelect
                                        id={`${model.formKey}-supported-efforts`}
                                        label={t(
                                          "admin.modelProvider.supportedEfforts"
                                        )}
                                        values={
                                          model.supported_reasoning_efforts
                                        }
                                        options={supportedEffortItems}
                                        readOnly={readOnly}
                                        summary={selectedEffortSummary}
                                        onValueChange={(nextEfforts) =>
                                          updateModel(
                                            providerIndex,
                                            modelIndex,
                                            {
                                              supported_reasoning_efforts:
                                                nextEfforts,
                                              default_reasoning_effort:
                                                nextEfforts.includes(
                                                  model.default_reasoning_effort
                                                )
                                                  ? model.default_reasoning_effort
                                                  : nextEfforts[0],
                                            }
                                          )
                                        }
                                      />
                                    </FieldShell>
                                    <FieldShell
                                      id={`${model.formKey}-default-effort`}
                                      label={t(
                                        "admin.modelProvider.defaultEffort"
                                      )}
                                    >
                                      <Select
                                        name={`${model.formKey}-default-effort`}
                                        items={defaultEffortItems}
                                        value={model.default_reasoning_effort}
                                        disabled={readOnly}
                                        onValueChange={(value) =>
                                          updateModel(
                                            providerIndex,
                                            modelIndex,
                                            {
                                              default_reasoning_effort:
                                                value as ReasoningEffort,
                                            }
                                          )
                                        }
                                      >
                                        <SelectTrigger
                                          id={`${model.formKey}-default-effort`}
                                          className="w-full"
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectGroup>
                                            {defaultEffortItems.map((item) => (
                                              <SelectItem
                                                key={item.value}
                                                value={item.value}
                                              >
                                                {item.label}
                                              </SelectItem>
                                            ))}
                                          </SelectGroup>
                                        </SelectContent>
                                      </Select>
                                    </FieldShell>
                                    <div
                                      className="flex items-center gap-2 self-end pb-2"
                                      data-model-image-input-setting=""
                                    >
                                      <Switch
                                        id={`${model.formKey}-supports-image-input`}
                                        name={`${model.formKey}-supports-image-input`}
                                        checked={model.supports_image_input}
                                        disabled={readOnly}
                                        onCheckedChange={(checked) =>
                                          updateModel(
                                            providerIndex,
                                            modelIndex,
                                            {
                                              supports_image_input: checked,
                                            }
                                          )
                                        }
                                      />
                                      <Label
                                        htmlFor={`${model.formKey}-supports-image-input`}
                                      >
                                        {t(
                                          "admin.modelProvider.supportsImageInput"
                                        )}
                                      </Label>
                                    </div>
                                  </>
                                )}
                              </FieldGroup>
                            </FieldSet>
                            {hasNextModel ? (
                              <Separator
                                aria-hidden="true"
                                data-model-card-divider=""
                              />
                            ) : null}
                          </Fragment>
                        )
                      })}
                      {provider.models.length > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto min-h-24 w-full flex-col gap-2 border-dashed text-muted-foreground hover:text-foreground"
                          data-model-add-card=""
                          disabled={readOnly || allModels.length >= 100}
                          onClick={() => {
                            const model = createDraftModel()
                            setProviders((current) =>
                              current.map((candidate, index) =>
                                index === providerIndex
                                  ? {
                                      ...candidate,
                                      models: [...candidate.models, model],
                                    }
                                  : candidate
                              )
                            )
                          }}
                        >
                          <PlusIcon className="size-5" aria-hidden="true" />
                          {t("admin.modelProvider.addModel")}
                        </Button>
                      ) : null}
                    </div>
                  </FieldGroup>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div
          className="flex max-w-[520px] flex-col gap-4"
          role="group"
          aria-label={t("admin.modelProvider.modelSelections")}
        >
          <FieldShell
            id={`${idPrefix}-default-model`}
            label={t("admin.modelProvider.defaultModel")}
            hint={t("admin.modelProvider.defaultModelHint")}
          >
            <Select
              name={`${idPrefix}-default-model`}
              items={defaultModelItems}
              value={defaultModel}
              disabled={
                readOnly ||
                availabilityMutation.isPending ||
                deleteModelMutation.isPending ||
                deleteProviderMutation.isPending
              }
              onValueChange={(value) => setDefaultModel(value ?? "")}
            >
              <SelectTrigger
                id={`${idPrefix}-default-model`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {defaultModelItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell
            id={`${idPrefix}-title-model`}
            label={t("admin.modelProvider.titleModel")}
            hint={t("admin.modelProvider.titleModelHint")}
          >
            <Select
              name={`${idPrefix}-title-model`}
              items={titleModelItems}
              value={titleModel}
              disabled={
                readOnly ||
                availabilityMutation.isPending ||
                deleteModelMutation.isPending ||
                deleteProviderMutation.isPending
              }
              onValueChange={(value) => setTitleModel(value ?? "")}
            >
              <SelectTrigger id={`${idPrefix}-title-model`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {titleModelItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>
          <Button
            type="button"
            size="sm"
            className="w-auto self-start"
            aria-busy={isSaveTargetPending("selections") || undefined}
            aria-label={t("admin.modelProvider.saveModelSelections")}
            title={t("admin.modelProvider.saveModelSelections")}
            disabled={
              readOnly ||
              !formValid ||
              conflictingMutationPending ||
              isSaveTargetPending("selections")
            }
            onClick={() =>
              saveModelProviderSettings({ saveTarget: "selections" })
            }
          >
            {isSaveTargetPending("selections") && (
              <Spinner data-icon="inline-start" />
            )}
            {t("common.save")}
          </Button>
        </div>
      </form>

      <Dialog
        open={renameProvider !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameProviderKey(null)
            setRenameProviderValue("")
          }
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>
              {t("admin.modelProvider.renameProviderTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.modelProvider.renameProviderDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (!renameProvider || !normalizedRenameProviderName) return
              setProviders((current) =>
                current.map((provider) =>
                  provider.formKey === renameProvider.formKey
                    ? { ...provider, name: normalizedRenameProviderName }
                    : provider
                )
              )
              setRenameProviderKey(null)
              setRenameProviderValue("")
            }}
          >
            <FieldShell
              id={`${idPrefix}-rename-provider`}
              label={t("admin.modelProvider.providerName")}
            >
              <Input
                id={`${idPrefix}-rename-provider`}
                name={`${idPrefix}-rename-provider`}
                value={renameProviderValue}
                maxLength={120}
                onChange={(event) => setRenameProviderValue(event.target.value)}
                autoFocus={shouldAutoFocusOnDesktop()}
                required
              />
            </FieldShell>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  !normalizedRenameProviderName ||
                  normalizedRenameProviderName === renameProvider?.name
                }
              >
                {t("admin.modelProvider.renameProviderAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteModelContext !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteModelKey(null)
        }}
        title={t("admin.modelProvider.deleteModelTitle", {
          name: deleteModelName,
        })}
        description={t("admin.modelProvider.deleteModelDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteModelMutation.isPending}
        onConfirm={() => {
          if (!deleteModelContext) return
          if (deleteModelContext.model.persistedId) {
            setApiError(null)
            deleteModelMutation.mutate({
              formKey: deleteModelContext.model.formKey,
              persistedId: deleteModelContext.model.persistedId,
              expectedRevision: revision,
            })
            return
          }
          removeLocalModel(deleteModelContext.model.formKey)
        }}
      />

      <ConfirmDialog
        open={deleteProvider !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteProviderKey(null)
        }}
        title={t("admin.modelProvider.deleteProviderTitle", {
          name: deleteProviderName,
        })}
        description={t("admin.modelProvider.deleteProviderDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteProviderMutation.isPending}
        onConfirm={() => {
          if (!deleteProvider) return
          if (deleteProvider.persistedId) {
            setApiError(null)
            deleteProviderMutation.mutate({
              formKey: deleteProvider.formKey,
              persistedId: deleteProvider.persistedId,
              expectedRevision: revision,
            })
            return
          }
          const nextProviders = withoutEditableProvider(
            providers,
            deleteProvider.formKey
          )
          setProviders(nextProviders)
          setDefaultModel(
            resolveEditableDefaultModel(nextProviders, defaultModel)
          )
          setTitleModel(
            resolveEditableSystemChatModel(nextProviders, titleModel)
          )
          setDeleteProviderKey(null)
          notify.success(t("admin.modelProvider.providerDeleted"), {
            id: "model-provider-deleted",
          })
        }}
      />
    </section>
  )
}
