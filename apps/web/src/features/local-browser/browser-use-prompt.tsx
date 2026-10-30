import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpRightIcon, PuzzleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"
import { browserUseIntentSchema } from "@linksense/shared"

import type { ConversationMessage } from "@/api/contracts"
import { apiRequest } from "@/api/client"
import { conversationSettingsReturnState } from "@/components/shell/settings-return-navigation"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  browserExtensionConnectionKey,
  useBrowserExtensionState,
} from "./extension-state"
import { browserExtensionRequest } from "./bridge"
import { browserUseBrowser } from "./browser-support"

export function BrowserUsePrompt({
  userId,
  conversationId,
  messages,
}: {
  userId: string
  conversationId?: string
  messages: readonly Pick<
    ConversationMessage,
    "id" | "role" | "content" | "delivery_status"
  >[]
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [supportedBrowser] = useState(() => browserUseBrowser() !== null)
  const storageKey = `linksense.browser-use.prompt-dismissed:${userId}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      // Legacy flags also included accidental outside clicks.
      return sessionStorage.getItem(storageKey) === "explicit"
    } catch {
      return false
    }
  })
  const latestRequest = messages.findLast((message) => message.role === "user")
  const extension = useBrowserExtensionState(userId)
  const needsSetup =
    supportedBrowser &&
    Boolean(extension.data) &&
    !extension.isError &&
    extension.data?.pairing_mode !== "connected"
  const intent = useQuery({
    queryKey: ["browser-use-intent", userId, conversationId, latestRequest?.id],
    queryFn: async ({ signal }) => {
      if (!conversationId || !latestRequest) return false
      const current = await browserExtensionRequest("detect", undefined, {
        owner_id: userId,
      })
      if (signal.aborted) return false
      queryClient.setQueryData(browserExtensionConnectionKey(userId), current)
      if (current.pairing_mode === "connected") return false
      return apiRequest(`/conversations/${conversationId}/browser-use-intent`, {
        method: "POST",
        body: { message_id: latestRequest.id },
        schema: browserUseIntentSchema,
        signal,
        priority: "low",
      }).catch(() => false)
    },
    enabled:
      needsSetup &&
      !dismissed &&
      Boolean(conversationId && latestRequest?.content.trim()) &&
      latestRequest?.delivery_status !== "sending" &&
      !latestRequest?.id.startsWith("optimistic-"),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  if (dismissed || !needsSetup || intent.data !== true) return null

  const detected = extension.data?.detected === true
  function dismiss(): void {
    setDismissed(true)
    try {
      sessionStorage.setItem(storageKey, "explicit")
    } catch {
      // Keep dismissal effective for this chat when session storage is unavailable.
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-(--app-composer-width) justify-start">
      <Popover key={latestRequest?.id} defaultOpen modal={false}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="rounded-full" />
          }
        >
          <PuzzleIcon aria-hidden="true" />
          {t("localBrowser.previewTitle")}
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          initialFocus={false}
          finalFocus={false}
          className="w-80 max-w-[calc(100vw-2rem)] gap-3 motion-reduce:animate-none"
        >
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-xl bg-accent text-primary"
          >
            <PuzzleIcon className="size-5" />
          </span>
          <PopoverTitle>{t("localBrowser.setupTitle")}</PopoverTitle>
          <PopoverDescription className="text-sm leading-relaxed">
            {t(
              detected
                ? "localBrowser.setupDisconnected"
                : "localBrowser.setupMissing"
            )}
          </PopoverDescription>
          <p className="text-xs text-muted-foreground">
            {t("localBrowser.supportedBrowsers")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("localBrowser.setupOptional")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={dismiss}>
              {t("localBrowser.setupDismiss")}
            </Button>
            <Button
              nativeButton={false}
              role="link"
              size="sm"
              render={
                <Link
                  to="/settings/general#browser-extension"
                  state={conversationSettingsReturnState(location)}
                />
              }
              onClick={dismiss}
            >
              {t(
                detected
                  ? "localBrowser.setupConnect"
                  : "localBrowser.setupInstall"
              )}
              <ArrowUpRightIcon aria-hidden="true" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
