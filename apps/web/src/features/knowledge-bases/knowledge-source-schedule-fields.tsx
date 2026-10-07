import type { KnowledgeSourceSyncFrequency } from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { TimePicker } from "@/components/forms/time-picker"
import { FieldShell } from "@/components/forms/form-field"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { KnowledgeSourceSyncScheduleDraft } from "@/features/knowledge-bases/knowledge-source-schedule"

const frequencyValues = ["daily", "weekly", "monthly"] as const
const weekdayValues = ["1", "2", "3", "4", "5", "6", "7"] as const
const dayValues = Array.from({ length: 31 }, (_, index) => String(index + 1))

export function KnowledgeSourceSyncScheduleFields({
  value,
  onValueChange,
}: {
  value: KnowledgeSourceSyncScheduleDraft
  onValueChange: (value: KnowledgeSourceSyncScheduleDraft) => void
}) {
  const { t } = useTranslation()
  const frequencyItems = frequencyValues.map((frequency) => ({
    value: frequency,
    label: t(`knowledge.create.syncFrequency.${frequency}`),
  }))
  const weekdayItems = weekdayValues.map((weekday) => ({
    value: weekday,
    label: t(`knowledge.create.syncWeekday.${weekday}`),
  }))
  const dayItems = dayValues.map((day) => ({
    value: day,
    label: t("knowledge.create.syncDayOption", { day: Number(day) }),
  }))

  function update<Key extends keyof KnowledgeSourceSyncScheduleDraft>(
    key: Key,
    nextValue: KnowledgeSourceSyncScheduleDraft[Key]
  ) {
    onValueChange({ ...value, [key]: nextValue })
  }

  return (
    <FieldGroup className="gap-4 rounded-[min(var(--radius-4xl),24px)] border border-[color:var(--app-border)] p-4">
      <FieldShell
        id="knowledge-base-sync-frequency"
        label={t("knowledge.create.syncFrequencyLabel")}
        required
      >
        <Select
          items={frequencyItems}
          value={value.frequency}
          onValueChange={(frequency) => {
            if (isFrequency(frequency)) update("frequency", frequency)
          }}
        >
          <SelectTrigger
            id="knowledge-base-sync-frequency"
            className="w-full"
            aria-required="true"
          >
            <SelectValue>
              {t(`knowledge.create.syncFrequency.${value.frequency}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {frequencyItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FieldShell>

      {value.frequency === "weekly" && (
        <FieldShell
          id="knowledge-base-sync-weekday"
          label={t("knowledge.create.syncWeekdayLabel")}
          required
        >
          <Select
            items={weekdayItems}
            value={value.weekday}
            onValueChange={(weekday) => update("weekday", weekday ?? "1")}
          >
            <SelectTrigger
              id="knowledge-base-sync-weekday"
              className="w-full"
              aria-required="true"
            >
              <SelectValue>
                {t(`knowledge.create.syncWeekday.${value.weekday}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {weekdayItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      {value.frequency === "monthly" && (
        <FieldShell
          id="knowledge-base-sync-day-of-month"
          label={t("knowledge.create.syncDayOfMonth")}
          required
          hint={t("knowledge.create.syncInvalidMonthDayHint")}
        >
          <Select
            items={dayItems}
            value={value.dayOfMonth}
            onValueChange={(day) => update("dayOfMonth", day ?? "1")}
          >
            <SelectTrigger
              id="knowledge-base-sync-day-of-month"
              aria-required="true"
              className="w-full"
            >
              <SelectValue>
                {t("knowledge.create.syncDayOption", {
                  day: Number(value.dayOfMonth),
                })}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {dayItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      <Field className="form-field gap-1.5">
        <FieldLabel
          id="knowledge-base-sync-time-label"
          className="form-label"
          required
        >
          {t("knowledge.create.syncTime")}
        </FieldLabel>
        <TimePicker
          id="knowledge-base-sync-time"
          value={value.time}
          labelledBy="knowledge-base-sync-time-label"
          hourLabel={t("knowledge.create.syncHour")}
          minuteLabel={t("knowledge.create.syncMinute")}
          onValueChange={(time) => update("time", time)}
        />
        <FieldDescription className="form-hint">
          {t("knowledge.create.syncTimeZone", { timeZone: value.timeZone })}
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}

function isFrequency(
  value: string | null
): value is KnowledgeSourceSyncFrequency {
  return frequencyValues.some((frequency) => frequency === value)
}
