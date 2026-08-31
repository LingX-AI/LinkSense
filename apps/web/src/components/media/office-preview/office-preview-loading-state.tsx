import { cn } from "@/lib/utils"

export type OfficePreviewLoadingStateProps = Readonly<{
  label: string
  className?: string
}>

export function OfficePreviewLoadingState({
  label,
  className,
}: OfficePreviewLoadingStateProps) {
  return (
    <div
      className={cn("office-preview-state", className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="shimmer">{label}</span>
    </div>
  )
}
