import { useId } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  automationNotificationTargetsSchema,
  type AutomationNotificationTarget,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { FieldShell } from "@/components/forms/form-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function AutomationNotificationField({
  value,
  onChange,
}: {
  value: AutomationNotificationTarget | null
  onChange: (value: AutomationNotificationTarget | null) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const query = useQuery({
    queryKey: ["automations", "notification-targets"],
    queryFn: ({ signal }) =>
      apiRequest("/automations/notification-targets", {
        schema: automationNotificationTargetsSchema,
        signal,
      }),
  })
  const key = (target: AutomationNotificationTarget) =>
    `${target.kind}:${target.connection_id}:${target.peer_session_id}`
  const selected = value ? key(value) : "none"
  const items = query.data?.items ?? []
  const unavailable = Boolean(
    value && !items.some((item) => key(item.target) === selected)
  )
  const selectedItem = items.find((item) => key(item.target) === selected)
  const selectedLabel = value
    ? selectedItem
      ? `${selectedItem.provider} · ${selectedItem.title}`
      : t("automationNotifications.unavailable")
    : t("automationNotifications.none")
  return (
    <FieldShell id={id} label={t("automationNotifications.label")}>
      <Select
        value={selected}
        onValueChange={(next) => {
          if (next === "none") onChange(null)
          else {
            const item = items.find((item) => key(item.target) === next)
            if (item) onChange(item.target)
          }
        }}
      >
        <SelectTrigger id={id} aria-describedby={`${id}-help`}>
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            {t("automationNotifications.none")}
          </SelectItem>
          {unavailable && (
            <SelectItem value={selected} disabled>
              {t("automationNotifications.unavailable")}
            </SelectItem>
          )}
          {items.map((item) => (
            <SelectItem key={key(item.target)} value={key(item.target)}>
              {item.provider} · {item.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {t("automationNotifications.description")}
      </p>
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("automationNotifications.empty")}
        </p>
      )}
    </FieldShell>
  )
}
