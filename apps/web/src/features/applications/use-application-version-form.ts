import { useState } from "react"
import {
  applicationVersionInputSchema,
  applicationVersionStatus,
} from "@linksense/shared"
import { useApplicationDistributionSettings } from "./application-distribution-queries"

export function useApplicationVersionForm(applicationId: string) {
  const settings = useApplicationDistributionSettings(applicationId)
  const [editedVersion, setVersion] = useState<string | null>(null)
  const [editedGuide, setGuide] = useState<string | null>(null)
  const version = editedVersion ?? settings.data?.version_number ?? ""
  const guide = editedGuide ?? settings.data?.usage_instructions ?? ""
  const highest = settings.data?.highest_version_number ?? null
  const status = applicationVersionStatus(version, highest)
  const input = { version_number: version, usage_instructions: guide }
  return {
    settings,
    version,
    guide,
    highest,
    status,
    input,
    setVersion,
    setGuide,
    valid:
      settings.isSuccess &&
      status !== "lower" &&
      applicationVersionInputSchema.safeParse(input).success,
  }
}

export type ApplicationVersionForm = ReturnType<
  typeof useApplicationVersionForm
>
