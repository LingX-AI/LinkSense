import { applicationVersionStatus, type ApplicationServiceInstallation } from "@linksense/shared";

type Version = { id: string; versionLabel: string; versionNumber: number };
export function isApplicationVersionUpdate(installed: Pick<Version, "versionLabel" | "versionNumber">, available: Pick<Version, "versionLabel" | "versionNumber">): boolean {
  const status = applicationVersionStatus(available.versionLabel, installed.versionLabel);
  return status === "new" || (status === "same" && available.versionNumber > installed.versionNumber);
}
export function projectServiceInstallation(installed: Version | null | undefined, available: Version | null | undefined): ApplicationServiceInstallation {
  return {
    installed_version_id: installed?.id ?? null,
    installed_version_number: installed?.versionLabel ?? null,
    available_version_id: available?.id ?? null,
    available_version_number: available?.versionLabel ?? null,
    update_available: Boolean(installed && available && isApplicationVersionUpdate(installed, available)),
  };
}
