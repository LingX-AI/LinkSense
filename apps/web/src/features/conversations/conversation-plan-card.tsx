import { useId, useState } from "react"
import {
  CheckCircle2Icon,
  CircleIcon,
  FilesIcon,
  ListChecksIcon,
  LoaderCircleIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

export type ConversationPlanStepStatus = "pending" | "inProgress" | "completed"

export type ConversationPlanStep = {
  step: string
  status: ConversationPlanStepStatus
}

export type ConversationPlanCardProps = {
  steps: readonly ConversationPlanStep[]
  currentStepIndex?: number | null
  changedFileCount?: number
  running?: boolean
  placement?: "composer" | "inline"
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

function resolveCurrentStepIndex(
  steps: readonly ConversationPlanStep[],
  requestedIndex: number | null | undefined
) {
  if (steps.length === 0) return -1
  if (typeof requestedIndex === "number" && Number.isFinite(requestedIndex)) {
    return Math.min(Math.max(Math.trunc(requestedIndex), 0), steps.length - 1)
  }

  const runningIndex = steps.findIndex((step) => step.status === "inProgress")
  if (runningIndex >= 0) return runningIndex

  const pendingIndex = steps.findIndex((step) => step.status === "pending")
  return pendingIndex >= 0 ? pendingIndex : steps.length - 1
}

function buildStepKeys(steps: readonly ConversationPlanStep[]) {
  const occurrences = new Map<string, number>()
  return steps.map((step) => {
    const occurrence = (occurrences.get(step.step) ?? 0) + 1
    occurrences.set(step.step, occurrence)
    return `${step.step}\u0000${occurrence}`
  })
}

function PlanStatusIcon({
  status,
  running,
}: {
  status: ConversationPlanStepStatus
  running: boolean
}) {
  if (status === "completed") {
    return (
      <CheckCircle2Icon
        className="size-4 text-[var(--app-muted)]"
        aria-hidden="true"
      />
    )
  }
  if (status === "inProgress") {
    return (
      <LoaderCircleIcon
        className={cn(
          "size-4 text-[var(--app-text)]",
          running && "animate-spin motion-reduce:animate-none"
        )}
        aria-hidden="true"
      />
    )
  }
  return (
    <CircleIcon
      className="size-4 text-[color-mix(in_srgb,var(--app-muted)_72%,transparent)]"
      aria-hidden="true"
    />
  )
}

function PlanProgressIcon({
  completed,
  total,
}: {
  completed: number
  total: number
}) {
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <svg
      className="conversation-plan-title-icon size-[18px] shrink-0"
      viewBox="0 0 20 20"
      fill="none"
      data-progress={progress}
      aria-hidden="true"
    >
      <circle
        className="conversation-plan-progress-track stroke-[color-mix(in_srgb,var(--app-selection)_28%,transparent)]"
        cx="10"
        cy="10"
        r="7.5"
        strokeWidth="2"
      />
      <circle
        className="conversation-plan-progress-value stroke-[var(--app-selection)] transition-[stroke-dasharray] duration-300 ease-out motion-reduce:transition-none"
        cx="10"
        cy="10"
        r="7.5"
        pathLength="100"
        strokeWidth="2"
        strokeLinecap={progress === 0 ? "butt" : "round"}
        strokeDasharray={`${progress} ${100 - progress}`}
        transform="rotate(-90 10 10)"
      />
      {progress === 100 && (
        <path
          className="conversation-plan-progress-check stroke-[color-mix(in_srgb,var(--app-selection)_65%,transparent)]"
          d="m7.25 10 1.8 1.8 3.7-3.7"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

function PlanTitleIcon() {
  return (
    <ListChecksIcon
      className="conversation-plan-title-icon size-[18px] shrink-0 text-[var(--app-muted)]"
      strokeWidth={1.8}
      aria-hidden="true"
    />
  )
}

function ConversationPlanSteps({
  steps,
  labelledBy,
  currentStepIndex,
  compact = false,
  running,
}: {
  steps: readonly ConversationPlanStep[]
  labelledBy: string
  currentStepIndex: number
  compact?: boolean
  running: boolean
}) {
  const { t } = useTranslation()
  const keys = buildStepKeys(steps)

  return (
    <ol
      className="conversation-plan-steps m-0 grid list-none gap-0 p-0"
      aria-labelledby={labelledBy}
    >
      {steps.map((step, index) => {
        const isCurrent = index === currentStepIndex
        return (
          <li
            key={keys[index]}
            className={cn(
              "conversation-plan-step grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start text-[length:var(--app-font-13)] font-medium",
              compact
                ? "gap-1.5 py-1 leading-[var(--app-ui-compact-line-height)]"
                : "gap-2.5 py-1 leading-[var(--app-ui-copy-line-height)]",
              step.status === "inProgress" && "text-[var(--app-text)]",
              step.status !== "inProgress" && "text-[var(--app-muted)]"
            )}
            data-status={step.status}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center",
                compact
                  ? "mt-[calc((var(--app-ui-compact-line-height)-1rem)/2)]"
                  : "mt-[calc((var(--app-ui-copy-line-height)-1rem)/2)]"
              )}
            >
              <PlanStatusIcon status={step.status} running={running} />
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="sr-only">
                {t(
                  `conversation.planStep${
                    step.status === "inProgress"
                      ? "InProgress"
                      : step.status === "completed"
                        ? "Completed"
                        : "Pending"
                  }`
                )}
                {": "}
              </span>
              {step.step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function PlanMeta({
  current,
  total,
  changedFileCount,
  running,
}: {
  current: number
  total: number
  changedFileCount?: number
  running: boolean
}) {
  const { t } = useTranslation()
  const showChangedFiles =
    changedFileCount !== undefined && changedFileCount > 0

  return (
    <span
      className="conversation-plan-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--app-font-12)] leading-[var(--app-line-18)] font-medium text-[var(--app-muted)]"
      aria-live={running ? "polite" : undefined}
    >
      <span>{t("conversation.planProgress", { current, total })}</span>
      {showChangedFiles && (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <FilesIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {t("conversation.planChangedFiles", {
              count: changedFileCount,
            })}
          </span>
        </>
      )}
    </span>
  )
}

export function ConversationPlanCard({
  steps,
  currentStepIndex,
  changedFileCount,
  running = false,
  placement = "composer",
  open,
  defaultOpen,
  onOpenChange,
  className,
}: ConversationPlanCardProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)

  if (steps.length === 0) return null

  const resolvedCurrentIndex = resolveCurrentStepIndex(steps, currentStepIndex)
  const current = resolvedCurrentIndex + 1
  const completedStepCount = steps.filter(
    (step) => step.status === "completed"
  ).length
  const controlled = open !== undefined
  const resolvedOpen = placement === "inline" ? true : (open ?? internalOpen)
  const handleOpenChange = (nextOpen: boolean) => {
    if (!controlled) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  if (placement === "inline") {
    return (
      <section
        className={cn(
          "conversation-plan-card conversation-plan-card-inline relative w-full overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-popover)_96%,transparent)] text-[var(--app-text)] shadow-none",
          className
        )}
        aria-labelledby={titleId}
        data-placement="inline"
        data-running={running || undefined}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--app-divider)] px-4 py-3">
          <h3
            id={titleId}
            className="inline-flex min-w-0 items-center gap-2 text-sm font-medium"
          >
            <PlanTitleIcon />
            <span className="min-w-0">{t("conversation.planTitle")}</span>
          </h3>
          <PlanMeta
            current={current}
            total={steps.length}
            changedFileCount={changedFileCount}
            running={running}
          />
        </div>
        <div className="px-4 py-2">
          <ConversationPlanSteps
            steps={steps}
            labelledBy={titleId}
            currentStepIndex={resolvedCurrentIndex}
            running={running}
          />
        </div>
      </section>
    )
  }

  return (
    <section
      className={cn(
        "conversation-plan-card conversation-plan-card-composer text-[var(--app-text)]",
        className
      )}
      data-placement="composer"
      data-running={running || undefined}
      data-open={resolvedOpen || undefined}
    >
      <HoverCard open={resolvedOpen} onOpenChange={handleOpenChange}>
        <HoverCardTrigger
          delay={0}
          render={
            <Button
              type="button"
              variant="ghost"
              className="conversation-plan-trigger conversation-plan-composer-trigger whitespace-normal"
              aria-label={t(
                resolvedOpen
                  ? "conversation.planCollapse"
                  : "conversation.planExpand"
              )}
            />
          }
        >
          <PlanProgressIcon
            completed={completedStepCount}
            total={steps.length}
          />
          <PlanMeta current={current} total={steps.length} running={running} />
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          sideOffset={10}
          align="center"
          className="conversation-plan-content conversation-plan-composer-content"
          aria-labelledby={titleId}
        >
          <h3 id={titleId} className="sr-only">
            {t("conversation.planTitle")}
          </h3>
          <ConversationPlanSteps
            steps={steps}
            labelledBy={titleId}
            currentStepIndex={resolvedCurrentIndex}
            compact
            running={running}
          />
        </HoverCardContent>
      </HoverCard>
    </section>
  )
}
