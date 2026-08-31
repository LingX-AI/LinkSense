import { DatePicker } from "@/components/forms/date-picker"
import { TimePicker } from "@/components/forms/time-picker"
import { cn } from "@/lib/utils"

type DateTimePickerProps = {
  id: string
  value: string
  onValueChange: (value: string) => void
  label: string
  datePlaceholder: string
  clearDateLabel: string
  hourLabel: string
  minuteLabel: string
  min?: string
  minExclusive?: boolean
  disabled?: boolean
  size?: "default" | "sm"
  className?: string
}

export function DateTimePicker({
  id,
  value,
  onValueChange,
  label,
  datePlaceholder,
  clearDateLabel,
  hourLabel,
  minuteLabel,
  min,
  minExclusive = false,
  disabled = false,
  size = "default",
  className,
}: DateTimePickerProps) {
  const { date, time } = splitDateTime(value)
  const minimum = splitDateTime(min ?? "")
  const minimumDate = minimum.date || undefined
  const minimumTime = date === minimum.date ? minimum.time : undefined
  const timeLabelId = `${id}-time-label`

  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 2xl:grid-cols-[minmax(17rem,1.8fr)_minmax(8rem,1fr)]",
        className
      )}
    >
      <DatePicker
        id={id}
        value={date}
        min={minimumDate}
        placeholder={datePlaceholder}
        clearLabel={clearDateLabel}
        disabled={disabled}
        size={size}
        onValueChange={(nextDate) =>
          onValueChange(nextDate ? `${nextDate}T${time}` : "")
        }
      />
      <span id={timeLabelId} className="sr-only">
        {label}
      </span>
      <TimePicker
        id={`${id}-time`}
        value={time}
        labelledBy={timeLabelId}
        hourLabel={hourLabel}
        minuteLabel={minuteLabel}
        min={minimumTime}
        minExclusive={minExclusive}
        disabled={disabled || !date}
        size={size}
        onValueChange={(nextTime) =>
          onValueChange(date ? `${date}T${nextTime}` : "")
        }
      />
    </div>
  )
}

function splitDateTime(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/u.exec(value)
  return match
    ? { date: match[1], time: match[2] }
    : { date: "", time: "00:00" }
}
