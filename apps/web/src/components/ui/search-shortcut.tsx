export function SearchShortcut() {
  const modifier = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"
  return (
    <span
      aria-hidden="true"
      className="ml-auto flex shrink-0 gap-1 text-xs text-muted-foreground"
    >
      {[modifier, "K"].map((key) => (
        <kbd
          key={key}
          className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-card px-1 font-interface font-normal"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
