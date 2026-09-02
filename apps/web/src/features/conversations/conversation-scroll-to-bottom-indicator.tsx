import { ArrowDownIcon } from "lucide-react"

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
