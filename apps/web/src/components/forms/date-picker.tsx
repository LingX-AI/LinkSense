import { useMemo, useRef, useState } from "react"
import dayjs from "dayjs"
import {
  enUS,
  es,
  fr,
  ja,
  ptBR,
  zhCN,
  type Locale as DateFnsLocale,
} from "date-fns/locale"
import { CalendarIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { normalizeLanguage, type SupportedLanguage } from "@/i18n"
import { calendarDateFormatFor, dayjsLocaleFor } from "@/i18n/date"
import { cn } from "@/lib/utils"

const DATE_VALUE_FORMAT = "YYYY-MM-DD"
const calendarLocales: Record<SupportedLanguage, DateFnsLocale> = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "es-ES": es,
  "pt-BR": ptBR,
  "fr-FR": fr,
  "ja-JP": ja,
}

type DatePickerProps = {
  id: string
  value: string
  onValueChange: (value: string) => void
  min?: string
  max?: string
  placeholder: string
  clearLabel: string
  clearable?: boolean
  disabled?: boolean
  size?: "default" | "sm"
  className?: string
}

function parseDateValue(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format(DATE_VALUE_FORMAT) !== value) {
    return undefined
  }
  return parsed.startOf("day").toDate()
}

export function DatePicker({
  id,
  value,
  onValueChange,
  min,
  max,
  placeholder,
  clearLabel,
  clearable = true,
  disabled = false,
  size = "default",
  className,
}: DatePickerProps) {
  const { i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedDate = useMemo(() => parseDateValue(value), [value])
  const showClear = Boolean(selectedDate && clearable)
  const minDate = useMemo(() => parseDateValue(min), [min])
  const maxDate = useMemo(() => parseDateValue(max), [max])
  const disabledDays = useMemo(
    () => [
      ...(minDate ? [{ before: minDate }] : []),
      ...(maxDate ? [{ after: maxDate }] : []),
    ],
    [maxDate, minDate]
  )
  const displayValue = selectedDate
    ? dayjs(selectedDate)
        .locale(dayjsLocaleFor(language))
        .format(calendarDateFormatFor(language))
    : placeholder

  return (
    <div className={cn("relative flex min-w-0 items-center", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              ref={triggerRef}
              id={id}
              type="button"
              variant="input"
              size={size === "sm" ? "default" : "lg"}
              className={cn(
                "min-w-0 flex-1 justify-between px-3 font-normal focus-visible:ring-0",
                !selectedDate && "text-muted-foreground"
              )}
              disabled={disabled}
            />
          }
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              showClear && "pr-8"
            )}
          >
            {displayValue}
          </span>
          <CalendarIcon aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate ?? minDate ?? maxDate ?? undefined}
            disabled={disabledDays}
            locale={calendarLocales[language]}
            onSelect={(date) => {
              if (!date) return
              onValueChange(dayjs(date).format(DATE_VALUE_FORMAT))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-9 -translate-y-1/2"
          aria-label={clearLabel}
          disabled={disabled}
          onClick={() => {
            setOpen(false)
            onValueChange("")
            triggerRef.current?.focus()
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
