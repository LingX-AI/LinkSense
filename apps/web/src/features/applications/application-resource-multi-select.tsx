import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox"

export type ApplicationResourceOption = {
  id: string
  label: string
  detail: string
  detailInline: boolean
  disabled: boolean
}

export function ResourceMultiSelect({
  id,
  title,
  description,
  items,
  selectedIds,
  onChange,
  emptyLabel,
  placeholder,
  searchPlaceholder,
  disabled = false,
  loading = false,
  loadingMore = false,
  onSearch,
  onLoadMore,
  visibleChipLimit = 2,
}: {
  id: string
  title: string
  description: string
  items: ApplicationResourceOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  emptyLabel: string
  placeholder: string
  searchPlaceholder: string
  disabled?: boolean
  loading?: boolean
  loadingMore?: boolean
  onSearch?: (search: string) => void
  onLoadMore?: () => void
  visibleChipLimit?: number
}) {
  const { t } = useTranslation()
  const selected = new Set(selectedIds)
  const selectedItems = items.filter((item) => selected.has(item.id))
  const hiddenSelectedCount = Math.max(
    selectedItems.length - visibleChipLimit,
    0
  )

  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{title}</FieldLabel>
      <FieldDescription>{description}</FieldDescription>
      <Combobox
        items={items}
        multiple
        value={selectedItems}
        disabled={disabled || (!onSearch && items.length === 0)}
        onInputValueChange={(value, details) =>
          onSearch?.(details.reason === "input-change" ? value : "")
        }
        onOpenChange={(open) => {
          if (!open) onSearch?.("")
        }}
        itemToStringLabel={(item) =>
          [item.label, item.detail].filter(Boolean).join(" ")
        }
        itemToStringValue={(item) => item.id}
        isItemEqualToValue={(item, value) => item.id === value.id}
        onValueChange={(nextItems) =>
          onChange(nextItems.map((item) => item.id))
        }
      >
        <ComboboxChips className="min-h-9 w-full">
          <ComboboxValue>
            {selectedItems.slice(0, visibleChipLimit).map((item) => (
              <ComboboxChip
                key={item.id}
                removeLabel={t("applications.removeResource", {
                  name: item.label,
                })}
              >
                <span className="max-w-40 truncate">{item.label}</span>
              </ComboboxChip>
            ))}
            {hiddenSelectedCount > 0 && (
              <Badge
                variant="secondary"
                aria-label={t("applications.additionalResources", {
                  count: hiddenSelectedCount,
                })}
              >
                +{hiddenSelectedCount}
              </Badge>
            )}
          </ComboboxValue>
          <ComboboxChipsInput
            id={id}
            aria-label={title}
            disabled={disabled || (!onSearch && items.length === 0)}
            maxLength={onSearch ? 160 : undefined}
            placeholder={
              items.length === 0
                ? emptyLabel
                : selectedItems.length === 0
                  ? placeholder
                  : searchPlaceholder
            }
          />
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty>
            {t(loading ? "common.loading" : "applications.resourceSearchEmpty")}
          </ComboboxEmpty>
          <ComboboxList>
            {(item: ApplicationResourceOption) => (
              <ComboboxItem
                key={item.id}
                value={item}
                disabled={item.disabled && !selected.has(item.id)}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {item.label}
                    </span>
                    {item.detailInline && item.detail && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    )}
                  </span>
                  {!item.detailInline && item.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
          {onLoadMore && (
            <Button
              className="w-full"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore && <Spinner data-icon="inline-start" />}
              {t("common.loadMore")}
            </Button>
          )}
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}
