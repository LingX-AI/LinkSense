import { Children, Fragment, type ComponentProps } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export function ListCard({
  children,
  className,
  ...props
}: ComponentProps<typeof Card>) {
  const items = Children.toArray(children)
  if (items.length === 0) return null

  return (
    <Card className={cn("gap-0 py-0", className)} {...props}>
      <CardContent className="list-card-content px-4">
        {Children.map(items, (child, index) => (
          <Fragment>
            {index > 0 && <Separator />}
            {child}
          </Fragment>
        ))}
      </CardContent>
    </Card>
  )
}
