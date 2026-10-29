import { useState } from "react"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useBotChannelLinking } from "./use-bot-channels"
export function BotChannelLinkDialog({
  connectionId,
  name,
  linked,
  onClose,
}: {
  connectionId: string
  name: string
  linked: boolean
  onClose(): void
}) {
  const { t } = useTranslation()
  const linking = useBotChannelLinking()
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  async function copyConfirmation(): Promise<void> {
    if (!linking.data) return
    setCopied(false)
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(linking.data.command)
      setCopied(true)
    } catch {
      setCopyFailed(true)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("botChannels.linkTitle", { name })}</DialogTitle>
          <DialogDescription>{t("botChannels.linkHelp")}</DialogDescription>
        </DialogHeader>
        {linked ? (
          <p role="status">{t("botChannels.linked")}</p>
        ) : (
          <>
            {linking.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {getErrorMessage(linking.error, t)}
                </AlertDescription>
              </Alert>
            )}
            {linking.data && (
              <Field>
                <FieldLabel htmlFor="channel-link-command">
                  {t("botChannels.confirmationMessage")}
                </FieldLabel>
                <Input
                  id="channel-link-command"
                  readOnly
                  value={linking.data.command}
                  className="font-mono"
                />
                <FieldDescription>
                  {t("botChannels.linkExpiry")}
                </FieldDescription>
              </Field>
            )}
            {copyFailed && <p role="alert">{t("botChannels.copyFailed")}</p>}
          </>
        )}
        <DialogFooter>
          {linked ? (
            <Button onClick={onClose}>{t("common.close")}</Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={linking.isPending}
                onClick={() => {
                  setCopied(false)
                  setCopyFailed(false)
                  linking.mutate(connectionId)
                }}
              >
                {linking.isPending && <Spinner data-icon="inline-start" />}
                {t(
                  linking.data
                    ? "botChannels.regenerate"
                    : "botChannels.getConfirmation"
                )}
              </Button>
              {linking.data && (
                <Button onClick={() => void copyConfirmation()}>
                  {t(copied ? "botChannels.copied" : "botChannels.copy")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
