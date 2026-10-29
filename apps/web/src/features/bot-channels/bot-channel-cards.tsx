import { Fragment, useState } from "react"
import { useTranslation } from "react-i18next"
import { AiFillDingtalkCircle, AiFillWechatWork } from "react-icons/ai"
import { BiLogoMicrosoftTeams } from "react-icons/bi"
import { getErrorMessage } from "@/api/error-message"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { BotChannelLinkDialog } from "./bot-channel-link-dialog"
import { DingtalkRegistrationDialog } from "./dingtalk-registration-dialog"
import { useBotChannels, useDingtalkRegistration } from "./use-bot-channels"
const channels = [
  { provider: "dingtalk", icon: AiFillDingtalkCircle },
  { provider: "wecom", icon: AiFillWechatWork },
  { provider: "teams", icon: BiLogoMicrosoftTeams },
] as const
export function BotChannelCards() {
  const controls = useBotChannels()
  const registration = useDingtalkRegistration()
  const { t } = useTranslation()
  const [linkId, setLinkId] = useState<string | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [remove, setRemove] = useState<{
    id: string
    personal: boolean
  } | null>(null)
  const linked = controls.query.data?.items.find((item) => item.id === linkId)
  const error =
    controls.query.error ?? controls.disconnect.error ?? controls.unlink.error
  const busy = controls.disconnect.isPending || controls.unlink.isPending
  return (
    <>
      {controls.query.isPending && <Spinner aria-label={t("common.loading")} />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorMessage(error, t)}
            <Button
              variant="outline"
              onClick={() => {
                controls.disconnect.reset()
                controls.unlink.reset()
                void controls.query.refetch()
              }}
            >
              {t("botChannels.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {channels.map(({ provider, icon: Icon }, index) => {
        const connection = controls.query.data?.items.find(
          (item) => item.provider === provider
        )
        const personal = provider === "dingtalk"
        const available = connection && connection.runtime_status !== "disabled"
        return (
          <Fragment key={provider}>
            {index > 0 && <Separator />}
            <article className="channel-access-card channel-access-card-manageable">
              <div className="channel-access-card-header">
                <div className="channel-access-heading">
                  <span
                    className={`channel-access-icon channel-access-icon-${provider}`}
                    data-channel={provider}
                    data-testid={`${provider}-channel-brand-icon`}
                    aria-hidden="true"
                  >
                    <Icon />
                  </span>
                  <div className="min-w-0">
                    <div className="channel-access-title-row">
                      <h2>{t(`channelAccess.${provider}.name`)}</h2>
                      <Badge variant="secondary">
                        {t(
                          connection
                            ? `botChannels.status.${connection.runtime_status}`
                            : personal
                              ? "botChannels.status.disconnected"
                              : "botChannels.notConfigured"
                        )}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="channel-access-description">
                  {t(
                    personal
                      ? "botChannels.personalHelp"
                      : "botChannels.organizationHelp"
                  )}
                </p>
              </div>
              <div className="channel-access-actions">
                {personal && !connection ? (
                  <Button
                    variant="secondary"
                    disabled={
                      !controls.query.isSuccess || registration.isPending
                    }
                    onClick={() => {
                      registration.reset()
                      setScanOpen(true)
                      registration.mutate()
                    }}
                  >
                    {t("botChannels.scanConnect")}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={!available || !controls.query.isSuccess || busy}
                    onClick={() => connection && setLinkId(connection.id)}
                  >
                    {t(
                      connection?.identity_linked
                        ? "botChannels.linked"
                        : "botChannels.linkAccount"
                    )}
                  </Button>
                )}
                {connection?.identity_linked && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setRemove({ id: connection.id, personal: false })
                    }
                  >
                    {t("botChannels.unlink")}
                  </Button>
                )}
                {personal && connection && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setRemove({ id: connection.id, personal: true })
                    }
                  >
                    {t("botChannels.disconnect", {
                      name: t("channelAccess.dingtalk.name"),
                    })}
                  </Button>
                )}
              </div>
            </article>
          </Fragment>
        )
      })}
      {scanOpen && (
        <DingtalkRegistrationDialog
          registration={registration}
          onClose={() => {
            setScanOpen(false)
            void controls.refresh()
          }}
          onConnected={(id) => {
            setScanOpen(false)
            void controls.refresh()
            setLinkId(id)
          }}
        />
      )}
      {linkId && (
        <BotChannelLinkDialog
          key={linkId}
          connectionId={linkId}
          linked={linked?.identity_linked ?? false}
          name={t(`channelAccess.${linked?.provider ?? "dingtalk"}.name`)}
          onClose={() => {
            setLinkId(null)
            void controls.refresh()
          }}
        />
      )}
      <Dialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>
              {t(
                remove?.personal
                  ? "botChannels.confirmDisconnect"
                  : "botChannels.unlink"
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                remove?.personal
                  ? "botChannels.disconnectHelp"
                  : "botChannels.unlinkHelp"
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!remove) return
                const action = remove.personal
                  ? controls.disconnect
                  : controls.unlink
                action.mutate(remove.id, { onSuccess: () => setRemove(null) })
              }}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
