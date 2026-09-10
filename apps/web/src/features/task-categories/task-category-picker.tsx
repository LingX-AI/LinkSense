import { FolderIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTaskCategories } from "./task-category-api"

const unclassifiedValue = "unclassified"

export function TaskCategoryPicker({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  id?: string
}) {
  const { t } = useTranslation()
  const query = useTaskCategories()
  const categories = query.data ?? []
  const selected = categories.find((category) => category.id === value)
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <Select
        value={value ?? unclassifiedValue}
        disabled={disabled || query.isPending}
        onValueChange={(next) => {
          if (next !== null) onChange(next === unclassifiedValue ? null : next)
        }}
      >
        <SelectTrigger
          id={id}
          aria-label={t("taskCategories.choose")}
          className="w-full min-w-0"
        >
          <FolderIcon aria-hidden="true" />
          <SelectValue className="min-w-0">
            <span className="truncate" title={selected?.name}>
              {query.isPending
                ? t("common.loading")
                : value === null
                  ? t("taskCategories.unclassified")
                  : (selected?.name ?? t("taskCategories.unavailable"))}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="max-w-[min(24rem,calc(100vw-2rem))]"
        >
          <SelectGroup>
            <SelectItem value={unclassifiedValue}>
              {t("taskCategories.unclassified")}
            </SelectItem>
            {categories.map((category) => (
              <SelectItem
                key={category.id}
                value={category.id}
                className="min-w-0 [&>span:first-child]:min-w-0 [&>span:first-child]:shrink"
              >
                <span className="truncate" title={category.name}>
                  {category.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {query.isError && (
        <div
          role="alert"
          className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-destructive"
        >
          <span>{t("taskCategories.loadError")}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
    </div>
  )
}
