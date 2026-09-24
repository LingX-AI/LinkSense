import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowRightIcon } from "lucide-react"
import { z } from "zod"
import {
  applicationCenterReleaseSchema,
  type ApplicationCenterRelease,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { ApplicationUsageModeBadges } from "./application-usage-modes"
import { MarketplaceGovernanceRow } from "@/components/capabilities/marketplace-governance-row"
import { ApplicationIconDisplay } from "./application-icon"
import { ApplicationPublicationStatus } from "./application-publication-status"
import { defaultApplicationIcon } from "./application-icon-default"
import { applicationDistributionKeys } from "./application-distribution-queries"

const detailSchema = z.strictObject({
  release: applicationCenterReleaseSchema,
  instructions: z.string().max(20000),
  capabilities: z.array(
    z.strictObject({ name: z.string(), type: z.enum(["plugin", "skill"]) })
  ),
  knowledge_base_count: z.number().int(),
  mcp_server_count: z.number().int(),
  interactive_files: z.array(z.string()),
})

export function ApplicationCenterAdminItem({
  item,
  scope,
}: {
  item: ApplicationCenterRelease
  scope: "reviews" | "listings"
}) {
  const { t } = useTranslation()
  const [reviewOpen, setReviewOpen] = useState(false)
  return (
    <>
      <MarketplaceGovernanceRow
        name={item.name}
        logo={
          <span className="capability-logo">
            <ApplicationIconDisplay
              icon={defaultApplicationIcon}
              className="size-full after:border-0"
            />
          </span>
        }
        description={item.description || t("applications.noDescription")}
        status={
          <ApplicationPublicationStatus
            status={
              scope === "reviews" || item.listing_status === "draft"
                ? item.status
                : undefined
            }
            listingStatus={item.listing_status}
          />
        }
        metadata={
          <>
            <span>
              {t("marketplace.byPublisher", {
                publisher: item.publisher_name,
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t(`applications.details.kinds.${item.kind}`)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {t("applications.distribution.version", {
                version: item.version_number,
              })}
            </span>
            <ApplicationUsageModeBadges modes={item.usage_modes} />
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="max-sm:min-h-11"
            onClick={() => setReviewOpen(true)}
          >
            {t(
              scope === "reviews"
                ? "applications.distribution.review"
                : "marketplace.manageApplicationListing"
            )}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        }
      />
      {reviewOpen && (
        <ApplicationCenterReviewDialog
          release={item}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </>
  )
}

function ApplicationCenterReviewDialog({
  release,
  onClose,
}: {
  release: ApplicationCenterRelease
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [comment, setComment] = useState("")
  const detail = useQuery({
    queryKey: [...applicationDistributionKeys.reviews, release.id],
    queryFn: ({ signal }) =>
      apiRequest(`/admin/application-center/${release.id}`, {
        schema: detailSchema,
        signal,
      }),
  })
  const mutation = useMutation({
    mutationFn: ({
      decision,
      status,
    }: {
      decision?: "approved" | "rejected"
      status?: "suspended" | "published"
    }) =>
      apiRequest(
        decision
          ? `/admin/application-center/${release.id}/review`
          : `/admin/application-center/applications/${release.application_id}/status`,
        {
          method: decision ? "POST" : "PATCH",
          body: decision ? { decision, comment } : { status, reason: comment },
          schema: z.unknown(),
        }
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: applicationDistributionKeys.reviews,
        }),
        client.invalidateQueries({ queryKey: applicationDistributionKeys.all }),
      ])
      onClose()
    },
  })
  const current = detail.data?.release
  const error = detail.error ?? mutation.error
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t("applications.distribution.review")}</DialogTitle>
          <DialogDescription className="line-clamp-2 wrap-anywhere">
            {release.name}
          </DialogDescription>
        </DialogHeader>
        <div
          data-slot="dialog-body"
          className={dialogBodyStyles("flex flex-1 flex-col gap-4")}
        >
          {detail.isPending && <LoadingState />}
          {error && (
            <StatusBanner variant="error">
              {getErrorMessage(error, t)}
            </StatusBanner>
          )}
          {detail.data && (
            <div className="flex flex-col gap-3">
              <ApplicationUsageModeBadges
                modes={detail.data.release.usage_modes}
              />
              {detail.data.release.release_notes && (
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="font-medium">
                    {t("applications.distribution.releaseNotes")}
                  </h3>
                  <p className="wrap-anywhere whitespace-pre-wrap">
                    {detail.data.release.release_notes}
                  </p>
                </div>
              )}
              <h3 className="font-medium">
                {t("applications.distribution.reviewInstructions")}
              </h3>
              <p className="break-words whitespace-pre-wrap">
                {detail.data.instructions}
              </p>
              <p>
                {t("applications.capabilityCount", {
                  count: detail.data.capabilities.length,
                })}{" "}
                ·{" "}
                {t("applications.knowledgeBaseCount", {
                  count: detail.data.knowledge_base_count,
                })}{" "}
                ·{" "}
                {t("applications.mcpServerCount", {
                  count: detail.data.mcp_server_count,
                })}
              </p>
              {detail.data.capabilities.map((item) => (
                <p key={`${item.type}:${item.name}`}>{item.name}</p>
              ))}
              {detail.data.interactive_files.length > 0 && (
                <ul className="list-inside list-disc text-sm">
                  {detail.data.interactive_files.map((path) => (
                    <li key={path} className="break-all">
                      {path}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="application-review-comment">
                {t("applications.distribution.reviewComment")}
              </FieldLabel>
              <Textarea
                id="application-review-comment"
                value={comment}
                maxLength={4000}
                onChange={(event) => setComment(event.target.value)}
                disabled={mutation.isPending}
              />
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap justify-end">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {t("common.close")}
          </Button>
          {current?.status === "pending" && (
            <>
              <Button
                variant="destructive"
                disabled={!comment.trim() || mutation.isPending}
                onClick={() => mutation.mutate({ decision: "rejected" })}
              >
                {t("applications.distribution.reject")}
              </Button>
              <Button
                disabled={
                  mutation.isPending || current.listing_status === "suspended"
                }
                onClick={() => mutation.mutate({ decision: "approved" })}
              >
                {t("applications.distribution.approve")}
              </Button>
            </>
          )}
          {current?.listing_status === "published" && (
            <Button
              variant="destructive"
              disabled={!comment.trim() || mutation.isPending}
              onClick={() => mutation.mutate({ status: "suspended" })}
            >
              {t("applications.distribution.suspend")}
            </Button>
          )}
          {current?.listing_status === "suspended" && (
            <Button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ status: "published" })}
            >
              {t("applications.distribution.resume")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
