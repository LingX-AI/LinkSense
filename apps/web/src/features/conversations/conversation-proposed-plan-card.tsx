import { useId, type ReactNode } from "react"
import { LightbulbIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type ConversationProposedPlanCardProps = Readonly<{
  children: ReactNode
  streaming?: boolean
  className?: string
}>

export function ConversationProposedPlanCard({
  children,
  streaming = false,
  className,
}: ConversationProposedPlanCardProps) {
  const { t } = useTranslation()
  const titleId = useId()

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      aria-busy={streaming || undefined}
      data-testid="conversation-proposed-plan"
      data-streaming={streaming || undefined}
      className={cn("w-full", className)}
    >
      <CardHeader className="border-b pb-(--card-spacing)">
        <CardTitle
          id={titleId}
          role="heading"
          aria-level={3}
          className="flex items-center gap-2"
        >
          <LightbulbIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {t("conversation.proposedPlan.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  )
}
