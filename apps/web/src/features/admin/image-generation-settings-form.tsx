import { useId, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  imageGenerationPricePerImageSchema,
  type ImageGenerationProvider,
} from "@linksense/shared"
import type { IconType } from "react-icons"
import { SiAlibabacloud, SiGooglegemini, SiReplicate } from "react-icons/si"
import { TbBrandOpenai } from "react-icons/tb"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  imageGenerationSettingsUpdateResultSchema,
  type ImageGenerationSettings,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"

const MASKED_API_KEY = "••••••••••••"

type ProviderOptionKey = ImageGenerationProvider | ""

const imageGenerationProviderIcons: Partial<
  Record<ImageGenerationProvider, IconType>
> = {
  alibaba_bailian: SiAlibabacloud,
  openai: TbBrandOpenai,
  google_gemini: SiGooglegemini,
  replicate: SiReplicate,
}

const imageGenerationProviderLogoClasses: Record<
  ImageGenerationProvider,
  string
> = {
  alibaba_bailian: "text-provider-alibaba",
  openai: "text-provider-openai",
  google_gemini: "text-provider-google-gemini",
  stability: "bg-foreground text-background",
  fal: "bg-foreground text-background",
  replicate: "text-foreground",
  together: "bg-foreground text-background",
}

const imageGenerationProviderFallbackMarks: Partial<
  Record<ImageGenerationProvider, string>
> = {
  stability: "S",
  fal: "fal",
  together: "T",
}

function ImageGenerationProviderLogo({
  provider,
}: {
  provider: ImageGenerationProvider
}) {
  const Logo = imageGenerationProviderIcons[provider]
  if (Logo) {
    return (
      <Logo
        aria-hidden="true"
        className={imageGenerationProviderLogoClasses[provider]}
        data-image-generation-provider-logo={provider}
        focusable="false"
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] leading-none font-bold ${imageGenerationProviderLogoClasses[provider]}`}
      data-image-generation-provider-logo={provider}
    >
      {imageGenerationProviderFallbackMarks[provider]}
    </span>
  )
}

export function ImageGenerationSettingsForm({
  settings,
  modelSettings,
}: {
  settings: ImageGenerationSettings
  modelSettings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const readOnly = modelSettings.management_enabled === false
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const [revision, setRevision] = useState(settings.revision)
  const [enabled, setEnabled] = useState(settings.enabled)
  const [provider, setProvider] = useState<ProviderOptionKey>(
    settings.provider ?? ""
  )
  const [workspaceId, setWorkspaceId] = useState(
    settings.provider_options.workspace_id ?? ""
  )
  const [region, setRegion] = useState(settings.provider_options.region ?? "")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(settings.model ?? "")
  const [pricePerImage, setPricePerImage] = useState(settings.price_per_image)
  const [error, setError] = useState<string | null>(null)

  const providerDefinition = useMemo(
    () =>
      provider
        ? (settings.providers.find((candidate) => candidate.key === provider) ??
          null)
        : null,
    [provider, settings.providers]
  )
  const providerChanged = provider !== (settings.provider ?? "")
  const apiKeyConfiguredForProvider =
    settings.api_key_configured && !providerChanged
  const baseUrlPreview = providerDefinition
    ? resolveBaseUrlPreview(providerDefinition.base_url, workspaceId, region)
    : ""
  const formValid =
    !enabled ||
    (provider !== "" &&
      Boolean(model.trim()) &&
      imageGenerationPricePerImageSchema.safeParse(pricePerImage).success &&
      (!providerDefinition?.requires_workspace_id ||
        Boolean(workspaceId.trim())) &&
      (!providerDefinition?.requires_region || Boolean(region.trim())) &&
      (apiKeyConfiguredForProvider || Boolean(apiKey.trim())))

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/admin/image-generation-settings", {
        method: "PUT",
        body: {
          expected_revision: revision,
          enabled,
          provider: provider || null,
          provider_options: {
            workspace_id: workspaceId.trim() || null,
            region: region.trim() || null,
          },
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          model: model.trim() || null,
          price_per_image: pricePerImage.trim() || "0",
        },
        schema: imageGenerationSettingsUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      setError(null)
      setRevision(result.settings.revision)
      setEnabled(result.settings.enabled)
      setProvider(result.settings.provider ?? "")
      setWorkspaceId(result.settings.provider_options.workspace_id ?? "")
      setRegion(result.settings.provider_options.region ?? "")
      setApiKey("")
      setModel(result.settings.model ?? "")
      setPricePerImage(result.settings.price_per_image)
      queryClient.setQueryData(
        ["admin", "image-generation-settings"],
        result.settings
      )
      notify.success(t("admin.imageGeneration.saved"), {
        id: "image-generation-settings-saved",
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "image-generation-settings"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "health"] }),
      ])
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const providerItems = settings.providers.map((candidate) => ({
    value: candidate.key,
    label: t(`admin.imageGeneration.providers.${candidate.key}`),
  }))
  const selectedProviderItem = providerItems.find(
    (item) => item.value === provider
  )

  return (
    <section
      className="grid min-w-0 gap-3"
      aria-labelledby={`${idPrefix}-title`}
    >
      <SettingsSectionHeader
        id={`${idPrefix}-title`}
        title={t("admin.imageGeneration.title")}
        description={t("admin.imageGeneration.description")}
      />
      <form
        className="grid w-full gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (readOnly || !formValid) return
          setError(null)
          mutation.mutate()
        }}
      >
        <div
          data-slot="model-settings-card"
          className="grid min-w-0 gap-4 rounded-card border border-[color:var(--app-border)] bg-card p-4 sm:p-5"
        >
          {error && <StatusBanner variant="error">{error}</StatusBanner>}

          <SettingsFieldGroup>
            <FieldShell
              layout="settings"
              id={`${idPrefix}-provider`}
              controlWidth="medium"
              label={t("admin.imageGeneration.provider")}
              hint={t("admin.imageGeneration.providerHint")}
            >
              <Select
                name="image-generation-provider"
                items={providerItems}
                value={provider}
                disabled={readOnly}
                onValueChange={(value) => {
                  const nextProvider = (value ?? "") as ProviderOptionKey
                  const definition = settings.providers.find(
                    (candidate) => candidate.key === nextProvider
                  )
                  setProvider(nextProvider)
                  setModel(definition?.default_model ?? "")
                  setRegion(definition?.default_region ?? "")
                  if (nextProvider !== "alibaba_bailian") setWorkspaceId("")
                  setApiKey("")
                }}
              >
                <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
                  {provider && selectedProviderItem ? (
                    <SelectValue
                      placeholder={t(
                        "admin.imageGeneration.providerPlaceholder"
                      )}
                    >
                      <ImageGenerationProviderLogo provider={provider} />
                      {selectedProviderItem.label}
                    </SelectValue>
                  ) : (
                    <SelectValue
                      placeholder={t(
                        "admin.imageGeneration.providerPlaceholder"
                      )}
                    />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {providerItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        <ImageGenerationProviderLogo provider={item.value} />
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell
              layout="settings"
              id={`${idPrefix}-base-url`}
              controlWidth="wide"
              label={t("admin.imageGeneration.baseUrl")}
              hint={t("admin.imageGeneration.baseUrlHint")}
            >
              <Input
                id={`${idPrefix}-base-url`}
                name="image-generation-base-url"
                value={baseUrlPreview}
                readOnly
                disabled
              />
            </FieldShell>
            {providerDefinition?.requires_workspace_id && (
              <>
                <FieldShell
                  layout="settings"
                  id={`${idPrefix}-workspace-id`}
                  controlWidth="medium"
                  label={t("admin.imageGeneration.workspaceId")}
                  hint={t("admin.imageGeneration.workspaceIdHint")}
                >
                  <Input
                    id={`${idPrefix}-workspace-id`}
                    name="image-generation-workspace-id"
                    value={workspaceId}
                    disabled={readOnly}
                    onChange={(event) => setWorkspaceId(event.target.value)}
                    required={enabled}
                  />
                </FieldShell>
                <FieldShell
                  layout="settings"
                  id={`${idPrefix}-region`}
                  controlWidth="medium"
                  label={t("admin.imageGeneration.region")}
                  hint={t("admin.imageGeneration.regionHint")}
                >
                  <Input
                    id={`${idPrefix}-region`}
                    name="image-generation-region"
                    value={region}
                    disabled={readOnly}
                    onChange={(event) => setRegion(event.target.value)}
                    placeholder={providerDefinition.default_region ?? undefined}
                    required={enabled}
                  />
                </FieldShell>
              </>
            )}
            <FieldShell
              layout="settings"
              id={`${idPrefix}-api-key`}
              controlWidth="wide"
              label={t("admin.imageGeneration.apiKey")}
              hint={
                apiKeyConfiguredForProvider
                  ? t("admin.imageGeneration.apiKeyConfiguredHint")
                  : t("admin.imageGeneration.apiKeyRequiredHint")
              }
            >
              <Input
                id={`${idPrefix}-api-key`}
                name="image-generation-api-key"
                className="placeholder:text-foreground placeholder:opacity-100"
                type="password"
                value={apiKey}
                disabled={readOnly}
                placeholder={apiKeyConfiguredForProvider ? MASKED_API_KEY : ""}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="new-password"
                required={enabled && !apiKeyConfiguredForProvider}
              />
            </FieldShell>
            <FieldShell
              layout="settings"
              id={`${idPrefix}-model`}
              controlWidth="medium"
              label={t("admin.imageGeneration.model")}
              hint={t("admin.imageGeneration.modelHint")}
            >
              <Input
                id={`${idPrefix}-model`}
                name="image-generation-model"
                value={model}
                disabled={readOnly}
                onChange={(event) => setModel(event.target.value)}
                required={enabled}
              />
            </FieldShell>
            <FieldShell
              layout="settings"
              id={`${idPrefix}-price-per-image`}
              controlWidth="compact"
              label={t("admin.imageGeneration.pricePerImage")}
              hint={t("admin.imageGeneration.pricePerImageHint")}
            >
              <Input
                id={`${idPrefix}-price-per-image`}
                name="image-generation-price-per-image"
                type="number"
                min="0"
                max="9999.999999"
                step="0.000001"
                inputMode="decimal"
                value={pricePerImage}
                disabled={readOnly}
                onChange={(event) => setPricePerImage(event.target.value)}
                required
              />
            </FieldShell>
            <SettingsFieldRow
              id={`${idPrefix}-enabled`}
              label={t("admin.imageGeneration.enabled")}
              controlWidth="compact"
            >
              <Switch
                id={`${idPrefix}-enabled`}
                name="image-generation-enabled"
                checked={enabled}
                disabled={readOnly}
                onCheckedChange={setEnabled}
              />
            </SettingsFieldRow>
          </SettingsFieldGroup>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              disabled={readOnly || !formValid || mutation.isPending}
              aria-busy={mutation.isPending || undefined}
            >
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {mutation.isPending
                ? t("admin.imageGeneration.saving")
                : t("admin.imageGeneration.save")}
            </Button>
          </div>
        </div>
      </form>
    </section>
  )
}

function resolveBaseUrlPreview(
  template: string,
  workspaceId: string,
  region: string
): string {
  return template
    .replace("{workspace_id}", workspaceId.trim() || "{workspace_id}")
    .replace("{region}", region.trim() || "{region}")
}
