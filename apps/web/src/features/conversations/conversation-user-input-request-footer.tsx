import type { ReactNode } from "react"
import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { CardFooter } from "@/components/ui/card"

export function ConversationUserInputRequestFooter({
  disabled,
  cancelDisabled = disabled,
  complete,
  submitting,
  onCancel,
  hideCancel = false,
  cancelLabel,
  hint,
}: {
  disabled: boolean
  cancelDisabled?: boolean
  complete: boolean
  submitting: boolean
  onCancel: () => void
  hideCancel?: boolean
  cancelLabel?: string
  hint?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <CardFooter className="shrink-0 flex-wrap justify-end gap-x-4 gap-y-2 border-t pb-2 [.border-t]:pt-2">
      {hint && <div className="min-w-0 flex-1 basis-48">{hint}</div>}
      <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
        {!hideCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            {cancelLabel ?? t("conversation.userInput.cancel")}
          </Button>
        )}
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
      </div>
    </CardFooter>
  )
}
