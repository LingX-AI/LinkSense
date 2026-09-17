import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  applicationUsageModesSchema,
  type ApplicationGrant,
  type ApplicationUsageMode,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  ApplicationUsageModes,
  ApplicationUsageModeBadges,
} from "./application-usage-modes"

export function ApplicationGrantPermissions({
  grant,
  serviceOnly = false,
}: {
  grant: ApplicationGrant
  serviceOnly?: boolean
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [modes, setModes] = useState<ApplicationUsageMode[]>(grant.usage_modes)
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(`/applications/${grant.application_id}/grants/${grant.id}`, {
        method: "PATCH",
        body: { usage_modes: applicationUsageModesSchema.parse(modes) },
        schema: z.unknown(),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["applications"] })
      setEditing(false)
    },
  })
  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <>
          <ApplicationUsageModes
            serviceOnly={serviceOnly}
            value={modes}
            onChange={setModes}
            disabled={mutation.isPending}
          />
          {mutation.error && (
            <StatusBanner variant="error">
              {getErrorMessage(mutation.error, t)}
            </StatusBanner>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => setEditing(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!modes.length || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {t("common.save")}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationUsageModeBadges modes={grant.usage_modes} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setModes(serviceOnly ? ["service"] : grant.usage_modes)
              mutation.reset()
              setEditing(true)
            }}
          >
            {t("applications.distribution.editModes")}
          </Button>
        </div>
      )}
    </div>
  )
}
