import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CopyIcon, DownloadIcon, MonitorIcon } from "lucide-react"
import {
  computerUsePairingSchema,
  computerUseStatusSchema,
} from "@linksense/shared"
import { apiRequest, downloadApiFile } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { copyTextToClipboard } from "@/lib/clipboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { StatusBanner } from "@/components/feedback/status-banner"
import { computerUsePlatform } from "./platform"
import { computerUseStatusKey } from "./query-keys"

export function ComputerUseSettings({ userId }: { userId?: string }) {
  const { t } = useTranslation()
  const cache = useQueryClient()
  const [pairing, setPairing] = useState<{
    code: string
    expires_at: string
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const status = useQuery({
    queryKey: computerUseStatusKey(userId),
    queryFn: ({ signal }) =>
      apiRequest("/computer-use", { schema: computerUseStatusSchema, signal }),
    enabled: Boolean(userId),
    refetchInterval: () =>
      document.visibilityState === "visible" ? 5_000 : false,
  })
  const action = useMutation({
    mutationFn: async (
      operation: "pair" | "disconnect" | "download" | "copy"
    ) => {
      if (operation === "pair") {
        const result = await apiRequest("/computer-use/pairing", {
          method: "POST",
          body: {},
          schema: computerUsePairingSchema,
        })
        setCopied(false)
        setPairing({ code: result.code, expires_at: result.expires_at })
      } else if (operation === "disconnect") {
        await apiRequest("/computer-use", {
          method: "DELETE",
          schema: computerUseStatusSchema,
        })
        setPairing(null)
      } else if (operation === "copy") {
        if (!pairing || Date.parse(pairing.expires_at) <= Date.now()) return
        await copyTextToClipboard(pairing.code)
        setCopied(true)
      } else {
        const downloadPlatform = computerUsePlatform()
        const file = await downloadApiFile("/computer-use/client", {
          platform: downloadPlatform === "macos" ? "darwin" : "win32",
        })
        const url = URL.createObjectURL(file)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download =
          downloadPlatform === "windows"
            ? "LinkSense-Desktop-windows.exe"
            : "LinkSense-Desktop-macos.zip"
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1_000)
      }
    },
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: computerUseStatusKey(userId) }),
  })
  const data = status.data
  const connected = data?.connected === true
  const platform = computerUsePlatform()
  const supported = platform === "macos" || platform === "windows"
  const clientAvailable =
    platform === "macos"
      ? (data?.clients?.darwin ?? data?.client_available)
      : platform === "windows"
        ? data?.clients?.win32
        : false
  return (
    <SettingsCard
      id="computer-use"
      tabIndex={-1}
      aria-labelledby="computer-use-heading"
      layout="split"
      icon={<MonitorIcon />}
      className="scroll-mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
      header={
        <SettingsSectionHeader
          id="computer-use-heading"
          title={t("computerUse.title")}
        />
      }
    >
      <div className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "default" : "secondary"}>
            {t(
              connected ? "computerUse.connected" : "computerUse.disconnected"
            )}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {data?.device?.name}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={action.isPending || !supported || !clientAvailable}
            onClick={() => action.mutate("download")}
          >
            <DownloadIcon aria-hidden="true" />
            {t("computerUse.download")}
          </Button>
          <Button
            type="button"
            disabled={action.isPending || !userId}
            onClick={() => action.mutate("pair")}
          >
            {t("computerUse.pair")}
          </Button>
          {data?.device && (
            <Button
              type="button"
              variant="outline"
              disabled={action.isPending}
              onClick={() => action.mutate("disconnect")}
            >
              {t("computerUse.disconnect")}
            </Button>
          )}
        </div>
        {!supported ? (
          <p className="text-xs text-muted-foreground">
            {t("computerUse.unavailable")}
          </p>
        ) : !clientAvailable ? (
          <p className="text-xs text-muted-foreground">
            {t("computerUse.localDev")}
          </p>
        ) : null}
        {pairing && !connected && (
          <div className="grid gap-2">
            <Label htmlFor="desktop-pairing-code">
              {t("computerUse.pairingCode")}
            </Label>
            <div className="flex min-w-0 gap-2">
              <Input
                id="desktop-pairing-code"
                readOnly
                value={pairing.code}
                className="min-w-0 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => action.mutate("copy")}
              >
                <CopyIcon aria-hidden="true" />
                {t(copied ? "computerUse.copied" : "computerUse.copy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("computerUse.pairingHint")}
            </p>
            <Button
              nativeButton={false}
              variant="outline"
              render={
                <a
                  href={`linksense-desktop://pair?${new URLSearchParams({ server: window.location.origin, code: pairing.code })}`}
                />
              }
            >
              {t("computerUse.openClient")}
            </Button>
          </div>
        )}
        {(action.error || status.error) && (
          <StatusBanner variant="error">
            {getErrorMessage(action.error ?? status.error, t)}
          </StatusBanner>
        )}
      </div>
    </SettingsCard>
  )
}
