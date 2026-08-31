import { useId, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { apiRequest } from "@/api/client"
import {
  knowledgeModelSettingsUpdateResultSchema,
  type KnowledgeModelSettings,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
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

export function KnowledgeModelSettingsForm({
  settings,
  modelSettings,
}: {
  settings: KnowledgeModelSettings
  modelSettings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const readOnly = modelSettings.management_enabled === false
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const embeddingModels = modelSettings.providers
    .flatMap((provider) => provider.models)
    .filter((model) => model.kind === "embedding")
  const rerankerModels = modelSettings.providers
    .flatMap((provider) => provider.models)
    .filter((model) => model.kind === "reranker")
  const [embeddingModel, setEmbeddingModel] = useState(
    settings.embedding.model ?? embeddingModels[0]?.id ?? ""
  )
  const [rerankEnabled, setRerankEnabled] = useState(settings.rerank.enabled)
  const [rerankModel, setRerankModel] = useState(
    settings.rerank.model ?? rerankerModels[0]?.id ?? ""
  )
  const [embeddingChangeConfirmationOpen, setEmbeddingChangeConfirmationOpen] =
    useState(false)
  const [rebuildRequired, setRebuildRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const embeddingModelChanged =
    settings.embedding.configured &&
    settings.embedding.model !== null &&
    settings.embedding.model !== embeddingModel
  const valid =
    embeddingModels.some((model) => model.id === embeddingModel) &&
    (!rerankEnabled || rerankerModels.some((model) => model.id === rerankModel))

  const mutation = useMutation({
    mutationFn: (variables: {
      embeddingModelChanged: boolean
      embeddingModel: string
      rerankEnabled: boolean
      rerankModel: string
    }) =>
      apiRequest("/admin/knowledge-model-settings", {
        method: "PUT",
        body: {
          expected_revision: settings.revision,
          embedding: { model: variables.embeddingModel },
          rerank: {
            enabled: variables.rerankEnabled,
            model: variables.rerankEnabled
              ? variables.rerankModel
              : variables.rerankModel || null,
          },
        },
        schema: knowledgeModelSettingsUpdateResultSchema,
      }),
    onSuccess: async (result, variables) => {
      setError(null)
      if (variables.embeddingModelChanged) setRebuildRequired(true)
      queryClient.setQueryData(
        ["admin", "knowledge-model-settings"],
        result.settings
      )
      notify.success(t("admin.knowledgeModels.saved"), {
        description: t(
          variables.embeddingModelChanged
            ? "admin.knowledgeModels.savedAfterEmbeddingChangeDescription"
            : "admin.knowledgeModels.savedDescription"
        ),
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "knowledge-model-settings"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "health"] }),
      ])
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const save = (changedEmbeddingModel: boolean) => {
    mutation.mutate({
      embeddingModelChanged: changedEmbeddingModel,
      embeddingModel,
      rerankEnabled,
      rerankModel,
    })
  }

  return (
    <section
      className="grid min-w-0 gap-4"
      aria-labelledby={`${idPrefix}-title`}
    >
      <SettingsSectionHeader
        id={`${idPrefix}-title`}
        title={t("admin.knowledgeModels.title")}
        description={t("admin.knowledgeModels.selectionDescription")}
      />

      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {embeddingModels.length === 0 && (
        <StatusBanner variant="warning">
          {t("admin.knowledgeModels.noEmbeddingModels")}
        </StatusBanner>
      )}

      <form
        className="grid max-w-none gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (readOnly) return
          setError(null)
          if (embeddingModelChanged) {
            setEmbeddingChangeConfirmationOpen(true)
            return
          }
          save(false)
        }}
      >
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <legend className="p-0 text-sm leading-5 font-semibold">
              {t("admin.knowledgeModels.embeddingTitle")}
            </legend>
            <p className="form-hint xl:min-h-10">
              {t("admin.knowledgeModels.embeddingSelectionDescription")}
            </p>
            <FieldShell
              id={`${idPrefix}-embedding-model`}
              label={t("admin.knowledgeModels.selectEmbeddingModel")}
            >
              <Select
                name="knowledge-embedding-model"
                items={embeddingModels.map((model) => ({
                  value: model.id,
                  label: model.display_name,
                }))}
                value={embeddingModel}
                disabled={readOnly}
                onValueChange={(value) => setEmbeddingModel(value ?? "")}
              >
                <SelectTrigger
                  id={`${idPrefix}-embedding-model`}
                  className="w-full"
                  disabled={readOnly}
                >
                  <SelectValue
                    placeholder={t(
                      "admin.knowledgeModels.embeddingModelPlaceholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {embeddingModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.display_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>
            <p className="form-hint mt-auto flex min-h-10 items-center rounded-lg bg-muted/35 px-3 py-2">
              {t("admin.knowledgeModels.embeddingRuntime", {
                dimensions: settings.embedding.dimensions,
                tokens: settings.embedding.maximum_input_tokens,
              })}
            </p>
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <legend className="p-0 text-sm leading-5 font-semibold">
              {t("admin.knowledgeModels.rerankTitle")}
            </legend>
            <div className="flex items-start justify-between gap-4 xl:min-h-10">
              <p className="form-hint">
                {t("admin.knowledgeModels.rerankSelectionDescription")}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  id={`${idPrefix}-rerank-enabled`}
                  name="knowledge-rerank-enabled"
                  checked={rerankEnabled}
                  disabled={readOnly || rerankerModels.length === 0}
                  onCheckedChange={setRerankEnabled}
                />
                <Label htmlFor={`${idPrefix}-rerank-enabled`}>
                  {t("admin.knowledgeModels.enabled")}
                </Label>
              </div>
            </div>
            <FieldShell
              id={`${idPrefix}-rerank-model`}
              label={t("admin.knowledgeModels.selectRerankerModel")}
            >
              <Select
                name="knowledge-rerank-model"
                items={rerankerModels.map((model) => ({
                  value: model.id,
                  label: model.display_name,
                }))}
                value={rerankModel}
                disabled={readOnly || !rerankEnabled}
                onValueChange={(value) => setRerankModel(value ?? "")}
              >
                <SelectTrigger
                  id={`${idPrefix}-rerank-model`}
                  className="w-full"
                  disabled={readOnly || !rerankEnabled}
                >
                  <SelectValue
                    placeholder={t(
                      "admin.knowledgeModels.rerankerModelPlaceholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {rerankerModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.display_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>
            <p className="form-hint mt-auto flex min-h-10 items-center rounded-lg bg-muted/35 px-3 py-2">
              {t("admin.knowledgeModels.rerankRuntime", {
                tokens: settings.rerank.maximum_input_tokens,
                timeout: settings.rerank.timeout_ms,
              })}
            </p>
          </fieldset>
        </div>

        <p className="form-hint">{t("admin.knowledgeModels.rebuildHint")}</p>
        <div>
          <Button
            type="submit"
            disabled={readOnly || !valid || mutation.isPending}
            aria-busy={mutation.isPending || undefined}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {mutation.isPending
              ? t("admin.knowledgeModels.validating")
              : t("admin.knowledgeModels.save")}
          </Button>
        </div>
      </form>

      {rebuildRequired && (
        <StatusBanner
          variant="warning"
          title={t("admin.knowledgeModels.rebuildRequiredTitle")}
          actions={
            <Link
              to="/admin/health"
              className="text-link text-sm font-medium whitespace-nowrap"
            >
              {t("admin.knowledgeModels.openSystemHealth")}
            </Link>
          }
        >
          {t("admin.knowledgeModels.rebuildRequiredDescription")}
        </StatusBanner>
      )}

      <ConfirmDialog
        open={embeddingChangeConfirmationOpen}
        onOpenChange={setEmbeddingChangeConfirmationOpen}
        title={t("admin.knowledgeModels.embeddingChangeConfirmTitle")}
        description={t(
          "admin.knowledgeModels.embeddingChangeConfirmDescription"
        )}
        destructiveNotice={t(
          "admin.knowledgeModels.embeddingChangeDangerNotice"
        )}
        confirmLabel={t("admin.knowledgeModels.embeddingChangeConfirmAction")}
        destructive
        pending={mutation.isPending}
        onConfirm={() => {
          setEmbeddingChangeConfirmationOpen(false)
          save(true)
        }}
      />
    </section>
  )
}
