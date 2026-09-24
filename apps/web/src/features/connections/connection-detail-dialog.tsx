import type { Connection, ConnectionProvider } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConnectionActions } from "./connection-actions"
import { connectionPrimaryAction } from "./connection-primary-action"
import { ConnectionIcon } from "./connection-icon"

export function ConnectionDetailDialog({
  connection,
  trigger,
  pending,
  authorizationPending,
  authorizingProvider,
  authorizationErrorMessage,
  tabBlocked,
  onAuthorize,
  onUnbind,
  onClose,
}: {
  connection: Connection
  trigger: HTMLElement
  pending: boolean
  authorizationPending: boolean
  authorizingProvider?: ConnectionProvider
  authorizationErrorMessage: string | null
  tabBlocked: boolean
  onAuthorize: (provider: ConnectionProvider) => void
  onUnbind: (provider: ConnectionProvider) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const title = t(`connections.${connection.provider}`)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        finalFocus={() => trigger}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <ConnectionIcon provider={connection.provider} />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>
            {t(`connections.${connection.provider}Description`)}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("common.status")}</dt>
          <dd>
            {t(
              connection.configured
                ? `connections.${connection.status}`
                : "connections.notConfigured"
            )}
          </dd>
          {connection.account_name && (
            <>
              <dt className="text-muted-foreground">
                {t("connections.connectedAccount")}
              </dt>
              <dd className="min-w-0 break-all">{connection.account_name}</dd>
            </>
          )}
        </dl>
        {connectionPrimaryAction(connection) === "upgrade" && (
          <p className="text-sm text-muted-foreground">
            {t("connections.upgradeHelp")}
          </p>
        )}
        {!connection.configured && (
          <p className="text-sm text-muted-foreground">
            {t("connections.setupHelp")}
          </p>
        )}
        {authorizationErrorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{authorizationErrorMessage}</AlertDescription>
          </Alert>
        )}
        {tabBlocked && (
          <Alert variant="destructive">
            <AlertDescription>{t("connections.tabBlocked")}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <ConnectionActions
            connection={connection}
            pending={pending}
            authorizationPending={authorizationPending}
            authorizingProvider={authorizingProvider}
            onAuthorize={onAuthorize}
            onUnbind={onUnbind}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
