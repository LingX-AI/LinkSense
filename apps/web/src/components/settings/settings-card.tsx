import type { ComponentProps, ReactNode } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function SettingsCard({
  children,
  header,
  className,
  ...props
}: ComponentProps<"section"> & { header?: ReactNode }) {
  return (
    <section
      {...props}
      className={cn("grid min-w-0 gap-3", className)}
      data-slot="settings-card"
    >
      {header}
      <Card className="min-w-0 py-4 sm:py-5">
        <CardContent className="grid min-w-0 gap-4 px-4 sm:px-5">
          {children}
        </CardContent>
      </Card>
    </section>
  )
}
