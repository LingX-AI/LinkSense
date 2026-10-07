import { useId, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  LoaderCircleIcon,
  PencilIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"

export type ConversationPlanDecisionBusyAction =
  "implement" | "revise" | "dismiss" | "exit"

export type ConversationPlanDecisionCardProps = Readonly<{
  reviewId: string
  busyAction?: ConversationPlanDecisionBusyAction | null
  className?: string
  onImplement: (reviewId: string) => void
  onRevisionSubmit: (reviewId: string, feedback: string) => void
  onDismiss: (reviewId: string) => void
  onExit: (reviewId: string) => void
}>

type RevisionState = Readonly<{
  reviewId: string
  open: boolean
  feedback: string
}>

export function ConversationPlanDecisionCard({
  reviewId,
  busyAction = null,
  className,
  onImplement,
  onRevisionSubmit,
  onDismiss,
  onExit,
}: ConversationPlanDecisionCardProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const implementDescriptionId = useId()
  const revisionInputId = useId()
  const [revisionState, setRevisionState] = useState<RevisionState>({
    reviewId,
    open: false,
    feedback: "",
  })
  const currentRevision =
    revisionState.reviewId === reviewId
      ? revisionState
      : { reviewId, open: false, feedback: "" }
  const revisionFeedback = currentRevision.feedback
  const revisionReady = revisionFeedback.trim().length > 0
  const busy = busyAction !== null

  const openRevision = () => {
    if (busy) return
    setRevisionState((current) => ({
      reviewId,
      open: true,
      feedback: current.reviewId === reviewId ? current.feedback : "",
    }))
  }

  const closeRevision = () => {
    if (busy) return
    setRevisionState((current) => ({
      reviewId,
      open: false,
      feedback: current.reviewId === reviewId ? current.feedback : "",
    }))
  }

  const submitRevision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !revisionReady) return
    onRevisionSubmit(reviewId, revisionFeedback.trim())
  }

  const submitRevisionFromKeyboard = (
    event: KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (
      event.key !== "Enter" ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    ) {
      return
    }
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <Card
      role="region"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy || undefined}
      data-testid="conversation-plan-decision"
      data-review-id={reviewId}
      size="sm"
      className={cn("mr-auto w-full gap-3 py-4", className)}
    >
      <CardHeader>
        <CardTitle id={titleId} role="heading" aria-level={3}>
          {t("conversation.planDecision.title")}
        </CardTitle>
        <span id={descriptionId} className="sr-only">
          {t("conversation.planDecision.description")}
        </span>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            disabled={busy}
            aria-label={t(
              busyAction === "exit"
                ? "conversation.planDecision.exiting"
                : "conversation.planDecision.exit"
            )}
            title={t("conversation.planDecision.exitDescription")}
            onClick={() => onExit(reviewId)}
          >
            {busyAction === "exit" ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
            ) : (
              <XIcon aria-hidden="true" />
            )}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className={currentRevision.open ? undefined : "px-2"}>
        {currentRevision.open ? (
          <form
            className="flex flex-col gap-4"
            aria-label={t("conversation.planDecision.revisionForm")}
            onSubmit={submitRevision}
          >
            <FieldGroup className="gap-3">
              <Field data-disabled={busy || undefined}>
                <FieldLabel htmlFor={revisionInputId} required>
                  {t("conversation.planDecision.revisionLabel")}
                </FieldLabel>
                <FieldDescription>
                  {t("conversation.planDecision.revisionDescription")}
                </FieldDescription>
                <Textarea
                  id={revisionInputId}
                  aria-required="true"
                  autoFocus={shouldAutoFocusOnDesktop()}
                  value={revisionFeedback}
                  disabled={busy}
                  maxLength={20_000}
                  placeholder={t(
                    "conversation.planDecision.revisionPlaceholder"
                  )}
                  onChange={(event) =>
                    setRevisionState({
                      reviewId,
                      open: true,
                      feedback: event.target.value,
                    })
                  }
                  onKeyDown={submitRevisionFromKeyboard}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={closeRevision}
              >
                <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
                {t("conversation.planDecision.back")}
              </Button>
              <Button
                type="submit"
                disabled={busy || !revisionReady}
                aria-busy={busyAction === "revise" ? true : undefined}
              >
                {busyAction === "revise" && (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
                )}
                {t(
                  busyAction === "revise"
                    ? "conversation.planDecision.submittingRevision"
                    : "conversation.planDecision.submitRevision"
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-10 w-full justify-between rounded-full bg-accent px-3 text-left hover:bg-accent"
              disabled={busy}
              aria-describedby={implementDescriptionId}
              aria-label={t(
                busyAction === "implement"
                  ? "conversation.planDecision.implementing"
                  : "conversation.planDecision.implement"
              )}
              onClick={() => onImplement(reviewId)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Badge
                  aria-hidden="true"
                  variant="outline"
                  className="size-7 rounded-full border-[color:var(--app-border)] bg-muted p-0 font-normal text-muted-foreground"
                >
                  1
                </Badge>
                <span className="truncate">
                  {t(
                    busyAction === "implement"
                      ? "conversation.planDecision.implementing"
                      : "conversation.planDecision.implement"
                  )}
                </span>
                <span id={implementDescriptionId} className="sr-only">
                  {t("conversation.planDecision.implementDescription")}
                </span>
              </span>
              {busyAction === "implement" ? (
                <LoaderCircleIcon
                  data-icon="inline-end"
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRightIcon
                  data-icon="inline-end"
                  className="text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </Button>
            <div
              data-testid="conversation-plan-decision-secondary-row"
              className="flex min-w-0 items-center gap-2 rounded-full pr-2 pl-3 transition-colors focus-within:bg-hover hover:bg-hover"
            >
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-8 min-w-0 flex-1 justify-start rounded-full px-0 text-left font-normal whitespace-normal text-muted-foreground/80 hover:bg-transparent"
                disabled={busy}
                aria-label={t("conversation.planDecision.revise")}
                onClick={openRevision}
              >
                <Badge
                  aria-hidden="true"
                  variant="outline"
                  className="size-7 rounded-full border-[color:var(--app-border)] bg-card p-0 text-muted-foreground"
                >
                  <PencilIcon aria-hidden="true" />
                </Badge>
                <span className="min-w-0">
                  {t("conversation.planDecision.reviseInline")}
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full border-[color:var(--app-border)] bg-card px-3 hover:bg-card"
                disabled={busy}
                title={t("conversation.planDecision.dismissDescription")}
                onClick={() => onDismiss(reviewId)}
              >
                {busyAction === "dismiss" && (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
                )}
                {t(
                  busyAction === "dismiss"
                    ? "conversation.planDecision.dismissing"
                    : "conversation.planDecision.dismiss"
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
