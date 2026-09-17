import { useDeferredValue, useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"
import {
  interactiveDependencyOptionsSchema,
  type InteractiveDependencyBinding,
  type InteractiveDependencyState,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { cn } from "@/lib/utils"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

type DependencyItem = InteractiveDependencyState["items"][number]

export function InteractiveDependencyFields({
  state,
  onChange,
  disabled = false,
}: {
  state: InteractiveDependencyState
  onChange: (binding: InteractiveDependencyBinding) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <FieldGroup>
      <FieldDescription>{t("applications.dependencies.hint")}</FieldDescription>
      {state.items.length === 0 && (
        <FieldDescription>
          {t("applications.dependencies.empty")}
        </FieldDescription>
      )}
      {state.items.map((item) => (
        <DependencyField
          key={`${item.type}:${item.id}`}
          item={item}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
    </FieldGroup>
  )
}

function DependencyField({
  item,
  onChange,
  disabled,
}: {
  item: DependencyItem
  onChange: (binding: InteractiveDependencyBinding) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
    item.resource_id
      ? { id: item.resource_id, name: item.resource_name ?? item.name }
      : null
  )
  const [changed, setChanged] = useState(false)
  const configured = selected !== null && (changed || item.available)
  const StatusIcon = configured ? CircleCheckIcon : CircleAlertIcon
  const deferredSearch = useDeferredValue(search)
  const query = useQuery({
    queryKey: ["interactive-dependency-options", item.type, deferredSearch],
    queryFn: ({ signal }) =>
      apiRequest("/applications/interactive-dependency-options", {
        query: { type: item.type, search: deferredSearch || undefined },
        schema: interactiveDependencyOptionsSchema,
        signal,
      }),
  })
  const options = [
    ...new Map(
      [...(selected ? [selected] : []), ...(query.data?.items ?? [])].map(
        (option) => [option.id, option]
      )
    ).values(),
  ]
  const choose = (option: { id: string; name: string } | null) => {
    setSelected(option)
    setChanged(true)
    onChange({ type: item.type, id: item.id, resource_id: option?.id ?? null })
  }
  return (
    <Field data-disabled={disabled}>
      <Field
        orientation="horizontal"
        data-disabled={disabled}
        className="min-w-0"
      >
        <FieldLabel htmlFor={id} className="min-w-0 flex-1 wrap-anywhere">
          <StatusIcon
            role="img"
            aria-label={t(
              configured
                ? "applications.dependencies.matched"
                : "applications.dependencies.unmatched"
            )}
            className={cn(
              "size-4 shrink-0",
              configured ? "text-success" : "text-warning"
            )}
          />
          <span id={`${id}-label`} className="min-w-0">
            {t(`applications.dependencies.types.${item.type}`)} · {item.name}
          </span>
        </FieldLabel>
        <Combobox
          items={options}
          value={selected}
          onValueChange={choose}
          disabled={disabled}
          onInputValueChange={setSearch}
          itemToStringLabel={(option) => option.name}
          itemToStringValue={(option) => option.id}
          isItemEqualToValue={(option, value) => option.id === value.id}
        >
          <ComboboxInput
            id={id}
            aria-labelledby={`${id}-label`}
            className="ml-auto w-1/2 max-w-64 min-w-0 shrink-0"
            disabled={disabled}
            showTrigger={selected === null}
            showClear={selected !== null}
            clearLabel={t("applications.dependencies.clear")}
            placeholder={t("applications.dependencies.search")}
          />
          <ComboboxContent>
            <ComboboxEmpty>
              {query.isFetching
                ? t("common.loading")
                : t("applications.resourceSearchEmpty")}
            </ComboboxEmpty>
            <ComboboxList>
              {(option: { id: string; name: string }) => (
                <ComboboxItem key={option.id} value={option}>
                  {option.name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
      {query.error && (
        <StatusBanner variant="error">
          {getErrorMessage(query.error, t)}
        </StatusBanner>
      )}
    </Field>
  )
}
