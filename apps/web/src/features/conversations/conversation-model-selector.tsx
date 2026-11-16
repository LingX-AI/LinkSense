import { memo, useContext, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { AuthContext } from "@/app/auth-state"
import { ChevronRightIcon, RotateCcwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  reasoningEffortValues,
  type ModelPreference,
  type ReasoningEffort,
} from "@linksense/shared"

import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { conversationSettingsReturnState } from "@/components/shell/settings-return-navigation"
import { cn } from "@/lib/utils"
import {
  ConversationContextBreakdownRows,
  ConversationContextUsageBar,
} from "@/features/conversations/conversation-context-usage-blocks"
import {
  buildConversationContextRows,
  equalConversationContextBreakdown,
  type ConversationContextBreakdown,
  type ConversationContextRow,
  type ConversationModelContextUsage,
} from "@/features/conversations/conversation-context-usage"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { normalizeLanguage } from "@/i18n"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Slider,
  SliderControl,
  SliderRange,
  SliderThumb,
  SliderTrack,
} from "@/components/ui/slider"
import {
  formatCompactTokenCount,
  formatTokenCount,
  type UsageNumberLanguage,
} from "@/lib/usage-number"

export const ConversationModelSelector = memo(
  function ConversationModelSelector({
    preference,
    pending,
    onChange,
    contextUsage,
    contextBreakdown,
  }: {
    preference: ModelPreference
    pending: boolean
    onChange: (model: string, reasoningEffort: ReasoningEffort) => void
    contextUsage?: ConversationModelContextUsage | null
    contextBreakdown?: ConversationContextBreakdown | null
  }) {
    const { t } = useTranslation()
    const auth = useContext(AuthContext)
    const [selectorOpen, setSelectorOpen] = useState(false)
    const selectedModel = preference.models.find(
      (model) => model.id === preference.selected_model
    )
    const selectedReasoningEffort = preference.selected_reasoning_effort

    if (!preference.configured || !selectedModel || !selectedReasoningEffort) {
      if (auth?.user?.role === "admin" && auth.user.status === "active") {
        return (
          <Button
            nativeButton={false}
            role="link"
            variant="secondary"
            size="sm"
            className="h-8 rounded-full px-3 text-xs"
            render={<Link to="/admin/models" />}
          >
            {t("onboarding.configureModel")}
          </Button>
        )
      }
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-full px-3 text-xs"
          disabled
        >
          {t("conversation.modelNotConfigured")}
        </Button>
      )
    }

    const contextWindow =
      contextUsage?.modelContextWindow ?? selectedModel.context_window
    const usedTokens = contextUsage?.usedTokens ?? null
    const usagePath =
      auth?.user?.role === "admin" && auth.user.status === "active"
        ? "/admin/usage"
        : "/settings/quota"
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        {usedTokens !== null && contextWindow !== null && contextWindow > 0 ? (
          <ModelContextUsageIndicator
            totalTokens={contextWindow}
            usedTokens={usedTokens}
            breakdown={contextBreakdown ?? null}
            usagePath={usagePath}
          />
        ) : null}
        <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-fit max-w-[min(15rem,calc(100vw-6rem))] min-w-0 shrink gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-xs font-normal text-foreground hover:border-input-hover hover:bg-card aria-expanded:border-border aria-expanded:bg-card @max-[48rem]/conversation-workspace:px-2"
                aria-label={t("conversation.modelSelector")}
                aria-busy={pending || undefined}
              />
            }
          >
            {selectorOpen ? (
              <span className="min-w-0 flex-1 truncate text-start">
                {t("conversation.chooseReasoningModel")}
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate text-start">
                  {selectedModel.display_name}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t(`reasoningEffort.${selectedReasoningEffort}`)}
                </span>
              </span>
            )}
            <DesignIcon
              name="chevron-down"
              className="transition-transform duration-150 group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
            />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-[min(14rem,calc(100vw-2rem))] gap-2 rounded-2xl px-3 py-2.5"
          >
            <PopoverTitle className="sr-only">
              {t("conversation.modelSelector")}
            </PopoverTitle>
            <ModelReasoningControls
              key={selectedModel.id}
              models={preference.models}
              model={selectedModel}
              effort={selectedReasoningEffort}
              pending={pending}
              onChange={onChange}
            />
          </PopoverContent>
        </Popover>
      </div>
    )
  },
  (previous, next) =>
    previous.preference === next.preference &&
    previous.pending === next.pending &&
    previous.onChange === next.onChange &&
    previous.contextUsage?.usedTokens === next.contextUsage?.usedTokens &&
    previous.contextUsage?.modelContextWindow ===
      next.contextUsage?.modelContextWindow &&
    previous.contextUsage?.turnId === next.contextUsage?.turnId &&
    equalConversationContextBreakdown(
      previous.contextBreakdown,
      next.contextBreakdown
    )
)

function ModelReasoningControls({
  models,
  model,
  effort,
  pending,
  onChange,
}: {
  models: ModelPreference["models"]
  model: ModelPreference["models"][number]
  effort: ReasoningEffort
  pending: boolean
  onChange: (model: string, reasoningEffort: ReasoningEffort) => void
}) {
  const { i18n, t } = useTranslation()
  const language = toUsageNumberLanguage(i18n.language)
  const [previewEffort, setPreviewEffort] = useState(effort)
  const [previousSelection, setPreviousSelection] = useState({
    effort,
    pending,
  })

  if (
    previousSelection.effort !== effort ||
    previousSelection.pending !== pending
  ) {
    setPreviousSelection({ effort, pending })
    // Keep the preview while saving, then reflect the saved value or a failed save.
    if (!pending) setPreviewEffort(effort)
  }

  const efforts = reasoningEffortValues.filter((value) =>
    model.supported_reasoning_efforts.includes(value)
  )
  const selectedIndex = efforts.indexOf(previewEffort)

  function commitEffort(nextEffort: ReasoningEffort): void {
    if (pending || nextEffort === effort) return
    setPreviewEffort(nextEffort)
    onChange(model.id, nextEffort)
  }

  return (
    <>
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_1.5rem] items-start gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="col-start-2 h-auto min-w-0 flex-col gap-0 px-1 py-1 disabled:opacity-100 has-data-[icon=inline-end]:pr-1"
                aria-label={t("conversation.model")}
                disabled={pending}
              />
            }
          >
            <span className="text-xs font-medium text-[var(--app-selection)]">
              {t(`reasoningEffort.${previewEffort}`)}
            </span>
            <span className="flex w-full min-w-0 items-center justify-center text-xs font-normal text-muted-foreground">
              <span className="truncate">{model.display_name}</span>
              <ChevronRightIcon
                data-icon="inline-end"
                className="text-muted-foreground"
                aria-hidden="true"
              />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={8}
            className="min-w-48"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("conversation.model")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={model.id}
                onValueChange={(modelId) => {
                  const nextModel = models.find(
                    (candidate) => candidate.id === modelId
                  )
                  if (pending || !nextModel || nextModel.id === model.id) return
                  onChange(
                    nextModel.id,
                    nextModel.supported_reasoning_efforts.includes(effort)
                      ? effort
                      : nextModel.default_reasoning_effort
                  )
                }}
              >
                {models.map((candidate) => (
                  <DropdownMenuRadioItem
                    key={candidate.id}
                    value={candidate.id}
                    disabled={pending}
                    className="min-h-9 text-[length:var(--app-font-13)] leading-5"
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="max-w-[min(20rem,calc(100vw-5rem))] truncate">
                        {candidate.display_name}
                      </span>
                      {candidate.context_window !== null &&
                      candidate.context_window > 0 ? (
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">
                          {t("conversation.modelContextWindowOption", {
                            size: formatTokenCount(
                              candidate.context_window,
                              language
                            ),
                          })}
                        </span>
                      ) : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "rounded-full text-muted-foreground",
            pending &&
              previewEffort !== model.default_reasoning_effort &&
              "disabled:opacity-100"
          )}
          aria-label={t("conversation.resetReasoningEffort")}
          title={t("conversation.resetReasoningEffort")}
          disabled={pending || previewEffort === model.default_reasoning_effort}
          onClick={() => commitEffort(model.default_reasoning_effort)}
        >
          <RotateCcwIcon aria-hidden="true" />
        </Button>
      </div>
      <Slider
        value={selectedIndex}
        min={0}
        max={Math.max(1, efforts.length - 1)}
        step={1}
        disabled={pending || efforts.length < 2}
        onValueChange={(index) => {
          const nextEffort = efforts[index]
          if (nextEffort) setPreviewEffort(nextEffort)
        }}
        onValueCommitted={(index) => {
          const nextEffort = efforts[index]
          if (nextEffort) commitEffort(nextEffort)
        }}
      >
        <SliderControl
          onPointerDown={(event) => {
            // Base UI also handles touchstart. Let that path own touch gestures
            // so a second start cannot clear the value waiting to be committed.
            if (event.pointerType === "touch") event.preventBaseUIHandler()
          }}
          className={cn(
            "h-6",
            pending && efforts.length > 1 && "data-disabled:opacity-100"
          )}
        >
          <SliderTrack className="bg-muted ring-1 ring-border/60 data-horizontal:h-4">
            <SliderRange />
          </SliderTrack>
          <div
            className="pointer-events-none absolute inset-x-2 flex items-center justify-between"
            aria-hidden="true"
          >
            {efforts.map((value, index) => (
              <span
                key={value}
                data-reasoning-effort-point
                className={cn(
                  "pointer-events-auto relative size-1 rounded-full transition-transform duration-150 ease-out before:absolute before:-inset-1.5 before:content-[''] hover:scale-[1.75] motion-reduce:transition-none",
                  index <= selectedIndex
                    ? "bg-white/45"
                    : "bg-muted-foreground/40"
                )}
              />
            ))}
          </div>
          <SliderThumb
            className="size-5"
            aria-label={t("conversation.reasoningEffort")}
            aria-valuetext={t(`reasoningEffort.${previewEffort}`)}
          />
        </SliderControl>
      </Slider>
    </>
  )
}

const ModelContextUsageIndicator = memo(function ModelContextUsageIndicator({
  totalTokens,
  usedTokens,
  breakdown,
  usagePath,
}: {
  totalTokens: number
  usedTokens: number
  breakdown: ConversationContextBreakdown | null
  usagePath: string
}) {
  const { i18n, t } = useTranslation()
  const language = toUsageNumberLanguage(i18n.language)
  const [expanded, setExpanded] = useState(false)
  const percentage = Math.round((usedTokens / totalTokens) * 100)
  const formatTokens = (value: number) =>
    formatCompactTokenCount(value, language)
  const rowLabels: Record<ConversationContextRow["key"], string> = {
    input: t("conversation.taskOverview.tokenInput"),
    cached: t("conversation.taskOverview.tokenCachedInput"),
    output: t("conversation.taskOverview.tokenOutput"),
    reasoning: t("conversation.taskOverview.tokenReasoning"),
    free: t("conversation.taskOverview.freeSpace"),
  }
  const rows = buildConversationContextRows(
    breakdown,
    usedTokens,
    totalTokens
  ).map((row) => ({ ...row, label: rowLabels[row.key] }))
  const usageLabel = t("conversation.modelContextUsageLabel", {
    used: formatTokens(usedTokens),
    total: formatTokens(totalTokens),
    percent: percentage,
  })
  const summary = t("conversation.modelContextUsageSummary", {
    used: formatTokens(usedTokens),
    total: formatTokens(totalTokens),
    percent: percentage,
  })

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          delay={100}
          closeDelay={120}
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="cursor-pointer rounded-lg text-muted-foreground"
                  aria-label={usageLabel}
                />
              }
            />
          }
        >
          <ContextUsageRing percentage={percentage} />
        </TooltipTrigger>
        <ActionTooltipContent>{usageLabel}</ActionTooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] gap-2 rounded-2xl p-3"
      >
        <PopoverTitle className="sr-only">
          {t("conversation.modelContextWindowTitle")}
        </PopoverTitle>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="h-auto w-full justify-between gap-2 px-0 py-0 text-xs font-normal hover:bg-transparent aria-expanded:bg-transparent"
          >
            <span className="text-muted-foreground">
              {t("conversation.modelContextWindowTitle")}
            </span>
            <span className="flex items-center gap-1 text-foreground tabular-nums">
              {summary}
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                  expanded && "rotate-90"
                )}
              />
            </span>
          </Button>
          <ConversationContextUsageBar
            rows={rows}
            usedTokens={usedTokens}
            totalTokens={totalTokens}
            label={usageLabel}
          />
          {expanded && rows.length > 0 ? (
            <ConversationContextBreakdownRows
              rows={rows}
              totalTokens={totalTokens}
              formatTokens={formatTokens}
            />
          ) : null}
          <UsageBreakdownLink usagePath={usagePath} />
        </div>
      </PopoverContent>
    </Popover>
  )
})

function UsageBreakdownLink({ usagePath }: { usagePath: string }) {
  const { t } = useTranslation()
  const location = useLocation()
  // Keeps the settings shell's back control returning to this conversation.
  const returnState = conversationSettingsReturnState(location)
  return (
    <div className="flex border-t border-border pt-2">
      <Button
        variant="secondary"
        size="xs"
        nativeButton={false}
        role="link"
        className="font-normal"
        render={<Link to={usagePath} state={returnState} />}
      >
        {t("conversation.modelContextDetailedBreakdown")}
      </Button>
    </div>
  )
}

function ContextUsageRing({ percentage }: { percentage: number }) {
  const progress = Math.min(100, Math.max(0, percentage))
  return (
    <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="text-muted-foreground opacity-40"
      />
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${progress} ${100 - progress}`}
        className="text-[var(--chart-1)]"
      />
    </svg>
  )
}

function toUsageNumberLanguage(language: string): UsageNumberLanguage {
  return normalizeLanguage(language) ?? "zh-CN"
}
