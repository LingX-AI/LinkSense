import { taskAutoNamingSchema, type TaskAutoNaming } from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function TaskAutoNamingSettings({
  value,
  pending,
  onChange,
}: {
  value: TaskAutoNaming
  pending: boolean
  onChange: (value: TaskAutoNaming) => void
}) {
  const { t } = useTranslation()
  const options = [
    { value: "first_message", label: t("settings.taskAutoNamingFirstMessage") },
    { value: "every_message", label: t("settings.taskAutoNamingEveryMessage") },
  ]
  return (
    <section
      className="personalization-section mt-7"
      aria-labelledby="task-auto-naming-heading"
    >
      <SettingsSectionHeader
        id="task-auto-naming-heading"
        title={t("settings.taskAutoNaming")}
        description={t("settings.taskAutoNamingDescription")}
        descriptionId="task-auto-naming-description"
        status={
          pending ? (
            <span role="status">
              <Spinner />
              <span className="sr-only">{t("common.saving")}</span>
            </span>
          ) : undefined
        }
      />
      <div className="personalization-memory-card">
        <div className="personalization-memory-row">
          <div>
            <h3 id="task-auto-naming-frequency">
              {t("settings.taskAutoNamingFrequency")}
            </h3>
          </div>
          <Select
            value={value}
            items={options}
            disabled={pending}
            onValueChange={(selected) => {
              const next = taskAutoNamingSchema.safeParse(selected)
              if (next.success && next.data !== value) onChange(next.data)
            }}
          >
            <SelectTrigger
              className="shrink-0"
              aria-labelledby="task-auto-naming-frequency"
              aria-describedby="task-auto-naming-description"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
}
