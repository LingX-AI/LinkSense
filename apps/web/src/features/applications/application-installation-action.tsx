import type {
  ApplicationDistributionSummary,
  ApplicationUsageMode,
} from "@linksense/shared"
import { ChevronDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ApplicationInstallationAction({
  distribution,
  onInstall,
}: {
  distribution: Pick<
    ApplicationDistributionSummary,
    | "usage_modes"
    | "installed_application_id"
    | "copy_installation"
    | "service_installation"
  >
  onInstall: (mode: ApplicationUsageMode) => void
}) {
  const { t } = useTranslation()
  const installation = (mode: ApplicationUsageMode) =>
    mode === "service"
      ? distribution.service_installation
      : distribution.copy_installation
  const installed = (mode: ApplicationUsageMode) =>
    mode === "service"
      ? Boolean(distribution.service_installation?.installed_version_id)
      : Boolean(distribution.installed_application_id)
  const updateAvailable = (mode: ApplicationUsageMode) =>
    Boolean(installation(mode)?.update_available)
  const disabled = (mode: ApplicationUsageMode) =>
    installed(mode) && !updateAvailable(mode)
  const modes = distribution.usage_modes.filter(
    (mode) => mode !== "service" || !disabled(mode)
  )
  const firstMode = modes[0]
  if (!firstMode) return null

  const label = t(
    modes.some(updateAvailable)
      ? "applications.distribution.updateAvailable"
      : modes.every(disabled)
        ? "applications.distribution.installedLabel"
        : "applications.distribution.install"
  )
  if (modes.length === 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled(firstMode)}
        onClick={() => onInstall(firstMode)}
      >
        {label}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        {label}
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={t("applications.distribution.usageModes")}
        className="w-max max-w-(--available-width)"
      >
        <DropdownMenuGroup>
          {modes.map((mode) => (
            <DropdownMenuItem
              key={mode}
              disabled={disabled(mode)}
              onClick={() => onInstall(mode)}
            >
              {t(`applications.distribution.modes.${mode}`)}
              {(installed(mode) || updateAvailable(mode)) && (
                <span className="ml-auto">
                  {t(
                    updateAvailable(mode)
                      ? "applications.distribution.updateAvailable"
                      : "applications.distribution.installedLabel"
                  )}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
