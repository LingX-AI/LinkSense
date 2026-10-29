import { QRCodeSVG } from "qrcode.react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  useDingtalkRegistration,
  useDingtalkRegistrationStatus,
} from "./use-bot-channels"
export function DingtalkRegistrationDialog({
  onClose,
  onConnected,
  registration,
}: {
  onClose(): void
  onConnected(id: string): void
  registration: ReturnType<typeof useDingtalkRegistration>
}) {
  const { t } = useTranslation()
  const status = useDingtalkRegistrationStatus(registration.data?.id ?? null)
  const current = status.data ?? registration.data
  const error = registration.error ?? status.error
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("botChannels.scanTitle")}</DialogTitle>
          <DialogDescription>{t("botChannels.scanHelp")}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{getErrorMessage(error, t)}</AlertDescription>
          </Alert>
        )}
        {registration.isPending && <Spinner aria-label={t("common.loading")} />}
        {current?.status === "waiting_scan" && current.qr_code_url && (
          <div className="flex flex-col items-center gap-4">
            <QRCodeSVG
              value={current.qr_code_url}
              size={224}
              marginSize={4}
              className="h-auto max-w-full rounded-lg bg-white p-3"
              role="img"
              aria-label={t("botChannels.qrLabel")}
            />
            <p className="text-sm text-muted-foreground">
              {t("botChannels.waitingScan")}
            </p>
          </div>
        )}
        {current && current.status !== "waiting_scan" && (
          <p role="status">
            {t(`botChannels.registrationStatus.${current.status}`)}
          </p>
        )}
        <DialogFooter>
          {current?.status === "connected" && current.connection_id ? (
            <Button
              onClick={() => {
                const id = current.connection_id
                if (id) onConnected(id)
              }}
            >
              {t("botChannels.linkAccount")}
            </Button>
          ) : (
            <Button
              disabled={registration.isPending}
              onClick={() => registration.mutate()}
            >
              {t(
                current || error
                  ? "botChannels.regenerate"
                  : "botChannels.generateQr"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
