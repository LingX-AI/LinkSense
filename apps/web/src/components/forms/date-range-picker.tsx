import { useRef, useState } from "react"
import dayjs from "dayjs"
import { CalendarIcon, XIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { normalizeLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  calendarLocales,
  DATE_VALUE_FORMAT,
  parseDateValue,
} from "./calendar-values"

export type DateRangeValue = { from: string; to: string }

export function DateRangePicker({
  id,
  label,
  value,
  onValueChange,
  disabled = false,
}: {
  id: string
  label: string
  value?: DateRangeValue
  onValueChange: (value: DateRangeValue | undefined) => void
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const from = parseDateValue(value?.from)
  const to = parseDateValue(value?.to)
  const selected =
    from && to && !dayjs(to).isBefore(from, "day") ? { from, to } : undefined
  const displayValue = selected
    ? t("common.dateRange.value", {
        from: dayjs(selected.from).format(DATE_VALUE_FORMAT),
        to: dayjs(selected.to).format(DATE_VALUE_FORMAT),
      })
    : label

  return (
    <div className="relative flex min-w-0 items-center">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setDraft(selected)
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          id={id}
          disabled={disabled}
          render={
            <Button
              ref={triggerRef}
              variant="input"
              size="lg"
              aria-label={label}
              title={displayValue}
              className={cn(
                "min-w-0 flex-1 justify-start px-3 font-normal",
                !selected && "text-muted-foreground"
              )}
            />
          }
        >
          <CalendarIcon data-icon="inline-start" aria-hidden="true" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              selected && "pr-8"
            )}
          >
            {displayValue}
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto max-w-(--available-width) gap-0 overflow-auto p-0"
        >
          <PopoverTitle className="sr-only">{label}</PopoverTitle>
          <Calendar
            mode="range"
            required
            resetOnSelect
            selected={draft}
            defaultMonth={selected?.from}
            locale={calendarLocales[language]}
            onSelect={(range) => {
              setDraft(range)
              if (!range?.from || !range.to) return
              onValueChange({
                from: dayjs(range.from).format(DATE_VALUE_FORMAT),
                to: dayjs(range.to).format(DATE_VALUE_FORMAT),
              })
              setOpen(false)
            }}
          />
          <p className="px-3 pb-3 text-sm text-muted-foreground" role="status">
            {draft?.from && !draft.to
              ? t("common.dateRange.selectEnd", {
                  date: dayjs(draft.from).format(DATE_VALUE_FORMAT),
                })
              : t("common.dateRange.selectStart")}
          </p>
        </PopoverContent>
      </Popover>
      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          className="absolute inset-y-0 right-3 my-auto active:not-aria-[haspopup]:translate-y-0"
          aria-label={t("common.dateRange.clear", { label })}
          onClick={() => {
            setOpen(false)
            setDraft(undefined)
            onValueChange(undefined)
            triggerRef.current?.focus()
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
