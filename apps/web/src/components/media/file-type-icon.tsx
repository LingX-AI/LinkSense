import type { ComponentPropsWithoutRef } from "react"

import { resolveFileIconAsset, resolveFileIconKind } from "@/lib/file-icons"
import { cn } from "@/lib/utils"

type FileTypeIconProps = Omit<
  ComponentPropsWithoutRef<"img">,
  "alt" | "src"
> & {
  filename: string
  mimeType?: string | null
}

export function FileTypeIcon({
  filename,
  mimeType,
  className,
  ...props
}: FileTypeIconProps) {
  const kind = resolveFileIconKind(filename, mimeType)

  return (
    <img
      {...props}
      alt=""
      aria-hidden="true"
      className={cn("file-type-icon", className)}
      data-file-icon-kind={kind}
      decoding="async"
      draggable={false}
      height={128}
      src={resolveFileIconAsset(filename, mimeType)}
      width={128}
    />
  )
}
