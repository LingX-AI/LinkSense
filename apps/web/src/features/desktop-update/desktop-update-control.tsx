import { useId, useRef, useState, type ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  checkDesktopUpdate,
  desktopUpdateChannelSchema,
  installDesktopUpdate,
  isDesktopHost,
  isMacDesktopHost,
  openDesktopUpdateInstaller,
  restartDesktopAfterUpdate,
  setDesktopUpdateChannel,
  type DesktopUpdateChannel,
  type DesktopUpdateResult,
} from "@/adapters/desktop/desktop-adapter"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

import {
  applyDesktopUpdateResult,
  getDesktopUpdateSnapshot,
  useDesktopUpdateState,
} from "./desktop-update-state"

export function DesktopUpdateControl({
  trailingAction,
}: {
  trailingAction?: ReactNode
}) {
  if (!isDesktopHost()) return null
  return isMacDesktopHost() ? (
    <MacDesktopUpdatePanel trailingAction={trailingAction} />
  ) : (
    <CheckOnlyDesktopUpdateControl trailingAction={trailingAction} />
  )
}

// Windows keeps the original check-only control until its native update
// lifecycle exists.
function CheckOnlyDesktopUpdateControl({
  trailingAction,
}: {
  trailingAction?: ReactNode
}) {
  const { t } = useTranslation()
  const active = useRef(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<DesktopUpdateResult>()

  async function check() {
    if (active.current) return
    active.current = true
    setPending(true)
    setResult(undefined)
    try {
      setResult(await checkDesktopUpdate())
    } catch {
      setResult({ state: "failed" })
    } finally {
      active.current = false
      setPending(false)
    }
  }

  return (
    <div className="grid min-w-0 justify-items-start gap-2">
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          className="aria-disabled:opacity-50"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          onClick={() => void check()}
        >
          {pending && (
            <Spinner
              data-icon="inline-start"
              className="motion-reduce:animate-none"
            />
          )}
          {t("desktopUpdate.check")}
        </Button>
        {trailingAction}
      </div>
      <p
        className="w-full text-sm text-muted-foreground"
        role="status"
        aria-atomic="true"
      >
        {legacyUpdateMessage(result, t)}
      </p>
    </div>
  )
}

type PendingAction = "check" | "install" | "channel" | "restart" | "installer"

const actionErrorKeys: Record<PendingAction, string> = {
  check: "failed",
  install: "installFailed",
  channel: "channelFailed",
  restart: "restartFailed",
  installer: "installerFailed",
}

const installableStates: ReadonlyArray<DesktopUpdateResult["state"]> = [
  "available",
  "install_failed",
  "busy",
]

// In-place installation needs an explicit writable build/location and a
// fenceable candidate. The manual installer URL is unrelated to this.
function canInstallInPlace(result: DesktopUpdateResult): boolean {
  return (
    installableStates.includes(result.state) &&
    result.installAvailable === true &&
    result.version !== undefined &&
    result.revision !== undefined
  )
}

// The manual installer is offered only when native configured one and cannot
// install in place. A missing download URL never produces an action.
function canOpenInstaller(result: DesktopUpdateResult): boolean {
  return (
    result.downloadAvailable === true &&
    result.installAvailable !== true &&
    (installableStates.includes(result.state) || result.state === "unavailable")
  )
}

function MacDesktopUpdatePanel({
  trailingAction,
}: {
  trailingAction?: ReactNode
}) {
  const { t } = useTranslation()
  const channelLabelId = useId()
  const channelHintId = useId()
  const active = useRef(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [actionError, setActionError] = useState<PendingAction | null>(null)
  const state = useDesktopUpdateState()
  const current = state ?? { state: "idle" as const }
  const showInstall =
    pending === "install" ||
    canInstallInPlace(current) ||
    (current.state === "downloading" && current.installAvailable === true)
  const showInstaller = canOpenInstaller(current)
  const showCheck =
    current.state !== "downloading" && current.state !== "staged"
  const progress = updateProgress(current)
  const checking = pending === "check" || current.state === "checking"
  const actionsDisabled = pending !== null
  const channelDisabled =
    actionsDisabled ||
    current.state === "checking" ||
    current.state === "downloading" ||
    current.state === "staged"
  const channelOptions: ReadonlyArray<{
    value: DesktopUpdateChannel
    label: string
  }> = [
    { value: "stable", label: t("desktopUpdate.channelStable") },
    { value: "beta", label: t("desktopUpdate.channelBeta") },
  ]
  // Go serializes betaAvailable with omitempty, so an absent value is the
  // normal representation of "no beta feed configured", not "unknown".
  const betaAvailable = current.betaAvailable === true

  async function run(action: PendingAction, task: () => Promise<void>) {
    if (active.current) return
    active.current = true
    setPending(action)
    setActionError(null)
    try {
      await task()
    } catch {
      setActionError(action)
    } finally {
      active.current = false
      setPending(null)
    }
  }

  async function check() {
    if (current.state === "checking") return
    await run("check", async () => {
      applyDesktopUpdateResult(await checkDesktopUpdate())
    })
  }

  async function install() {
    // Use the candidate this render displayed, not a newer background
    // snapshot that replaced it before the click was handled.
    const { revision, version } = current
    if (
      revision === undefined ||
      version === undefined ||
      !canInstallInPlace(current)
    ) {
      return
    }
    const latest = getDesktopUpdateSnapshot()
    if (
      !latest ||
      latest.revision !== revision ||
      latest.version !== version ||
      latest.installAvailable !== true
    ) {
      return
    }
    await run("install", async () => {
      applyDesktopUpdateResult(await installDesktopUpdate(revision))
    })
  }

  async function changeChannel(value: string | null) {
    if (value === null) return
    const next = desktopUpdateChannelSchema.safeParse(value)
    const latestChannel = getDesktopUpdateSnapshot()?.channel ?? current.channel
    if (!next.success || next.data === latestChannel) return
    await run("channel", async () => {
      applyDesktopUpdateResult(await setDesktopUpdateChannel(next.data))
    })
  }

  async function restart() {
    await run("restart", async () => {
      await restartDesktopAfterUpdate()
    })
  }

  async function openInstaller() {
    await run("installer", async () => {
      await openDesktopUpdateInstaller()
    })
  }

  return (
    <div className="grid min-w-0 justify-items-start gap-3">
      {current.channel !== undefined && (
        <div className="grid min-w-0 gap-1.5">
          <span id={channelLabelId} className="form-label">
            {t("desktopUpdate.channel")}
          </span>
          <Select
            value={current.channel}
            items={channelOptions}
            disabled={channelDisabled}
            onValueChange={(value) => {
              if (!channelDisabled) void changeChannel(value)
            }}
          >
            <SelectTrigger
              className="w-40"
              aria-labelledby={channelLabelId}
              aria-describedby={!betaAvailable ? channelHintId : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {channelOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={option.value === "beta" && !betaAvailable}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {!betaAvailable && (
            <p id={channelHintId} className="form-hint">
              {t("desktopUpdate.channelBetaUnavailable")}
            </p>
          )}
        </div>
      )}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        {showCheck && (
          <Button
            type="button"
            variant="secondary"
            className="aria-disabled:opacity-50"
            aria-disabled={actionsDisabled || checking || undefined}
            aria-busy={checking || undefined}
            onClick={() => {
              if (!actionsDisabled && !checking) void check()
            }}
          >
            {checking && (
              <Spinner
                data-icon="inline-start"
                className="motion-reduce:animate-none"
              />
            )}
            {t("desktopUpdate.check")}
          </Button>
        )}
        {showInstall && (
          <Button
            type="button"
            className="aria-disabled:opacity-50"
            aria-disabled={
              actionsDisabled || current.state === "downloading" || undefined
            }
            aria-busy={pending === "install" || undefined}
            onClick={() => {
              if (!actionsDisabled && current.state !== "downloading") {
                void install()
              }
            }}
          >
            {pending === "install" && (
              <Spinner
                data-icon="inline-start"
                className="motion-reduce:animate-none"
              />
            )}
            {t(
              current.state === "downloading" || pending === "install"
                ? "desktopUpdate.installing"
                : "desktopUpdate.install"
            )}
          </Button>
        )}
        {showInstaller && (
          <Button
            type="button"
            variant="secondary"
            className="aria-disabled:opacity-50"
            aria-disabled={actionsDisabled || undefined}
            aria-busy={pending === "installer" || undefined}
            onClick={() => {
              if (!actionsDisabled) void openInstaller()
            }}
          >
            {pending === "installer" && (
              <Spinner
                data-icon="inline-start"
                className="motion-reduce:animate-none"
              />
            )}
            {t("desktopUpdate.openInstaller")}
          </Button>
        )}
        {current.state === "staged" && (
          <Button
            type="button"
            className="aria-disabled:opacity-50"
            aria-disabled={actionsDisabled || undefined}
            aria-busy={pending === "restart" || undefined}
            onClick={() => {
              if (!actionsDisabled) void restart()
            }}
          >
            {pending === "restart" && (
              <Spinner
                data-icon="inline-start"
                className="motion-reduce:animate-none"
              />
            )}
            {t("desktopUpdate.restart")}
          </Button>
        )}
        {trailingAction && (
          <div className="ml-auto shrink-0">{trailingAction}</div>
        )}
      </div>
      <div
        className="flex w-full min-w-0 items-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-atomic="true"
      >
        {current.state === "downloading" && progress === null && (
          <Spinner className="motion-reduce:animate-none" />
        )}
        <span>{updateMessage(current, t)}</span>
      </div>
      {current.state === "downloading" && progress !== null && (
        <Progress value={progress} className="w-full max-w-md">
          <ProgressLabel className="sr-only">
            {t("desktopUpdate.progressLabel")}
          </ProgressLabel>
          <ProgressValue>{`${progress}%`}</ProgressValue>
        </Progress>
      )}
      {current.notes !== undefined && current.notes !== "" && (
        <Collapsible
          key={`${current.version ?? ""}:${current.channel ?? ""}`}
          className="w-full max-w-xl min-w-0"
        >
          <CollapsibleTrigger
            type="button"
            className="group flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md text-left text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="min-w-0">{t("desktopUpdate.releaseNotes")}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div
              data-slot="desktop-update-release-notes"
              className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground"
            >
              {current.notes}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {t(`desktopUpdate.${actionErrorKeys[actionError]}`)}
        </p>
      )}
    </div>
  )
}

function updateProgress(result: DesktopUpdateResult): number | null {
  if (result.state !== "downloading") return null
  const { downloaded, total } = result
  if (
    downloaded === undefined ||
    total === undefined ||
    total <= 0 ||
    downloaded < 0 ||
    downloaded > total
  ) {
    return null
  }
  return Math.min(100, Math.floor((downloaded / total) * 100))
}

function updateMessage(
  result: DesktopUpdateResult,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  switch (result.state) {
    case "idle":
      return null
    case "checking":
      return t("desktopUpdate.checking")
    case "available":
      if (!result.version) return t("desktopUpdate.failed")
      // A check-only result has no revision or install flags. Keep its
      // original copy instead of presenting it as an installable candidate.
      return result.revision === undefined
        ? t("desktopUpdate.available", { version: result.version })
        : t("desktopUpdate.updateAvailable", { version: result.version })
    case "current":
      return t("desktopUpdate.current")
    case "unavailable":
      return t("desktopUpdate.unavailable")
    case "failed":
      return t("desktopUpdate.failed")
    case "busy":
      return t("desktopUpdate.busy")
    case "downloading":
      return updateProgress(result) === null
        ? t("desktopUpdate.preparing")
        : t("desktopUpdate.downloading")
    case "staged":
      return t("desktopUpdate.staged")
    case "install_failed":
      return t("desktopUpdate.installFailed")
  }
}

function legacyUpdateMessage(
  result: DesktopUpdateResult | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (!result) return null
  switch (result.state) {
    case "available":
      return result.version
        ? t("desktopUpdate.available", { version: result.version })
        : t("desktopUpdate.failed")
    case "current":
      return t("desktopUpdate.current")
    case "unavailable":
      return t("desktopUpdate.unavailable")
    default:
      return t("desktopUpdate.failed")
  }
}
