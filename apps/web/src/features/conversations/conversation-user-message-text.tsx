import { GlobeIcon } from "lucide-react"

import { getConversationComposerInputSegments } from "@/features/conversations/conversation-composer-url-highlighting"

export function ConversationUserMessageText({ content }: { content: string }) {
  const segments = getConversationComposerInputSegments(content)

  return (
    <p className="whitespace-pre-wrap">
      {segments.map((segment) =>
        segment.kind === "url" ? (
          <span
            key={`${segment.start}-${segment.end}`}
            className="user-message-url"
            data-user-message-url={segment.value}
          >
            <GlobeIcon
              className="user-message-url-icon"
              aria-hidden="true"
            />
            {segment.value}
          </span>
        ) : (
          <span key={`${segment.start}-${segment.end}`}>{segment.value}</span>
        )
      )}
    </p>
  )
}
