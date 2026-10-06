import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  modelProviderProbeInputSchema,
  testModelProviderConnectionInputSchema,
  type DiscoveredProviderModel,
  type ModelProviderProbeInput,
  type TestModelProviderConnectionInput,
} from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
  useComboboxFilter,
} from "@/components/ui/combobox"
import {
  useDiscoverModels,
  useTestModelConnection,
} from "./use-model-provider-probe"

export function ModelDiscovery({
  input,
  credentialsReady,
  disabled,
  selectedId,
  onSelect,
  manualEntry,
}: {
  input: ModelProviderProbeInput
  credentialsReady: boolean
  disabled: boolean
  selectedId: string
  onSelect: (model: DiscoveredProviderModel) => void
  manualEntry?: {
    label: string
    onChange: (modelId: string) => void
  }
}) {
  const { t } = useTranslation()
  const id = useId()
  const mutation = useDiscoverModels(input)
  const [open, setOpen] = useState(false)
  const data = mutation.data
  const models = data?.models ?? []
  const selectionDisabled =
    disabled || (!manualEntry && (mutation.isPending || models.length === 0))
  const selected = models.find((model) => model.id === selectedId) ?? null
  const { contains } = useComboboxFilter()
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("modelSetup.discoveryHint")}
      </p>
      <FieldShell
        id={id}
        label={manualEntry?.label ?? t("modelSetup.selectModel")}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Combobox
            items={models}
            value={selected}
            open={open && (!manualEntry || models.length > 0)}
            onOpenChange={setOpen}
            filter={(model, query) =>
              contains(`${model.display_name} (${model.id})`, query)
            }
            inputValue={manualEntry ? selectedId : undefined}
            onInputValueChange={
              manualEntry
                ? (modelId, details) => {
                    // A custom ID is a valid value, not a search to discard on blur.
                    if (
                      details.reason === "input-clear" ||
                      details.reason === "none"
                    ) {
                      details.cancel()
                      return
                    }
                    manualEntry.onChange(modelId)
                  }
                : undefined
            }
            itemToStringLabel={(model) =>
              manualEntry ? model.id : `${model.display_name} (${model.id})`
            }
            itemToStringValue={(model) => model.id}
            disabled={selectionDisabled}
            onValueChange={(model) => {
              if (model) onSelect(model)
            }}
          >
            <ComboboxInput
              id={id}
              className="min-w-0 flex-1"
              disabled={selectionDisabled}
              maxLength={manualEntry ? 240 : undefined}
              showTrigger={!manualEntry || models.length > 0}
              placeholder={t("modelSetup.searchModels")}
            />
            <ComboboxContent>
              <ComboboxEmpty>{t("modelSetup.noMatches")}</ComboboxEmpty>
              <ComboboxList>
                {(model: DiscoveredProviderModel) => (
                  <ComboboxItem key={model.id} value={model}>
                    {model.display_name} ({model.id})
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            disabled={
              disabled ||
              mutation.isPending ||
              !credentialsReady ||
              !modelProviderProbeInputSchema.safeParse(input).success
            }
            aria-busy={mutation.isPending || undefined}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t(
              mutation.isPending
                ? "modelSetup.discovering"
                : "modelSetup.discover"
            )}
          </Button>
        </div>
      </FieldShell>
      {mutation.error && (
        <StatusBanner variant="error">
          {getErrorMessage(mutation.error, t)}
        </StatusBanner>
      )}
      {data && data.models.length === 0 && (
        <StatusBanner>
          {t(
            data.status === "manual_required"
              ? "modelSetup.manualRequired"
              : "modelSetup.noModels"
          )}
        </StatusBanner>
      )}
      {data && data.models.length > 0 && (
        <>
          {data.truncated && (
            <StatusBanner>{t("modelSetup.truncated")}</StatusBanner>
          )}
          {!manualEntry && (
            <p className="text-xs text-muted-foreground">
              {t("modelSetup.metadataHint")}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function ModelConnectionTest({
  input,
  credentialsReady,
  credentialsChanged = false,
  disabled,
}: {
  input: TestModelProviderConnectionInput
  credentialsReady: boolean
  credentialsChanged?: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  const mutation = useTestModelConnection(input)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("modelSetup.testHint")}
      </p>
      {credentialsChanged && (
        <StatusBanner variant="warning">
          {t("modelSetup.credentialsChanged")}
        </StatusBanner>
      )}
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={
          disabled ||
          mutation.isPending ||
          !credentialsReady ||
          !testModelProviderConnectionInputSchema.safeParse(input).success
        }
        aria-busy={mutation.isPending || undefined}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending && <Spinner data-icon="inline-start" />}
        {t(mutation.isPending ? "modelSetup.testing" : "modelSetup.test")}
      </Button>
      {mutation.error && (
        <StatusBanner variant="error">
          {getErrorMessage(mutation.error, t)}
        </StatusBanner>
      )}
      {mutation.data && (
        <StatusBanner
          variant={mutation.data.status === "success" ? "success" : "warning"}
        >
          {mutation.data.status === "success"
            ? t("modelSetup.testSuccess", { model: mutation.data.model_id })
            : t("modelSetup.testUnsupported")}
        </StatusBanner>
      )}
    </div>
  )
}
