import type { ApplicationCenterRelease } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { CapabilityLibraryItem } from "@/components/capabilities/capability-library-item"
import { Button } from "@/components/ui/button"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { ApplicationUsageModeBadges } from "./application-usage-modes"
import { ApplicationPublicationStatus } from "./application-publication-status"

export function ApplicationPublicationCard({
  release,
  onManage,
}: {
  release: ApplicationCenterRelease
  onManage: () => void
}) {
  const { t, i18n } = useTranslation()
  const notice =
    release.listing_status === "suspended"
      ? release.suspension_reason
      : release.review_comment
  const destructive =
    release.listing_status === "suspended" || release.status === "rejected"
  return (
    <CapabilityLibraryItem
      type="application"
      name={release.name}
      description={release.description || t("marketplace.noDescription")}
      metadata={
        <>
          <span>
            {t("applications.distribution.version", {
              version: release.version_number,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("marketplace.submittedAt", {
              date: formatDateTime(
                release.submitted_at,
                normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ??
                  "zh-CN"
              ),
            })}
          </span>
          <ApplicationUsageModeBadges modes={release.usage_modes} />
        </>
      }
      status={
        <ApplicationPublicationStatus
          status={release.status}
          listingStatus={release.listing_status}
        />
      }
      statusPlacement="top-right"
      notice={notice ? <span title={notice}>{notice}</span> : undefined}
      noticeVariant={destructive ? "destructive" : "default"}
      onInspect={onManage}
      actions={
        <Button variant="ghost" size="sm" onClick={onManage}>
          {t("marketplace.manageApplicationListing")}
        </Button>
      }
    />
  )
}
