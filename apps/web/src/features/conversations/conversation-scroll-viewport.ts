export function getConversationScrollViewport(
  element: HTMLElement | null
): HTMLElement | null {
  return (
    element?.closest<HTMLElement>("[data-conversation-scroll-viewport]") ??
    element?.closest<HTMLElement>(".conversation-scroll") ??
    null
  )
}
