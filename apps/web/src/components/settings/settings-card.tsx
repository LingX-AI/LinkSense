import type { ComponentProps, ReactNode } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function SettingsCard({
  children,
  header,
  className,
  layout = "stacked",
  icon,
  ...props
}: ComponentProps<"section"> & {
  header?: ReactNode
  layout?: "stacked" | "split"
  icon?: ReactNode
}) {
  return (
    <section
      {...props}
      className={cn(
        "grid min-w-0 gap-3",
        layout === "split" &&
          header &&
          "@min-[60rem]/shell-content:grid-cols-[14rem_minmax(0,1fr)] @min-[60rem]/shell-content:gap-8",
        className
      )}
      data-slot="settings-card"
    >
      {layout === "split" && header ? (
        <div className="grid min-w-0 content-start gap-3 [&_h2]:text-lg [&_h2]:leading-[var(--app-line-28)] [&_h2]:font-medium [&_h2]:text-heading">
          {icon && (
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-xl bg-accent text-primary [&_svg]:size-5"
            >
              {icon}
            </span>
          )}
          {header}
        </div>
      ) : (
        header
      )}
      <Card className="min-w-0 py-4 sm:py-5">
        <CardContent
          className={cn(
            "grid min-w-0 px-4 sm:px-5",
            layout === "split" ? "gap-0" : "gap-4"
          )}
        >
          {children}
        </CardContent>
      </Card>
    </section>
  )
}
