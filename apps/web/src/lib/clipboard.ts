export async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  // shortcut: HTTP uses legacy copy; use manual selection if browsers remove it.
  if (typeof document.execCommand !== "function") {
    throw new Error("clipboard_unavailable")
  }

  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.readOnly = true
  textarea.tabIndex = -1
  textarea.className = "clipboard-copy-fallback"
  textarea.setAttribute("aria-hidden", "true")
  document.body.append(textarea)
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    if (!document.execCommand("copy")) throw new Error("clipboard_unavailable")
  } finally {
    textarea.remove()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
}
