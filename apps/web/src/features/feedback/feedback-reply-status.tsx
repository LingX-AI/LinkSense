import { CheckIcon, ClockIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"

export function FeedbackReplyStatus({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <Badge variant="secondary">
      {count > 0 ? (
        <CheckIcon data-icon="inline-start" />
      ) : (
        <ClockIcon data-icon="inline-start" />
      )}
      {t(count > 0 ? "myFeedback.replied" : "myFeedback.awaitingReply")}
    </Badge>
  )
}
