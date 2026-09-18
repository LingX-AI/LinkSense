import type { SetStateAction } from "react"

export type ConversationComposerValue = Readonly<{
  getSnapshot: () => string
  setValue: (update: SetStateAction<string>) => void
  subscribe: (listener: () => void) => () => void
}>

/** One page-local input value. Only the composer subscribes for rendering. */
export function createConversationComposerValue(): ConversationComposerValue {
  let value = ""
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    setValue: (update) => {
      const next = typeof update === "function" ? update(value) : update
      if (next === value) return
      value = next
      for (const notify of listeners) notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
