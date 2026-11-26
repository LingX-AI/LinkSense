import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"

import { conversationSettingsReturnState } from "@/components/shell/settings-return-navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { browserExtensionSettingsPath } from "@/features/browser-use/settings-path"

import {
  desktopExecutionDefaultTargetKey,
  desktopStartGuideKey,
  hasStoredDesktopExecutionDefaultTarget,
} from "./desktop-execution-default-target"
import {
  desktopDeviceSettingsHref,
  desktopExecutionDefaultTargetHref,
  type DesktopExecutionDeviceAvailability,
} from "./desktop-execution-target"

function readDismissed(storageKey: string | null): boolean {
  if (!storageKey) return false
  try {
    return window.localStorage.getItem(storageKey) === "dismissed"
  } catch {
    return false
  }
}

/**
 * Pairing is offered only when this Mac is known to be unpaired or revoked.
 * A paired device (ready, connecting, offline, or an old host that is not
 * ready) and an unknown status both omit the pairing step instead of claiming
 * this Mac is unconfigured.
 */
function pairingIsKnownMissing(
  availability: DesktopExecutionDeviceAvailability
): boolean {
  return (
    availability.kind === "unavailable" &&
    (availability.reason === "unpaired" || availability.reason === "revoked")
  )
}

export function MacDesktopStartGuide({
  userId,
  modelSetupActive = false,
  deviceAvailability,
  localComputerEnabled,
  cloudTargetEnabled,
}: Readonly<{
  userId?: string
  modelSetupActive?: boolean
  deviceAvailability: DesktopExecutionDeviceAvailability
  localComputerEnabled: boolean
  cloudTargetEnabled: boolean
}>) {
  const { t } = useTranslation()
  const location = useLocation()
  const titleId = useId()
  const storageKey = desktopStartGuideKey(userId)
  const [visibility, setVisibility] = useState(() => ({
    key: storageKey,
    dismissed: readDismissed(storageKey),
  }))
  let dismissed = visibility.dismissed
  if (visibility.key !== storageKey) {
    dismissed = readDismissed(storageKey)
    setVisibility({ key: storageKey, dismissed })
  }

  const showPairing =
    localComputerEnabled && pairingIsKnownMissing(deviceAvailability)
  const hasRunLocation = localComputerEnabled || cloudTargetEnabled
  const hasSavedDefault = hasStoredDesktopExecutionDefaultTarget(
    desktopExecutionDefaultTargetKey(userId)
  )

  if (
    modelSetupActive ||
    !storageKey ||
    dismissed ||
    !hasRunLocation ||
    hasSavedDefault
  ) {
    return null
  }

  const dismiss = () => {
    setVisibility({ key: storageKey, dismissed: true })
    try {
      window.localStorage.setItem(storageKey, "dismissed")
    } catch {
      // Dismissal still holds for this mount when storage is unavailable.
    }
  }

  const returnState = conversationSettingsReturnState(location)
  const steps = [
    ...(showPairing
      ? [
          {
            id: "pair",
            to: desktopDeviceSettingsHref,
            title: t("desktopExecution.startGuidePairTitle"),
            description: t("desktopExecution.startGuidePairDescription"),
          },
        ]
      : []),
    {
      id: "browser",
      to: browserExtensionSettingsPath,
      title: t("desktopExecution.startGuideBrowserTitle"),
      description: t("desktopExecution.startGuideBrowserDescription"),
    },
    ...(localComputerEnabled
      ? [
          {
            id: "run-location",
            to: desktopExecutionDefaultTargetHref,
            title: t("desktopExecution.startGuideDefaultTargetTitle"),
            description: t("desktopExecution.defaultTargetDescription"),
          },
        ]
      : []),
  ]

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="w-full max-w-xl gap-3 p-4 text-left sm:p-5"
    >
      <div className="min-w-0">
        <h3 id={titleId} className="font-semibold">
          {t("desktopExecution.startGuideTitle")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("desktopExecution.startGuideDescription")}
        </p>
      </div>
      <ol className="grid list-decimal gap-2 pl-5 marker:text-xs marker:text-muted-foreground">
        {steps.map((step) => {
          const labelId = `${titleId}-${step.id}-label`
          const descriptionId = `${titleId}-${step.id}-description`
          return (
            <li key={step.id} className="min-w-0">
              <Link
                to={step.to}
                state={returnState}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                className="group grid min-w-0 gap-0.5 rounded-lg px-2 py-1.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span
                  id={labelId}
                  className="text-sm font-medium text-foreground group-hover:underline"
                >
                  {step.title}
                </span>
                <span
                  id={descriptionId}
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {step.description}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {t("desktopExecution.startGuideSkip")}
        </Button>
      </div>
    </Card>
  )
}
