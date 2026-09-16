import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ImagePreviewToolbar({
  children,
  label,
}: Readonly<{
  children: ReactNode
  label?: string
}>) {
  return (
    <div
      className="image-preview-zoom-controls"
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  )
}

export function ImagePreviewToolbarButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      {...props}
      className={cn("image-preview-zoom-button", className)}
    />
  )
}
