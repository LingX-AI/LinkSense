import type { ComponentProps } from "react"

import { Card, CardContent } from "@/components/ui/card"

export function SettingsCard({
  children,
  ...props
}: ComponentProps<"section">) {
  return (
    <section {...props} data-slot="settings-card">
      <Card className="py-4">
        <CardContent className="grid gap-4 px-4">{children}</CardContent>
      </Card>
    </section>
  )
}
