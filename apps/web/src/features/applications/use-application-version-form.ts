import { useState } from "react"
import {
  applicationVersionInputSchema,
  applicationPublishedVersionInputSchema,
  applicationVersionStatus,
} from "@linksense/shared"
import { useApplicationDistributionSettings } from "./application-distribution-queries"

export function useApplicationVersionForm(
  applicationId: string,
  mode: "publish" | "distribution" = "distribution",
  allowSameVersion = false
) {
  const settings = useApplicationDistributionSettings(applicationId)
  const [editedVersion, setVersion] = useState<string | null>(null)
  const [editedGuide, setGuide] = useState<string | null>(null)
  const version =
    editedVersion ??
    (mode === "publish" && !allowSameVersion
      ? settings.data?.version_number
      : (settings.data?.highest_version_number ??
        settings.data?.version_number)) ??
    ""
  const guide = editedGuide ?? settings.data?.usage_instructions ?? ""
  const highest = settings.data?.highest_version_number ?? null
  const status = applicationVersionStatus(version, highest)
  const input = { version_number: version, usage_instructions: guide }
  return {
    settings,
    allowSameVersion,
    readOnly: mode === "distribution",
    version,
    guide,
    highest,
    status,
    input,
    setVersion,
    setGuide,
    valid:
      settings.isSuccess &&
      (mode === "publish"
        ? status === "new" || (allowSameVersion && status === "same")
        : status === "same") &&
      (mode === "publish"
        ? applicationVersionInputSchema
        : applicationPublishedVersionInputSchema
      ).safeParse(input).success,
  }
}

export type ApplicationVersionForm = ReturnType<
  typeof useApplicationVersionForm
>
