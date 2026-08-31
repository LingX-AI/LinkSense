import { cn } from "@/lib/utils"

export function AssistantHtmlPreviewLoading({
  label,
  className,
}: Readonly<{
  label: string
  className?: string
}>) {
  return (
    <div
      className={cn(
        "assistant-html-preview-loading-surface relative min-h-80 w-full overflow-hidden rounded-2xl",
        className
      )}
      role="status"
      aria-label={label}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="assistant-html-preview-loading-canvas" aria-hidden="true">
        <span
          className="assistant-html-preview-loading-dots"
          aria-hidden="true"
        />
        <span
          className="assistant-html-preview-loading-glow"
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
