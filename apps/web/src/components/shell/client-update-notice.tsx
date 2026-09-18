import { useRef, useState } from "react"
import { InfoIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useClientUpdate } from "@/app/use-client-update"
import { reloadClientPage } from "@/app/client-update-navigation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose } from "@/components/ui/dialog"
import { SystemNoticeDialogContent } from "./system-notice-dialog-content"

const refreshHelpDevices = ["windows", "mac", "mobile"] as const

export function ClientUpdateNotice() {
  const buildId = useClientUpdate()
  // Mount a fresh notice for each deployment, including a second deployment
  // while this tab is still open. The page and its drafts remain mounted.
  return buildId ? <UpdateNotice key={buildId} /> : null
}

function UpdateNotice() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const updateButton = useRef<HTMLButtonElement>(null)
  const submitting = useRef(false)

  async function updatePage() {
    if (submitting.current) return
    submitting.current = true
    setChecking(true)
    setFailed(false)
    try {
      await reloadClientPage()
    } catch {
      setFailed(true)
    } finally {
      submitting.current = false
      setChecking(false)
    }
  }

  return (
    <>
      {!open && (
        <Button
          className="fixed right-6 bottom-6 z-40 max-w-[calc(100%-3rem)] rounded-full"
          onClick={() => setOpen(true)}
        >
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          {t("clientUpdate.title")}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!checking) setOpen(next)
        }}
      >
        <SystemNoticeDialogContent
          title={t("clientUpdate.title")}
          description={t("clientUpdate.description")}
          heroIcon={
            <>
              <RefreshCwIcon
                className="absolute inset-0 size-full translate-x-1.5 translate-y-2 text-maintenance-hero-ink/20"
                preserveAspectRatio="xMidYMid meet"
                strokeWidth={2}
              />
              <RefreshCwIcon
                className="relative size-full text-maintenance-hero-ink/85"
                preserveAspectRatio="xMidYMid meet"
                strokeWidth={2}
              />
            </>
          }
          initialFocus={updateButton}
          footer={
            <>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full"
                disabled={checking}
                onClick={() => setOpen(false)}
              >
                {t("clientUpdate.later")}
              </Button>
              <Button
                ref={updateButton}
                size="lg"
                className="min-w-32 rounded-full"
                disabled={checking}
                onClick={() => {
                  void updatePage()
                }}
              >
                {t(checking ? "clientUpdate.updating" : "clientUpdate.update")}
              </Button>
            </>
          }
          closeControl={
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={checking}
                  className="absolute top-4 right-4 rounded-full text-maintenance-hero-ink hover:bg-maintenance-hero-ink/15 hover:text-maintenance-hero-ink"
                />
              }
            >
              <XIcon />
              <span className="sr-only">{t("common.close")}</span>
            </DialogClose>
          }
        >
          <Alert appearance="soft" role="note" className="w-full">
            <InfoIcon aria-hidden="true" />
            <AlertTitle>{t("clientUpdate.forceRefreshTitle")}</AlertTitle>
            <AlertDescription className="min-w-0 pt-2">
              <dl className="grid gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-4">
                {refreshHelpDevices.map((device) => (
                  <div
                    key={device}
                    className="grid min-w-0 gap-y-1 sm:col-span-2 sm:grid-cols-subgrid"
                  >
                    <dt className="whitespace-nowrap">
                      {t(`clientUpdate.${device}Label`)}
                    </dt>
                    <dd className="min-w-0">
                      {t(`clientUpdate.${device}Help`)}
                    </dd>
                  </div>
                ))}
              </dl>
            </AlertDescription>
          </Alert>
          {failed && (
            <Alert variant="destructive" className="w-full">
              <AlertDescription>{t("clientUpdate.notReady")}</AlertDescription>
            </Alert>
          )}
        </SystemNoticeDialogContent>
      </Dialog>
    </>
  )
}
