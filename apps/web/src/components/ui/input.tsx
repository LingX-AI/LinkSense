import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  variant = "outlined",
  ...props
}: React.ComponentProps<"input"> & {
  variant?: "default" | "outlined"
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-transparent bg-field px-2.5 py-1 text-base transition-colors duration-200 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:bg-field-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:aria-invalid:border-destructive/50",
        variant === "outlined" &&
          "h-10 border-border px-3 hover:not-focus:not-disabled:not-aria-invalid:border-input-hover focus:ring-1 focus:ring-ring focus:not-aria-invalid:border-ring aria-invalid:ring-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
