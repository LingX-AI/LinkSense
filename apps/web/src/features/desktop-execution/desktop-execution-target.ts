import type { BootstrapStatus } from "@/api/contracts"

/**
 * Deployment-wide rollout policy discovered through the existing bootstrap
 * payload. A missing policy keeps the cloud entry open.
 */
export type DesktopExecutionTargetPolicy = Readonly<{
  /** Mac new-task cloud entry only; not a server-side cloud kill switch. */
  cloudTarget: boolean
}>

export function desktopExecutionTargetPolicy(
  bootstrap: Pick<BootstrapStatus, "desktop"> | undefined
): DesktopExecutionTargetPolicy {
  return {
    cloudTarget: bootstrap?.desktop?.cloud_target ?? true,
  }
}

// The device-settings lane owns the section behind this anchor; only Mac
// clients render it.
export const desktopDeviceSettingsHeadingId = "desktop-devices-heading"
export const desktopDeviceSettingsHref =
  `/settings/general#${desktopDeviceSettingsHeadingId}` as const
