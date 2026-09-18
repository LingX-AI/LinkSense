import { useSyncExternalStore, type ComponentProps } from "react"
import { ConversationComposer } from "./conversation-composer"
import type { ConversationComposerValue } from "./conversation-composer-value"

type ConversationDraftComposerProps = Omit<
  ComponentProps<typeof ConversationComposer>,
  "value" | "onValueChange"
> &
  Readonly<{ draft: ConversationComposerValue }>

export function ConversationDraftComposer({
  draft,
  ...props
}: ConversationDraftComposerProps) {
  const value = useSyncExternalStore(
    draft.subscribe,
    draft.getSnapshot,
    draft.getSnapshot
  )
  return (
    <ConversationComposer
      {...props}
      value={value}
      onValueChange={draft.setValue}
    />
  )
}
