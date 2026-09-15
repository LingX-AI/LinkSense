import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import type { ComponentProps } from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("flex w-full flex-wrap gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupOption({
  className,
  ...props
}: ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="radio-group-option"
      className={cn(
        "w-auto max-w-full cursor-pointer gap-2 rounded-xl border border-[var(--app-border)] px-3 py-2.5 transition-colors has-[:focus-visible]:border-ring has-[[aria-checked=true]]:bg-field has-[[aria-disabled=true]]:cursor-not-allowed has-[[aria-disabled=true]]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-2xl border border-transparent bg-input/90 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground dark:size-2.5" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupOption }
