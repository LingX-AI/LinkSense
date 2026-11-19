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
  browserUsePairingSchema,
  browserUseStatusSchema,
} from "@linksense/shared"
import { apiRequest, downloadApiFile } from "@/api/client"
import {
  getDesktopPlatform,
  getPublicAppOrigin,
  openDesktopExternal,
} from "@/adapters/desktop/desktop-adapter"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { browserExtensionRequest } from "./bridge"
import { browserUseBrowser } from "./browser-support"
import { Badge } from "@/components/ui/badge"
import { browserExtensionSettingsPath } from "./settings-path"

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
  const desktopMac = getDesktopPlatform() === "darwin"
  const browser = desktopMac ? null : browserUseBrowser()
  const supportedBrowser = browser !== null
  const extensionAddress =
    browser === "edge" ? "edge://extensions" : "chrome://extensions"
  const [detected, setDetected] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const queryKey = ["browser-use", userId] as const
  const { data, fetchStatus, isError, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiRequest("/browser-use", { schema: browserUseStatusSchema, signal }),
    enabled: Boolean(userId) && (desktopMac || supportedBrowser),
    ...(desktopMac && { refetchOnWindowFocus: "always" }),
    refetchInterval: 5000,
  })
  useEffect(() => {
    if (!desktopMac || !userId) return
    // Switching apps can refocus the WebView without changing its visibility.
    const refresh = () => void refetch({ cancelRefetch: false })
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [desktopMac, userId, refetch])
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
  const setup = useMutation({
    networkMode: "always",
    mutationFn: () =>
      openDesktopExternal(
        new URL(browserExtensionSettingsPath, getPublicAppOrigin()).href
      ),
  })
  const action = useMutation({
    // A revoke is for this signed-in account now, not the next session online.
    ...(desktopMac && { networkMode: "always" }),
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
            t("browserUse.extensionAddressCopied", {
              address: extensionAddress,
            })
          )
      } else if (operation === "disconnect") {
        const disconnected = await apiRequest("/browser-use", {
          method: "DELETE",
          schema: browserUseStatusSchema,
        })
        if (desktopMac) {
          await queryClient.cancelQueries({ queryKey, exact: true })
          queryClient.setQueryData(queryKey, disconnected)
          notify.success(t("browserUse.desktopRevoked"))
        }
      } else if (operation === "connect") {
        const pairing = await apiRequest("/browser-use/pairing", {
          method: "POST",
          body: {},
          schema: browserUsePairingSchema,
        })
        const result = await browserExtensionRequest(
          "pair",
          pairing,
          userId ? { owner_id: userId } : undefined
        )
        if (!result.ok) throw new Error("extension not available")
        setPending(true)
      } else {
        const blob = await downloadApiFile("/browser-use/extension")
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "linksense-browser-extension.zip"
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  })
  const copyAddress = async (address: string, message = t("common.copied")) => {
    try {
      await navigator.clipboard.writeText(address)
      notify.success(message)
    } catch {
      notify.error(t("browserUse.addressCopyFailed"))
    }
  }
  const connectionLabel = !data?.connected
    ? t("browserUse.disconnected")
    : data.browser || !desktopMac
      ? t("browserUse.connected", {
          browser: data.browser === "edge" ? "Edge" : "Chrome",
        })
      : t("browserUse.desktopConnected")
  const desktopStatusUnavailable =
    desktopMac && (isError || fetchStatus === "paused")
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
          title={t("browserUse.title")}
          description={t(
            desktopMac ? "browserUse.setupOptional" : "browserUse.description"
          )}
        />
      }
    >
      <div className="grid min-w-0 gap-4">
        <Badge variant="secondary" className="w-fit whitespace-normal">
          {t("browserUse.supportedBrowsers")}
        </Badge>
        {!supportedBrowser && !desktopMac && (
          <StatusBanner title={t("browserUse.unsupportedTitle")}>
            <p>{t("browserUse.unsupportedDescription")}</p>
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
                {t("browserUse.getChrome")}
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
                {t("browserUse.getEdge")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyAddress(location.href)}
              >
                <CopyIcon aria-hidden="true" />
                {t("browserUse.copyAppAddress")}
              </Button>
            </div>
          </StatusBanner>
        )}
        {(supportedBrowser || (desktopMac && userId)) && (
          <p className="text-sm font-medium">
            <span role="status" aria-atomic="true">
              {desktopStatusUnavailable
                ? t("browserUse.desktopStatusFailed")
                : desktopMac && !data
                  ? ""
                  : connectionLabel}
            </span>
            {desktopMac &&
              !data &&
              !desktopStatusUnavailable &&
              t("common.loading")}
          </p>
        )}
        {desktopMac && (
          <p
            id="browser-extension-desktop-help"
            className="text-sm text-muted-foreground"
          >
            {t("browserUse.desktopSetupDescription")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("browserUse.examples")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("browserUse.privacy")}
        </p>
        {supportedBrowser && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t("browserUse.install")}</h3>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <Trans
                i18nKey="browserUse.steps"
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
                      aria-label={t("browserUse.openAddress", {
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
                ? "browserUse.detecting"
                : detected
                  ? "browserUse.ready"
                  : "browserUse.notDetected"
            )}
          </p>
        )}
        {pending && !data?.connected && (
          <StatusBanner>{t("browserUse.pending")}</StatusBanner>
        )}
        {(action.isError || setup.isError || (!desktopMac && isError)) && (
          <StatusBanner variant="error">{t("browserUse.failed")}</StatusBanner>
        )}
        <div className="flex flex-wrap gap-2">
          {desktopMac ? (
            <Button
              className="h-auto min-h-9 max-w-full whitespace-normal"
              aria-describedby="browser-extension-desktop-help"
              disabled={setup.isPending}
              focusableWhenDisabled
              onClick={() => setup.mutate()}
            >
              <ExternalLinkIcon aria-hidden="true" />
              {t("browserUse.desktopSetup")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={action.isPending || !supportedBrowser}
                onClick={() => action.mutate("download")}
              >
                <DownloadIcon aria-hidden="true" />
                {t("browserUse.download")}
              </Button>
              <Button
                disabled={!supportedBrowser || !detected || action.isPending}
                onClick={() => action.mutate("connect")}
              >
                {t("browserUse.connect")}
              </Button>
            </>
          )}
          {(desktopMac ? Boolean(userId) : data?.connected) && (
            <Button
              variant="outline"
              disabled={
                action.isPending || (desktopMac && fetchStatus === "paused")
              }
              focusableWhenDisabled={desktopMac}
              onClick={() => action.mutate("disconnect")}
            >
              {t(
                desktopMac
                  ? "browserUse.desktopRevoke"
                  : "browserUse.disconnect"
              )}
            </Button>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
