import { useRef, useState } from "react"
import { SparklesIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { NavLink } from "react-router-dom"

import { useAuth } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { useClientUpdate } from "@/app/use-client-update"
import { SystemNoticeDialogContent } from "@/components/shell/system-notice-dialog-content"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose } from "@/components/ui/dialog"
import { useSystemUpdateStatus } from "@/features/admin/system-update-query"

const UPDATE_NOTICE_STORAGE_PREFIX = "linksense.system-update.dismissed."

export function SystemUpdateNotice() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { bootstrap } = useBootstrap()
  const clientUpdate = useClientUpdate()
  const query = useSystemUpdateStatus()
  const updateLink = useRef<HTMLAnchorElement>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const version =
    query.data?.status === "update_available"
      ? query.data.latest_release.version
      : null

  // Cached query data still needs authorization. Refresh and maintenance notices
  // take priority so independent modal dialogs cannot compete for focus.
  if (
    user?.role !== "admin" ||
    user.status !== "active" ||
    !version ||
    clientUpdate ||
    bootstrap?.maintenance?.active
  ) {
    return null
  }

  const storageKey = `${UPDATE_NOTICE_STORAGE_PREFIX}${user.id}.${version}`
  const dismissed =
    dismissedKey === storageKey || isStoredUpdateNoticeDismissed(storageKey)

  function dismissNotice(): void {
    try {
      window.localStorage.setItem(storageKey, "true")
    } catch {
      // Keep dismissal effective in this mounted shell when storage is unavailable.
    }
    setDismissedKey(storageKey)
  }

  return (
    <Dialog
      open={!dismissed}
      onOpenChange={(open) => {
        if (!open) dismissNotice()
      }}
    >
      <SystemNoticeDialogContent
        title={t("systemUpdate.notice.title", { version })}
        description={t("systemUpdate.notice.description")}
        heroIcon={
          <>
            <SparklesIcon
              className="absolute inset-0 size-full translate-x-1.5 translate-y-2 text-maintenance-hero-ink/20"
              strokeWidth={1.5}
            />
            <SparklesIcon
              className="relative size-full text-maintenance-hero-ink/85"
              strokeWidth={1.5}
            />
          </>
        }
        initialFocus={updateLink}
        footer={
          <>
            <DialogClose
              render={
                <Button variant="ghost" size="lg" className="rounded-full" />
              }
            >
              {t("systemUpdate.notice.later")}
            </DialogClose>
            <Button
              size="lg"
              className="min-w-32 rounded-full"
              nativeButton={false}
              role="link"
              render={<NavLink ref={updateLink} to="/admin/system-update" />}
            >
              {t("systemUpdate.notice.action")}
            </Button>
          </>
        }
        closeControl={
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 rounded-full text-maintenance-hero-ink hover:bg-maintenance-hero-ink/15 hover:text-maintenance-hero-ink"
              />
            }
          >
            <XIcon />
            <span className="sr-only">{t("systemUpdate.notice.dismiss")}</span>
          </DialogClose>
        }
      />
    </Dialog>
  )
}

function isStoredUpdateNoticeDismissed(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true"
  } catch {
    return false
  }
}
