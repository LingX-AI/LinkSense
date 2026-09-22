import { useId, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDownIcon } from "lucide-react"
import {
  genericReasoningEffortValues,
  managedModelKindValues,
  modelIdentifierSchema,
  type ManagedPricedModel,
} from "@linksense/shared"
import { FieldShell } from "@/components/forms/form-field"
import { ModelTokenPriceInput } from "@/components/forms/model-token-price-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { changeModelKind, parseContextWindow } from "./model-settings-draft"

export function ModelSettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  layout = "default",
  actions,
}: {
  label: string
  value: T | null
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
  disabled?: boolean
  layout?: "default" | "settings"
  actions?: ReactNode
}) {
  const id = useId()
  const select = (
    <Select
      name={id}
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(value) => {
        const option = options.find((item) => item.value === value)
        if (option) onChange(option.value)
      }}
    >
      <SelectTrigger
        id={id}
        className={actions ? "w-full min-w-0 flex-1" : "w-full"}
      >
        <SelectValue>
          {options.find((option) => option.value === value)?.icon}
          {options.find((option) => option.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.icon}
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
  return (
    <FieldShell
      id={id}
      label={label}
      layout={layout}
      controlWidth={layout === "settings" && !actions ? "medium" : "full"}
    >
      {actions ? (
        <div className="flex min-w-0 items-center gap-2">
          {select}
          {actions}
        </div>
      ) : (
        select
      )}
    </FieldShell>
  )
}

export function ModelSettingsFields({
  model,
  modelIdError,
  modelNameHint,
  onChange,
  contextInput,
  onContextChange,
}: {
  model: ManagedPricedModel
  modelIdError?: string
  modelNameHint?: string
  onChange: (model: ManagedPricedModel) => void
  contextInput: string
  onContextChange: (input: string) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const contextValid = parseContextWindow(contextInput).valid
  const efforts = model.kind === "chat" ? model.supported_reasoning_efforts : []
  return (
    <>
      <FieldSet className="gap-3">
        <FieldLegend className="text-sm font-medium">
          {t("admin.modelProvider.basicInformation")}
        </FieldLegend>
        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldShell
            id={`${id}-model-id`}
            label={t("admin.modelProvider.modelId")}
            error={modelIdError}
          >
            <Input
              id={`${id}-model-id`}
              name={`${id}-model-id`}
              value={model.id}
              required
              maxLength={240}
              aria-invalid={
                Boolean(modelIdError) ||
                (Boolean(model.id) &&
                  !modelIdentifierSchema.safeParse(model.id).success)
              }
              aria-describedby={
                modelIdError ? `${id}-model-id-error` : undefined
              }
              onChange={(event) =>
                onChange({ ...model, id: event.target.value })
              }
            />
          </FieldShell>
          <FieldShell
            id={`${id}-model-name`}
            label={t("admin.modelProvider.displayName")}
            hint={
              modelNameHint ? (
                <span id={`${id}-model-name-hint`} className="text-destructive">
                  {modelNameHint}
                </span>
              ) : undefined
            }
          >
            <Input
              id={`${id}-model-name`}
              name={`${id}-model-name`}
              value={model.display_name}
              className={
                modelNameHint
                  ? "border-destructive dark:border-destructive/50"
                  : undefined
              }
              aria-describedby={
                modelNameHint ? `${id}-model-name-hint` : undefined
              }
              required
              maxLength={120}
              onChange={(event) =>
                onChange({ ...model, display_name: event.target.value })
              }
            />
          </FieldShell>
          <ModelSettingsSelect
            label={t("admin.modelProvider.modelKind")}
            value={model.kind}
            options={managedModelKindValues.map((value) => ({
              value,
              label: t(`admin.modelProvider.modelKinds.${value}`),
            }))}
            onChange={(kind) => {
              onChange(changeModelKind(model, kind))
              onContextChange("")
            }}
          />
        </FieldGroup>
      </FieldSet>
      <FieldSet className="gap-3">
        <FieldLegend className="text-sm font-medium">
          {t("admin.modelProvider.pricing")}
        </FieldLegend>
        <p className="text-xs text-muted-foreground">
          {t("admin.modelProvider.priceUnit")}
        </p>
        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldShell
            id={`${id}-input-price`}
            label={t("admin.modelProvider.inputPrice")}
          >
            <ModelTokenPriceInput
              id={`${id}-input-price`}
              name={`${id}-input-price`}
              value={model.input_price_per_million}
              unitLabel={t("admin.modelProvider.priceUnit")}
              inputMode="decimal"
              required
              onChange={(event) =>
                onChange({
                  ...model,
                  input_price_per_million: event.target.value,
                })
              }
            />
          </FieldShell>
          {model.kind === "chat" && (
            <>
              <FieldShell
                id={`${id}-cached-price`}
                label={t("admin.modelProvider.cachedInputPrice")}
              >
                <ModelTokenPriceInput
                  id={`${id}-cached-price`}
                  name={`${id}-cached-price`}
                  value={model.cached_input_price_per_million}
                  unitLabel={t("admin.modelProvider.priceUnit")}
                  inputMode="decimal"
                  required
                  onChange={(event) =>
                    onChange({
                      ...model,
                      cached_input_price_per_million: event.target.value,
                    })
                  }
                />
              </FieldShell>
              <FieldShell
                id={`${id}-output-price`}
                label={t("admin.modelProvider.outputPrice")}
              >
                <ModelTokenPriceInput
                  id={`${id}-output-price`}
                  name={`${id}-output-price`}
                  value={model.output_price_per_million}
                  unitLabel={t("admin.modelProvider.priceUnit")}
                  inputMode="decimal"
                  required
                  onChange={(event) =>
                    onChange({
                      ...model,
                      output_price_per_million: event.target.value,
                    })
                  }
                />
              </FieldShell>
            </>
          )}
        </FieldGroup>
      </FieldSet>
      {model.kind === "chat" && (
        <FieldSet className="gap-3">
          <FieldLegend className="text-sm font-medium">
            {t("admin.modelProvider.capabilities")}
          </FieldLegend>
          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell
              id={`${id}-context`}
              label={t("admin.modelProvider.contextWindow")}
              error={
                contextValid
                  ? undefined
                  : t("admin.modelProvider.contextWindowInvalid")
              }
            >
              <Input
                id={`${id}-context`}
                name={`${id}-context`}
                inputMode="numeric"
                value={contextInput}
                aria-invalid={!contextValid}
                placeholder={t("admin.modelProvider.contextWindowPlaceholder")}
                onChange={(event) => onContextChange(event.target.value)}
              />
            </FieldShell>
            <FieldShell
              id={`${id}-efforts`}
              label={t("admin.modelProvider.supportedEfforts")}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      id={`${id}-efforts`}
                      type="button"
                      variant="input"
                      className="w-full justify-between"
                      aria-label={t("admin.modelProvider.supportedEfforts")}
                    />
                  }
                >
                  {efforts.length === 1
                    ? t(`reasoningEffort.${efforts[0]}`)
                    : t("admin.modelProvider.selectedEfforts", {
                        count: efforts.length,
                      })}
                  <ChevronDownIcon data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t("admin.modelProvider.supportedEfforts")}
                    </DropdownMenuLabel>
                    {genericReasoningEffortValues.map((effort) => (
                      <DropdownMenuCheckboxItem
                        key={effort}
                        checked={efforts.includes(effort)}
                        disabled={
                          efforts.includes(effort) && efforts.length === 1
                        }
                        onCheckedChange={(checked) => {
                          const selected = checked
                            ? [...efforts, effort]
                            : efforts.filter((value) => value !== effort)
                          const next = genericReasoningEffortValues.filter(
                            (value) => selected.includes(value)
                          )
                          const defaultEffort = next.some(
                            (effort) =>
                              effort === model.default_reasoning_effort
                          )
                            ? model.default_reasoning_effort
                            : next[0]
                          if (defaultEffort)
                            onChange({
                              ...model,
                              supported_reasoning_efforts: next,
                              default_reasoning_effort: defaultEffort,
                            })
                        }}
                      >
                        {t(`reasoningEffort.${effort}`)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldShell>
            <ModelSettingsSelect
              label={t("admin.modelProvider.defaultEffort")}
              value={model.default_reasoning_effort}
              options={efforts.map((value) => ({
                value,
                label: t(`reasoningEffort.${value}`),
              }))}
              onChange={(value) =>
                onChange({ ...model, default_reasoning_effort: value })
              }
            />
            <div className="flex items-center gap-2 self-end py-2">
              <Switch
                id={`${id}-images`}
                checked={model.supports_image_input}
                onCheckedChange={(checked) =>
                  onChange({ ...model, supports_image_input: checked })
                }
              />
              <Label htmlFor={`${id}-images`}>
                {t("admin.modelProvider.supportsImageInput")}
              </Label>
            </div>
          </FieldGroup>
        </FieldSet>
      )}
    </>
  )
}
