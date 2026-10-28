import {
  unavailableDiskUsage,
  type DiskUsage,
  type Locale,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { formatDateTime } from "@/i18n/date"
import { formatResourceBytes } from "./resource-format"
import { hasCompleteDiskUsage } from "./system-disk-usage-state"

export function SystemDiskUsage({
  usage = unavailableDiskUsage(),
  language,
}: {
  usage?: DiskUsage | undefined
  language: Locale
}) {
  const { t } = useTranslation()
  if (!hasCompleteDiskUsage(usage)) return null
  return (
    <div
      role="group"
      aria-label={t("health.disk.title")}
      aria-busy={usage.refreshing}
      title={
        usage.checked_at
          ? t("health.disk.checkedAt", {
              time: formatDateTime(usage.checked_at, language),
            })
          : undefined
      }
    >
      <span>{t("health.disk.title")}</span>
      <strong role="status" aria-live="polite">
        {formatResourceBytes(usage.total_bytes, language, 1)}
      </strong>
    </div>
  )
}
