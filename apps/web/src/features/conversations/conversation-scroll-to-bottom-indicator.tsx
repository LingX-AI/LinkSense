import { useState } from "react"
import { ArrowDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationMessage } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { getConversationMessageRenderKey } from "@/features/conversations/streaming-messages"

export function ConversationScrollToBottomIndicator({
  running,
}: Readonly<{
  running: boolean
}>) {
  if (!running) return <ArrowDownIcon aria-hidden="true" />

  return (
    <span
      data-slot="conversation-running-indicator"
      className="flex items-center gap-1"
      aria-hidden="true"
    >
      <span
        data-slot="conversation-running-dot"
        className="conversation-running-dot size-1 rounded-full bg-muted-foreground/90"
      />
      <span
        data-slot="conversation-running-dot"
        className="conversation-running-dot size-1 rounded-full bg-muted-foreground/90"
      />
      <span
        data-slot="conversation-running-dot"
        className="conversation-running-dot size-1 rounded-full bg-muted-foreground/90"
      />
    </span>
  )
}

export function ConversationScrollToBottomButton({
  messages,
  running,
  onScrollToBottom,
}: Readonly<{
  messages: Pick<
    ConversationMessage,
    "id" | "role" | "item_id" | "client_render_key" | "sequence_no"
  >[]
  running: boolean
  onScrollToBottom: () => void
}>) {
  const { t } = useTranslation()
  const [baseline] = useState(() => ({
    sequence: messages.reduce(
      (latest, message) => Math.max(latest, message.sequence_no ?? 0),
      0
    ),
    replyKeys: new Set(
      messages
        .filter((message) => message.role === "assistant")
        .map(getConversationMessageRenderKey)
    ),
  }))
  const newReplyKeys = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const key = getConversationMessageRenderKey(message)
    // Initial replies and lazily loaded history are not new arrivals.
    if (
      !baseline.replyKeys.has(key) &&
      (message.sequence_no === undefined ||
        message.sequence_no > baseline.sequence)
    ) {
      newReplyKeys.add(key)
    }
  }
  const newReplyCount = newReplyKeys.size

  const label =
    newReplyCount > 0
      ? t("conversation.newReplies", { count: newReplyCount })
      : t("conversation.scrollToBottom")

  return (
    <Button
      type="button"
      variant="plain"
      size="icon-lg"
      className="conversation-scroll-to-bottom-button"
      data-count={newReplyCount > 0 ? newReplyCount : undefined}
      aria-label={label}
      title={label}
      onClick={onScrollToBottom}
    >
      <ConversationScrollToBottomIndicator
        running={running && newReplyCount === 0}
      />
      {newReplyCount > 0 && <span>{label}</span>}
    </Button>
  )
}
