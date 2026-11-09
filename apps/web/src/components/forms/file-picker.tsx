import { useId, type ComponentProps, type ReactNode } from "react"
import { FileIcon } from "lucide-react"

import { Input } from "@/components/ui/input"

export function FilePicker({
  prompt,
  description,
  "aria-describedby": describedBy,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "className"> & {
  prompt: string
  description?: ReactNode
}) {
  const descriptionId = useId()
  return (
    <div className="relative flex min-h-32 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-muted/30 p-4 text-center transition-colors has-focus-visible:border-ring has-focus-visible:ring-1 has-focus-visible:ring-ring has-disabled:opacity-50 has-aria-invalid:border-destructive">
      <div
        aria-hidden="true"
        className="pointer-events-none flex max-w-full min-w-0 flex-col items-center gap-2"
      >
        <FileIcon className="size-4 shrink-0" />
        <span className="max-w-full text-sm break-all">{prompt}</span>
      </div>
      {description && (
        <span id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </span>
      )}
      <Input
        {...props}
        type="file"
        aria-describedby={
          [describedBy, description && descriptionId]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className="absolute inset-0 h-full cursor-pointer opacity-0"
      />
    </div>
  )
}
