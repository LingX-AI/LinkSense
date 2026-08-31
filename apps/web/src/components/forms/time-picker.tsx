import { useEffect, useRef, useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type TimePickerProps = {
  id: string
  value: string
  onValueChange: (value: string) => void
  labelledBy: string
  hourLabel: string
  minuteLabel: string
  min?: string
  minExclusive?: boolean
  disabled?: boolean
  size?: "default" | "sm"
}

const hourItems = createTimeItems(24)
const minuteItems = createTimeItems(60)

export function TimePicker({
  id,
  value,
  onValueChange,
  labelledBy,
  hourLabel,
  minuteLabel,
  min,
  minExclusive = false,
  disabled = false,
  size = "default",
}: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [hour, minute] = parseTime(value)
  const minimumTime = parseOptionalTime(min)
  const valueId = `${id}-value`

  return (
    <div role="group" aria-labelledby={labelledBy} className="min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="input"
              size={size === "sm" ? "default" : "lg"}
              className={cn(
                "w-full justify-between px-3 font-normal focus-visible:ring-0",
                size === "default" && "rounded-xl"
              )}
              aria-expanded={open}
              aria-haspopup="dialog"
              aria-labelledby={`${labelledBy} ${valueId}`}
              disabled={disabled}
            />
          }
        >
          <span id={valueId} className="tabular-nums">
            {hour}:{minute}
          </span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-[13.75rem] max-w-[calc(100vw-2rem)] gap-0 rounded-3xl p-2"
        >
          <div className="grid grid-cols-2 divide-x divide-border/60 rounded-[calc(var(--radius-3xl)-0.25rem)] bg-popover">
            <TimeOptionColumn
              label={hourLabel}
              items={hourItems}
              value={hour}
              isDisabled={(nextHour) =>
                isHourDisabled(nextHour, minimumTime, minExclusive)
              }
              onSelect={(nextHour) => onValueChange(`${nextHour}:${minute}`)}
            />
            <TimeOptionColumn
              label={minuteLabel}
              items={minuteItems}
              value={minute}
              isDisabled={(nextMinute) =>
                isTimeBeforeMinimum(hour, nextMinute, minimumTime, minExclusive)
              }
              onSelect={(nextMinute) => onValueChange(`${hour}:${nextMinute}`)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function TimeOptionColumn({
  label,
  items,
  value,
  isDisabled,
  onSelect,
}: {
  label: string
  items: Array<{ label: string; value: string }>
  value: string
  isDisabled: (value: string) => boolean
  onSelect: (value: string) => void
}) {
  const columnRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const column = columnRef.current
    const selected = selectedRef.current
    if (!column || !selected) return

    const columnRect = column.getBoundingClientRect()
    const selectedRect = selected.getBoundingClientRect()
    const selectedTop = column.scrollTop + selectedRect.top - columnRect.top
    column.scrollTop = Math.max(
      0,
      selectedTop - (column.clientHeight - selectedRect.height) / 2
    )
  }, [value])

  return (
    <div
      ref={columnRef}
      role="listbox"
      aria-label={label}
      className="max-h-52 overflow-y-auto rounded-2xl p-1"
    >
      {items.map((item) => {
        const selected = item.value === value
        const disabled = isDisabled(item.value)

        return (
          <Button
            key={item.value}
            ref={selected ? selectedRef : undefined}
            type="button"
            variant="ghost"
            role="option"
            aria-disabled={disabled || undefined}
            aria-selected={selected}
            disabled={disabled}
            className={cn(
              "flex h-9 w-full items-center justify-center rounded-xl text-sm font-medium tabular-nums transition-colors outline-none hover:bg-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-35",
              selected && "bg-input/70 text-foreground"
            )}
            onClick={() => onSelect(item.value)}
          >
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}

function createTimeItems(length: number) {
  return Array.from({ length }, (_, value) => {
    const label = String(value).padStart(2, "0")
    return { label, value: label }
  })
}

function parseTime(value: string): [string, string] {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match || !hourItems.some((item) => item.value === match[1])) {
    return ["00", "00"]
  }
  if (!minuteItems.some((item) => item.value === match[2])) {
    return ["00", "00"]
  }
  return [match[1], match[2]]
}

function parseOptionalTime(value: string | undefined): [string, string] | null {
  if (!value || !/^\d{2}:\d{2}$/u.test(value)) return null
  const parsed = parseTime(value)
  return parsed.join(":") === value ? parsed : null
}

function isHourDisabled(
  hour: string,
  minimumTime: [string, string] | null,
  exclusive: boolean
) {
  return isTimeBeforeMinimum(hour, "59", minimumTime, exclusive)
}

function isTimeBeforeMinimum(
  hour: string,
  minute: string,
  minimumTime: [string, string] | null,
  exclusive: boolean
) {
  if (!minimumTime) return false
  const candidate = Number(hour) * 60 + Number(minute)
  const minimum = Number(minimumTime[0]) * 60 + Number(minimumTime[1])
  return exclusive ? candidate <= minimum : candidate < minimum
}
