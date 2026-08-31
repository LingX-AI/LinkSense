import { LoaderCircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function AssistantInlineImagePlaceholder({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      className={cn("assistant-inline-image-placeholder", className)}
      role="status"
      aria-label={label}
      data-slot="assistant-inline-image-placeholder"
    >
      <LoaderCircleIcon
        className="size-5 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    </span>
  )
}
