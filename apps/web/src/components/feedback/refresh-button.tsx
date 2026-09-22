import { RefreshCwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface RefreshButtonProps {
  refreshing: boolean
  onRefresh: () => void
}

export function RefreshButton({ refreshing, onRefresh }: RefreshButtonProps) {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("common.refresh")}
      title={t("common.refresh")}
      aria-busy={refreshing || undefined}
      disabled={refreshing}
      onClick={onRefresh}
    >
      <RefreshCwIcon
        aria-hidden="true"
        className={cn(refreshing && "animate-spin")}
      />
    </Button>
  )
}
