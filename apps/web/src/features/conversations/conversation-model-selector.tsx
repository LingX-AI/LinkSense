import { ChevronDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ModelPreference, ReasoningEffort } from "@linksense/shared"

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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatTokenCount, type UsageNumberLanguage } from "@/lib/usage-number"
import type { ConversationModelContextUsage } from "@/features/conversations/conversation-context-usage"
import { cn } from "@/lib/utils"

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
      <DropdownMenu>
        <DropdownMenuTrigger
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
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-max max-w-[calc(100vw-1rem)] min-w-52"
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-9 text-sm">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span>{t("conversation.model")}</span>
                <span className="ml-auto max-w-[min(18rem,50vw)] truncate font-normal text-muted-foreground">
                  {selectedModel.display_name}
                </span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={6}
              className="w-max max-w-[calc(100vw-1rem)] min-w-48"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("conversation.model")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={preference.selected_model ?? undefined}
                  onValueChange={(modelId) => {
                    const model = preference.models.find(
                      (candidate) => candidate.id === modelId
                    )
                    if (!model) return
                    onChange(
                      model.id,
                      model.supported_reasoning_efforts.includes(
                        selectedReasoningEffort
                      )
                        ? selectedReasoningEffort
                        : model.default_reasoning_effort
                    )
                  }}
                >
                  {preference.models.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      closeOnClick={false}
                      className="min-h-9 text-sm"
                    >
                      <span className="max-w-[min(20rem,calc(100vw-5rem))] truncate">
                        {model.display_name}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-9 text-sm">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span>{t("conversation.reasoningEffort")}</span>
                <span className="ml-auto font-normal text-muted-foreground">
                  {t(`reasoningEffort.${selectedReasoningEffort}`)}
                </span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={6}
              className="w-max max-w-[calc(100vw-1rem)] min-w-36"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {t("conversation.reasoningEffort")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={selectedReasoningEffort}
                  onValueChange={(effort) =>
                    onChange(selectedModel.id, effort as ReasoningEffort)
                  }
                >
                  {selectedModel.supported_reasoning_efforts.map((effort) => (
                    <DropdownMenuRadioItem
                      key={effort}
                      value={effort}
                      closeOnClick={false}
                      className="min-h-9 text-sm"
                    >
                      {t(`reasoningEffort.${effort}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
                  used: formatCompactTokenMarks(usedTokens, language),
                  total: formatCompactTokenMarks(totalTokens, language),
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
      className={cn(
        "size-4 -rotate-90",
        percentage !== null && percentage >= 85 && "text-destructive",
        percentage !== null && percentage < 85 && "text-foreground"
      )}
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

function formatCompactTokenMarks(
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
