import { useMemo, useState } from "react"
import dayjs from "dayjs"
import "dayjs/locale/en"
import "dayjs/locale/zh-cn"
import { enUS, zhCN } from "date-fns/locale"
import { CalendarIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { normalizeLanguage } from "@/i18n"
import { cn } from "@/lib/utils"

const DATE_VALUE_FORMAT = "YYYY-MM-DD"

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
  const selectedDate = useMemo(() => parseDateValue(value), [value])
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
        .locale(language === "zh-CN" ? "zh-cn" : "en")
        .format(language === "zh-CN" ? "YYYY年M月D日" : "MMM D, YYYY")
    : placeholder

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
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
          <span className="truncate">{displayValue}</span>
          <CalendarIcon aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate ?? minDate ?? maxDate ?? undefined}
            disabled={disabledDays}
            locale={language === "zh-CN" ? zhCN : enUS}
            onSelect={(date) => {
              if (!date) return
              onValueChange(dayjs(date).format(DATE_VALUE_FORMAT))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {selectedDate && clearable && (
        <Button
          type="button"
          variant="ghost"
          size={size === "sm" ? "icon" : "icon-lg"}
          aria-label={clearLabel}
          disabled={disabled}
          onClick={() => onValueChange("")}
        >
          <XIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
