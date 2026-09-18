import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
} from "react"
import { Textarea } from "@/components/ui/textarea"

const MemoizedTextarea = memo(Textarea)
type InputProps = ComponentProps<typeof Textarea>

export function ConversationComposerInput({
  onChange,
  onKeyDown,
  onPaste,
  onScroll,
  ...props
}: InputProps) {
  const handlers = useRef({ onChange, onKeyDown, onPaste, onScroll })
  useLayoutEffect(() => {
    // Refresh guards after every commit without rerendering the editor for a
    // model setting change. Ignoring callback props in memo would retain stale guards.
    handlers.current = { onChange, onKeyDown, onPaste, onScroll }
  })
  const events = useMemo(
    () => ({
      onChange: (event: Parameters<NonNullable<InputProps["onChange"]>>[0]) =>
        handlers.current.onChange?.(event),
      onKeyDown: (event: Parameters<NonNullable<InputProps["onKeyDown"]>>[0]) =>
        handlers.current.onKeyDown?.(event),
      onPaste: (event: Parameters<NonNullable<InputProps["onPaste"]>>[0]) =>
        handlers.current.onPaste?.(event),
      onScroll: (event: Parameters<NonNullable<InputProps["onScroll"]>>[0]) =>
        handlers.current.onScroll?.(event),
    }),
    []
  )
  return <MemoizedTextarea {...props} {...events} />
}
