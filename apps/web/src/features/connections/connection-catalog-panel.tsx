import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ConnectionProvider } from "@linksense/shared"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { CheckIcon } from "lucide-react"
import { getErrorMessage } from "@/api/error-message"
import { LoadingState, ErrorState } from "@/components/feedback/page-state"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { connectionsApi, connectionQueryKey } from "@/features/connections/api"
import { ConnectionActions } from "@/features/connections/connection-actions"
import { connectionPrimaryAction } from "@/features/connections/connection-primary-action"
import { ConnectionDetailDialog } from "@/features/connections/connection-detail-dialog"
import { useConnectionAuthorization } from "@/features/connections/use-connection-authorization"
import { ConnectionIcon } from "./connection-icon"

export function ConnectionCatalogPanel() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [result] = useState(() => params.get("connection_result"))
  const [disconnectTarget, setDisconnectTarget] =
    useState<ConnectionProvider | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<{
    provider: ConnectionProvider
    trigger: HTMLElement
  } | null>(null)
  const query = useQuery({
    queryKey: connectionQueryKey,
    queryFn: connectionsApi.list,
    refetchOnWindowFocus: "always",
  })
  useEffect(() => {
    if (!params.has("connection_result")) return
    const next = new URLSearchParams(params)
    next.delete("connection_result")
    setParams(next, { replace: true })
  }, [params, setParams])
  const refresh = () =>
    client.invalidateQueries({ queryKey: connectionQueryKey })
  const authorize = useConnectionAuthorization()
  const disconnect = useMutation({
    mutationFn: connectionsApi.disconnect,
    onSuccess: async () => {
      setDisconnectTarget(null)
      await refresh()
    },
  })
  const mutationError = authorize.error ?? disconnect.error
  const pending = authorize.isPending || disconnect.isPending
  const selectedConnection = detailsTarget
    ? query.data?.items.find((item) => item.provider === detailsTarget.provider)
    : undefined
  const requestUnbind = (provider: ConnectionProvider) => {
    setDetailsTarget(null)
    setDisconnectTarget(provider)
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        {result && (
          <Alert variant={result === "success" ? "default" : "destructive"}>
            <AlertDescription>
              {t(
                result === "success"
                  ? "connections.success"
                  : "connections.failure"
              )}
            </AlertDescription>
          </Alert>
        )}
        {mutationError && (
          <Alert variant="destructive">
            <AlertDescription>
              {getErrorMessage(mutationError, t)}
            </AlertDescription>
          </Alert>
        )}
        {authorize.tabBlocked && (
          <Alert variant="destructive">
            <AlertDescription>{t("connections.tabBlocked")}</AlertDescription>
          </Alert>
        )}
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={getErrorMessage(query.error, t)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {query.data.items.map((connection) => {
              const title = t(`connections.${connection.provider}`)
              const isUpgrade =
                connectionPrimaryAction(connection) === "upgrade"
              return (
                <Card
                  key={connection.provider}
                  role="article"
                  aria-label={title}
                  className="relative min-w-0 transition-colors hover:border-foreground/20"
                >
                  <CardHeader className="@container-normal">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <ConnectionIcon provider={connection.provider} />
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={t("marketplace.viewDetails", {
                            name: title,
                          })}
                          aria-haspopup="dialog"
                          className="static h-auto min-w-0 cursor-pointer justify-start rounded-none p-0 text-[length:inherit] text-inherit after:absolute after:inset-0 after:rounded-card hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                          onClick={(event) =>
                            setDetailsTarget({
                              provider: connection.provider,
                              trigger: event.currentTarget,
                            })
                          }
                        >
                          <span>{title}</span>
                        </Button>
                      </CardTitle>
                      <div className="flex shrink-0 items-center gap-1">
                        {connection.configured &&
                        connection.status === "connected" ? (
                          <Badge
                            className="capability-status-badge capability-status-badge-active capability-status-badge-icon-only [&>svg]:size-4!"
                            role="img"
                            aria-label={t("connections.connected")}
                          >
                            <CheckIcon aria-hidden="true" />
                          </Badge>
                        ) : !connection.configured ? (
                          <Badge variant="secondary">
                            {t("connections.notConfigured")}
                          </Badge>
                        ) : null}
                        {connection.status !== "disconnected" && (
                          <ConnectionActions
                            presentation="menu"
                            connection={connection}
                            pending={pending}
                            authorizationPending={authorize.isPending}
                            authorizingProvider={authorize.provider}
                            onAuthorize={authorize.start}
                            onUnbind={requestUnbind}
                          />
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      {t(`connections.${connection.provider}Description`)}
                    </CardDescription>
                  </CardHeader>
                  {(connection.account_name ||
                    isUpgrade ||
                    !connection.configured) && (
                    <CardContent className="flex flex-col gap-4">
                      {connection.account_name && (
                        <p
                          className="truncate text-sm"
                          title={connection.account_name}
                        >
                          {connection.account_name}
                        </p>
                      )}
                      {isUpgrade && (
                        <p className="text-sm text-muted-foreground">
                          {t("connections.upgradeHelp")}
                        </p>
                      )}
                      {!connection.configured && (
                        <p className="text-sm text-muted-foreground">
                          {t("connections.setupHelp")}
                        </p>
                      )}
                    </CardContent>
                  )}
                  {connection.status === "disconnected" && (
                    <CardFooter className="pointer-events-none relative z-10 mt-auto flex flex-wrap justify-end gap-2">
                      <ConnectionActions
                        connection={connection}
                        pending={pending}
                        authorizationPending={authorize.isPending}
                        authorizingProvider={authorize.provider}
                        onAuthorize={authorize.start}
                        onUnbind={requestUnbind}
                      />
                    </CardFooter>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>
      {detailsTarget && selectedConnection && (
        <ConnectionDetailDialog
          connection={selectedConnection}
          trigger={detailsTarget.trigger}
          pending={pending}
          authorizationPending={authorize.isPending}
          authorizingProvider={authorize.provider}
          authorizationErrorMessage={
            authorize.provider === selectedConnection.provider &&
            authorize.error
              ? getErrorMessage(authorize.error, t)
              : null
          }
          tabBlocked={authorize.blockedProvider === selectedConnection.provider}
          onAuthorize={authorize.start}
          onUnbind={requestUnbind}
          onClose={() => setDetailsTarget(null)}
        />
      )}
      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null)
        }}
        title={t("connections.disconnectTitle", {
          provider: disconnectTarget
            ? t(`connections.${disconnectTarget}`)
            : "",
        })}
        description={t("connections.disconnectDescription")}
        confirmLabel={t("connections.disconnect")}
        destructive
        pending={disconnect.isPending}
        onConfirm={() => {
          if (disconnectTarget) disconnect.mutate(disconnectTarget)
        }}
      />
    </>
  )
}
