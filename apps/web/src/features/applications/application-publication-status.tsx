import type { ApplicationCenterRelease } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"

export function ApplicationPublicationStatus({
  status,
  listingStatus,
}: {
  status?: ApplicationCenterRelease["status"]
  listingStatus: ApplicationCenterRelease["listing_status"]
}) {
  const { t } = useTranslation()
  // Administrator removal takes precedence over a release's review history.
  const current =
    listingStatus === "suspended"
      ? "unlisted"
      : !status || status === "approved"
        ? listingStatus
        : status
  return (
    <Badge
      variant={
        listingStatus === "suspended" || current === "rejected"
          ? "destructive"
          : "secondary"
      }
    >
      {t(`marketplace.status.${current}`)}
    </Badge>
  )
}
