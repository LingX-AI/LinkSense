import { useEffect, useState } from "react"
import type { ComponentProps } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trans, useTranslation } from "react-i18next"
import {
  GlobeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  CopyIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react"
import {
  localBrowserPairingSchema,
  localBrowserStatusSchema,
} from "@linksense/shared"
import { apiRequest, downloadApiFile } from "@/api/client"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { browserExtensionRequest } from "./bridge"
import { browserUseBrowser } from "./browser-support"
import { Badge } from "@/components/ui/badge"

const instructionActionClassName =
  "inline-flex h-auto gap-1 p-0 align-baseline font-semibold whitespace-normal underline select-text"

function InstructionAction({
  icon: Icon,
  children,
  ...props
}: ComponentProps<typeof Button> & { icon: LucideIcon }) {
  return (
    <Button variant="link" className={instructionActionClassName} {...props}>
      <Icon aria-hidden="true" className="size-3 self-center" />
      {children}
    </Button>
  )
}

export function BrowserExtensionSettings({ userId }: { userId?: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const browser = browserUseBrowser()
  const supportedBrowser = browser !== null
  const extensionAddress =
    browser === "edge" ? "edge://extensions" : "chrome://extensions"
  const [detected, setDetected] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const secureConnection =
    location.protocol === "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  const queryKey = ["local-browser", userId] as const
  const status = useQuery({
    queryKey,
    queryFn: () =>
      apiRequest("/local-browser", { schema: localBrowserStatusSchema }),
    enabled: Boolean(userId) && supportedBrowser,
    refetchInterval: 5000,
  })
  useEffect(() => {
    if (!supportedBrowser) return
    let active = true
    void browserExtensionRequest("detect").then((result) => {
      if (active) setDetected(result.detected === true)
    })
    return () => {
      active = false
    }
  }, [supportedBrowser])
  const action = useMutation({
    mutationFn: async (
      operation: "connect" | "disconnect" | "download" | "extensions"
    ) => {
      setPending(false)
      if (operation === "extensions") {
        const result = userId
          ? await browserExtensionRequest("open_extensions", undefined, {
              owner_id: userId,
            })
          : undefined
        if (!result?.ok)
          await copyAddress(
            extensionAddress,
            t("localBrowser.extensionAddressCopied", {
              address: extensionAddress,
            })
          )
      } else if (operation === "disconnect") {
        await apiRequest("/local-browser", {
          method: "DELETE",
          schema: localBrowserStatusSchema,
        })
      } else if (operation === "connect") {
        const pairing = await apiRequest("/local-browser/pairing", {
          method: "POST",
          body: {},
          schema: localBrowserPairingSchema,
        })
        const result = await browserExtensionRequest(
          "pair",
          pairing,
          userId ? { owner_id: userId } : undefined
        )
        if (!result.ok) throw new Error("extension not available")
        setPending(true)
      } else {
        const blob = await downloadApiFile("/local-browser/extension")
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "linksense-browser-extension.zip"
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })
  const copyAddress = async (address: string, message = t("common.copied")) => {
    try {
      await navigator.clipboard.writeText(address)
      notify.success(message)
    } catch {
      notify.error(t("localBrowser.addressCopyFailed"))
    }
  }
  return (
    <SettingsCard
      id="browser-extension"
      tabIndex={-1}
      aria-labelledby="browser-extension-heading"
      className="scroll-mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      layout="split"
      icon={<GlobeIcon />}
      header={
        <SettingsSectionHeader
          id="browser-extension-heading"
          title={t("localBrowser.title")}
          description={t("localBrowser.description")}
        />
      }
    >
      <div className="grid min-w-0 gap-4">
        <Badge variant="secondary" className="w-fit whitespace-normal">
          {t("localBrowser.supportedBrowsers")}
        </Badge>
        {!supportedBrowser && (
          <StatusBanner title={t("localBrowser.unsupportedTitle")}>
            <p>{t("localBrowser.unsupportedDescription")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                nativeButton={false}
                role="link"
                variant="outline"
                size="sm"
                render={
                  <a
                    href="https://www.google.com/chrome/"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ExternalLinkIcon aria-hidden="true" />
                {t("localBrowser.getChrome")}
              </Button>
              <Button
                nativeButton={false}
                role="link"
                variant="outline"
                size="sm"
                render={
                  <a
                    href="https://www.microsoft.com/edge/download"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ExternalLinkIcon aria-hidden="true" />
                {t("localBrowser.getEdge")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyAddress(location.href)}
              >
                <CopyIcon aria-hidden="true" />
                {t("localBrowser.copyAppAddress")}
              </Button>
            </div>
          </StatusBanner>
        )}
        {supportedBrowser && (
          <p role="status" aria-live="polite" className="text-sm font-medium">
            {status.data?.connected
              ? t("localBrowser.connected", {
                  browser: status.data.browser === "edge" ? "Edge" : "Chrome",
                })
              : t("localBrowser.disconnected")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("localBrowser.examples")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("localBrowser.privacy")}
        </p>
        {!secureConnection && (
          <StatusBanner>{t("localBrowser.secureConnection")}</StatusBanner>
        )}
        {supportedBrowser && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              {t("localBrowser.install")}
            </h3>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <Trans
                i18nKey="localBrowser.steps"
                values={{ address: extensionAddress }}
                components={{
                  step: <li />,
                  strong: <strong className="font-semibold text-foreground" />,
                  hint: <span className="mt-1 block text-xs" />,
                  download: (
                    <InstructionAction
                      icon={DownloadIcon}
                      disabled={action.isPending}
                      onClick={() => action.mutate("download")}
                    />
                  ),
                  extensions: (
                    <InstructionAction
                      icon={ExternalLinkIcon}
                      aria-label={t("localBrowser.openAddress", {
                        address: extensionAddress,
                      })}
                      disabled={action.isPending}
                      onClick={() => action.mutate("extensions")}
                    />
                  ),
                  reload: (
                    <InstructionAction
                      icon={RefreshCwIcon}
                      onClick={() => location.reload()}
                    />
                  ),
                }}
              />
            </ol>
          </div>
        )}
        {supportedBrowser && (
          <p className="text-sm text-muted-foreground">
            {t(
              detected === null
                ? "localBrowser.detecting"
                : detected
                  ? "localBrowser.ready"
                  : "localBrowser.notDetected"
            )}
          </p>
        )}
        {pending && !status.data?.connected && (
          <StatusBanner>{t("localBrowser.pending")}</StatusBanner>
        )}
        {(action.isError || status.isError) && (
          <StatusBanner variant="error">
            {t("localBrowser.failed")}
          </StatusBanner>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={action.isPending || !supportedBrowser}
            onClick={() => action.mutate("download")}
          >
            <DownloadIcon aria-hidden="true" />
            {t("localBrowser.download")}
          </Button>
          <Button
            disabled={
              !supportedBrowser ||
              !detected ||
              !secureConnection ||
              action.isPending
            }
            onClick={() => action.mutate("connect")}
          >
            {t("localBrowser.connect")}
          </Button>
          {status.data?.connected && (
            <Button
              variant="outline"
              disabled={action.isPending}
              onClick={() => action.mutate("disconnect")}
            >
              {t("localBrowser.disconnect")}
            </Button>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
