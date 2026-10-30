import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full resize-none rounded-lg border border-border bg-field px-3 py-2 text-base transition-colors duration-200 outline-none placeholder:text-muted-foreground hover:not-disabled:not-focus:not-aria-invalid:border-input-hover focus-visible:border-ring focus-visible:bg-field-focus focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:aria-invalid:border-destructive/50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
