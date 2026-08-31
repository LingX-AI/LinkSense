import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

function Progress({
  className,
  children,
  inline = false,
  value,
  ...props
}: Omit<ProgressPrimitive.Root.Props, "children"> & {
  children?: ReactNode
  inline?: boolean
}) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn(
        inline ? "flex min-w-0 items-center gap-3" : "flex flex-wrap gap-3",
        className
      )}
      {...props}
    >
      {inline && (
        <ProgressTrack className="w-auto min-w-0 flex-1">
          <ProgressIndicator />
        </ProgressTrack>
      )}
      {children}
      {!inline && (
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      )}
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-2xl bg-muted",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full bg-primary transition-all data-[indeterminate]:w-1/3 data-[indeterminate]:animate-pulse motion-reduce:data-[indeterminate]:animate-none",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({
  className,
  children,
  ...props
}: Omit<ProgressPrimitive.Value.Props, "children"> & {
  children?: ReactNode
}) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto text-sm text-muted-foreground tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    >
      {children === undefined ? undefined : () => children}
    </ProgressPrimitive.Value>
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
