import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { ConnectionProviderSettings } from "@linksense/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ConnectionIcon } from "./connection-icon"
import { ConnectionSettingsEditor } from "./connection-settings-editor"

export function AdminConnectionSettings({
  items,
}: {
  items: ConnectionProviderSettings[]
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ConnectionProviderSettings | null>(
    null
  )
  return (
    <>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {items.map((settings) => {
          const name = t(`connections.${settings.provider}`)
          const configured = Boolean(
            settings.client_id && settings.secret_configured
          )
          return (
            <Card
              key={settings.provider}
              role="article"
              aria-labelledby={`admin-connector-${settings.provider}`}
              className="min-w-0"
            >
              <CardHeader>
                <CardTitle className="flex min-w-0 items-center gap-3">
                  <ConnectionIcon provider={settings.provider} />
                  <h2
                    id={`admin-connector-${settings.provider}`}
                    className="min-w-0 break-words"
                  >
                    {name}
                  </h2>
                </CardTitle>
                <CardDescription>
                  {t(`connections.${settings.provider}Description`)}
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 flex-1">
                <Badge variant="secondary">
                  {t(
                    configured
                      ? "adminConnections.configured"
                      : "adminConnections.notConfigured"
                  )}
                </Badge>
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  variant="outline"
                  onClick={() => setSelected(settings)}
                  aria-label={t("adminConnections.configureProvider", {
                    provider: name,
                  })}
                >
                  {t("adminConnections.configure")}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
      {selected && (
        <ConnectionSettingsEditor
          settings={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
