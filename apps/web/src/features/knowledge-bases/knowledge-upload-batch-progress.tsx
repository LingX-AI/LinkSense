import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ListTreeIcon,
  UploadCloudIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

export type KnowledgeUploadBatchStatus = {
  totalCount: number
  completedCount: number
  issueCount: number
  progressPercent: number
  phase: "running" | "attention" | "completed"
}

export function KnowledgeUploadBatchProgress({
  status,
  onViewDetails,
}: {
  status: KnowledgeUploadBatchStatus
  onViewDetails: () => void
}) {
  const { t } = useTranslation()
  const Icon =
    status.phase === "completed"
      ? CheckCircle2Icon
      : status.phase === "attention"
        ? CircleAlertIcon
        : UploadCloudIcon
  const title = t(`knowledge.upload.batch.${status.phase}Title`)

  return (
    <Card
      size="sm"
      appearance="soft"
      role="status"
      aria-live="polite"
      data-slot="knowledge-upload-batch-progress"
    >
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </CardTitle>
        <CardDescription>
          {t("knowledge.upload.batch.summary", {
            completed: status.completedCount,
            total: status.totalCount,
          })}
          {status.issueCount > 0 && (
            <>
              {" · "}
              {t("knowledge.upload.batch.issues", {
                count: status.issueCount,
              })}
            </>
          )}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onViewDetails}
          >
            <ListTreeIcon data-icon="inline-start" aria-hidden="true" />
            {t("knowledge.upload.batch.viewDetails")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Progress inline value={status.progressPercent}>
          <ProgressLabel className="sr-only">{title}</ProgressLabel>
          <ProgressValue>{status.progressPercent}%</ProgressValue>
        </Progress>
      </CardContent>
    </Card>
  )
}
