import { useId, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  imageUnderstandingSettingsUpdateResultSchema,
  type ImageUnderstandingSettings,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
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

export function ImageUnderstandingSettingsForm({
  settings,
  modelSettings,
}: {
  settings: ImageUnderstandingSettings
  modelSettings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const readOnly = modelSettings.management_enabled === false
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const imageModels = modelSettings.providers
    .flatMap((provider) => provider.models)
    .filter((model) => model.kind === "chat" && model.supports_image_input)
  const [enabled, setEnabled] = useState(settings.enabled)
  const [model, setModel] = useState(settings.model ?? imageModels[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const formValid =
    !enabled || imageModels.some((candidate) => candidate.id === model)

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/admin/image-understanding-settings", {
        method: "PUT",
        body: {
          expected_revision: settings.revision,
          enabled,
          model: model || null,
        },
        schema: imageUnderstandingSettingsUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      setError(null)
      queryClient.setQueryData(
        ["admin", "image-understanding-settings"],
        result.settings
      )
      notify.success(t("admin.imageUnderstanding.saved"), {
        id: "image-understanding-settings-saved",
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "image-understanding-settings"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "health"] }),
      ])
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  return (
    <section
      className="mt-6 grid min-w-0 gap-4"
      aria-labelledby={`${idPrefix}-title`}
    >
      <form
        className="grid w-full gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (readOnly) return
          setError(null)
          mutation.mutate()
        }}
      >
        <div
          data-slot="model-settings-card"
          className="grid min-w-0 gap-4 rounded-2xl border border-[color:var(--app-border)] bg-card p-4"
        >
          <SettingsSectionHeader
            id={`${idPrefix}-title`}
            title={t("admin.imageUnderstanding.title")}
            description={t("admin.imageUnderstanding.selectionDescription")}
          />

          {error && <StatusBanner variant="error">{error}</StatusBanner>}
          {imageModels.length === 0 && (
            <StatusBanner variant="warning">
              {t("admin.imageUnderstanding.noImageModels")}
            </StatusBanner>
          )}

          <FieldShell
            id={`${idPrefix}-model`}
            label={t("admin.imageUnderstanding.selectModel")}
            hint={t("admin.imageUnderstanding.selectModelHint")}
          >
            <Select
              name="image-understanding-model"
              items={imageModels.map((candidate) => ({
                value: candidate.id,
                label: candidate.display_name,
              }))}
              value={model}
              disabled={readOnly}
              onValueChange={(value) => setModel(value ?? "")}
            >
              <SelectTrigger
                id={`${idPrefix}-model`}
                className="w-full"
                disabled={readOnly}
              >
                <SelectValue
                  placeholder={t("admin.imageUnderstanding.modelPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {imageModels.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.display_name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>

          <p className="form-hint">
            {settings.thinking_strategy
              ? t("admin.imageUnderstanding.activeStrategy")
              : t("admin.imageUnderstanding.strategyAfterValidation")}
          </p>

          <div
            data-slot="model-settings-toggle"
            className="flex items-center gap-2 pt-1"
          >
            <Switch
              id={`${idPrefix}-enabled`}
              name="image-understanding-enabled"
              checked={enabled}
              disabled={readOnly || imageModels.length === 0}
              onCheckedChange={setEnabled}
            />
            <Label htmlFor={`${idPrefix}-enabled`}>
              {t("admin.imageUnderstanding.enabled")}
            </Label>
          </div>
        </div>

        <div>
          <Button
            type="submit"
            disabled={readOnly || !formValid || mutation.isPending}
            aria-busy={mutation.isPending || undefined}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {mutation.isPending
              ? t("admin.imageUnderstanding.validating")
              : t("admin.imageUnderstanding.save")}
          </Button>
        </div>
      </form>
    </section>
  )
}
