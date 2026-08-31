import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { CardFooter } from "@/components/ui/card"

export function ConversationUserInputRequestFooter({
  disabled,
  complete,
  submitting,
  onCancel,
}: {
  disabled: boolean
  complete: boolean
  submitting: boolean
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <CardFooter className="shrink-0 justify-end gap-1.5 border-t pb-2 [.border-t]:pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onCancel}
      >
        {t("conversation.userInput.cancel")}
      </Button>
      <Button type="submit" size="sm" disabled={disabled || !complete}>
        {submitting && (
          <LoaderCircleIcon
            data-icon="inline-start"
            className="animate-spin"
            aria-hidden="true"
          />
        )}
        {t(
          submitting
            ? "conversation.userInput.submitting"
            : "conversation.userInput.submit"
        )}
      </Button>
    </CardFooter>
  )
}
