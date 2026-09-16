import { useState } from "react"
import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  reasoningEffortValues,
  type ModelPreference,
  type ReasoningEffort,
} from "@linksense/shared"

import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
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
import { cn } from "@/lib/utils"
import { formatTokenCount, type UsageNumberLanguage } from "@/lib/usage-number"
import type { ConversationModelContextUsage } from "@/features/conversations/conversation-context-usage"

export function ConversationModelSelector({
  preference,
  pending,
  onChange,
  contextUsage,
}: {
  preference: ModelPreference
  pending: boolean
  onChange: (model: string, reasoningEffort: ReasoningEffort) => void
  contextUsage?: ConversationModelContextUsage | null
}) {
  const { t } = useTranslation()
  const selectedModel = preference.models.find(
    (model) => model.id === preference.selected_model
  )
  const selectedReasoningEffort = preference.selected_reasoning_effort

  if (!preference.configured || !selectedModel || !selectedReasoningEffort) {
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

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ModelContextUsageIndicator
        model={selectedModel}
        contextUsage={contextUsage}
      />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-fit max-w-[min(20rem,calc(100vw-6rem))] rounded-full bg-muted/40 px-3 text-xs font-medium hover:bg-hover aria-expanded:bg-muted/60"
              aria-label={t("conversation.modelSelector")}
              disabled={pending}
            />
          }
        >
          <span className="truncate">{selectedModel.display_name}</span>
          <span className="text-muted-foreground">
            {t(`reasoningEffort.${selectedReasoningEffort}`)}
          </span>
          <ChevronDownIcon className="size-3.5" aria-hidden="true" />
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
}

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
  const { t } = useTranslation()
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
                className="col-start-2 h-auto min-w-0 flex-col gap-0 px-1 py-0 has-data-[icon=inline-end]:pr-1"
                aria-label={t("conversation.model")}
                disabled={pending}
              />
            }
          >
            <span className="flex items-center gap-1 text-xs font-medium text-[var(--app-selection)]">
              {t(`reasoningEffort.${previewEffort}`)}
              <ChevronRightIcon
                data-icon="inline-end"
                className="text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <span className="w-full truncate text-xs font-normal text-muted-foreground">
              {model.display_name}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={8}
            className="w-max max-w-[calc(100vw-1rem)] min-w-48"
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
                    <span className="max-w-[min(20rem,calc(100vw-5rem))] truncate">
                      {candidate.display_name}
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
          className="rounded-full text-muted-foreground"
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
        <SliderControl className="h-6">
          <SliderTrack className="bg-muted ring-1 ring-border/60 data-horizontal:h-4">
            <SliderRange className="bg-[var(--app-selection)]" />
          </SliderTrack>
          <div
            className="pointer-events-none absolute inset-x-2 flex items-center justify-between"
            aria-hidden="true"
          >
            {efforts.map((value, index) => (
              <span
                key={value}
                className={cn(
                  "size-1 rounded-full",
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

function ModelContextUsageIndicator({
  model,
  contextUsage,
}: {
  model: ModelPreference["models"][number]
  contextUsage?: ConversationModelContextUsage | null
}) {
  const { i18n, t } = useTranslation()
  const language = toUsageNumberLanguage(i18n.language)
  const totalTokens = contextUsage?.modelContextWindow ?? model.context_window
  const usedTokens = contextUsage?.usedTokens ?? null
  const percentage =
    usedTokens !== null && totalTokens !== null && totalTokens > 0
      ? Math.round((usedTokens / totalTokens) * 100)
      : null
  const usageLabel =
    percentage === null
      ? t("conversation.modelContextUsageUnknown")
      : t("conversation.modelContextUsagePercent", {
          percent: percentage,
        })

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={100}
        closeDelay={120}
        nativeButton={false}
        render={
          <span
            tabIndex={0}
            className="inline-flex size-7 shrink-0 cursor-default items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={t("conversation.modelContextBadgeLabel", {
              value: usageLabel,
            })}
          />
        }
      >
        <ContextUsageRing percentage={percentage} />
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-[min(14rem,calc(100vw-2rem))] px-3 py-2.5 text-center"
        aria-label={t("conversation.modelContextTitle")}
      >
        <div className="flex flex-col items-center gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("conversation.modelContextTitle")}
          </p>
          <p className="text-xs font-semibold">{usageLabel}</p>
          <p className="text-xs font-semibold">
            {usedTokens !== null && totalTokens !== null
              ? t("conversation.modelContextUsageDetail", {
                  used: formatContextTokenCount(usedTokens, language),
                  total: formatContextTokenCount(totalTokens, language),
                })
              : t("conversation.modelContextUnavailable")}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function ContextUsageRing({ percentage }: { percentage: number | null }) {
  const progress =
    percentage === null ? 0 : Math.min(100, Math.max(0, percentage))
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4 -rotate-90 text-foreground"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
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
      />
    </svg>
  )
}

function formatContextTokenCount(
  value: number,
  language: UsageNumberLanguage
): string {
  return formatTokenCount(value, language, 1_024).replace(/[KMB]$/u, (suffix) =>
    suffix.toLowerCase()
  )
}

function toUsageNumberLanguage(language: string): UsageNumberLanguage {
  return language === "en-US" ? "en-US" : "zh-CN"
}
