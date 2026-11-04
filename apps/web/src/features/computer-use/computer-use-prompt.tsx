import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"
import { MonitorIcon } from "lucide-react"
import { z } from "zod"
import { computerUseStatusSchema } from "@linksense/shared"
import type { ConversationMessage } from "@/api/contracts"
import { apiRequest } from "@/api/client"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover"
import { conversationSettingsReturnState } from "@/components/shell/settings-return-navigation"
import { computerUseStatusKey } from "./query-keys"

export function ComputerUsePrompt({
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
  const storageKey = `linksense.computer-use.prompt-dismissed:${userId}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === "explicit"
    } catch {
      return false
    }
  })
  const message = messages.findLast((item) => item.role === "user")
  const eligible =
    !dismissed &&
    Boolean(conversationId && message?.content.trim()) &&
    message?.delivery_status !== "sending" &&
    !message?.id.startsWith("optimistic-")
  const status = useQuery({
    queryKey: [...computerUseStatusKey(userId), "message", message?.id],
    queryFn: ({ signal }) =>
      apiRequest("/computer-use", { schema: computerUseStatusSchema, signal }),
    enabled: eligible,
    retry: false,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
  const intent = useQuery({
    queryKey: ["computer-use-intent", userId, conversationId, message?.id],
    queryFn: ({ signal }) =>
      apiRequest(`/conversations/${conversationId}/computer-use-intent`, {
        method: "POST",
        body: { message_id: message?.id },
        schema: z.boolean(),
        signal,
        priority: "low",
      }).catch(() => false),
    enabled: eligible && status.data?.connected === false && !status.isError,
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  if (!eligible || status.data?.connected !== false || intent.data !== true)
    return null
  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(storageKey, "explicit")
    } catch {
      /* Keep the mounted state. */
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-(--app-composer-width) justify-start">
      <Popover key={message?.id} defaultOpen modal={false}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
            />
          }
        >
          <MonitorIcon aria-hidden="true" />
          {t("computerUse.title")}
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          initialFocus={false}
          finalFocus={false}
          className="w-80 max-w-full gap-3"
        >
          <PopoverTitle>{t("computerUse.setupTitle")}</PopoverTitle>
          <PopoverDescription>
            {t("computerUse.setupDescription")}
          </PopoverDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
              {t("computerUse.dismiss")}
            </Button>
            <Button
              nativeButton={false}
              size="sm"
              render={
                <Link
                  to="/settings/general#computer-use"
                  state={conversationSettingsReturnState(location)}
                />
              }
              onClick={dismiss}
            >
              {t("computerUse.setup")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
