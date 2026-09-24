import type { Connection, ConnectionProvider } from "@linksense/shared"
import { Link2Icon, MoreHorizontalIcon, UnplugIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { connectionPrimaryAction } from "./connection-primary-action"

export function ConnectionActions({
  connection,
  pending,
  authorizationPending,
  authorizingProvider,
  onAuthorize,
  onUnbind,
  presentation = "buttons",
}: {
  connection: Connection
  pending: boolean
  authorizationPending: boolean
  authorizingProvider?: ConnectionProvider
  onAuthorize: (provider: ConnectionProvider) => void
  onUnbind: (provider: ConnectionProvider) => void
  presentation?: "buttons" | "menu"
}) {
  const { t } = useTranslation()
  const action = connectionPrimaryAction(connection)
  const isAuthorizing =
    authorizationPending && authorizingProvider === connection.provider

  if (presentation === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="pointer-events-auto relative z-10"
              disabled={pending}
              aria-busy={isAuthorizing}
              aria-label={t("common.moreActionsNamed", {
                name: t(`connections.${connection.provider}`),
              })}
            />
          }
        >
          {isAuthorizing ? (
            <Spinner />
          ) : (
            <MoreHorizontalIcon aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max min-w-32">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={pending || !connection.configured}
              onClick={() => onAuthorize(connection.provider)}
            >
              <Link2Icon aria-hidden="true" />
              {t(`connections.${action}`)}
            </DropdownMenuItem>
            {connection.status !== "disconnected" && (
              <DropdownMenuItem
                variant="destructive"
                disabled={pending}
                onClick={() => onUnbind(connection.provider)}
              >
                <UnplugIcon aria-hidden="true" />
                {t("connections.disconnect")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <Button
        type="button"
        className="pointer-events-auto"
        disabled={pending || !connection.configured}
        aria-busy={isAuthorizing}
        variant={action === "upgrade" ? "outline" : "secondary"}
        size={action === "upgrade" ? "default" : "sm"}
        onClick={() => onAuthorize(connection.provider)}
      >
        {isAuthorizing ? (
          <Spinner data-icon="inline-start" />
        ) : action !== "upgrade" ? (
          <Link2Icon data-icon="inline-start" aria-hidden="true" />
        ) : null}
        {t(`connections.${action}`)}
      </Button>
      {connection.status !== "disconnected" && (
        <Button
          type="button"
          variant="destructive-ghost"
          size="sm"
          className="pointer-events-auto"
          disabled={pending}
          onClick={() => onUnbind(connection.provider)}
        >
          <UnplugIcon data-icon="inline-start" aria-hidden="true" />
          {t("connections.disconnect")}
        </Button>
      )}
    </>
  )
}
