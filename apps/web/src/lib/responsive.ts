export const desktopViewportQuery = "(min-width: 768px)"

export function shouldAutoFocusOnDesktop() {
  if (typeof window === "undefined") return false
  if (typeof window.matchMedia !== "function") return true
  return window.matchMedia(desktopViewportQuery).matches
}
