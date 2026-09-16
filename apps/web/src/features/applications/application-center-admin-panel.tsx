import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  applicationCenterReleaseSchema,
  type ApplicationCenterRelease,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { ApplicationUsageModeBadges } from "./application-usage-modes"
import {
  applicationDistributionKeys,
  applicationCenterPageSchema,
} from "./application-distribution-queries"

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

export function ApplicationCenterAdminPanel() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ApplicationCenterRelease | null>(
    null
  )
  const query = useQuery({
    queryKey: applicationDistributionKeys.reviews,
    queryFn: ({ signal }) =>
      apiRequest("/admin/application-center", {
        schema: applicationCenterPageSchema,
        signal,
      }),
  })
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("applications.distribution.adminHint")}
      </p>
      {query.isPending && <LoadingState />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data?.items.length === 0 && (
        <EmptyState title={t("applications.distribution.noReviews")} />
      )}
      {query.data?.items.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle>{item.name}</CardTitle>
            <CardDescription>
              {item.publisher_name} ·{" "}
              {t("applications.distribution.version", {
                version: item.version_number,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {t(`marketplace.status.${item.status}`)}
              </Badge>
              <Badge variant="outline">
                {t(`marketplace.status.${item.listing_status}`)}
              </Badge>
            </div>
            <ApplicationUsageModeBadges modes={item.usage_modes} />
            <p className="break-words whitespace-pre-wrap">
              {item.release_notes}
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => setSelected(item)}>
              {t("applications.distribution.review")}
            </Button>
          </CardFooter>
        </Card>
      ))}
      {selected && (
        <ApplicationCenterReviewDialog
          release={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("applications.distribution.review")}</DialogTitle>
          <DialogDescription>{release.name}</DialogDescription>
        </DialogHeader>
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
        <DialogFooter className="flex-wrap">
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
                variant="outline"
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
