import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  cleanupDesktopWorkspaces,
  isMacDesktopHost,
  readDesktopWorkspaceUsage,
  type DesktopWorkspaceUsage,
} from "@/adapters/desktop/desktop-adapter"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatResourceBytes } from "@/features/admin/resource-format"
import { normalizeLanguage } from "@/i18n"

type LocalWorkspaceStatus =
  | { kind: "busy" }
  | { kind: "nothing" }
  | { kind: "completed"; freedBytes: number }
  | { kind: "failed" }

export function LocalWorkspaceSettings() {
  const { t, i18n } = useTranslation()
  const active = useRef(false)
  const [usage, setUsage] = useState<DesktopWorkspaceUsage>()
  const [busy, setBusy] = useState<"loading" | "cleanup" | null>("loading")
  const [error, setError] = useState(false)
  const [status, setStatus] = useState<LocalWorkspaceStatus | null>(null)
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"

  // The native host scopes every request to its own signed-in account. The
  // settings card is remounted per user id, so a switched account never shows
  // the previous account's aggregate.
  const loadUsage = useCallback(async () => {
    if (!isMacDesktopHost()) {
      setBusy(null)
      return
    }
    setBusy("loading")
    setError(false)
    try {
      setUsage(await readDesktopWorkspaceUsage())
    } catch {
      setUsage(undefined)
      setError(true)
    } finally {
      setBusy(null)
    }
  }, [])

  // The settings card is keyed by user id, so a remount already resets this
  // local state. Start the native read after the effect tick so its loading
  // state is not a synchronous cascading update.
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return loadUsage()
    })
    return () => {
      active = false
    }
  }, [loadUsage])

  const clean = useCallback(async () => {
    if (active.current || !isMacDesktopHost()) return
    active.current = true
    setBusy("cleanup")
    setStatus(null)
    try {
      const result = await cleanupDesktopWorkspaces()
      setStatus(
        result.status === "busy"
          ? { kind: "busy" }
          : result.deletedSessions === 0
            ? { kind: "nothing" }
            : { kind: "completed", freedBytes: result.freedBytes }
      )
      await loadUsage()
    } catch {
      setStatus({ kind: "failed" })
      // A timeout, sign-out, or runtime stop may have removed files before the
      // result was lost. Refresh the scoped aggregate so a stale size does not
      // imply that nothing was removed.
      await loadUsage()
    } finally {
      active.current = false
      setBusy(null)
    }
  }, [loadUsage])

  if (!isMacDesktopHost()) return null

  const running = busy !== null
  const message =
    busy === "loading"
      ? t("localWorkspace.loading")
      : error
        ? t("localWorkspace.unavailable")
        : status?.kind === "busy"
          ? t("localWorkspace.busy")
          : status?.kind === "nothing"
            ? t("localWorkspace.nothingEligible")
            : status?.kind === "completed"
              ? t("localWorkspace.completed", {
                  size: formatResourceBytes(status.freedBytes, language),
                })
              : status?.kind === "failed"
                ? t("localWorkspace.failed")
                : null

  return (
    <div className="grid min-w-0 justify-items-start gap-3">
      <p className="form-hint max-w-3xl text-pretty">
        {t("localWorkspace.description")}
      </p>
      {usage ? (
        <>
          <dl className="grid w-full min-w-0 grid-cols-3 gap-3 text-sm">
            <div className="grid min-w-0 gap-1">
              <dt className="text-muted-foreground">
                {t("localWorkspace.size")}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatResourceBytes(usage.bytes, language)}
              </dd>
            </div>
            <div className="grid min-w-0 gap-1">
              <dt className="text-muted-foreground">
                {t("localWorkspace.files")}
              </dt>
              <dd className="font-medium tabular-nums">
                {new Intl.NumberFormat(language).format(usage.files)}
              </dd>
            </div>
            <div className="grid min-w-0 gap-1">
              <dt className="text-muted-foreground">
                {t("localWorkspace.workspaces")}
              </dt>
              <dd className="font-medium tabular-nums">
                {new Intl.NumberFormat(language).format(usage.sessions)}
              </dd>
            </div>
          </dl>
          <p className="form-hint max-w-3xl text-pretty">
            {t("localWorkspace.policy", {
              days: usage.retentionDays,
              budget: formatResourceBytes(usage.budgetBytes, language),
            })}
          </p>
        </>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        aria-disabled={running || undefined}
        aria-busy={busy === "cleanup" || undefined}
        onClick={() => {
          if (running) return
          void (error ? loadUsage() : clean())
        }}
      >
        {busy === "cleanup" && <Spinner data-icon="inline-start" />}
        {error ? t("localWorkspace.retry") : t("localWorkspace.cleanup")}
      </Button>
      <p
        className="text-sm text-muted-foreground"
        role="status"
        aria-atomic="true"
      >
        {message}
      </p>
    </div>
  )
}
