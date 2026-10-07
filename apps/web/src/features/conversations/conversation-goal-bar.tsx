import { useId, useState, type FormEvent, type ReactNode } from "react"
import {
  LoaderCircleIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ThreadGoal } from "@/api/contracts"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  formatGoalDuration,
  projectGoalElapsedSeconds,
} from "@/features/conversations/conversation-goal-utils"
import { useGoalClockNow } from "@/features/conversations/conversation-goal-clock"
import { normalizeLanguage } from "@/i18n"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"

type GoalAction = "edit" | "pause" | "resume" | "clear" | null

type ConversationGoalBarProps = Readonly<{
  goal: ThreadGoal
  synchronizing?: boolean
  pendingAction?: GoalAction
  onEdit: (input: { objective: string }) => void
  onPause: () => void
  onResume: () => void
  onClear: () => void
}>

export function ConversationGoalBar({
  goal,
  synchronizing = false,
  pendingAction = null,
  onEdit,
  onPause,
  onResume,
  onClear,
}: ConversationGoalBarProps) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const numberFormatter = new Intl.NumberFormat(language)
  const objectiveId = useId()
  const [editOpen, setEditOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [objective, setObjective] = useState(goal.objective)
  const nowMs = useGoalClockNow(goal.status === "active")
  const elapsedSeconds = projectGoalElapsedSeconds(goal, nowMs)
  const busy = pendingAction !== null
  const controlsDisabled = busy || synchronizing
  const canResume = [
    "paused",
    "blocked",
    "usageLimited",
    "budgetLimited",
  ].includes(goal.status)

  const openEdit = () => {
    setObjective(goal.objective)
    setEditOpen(true)
  }

  const normalizedObjective = objective.trim()
  const submitEdit = (event: FormEvent) => {
    event.preventDefault()
    if (!normalizedObjective || pendingAction === "edit") return
    onEdit({ objective: normalizedObjective })
    setEditOpen(false)
  }

  return (
    <>
      <section
        className="conversation-goal-bar"
        aria-label={t("conversation.goal.regionLabel")}
        data-status={goal.status}
      >
        <div className="conversation-goal-copy">
          <TargetIcon className="conversation-goal-icon" aria-hidden="true" />
          <span className="conversation-goal-status">
            {t(`conversation.goal.statusLabel.${goal.status}`)}
          </span>
          <span className="conversation-goal-objective" title={goal.objective}>
            {goal.objective}
          </span>
          {!synchronizing && (
            <Button
              type="button"
              variant="ghost"
              className="conversation-goal-elapsed"
              aria-label={t("conversation.goal.details")}
              disabled={busy}
              onClick={() => setDetailsOpen(true)}
            >
              {formatGoalDuration(elapsedSeconds)}
            </Button>
          )}
        </div>

        <div className="conversation-goal-actions">
          <GoalIconButton
            label={t("conversation.goal.edit")}
            disabled={controlsDisabled}
            pending={pendingAction === "edit"}
            onClick={openEdit}
          >
            <PencilIcon aria-hidden="true" />
          </GoalIconButton>

          {goal.status === "active" && (
            <GoalIconButton
              label={t("conversation.goal.pause")}
              disabled={controlsDisabled}
              pending={pendingAction === "pause"}
              onClick={onPause}
            >
              <PauseIcon aria-hidden="true" />
            </GoalIconButton>
          )}
          {canResume && (
            <GoalIconButton
              label={t("conversation.goal.resume")}
              disabled={controlsDisabled}
              pending={pendingAction === "resume"}
              onClick={onResume}
            >
              <PlayIcon aria-hidden="true" />
            </GoalIconButton>
          )}

          <GoalIconButton
            label={t("conversation.goal.clear")}
            disabled={controlsDisabled}
            pending={pendingAction === "clear"}
            onClick={() => setClearOpen(true)}
          >
            <Trash2Icon aria-hidden="true" />
          </GoalIconButton>
        </div>
      </section>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("conversation.goal.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("conversation.goal.editDescription")}
            </DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={submitEdit}>
            <Label
              required
              className="text-sm font-medium text-[var(--app-text)]"
              htmlFor={objectiveId}
            >
              {t("conversation.goal.objective")}
            </Label>
            <Textarea
              id={objectiveId}
              aria-required="true"
              value={objective}
              maxLength={4_000}
              autoFocus={shouldAutoFocusOnDesktop()}
              onChange={(event) => setObjective(event.target.value)}
            />
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={busy} />
                }
              >
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="submit"
                disabled={!normalizedObjective || busy}
                aria-busy={pendingAction === "edit" ? true : undefined}
              >
                {pendingAction === "edit" && (
                  <LoaderCircleIcon
                    className="animate-spin"
                    aria-hidden="true"
                  />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("conversation.goal.detailsTitle")}</DialogTitle>
            <DialogDescription>
              {t(`conversation.goal.statusDescription.${goal.status}`)}
            </DialogDescription>
          </DialogHeader>
          <dl className="conversation-goal-details">
            <GoalDetail
              label={t("conversation.goal.objective")}
              value={goal.objective}
            />
            <GoalDetail
              label={t("conversation.goal.elapsedLabel")}
              value={formatGoalDuration(elapsedSeconds)}
            />
            <GoalDetail
              label={t("conversation.goal.tokensUsed")}
              value={numberFormatter.format(goal.tokens_used)}
            />
            <GoalDetail
              label={t("conversation.goal.tokenBudget")}
              value={
                goal.token_budget === null
                  ? t("conversation.goal.noTokenBudget")
                  : numberFormatter.format(goal.token_budget)
              }
            />
          </dl>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t("common.close")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t("conversation.goal.clearTitle")}
        description={t("conversation.goal.clearDescription")}
        confirmLabel={t("conversation.goal.clear")}
        destructive
        pending={pendingAction === "clear"}
        onConfirm={onClear}
      />
    </>
  )
}

function GoalIconButton({
  label,
  disabled,
  pending,
  onClick,
  children,
}: Readonly<{
  label: string
  disabled?: boolean
  pending?: boolean
  onClick: () => void
  children: ReactNode
}>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="conversation-goal-action"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function GoalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
