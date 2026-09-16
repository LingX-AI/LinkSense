import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  applicationCenterReleaseSchema,
  applicationCenterSubmissionInputSchema,
  type ApplicationUsageMode,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { ApplicationVersionFields } from "./application-version-fields"
import { ApplicationDistributionLayout } from "./application-distribution-layout"
import { useApplicationVersionForm } from "./use-application-version-form"
import {
  ApplicationUsageModes,
  ApplicationUsageModeBadges,
} from "./application-usage-modes"
import {
  applicationDistributionKeys,
  applicationCenterPageSchema,
} from "./application-distribution-queries"

export function ApplicationCenterSubmissionPanel({
  applicationId,
  onSubmitted,
}: {
  applicationId: string
  onSubmitted: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const versionForm = useApplicationVersionForm(applicationId)
  const [modes, setModes] = useState<ApplicationUsageMode[]>(["install"])
  const [notes, setNotes] = useState("")
  const releases = useQuery({
    queryKey: applicationDistributionKeys.releases(applicationId),
    queryFn: ({ signal }) =>
      apiRequest(`/application-center/mine/${applicationId}`, {
        schema: applicationCenterPageSchema,
        signal,
      }),
  })
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: applicationDistributionKeys.all,
    })
  }
  const submit = useMutation({
    mutationFn: () =>
      apiRequest(`/application-center/${applicationId}/submissions`, {
        method: "POST",
        body: applicationCenterSubmissionInputSchema.parse({
          ...versionForm.input,
          usage_modes: modes,
          release_notes: notes,
        }),
        schema: applicationCenterReleaseSchema,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["applications"] })
      notify.success(t("applications.distribution.submitted"))
      onSubmitted()
    },
    onError: () => {
      void versionForm.settings.refetch()
    },
  })
  const action = useMutation({
    mutationFn: ({
      path,
      status,
    }: {
      path: string
      status?: "published" | "unlisted"
    }) =>
      apiRequest(path, {
        method: status ? "PATCH" : "DELETE",
        ...(status ? { body: { status, reason: "" } } : {}),
        schema: z.unknown(),
      }),
    onSuccess: refresh,
  })
  const pending = releases.data?.items.some((item) => item.status === "pending")
  const latest = releases.data?.items[0]
  const busy = submit.isPending || action.isPending
  const error = releases.error ?? submit.error ?? action.error
  return (
    <ApplicationDistributionLayout
      actions={
        <>
          {latest &&
            (latest.listing_status === "published" ||
              latest.listing_status === "unlisted") && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  action.mutate({
                    path: `/application-center/${applicationId}/status`,
                    status:
                      latest.listing_status === "published"
                        ? "unlisted"
                        : "published",
                  })
                }
              >
                {t(
                  latest.listing_status === "published"
                    ? "applications.distribution.unlist"
                    : "applications.distribution.relist"
                )}
              </Button>
            )}
          <Button
            disabled={
              busy ||
              !releases.data ||
              pending ||
              !versionForm.valid ||
              latest?.listing_status === "suspended" ||
              !applicationCenterSubmissionInputSchema.safeParse({
                ...versionForm.input,
                usage_modes: modes,
                release_notes: notes,
              }).success
            }
            onClick={() => submit.mutate()}
          >
            {t("applications.distribution.submit")}
          </Button>
        </>
      }
    >
      {latest && (
        <Badge variant="secondary">
          {t(`marketplace.status.${latest.listing_status}`)}
        </Badge>
      )}
      {latest?.suspension_reason && (
        <StatusBanner variant="warning">
          {latest.suspension_reason}
        </StatusBanner>
      )}
      <FieldDescription size="caption">
        {t("applications.distribution.submitHint")}
      </FieldDescription>
      <ApplicationVersionFields form={versionForm} disabled={busy} />
      <ApplicationUsageModes
        value={modes}
        onChange={setModes}
        disabled={busy}
      />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="application-release-notes">
            {t("applications.distribution.releaseNotes")}
          </FieldLabel>
          <Textarea
            id="application-release-notes"
            value={notes}
            maxLength={8000}
            onChange={(event) => setNotes(event.target.value)}
            disabled={busy}
          />
        </Field>
      </FieldGroup>
      {error && (
        <StatusBanner variant="error">{getErrorMessage(error, t)}</StatusBanner>
      )}
      {releases.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : releases.data?.items.length === 0 ? (
        <p>{t("applications.distribution.noReleases")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {releases.data?.items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-2 rounded-xl border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {t("applications.distribution.version", {
                    version: item.version_number,
                  })}
                </span>
                <Badge variant="secondary">
                  {t(`marketplace.status.${item.status}`)}
                </Badge>
              </div>
              <ApplicationUsageModeBadges modes={item.usage_modes} />
              <p className="text-[length:var(--app-font-13)] leading-5 break-words whitespace-pre-wrap">
                {item.release_notes}
              </p>
              {item.review_comment && (
                <p className="text-[length:var(--app-font-13)] leading-5">
                  {item.review_comment}
                </p>
              )}
              {item.status === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    action.mutate({
                      path: `/application-center/releases/${item.id}`,
                    })
                  }
                >
                  {t("applications.distribution.withdraw")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </ApplicationDistributionLayout>
  )
}
