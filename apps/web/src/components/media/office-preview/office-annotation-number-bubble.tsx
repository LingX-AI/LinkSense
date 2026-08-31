import { MessageCircleIcon } from "lucide-react"
import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

export function OfficeAnnotationNumberBubble({
  index,
  className,
  ...props
}: Readonly<
  { index: number } & Omit<ComponentPropsWithoutRef<"span">, "children">
>) {
  return (
    <span
      {...props}
      className={cn("office-annotation-number-bubble", className)}
      aria-hidden="true"
    >
      <MessageCircleIcon
        className="office-annotation-number-bubble-shape"
        aria-hidden="true"
      />
      <span className="office-annotation-number-bubble-label">{index}</span>
    </span>
  )
}
